// 纯原生工程的静态自检。
//
// javac 只能保证符号存在，保证不了原生 Android 最容易「一打开就闪退」的几类问题。
// 这个脚本把它们提前到编译期：
//   [1] 布局里用到的自定义 View 是否有对应 Java 类
//   [2] findViewById 的 id 是否在该文件自己的布局里
//   [3] 引用的布局文件是否存在
//   [4] Activity 的字段初始化器里有没有用 Context
//       —— 字段初始化器在构造函数中执行，而 Activity.attach()（设置 base Context）
//          在其之后才调用，此时 getColor()/getResources() 会 NPE，onCreate 都进不去
//   [5] findViewById 赋给的变量类型是否和布局里的控件类型兼容（否则 ClassCastException）
//
// 运行： node tools/check-native.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'android-native', 'app', 'src', 'main');
const JAVA_PKG = path.join(APP, 'java', 'com', 'voicenotes', 'nativeapp');
const LAYOUT_DIR = path.join(APP, 'res', 'layout');

let problems = 0;
const fail = (msg) => { problems++; console.error('  ✗ ' + msg); };

/* ================= 解析布局 ================= */
const layoutIds = new Map();       // layoutName -> Map<id, viewType>
const layoutCustomViews = new Map();

for (const file of fs.readdirSync(LAYOUT_DIR)) {
  if (!file.endsWith('.xml')) continue;
  const name = file.replace(/\.xml$/, '');
  const xml = fs.readFileSync(path.join(LAYOUT_DIR, file), 'utf8');

  // 逐个标签解析，记录每个 id 对应的控件类型
  const ids = new Map();
  for (const tag of xml.matchAll(/<([A-Za-z][A-Za-z0-9_.]*)((?:\s+[^<>]*?)?)\/?>/g)) {
    const type = tag[1];
    const attrs = tag[2] || '';
    const idMatch = attrs.match(/android:id="@\+id\/([A-Za-z0-9_]+)"/);
    if (idMatch) ids.set(idMatch[1], type.includes('.') ? type.split('.').pop() : type);
  }
  layoutIds.set(name, ids);

  const custom = new Set();
  for (const m of xml.matchAll(/<([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+)[\s/>]/g)) {
    const t = m[1];
    if (t.startsWith('android.') || t.startsWith('com.android.')) continue;
    custom.add(t);
  }
  layoutCustomViews.set(name, custom);
}

const totalIds = [...layoutIds.values()].reduce((n, m) => n + m.size, 0);
console.log(`已解析 ${layoutIds.size} 个布局，共 ${totalIds} 个 id。`);

/* ================= 控件继承关系（用于类型兼容判断） ================= */
const PARENT = {
  Button: 'TextView', EditText: 'TextView', CheckBox: 'CompoundButton',
  RadioButton: 'CompoundButton', Switch: 'CompoundButton', ToggleButton: 'CompoundButton',
  CompoundButton: 'Button', TextView: 'View', ImageButton: 'ImageView', ImageView: 'View',
  SeekBar: 'ProgressBar', ProgressBar: 'View',
  LinearLayout: 'ViewGroup', FrameLayout: 'ViewGroup', RelativeLayout: 'ViewGroup',
  GridLayout: 'ViewGroup', TableLayout: 'LinearLayout', TableRow: 'LinearLayout',
  ScrollView: 'FrameLayout', HorizontalScrollView: 'FrameLayout',
  ListView: 'AbsListView', GridView: 'AbsListView',
  AbsListView: 'AdapterView', AdapterView: 'ViewGroup', ViewGroup: 'View',
  WaveView: 'View', View: null, Space: 'View', ImageView_: 'View',
};

function isAssignable(declared, actual) {
  if (!declared || !actual) return true;          // 判断不了就不报
  if (declared === actual) return true;
  if (declared === 'View') return true;           // 声明成 View 永远安全
  let cur = actual;
  const seen = new Set();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    if (cur === declared) return true;
    cur = PARENT[cur];
  }
  return false;
}

/* ================= [1] 自定义 View ================= */
console.log('\n[1] 布局里的自定义 View');
for (const [layout, views] of layoutCustomViews) {
  for (const view of views) {
    const rel = view.split('.').slice(3).join(path.sep);
    const file = path.join(JAVA_PKG, rel + '.java');
    if (fs.existsSync(file)) console.log(`  ✓ ${layout} → ${view}`);
    else fail(`${layout} 引用了自定义 View ${view}，但没有对应的 Java 类`);
  }
}

const javaFiles = fs.readdirSync(JAVA_PKG).filter((f) => f.endsWith('.java'));
const readJava = (f) => fs.readFileSync(path.join(JAVA_PKG, f), 'utf8');

/* ================= [2] findViewById 的 id ================= */
console.log('\n[2] findViewById 的 id 是否在该文件的布局里');
let callCount = 0;
for (const file of javaFiles) {
  const src = readJava(file);
  const layouts = new Set([...src.matchAll(/R\.layout\.([A-Za-z0-9_]+)/g)].map((m) => m[1]));
  if (layouts.size === 0) continue;

  const available = new Set();
  for (const l of layouts) for (const id of layoutIds.get(l)?.keys() || []) available.add(id);

  const ids = [...src.matchAll(/findViewById\(\s*R\.id\.([A-Za-z0-9_]+)\s*\)/g)].map((m) => m[1]);
  const missing = [...new Set(ids.filter((id) => !available.has(id)))];
  callCount += ids.length;

  const label = `${file} [${[...layouts].join(', ')}]`;
  if (missing.length === 0) console.log(`  ✓ ${label}：${ids.length} 处全部命中`);
  else fail(`${label} 用了不属于该布局的 id：${missing.join(', ')}`);
}
console.log(`  共检查 ${callCount} 处 findViewById。`);

/* ================= [3] 布局文件存在 ================= */
console.log('\n[3] 引用的布局文件是否存在');
for (const file of javaFiles) {
  const src = readJava(file);
  for (const m of src.matchAll(/R\.layout\.([A-Za-z0-9_]+)/g)) {
    if (layoutIds.has(m[1])) console.log(`  ✓ ${file} → ${m[1]}.xml`);
    else fail(`${file} 引用了不存在的布局 R.layout.${m[1]}`);
  }
}

/* ================= [4] 字段初始化器里的 Context ================= */
console.log('\n[4] Activity 字段初始化器里是否误用了 Context');
const CONTEXT_CALL = /\b(getColor|getString|getResources|getSystemService|getFilesDir|getCacheDir|getAssets|getPackageManager|getApplicationContext|getTheme|getDrawable)\s*\(/;
let fieldChecked = 0;

for (const file of javaFiles) {
  const src = readJava(file);
  if (!/extends\s+Activity\b/.test(src)) continue;   // 只查 Activity 子类
  fieldChecked++;

  const lines = src.split(/\r?\n/);
  let depth = 0;
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 类体一级（depth===1）且带 = 的行，就是字段初始化器
    if (depth === 1 && line.includes('=') && !/^\s*(public|private|protected|static|final|\s)*\b(class|interface|enum)\b/.test(line)) {
      if (CONTEXT_CALL.test(line)) hits.push({ line: i + 1, why: '调用了 Context 方法', text: line.trim() });
      else if (/\(this\b/.test(line)) hits.push({ line: i + 1, why: '把 this 传给了别的构造函数', text: line.trim() });
    }
    depth += (line.match(/\{/g) || []).length;
    depth -= (line.match(/\}/g) || []).length;
  }

  if (hits.length === 0) {
    console.log(`  ✓ ${file}：字段初始化器干净`);
  } else {
    for (const h of hits) {
      fail(`${file}:${h.line} 字段初始化器${h.why} —— Activity 此时还没 attach 到 Context，会 NPE 闪退\n      ${h.text}`);
    }
  }
}
console.log(`  共检查 ${fieldChecked} 个 Activity。`);

/* ================= [5] findViewById 的类型兼容 ================= */
console.log('\n[5] findViewById 赋值的类型是否与布局一致');
let typeChecked = 0;
for (const file of javaFiles) {
  const src = readJava(file);
  const layouts = new Set([...src.matchAll(/R\.layout\.([A-Za-z0-9_]+)/g)].map((m) => m[1]));
  if (layouts.size === 0) continue;

  const idType = new Map();
  for (const l of layouts) for (const [id, type] of layoutIds.get(l) || []) idType.set(id, type);

  // 变量名 -> 声明类型（同名多类型则放弃判断）
  const declared = new Map();
  const ambiguous = new Set();
  for (const m of src.matchAll(/\b([A-Z][A-Za-z0-9_]*)\s+([a-z][A-Za-z0-9_]*)\s*(?:=|;)/g)) {
    const [, type, name] = m;
    if (declared.has(name) && declared.get(name) !== type) ambiguous.add(name);
    declared.set(name, type);
  }

  const bad = [];
  const re = /(?:(?<decl>[A-Z][A-Za-z0-9_]*)\s+)?(?<var>[A-Za-z_][A-Za-z0-9_.]*)\s*=\s*[^;=]*?findViewById\(\s*R\.id\.(?<id>[A-Za-z0-9_]+)\s*\)/g;
  for (const m of src.matchAll(re)) {
    const id = m.groups.id;
    const actual = idType.get(id);
    if (!actual) continue;
    let want = m.groups.decl;
    if (!want) {
      const name = m.groups.var.split('.').pop();
      if (ambiguous.has(name)) continue;
      want = declared.get(name);
    }
    if (!want) continue;
    typeChecked++;
    if (!isAssignable(want, actual)) {
      bad.push(`${file}: R.id.${id} 布局里是 ${actual}，却赋给了 ${want}`);
    }
  }

  if (bad.length === 0) console.log(`  ✓ ${file}：类型全部兼容`);
  else bad.forEach(fail);
}
console.log(`  共检查 ${typeChecked} 处类型。`);

/* ================= 结果 ================= */
if (problems) {
  console.error(`\n发现 ${problems} 处问题。`);
  process.exit(1);
}
console.log('\n✓ 原生工程的布局与代码引用完全一致。');
