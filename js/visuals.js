// 黑底上的一條細線
// 雜音期：線隨干擾聲顫動，每一聲通知都是一道尖刺（直接讀取干擾聲的音量）
// 過渡期：尖刺消失，線慢慢變成柔和的波
// 安息期：幾乎平靜的暖色細線，以約 10 秒的節奏呼吸
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (t) => t * t * (3 - 2 * t);
const mix = (a, b, t) => a.map((v, i) => Math.round(lerp(v, b[i], t)));
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

const COOL = [186, 192, 200];  // 雜音：冷灰白
const WARM = [214, 168, 112];  // 安息：暗琥珀
const N = 180;                 // 線上的取樣點數
const JITTER_STEP = 0.08;      // 顫動取樣間隔（秒），點與點之間平滑內插
const LEVEL_REF = 0.06;        // 干擾聲正常響度下的 RMS，作為尖刺高度的基準

export class Line {
  constructor(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.phase = 1;
    this.target = 1;
    this.presence = 0;
    this.presenceTarget = 0.35;
    this.level = 0;
    this.levelAvg = 0;
    this.lastSpike = 0;
    this.spikes = [];
    this.jitA = new Float32Array(N + 1);
    this.jitB = this.randomJitter();
    this.jitClock = 0;
    this.motion = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0.35 : 1;
    this.t = 0;
    this.last = performance.now();

    this.resize = this.resize.bind(this);
    window.addEventListener('resize', this.resize);
    this.resize();
    requestAnimationFrame((n) => this.frame(n));
  }

  randomJitter() {
    return Float32Array.from({ length: N + 1 }, () => Math.random() * 2 - 1);
  }

  resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = Math.round(innerWidth * this.dpr);
    this.h = Math.round(innerHeight * this.dpr);
    this.canvas.width = this.w;
    this.canvas.height = this.h;
  }

  // immediate：直接切換（例如干擾聲一出現，線就立刻變成雜音狀態）
  setPhase(p, immediate = false) {
    this.target = clamp01(p);
    if (immediate) this.phase = this.target;
  }
  setPresence(v) { this.presenceTarget = v; }
  setLevel(v) { this.level = v; }

  frame(now) {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.t += dt;
    this.phase += (this.target - this.phase) * Math.min(1, dt * 0.8);
    this.presence += (this.presenceTarget - this.presence) * Math.min(1, dt * 0.6);

    // 偵測干擾聲的起音（音量突然上升）→ 產生一道尖刺
    const lv = this.level;
    this.levelAvg += (lv - this.levelAvg) * Math.min(1, dt * 3);
    if (lv > LEVEL_REF * 0.4 && lv > this.levelAvg * 1.3 && this.t - this.lastSpike > 0.14 && this.phase < 0.6) {
      this.lastSpike = this.t;
      this.spikes.push({
        x: 0.15 + Math.random() * 0.7,
        w: 0.025 + Math.random() * 0.05,
        k: 3 + Math.random() * 4,
        amp: (0.6 + Math.random() * 0.4) * Math.min(1, 0.35 + lv / LEVEL_REF) * (Math.random() < 0.5 ? -1 : 1),
        born: this.t,
      });
    }
    this.spikes = this.spikes.filter((s) => this.t - s.born < 2);

    this.jitClock += dt;
    if (this.jitClock >= JITTER_STEP) {
      this.jitClock = 0;
      this.jitA = this.jitB;
      this.jitB = this.randomJitter();
    }

    this.draw();
    requestAnimationFrame((n) => this.frame(n));
  }

  draw() {
    const { g, w, h, dpr, phase: p, t, motion } = this;
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);
    if (this.presence < 0.005) return;

    const span = Math.min(w * 0.72, 960 * dpr);
    const x0 = (w - span) / 2;
    const cy = h * 0.46;

    // 呼吸：吸 4 秒、吐 6 秒
    const ph = (t % 10) / 10;
    const breath = ph < 0.4
      ? 0.5 - 0.5 * Math.cos((ph / 0.4) * Math.PI)
      : 0.5 + 0.5 * Math.cos(((ph - 0.4) / 0.6) * Math.PI);

    const noiseW = (1 - p) ** 1.5;
    const lvN = Math.min(1, this.level / LEVEL_REF);
    const jitterPx = noiseW * (1.5 + 6 * lvN) * dpr * motion;
    const spikePx = Math.min(64 * dpr, h * 0.08) * noiseW * motion;
    const calmPx = dpr * motion * (2 + 7 * Math.sin(Math.PI * p)) * (p > 0.5 ? lerp(1, 0.7 + 0.3 * breath, (p - 0.5) * 2) : 1);
    const speed = lerp(0.9, 0.35, p);
    const jf = this.jitClock / JITTER_STEP;

    g.beginPath();
    for (let i = 0; i <= N; i++) {
      const x = i / N;
      const win = Math.sin(Math.PI * x) ** 1.2;
      let y = lerp(this.jitA[i], this.jitB[i], jf) * jitterPx;
      for (const s of this.spikes) {
        const d = (x - s.x) / s.w;
        if (Math.abs(d) < 1) {
          y += s.amp * Math.exp(-(t - s.born) / 0.5) * (1 - Math.abs(d)) * Math.cos(d * s.k * Math.PI) * spikePx;
        }
      }
      y += Math.sin(Math.PI * 2 * 1.1 * x - t * speed) * calmPx;
      const px = x0 + x * span;
      const py = cy + y * win;
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }

    const col = mix(COOL, WARM, smooth(clamp01(p)));
    const alpha = this.presence * lerp(0.6, 0.42, p) * (1 + p * 0.4 * (breath - 0.5));
    const grad = g.createLinearGradient(x0, 0, x0 + span, 0);
    grad.addColorStop(0, rgba(col, 0));
    grad.addColorStop(0.18, rgba(col, alpha));
    grad.addColorStop(0.82, rgba(col, alpha));
    grad.addColorStop(1, rgba(col, 0));

    g.strokeStyle = grad;
    g.lineWidth = dpr * lerp(1.1, 1.5, p);
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.shadowColor = rgba(col, alpha * 0.7);
    g.shadowBlur = dpr * lerp(3, 14, p);
    g.stroke();
    g.shadowBlur = 0;
  }
}
