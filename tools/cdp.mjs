// 无头 Chrome + CDP 的最小封装，供 e2e / mobile 测试复用。
import { spawn } from 'node:child_process';
import fs from 'node:fs';

export const CHROME = process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

/** 启动一个无头 Chrome。用 about:blank 打开，方便先设置设备模拟再导航。 */
export function launchChrome({ port, profile, url = 'about:blank' }) {
  fs.rmSync(profile, { recursive: true, force: true });
  return spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu',
    '--disable-crash-reporter', '--disable-breakpad',
    '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`, '--remote-allow-origins=*',
    '--use-fake-ui-for-media-stream',       // 自动同意麦克风权限
    '--use-fake-device-for-media-stream',   // 提供一路假的音频输入
    '--autoplay-policy=no-user-gesture-required',
    url,
  ], { stdio: 'ignore' });
}

export class Session {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.errors = [];
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.addEventListener('open', () => resolve(this));
      this.ws.addEventListener('error', (e) => reject(new Error('WebSocket 连接失败：' + (e.message || ''))));
      this.ws.addEventListener('message', (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve: res, reject: rej, timer } = this.pending.get(msg.id);
          clearTimeout(timer);
          this.pending.delete(msg.id);
          if (msg.error) rej(new Error(msg.error.message));
          else res(msg.result);
          return;
        }
        if (msg.method === 'Runtime.exceptionThrown') {
          this.errors.push(msg.params.exceptionDetails?.exception?.description
            || msg.params.exceptionDetails?.text || '未知异常');
        }
        if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
          this.errors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
        }
      });
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP 超时：${method}`));
      }, 20000);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression, awaitPromise = false) {
    const res = await this.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
    if (res.exceptionDetails) {
      throw new Error('页面内执行出错：'
        + (res.exceptionDetails.exception?.description || res.exceptionDetails.text));
    }
    return res.result?.value;
  }

  /** 在屏幕坐标派发一次真实触摸点击 */
  async tapPoint(x, y) {
    await this.send('Input.dispatchTouchEvent', {
      type: 'touchStart', touchPoints: [{ x: Math.round(x), y: Math.round(y) }],
    });
    await sleep(70);
    await this.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }

  /** 在元素中心派发一次真实触摸点击 */
  async tap(selector) {
    const box = await this.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`);
    if (!box) throw new Error('找不到元素：' + selector);
    await this.tapPoint(box.x, box.y);
    return box;
  }

  async screenshot(file) {
    const shot = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
    return file;
  }

  async waitFor(expression, { tries = 40, gap = 250 } = {}) {
    for (let i = 0; i < tries; i++) {
      const ok = await this.evaluate(expression).catch(() => false);
      if (ok) return true;
      await sleep(gap);
    }
    return false;
  }

  close() {
    try { this.ws?.close(); } catch { /* 忽略 */ }
  }
}

/** 轮询 /json/list，拿到页面目标并建立会话 */
export async function openSession({ port, urlPrefix }) {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
      const page = list.find((t) => t.type === 'page' && (t.url.startsWith(urlPrefix) || t.url === 'about:blank'));
      if (page?.webSocketDebuggerUrl) {
        const session = new Session(page.webSocketDebuggerUrl);
        await session.connect();
        await session.send('Runtime.enable');
        await session.send('Page.enable');
        return session;
      }
    } catch { /* Chrome 还没起来 */ }
    await sleep(400);
  }
  throw new Error('等不到 Chrome 的调试目标');
}
