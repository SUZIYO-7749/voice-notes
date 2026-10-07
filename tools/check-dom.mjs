// 静态自检，两件事：
//   1) app.js 里用到的每个 #id 选择器都能在 index.html 中找到对应元素；
//   2) app.js 里每个 el.xxx 引用都在 el 映射表里定义过（漏定义会导致运行时报错）。
// 运行： node tools/check-dom.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));

const jsDir = path.join(ROOT, 'js');
const jsFiles = fs.readdirSync(jsDir).filter((f) => f.endsWith('.js'));
let problems = 0;

/* ---------- 检查 1：#id 选择器 ---------- */
let selectorCount = 0;
for (const name of jsFiles) {
  const src = fs.readFileSync(path.join(jsDir, name), 'utf8');
  for (const m of src.matchAll(/\$\$?\(\s*'([^']+)'/g)) {
    const hit = m[1].match(/^#([A-Za-z0-9_-]+)/);
    if (!hit) continue;
    selectorCount++;
    if (!ids.has(hit[1])) {
      problems++;
      console.error(`✗ js/${name} 引用了不存在的元素 #${hit[1]}`);
    }
  }
}
console.log(`检查 1：js/*.js 中 ${selectorCount} 个 #id 选择器，index.html 共 ${ids.size} 个 id。`);

/* ---------- 检查 2：el 映射表 ---------- */
const appSrc = fs.readFileSync(path.join(jsDir, 'app.js'), 'utf8');
const mapStart = appSrc.indexOf('const el = {');
if (mapStart < 0) {
  console.error('✗ 在 js/app.js 中找不到 `const el = {` 映射表。');
  process.exit(1);
}
const mapEnd = appSrc.indexOf('\n};', mapStart);
const mapBody = appSrc.slice(mapStart, mapEnd);
const defined = new Set([...mapBody.matchAll(/^\s*([A-Za-z0-9_]+)\s*:/gm)].map((m) => m[1]));

const used = new Set([...appSrc.matchAll(/(?<![\w.$])el\.([A-Za-z0-9_]+)/g)].map((m) => m[1]));
let elCount = 0;
for (const key of used) {
  elCount++;
  if (!defined.has(key)) {
    problems++;
    console.error(`✗ js/app.js 使用了未定义的 el.${key}（el 映射表里没有这一项，运行时会抛 TypeError）`);
  }
}
console.log(`检查 2：js/app.js 中 el 映射表定义 ${defined.size} 项，被引用 ${elCount} 项。`);

const unused = [...defined].filter((k) => !used.has(k));
if (unused.length) console.log(`提示：el 映射表中未被引用的项：${unused.join(', ')}`);

if (problems) {
  console.error(`\n发现 ${problems} 处问题。`);
  process.exit(1);
}
console.log('✓ 所有 DOM 引用都能对上。');
