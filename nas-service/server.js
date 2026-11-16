// nas-service/server.js
// 轻量图片存储服务，运行在 NAS 的 Docker 容器中。
// 零第三方依赖：图片尺寸用纯 Node.js 解析，直接 node 运行即可，无需 npm install。
// 提供：静态图片分发 / 图片清单 / 上传 / 删除。
// 除静态图片外，所有接口都需要 X-Api-Token 头（与 EdgeOne 环境变量 NAS_API_TOKEN 一致）。

const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const PORT = parseInt(process.env.PORT || '3000', 10);
const API_TOKEN = process.env.NAS_API_TOKEN || '';
const DATA_DIR = path.resolve(process.env.DATA_DIR || '/data/images');
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
const MANIFEST_TTL = parseInt(process.env.MANIFEST_TTL_MS || '30000', 10);

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.avif']);
const SKIP_FILES = new Set(['index.html', 'notfound.jpg', '.DS_Store']);
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

// 生成唯一安全文件名：<毫秒时间戳36进制>-<3位随机>.<扩展名>
function uniqueName(originalName) {
  const m = /\.([a-z0-9]{1,8})$/i.exec(originalName || '');
  const ext = m ? '.' + m[1].toLowerCase() : '.jpg';
  const time = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 5).padEnd(3, '0');
  return `${time}-${rand}${ext}`;
}

// ---------- 纯 JS 图片尺寸解析（无依赖） ----------
function getImageSize(buf) {
  if (!buf || buf.length < 16) return null;
  try {
    // PNG
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    // GIF
    if (buf.toString('ascii', 0, 3) === 'GIF') {
      return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    }
    // BMP
    if (buf[0] === 0x42 && buf[1] === 0x4d) {
      return { width: Math.abs(buf.readInt32LE(18)), height: Math.abs(buf.readInt32LE(22)) };
    }
    // JPEG
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      let o = 2;
      while (o + 9 < buf.length) {
        if (buf[o] !== 0xff) { o++; continue; }
        let m = buf[o + 1];
        while (m === 0xff) { o++; m = buf[o + 1]; }
        if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd9)) { o += 2; continue; }
        const len = buf.readUInt16BE(o + 2);
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
          return { width: buf.readUInt16BE(o + 7), height: buf.readUInt16BE(o + 5) };
        }
        o += 2 + len;
      }
      return null;
    }
    // WebP
    if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
      const fmt = buf.toString('ascii', 12, 16);
      if (fmt === 'VP8X') {
        return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
      }
      if (fmt === 'VP8L') {
        const b = buf.readUInt32LE(21);
        return { width: 1 + (b & 0x3fff), height: 1 + ((b >>> 14) & 0x3fff) };
      }
      if (fmt === 'VP8 ') {
        const idx = buf.indexOf(Buffer.from([0x9d, 0x01, 0x2a]), 20);
        if (idx > 0 && idx + 6 < buf.length) {
          return { width: buf.readUInt16LE(idx + 3) & 0x3fff, height: buf.readUInt16LE(idx + 5) & 0x3fff };
        }
      }
      return null;
    }
  } catch {
    return null;
  }
  return null;
}

// 清单内存缓存
let manifestCache = null;
let manifestCacheAt = 0;

function send(res, status, body, headers = {}) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    ...headers,
  });
  res.end(data);
}

function isAuthorized(req) {
  if (!API_TOKEN) return true;
  return req.headers['x-api-token'] === API_TOKEN;
}

function safeName(name) {
  // 只防路径穿越，不限制空格/括号/中文等字符，
  // 这样从 GitHub 迁过来的旧文件名（如 "1 (8).jpeg"）也能正常提供。
  return (
    typeof name === 'string' &&
    name.length > 0 &&
    name.length <= 255 &&
    !name.includes('/') &&
    !name.includes('\\') &&
    !name.includes('..') &&
    !/[\x00-\x1f\x7f]/.test(name)
  );
}

function mimeOf(ext) {
  return (
    {
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
      '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
      '.tiff': 'image/tiff', '.avif': 'image/avif',
    }[ext] || 'application/octet-stream'
  );
}

async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('请求体过大');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function getManifest() {
  const now = Date.now();
  if (manifestCache && now - manifestCacheAt < MANIFEST_TTL) return manifestCache;

  const entries = await fsp.readdir(DATA_DIR, { withFileTypes: true });
  const pc = [];
  const mobile = [];

  await Promise.all(
    entries.map(async (entry) => {
      if (!entry.isFile() || SKIP_FILES.has(entry.name)) return;
      const ext = path.extname(entry.name).toLowerCase();
      if (!IMAGE_EXT.has(ext)) return;
      const filePath = path.join(DATA_DIR, entry.name);
      try {
        const buf = await fsp.readFile(filePath);
        const dim = getImageSize(buf);
        if (!dim || !dim.width || !dim.height) return;
        const stat = await fsp.stat(filePath);
        const item = {
          src: entry.name,
          width: dim.width,
          height: dim.height,
          size: (stat.size / 1024).toFixed(2) + ' KB',
          mtime: stat.mtime.toISOString(),
        };
        (dim.width > dim.height ? pc : mobile).push(item);
      } catch (e) {
        console.warn('[manifest] skip', entry.name, e.message);
      }
    })
  );

  const byName = (a, b) => a.src.localeCompare(b.src);
  pc.sort(byName);
  mobile.sort(byName);

  manifestCache = { pc, mobile, updatedAt: new Date().toISOString() };
  manifestCacheAt = now;
  return manifestCache;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = decodeURIComponent(url.pathname);

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,PUT,POST,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Api-Token',
        'Access-Control-Max-Age': '86400',
      });
      return res.end();
    }

    if (pathname === '/health' && req.method === 'GET') {
      return send(res, 200, { ok: true, dataDir: DATA_DIR, baseUrl: PUBLIC_BASE_URL || 'auto' });
    }

    if (req.method === 'GET' && pathname.startsWith('/images/')) {
      const name = pathname.slice('/images/'.length);
      if (!safeName(name)) return send(res, 400, { error: '非法文件名' });
      const ext = path.extname(name).toLowerCase();
      if (!IMAGE_EXT.has(ext)) return send(res, 404, { error: '不支持的类型' });
      const filePath = path.join(DATA_DIR, name);
      try {
        const buf = await fsp.readFile(filePath);
        const etag = '"' + crypto.createHash('md5').update(buf).digest('hex') + '"';
        if (req.headers['if-none-match'] === etag) {
          res.writeHead(304, { 'Cache-Control': 'public, max-age=31536000, immutable', ETag: etag });
          return res.end();
        }
        res.writeHead(200, {
          'Content-Type': mimeOf(ext),
          'Content-Length': buf.length,
          'Cache-Control': 'public, max-age=31536000, immutable',
          ETag: etag,
          'Access-Control-Allow-Origin': '*',
        });
        return res.end(buf);
      } catch {
        return send(res, 404, { error: '图片不存在' });
      }
    }

    if (!isAuthorized(req)) return send(res, 401, { error: '未授权' });

    if (pathname === '/manifest' && req.method === 'GET') {
      const manifest = await getManifest();
      if (PUBLIC_BASE_URL) manifest.baseUrl = PUBLIC_BASE_URL;
      return send(res, 200, manifest, {
        'Cache-Control': `public, max-age=${Math.floor(MANIFEST_TTL / 1000)}`,
      });
    }

    if (pathname === '/upload' && req.method === 'PUT') {
      const body = JSON.parse(await readBody(req, MAX_UPLOAD_BYTES * 2));
      const { name, base64Content } = body;
      if (!safeName(name)) return send(res, 400, { error: '非法文件名' });
      const ext = path.extname(name).toLowerCase();
      if (!IMAGE_EXT.has(ext)) return send(res, 400, { error: '不支持的图片格式' });
      if (typeof base64Content !== 'string') return send(res, 400, { error: '缺少图片内容' });
      const buf = Buffer.from(base64Content, 'base64');
      if (!buf.length || buf.length > MAX_UPLOAD_BYTES) return send(res, 400, { error: '图片为空或超过 20MB' });
      const dim = getImageSize(buf);
      if (!dim || !dim.width || !dim.height) return send(res, 400, { error: '无法识别的图片' });
      await fsp.mkdir(DATA_DIR, { recursive: true });
      await fsp.writeFile(path.join(DATA_DIR, name), buf, { flag: 'wx' });
      manifestCacheAt = 0;
      return send(res, 200, { success: true, name, width: dim.width, height: dim.height });
    }

    if (pathname === '/delete' && req.method === 'DELETE') {
      const body = JSON.parse(await readBody(req, 1024 * 8));
      const { name } = body;
      if (!safeName(name)) return send(res, 400, { error: '非法文件名' });
      try {
        await fsp.unlink(path.join(DATA_DIR, name));
      } catch (e) {
        if (e.code === 'ENOENT') return send(res, 404, { error: '图片不存在' });
        throw e;
      }
      manifestCacheAt = 0;
      return send(res, 200, { success: true });
    }

    // 批量删除：POST /delete-batch  { names: string[] }
    if (pathname === '/delete-batch' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req, 8 * 1024 * 1024));
      const names = Array.isArray(body.names) ? body.names : [];
      let deleted = 0;
      const failed = [];
      for (const name of names) {
        if (!safeName(name)) { failed.push({ name, reason: '非法文件名' }); continue; }
        try {
          await fsp.unlink(path.join(DATA_DIR, name));
          deleted++;
        } catch (e) {
          failed.push({ name, reason: e.code === 'ENOENT' ? '不存在' : e.message });
        }
      }
      if (deleted > 0) manifestCacheAt = 0;
      return send(res, 200, { success: true, deleted, total: names.length, failed });
    }

    // 单文件重命名：POST /rename  { from, to }  （to 省略则自动生成安全唯一名）
    if (pathname === '/rename' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req, 1024 * 8));
      const { from, to } = body;
      if (!safeName(from)) return send(res, 400, { error: '原文件名不合法' });
      const src = path.join(DATA_DIR, from);
      let stat;
      try { stat = await fsp.stat(src); } catch { return send(res, 404, { error: '文件不存在' }); }
      // 目标名：显式指定或自动生成；统一补上正确的原扩展名
      const ext = path.extname(from) || '.jpg';
      let target = (typeof to === 'string' && to) ? to : uniqueName(from);
      if (!path.extname(target)) target += ext;
      if (!safeName(target)) return send(res, 400, { error: '目标文件名不合法' });
      if (target === from) return send(res, 200, { success: true, from, to: target, unchanged: true });
      const dst = path.join(DATA_DIR, target);
      try { await fsp.stat(dst); return send(res, 400, { error: '目标文件名已存在' }); } catch {}
      await fsp.rename(src, dst);
      manifestCacheAt = 0;
      return send(res, 200, { success: true, from, to: target });
    }

    // 一键整理：POST /organize  — 把所有「不安全」文件名（空格/括号/中文等）自动重命名为安全唯一名
    if (pathname === '/organize' && req.method === 'POST') {
      const entries = await fsp.readdir(DATA_DIR, { withFileTypes: true });
      const renamed = [];
      const failed = [];
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const ext = path.extname(entry.name).toLowerCase();
        if (!IMAGE_EXT.has(ext) || SKIP_FILES.has(entry.name)) continue;
        // 只整理「含空格/括号/非ASCII等」的不安全文件名；
        // 已经是纯 ASCII 且无空格括号的名字（含本工具生成的名字）保持不动。
        if (/^[\w.\-]+$/.test(entry.name)) continue;
        const target = uniqueName(entry.name);
        try {
          await fsp.rename(path.join(DATA_DIR, entry.name), path.join(DATA_DIR, target));
          renamed.push({ from: entry.name, to: target });
        } catch (e) {
          failed.push({ from: entry.name, reason: e.message });
        }
      }
      if (renamed.length) manifestCacheAt = 0;
      return send(res, 200, { success: true, renamedCount: renamed.length, renamed, failed });
    }

    return send(res, 404, { error: 'Not Found' });
  } catch (err) {
    console.error('[nas-service] error:', err);
    return send(res, 500, { error: err.message || '服务器错误' });
  }
});

(async () => {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ NAS image service listening on :${PORT}`);
    console.log(`   data dir: ${DATA_DIR}`);
    console.log(`   public base url: ${PUBLIC_BASE_URL || '(auto / same origin)'}`);
    console.log(`   auth: ${API_TOKEN ? 'enabled' : 'DISABLED (no token set)'}`);
  });
})();
