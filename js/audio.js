// 语音笔记 · 录音引擎
import { clamp } from './utils.js';
import { normalizePeaks } from './wave.js';

export function isRecordingSupported() {
  return !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
}

const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/mpeg',
];

export function pickMimeType() {
  if (!window.MediaRecorder?.isTypeSupported) return '';
  for (const type of MIME_CANDIDATES) {
    try { if (MediaRecorder.isTypeSupported(type)) return type; } catch { /* 忽略 */ }
  }
  return '';
}

const PEAK_INTERVAL = 60;      // 毫秒：每 60ms 采一个峰值
const MAX_LIVE_PEAKS = 4000;   // 超过就做一次降采样，保证内存有界

export class Recorder {
  /**
   * @param {object} handlers { onFrame({timeDomain, elapsed}), onState(state), onError(err) }
   */
  constructor(handlers = {}) {
    this.handlers = handlers;
    this.state = 'idle';        // idle | recording | paused | stopped
    this.livePeaks = [];
    this.elapsed = 0;           // 秒（不含暂停时间）
    this.mimeType = '';

    this._stream = null;
    this._recorder = null;
    this._chunks = [];
    this._audioCtx = null;
    this._analyser = null;
    this._timeData = null;
    this._raf = 0;
    this._ticker = 0;
    this._lastTickAt = 0;
    this._lastPeakAt = 0;
    this._startedAt = 0;
    this._stopResolve = null;
    this._discard = false;
  }

  _setState(state) {
    this.state = state;
    this.handlers.onState?.(state);
  }

  async start() {
    if (this.state === 'recording' || this.state === 'paused') return;

    this._stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
      video: false,
    });

    this.mimeType = pickMimeType();
    const options = { audioBitsPerSecond: 128000 };
    if (this.mimeType) options.mimeType = this.mimeType;

    let recorder;
    try {
      recorder = new MediaRecorder(this._stream, options);
    } catch {
      recorder = new MediaRecorder(this._stream);
    }
    this._recorder = recorder;
    this.mimeType = recorder.mimeType || this.mimeType || 'audio/webm';

    this._chunks = [];
    this.livePeaks = [];
    this.elapsed = 0;
    this._lastTickAt = performance.now();
    this._lastPeakAt = 0;
    this._startedAt = Date.now();
    this._discard = false;

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this._chunks.push(e.data);
    };
    recorder.onerror = (e) => {
      this.handlers.onError?.(e.error || new Error('录音过程出错'));
    };
    recorder.onstop = () => {
      const blob = new Blob(this._chunks, { type: this.mimeType });
      const result = {
        blob,
        mimeType: this.mimeType,
        duration: Math.max(0, this.elapsed),
        startedAt: this._startedAt,
        peaks: normalizePeaks(this.livePeaks),
        discarded: this._discard,
      };
      this._teardown();
      this._setState('stopped');
      this._stopResolve?.(result);
      this._stopResolve = null;
    };

    // 分析节点：只用于取电平与波形，不接到扬声器，避免啸叫
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this._audioCtx = new Ctx();
      if (this._audioCtx.state === 'suspended') await this._audioCtx.resume();
      const source = this._audioCtx.createMediaStreamSource(this._stream);
      this._analyser = this._audioCtx.createAnalyser();
      this._analyser.fftSize = 2048;
      this._analyser.smoothingTimeConstant = 0.55;
      source.connect(this._analyser);
      this._timeData = new Uint8Array(this._analyser.fftSize);
    } catch {
      this._analyser = null;
    }

    recorder.start(1000);   // 每秒切一片，长时间录音更安全
    this._setState('recording');
    this._loop();
    this._ticker = setInterval(() => this._tick(), 200);
    return this;
  }

  _loop() {
    cancelAnimationFrame(this._raf);
    const step = () => {
      if (this.state !== 'recording' && this.state !== 'paused') return;
      this._raf = requestAnimationFrame(step);
      if (!this._analyser) return;

      this._analyser.getByteTimeDomainData(this._timeData);

      if (this.state === 'recording') {
        const now = performance.now();
        if (now - this._lastPeakAt >= PEAK_INTERVAL) {
          this._lastPeakAt = now;
          let peak = 0;
          for (let i = 0; i < this._timeData.length; i += 2) {
            const v = Math.abs(this._timeData[i] - 128) / 128;
            if (v > peak) peak = v;
          }
          this.livePeaks.push(peak);
          if (this.livePeaks.length > MAX_LIVE_PEAKS) {
            const half = [];
            for (let i = 0; i < this.livePeaks.length; i += 2) {
              half.push(Math.max(this.livePeaks[i], this.livePeaks[i + 1] ?? 0));
            }
            this.livePeaks = half;
          }
        }
      }
      this.handlers.onFrame?.({
        timeDomain: this._timeData,
        elapsed: this.elapsed,
        paused: this.state === 'paused',
      });
    };
    this._raf = requestAnimationFrame(step);
  }

  _tick() {
    if (this.state !== 'recording') { this._lastTickAt = performance.now(); return; }
    const now = performance.now();
    this.elapsed += (now - this._lastTickAt) / 1000;
    this._lastTickAt = now;
    this.handlers.onFrame?.({ timeDomain: null, elapsed: this.elapsed, paused: false });
  }

  pause() {
    if (this.state !== 'recording' || !this._recorder) return;
    try { this._recorder.pause(); } catch { /* 忽略 */ }
    this._setState('paused');
  }

  resume() {
    if (this.state !== 'paused' || !this._recorder) return;
    try { this._recorder.resume(); } catch { /* 忽略 */ }
    this._lastTickAt = performance.now();
    this._setState('recording');
  }

  /** 结束录音并拿到音频 */
  stop() {
    if (this.state !== 'recording' && this.state !== 'paused') {
      return Promise.resolve({ blob: new Blob(), mimeType: this.mimeType, duration: 0, peaks: [], discarded: true });
    }
    return new Promise((resolve) => {
      this._stopResolve = resolve;
      this._discard = false;
      try {
        this._recorder.stop();
      } catch {
        resolve({ blob: new Blob(), mimeType: this.mimeType, duration: this.elapsed, peaks: normalizePeaks(this.livePeaks), discarded: true });
      }
    });
  }

  /** 放弃这次录音 */
  cancel() {
    if (this.state !== 'recording' && this.state !== 'paused') return Promise.resolve();
    return new Promise((resolve) => {
      this._stopResolve = () => resolve();
      this._discard = true;
      try { this._recorder.stop(); } catch { this._teardown(); resolve(); }
    });
  }

  _teardown() {
    cancelAnimationFrame(this._raf);
    this._raf = 0;
    clearInterval(this._ticker);
    this._ticker = 0;
    try { this._audioCtx?.close(); } catch { /* 忽略 */ }
    this._audioCtx = null;
    this._analyser = null;
    this._stream?.getTracks().forEach((t) => t.stop());
    this._stream = null;
    this._recorder = null;
  }
}

/* ------------------------------------------------------------------ */
/*  音频分析工具                                                        */
/* ------------------------------------------------------------------ */

function peaksFromChannel(channel, count) {
  const block = Math.max(1, Math.floor(channel.length / count));
  const peaks = new Array(count);
  let top = 0;
  for (let i = 0; i < count; i++) {
    const start = i * block;
    const end = Math.min(channel.length, start + block);
    let max = 0;
    for (let j = start; j < end; j++) {
      const v = channel[j] < 0 ? -channel[j] : channel[j];
      if (v > max) max = v;
    }
    peaks[i] = max;
    if (max > top) top = max;
  }
  const scale = top > 0.01 ? top : 1;
  for (let i = 0; i < count; i++) peaks[i] = clamp(peaks[i] / scale, 0.05, 1);
  return peaks;
}

/** 解码音频并提取峰值（比录音时的实时采样更准） */
export async function decodePeaks(blob, count = 200) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    try {
      const buffer = await blob.arrayBuffer();
      const audio = await new Promise((resolve, reject) => {
        const ret = ctx.decodeAudioData(buffer, resolve, reject);
        if (ret && typeof ret.then === 'function') ret.then(resolve, reject);
      });
      const channel = audio.getChannelData(0);
      return { peaks: peaksFromChannel(channel, count), duration: audio.duration };
    } finally {
      ctx.close();
    }
  } catch {
    return null;
  }
}

/** 不解码、快速探测时长（用于导入的文件） */
export function probeDuration(blob, timeout = 8000) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const audio = document.createElement('audio');
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      audio.removeAttribute('src');
      audio.load();
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = setTimeout(() => finish(0), timeout);
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      const d = audio.duration;
      finish(Number.isFinite(d) && d > 0 ? d : 0);
    };
    audio.onerror = () => finish(0);
    audio.src = url;
  });
}
