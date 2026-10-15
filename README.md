# 白噪音庇護所 (White Noise Shelter)

從數位雜音走向安靜的聲音旅程。

## 專案結構

- `index.html`：主頁面（進場、旅程、結束經文與錯誤提示畫面）
- `css/style.css`：暗場低亮度暖灰視覺樣式
- `js/config.js`：時間軸、LUFS 響度目標、拼接參數與字幕設定
- `js/main.js`：畫面與流程控制，支援本機 `server.js` 動態掃描與 GitHub Pages 靜態清單 (`api/playlist.json`)
- `js/engine.js`：Web Audio API 聲音引擎（無縫循環、響度平衡、等功率交叉淡化）
- `js/analysis.js`：ITU-R BS.1770 K-weighting 響度、穩定度與明亮度分析
- `js/visuals.js`：Canvas 呼吸與雜音尖刺細線動畫
- `api/playlist.json` & `api/playlist`：提供給 GitHub Pages 靜態環境直接載入的播放清單
- `server.js` / `start.bat`：本機零依賴 Node.js 伺服器

## 音訊檔案配置

請確保以下音訊檔案位於對應目錄中（可直接透過 GitHub 網頁介面上傳至對應資料夾）：

- `audio/annoying_notification.mp3`
- `audio/shelter/Crackling_Firewood_Burning_Relaxing_Sounds_Reel-[uh8sNG-f8LA].mp3`
- `audio/shelter/Forest_Full_Moon_Night_Sounds_Wolf_Owl_Crickets_Nature_Ambience_Sleep_ASMR_Meditation_Healing-[KMSVKUrbIwc].mp3`
- `audio/shelter/Relaxing Sound of Rain Puddles Light Rain and Rain Drops Falling [Go6vFy7LK5Y].mp3`
- `audio/shelter/Relaxing_Escapes_Beach_and_Waves_Reels_mp4-[Jt4mOe-9avs].mp3`
- `audio/shelter/Snow_Footsteps_Sound_Effects-[N498-usVszg].mp3`
- `audio/shelter/Wind_Blowing_Through_Grass_Sound_Effect-[fCLSi8eNmhE].mp3`

## 部署至 GitHub Pages

1. 將上述 `.mp3` 音訊檔上傳至 `audio/` 及 `audio/shelter/` 目錄。
2. 前往 Repository 的 **Settings → Pages**。
3. 在 **Build and deployment** 下選擇 **Deploy from a branch**，分支選擇 `main`（目錄 `/ (root)`）並儲存。
