// 素材分析：靜音修剪、近似 LUFS 響度、穩定度、明亮度
// 響度依 ITU-R BS.1770 的做法：K-weighting → 400ms 區塊（75% 重疊）→ 絕對/相對門限

const ABS_GATE = -70;
const lufs = (ms) => -0.691 + 10 * Math.log10(ms);
const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;

// 找出頭尾的靜音（YouTube 片段常有淡入淡出或編碼器補的空白），避免循環時出現斷點
function findTrim(buffer) {
  const sr = buffer.sampleRate;
  const chans = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  const n = buffer.length;

  let peak = 0;
  for (const c of chans) {
    for (let i = 0; i < n; i++) {
      const v = Math.abs(c[i]);
      if (v > peak) peak = v;
    }
  }
  if (peak === 0) return { start: 0, end: 0 };

  const th = peak * 10 ** (-48 / 20);
  const above = (i) => chans.some((c) => Math.abs(c[i]) > th);
  let a = 0;
  while (a < n && !above(a)) a++;
  let b = n - 1;
  while (b > a && !above(b)) b--;

  const pad = Math.round(0.02 * sr);
  return { start: Math.max(0, a - pad) / sr, end: Math.min(n, b + pad) / sr };
}

export async function analyzeClip(buffer) {
  const sr = buffer.sampleRate;
  const { start, end } = findTrim(buffer);

  // 一次離線渲染同時取得兩個量測訊號：
  // ch0 = K-weighted（響度），ch1 = 2.5kHz 以上（明亮度）
  const ctx = new OfflineAudioContext(2, buffer.length, sr);
  const src = ctx.createBufferSource();
  src.buffer = buffer;

  const mono = ctx.createGain();
  mono.channelCount = 1;
  mono.channelCountMode = 'explicit';
  mono.channelInterpretation = 'speakers';

  const shelf = ctx.createBiquadFilter();
  shelf.type = 'highshelf';
  shelf.frequency.value = 1500;
  shelf.gain.value = 4;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 38;
  hp.Q.value = 0.5;
  const bright = ctx.createBiquadFilter();
  bright.type = 'highpass';
  bright.frequency.value = 2500;

  const merger = ctx.createChannelMerger(2);
  src.connect(mono);
  mono.connect(shelf).connect(hp).connect(merger, 0, 0);
  mono.connect(bright).connect(merger, 0, 1);
  merger.connect(ctx.destination);
  src.start();
  const out = await ctx.startRendering();

  const k = out.getChannelData(0);
  const h = out.getChannelData(1);
  const hop = Math.round(sr * 0.1);
  const s0 = Math.floor(start * sr);
  const s1 = Math.floor(end * sr);

  const hops = [];
  let kTotal = 0;
  let hTotal = 0;
  for (let i = s0; i + hop <= s1; i += hop) {
    let a = 0;
    let b = 0;
    for (let j = i; j < i + hop; j++) {
      a += k[j] * k[j];
      b += h[j] * h[j];
    }
    hops.push(a / hop);
    kTotal += a;
    hTotal += b;
  }

  const result = { start, end, loudness: -Infinity, steadiness: Infinity, brightness: 0 };
  if (hops.length < 4) return result;

  // 400ms 區塊，75% 重疊
  const blocks = [];
  for (let i = 0; i + 4 <= hops.length; i++) blocks.push((hops[i] + hops[i + 1] + hops[i + 2] + hops[i + 3]) / 4);

  const absGated = blocks.filter((ms) => lufs(ms) > ABS_GATE);
  if (!absGated.length) return result;
  const relGate = lufs(mean(absGated)) - 10;
  const gated = absGated.filter((ms) => lufs(ms) > relGate);
  result.loudness = lufs(mean(gated));

  // 穩定度：3 秒短期響度的標準差（越小越適合當持續的底層）
  let st = [];
  for (let i = 0; i + 30 <= hops.length; i += 5) st.push(lufs(mean(hops.slice(i, i + 30))));
  st = st.filter((v) => v > ABS_GATE);
  if (st.length < 2) st = absGated.map(lufs);
  const m = mean(st);
  result.steadiness = Math.sqrt(mean(st.map((v) => (v - m) ** 2)));

  result.brightness = kTotal > 0 ? hTotal / kTotal : 0;
  return result;
}
