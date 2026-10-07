// 语音笔记 —— 零依赖本地静态服务器
// 浏览器只有在 http://localhost 或 https 下才允许使用麦克风，所以需要用它来打开本应用。
// 默认监听 0.0.0.0，这样同一个 Wi-Fi 下的手机也能访问（手机端使用说明见 README）。
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || process.argv[2] || 5173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.webm': 'audio/webm',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
};

function safeJoin(root, urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  const rel = decoded.replace(/^\/+/, '');
  const full = path.resolve(root, rel);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (full !== root && !full.startsWith(rootWithSep)) return null;
  return full;
}

const server = http.createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Method Not Allowed');
    return;
  }

  let target = safeJoin(ROOT, req.url || '/');
  if (!target) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  try {
    let stat = await fsp.stat(target).catch(() => null);
    if (stat && stat.isDirectory()) {
      target = path.join(target, 'index.html');
      stat = await fsp.stat(target).catch(() => null);
    }
    if (!stat || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h1>404</h1><p>找不到该文件。请从 <a href="/">语音笔记首页</a> 进入。</p>');
      return;
    }

    const ext = path.extname(target).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    const headers = {
      'Content-Type': type,
      'Content-Length': stat.size,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'no-cache, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
    };

    if (ext === '.mjs' || ext === '.js' || ext === '.webmanifest') {
      headers['Service-Worker-Allowed'] = '/';
    }

    res.writeHead(200, headers);
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(target).pipe(res);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('服务器错误：' + (err && err.message ? err.message : String(err)));
  }
});

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`\n端口 ${PORT} 已被占用。请换一个端口启动，例如：  node server.mjs 5174\n`);
  } else {
    console.error('\n启动失败：', err);
  }
  process.exit(1);
});

/** 找出本机所有可供手机访问的局域网 IPv4 地址 */
function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

server.listen(PORT, HOST, () => {
  const lans = lanAddresses();
  console.log('');
  console.log('  🎙️  语音笔记已启动');
  console.log('  ─────────────────────────────────────────');
  console.log(`  电脑上打开：http://127.0.0.1:${PORT}/`);
  if (lans.length) {
    console.log('');
    console.log('  手机上打开（需与电脑连同一个 Wi-Fi）：');
    for (const ip of lans) console.log(`    http://${ip}:${PORT}/`);
  }
  console.log('');
  console.log('  首次使用请允许浏览器访问麦克风。');
  console.log('  注意：手机浏览器默认禁止 http 页面使用麦克风，');
  console.log('        请先按 README 里「在安卓手机上使用」一节做一次性设置。');
  console.log('');
  console.log('  按 Ctrl+C 停止服务。');
  console.log('');
});
