// 语音笔记 · 波形绘制（列表迷你波形 + 详情可点击波形 + 录音实时波形）

const dpr = () => Math.min(window.devicePixelRatio || 1, 2.5);

function fit(canvas) {
  const ratio = dpr();
  const w = Math.max(1, Math.round(canvas.clientWidth * ratio));
  const h = Math.max(1, Math.round(canvas.clientHeight * ratio));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

function cssVar(el, name, fallback) {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v || fallback;
}

/** 把任意长度的峰值数组重采样成 count 个点 */
export function resample(peaks, count) {
  const src = Array.isArray(peaks) ? peaks : [];
  if (!src.length) return new Array(count).fill(0);
  if (src.length === count) return src.slice();
  const out = new Array(count);
  const block = src.length / count;
  for (let i = 0; i < count; i++) {
    const start = Math.floor(i * block);
    const end = Math.max(start + 1, Math.floor((i + 1) * block));
    let max = 0;
    for (let j = start; j < end && j < src.length; j++) if (src[j] > max) max = src[j];
    out[i] = max;
  }
  return out;
}

/**
 * 画一条静态波形。
 * @param {HTMLCanvasElement} canvas
 * @param {object} opts { peaks, progress(0~1), dim }
 */
export function drawWave(canvas, opts = {}) {
  if (!canvas) return;
  const { peaks = [], progress = 0, minBar = 2 } = opts;
  const { ctx, w, h } = fit(canvas);
  const ratio = dpr();

  const idle = cssVar(canvas, '--wave-idle', cssVar(canvas, '--surface-3', '#2a3140'));
  const active = cssVar(canvas, '--wave-active', cssVar(canvas, '--accent', '#7c6cff'));

  const gap = Math.max(1, Math.round(ratio));
  const barW = Math.max(1.4 * ratio, (w - gap * 1) / Math.max(peaks.length, 1) - gap);
  const totalW = peaks.length * (barW + gap) - gap;
  const offsetX = Math.max(0, (w - totalW) / 2);
  const mid = h / 2;
  const cut = w * progress;

  ctx.fillStyle = idle;
  for (let i = 0; i < peaks.length; i++) {
    const x = offsetX + i * (barW + gap);
    const amp = Math.max(minBar * ratio, peaks[i] * (h * 0.92));
    const y = mid - amp / 2;
    // 每条柱子单独取色，否则越过播放头之后会一直沿用高亮色
    ctx.fillStyle = (x + barW <= cut) ? active : idle;
    ctx.fillRect(x, y, barW, amp);
  }

  // 播放头
  if (progress > 0 && progress < 1) {
    ctx.fillStyle = active;
    ctx.fillRect(cut - 1 * ratio, 0, 2 * ratio, h);
  }
}

/**
 * 录音时的实时滚动波形。
 * @param {HTMLCanvasElement} canvas
 * @param {Uint8Array} data getByteTimeDomainData 的结果
 */
export function drawLiveWave(canvas, data) {
  if (!canvas) return;
  const { ctx, w, h } = fit(canvas);
  const active = cssVar(canvas, '--wave-active', cssVar(canvas, '--accent', '#7c6cff'));
  const soft = cssVar(canvas, '--wave-idle', cssVar(canvas, '--surface-3', '#2a3140'));

  const mid = h / 2;
  const step = Math.max(1, Math.floor(data.length / w));

  // 基线
  ctx.strokeStyle = soft;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, mid);
  ctx.lineTo(w, mid);
  ctx.stroke();

  ctx.strokeStyle = active;
  ctx.lineWidth = Math.max(1.6, 2 * dpr());
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let x = 0; x < w; x++) {
    const v = (data[Math.min(data.length - 1, x * step)] - 128) / 128;
    const y = mid + v * (h * 0.46);
    if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

/** 录音进行中按时间累积的峰值 → 归一化 */
export function normalizePeaks(raw) {
  const src = Array.isArray(raw) ? raw.slice() : [];
  if (!src.length) return [];
  let top = 0;
  for (const v of src) if (v > top) top = v;
  if (top <= 0.0001) return src.map(() => 0.08);
  return src.map((v) => Math.min(1, Math.max(0.05, v / top)));
}
