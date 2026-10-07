// 语音笔记 · 语音转文字（Web Speech API）
// 说明：Chrome / Edge 支持得最好；Safari 需要用户手势触发且连续识别能力较弱。
// 识别不可用时应用仍然可以正常录音，只是没有自动文字稿。

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const SUPPORTED = !!SR;

export function isSpeechSupported() {
  return SUPPORTED;
}

export function speechSupportText() {
  if (SUPPORTED) return '当前浏览器支持实时语音转写（推荐 Chrome / Edge，识别过程需要联网）。';
  return '当前环境不支持实时语音转写，录音功能完全不受影响，文字稿可以在这里手动输入。'
    + '想用自动转写，可以用手机 Chrome 打开同一个应用。';
}

export class Transcriber {
  /**
   * @param {object} handlers { onText({final, interim}), onError(message), onState(bool) }
   */
  constructor(handlers = {}) {
    this.handlers = handlers;
    this.lang = 'zh-CN';
    this.finalText = '';
    this.interimText = '';
    this.active = false;       // 用户希望持续识别
    this.listening = false;    // 引擎当前是否在跑
    this.lastError = '';
    this._recognition = null;
    this._restartTimer = 0;
    this._enabled = true;
  }

  get supported() { return SUPPORTED; }

  _create() {
    const rec = new SR();
    rec.lang = this.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? '';
        if (result.isFinal) {
          this.finalText += text;
        } else {
          interim += text;
        }
      }
      this.interimText = interim;
      this.handlers.onText?.({ final: this.finalText, interim: this.interimText });
    };

    rec.onerror = (event) => {
      const code = event.error || 'unknown';
      this.lastError = code;
      if (code === 'no-speech' || code === 'aborted') return;   // 正常现象，交给 onend 重启
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        this.active = false;
        this._enabled = false;
        this.handlers.onError?.('麦克风或语音识别权限被拒绝，已停止转写。');
        return;
      }
      if (code === 'network') {
        this.handlers.onError?.('语音识别服务连不上网络，转写已暂停。');
        return;
      }
      if (code === 'audio-capture') {
        this.handlers.onError?.('没有找到可用的麦克风。');
        this.active = false;
      }
    };

    rec.onend = () => {
      this.listening = false;
      this.handlers.onState?.(false);
      // Chrome 会在静音一段时间后自动结束，这里自动续上
      if (this.active) {
        clearTimeout(this._restartTimer);
        this._restartTimer = setTimeout(() => this._startEngine(), 260);
      }
    };

    rec.onstart = () => {
      this.listening = true;
      this.handlers.onState?.(true);
    };

    return rec;
  }

  _startEngine() {
    if (!this.active || !this._enabled || this.listening) return;
    try {
      if (!this._recognition) this._recognition = this._create();
      this._recognition.start();
    } catch {
      // 引擎已经处于启动状态时会抛错，稍后重试即可
      clearTimeout(this._restartTimer);
      this._restartTimer = setTimeout(() => this._startEngine(), 500);
    }
  }

  start() {
    if (!SUPPORTED) return false;
    this.active = true;
    this._enabled = true;
    this.finalText = '';
    this.interimText = '';
    this._startEngine();
    return true;
  }

  /** 录音暂停时同时暂停识别，避免把暂停期间的声音也转进去 */
  suspend() {
    this._enabled = false;
    clearTimeout(this._restartTimer);
    if (this._recognition && this.listening) {
      try { this._recognition.stop(); } catch { /* 忽略 */ }
    }
  }

  resume() {
    if (!SUPPORTED || !this.active) return;
    this._enabled = true;
    this._startEngine();
  }

  stop() {
    this.active = false;
    this._enabled = false;
    clearTimeout(this._restartTimer);
    if (this._recognition) {
      try { this._recognition.stop(); } catch { /* 忽略 */ }
    }
    this.listening = false;
    return { final: this.finalText, interim: this.interimText };
  }

  dispose() {
    this.stop();
    if (this._recognition) {
      try { this._recognition.abort(); } catch { /* 忽略 */ }
      this._recognition = null;
    }
  }
}
