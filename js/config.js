// 可調整的設定集中在這裡
export const CONFIG = {
  // 時間軸（秒）
  timeline: {
    noiseFadeIn: 1,        // 干擾聲淡入
    shelterStart: 16,      // 白噪音開始極輕地浮現（前 16 秒只有干擾聲）
    shelterFullAt: 38,     // 白噪音完全接管
    noiseRecedeStart: 18,  // 干擾聲開始退場（音量下降 + 聲音變遠變悶）
    noiseRecedeEnd: 38,    // 干擾聲完全消失
    total: 165,            // 全程約 2 分 45 秒
    finalFade: 14,         // 結尾淡出長度
  },

  // 響度目標（近似 LUFS，ITU-R BS.1770 K-weighting + gating）
  loudness: {
    shelterTarget: -20,
    noiseTarget: -22,
    bedLevel: 0.32,        // 底層持續襯底的相對音量
    maxBoostDb: 20,
    maxCutDb: -30,
  },

  // 拼接參數
  splice: {
    segmentCrossfade: 7,   // 片段之間的等功率交叉淡化
    minSegment: 18,        // 每段至少停留多久，避免太頻繁切換
    loopCrossfadeMax: 3,   // 短素材自我循環時的交叉淡化
  },

  // 旅程中的文字（time / dur 為秒）
  captions: [
    { time: 2, dur: 8, text: '這些，是每天圍繞著你的聲音。' },
    { time: 11, dur: 9, text: '你的注意力，被什麼奪去了嗎？' },
    { time: 23, dur: 10, text: '讓它們，慢慢走遠。' },
    { time: 46, dur: 10, text: '現在，只剩下安靜。' },
    { time: 88, dur: 10, text: '不用回應，也不用趕。' },
    { time: 124, dur: 11, text: '聽一聽，自己的呼吸。' },
  ],
};
