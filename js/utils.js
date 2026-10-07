// 语音笔记 · 通用工具

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function uid() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return 'n-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

/** 0:07 / 3:42 / 1:02:03 */
export function fmtTime(sec) {
  const n = Number(sec);
  sec = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return (h ? h + ':' : '') + mm + ':' + String(s).padStart(2, '0');
}

/** 录音计时器样式：00:12 / 01:02:03 */
export function fmtClock(sec) {
  const n = Number(sec);
  sec = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const parts = [String(m).padStart(2, '0'), String(s).padStart(2, '0')];
  if (h) parts.unshift(String(h).padStart(2, '0'));
  return parts.join(':');
}

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** 今天 14:30 / 昨天 09:12 / 3月5日 20:01 / 2024年3月5日 */
export function fmtDate(ts) {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');

  if (sameDay(d, now)) return '今天 ' + hm;

  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  if (sameDay(d, yest)) return '昨天 ' + hm;

  const diffDays = (now - d) / 86400000;
  if (diffDays >= 0 && diffDays < 7) return WEEK[d.getDay()] + ' ' + hm;

  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

export function fmtBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function debounce(fn, wait = 180) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

const MIME_EXT = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/aac': 'aac',
  'audio/flac': 'flac',
};

export function extForMime(mime) {
  const base = String(mime || '').split(';')[0].trim().toLowerCase();
  if (MIME_EXT[base]) return MIME_EXT[base];
  if (base.startsWith('audio/')) return base.slice(6).replace(/[^a-z0-9]/g, '') || 'webm';
  if (base.startsWith('video/')) return base.slice(6).replace(/[^a-z0-9]/g, '') || 'webm';
  return 'webm';
}

/** 把文件名里不能用的字符换掉 */
export function safeFilename(name) {
  return String(name || '语音笔记')
    .replace(/[\\/:*?"<>|\r\n\t]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60) || '语音笔记';
}

export function downloadBlob(blob, filename) {
  // 安卓封装版：WebView 不支持 <a download> 配 blob: URL，必须交给原生写文件
  const bridge = window.VoiceNotesNative;
  if (bridge && typeof bridge.saveBase64File === 'function') {
    blob.arrayBuffer()
      .then((buffer) => {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        const CHUNK = 0x8000;   // 分块拼字符串，避免超长参数把调用栈撑爆
        for (let i = 0; i < bytes.length; i += CHUNK) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
        }
        bridge.saveBase64File(filename, btoa(binary), blob.type || 'application/octet-stream');
      })
      .catch(() => toast('导出失败：文件过大或内存不足', 'err'));
    return;
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

let toastSeq = 0;
export function toast(message, type = '', ms = 2400) {
  const wrap = $('#toasts');
  if (!wrap) return;
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' ' + type : '');
  el.textContent = message;
  el.dataset.id = String(++toastSeq);
  wrap.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 260);
  }, ms);
}

/** async 包装：等待某个事件触发一次 */
export function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

export function dataURLToBlob(dataURL) {
  const [head, body] = String(dataURL).split(',');
  const mime = (head.match(/data:([^;]+)/) || [, 'application/octet-stream'])[1];
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function nextRate(current) {
  const rates = [1, 1.25, 1.5, 1.75, 2, 0.75];
  const i = rates.indexOf(current);
  return rates[(i + 1) % rates.length];
}
