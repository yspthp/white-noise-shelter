// 白噪音庇護所：零依賴的本機伺服器
// 1. 提供靜態檔案
// 2. GET /api/playlist：自動掃描 audio/shelter/ 建立播放清單
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 8080;
// 預設只在本機開放；展場若需區網裝置連線，可設 HOST=0.0.0.0
const HOST = process.env.HOST || '127.0.0.1';

const NOISE_FILE = 'audio/annoying_notification.mp3';
const SHELTER_DIR = 'audio/shelter';
const AUDIO_EXT = new Set(['.mp3', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.wav', '.flac', '.webm']);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.webm': 'audio/webm',
};

async function buildPlaylist() {
  let noise = null;
  try {
    const st = await fs.promises.stat(path.join(ROOT, NOISE_FILE));
    if (st.isFile() && st.size > 0) noise = NOISE_FILE;
  } catch { /* 找不到干擾音檔：前端會略過干擾段落 */ }

  let shelter = [];
  let shelterDirFound = true;
  try {
    const entries = await fs.promises.readdir(path.join(ROOT, SHELTER_DIR), { withFileTypes: true });
    shelter = entries
      .filter((e) => e.isFile() && !e.name.startsWith('.') && AUDIO_EXT.has(path.extname(e.name).toLowerCase()))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b))
      .map((name) => `${SHELTER_DIR}/${encodeURIComponent(name)}`);
  } catch {
    shelterDirFound = false;
  }

  return { noise, shelter, shelterDirFound };
}

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method Not Allowed');

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    return send(res, 400, 'Bad Request');
  }

  if (pathname === '/api/playlist') {
    const list = await buildPlaylist();
    return send(res, 200, JSON.stringify(list), MIME['.json']);
  }

  // 防止路徑穿越
  let filePath = path.normalize(path.join(ROOT, pathname));
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) return send(res, 403, 'Forbidden');

  try {
    let st = await fs.promises.stat(filePath);
    if (st.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
      st = await fs.promises.stat(filePath);
    }
    const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': 'no-cache' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(filePath).pipe(res);
  } catch {
    send(res, 404, 'Not Found');
  }
});

server.listen(PORT, HOST, () => {
  const shown = HOST === '0.0.0.0' ? 'localhost' : HOST;
  console.log(`\n  白噪音庇護所已就緒：http://${shown}:${PORT}\n  （按 Ctrl+C 結束）\n`);
});
