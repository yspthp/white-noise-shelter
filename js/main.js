// 流程控制：進入 → 旅程 → 完成；任何載入問題都轉為溫和的提示
import { CONFIG } from './config.js';
import { ShelterEngine } from './engine.js';
import { Line } from './visuals.js';

const $ = (id) => document.getElementById(id);
const scenes = ['intro', 'journey', 'outro', 'error'];
const line = new Line($('line'));

const playBtn = $('play');
const caption = $('caption');

let engine = null;
let rafId = 0;

function show(name) {
  for (const s of scenes) $(s).classList.toggle('is-active', s === name);
  document.body.classList.toggle('is-listening', name === 'journey');
}

function fail(detail) {
  show('error');
  line.setPresence(0);
  if (detail) $('error-detail').textContent = detail;
}

async function fetchPlaylist() {
  // 優先使用伺服器自動掃描（server.js 的 /api/playlist）或 GitHub Pages 靜態播放清單（api/playlist.json）
  for (const url of ['api/playlist', 'api/playlist.json']) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.shelter) && data.shelter.length) return data;
      }
    } catch { /* 改用下一個來源或備援 */ }
  }
  return scanDirectoryListing();
}

async function scanDirectoryListing() {
  const exts = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|webm)$/i;
  let shelter = [];
  let shelterDirFound = false;
  try {
    const res = await fetch('audio/shelter/', { cache: 'no-store' });
    if (res.ok) {
      shelterDirFound = true;
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      const base = new URL('audio/shelter/', location.href);
      shelter = [...new Set(
        [...doc.querySelectorAll('a[href]')]
          .map((a) => new URL(a.getAttribute('href'), base))
          .filter((u) => u.href.startsWith(base.href) && exts.test(u.pathname))
          .map((u) => u.href),
      )];
    }
  } catch { /* 無法列出目錄 */ }

  let noise = null;
  try {
    const res = await fetch('audio/annoying_notification.mp3', { method: 'HEAD' });
    if (res.ok) noise = 'audio/annoying_notification.mp3';
  } catch { /* 沒有干擾聲也能播放 */ }

  return { noise, shelter, shelterDirFound };
}

async function prepare() {
  show('intro');
  line.setPhase(1);
  line.setPresence(0.3);
  playBtn.disabled = true;
  playBtn.textContent = '正在準備聲音';

  if (location.protocol === 'file:') {
    return fail('請用 start.bat 或 npm start 開啟網站，瀏覽器無法直接從檔案讀取聲音。');
  }

  let playlist;
  try {
    playlist = await fetchPlaylist();
  } catch {
    return fail('暫時讀不到聲音資料夾，請確認檔案路徑。');
  }

  if (!playlist.shelter || !playlist.shelter.length) {
    return fail(playlist.shelterDirFound
      ? '資料夾已經在了，只是裡面還沒有聲音。請放入幾段白噪音。'
      : '請確認檔案路徑。');
  }

  engine = new ShelterEngine();
  const result = await engine.load(playlist, (p) => {
    playBtn.textContent = `正在準備聲音 ${Math.round(p * 100)}%`;
  });

  if (!result.ok) {
    return fail('找到了檔案，但聲音沒有順利打開。請確認是可播放的 mp3。');
  }

  playBtn.textContent = '按下播放';
  playBtn.disabled = false;
  if (!engine.noise) console.info('[shelter] 未找到 audio/annoying_notification.mp3，直接從安靜開始');
}

function begin() {
  if (!engine || playBtn.disabled) return;
  playBtn.disabled = true;
  show('journey');
  // 有干擾聲：線立刻進入顫動狀態；沒有：直接從平靜開始
  line.setPhase(engine.noise ? 0 : 0.6, true);
  line.setPresence(1);
  engine.onEnd = complete;
  engine.start();
  track();
  $('end').focus({ preventScroll: true });
}

// 依時間軸驅動線條狀態與字幕
function track() {
  const { timeline: T, captions } = CONFIG;
  const t = engine.elapsed;

  if (engine.noise) {
    // 干擾聲退場期間，線從顫動過渡到平靜
    const p = (t - T.noiseRecedeStart) / (T.noiseRecedeEnd + 8 - T.noiseRecedeStart);
    line.setPhase(Math.min(1, Math.max(0, p)));
    line.setLevel(engine.noiseLevel);
  } else {
    line.setPhase(1);
  }
  if (t > T.total - T.finalFade) line.setPresence(0.3);

  // 沒有干擾聲時，跳過描述干擾聲的字幕
  const list = engine.noise ? captions : captions.filter((c) => c.time >= T.noiseRecedeEnd);
  const cur = list.find((c) => t >= c.time && t < c.time + c.dur);
  if (cur && caption.textContent !== cur.text) caption.textContent = cur.text;
  caption.classList.toggle('is-shown', Boolean(cur));
  caption.classList.toggle('is-warm', !engine.noise || t >= T.noiseRecedeStart + 4);

  if (!engine.ended) rafId = requestAnimationFrame(track);
}

function complete() {
  cancelAnimationFrame(rafId);
  caption.classList.remove('is-shown');
  line.setLevel(0);
  line.setPresence(0);
  show('outro');
}

playBtn.addEventListener('click', begin);
$('end').addEventListener('click', () => engine && engine.stop());
$('retry').addEventListener('click', prepare);
$('again').addEventListener('click', prepare);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.body.classList.contains('is-listening') && engine) engine.stop();
});

prepare();
