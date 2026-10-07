// 语音笔记 · 主逻辑
import {
  $, $$, uid, fmtTime, fmtClock, fmtDate, fmtBytes, escapeHtml,
  debounce, extForMime, safeFilename, downloadBlob, toast,
  blobToDataURL, dataURLToBlob, nextRate,
} from './utils.js';
import { db, requestPersistence } from './db.js';
import { Recorder, isRecordingSupported, decodePeaks, probeDuration } from './audio.js';
import { Transcriber, isSpeechSupported, speechSupportText } from './speech.js';
import { drawWave, drawLiveWave, resample } from './wave.js';

/* ============================================================
   设置
   ============================================================ */

const SETTINGS_KEY = 'voice-notes:settings';
const DEFAULTS = { theme: 'dark', autoTranscribe: true, showInterim: true, backupAudio: true };

let settings = { ...DEFAULTS };
try {
  settings = { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}) };
} catch { /* 忽略损坏的设置 */ }

function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* 忽略 */ }
}

const media = window.matchMedia('(prefers-color-scheme: light)');

function resolvedTheme() {
  if (settings.theme === 'auto') return media.matches ? 'light' : 'dark';
  return settings.theme;
}

function applyTheme() {
  document.documentElement.dataset.theme = resolvedTheme();
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = resolvedTheme() === 'light' ? '#f4f6fa' : '#0d1016';
  $$('#themeSeg button').forEach((b) => b.classList.toggle('is-active', b.dataset.theme === settings.theme));
  requestAnimationFrame(() => { renderListWaves(); renderDetailWave(); });
}

media.addEventListener('change', () => { if (settings.theme === 'auto') applyTheme(); });

/* ============================================================
   状态
   ============================================================ */

const state = {
  notes: [],
  filter: 'all',
  query: '',
  currentId: null,
  blobUrl: null,
  peaksCache: new Map(),
  rate: 1,
  audioMissing: false,
};

let recorder = null;
let transcriber = null;
let cancelArmed = false;

const audioEl = new Audio();
audioEl.preload = 'metadata';

const el = {
  search: $('#searchInput'),
  clearSearch: $('#btnClearSearch'),
  filters: $('#filters'),
  stats: $('#stats'),
  dockStats: $('#dockStats'),
  list: $('#noteList'),
  listEmpty: $('#listEmpty'),
  listEmptyText: $('#listEmptyText'),
  listEmptyHint: $('#listEmptyHint'),
  detail: $('#detail'),
  detailEmpty: $('#detailEmpty'),
  btnTheme: $('#btnTheme'),
  noteView: $('#noteView'),
  title: $('#noteTitle'),
  fav: $('#btnFav'),
  meta: $('#noteMeta'),
  player: $('#player'),
  play: $('#btnPlay'),
  waveWrap: $('#waveWrap'),
  waveCanvas: $('#waveCanvas'),
  timeLabel: $('#timeLabel'),
  rate: $('#btnRate'),
  transcript: $('#noteTranscript'),
  transcriptCount: $('#transcriptCount'),
  btnCopy: $('#btnCopy'),
  btnClearText: $('#btnClearText'),
  btnStamp: $('#btnStamp'),
  tagList: $('#tagList'),
  tagInput: $('#tagInput'),
  btnDownload: $('#btnDownload'),
  btnExportNote: $('#btnExportNote'),
  btnDelete: $('#btnDelete'),
  btnRestore: $('#btnRestore'),
  btnBack: $('#btnBack'),
  recOverlay: $('#recOverlay'),
  recStatus: $('#recStatus'),
  recTimer: $('#recTimer'),
  recPulse: $('#recPulse'),
  recCanvas: $('#recCanvas'),
  recFinal: $('#recFinal'),
  recInterim: $('#recInterim'),
  recLive: $('#recLive'),
  recLiveHint: $('#recLiveHint'),
  btnRecord: $('#btnRecord'),
  btnPause: $('#btnPause'),
  btnStop: $('#btnStop'),
  btnCancel: $('#btnCancel'),
  recDot: $('#recDot'),
  dockHint: $('#dockHint'),
  sheet: $('#sheet'),
};

const currentNote = () => state.notes.find((n) => n.id === state.currentId) || null;

/* ============================================================
   列表渲染
   ============================================================ */

function visibleNotes() {
  const q = state.query.trim().toLowerCase();
  return state.notes.filter((note) => {
    if (state.filter === 'trash') {
      if (!note.deletedAt) return false;
    } else if (note.deletedAt) {
      return false;
    }
    if (state.filter === 'fav' && !note.favorite) return false;
    if (!q) return true;
    const haystack = [note.title, note.transcript, (note.tags || []).join(' ')]
      .filter(Boolean).join('\n').toLowerCase();
    return haystack.includes(q);
  });
}

function renderStats() {
  const alive = state.notes.filter((n) => !n.deletedAt);
  const trashed = state.notes.filter((n) => n.deletedAt);
  const totalDuration = alive.reduce((sum, n) => sum + (n.duration || 0), 0);
  const totalSize = alive.reduce((sum, n) => sum + (n.size || 0), 0);

  el.stats.textContent = alive.length
    ? `${alive.length} 条笔记 · 共 ${fmtTime(totalDuration)}${trashed.length ? ` · 回收站 ${trashed.length}` : ''}`
    : (trashed.length ? `回收站里有 ${trashed.length} 条` : '还没有笔记');

  el.dockStats.textContent = alive.length
    ? `共 ${alive.length} 条 · ${fmtTime(totalDuration)} · ${fmtBytes(totalSize)}`
    : '开始你的第一条语音笔记';
}

function renderList() {
  const list = visibleNotes();
  renderStats();

  el.list.textContent = '';
  // 列表为空时把 <ul> 收起来，让空状态引导铺满整个侧栏
  el.list.hidden = list.length === 0;

  if (!list.length) {
    el.listEmpty.hidden = false;
    if (state.query.trim()) {
      el.listEmptyText.textContent = '没有匹配的笔记';
      el.listEmptyHint.textContent = `试试别的关键词：${state.query.trim().slice(0, 20)}`;
    } else if (state.filter === 'trash') {
      el.listEmptyText.textContent = '回收站是空的';
      el.listEmptyHint.textContent = '删除的笔记会先放到这里';
    } else if (state.filter === 'fav') {
      el.listEmptyText.textContent = '还没有收藏的笔记';
      el.listEmptyHint.textContent = '点开一条笔记，点右上角的星标收藏';
    } else {
      el.listEmptyText.textContent = '还没有语音笔记';
      el.listEmptyHint.textContent = '点下面的麦克风，说一句试试';
    }
    return;
  }

  el.listEmpty.hidden = true;

  const frag = document.createDocumentFragment();
  for (const note of list) {
    const li = document.createElement('li');
    li.className = 'note-item' + (note.id === state.currentId ? ' is-active' : '');
    li.dataset.id = note.id;

    const excerpt = (note.transcript || '').trim().replace(/\s+/g, ' ');
    const tags = (note.tags || []).slice(0, 4)
      .map((t) => `<span class="ni-tag">${escapeHtml(t)}</span>`).join('');

    li.innerHTML = `
      <div class="ni-top">
        <span class="ni-title">${escapeHtml(note.title || '未命名笔记')}</span>
        ${note.favorite ? '<span class="ni-star">★</span>' : ''}
      </div>
      <p class="ni-excerpt${excerpt ? '' : ' is-empty'}">${escapeHtml(excerpt || '（没有文字稿，点开听录音）')}</p>
      <div class="ni-bottom">
        <div class="ni-wave"><canvas></canvas></div>
        <span class="ni-dur">${fmtTime(note.duration || 0)}</span>
        <span class="ni-time">${fmtDate(note.createdAt)}</span>
      </div>
      ${tags ? `<div class="ni-tags">${tags}</div>` : ''}
    `;

    li.addEventListener('click', () => selectNote(note.id));
    frag.appendChild(li);
  }

  el.list.appendChild(frag);
  requestAnimationFrame(renderListWaves);
}

/**
 * 只更新一张列表卡片的内容，不重建整个列表。
 * 编辑标题/文字稿时用它，避免每敲一个字都重排整个列表，同时卡片摘要不会过期。
 */
function refreshListItem(note) {
  const li = $$('.note-item', el.list).find((node) => node.dataset.id === note.id);
  if (!li) return;

  const titleEl = li.querySelector('.ni-title');
  if (titleEl) titleEl.textContent = note.title || '未命名笔记';

  const excerpt = (note.transcript || '').trim().replace(/\s+/g, ' ');
  const exEl = li.querySelector('.ni-excerpt');
  if (exEl) {
    exEl.textContent = excerpt || '（没有文字稿，点开听录音）';
    exEl.classList.toggle('is-empty', !excerpt);
  }

  const top = li.querySelector('.ni-top');
  const star = li.querySelector('.ni-star');
  if (note.favorite && !star && top) top.insertAdjacentHTML('beforeend', '<span class="ni-star">★</span>');
  else if (!note.favorite && star) star.remove();

  const tags = (note.tags || []).slice(0, 4)
    .map((t) => `<span class="ni-tag">${escapeHtml(t)}</span>`).join('');
  const tagWrap = li.querySelector('.ni-tags');
  if (tagWrap) tagWrap.innerHTML = tags;
  else if (tags) li.insertAdjacentHTML('beforeend', `<div class="ni-tags">${tags}</div>`);
}

function renderListWaves() {
  const items = $$('.note-item', el.list);
  for (const li of items) {
    const note = state.notes.find((n) => n.id === li.dataset.id);
    const canvas = li.querySelector('canvas');
    if (!note || !canvas) continue;
    const peaks = state.peaksCache.get(note.id) || note.peaks;
    const width = canvas.clientWidth || 120;
    const bars = Math.max(18, Math.min(64, Math.round(width / 4)));
    const isCurrent = note.id === state.currentId;
    const duration = isCurrent ? effectiveDuration(note) : (note.duration || 0);
    const progress = isCurrent && duration
      ? Math.min(1, audioEl.currentTime / duration) : 0;
    drawWave(canvas, { peaks: resample(peaks || [], bars), progress });
  }
}

/* ============================================================
   详情渲染
   ============================================================ */

function selectNote(id, opts = {}) {
  state.currentId = id;
  const note = currentNote();
  if (!note) return;

  $$('.note-item', el.list).forEach((li) => li.classList.toggle('is-active', li.dataset.id === id));
  el.detailEmpty.hidden = true;
  el.noteView.hidden = false;
  el.detail.classList.add('is-open');

  el.title.value = note.title || '';
  el.transcript.value = note.transcript || '';
  updateTranscriptCount();
  el.fav.classList.toggle('is-on', !!note.favorite);

  el.btnDelete.textContent = note.deletedAt ? '彻底删除' : '删除';
  el.btnDelete.classList.toggle('danger', true);
  el.btnRestore.hidden = !note.deletedAt;

  renderMeta(note);
  renderTags(note);
  loadNoteAudio(note).then(() => {
    renderDetailWave();
    if (opts.focusTranscript) el.transcript.focus();
  });
}

function renderMeta(note) {
  const parts = [
    `<span>创建于 <b>${fmtDate(note.createdAt)}</b></span>`,
    `<span>时长 <b>${fmtTime(note.duration || 0)}</b></span>`,
    note.size ? `<span>大小 <b>${fmtBytes(note.size)}</b></span>` : '',
    note.updatedAt && note.updatedAt - note.createdAt > 60000
      ? `<span>修改于 <b>${fmtDate(note.updatedAt)}</b></span>` : '',
    state.audioMissing ? '<span style="color:var(--record)">音频文件已丢失</span>' : '',
  ].filter(Boolean);
  el.meta.innerHTML = parts.join('');
}

function renderTags(note) {
  el.tagList.textContent = '';
  const tags = note.tags || [];
  for (const tag of tags) {
    const span = document.createElement('span');
    span.className = 'tag';
    span.innerHTML = `${escapeHtml(tag)}<button type="button" title="移除标签">✕</button>`;
    span.querySelector('button').addEventListener('click', () => {
      note.tags = note.tags.filter((t) => t !== tag);
      saveNote(note, { relist: true });
      renderTags(note);
    });
    el.tagList.appendChild(span);
  }
}

function updateTranscriptCount() {
  const len = el.transcript.value.trim().length;
  el.transcriptCount.textContent = len ? `· ${len} 字` : '';
}

async function loadNoteAudio(note) {
  audioEl.pause();
  audioEl.removeAttribute('src');
  try { audioEl.load(); } catch { /* 忽略 */ }
  releaseBlobUrl();
  state.audioMissing = false;
  el.player.classList.remove('is-playing');
  el.timeLabel.textContent = `0:00 / ${fmtTime(note.duration || 0)}`;

  const blob = await db.getBlob(note.id).catch(() => null);
  if (!blob || !blob.size) {
    state.audioMissing = true;
    renderMeta(note);
    el.play.disabled = true;
    return null;
  }

  state.blobUrl = URL.createObjectURL(blob);
  audioEl.src = state.blobUrl;
  audioEl.playbackRate = state.rate;
  el.play.disabled = false;

  // 老数据可能没存峰值，这里补一次
  if (!(note.peaks || []).length) {
    decodePeaks(blob, 200).then((res) => {
      if (res?.peaks?.length) {
        note.peaks = res.peaks;
        state.peaksCache.set(note.id, res.peaks);
        if (!note.duration && res.duration) { note.duration = res.duration; renderMeta(note); }
        db.putNote(note);
        renderListWaves();
        renderDetailWave();
      }
    });
  }
  return blob;
}

function releaseBlobUrl() {
  if (state.blobUrl) {
    URL.revokeObjectURL(state.blobUrl);
    state.blobUrl = null;
  }
}

/**
 * 取当前音频的有效时长。
 * MediaRecorder 录出的 webm 通常不带时长头，此时 audioEl.duration 是 Infinity，
 * 必须回落到录音时记录的真实秒数，否则进度条和点击定位都会失效。
 */
function effectiveDuration(note = currentNote()) {
  const d = audioEl.duration;
  if (Number.isFinite(d) && d > 0) return d;
  return note?.duration || 0;
}

let waveRaf = 0;
function renderDetailWave() {
  if (el.noteView.hidden) return;
  const note = currentNote();
  if (!note) return;
  cancelAnimationFrame(waveRaf);
  waveRaf = requestAnimationFrame(() => {
    const peaks = state.peaksCache.get(note.id) || note.peaks || [];
    const bars = Math.max(40, Math.min(160, Math.round((el.waveCanvas.clientWidth || 400) / 4)));
    const duration = effectiveDuration(note);
    const progress = duration ? Math.min(1, audioEl.currentTime / duration) : 0;
    drawWave(el.waveCanvas, { peaks: resample(peaks, bars), progress });
  });
}

/* ============================================================
   保存
   ============================================================ */

async function saveNote(note, opts = {}) {
  note.updatedAt = Date.now();
  await db.putNote(note).catch(() => toast('保存失败，存储空间可能已满', 'err'));
  if (opts.relist) {
    renderList();
    if (note.id === state.currentId) $$('.note-item', el.list)
      .forEach((li) => li.classList.toggle('is-active', li.dataset.id === note.id));
  }
}

const saveTitle = debounce(() => {
  const note = currentNote();
  if (!note) return;
  note.title = el.title.value.trim();
  saveNote(note);
  refreshListItem(note);
}, 400);

const saveTranscript = debounce(() => {
  const note = currentNote();
  if (!note) return;
  note.transcript = el.transcript.value;
  saveNote(note);
  refreshListItem(note);
}, 500);

/* ============================================================
   录音时保持屏幕常亮（手机录长笔记时很有用）
   ============================================================ */

let wakeLock = null;

/** 安卓封装版：WebView 里没有 Wake Lock API，转交给原生保持屏幕常亮 */
function notifyNativeRecording(active) {
  const bridge = window.VoiceNotesNative;
  if (bridge && typeof bridge.setRecording === 'function') {
    try { bridge.setRecording(active); } catch { /* 忽略 */ }
  }
}

async function acquireWakeLock() {
  notifyNativeRecording(true);
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener?.('release', () => { wakeLock = null; });
  } catch {
    wakeLock = null;   // 不支持或被系统拒绝都不影响录音
  }
}

async function releaseWakeLock() {
  notifyNativeRecording(false);
  const lock = wakeLock;
  wakeLock = null;
  try { await lock?.release(); } catch { /* 忽略 */ }
}

// 切到后台再回来时，浏览器会回收 wake lock，需要重新申请
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && recorder && !wakeLock) acquireWakeLock();
});

/* ============================================================
   录音流程
   ============================================================ */

/** 手机上不该提示"按空格"，触屏和键盘的文案要分开 */
const isMobile = () => window.matchMedia('(max-width: 900px)').matches;
const dockHintText = (phase = 'idle') => {
  if (phase === 'recording') {
    return isMobile() ? '录音中…点「完成并保存」结束' : '正在录音…按空格结束并保存';
  }
  return isMobile() ? '点下面的麦克风开始录音' : '按空格或点击麦克风开始录音';
};

function permissionMessage(err) {
  const name = err?.name || '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return '麦克风权限被拒绝，请在浏览器地址栏的权限设置里允许麦克风后重试。';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return '没有检测到可用的麦克风设备。';
  }
  if (name === 'NotReadableError') {
    return '麦克风被其它程序占用了，请关闭后重试。';
  }
  return '无法开始录音：' + (err?.message || '未知错误');
}

function showOverlay() {
  el.recOverlay.hidden = false;
  el.recDot.hidden = false;
  el.btnRecord.classList.add('is-armed');
  el.dockHint.textContent = dockHintText('recording');
  el.recTimer.textContent = '00:00';
  el.recFinal.textContent = '';
  el.recInterim.textContent = '';
  el.recStatus.textContent = '录音中';
  el.recPulse.classList.remove('is-paused');
  el.btnPause.textContent = '暂停';
  el.btnCancel.textContent = '取消';
  el.recLiveHint.textContent = isSpeechSupported() && settings.autoTranscribe
    ? '正在聆听…说的话会实时变成文字'
    : '正在录音…（本浏览器不支持自动转写，可稍后手动输入文字稿）';
  cancelArmed = false;
}

function hideOverlay() {
  el.recOverlay.hidden = true;
  el.recDot.hidden = true;
  el.btnRecord.classList.remove('is-armed');
  el.dockHint.textContent = dockHintText('idle');
}

async function startRecording() {
  if (recorder) return;

  if (!isRecordingSupported()) {
    toast('当前浏览器不支持录音，请换用 Chrome / Edge', 'err', 3600);
    return;
  }

  let rec;
  try {
    rec = new Recorder({
      onFrame: onRecFrame,
      onError: (err) => toast(err?.message || '录音出错', 'err'),
    });
    await rec.start();
  } catch (err) {
    try { await rec?.cancel(); } catch { /* 忽略 */ }
    toast(permissionMessage(err), 'err', 4200);
    return;
  }

  recorder = rec;
  showOverlay();
  acquireWakeLock();

  if (settings.autoTranscribe && isSpeechSupported()) {
    transcriber = new Transcriber({
      onText: ({ final, interim }) => {
        el.recFinal.textContent = final;
        el.recInterim.textContent = settings.showInterim ? interim : '';
        el.recLive.scrollTop = el.recLive.scrollHeight;
      },
      onError: (msg) => {
        el.recLiveHint.textContent = msg;
        toast(msg, 'err', 3600);
      },
    });
    transcriber.start();
  }
}

function onRecFrame({ timeDomain, elapsed, paused }) {
  el.recTimer.textContent = fmtClock(elapsed);
  if (timeDomain && !paused) drawLiveWave(el.recCanvas, timeDomain);
}

function togglePause() {
  if (!recorder) return;
  if (recorder.state === 'recording') {
    recorder.pause();
    transcriber?.suspend();
    el.recStatus.textContent = '已暂停';
    el.recPulse.classList.add('is-paused');
    el.btnPause.textContent = '继续';
  } else if (recorder.state === 'paused') {
    recorder.resume();
    transcriber?.resume();
    el.recStatus.textContent = '录音中';
    el.recPulse.classList.remove('is-paused');
    el.btnPause.textContent = '暂停';
  }
}

async function finishRecording(save) {
  const rec = recorder;
  const tr = transcriber;
  recorder = null;
  transcriber = null;
  if (!rec) return;

  hideOverlay();
  releaseWakeLock();

  if (!save) {
    try { tr?.stop(); tr?.dispose(); } catch { /* 忽略 */ }
    await rec.cancel();
    renderDetailWave();
    toast('已放弃这段录音');
    return;
  }

  el.dockHint.textContent = '正在保存…';
  const result = await rec.stop();

  let speechText = '';
  if (tr) {
    try { tr.stop(); } catch { /* 忽略 */ }
    await new Promise((r) => setTimeout(r, 320));   // 等引擎吐出最后一句
    speechText = tr.finalText || '';
    try { tr.dispose(); } catch { /* 忽略 */ }
  }
  el.dockHint.textContent = dockHintText('idle');

  if (!result?.blob || result.blob.size === 0) {
    toast('没有录到声音，已丢弃', 'err');
    return;
  }

  let peaks = result.peaks || [];
  let duration = result.duration || 0;
  const decoded = await decodePeaks(result.blob, 200);
  if (decoded?.peaks?.length) {
    peaks = decoded.peaks;
    if (decoded.duration) duration = decoded.duration;
  }
  if (!peaks.length) peaks = new Array(48).fill(0.1);
  if (!duration) duration = await probeDuration(result.blob);

  const text = speechText.trim();
  const now = Date.now();
  const note = {
    id: uid(),
    title: text ? text.slice(0, 28) : `语音笔记 ${fmtDate(now)}`,
    transcript: text,
    tags: [],
    favorite: false,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    duration,
    mimeType: result.mimeType || 'audio/webm',
    size: result.blob.size,
    peaks,
  };

  try {
    await db.putBlob(note.id, result.blob);
    await db.putNote(note);
  } catch (err) {
    toast('保存失败：' + (err?.message || '存储空间可能不足'), 'err', 4200);
    return;
  }

  state.notes.unshift(note);
  state.peaksCache.set(note.id, peaks);
  state.filter = 'all';
  $$('#filters .chip').forEach((c) => c.classList.toggle('is-active', c.dataset.filter === 'all'));
  renderList();
  selectNote(note.id, { focusTranscript: !text });
  toast(text ? '已保存，文字稿已自动生成' : '已保存录音', 'ok');
}

/* ============================================================
   播放器
   ============================================================ */

el.play.addEventListener('click', () => {
  if (!audioEl.src) return;
  if (audioEl.paused) audioEl.play().catch(() => toast('无法播放这段音频', 'err'));
  else audioEl.pause();
});

audioEl.addEventListener('play', () => el.player.classList.add('is-playing'));
audioEl.addEventListener('pause', () => el.player.classList.remove('is-playing'));

audioEl.addEventListener('loadedmetadata', () => {
  const note = currentNote();
  const dur = Number.isFinite(audioEl.duration) ? audioEl.duration : (note?.duration || 0);
  if (note && (!note.duration || Math.abs(note.duration - dur) > 0.6) && Number.isFinite(audioEl.duration)) {
    note.duration = dur;
    db.putNote(note);
    renderList();
    renderMeta(note);
  }
  el.timeLabel.textContent = `${fmtTime(audioEl.currentTime)} / ${fmtTime(dur)}`;
  renderDetailWave();
});

audioEl.addEventListener('timeupdate', () => {
  const dur = effectiveDuration();
  el.timeLabel.textContent = `${fmtTime(audioEl.currentTime)} / ${fmtTime(dur)}`;
  renderDetailWave();
  renderListWaves();
});

audioEl.addEventListener('ended', () => {
  el.player.classList.remove('is-playing');
  audioEl.currentTime = 0;
  renderDetailWave();
  renderListWaves();
});

audioEl.addEventListener('error', () => {
  if (audioEl.src) toast('这段音频无法播放，可能已损坏', 'err');
});

el.rate.addEventListener('click', () => {
  state.rate = nextRate(state.rate);
  audioEl.playbackRate = state.rate;
  el.rate.textContent = state.rate + '×';
});

let scrubbing = false;
function seekFromEvent(event) {
  const rect = el.waveWrap.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  const dur = effectiveDuration();
  if (!dur) return;
  audioEl.currentTime = ratio * dur;
  renderDetailWave();
  renderListWaves();
}

el.waveWrap.addEventListener('pointerdown', (e) => {
  if (!audioEl.src) return;
  scrubbing = true;
  // 指针捕获失败不应连累定位功能
  try { el.waveWrap.setPointerCapture(e.pointerId); } catch { /* 忽略 */ }
  seekFromEvent(e);
});
el.waveWrap.addEventListener('pointermove', (e) => { if (scrubbing) seekFromEvent(e); });
const endScrub = (e) => {
  if (!scrubbing) return;
  scrubbing = false;
  try { el.waveWrap.releasePointerCapture(e.pointerId); } catch { /* 忽略 */ }
};
el.waveWrap.addEventListener('pointerup', endScrub);
el.waveWrap.addEventListener('pointercancel', endScrub);

/* ============================================================
   详情区交互
   ============================================================ */

el.title.addEventListener('input', saveTitle);
el.title.addEventListener('blur', () => {
  const note = currentNote();
  if (!note) return;
  note.title = el.title.value.trim();
  saveNote(note, { relist: true });
});

el.transcript.addEventListener('input', () => { updateTranscriptCount(); saveTranscript(); });
el.transcript.addEventListener('blur', () => {
  const note = currentNote();
  if (!note) return;
  note.transcript = el.transcript.value;
  saveNote(note, { relist: true });
});

el.fav.addEventListener('click', () => {
  const note = currentNote();
  if (!note) return;
  note.favorite = !note.favorite;
  el.fav.classList.toggle('is-on', note.favorite);
  saveNote(note, { relist: true });
  toast(note.favorite ? '已加入收藏' : '已取消收藏');
});

el.tagInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const note = currentNote();
  if (!note) return;
  const value = el.tagInput.value.trim().replace(/^#/, '').slice(0, 16);
  el.tagInput.value = '';
  if (!value) return;
  note.tags = note.tags || [];
  if (note.tags.includes(value)) { toast('标签已存在'); return; }
  if (note.tags.length >= 12) { toast('最多 12 个标签', 'err'); return; }
  note.tags.push(value);
  saveNote(note, { relist: true });
  renderTags(note);
});

el.btnCopy.addEventListener('click', async () => {
  const note = currentNote();
  if (!note) return;
  const text = el.transcript.value.trim();
  if (!text) { toast('还没有文字稿可复制'); return; }
  try {
    await navigator.clipboard.writeText(text);
    toast('文字稿已复制', 'ok');
  } catch {
    el.transcript.select();
    document.execCommand('copy');
    toast('文字稿已复制', 'ok');
  }
});

el.btnClearText.addEventListener('click', () => {
  const note = currentNote();
  if (!note || !el.transcript.value.trim()) return;
  if (!window.confirm('确定清空这条笔记的文字稿吗？')) return;
  el.transcript.value = '';
  note.transcript = '';
  updateTranscriptCount();
  saveNote(note, { relist: true });
});

el.btnStamp.addEventListener('click', () => {
  const note = currentNote();
  if (!note) return;
  const stamp = `[${fmtTime(audioEl.currentTime)}] `;
  const start = el.transcript.selectionStart ?? el.transcript.value.length;
  const end = el.transcript.selectionEnd ?? start;
  const value = el.transcript.value;
  el.transcript.value = value.slice(0, start) + stamp + value.slice(end);
  el.transcript.selectionStart = el.transcript.selectionEnd = start + stamp.length;
  el.transcript.focus();
  updateTranscriptCount();
  saveTranscript();
});

el.btnDownload.addEventListener('click', async () => {
  const note = currentNote();
  if (!note) return;
  const blob = await db.getBlob(note.id);
  if (!blob) { toast('音频已丢失，无法下载', 'err'); return; }
  const ext = extForMime(note.mimeType || blob.type);
  downloadBlob(blob, `${safeFilename(note.title)}.${ext}`);
  toast('已开始下载音频', 'ok');
});

el.btnExportNote.addEventListener('click', async () => {
  const note = currentNote();
  if (!note) return;
  await exportNotes([note], settings.backupAudio);
});

el.btnDelete.addEventListener('click', async () => {
  const note = currentNote();
  if (!note) return;
  if (note.deletedAt) {
    if (!window.confirm(`彻底删除「${note.title || '未命名笔记'}」？录音文件也会一并删除，无法恢复。`)) return;
    await db.deleteNote(note.id);
    state.notes = state.notes.filter((n) => n.id !== note.id);
    state.peaksCache.delete(note.id);
    state.currentId = null;
    el.noteView.hidden = true;
    el.detailEmpty.hidden = false;
    el.detail.classList.remove('is-open');
    renderList();
    toast('已彻底删除', 'ok');
    return;
  }
  note.deletedAt = Date.now();
  await saveNote(note);
  state.currentId = null;
  el.noteView.hidden = true;
  el.detailEmpty.hidden = false;
  el.detail.classList.remove('is-open');
  renderList();
  toast('已移入回收站');
});

el.btnRestore.addEventListener('click', async () => {
  const note = currentNote();
  if (!note) return;
  note.deletedAt = null;
  await saveNote(note);
  renderList();
  toast('已恢复到全部笔记', 'ok');
});

el.btnBack.addEventListener('click', () => el.detail.classList.remove('is-open'));

el.btnTheme.addEventListener('click', () => {
  settings.theme = resolvedTheme() === 'dark' ? 'light' : 'dark';
  saveSettings();
  applyTheme();
});

/* ============================================================
   设置面板
   ============================================================ */

function openSheet() {
  el.sheet.hidden = false;
  updateStorageInfo();
}
function closeSheet() { el.sheet.hidden = true; }

$('#btnSettings').addEventListener('click', openSheet);
$$('#sheet [data-close]').forEach((node) => node.addEventListener('click', closeSheet));

$$('#themeSeg button').forEach((btn) => {
  btn.addEventListener('click', () => {
    settings.theme = btn.dataset.theme;
    saveSettings();
    applyTheme();
  });
});

const optAuto = $('#optAutoTranscribe');
const optInterim = $('#optShowInterim');
const optBackupAudio = $('#optBackupAudio');

optAuto.checked = settings.autoTranscribe;
optInterim.checked = settings.showInterim;
optBackupAudio.checked = settings.backupAudio;

optAuto.addEventListener('change', () => { settings.autoTranscribe = optAuto.checked; saveSettings(); });
optInterim.addEventListener('change', () => { settings.showInterim = optInterim.checked; saveSettings(); });
optBackupAudio.addEventListener('change', () => { settings.backupAudio = optBackupAudio.checked; saveSettings(); });

$('#speechSupport').textContent = speechSupportText();

async function updateStorageInfo() {
  const node = $('#storageInfo');
  const estimate = await db.estimate();
  const alive = state.notes.filter((n) => !n.deletedAt);
  const audioBytes = alive.reduce((s, n) => s + (n.size || 0), 0);
  const lines = [`本机已存 ${alive.length} 条笔记，录音约 ${fmtBytes(audioBytes)}。`];
  if (estimate?.usage) {
    lines.push(`浏览器已用存储 ${fmtBytes(estimate.usage)}${estimate.quota ? ` / 可用上限约 ${fmtBytes(estimate.quota)}` : ''}。`);
  }
  lines.push(navigator.storage?.persisted && await navigator.storage.persisted()
    ? '已开启持久化存储，系统清理缓存时不会删除你的录音。'
    : '提示：浏览器在空间紧张时可能清理本地数据，建议定期导出备份。');
  node.innerHTML = lines.join('<br>');
}

/* ============================================================
   导入 / 导出
   ============================================================ */

async function exportNotes(notes, withAudio) {
  if (!notes.length) { toast('没有可导出的笔记'); return; }

  const totalSize = notes.reduce((s, n) => s + (n.size || 0), 0);
  if (withAudio && totalSize > 300 * 1024 * 1024) {
    if (!window.confirm(`包含音频的备份大约 ${fmtBytes(totalSize)}，浏览器可能因内存不足而失败。建议关闭“备份包含音频”后重试。仍要继续吗？`)) return;
  }

  toast(withAudio ? '正在打包，音频较多时请稍候…' : '正在导出…');
  const payload = {
    app: '语音笔记',
    version: 1,
    exportedAt: Date.now(),
    count: notes.length,
    notes: [],
  };

  for (const note of notes) {
    const item = { ...note };
    if (withAudio) {
      const blob = await db.getBlob(note.id).catch(() => null);
      if (blob) {
        item.audio = await blobToDataURL(blob);
        item.mimeType = note.mimeType || blob.type;
      }
    }
    payload.notes.push(item);
  }

  const name = notes.length === 1
    ? `${safeFilename(notes[0].title)}.json`
    : `语音笔记备份-${new Date().toISOString().slice(0, 10)}.json`;

  downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), name);
  toast(`已导出 ${notes.length} 条笔记`, 'ok');
}

$('#btnBackup').addEventListener('click', () => exportNotes(state.notes.filter((n) => !n.deletedAt), settings.backupAudio));
$('#btnRestore').addEventListener('click', () => $('#fileRestore').click());
$('#btnImportAudio').addEventListener('click', () => $('#fileAudio').click());

$('#btnEmptyTrash').addEventListener('click', async () => {
  const trashed = state.notes.filter((n) => n.deletedAt);
  if (!trashed.length) { toast('回收站已经是空的'); return; }
  if (!window.confirm(`清空回收站将彻底删除 ${trashed.length} 条笔记及其录音，无法恢复。继续吗？`)) return;
  const removed = await db.purgeTrash(trashed);
  const ids = new Set(trashed.map((n) => n.id));
  state.notes = state.notes.filter((n) => !ids.has(n.id));
  ids.forEach((id) => state.peaksCache.delete(id));
  if (ids.has(state.currentId)) {
    state.currentId = null;
    el.noteView.hidden = true;
    el.detailEmpty.hidden = false;
  }
  renderList();
  toast(`已清空回收站（${removed} 条）`, 'ok');
});

$('#fileRestore').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;

  try {
    const payload = JSON.parse(await file.text());
    const incoming = Array.isArray(payload) ? payload : payload.notes;
    if (!Array.isArray(incoming) || !incoming.length) throw new Error('文件里没有笔记数据');

    let restored = 0;
    let withAudio = 0;
    for (const raw of incoming) {
      const { audio, ...note } = raw;
      if (!note.id) note.id = uid();
      note.createdAt = note.createdAt || Date.now();
      note.updatedAt = note.updatedAt || note.createdAt;
      note.deletedAt = null;
      note.tags = Array.isArray(note.tags) ? note.tags : [];
      note.peaks = Array.isArray(note.peaks) ? note.peaks : [];

      if (audio) {
        const blob = dataURLToBlob(audio);
        note.mimeType = note.mimeType || blob.type;
        note.size = blob.size;
        await db.putBlob(note.id, blob);
        withAudio++;
        if (!note.peaks.length) {
          const decoded = await decodePeaks(blob, 200);
          if (decoded?.peaks?.length) note.peaks = decoded.peaks;
          if (!note.duration && decoded?.duration) note.duration = decoded.duration;
        }
      }

      await db.putNote(note);
      const index = state.notes.findIndex((n) => n.id === note.id);
      if (index >= 0) state.notes[index] = note; else state.notes.push(note);
      if (note.peaks.length) state.peaksCache.set(note.id, note.peaks);
      restored++;
    }

    state.notes.sort((a, b) => b.createdAt - a.createdAt);
    renderList();
    toast(`已导入 ${restored} 条笔记${withAudio ? `（含 ${withAudio} 段音频）` : ''}`, 'ok', 3200);
  } catch (err) {
    toast('导入失败：' + (err?.message || '文件格式不正确'), 'err', 4200);
  }
});

$('#fileAudio').addEventListener('change', async (event) => {
  const files = Array.from(event.target.files || []);
  event.target.value = '';
  if (!files.length) return;

  toast(`正在导入 ${files.length} 个音频…`);
  let count = 0;
  for (const file of files) {
    const blob = file.slice(0, file.size, file.type || 'audio/webm');
    let duration = await probeDuration(blob);
    const decoded = await decodePeaks(blob, 200);
    let peaks = decoded?.peaks || [];
    if (decoded?.duration) duration = decoded.duration;
    if (!peaks.length) peaks = new Array(48).fill(0.1);

    const now = Date.now();
    const note = {
      id: uid(),
      title: file.name.replace(/\.[^.]+$/, '').slice(0, 40) || '导入的音频',
      transcript: '',
      tags: ['导入'],
      favorite: false,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      duration,
      mimeType: file.type || 'audio/webm',
      size: blob.size,
      peaks,
    };
    await db.putBlob(note.id, blob);
    await db.putNote(note);
    state.notes.unshift(note);
    state.peaksCache.set(note.id, peaks);
    count++;
  }

  renderList();
  toast(`已导入 ${count} 个音频`, 'ok');
});

/* ============================================================
   搜索与筛选
   ============================================================ */

el.search.addEventListener('input', debounce(() => {
  state.query = el.search.value;
  el.clearSearch.hidden = !state.query;
  renderList();
}, 160));

el.clearSearch.addEventListener('click', () => {
  el.search.value = '';
  state.query = '';
  el.clearSearch.hidden = true;
  renderList();
  el.search.focus();
});

el.filters.addEventListener('click', (event) => {
  const chip = event.target.closest('.chip');
  if (!chip) return;
  state.filter = chip.dataset.filter;
  $$('.chip', el.filters).forEach((c) => c.classList.toggle('is-active', c === chip));
  renderList();
});

/* ============================================================
   录音按钮与快捷键
   ============================================================ */

el.btnRecord.addEventListener('click', () => {
  if (recorder) finishRecording(true);
  else startRecording();
});

el.btnStop.addEventListener('click', () => finishRecording(true));
el.btnPause.addEventListener('click', togglePause);

el.btnCancel.addEventListener('click', () => {
  if (!cancelArmed) {
    cancelArmed = true;
    el.btnCancel.textContent = '再点一次放弃';
    setTimeout(() => {
      if (!cancelArmed) return;
      cancelArmed = false;
      el.btnCancel.textContent = '取消';
    }, 3000);
    return;
  }
  cancelArmed = false;
  finishRecording(false);
});

function isTypingTarget(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

document.addEventListener('keydown', (event) => {
  const target = event.target;
  const typing = isTypingTarget(target);
  // 焦点在按钮/链接上时，空格由该控件自己处理，避免和录音开关互相打架
  const onControl = target instanceof Element && !!target.closest('button, a, select, summary');

  if (event.key === 'Escape') {
    if (!el.sheet.hidden) { closeSheet(); return; }
    if (recorder) { finishRecording(true); return; }
    if (el.detail.classList.contains('is-open')) el.detail.classList.remove('is-open');
    return;
  }

  if ((event.ctrlKey || event.metaKey) && (event.key === 'f' || event.key === 'k')) {
    event.preventDefault();
    el.search.focus();
    el.search.select();
    return;
  }

  if (event.code === 'Space' && !typing && !onControl
      && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    if (recorder) finishRecording(true);
    else startRecording();
  }
});

window.addEventListener('beforeunload', (event) => {
  if (!recorder) return;
  event.preventDefault();
  event.returnValue = '正在录音，确定要离开吗？';
});

window.addEventListener('resize', debounce(() => {
  renderListWaves();
  renderDetailWave();
  // 横竖屏切换后提示文案可能要换（触屏 / 键盘）
  if (!recorder) el.dockHint.textContent = dockHintText('idle');
}, 150));

if (window.ResizeObserver) {
  new ResizeObserver(debounce(() => renderDetailWave(), 120)).observe(el.waveWrap);
}

/* ============================================================
   启动
   ============================================================ */

async function boot() {
  applyTheme();

  if (!isRecordingSupported()) {
    toast('当前浏览器不支持录音，请用 Chrome 或 Edge 打开', 'err', 5000);
  }

  try {
    state.notes = await db.allNotes();
  } catch (err) {
    toast('读取本地数据失败：' + (err?.message || ''), 'err', 4200);
    state.notes = [];
  }

  renderList();
  requestPersistence();

  // 安卓封装版里资源是本地 assets，不需要（也无法正常注册）Service Worker
  const isWrappedApp = !!window.VoiceNotesNative;
  if (!isWrappedApp && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* 离线能力不可用不影响使用 */ });
  }
}

boot();
