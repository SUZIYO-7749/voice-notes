// 语音笔记 · 单元自测（只覆盖不依赖 DOM 的纯逻辑）
// 运行： node tools/selftest.mjs
import assert from 'node:assert/strict';
import {
  fmtTime, fmtClock, fmtDate, fmtBytes, escapeHtml, extForMime,
  safeFilename, dataURLToBlob, nextRate, clamp,
} from '../js/utils.js';
import { resample, normalizePeaks } from '../js/wave.js';
import { isRecordingSupported } from '../js/audio.js';

let passed = 0;
const cases = [];
const test = (name, fn) => cases.push([name, fn]);

/* ---------------- 时间格式化 ---------------- */

test('fmtTime 常规值', () => {
  assert.equal(fmtTime(0), '0:00');
  assert.equal(fmtTime(7), '0:07');
  assert.equal(fmtTime(62), '1:02');
  assert.equal(fmtTime(222), '3:42');
  assert.equal(fmtTime(3723), '1:02:03');
});

test('fmtTime 抵御非法值（MediaRecorder 的 Infinity 时长）', () => {
  assert.equal(fmtTime(Infinity), '0:00');
  assert.equal(fmtTime(NaN), '0:00');
  assert.equal(fmtTime(undefined), '0:00');
  assert.equal(fmtTime(-5), '0:00');
  assert.equal(fmtTime('12'), '0:12');
});

test('fmtClock 录音计时器', () => {
  assert.equal(fmtClock(0), '00:00');
  assert.equal(fmtClock(9), '00:09');
  assert.equal(fmtClock(75), '01:15');
  assert.equal(fmtClock(3725), '01:02:05');
  assert.equal(fmtClock(Infinity), '00:00');
});

test('fmtDate 相对日期', () => {
  const now = Date.now();
  assert.match(fmtDate(now), /^今天 \d{2}:\d{2}$/);
  assert.match(fmtDate(now - 86400000), /^昨天 \d{2}:\d{2}$/);
  assert.match(fmtDate(now - 3 * 86400000), /^周[一二三四五六日] \d{2}:\d{2}$/);
  assert.match(fmtDate(new Date(2020, 2, 5, 8, 1).getTime()), /^2020年3月5日$/);
});

test('fmtBytes', () => {
  assert.equal(fmtBytes(512), '512 B');
  assert.equal(fmtBytes(2048), '2.0 KB');
  assert.equal(fmtBytes(5 * 1024 * 1024), '5.0 MB');
  assert.equal(fmtBytes(0), '0 B');
});

/* ---------------- 字符串安全 ---------------- */

test('escapeHtml 阻断注入', () => {
  assert.equal(escapeHtml('<script>alert("x")</script>'),
    '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
  assert.equal(escapeHtml("it's"), 'it&#39;s');
  assert.equal(escapeHtml(null), '');
});

test('safeFilename 清掉非法字符', () => {
  assert.equal(safeFilename('a/b:c*d?e"f<g>h|i'), 'a_b_c_d_e_f_g_h_i');
  assert.equal(safeFilename('   '), '语音笔记');
  assert.equal(safeFilename(''), '语音笔记');
  assert.ok(safeFilename('长'.repeat(200)).length <= 60);
});

test('extForMime 推断扩展名', () => {
  assert.equal(extForMime('audio/webm;codecs=opus'), 'webm');
  assert.equal(extForMime('audio/mp4'), 'm4a');
  assert.equal(extForMime('audio/ogg'), 'ogg');
  assert.equal(extForMime('audio/mpeg'), 'mp3');
  assert.equal(extForMime(''), 'webm');
});

/* ---------------- 数据转换 ---------------- */

test('dataURLToBlob 还原出正确的类型与字节', () => {
  const blob = dataURLToBlob('data:audio/webm;base64,SGVsbG8=');
  assert.equal(blob.type, 'audio/webm');
  assert.equal(blob.size, 5);   // "Hello"
});

/* ---------------- 波形 ---------------- */

test('resample 改变长度并保留峰值', () => {
  const src = [0, 0.2, 0.9, 0.1, 1, 0.3];
  const out = resample(src, 3);
  assert.equal(out.length, 3);
  assert.equal(out[1], 0.9);          // 第二段覆盖 0.9 与 0.1，取最大值
  assert.equal(out[2], 1);
});

test('resample 处理空数组与等长', () => {
  assert.deepEqual(resample([], 4), [0, 0, 0, 0]);
  assert.deepEqual(resample([1, 2], 2), [1, 2]);
  assert.deepEqual(resample(null, 2), [0, 0]);
  assert.equal(resample([1, 2, 3], 5).length, 5);
});

test('normalizePeaks 归一化到 0~1 且有下限', () => {
  const out = normalizePeaks([0, 0.5, 2]);
  assert.equal(out[2], 1);
  assert.equal(out[1], 0.25);
  assert.ok(out[0] >= 0.05);
  assert.deepEqual(normalizePeaks([]), []);
  assert.deepEqual(normalizePeaks(null), []);
});

test('normalizePeaks 面对全静音不会除零', () => {
  const out = normalizePeaks([0, 0, 0]);
  assert.equal(out.length, 3);
  assert.ok(out.every((v) => Number.isFinite(v) && v > 0));
});

/* ---------------- 播放速度 ---------------- */

test('nextRate 循环切换', () => {
  assert.equal(nextRate(1), 1.25);
  assert.equal(nextRate(2), 0.75);
  assert.equal(nextRate(0.75), 1);
  assert.equal(nextRate(99), 1);      // 未知值回到起点
});

test('clamp', () => {
  assert.equal(clamp(5, 0, 1), 1);
  assert.equal(clamp(-5, 0, 1), 0);
  assert.equal(clamp(0.5, 0, 1), 0.5);
});

/* ---------------- 环境探测 ---------------- */

test('isRecordingSupported 在无浏览器环境下返回 false 而不抛错', () => {
  assert.equal(isRecordingSupported(), false);
});

/* ---------------- 执行 ---------------- */

for (const [name, fn] of cases) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}\n    ${err.message}`);
    process.exitCode = 1;
  }
}

console.log(`\n${passed}/${cases.length} 项通过。`);
