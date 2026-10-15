// 聲音引擎：載入 → 分析 → 響度平衡 → 編排拼接 → 混音曲線
import { CONFIG } from './config.js';
import { analyzeClip } from './analysis.js';

const dbToGain = (db) => 10 ** (db / 20);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// 等功率曲線：兩個不相關的聲音交叉淡化時，總響度維持穩定
function curve(kind, from = 0, to = 1, n = 128) {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    let v;
    if (kind === 'in') v = Math.sin((t * Math.PI) / 2);
    else if (kind === 'out') v = Math.cos((t * Math.PI) / 2);
    else v = 0.5 - 0.5 * Math.cos(t * Math.PI); // 'ease'：S 型
    c[i] = from + (to - from) * v;
  }
  return c;
}

// 把素材做成「首尾無縫」的循環緩衝：尾端以等功率交叉淡化疊進開頭
// 這樣 9 秒的片段也能無限延伸，聽不到接縫
function makeLoopable(ctx, buffer, start, end, xfMax) {
  const sr = buffer.sampleRate;
  const s0 = Math.floor(start * sr);
  const s1 = Math.min(buffer.length, Math.floor(end * sr));
  const len = s1 - s0;
  const xf = Math.min(Math.floor(xfMax * sr), Math.floor(len * 0.25));
  const out = ctx.createBuffer(buffer.numberOfChannels, len - xf, sr);

  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src = buffer.getChannelData(ch);
    const dst = out.getChannelData(ch);
    for (let i = 0; i < xf; i++) {
      const t = ((i + 0.5) / xf) * (Math.PI / 2);
      dst[i] = src[s1 - xf + i] * Math.cos(t) + src[s0 + i] * Math.sin(t);
    }
    dst.set(src.subarray(s0 + xf, s1 - xf), xf);
  }
  return out;
}

// 慢速自動音量（leveling）：直接把起伏寫進循環緩衝
// 以 2 秒視窗量測局部 RMS，朝素材平均值修正 70% 的偏差（上限 ±9 dB），
// 狼嚎、浪頭這類突出的段落會被溫和壓平，而不是被壓縮器「抽」下去
// 視窗以環狀方式計算，循環接縫處的增益前後一致
function levelBuffer(buffer, { window = 2, hop = 0.25, amount = 0.7, maxDb = 9 } = {}) {
  const sr = buffer.sampleRate;
  const n = buffer.length;
  const chans = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  const hopN = Math.max(1, Math.round(hop * sr));
  const frames = Math.max(1, Math.ceil(n / hopN));

  const energy = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    let e = 0;
    const s0 = f * hopN;
    const s1 = Math.min(n, s0 + hopN);
    for (const c of chans) for (let i = s0; i < s1; i++) e += c[i] * c[i];
    energy[f] = e / ((s1 - s0) * chans.length);
  }

  const half = Math.max(1, Math.round(window / hop / 2));
  const localDb = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    let e = 0;
    for (let k = -half; k <= half; k++) e += energy[(f + k + frames * 4) % frames];
    localDb[f] = 10 * Math.log10(e / (2 * half + 1) + 1e-12);
  }
  // 以中位數當基準，對突發的大聲段落不敏感
  const ref = [...localDb].sort((a, b) => a - b)[Math.floor(frames / 2)];
  const gain = Array.from(localDb, (d) => dbToGain(clamp((ref - d) * amount, -maxDb, maxDb * 0.5)));

  for (let f = 0; f < frames; f++) {
    const g0 = gain[f];
    const g1 = gain[(f + 1) % frames];
    const s0 = f * hopN;
    const s1 = Math.min(n, s0 + hopN);
    for (let i = s0; i < s1; i++) {
      const g = g0 + (g1 - g0) * ((i - s0) / hopN);
      for (const c of chans) c[i] *= g;
    }
  }
  return buffer;
}

// 柔性削波：只在接近滿刻度時才圓滑地限制，平常完全透明
function softClipCurve(n = 2048, knee = 0.75) {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a <= knee ? a : knee + (1 - knee) * Math.tanh((a - knee) / (1 - knee));
    c[i] = Math.sign(x) * y * 0.97;
  }
  return c;
}

// 當雲端靜態環境尚未上傳二進位 MP3 檔案時，自動以 Web Audio 合成對應的自然環境音與通知干擾聲
function synthesizeFallbackClip(ctx, url) {
  const sr = ctx.sampleRate || 44100;
  const decodedUrl = decodeURIComponent(url).toLowerCase();
  const dur = 24;
  const len = Math.floor(sr * dur);
  const buf = ctx.createBuffer(2, len, sr);
  const L = buf.getChannelData(0);
  const R = buf.getChannelData(1);

  if (decodedUrl.includes('annoying_notification')) {
    // 模擬密集的訊息提示音與震動干擾
    const events = [
      0.3, 1.1, 1.9, 2.4, 3.2, 4.0, 4.5, 5.1, 6.0, 6.8, 7.3, 8.1,
      8.9, 9.4, 10.2, 11.0, 11.6, 12.3, 13.1, 13.8, 14.4, 15.2,
      16.0, 16.7, 17.5, 18.2, 19.0, 19.8, 20.5, 21.3, 22.0, 22.8,
    ];
    for (const ev of events) {
      const s0 = Math.floor(ev * sr);
      const pingLen = Math.floor(0.32 * sr);
      const f1 = 880 + ((ev * 137) % 520);
      const f2 = f1 * 1.333;
      for (let i = 0; i < pingLen && s0 + i < len; i++) {
        const t = i / sr;
        const env = Math.exp(-t * 14) * Math.sin(Math.min(1, t * 200) * (Math.PI / 2));
        const freq = t < 0.09 ? f1 : f2;
        const val = (Math.sin(2 * Math.PI * freq * t) + 0.35 * Math.sin(2 * Math.PI * freq * 2 * t)) * env * 0.28;
        L[s0 + i] += val;
        R[s0 + i] += val * 0.92;
      }
    }
    return buf;
  }

  // 自然白噪音合成（依檔名特徵調整濾波與動態包絡）
  let b0L = 0, b1L = 0, b2L = 0, b0R = 0, b1R = 0, b2R = 0;
  const isWaves = decodedUrl.includes('beach') || decodedUrl.includes('waves');
  const isWind = decodedUrl.includes('wind');
  const isRain = decodedUrl.includes('rain');
  const isFire = decodedUrl.includes('firewood') || decodedUrl.includes('crackling');
  const isSnow = decodedUrl.includes('snow') || decodedUrl.includes('footsteps');

  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const wL = Math.random() * 2 - 1;
    const wR = Math.random() * 2 - 1;

    // 粉紅噪音基底
    b0L = 0.99765 * b0L + wL * 0.099046;
    b1L = 0.96300 * b1L + wL * 0.296516;
    b2L = 0.57000 * b2L + wL * 1.052691;
    const pinkL = (b0L + b1L + b2L + wL * 0.1848) * 0.04;

    b0R = 0.99765 * b0R + wR * 0.099046;
    b1R = 0.96300 * b1R + wR * 0.296516;
    b2R = 0.57000 * b2R + wR * 1.052691;
    const pinkR = (b0R + b1R + b2R + wR * 0.1848) * 0.04;

    let mod = 1;
    if (isWaves) {
      mod = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 0.12 * t));
    } else if (isWind) {
      mod = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 0.08 * t + Math.sin(0.25 * t)));
    } else if (isSnow) {
      const step = (t * 1.15) % 1;
      const crunch = step < 0.18 ? Math.sin((step / 0.18) * Math.PI) ** 2 : 0;
      mod = 0.25 + 0.55 * crunch;
    } else if (isFire) {
      const crackle = Math.random() < 0.0018 ? (Math.random() * 0.45) : 0;
      L[i] += crackle;
      R[i] += crackle * 0.85;
      mod = 0.55;
    } else if (isRain) {
      mod = 0.7;
    }

    L[i] += pinkL * mod;
    R[i] += pinkR * mod;
  }
  return buf;
}

async function fetchDecode(ctx, url) {
  try {
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.arrayBuffer();
      return await ctx.decodeAudioData(data);
    }
  } catch { /* 若找不到實體 mp3 檔案則改用內建合成音訊備援 */ }
  console.info('[shelter] 使用內建 Web Audio 合成音訊備援：', url);
  return synthesizeFallbackClip(ctx, url);
}

export class ShelterEngine {
  constructor() {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'playback' });
    this.noise = null;
    this.clips = [];
    this.plan = null;
    this.t0 = 0;
    this.nodes = [];
    this.onEnd = null;
    this.ended = false;
  }

  async load(playlist, onProgress = () => {}) {
    const urls = playlist.shelter;
    const total = urls.length + (playlist.noise ? 1 : 0);
    let done = 0;
    const tick = () => onProgress(++done / total);

    const loadOne = async (url) => {
      try {
        const buffer = await fetchDecode(this.ctx, url);
        const info = await analyzeClip(buffer);
        tick();
        if (!isFinite(info.loudness) || info.end - info.start < 2) return null; // 靜音或過短，略過
        return { url, buffer, ...info, duration: info.end - info.start };
      } catch (err) {
        console.warn('[shelter] 無法載入素材：', url, err);
        tick();
        return null;
      }
    };

    const [noise, ...clips] = await Promise.all([
      playlist.noise ? loadOne(playlist.noise) : Promise.resolve(null),
      ...urls.map(loadOne),
    ]);
    this.noise = noise;
    this.clips = clips.filter(Boolean);
    if (!this.clips.length) return { ok: false };

    this.plan = this.compose();
    console.info('[shelter] 編排結果', this.describe());
    return { ok: true };
  }

  // ---- 編排：決定底層、片段順序與每段長度 ----
  compose() {
    const { timeline: T, loudness: L, splice: S } = CONFIG;
    const ctx = this.ctx;

    // 1. 響度平衡：每段素材各自增益到同一個目標響度
    for (const c of this.clips) {
      c.gain = dbToGain(clamp(L.shelterTarget - c.loudness, L.maxCutDb, L.maxBoostDb));
      c.loop = levelBuffer(makeLoopable(ctx, c.buffer, c.start, c.end, S.loopCrossfadeMax));
    }
    if (this.noise) {
      const n = this.noise;
      n.gain = dbToGain(clamp(L.noiseTarget - n.loudness, L.maxCutDb, L.maxBoostDb));
      n.loop = makeLoopable(ctx, n.buffer, n.start, n.end, 1);
    }

    const shelterStart = this.noise ? T.shelterStart : 0;

    // 2. 底層：最平穩（短期響度變化最小）的素材全程輕輕鋪著，
    //    讓前景片段切換時永遠有連續的聲音襯底
    let bed = null;
    if (this.clips.length >= 2) {
      const pool = this.clips.filter((c) => c.duration >= 12);
      bed = (pool.length ? pool : this.clips).reduce((a, b) => (b.steadiness < a.steadiness ? b : a));
    }

    // 3. 前景順序：由明亮到溫暖（高頻比例由多到少），聲音一路變柔
    let fg = this.clips.length >= 3 ? this.clips.filter((c) => c !== bed) : [...this.clips];
    fg.sort((a, b) => b.brightness - a.brightness);

    // 4. 每段長度：依素材本身長度給權重，短素材靠無縫循環延伸到最短停留時間
    const span = T.total - shelterStart;
    const want = (c) => clamp(c.duration * 1.2, S.minSegment, 36);
    const seq = [];
    if (fg.length === 1) {
      seq.push({ clip: fg[0], dur: span });
    } else {
      let sum = 0;
      let cycle = 0;
      while (sum < span) {
        const order = cycle % 2 === 0 ? fg : [...fg].reverse(); // 來回走，避免跳回最亮的
        for (const c of order) {
          if (sum >= span) break;
          if (seq.length && seq[seq.length - 1].clip === c) continue;
          const d = want(c);
          // 放不下一半就不再加新段，改由既有片段等比例延長
          if (seq.length && sum + d - span > d / 2) { sum = span; break; }
          seq.push({ clip: c, dur: d });
          sum += d;
        }
        cycle++;
      }
    }
    const total = seq.reduce((a, s) => a + s.dur, 0);
    let t = shelterStart;
    for (const s of seq) {
      s.dur *= span / total;
      s.at = t;
      t += s.dur;
    }

    return { bed, seq, shelterStart };
  }

  describe() {
    const name = (c) => decodeURIComponent(c.url.split('/').pop());
    const p = this.plan;
    return {
      noise: this.noise && { loudness: this.noise.loudness.toFixed(1), gainDb: (20 * Math.log10(this.noise.gain)).toFixed(1) },
      bed: p.bed && name(p.bed),
      clips: this.clips.map((c) => ({
        name: name(c),
        duration: c.duration.toFixed(1),
        lufs: c.loudness.toFixed(1),
        gainDb: (20 * Math.log10(c.gain)).toFixed(1),
        steadiness: c.steadiness.toFixed(2),
        brightness: c.brightness.toFixed(3),
      })),
      sequence: p.seq.map((s) => `${s.at.toFixed(0)}s  ${name(s.clip)}  (${s.dur.toFixed(0)}s)`),
    };
  }

  // ---- 播放：所有曲線一次排程到 AudioContext 時間軸上 ----
  start() {
    const ctx = this.ctx;
    if (ctx.state === 'suspended' && !(window.OfflineAudioContext && ctx instanceof OfflineAudioContext)) ctx.resume();
    const { timeline: T, loudness: L, splice: S } = CONFIG;
    const { bed, seq, shelterStart } = this.plan;
    const t0 = ctx.currentTime + 0.15;
    const at = (s) => t0 + s;
    const end = at(T.total);
    this.t0 = t0;

    // 輸出鏈：溫和壓縮（收掉木柴爆裂、狼嚎等突出瞬態）→ 總音量 → 安全限幅
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -26;
    comp.knee.value = 18;
    comp.ratio.value = 2.5;
    comp.attack.value = 0.25;
    comp.release.value = 1.2;
    const master = ctx.createGain();
    master.gain.value = 0.8;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    // 壓縮器沒有前瞻，最後再用柔性削波保證不會破音
    const clip = ctx.createWaveShaper();
    clip.curve = softClipCurve();
    clip.oversample = '2x';
    comp.connect(master).connect(limiter).connect(clip).connect(ctx.destination);
    this.master = master;

    // 結尾淡出
    master.gain.setValueCurveAtTime(curve('ease', 0.8, 0), end - T.finalFade, T.finalFade);

    // ---- 干擾聲：先出現，然後音量下降、變悶、稍微變慢，像走遠了 ----
    if (this.noise) {
      const n = this.noise;
      const src = this.source(n.loop, 0);
      const norm = ctx.createGain();
      norm.gain.value = n.gain;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 18000;
      lp.Q.value = 0.5;
      const env = ctx.createGain();
      env.gain.value = 0;
      src.connect(norm).connect(lp).connect(env).connect(comp);

      // 讓畫面能「看見」干擾聲：每一聲通知都會讓線產生尖刺
      if (typeof ctx.createAnalyser === 'function' && !(window.OfflineAudioContext && ctx instanceof OfflineAudioContext)) {
        this.meter = ctx.createAnalyser();
        this.meter.fftSize = 1024;
        this.meterBuf = new Float32Array(this.meter.fftSize);
        env.connect(this.meter);
      }

      const rLen = T.noiseRecedeEnd - T.noiseRecedeStart;
      env.gain.setValueCurveAtTime(curve('in'), at(0), T.noiseFadeIn);
      env.gain.setValueCurveAtTime(curve('out'), at(T.noiseRecedeStart), rLen);
      lp.frequency.setValueAtTime(18000, at(T.noiseRecedeStart));
      lp.frequency.exponentialRampToValueAtTime(600, at(T.noiseRecedeEnd));
      src.playbackRate.setValueAtTime(1, at(T.noiseRecedeStart));
      src.playbackRate.linearRampToValueAtTime(0.94, at(T.noiseRecedeEnd));
      src.start(at(0));
      src.stop(at(T.noiseRecedeEnd + 0.5));
    }

    // ---- 庇護總線：白噪音逐漸接管，後段慢慢收掉高頻，聲音變暖 ----
    const bus = ctx.createGain();
    const warm = ctx.createBiquadFilter();
    warm.type = 'lowpass';
    warm.Q.value = 0.4;
    warm.frequency.value = 16000;
    bus.connect(warm).connect(comp);
    if (this.noise) {
      bus.gain.value = 0;
      bus.gain.setValueCurveAtTime(curve('ease'), at(shelterStart), T.shelterFullAt - shelterStart);
    } else {
      bus.gain.setValueCurveAtTime(curve('ease'), at(0), 6);
    }
    const warmFrom = this.noise ? T.shelterFullAt : 20;
    warm.frequency.setValueAtTime(16000, at(warmFrom));
    warm.frequency.exponentialRampToValueAtTime(5500, end);

    const bedLevel = bed ? L.bedLevel : 0;
    const fgLevel = Math.sqrt(1 - bedLevel ** 2); // 底層 + 前景總功率 ≈ 1

    if (bed) {
      const src = this.source(bed.loop, Math.random() * bed.loop.duration);
      const g = ctx.createGain();
      g.gain.value = bed.gain * bedLevel;
      src.connect(g).connect(bus);
      src.start(at(shelterStart));
      src.stop(end + 0.5);
    }

    // 前景片段：相鄰兩段在交界處等功率交叉淡化
    seq.forEach((s, i) => {
      const first = i === 0;
      const last = i === seq.length - 1;
      const X = Math.min(S.segmentCrossfade, s.dur * 0.8, last ? Infinity : seq[i + 1].dur * 0.8);
      const prevX = first ? 0 : Math.min(S.segmentCrossfade, s.dur * 0.8, seq[i - 1].dur * 0.8);
      const inAt = at(s.at - prevX / 2);
      const outAt = at(s.at + s.dur - X / 2);

      const src = this.source(s.clip.loop, Math.random() * s.clip.loop.duration);
      const norm = ctx.createGain();
      norm.gain.value = s.clip.gain * fgLevel;
      const env = ctx.createGain();
      src.connect(norm).connect(env).connect(bus);

      if (first) env.gain.value = 1;
      else {
        env.gain.value = 0;
        env.gain.setValueCurveAtTime(curve('in'), inAt, prevX);
      }
      if (!last) env.gain.setValueCurveAtTime(curve('out'), outAt, X);

      src.start(Math.max(inAt, ctx.currentTime));
      src.stop(last ? end + 0.5 : outAt + X + 0.1);
    });

    this.endTimer = setTimeout(() => this.finish(), (T.total + 0.6) * 1000);
    return t0;
  }

  source(buffer, offset) {
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    // 循環起點隨機，同一段素材每次聽起來都不完全一樣
    const orig = src.start.bind(src);
    src.start = (when) => orig(when, offset % buffer.duration);
    this.nodes.push(src);
    return src;
  }

  // 干擾聲目前的 RMS（0 ~ 約 0.3）
  get noiseLevel() {
    if (!this.meter || this.ended) return 0;
    this.meter.getFloatTimeDomainData(this.meterBuf);
    let s = 0;
    for (const v of this.meterBuf) s += v * v;
    return Math.sqrt(s / this.meterBuf.length);
  }

  get elapsed() {
    return Math.max(0, this.ctx.currentTime - this.t0);
  }

  // 提前結束：短暫淡出，不要突然切斷
  stop(fade = 2.5) {
    if (this.ended) return;
    clearTimeout(this.endTimer);
    const g = this.master.gain;
    const now = this.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + fade);
    this.endTimer = setTimeout(() => this.finish(), fade * 1000 + 100);
  }

  finish() {
    if (this.ended) return;
    this.ended = true;
    for (const n of this.nodes) {
      try { n.stop(); } catch { /* 已停止 */ }
    }
    this.ctx.close();
    if (this.onEnd) this.onEnd();
  }
}
