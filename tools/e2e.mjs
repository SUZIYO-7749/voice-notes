// 语音笔记 · 端到端测试
// 用无头 Chrome + 假的麦克风设备，把「录音 → 保存 → 播放 → 搜索 → 删除 → 刷新后仍在」整条链路真跑一遍。
// 运行： node tools/e2e.mjs        （需要能启动本机 Chrome）
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const APP = process.env.APP_URL || 'http://127.0.0.1:5173/';
const PORT = 9333;
const PROFILE = 'D:\\语音笔记\\.chrome-e2e';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let child = null;
let ws = null;
let nextId = 1;
const pending = new Map();
const consoleErrors = [];
const results = [];

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? '  → ' + detail : ''}`);
}

function send(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP 超时：${method}`));
    }, 20000);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression, awaitPromise = false) {
  const res = await send('Runtime.evaluate', {
    expression, awaitPromise, returnByValue: true,
  });
  if (res.exceptionDetails) {
    throw new Error('页面内执行出错：' + (res.exceptionDetails.exception?.description || res.exceptionDetails.text));
  }
  return res.result?.value;
}

async function findTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json());
      const page = list.find((t) => t.type === 'page' && t.url.startsWith('http://127.0.0.1:5173'));
      if (page?.webSocketDebuggerUrl) return page;
    } catch { /* Chrome 还没起来 */ }
    await sleep(400);
  }
  throw new Error('等不到 Chrome 的调试目标');
}

function connect(url) {
  return new Promise((resolve, reject) => {
    ws = new WebSocket(url);
    ws.addEventListener('open', () => resolve());
    ws.addEventListener('error', (e) => reject(new Error('WebSocket 连接失败：' + (e.message || ''))));
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve: res, reject: rej, timer } = pending.get(msg.id);
        clearTimeout(timer);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message));
        else res(msg.result);
        return;
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        consoleErrors.push(msg.params.exceptionDetails?.exception?.description
          || msg.params.exceptionDetails?.text || '未知异常');
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
      }
    });
  });
}

async function main() {
  fs.rmSync(PROFILE, { recursive: true, force: true });

  child = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu',
    '--disable-crash-reporter', '--disable-breakpad', '--no-first-run',
    '--no-default-browser-check', `--user-data-dir=${PROFILE}`,
    `--remote-debugging-port=${PORT}`, '--remote-allow-origins=*',
    '--use-fake-ui-for-media-stream',        // 自动同意麦克风权限
    '--use-fake-device-for-media-stream',    // 提供一路假的音频输入
    '--autoplay-policy=no-user-gesture-required',
    '--window-size=1440,900',
    APP,
  ], { stdio: 'ignore' });

  const target = await findTarget();
  await connect(target.webSocketDebuggerUrl);
  await send('Runtime.enable');
  await send('Page.enable');

  // 等待应用启动完成（boot() 会往 #stats 写文字）
  let booted = false;
  for (let i = 0; i < 40; i++) {
    booted = await evaluate(`document.querySelector('#stats')?.textContent?.length > 0`);
    if (booted) break;
    await sleep(250);
  }
  check('应用启动并执行了 JS', booted === true);

  check('无 JS 运行时报错', consoleErrors.length === 0, consoleErrors.join(' | ').slice(0, 300));

  const theme = await evaluate(`document.documentElement.dataset.theme`);
  check('深色主题已写入 <html data-theme>', theme === 'dark', String(theme));

  const iconState = await evaluate(`(() => {
    const sun = getComputedStyle(document.querySelector('.i-sun')).display;
    const moon = getComputedStyle(document.querySelector('.i-moon')).display;
    return sun + '/' + moon;
  })()`);
  check('主题按钮只显示一个图标', iconState === 'block/none', String(iconState));

  const btnH = await evaluate(`document.querySelector('#btnTheme').getBoundingClientRect().height`);
  check('顶部图标按钮高度正常（未因双图标被撑高）', Math.round(btnH) === 40, btnH + 'px');

  check('初始列表为空', (await evaluate(`document.querySelectorAll('.note-item').length`)) === 0);

  const emptyState = await evaluate(`(() => {
    const n = document.querySelector('#listEmpty');
    const r = n.getBoundingClientRect();
    return {
      hidden: n.hidden,
      display: getComputedStyle(n).display,
      w: Math.round(r.width), h: Math.round(r.height),
      listHidden: document.querySelector('#noteList').hidden,
      text: n.textContent.replace(/\\s+/g, ' ').trim().slice(0, 24),
    };
  })()`);
  check('首次启动显示空状态引导且铺满侧栏',
    emptyState.hidden === false && emptyState.h > 300 && emptyState.w > 200,
    JSON.stringify(emptyState));

  /* ---------------- 录音 ---------------- */
  await evaluate(`document.querySelector('#btnRecord').click(); true`);
  await sleep(2600);

  const during = await evaluate(`(() => ({
    overlay: !document.querySelector('#recOverlay').hidden,
    timer: document.querySelector('#recTimer').textContent,
    armed: document.querySelector('#btnRecord').classList.contains('is-armed'),
  }))()`);
  check('录音浮层已弹出', during.overlay === true);
  check('录音计时器在走', /^00:0[12]$/.test(during.timer), during.timer);
  check('录音按钮进入呼吸态', during.armed === true);

  await evaluate(`document.querySelector('#btnStop').click(); true`);
  await sleep(4500);

  /* ---------------- 保存结果 ---------------- */
  const saved = await evaluate(`(() => ({
    count: document.querySelectorAll('.note-item').length,
    title: document.querySelector('.ni-title')?.textContent || '',
    excerpt: document.querySelector('.ni-excerpt')?.textContent || '',
    dur: document.querySelector('.ni-dur')?.textContent || '',
    detailVisible: !document.querySelector('#noteView').hidden,
    meta: document.querySelector('#noteMeta').textContent,
    timeLabel: document.querySelector('#timeLabel').textContent,
    stats: document.querySelector('#stats').textContent,
    dock: document.querySelector('#dockStats').textContent,
    playDisabled: document.querySelector('#btnPlay').disabled,
    overlayClosed: document.querySelector('#recOverlay').hidden,
    wavePainted: (() => {
      const c = document.querySelector('#waveCanvas');
      if (!c || !c.width) return false;
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true;
      return false;
    })(),
  }))()`);

  check('录音保存为一条笔记', saved.count === 1, `count=${saved.count}`);
  check('浮层已关闭', saved.overlayClosed === true);
  check('自动选中并打开详情', saved.detailVisible === true);
  check('笔记标题非空', saved.title.length > 0, saved.title);
  check('记录了时长', /[1-9]/.test(saved.dur), saved.dur);
  check('详情显示元信息', saved.meta.includes('时长'), saved.meta.slice(0, 80));
  check('播放器可用', saved.playDisabled === false);
  check('波形已绘制到画布', saved.wavePainted === true);
  check('侧栏统计已更新', saved.stats.includes('1 条'), saved.stats);
  check('底部统计已更新', saved.dock.includes('共 1 条'), saved.dock);

  /* ---------------- 播放 ---------------- */
  await evaluate(`document.querySelector('#btnPlay').click(); true`);
  await sleep(1400);
  const playing = await evaluate(`(() => ({
    cls: document.querySelector('#player').className,
    t: document.querySelector('#timeLabel').textContent,
  }))()`);
  check('播放器进入播放状态', playing.cls.includes('is-playing'), playing.cls);
  check('播放进度在推进', /^0:0[1-9]|^0:1\d/.test(playing.t), playing.t);
  await evaluate(`document.querySelector('#btnPlay').click(); true`);

  /* ---------------- 波形进度与点击定位（像素级核对） ---------------- */
  await evaluate(`(() => {
    const wrap = document.querySelector('#waveWrap');
    const r = wrap.getBoundingClientRect();
    const opts = {
      bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', isPrimary: true,
      clientX: r.left + r.width * 0.75, clientY: r.top + r.height / 2,
    };
    wrap.dispatchEvent(new PointerEvent('pointerdown', opts));
    wrap.dispatchEvent(new PointerEvent('pointerup', opts));
    return true;
  })()`);
  await sleep(800);

  const waveState = await evaluate(`(() => {
    const c = document.querySelector('#waveCanvas');
    const img = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let maxX = -1;
    for (let x = 0; x < c.width; x++) {
      for (let y = 0; y < c.height; y++) {
        const i = (y * c.width + x) * 4;
        // 高亮色 --wave-active (#8b7cff)：蓝紫色、明显偏蓝
        if (img[i + 3] > 40 && img[i + 2] > 170 && img[i + 2] - img[i] > 40 && img[i] > 80) {
          maxX = x; break;
        }
      }
    }
    return {
      canvasW: c.width,
      ratio: maxX < 0 ? -1 : +(maxX / c.width).toFixed(3),
      label: document.querySelector('#timeLabel').textContent,
    };
  })()`);
  check('点击波形能定位播放头（画布高亮位置与点击比例一致）',
    Math.abs(waveState.ratio - 0.75) <= 0.1,
    `高亮延伸到 ${waveState.ratio}（画布宽 ${waveState.canvasW}px），期望 ≈0.75；时间标签 ${waveState.label}`);

  /* ---------------- 编辑 ---------------- */
  await evaluate(`(() => {
    const t = document.querySelector('#noteTranscript');
    t.value = '这是一条端到端测试写入的文字稿';
    t.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await sleep(900);
  const edited = await evaluate(`(() => ({
    count: document.querySelector('#transcriptCount').textContent,
    excerpt: document.querySelector('.ni-excerpt').textContent,
  }))()`);
  check('文字稿字数统计更新', edited.count.includes('字'), edited.count);
  check('列表摘要同步更新', edited.excerpt.includes('端到端'), edited.excerpt);

  /* ---------------- 标签与收藏 ---------------- */
  await evaluate(`(() => {
    const i = document.querySelector('#tagInput');
    i.value = '会议';
    i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return true;
  })()`);
  await sleep(600);
  const tagged = await evaluate(`(() => ({
    tags: [...document.querySelectorAll('#tagList .tag')].map((t) => t.textContent.replace('✕', '').trim()),
    listTags: [...document.querySelectorAll('.note-item .ni-tag')].map((t) => t.textContent),
  }))()`);
  check('能添加标签', tagged.tags.includes('会议'), JSON.stringify(tagged.tags));
  check('列表卡片同步显示标签', tagged.listTags.includes('会议'), JSON.stringify(tagged.listTags));

  await evaluate(`document.querySelector('#btnFav').click(); true`);
  await sleep(600);
  check('收藏状态生效', (await evaluate(`document.querySelector('#btnFav').classList.contains('is-on')`)) === true);

  // 存一张「已有笔记」状态的截图，便于人工核对排版
  try {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('D:\\语音笔记\\.verify-note.png', Buffer.from(shot.data, 'base64'));
    console.log('  · 已保存有笔记状态的截图 → .verify-note.png');
  } catch (err) {
    console.log('  · 截图失败：' + err.message);
  }

  /* ---------------- 搜索 ---------------- */
  await evaluate(`(() => {
    const s = document.querySelector('#searchInput');
    s.value = '不存在的关键词';
    s.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await sleep(400);
  const searched = await evaluate(`(() => ({
    count: document.querySelectorAll('.note-item').length,
    empty: !document.querySelector('#listEmpty').hidden,
  }))()`);
  check('搜索能过滤掉不匹配的笔记', searched.count === 0 && searched.empty === true);

  await evaluate(`(() => {
    const s = document.querySelector('#searchInput');
    s.value = '端到端';
    s.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await sleep(400);
  check('搜索能命中文字稿内容', (await evaluate(`document.querySelectorAll('.note-item').length`)) === 1);

  await evaluate(`document.querySelector('#btnClearSearch').click(); true`);
  await sleep(300);

  /* ---------------- 刷新后仍在（IndexedDB 持久化） ---------------- */
  await send('Page.reload');
  await sleep(2500);
  let persisted = 0;
  for (let i = 0; i < 20; i++) {
    persisted = await evaluate(`document.querySelectorAll('.note-item').length`).catch(() => 0);
    if (persisted > 0) break;
    await sleep(300);
  }
  check('刷新后笔记仍在（IndexedDB 持久化生效）', persisted === 1, `count=${persisted}`);

  /* ---------------- 删除到回收站 ---------------- */
  await evaluate(`document.querySelector('.note-item').click(); true`);
  await sleep(600);
  await evaluate(`document.querySelector('#btnDelete').click(); true`);
  await sleep(600);
  const trashed = await evaluate(`(() => ({
    listCount: document.querySelectorAll('.note-item').length,
    stats: document.querySelector('#stats').textContent,
  }))()`);
  check('删除后列表清空', trashed.listCount === 0);
  check('统计里显示回收站条目', /回收站.*1/.test(trashed.stats), trashed.stats);

  await evaluate(`document.querySelector('[data-filter="trash"]').click(); true`);
  await sleep(400);
  check('回收站筛选能列出笔记',
    (await evaluate(`document.querySelectorAll('.note-item').length`)) === 1);

  // 必须先选中，详情面板里才会出现「恢复」按钮
  await evaluate(`document.querySelector('.note-item').click(); true`);
  await sleep(600);
  const inTrash = await evaluate(`(() => ({
    restoreHidden: document.querySelector('#btnRestore').hidden,
    title: document.querySelector('#noteTitle').value,
    deleteLabel: document.querySelector('#btnDelete').textContent,
  }))()`);
  check('回收站中显示「恢复」按钮', inTrash.restoreHidden === false);
  check('回收站中删除按钮变为彻底删除', inTrash.deleteLabel.includes('彻底'), inTrash.deleteLabel);

  await evaluate(`document.querySelector('#btnRestore').click(); true`);
  await sleep(500);
  await evaluate(`document.querySelector('[data-filter="all"]').click(); true`);
  await sleep(400);
  check('恢复后回到全部列表', (await evaluate(`document.querySelectorAll('.note-item').length`)) === 1);

  check('全程无未捕获异常', consoleErrors.length === 0, consoleErrors.join(' | ').slice(0, 300));
}

const globalTimer = setTimeout(() => {
  console.error('\n端到端测试超时（90 秒），强制结束。');
  process.exitCode = 1;
  cleanup();
}, 90000);

function cleanup() {
  try { ws?.close(); } catch { /* 忽略 */ }
  try { child?.kill(); } catch { /* 忽略 */ }
}

try {
  console.log('开始端到端测试…\n');
  await main();
} catch (err) {
  console.error('\n测试中断：', err.message);
  process.exitCode = 1;
} finally {
  clearTimeout(globalTimer);
  cleanup();
  await sleep(600);
  fs.rmSync(PROFILE, { recursive: true, force: true });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n结果：${results.length - failed.length}/${results.length} 项通过。`);
  if (failed.length) {
    console.log('失败项：' + failed.map((f) => f.name).join('、'));
    process.exitCode = 1;
  }
  if (consoleErrors.length) {
    console.log('\n页面控制台错误：');
    consoleErrors.forEach((e) => console.log('  - ' + e));
  }
}
