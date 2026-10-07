// 语音笔记 · 手机端（安卓）端到端测试
// 用无头 Chrome 模拟 Pixel 尺寸 + 触摸 + 安卓 UA + 假麦克风，
// 检查移动端布局、安全区、底部抽屉，并用真实触摸事件跑通录音流程。
// 运行： node tools/mobile.mjs      （需要先启动 server.mjs）
import fs from 'node:fs';
import path from 'node:path';
import { launchChrome, openSession, sleep, ANDROID_UA } from './cdp.mjs';

const APP = process.env.APP_URL || 'http://127.0.0.1:5173/';
const PORT = 9334;
const PROFILE = 'D:\\语音笔记\\.chrome-mobile';
const SHOT_DIR = 'D:\\语音笔记\\.mobile-shots';

const W = 412;    // Pixel 8 逻辑分辨率
const H = 915;

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? '  → ' + detail : ''}`);
}

let child = null;
let session = null;

/* ---------------- 诊断小工具 ---------------- */

async function gUMProbe() {
  return session.evaluate(`(async () => {
    if (!navigator.mediaDevices?.getUserMedia) return 'API 不存在';
    const timeout = new Promise((r) => setTimeout(() => r('超时未返回（权限弹窗可能挂着）'), 6000));
    const attempt = navigator.mediaDevices.getUserMedia({ audio: true })
      .then((s) => { s.getTracks().forEach((t) => t.stop()); return 'ok'; })
      .catch((e) => 'ERR ' + e.name + ': ' + e.message);
    return Promise.race([attempt, timeout]);
  })()`, true);
}

const toastText = () => session.evaluate(
  `[...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | ')`);

/* ---------------- 主流程 ---------------- */

async function main() {
  fs.rmSync(SHOT_DIR, { recursive: true, force: true });
  fs.mkdirSync(SHOT_DIR, { recursive: true });

  child = launchChrome({ port: PORT, profile: PROFILE });   // 先开 about:blank
  session = await openSession({ port: PORT, urlPrefix: APP });

  // 必须在导航之前设置好设备模拟，媒体查询和视口才会按手机生效
  await session.send('Emulation.setDeviceMetricsOverride', {
    width: W, height: H, deviceScaleFactor: 2.625, mobile: true,
  });
  await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await session.send('Emulation.setUserAgentOverride', { userAgent: ANDROID_UA });

  // 显式授予麦克风权限，不依赖 --use-fake-ui-for-media-stream 的隐式放行
  let granted = 'ok';
  try {
    await session.send('Browser.grantPermissions', {
      origin: new URL(APP).origin, permissions: ['audioCapture'],
    });
  } catch (err) {
    granted = err.message;
  }

  await session.send('Page.navigate', { url: APP });
  const booted = await session.waitFor(`document.querySelector('#stats')?.textContent?.length > 0`);
  check('手机端应用启动成功', booted === true);
  check('无 JS 运行时报错', session.errors.length === 0, session.errors.join(' | ').slice(0, 200));

  /* ---------------- 视口与基础能力 ---------------- */
  const vp = await session.evaluate(`({
    w: innerWidth, h: innerHeight, dpr: devicePixelRatio,
    touch: 'ontouchstart' in window,
    ua: navigator.userAgent.includes('Android'),
    secure: window.isSecureContext,
    mediaDevices: !!navigator.mediaDevices,
  })`);
  check('视口为手机尺寸', vp.w === W && vp.h === H, `${vp.w}x${vp.h} dpr=${vp.dpr}`);
  check('触摸事件可用', vp.touch === true);
  check('按安卓 UA 渲染', vp.ua === true);
  check('安全上下文（安卓上 http 页面拿不到麦克风，这里必须为 true）',
    vp.secure === true && vp.mediaDevices === true, JSON.stringify({ secure: vp.secure, md: vp.mediaDevices }));

  const gUM = await gUMProbe();
  check('麦克风可获取', gUM === 'ok', `权限授予=${granted}；getUserMedia=${gUM}`);

  const overflow = await session.evaluate(`({
    scrollW: document.documentElement.scrollWidth,
    innerW: innerWidth,
    bodyScrollW: document.body.scrollWidth,
  })`);
  check('没有横向溢出（不会左右滚动）',
    overflow.scrollW <= overflow.innerW + 1 && overflow.bodyScrollW <= overflow.innerW + 1,
    JSON.stringify(overflow));

  /* ---------------- 触控目标尺寸（只看可见元素） ---------------- */
  const sizes = await session.evaluate(`(() => {
    const box = (e) => { const b = e.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height) }; };
    const visible = (e) => e.offsetParent !== null || e.getClientRects().length > 0;
    const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = box(e); return b; };
    return {
      record: r('#btnRecord'),
      icons: [...document.querySelectorAll('.icon-btn')].filter(visible).map((e) => box(e).h),
      chips: [...document.querySelectorAll('.chip')].filter(visible).map((e) => box(e).h),
    };
  })()`);
  check('录音主按钮足够大', sizes.record.w >= 60 && sizes.record.h >= 60, JSON.stringify(sizes.record));
  check('可见的顶部图标按钮 ≥44px', sizes.icons.length >= 2 && sizes.icons.every((h) => h >= 44),
    sizes.icons.join('/'));
  check('筛选按钮高度够点', sizes.chips.every((h) => h >= 30), sizes.chips.join('/'));

  /* ---------------- 布局形态 ---------------- */
  const layout = await session.evaluate(`(() => {
    const cols = getComputedStyle(document.querySelector('.layout')).gridTemplateColumns.split(' ').length;
    const back = getComputedStyle(document.querySelector('#btnBack')).display;
    const dock = document.querySelector('.dock').getBoundingClientRect();
    const detail = document.querySelector('#detail').getBoundingClientRect();
    return {
      cols, back,
      dockBottom: Math.round(dock.bottom), dockH: Math.round(dock.height),
      detailLeft: Math.round(detail.left), innerW: innerWidth, innerH: innerHeight,
    };
  })()`);
  check('列表与详情改为单列', layout.cols === 1, `列数=${layout.cols}`);
  check('手机上显示返回按钮', layout.back !== 'none', layout.back);
  check('底部录音条贴合屏幕底边', layout.dockBottom <= layout.innerH + 1,
    `dockBottom=${layout.dockBottom} innerH=${layout.innerH}`);
  check('详情面板默认在屏幕外（等触摸滑入）', layout.detailLeft >= layout.innerW - 1,
    `detailLeft=${layout.detailLeft}`);

  await session.screenshot(path.join(SHOT_DIR, '01-空列表.png'));

  /* ---------------- 用触摸录音（先于任何面板，排除干扰） ---------------- */
  await session.tap('#btnRecord');
  await sleep(2600);

  const rec = await session.evaluate(`(() => {
    const p = document.querySelector('.rec-panel').getBoundingClientRect();
    const c = document.querySelector('#recCanvas');
    return {
      overlay: !document.querySelector('#recOverlay').hidden,
      timer: document.querySelector('#recTimer').textContent,
      panelBottom: Math.round(p.bottom), panelTop: Math.round(p.top), innerH: innerHeight,
      canvasPainted: (() => {
        if (!c.width) return false;
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true;
        return false;
      })(),
      btnHeights: [...document.querySelectorAll('.rec-controls .btn')]
        .map((b) => Math.round(b.getBoundingClientRect().height)),
    };
  })()`);
  const recToasts = await toastText();
  check('触摸录音按钮能开始录音', rec.overlay === true,
    rec.overlay ? '' : `浮层未出现；页面提示：${recToasts || '（无）'}`);
  if (rec.overlay) {
    check('录音计时器在走', /^00:0[1-9]$/.test(rec.timer), rec.timer);
    check('实时波形已绘制', rec.canvasPainted === true);
    check('录音浮层完整落在屏幕内', rec.panelTop >= 0 && rec.panelBottom <= rec.innerH + 1,
      JSON.stringify({ top: rec.panelTop, bottom: rec.panelBottom, innerH: rec.innerH }));
    check('录音操作按钮够大（方便拇指点）', rec.btnHeights.every((h) => h >= 44), rec.btnHeights.join('/'));
    await session.screenshot(path.join(SHOT_DIR, '03-录音中.png'));

    await session.tap('#btnStop');
    await sleep(4500);

    const saved = await session.evaluate(`(() => ({
      count: document.querySelectorAll('.note-item').length,
      overlayClosed: document.querySelector('#recOverlay').hidden,
      dur: document.querySelector('.ni-dur')?.textContent || '',
      stats: document.querySelector('#stats').textContent,
    }))()`);
    check('录音保存成功', saved.count === 1, `count=${saved.count}`);
    check('录音浮层已收起', saved.overlayClosed === true);
    check('时长已记录', /[1-9]/.test(saved.dur), saved.dur);
    await session.screenshot(path.join(SHOT_DIR, '04-列表有笔记.png'));
  }

  /* ---------------- 触摸进入详情 ---------------- */
  const hasNote = (await session.evaluate(`document.querySelectorAll('.note-item').length`)) > 0;
  if (hasNote) {
    await session.tap('.note-item');
    await sleep(900);
    const detail = await session.evaluate(`(() => {
      const d = document.querySelector('#detail');
      const r = d.getBoundingClientRect();
      const player = document.querySelector('.player').getBoundingClientRect();
      return {
        left: Math.round(r.left),
        open: d.classList.contains('is-open'),
        playerRight: Math.round(player.right), innerW: innerWidth,
        waveH: Math.round(document.querySelector('#waveWrap').getBoundingClientRect().height),
      };
    })()`);
    check('触摸列表项能打开详情', detail.open === true && detail.left === 0, JSON.stringify(detail));
    check('播放器未溢出屏幕', detail.playerRight <= detail.innerW + 1,
      `right=${detail.playerRight} innerW=${detail.innerW}`);
    check('波形区高度合适', detail.waveH >= 40, detail.waveH + 'px');
    await session.screenshot(path.join(SHOT_DIR, '05-详情.png'));

    /* 波形进度像素断言（手机 dpr 下同样成立） */
    await session.evaluate(`(() => {
      const wrap = document.querySelector('#waveWrap');
      const r = wrap.getBoundingClientRect();
      const opts = { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch',
        isPrimary: true, clientX: r.left + r.width * 0.75, clientY: r.top + r.height / 2 };
      wrap.dispatchEvent(new PointerEvent('pointerdown', opts));
      wrap.dispatchEvent(new PointerEvent('pointerup', opts));
      return true;
    })()`);
    await sleep(800);
    const wave = await session.evaluate(`(() => {
      const c = document.querySelector('#waveCanvas');
      const img = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let maxX = -1;
      for (let x = 0; x < c.width; x++) {
        for (let y = 0; y < c.height; y++) {
          const i = (y * c.width + x) * 4;
          if (img[i + 3] > 40 && img[i + 2] > 170 && img[i + 2] - img[i] > 40 && img[i] > 80) { maxX = x; break; }
        }
      }
      return { w: c.width, ratio: maxX < 0 ? -1 : +(maxX / c.width).toFixed(3),
        label: document.querySelector('#timeLabel').textContent };
    })()`);
    check('点击波形定位播放头，高亮位置与点击比例一致',
      Math.abs(wave.ratio - 0.75) <= 0.1,
      `高亮延伸至 ${wave.ratio}（画布宽 ${wave.w}px），期望 ≈0.75；时间标签 ${wave.label}`);

    /* 返回按钮 */
    await session.tap('#btnBack');
    await sleep(700);
    const back = await session.evaluate(`(() => {
      const r = document.querySelector('#detail').getBoundingClientRect();
      return { left: Math.round(r.left), innerW: innerWidth };
    })()`);
    check('返回按钮能退回列表', back.left >= back.innerW - 1, JSON.stringify(back));
  } else {
    check('（跳过详情相关检查：没有可用笔记）', false, '录音未成功');
  }

  /* ---------------- 设置面板 = 底部抽屉 ---------------- */
  await session.tap('#btnSettings');
  await sleep(600);
  const sheet = await session.evaluate(`(() => {
    const p = document.querySelector('.sheet-panel');
    const r = p.getBoundingClientRect();
    const cs = getComputedStyle(p);
    return {
      open: !document.querySelector('#sheet').hidden,
      w: Math.round(r.width), bottom: Math.round(r.bottom),
      innerW: innerWidth, innerH: innerHeight,
      radiusTop: cs.borderTopLeftRadius,
      switches: [...document.querySelectorAll('.switch')].filter((e) => e.getClientRects().length)
        .map((e) => Math.round(e.getBoundingClientRect().height)),
    };
  })()`);
  check('设置面板已打开', sheet.open === true);
  check('设置面板为整宽底部抽屉',
    Math.round(sheet.w) >= sheet.innerW - 1 && sheet.bottom <= sheet.innerH + 1
      && parseFloat(sheet.radiusTop) > 10,
    JSON.stringify({ w: sheet.w, bottom: sheet.bottom, radiusTop: sheet.radiusTop }));
  check('开关行高度够点', sheet.switches.every((h) => h >= 40), sheet.switches.join('/'));
  await session.screenshot(path.join(SHOT_DIR, '02-设置抽屉.png'));

  // 关闭方式一：标题栏的 ✕
  await session.tap('#sheet .sheet-head .icon-btn');
  await sleep(500);
  check('✕ 按钮能关闭设置面板',
    (await session.evaluate(`document.querySelector('#sheet').hidden`)) === true);

  // 关闭方式二：点面板上方露出的遮罩（手机上面板占满宽度，只有顶部一条）
  await session.tap('#btnSettings');
  await sleep(600);
  const strip = await session.evaluate(`(() => {
    const p = document.querySelector('.sheet-panel').getBoundingClientRect();
    return { top: Math.round(p.top), w: Math.round(innerWidth) };
  })()`);
  check('底部抽屉上方留出了可点击的遮罩区域', strip.top >= 12, `面板顶部 y=${strip.top}`);
  await session.tapPoint(strip.w / 2, Math.max(8, strip.top / 2));
  await sleep(500);
  check('点遮罩也能关闭设置面板',
    (await session.evaluate(`document.querySelector('#sheet').hidden`)) === true);

  check('全程无未捕获异常', session.errors.length === 0, session.errors.join(' | ').slice(0, 300));
}

const guard = setTimeout(() => {
  console.error('\n移动端测试超时，强制结束。');
  process.exitCode = 1;
  cleanup();
}, 150000);

function cleanup() {
  session?.close();
  try { child?.kill(); } catch { /* 忽略 */ }
}

try {
  console.log('开始手机端（安卓）端到端测试…\n');
  await main();
} catch (err) {
  console.error('\n测试中断：', err.message);
  process.exitCode = 1;
} finally {
  clearTimeout(guard);
  if (session?.errors?.length) {
    console.log('\n页面控制台错误：');
    session.errors.forEach((e) => console.log('  - ' + e));
  }
  cleanup();
  await sleep(600);
  fs.rmSync(PROFILE, { recursive: true, force: true });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n结果：${results.length - failed.length}/${results.length} 项通过。`);
  if (failed.length) {
    console.log('失败项：' + failed.map((f) => f.name).join('、'));
    process.exitCode = 1;
  }
  console.log(`截图目录：${SHOT_DIR}`);
}
