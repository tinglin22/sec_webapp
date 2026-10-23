# 職安題庫 — 部署說明

## 1. 填入 Supabase 設定（只需改 config.js 一個檔案）
Supabase 後台 → Settings → API：
- `url`：Project URL
- `anonKey`：**anon public** key（絕對不要放 service_role key）

## 2. 放上 GitHub Pages
1. GitHub 新增 repository（例如 `osh-quiz`），把這個資料夾裡**所有檔案**上傳到根目錄
2. Settings → Pages → Source 選 `Deploy from a branch` → Branch 選 `main` / `(root)` → Save
3. 約 1 分鐘後網址是 `https://tinglin22.github.io/osh-quiz/`

## 3. Android 加到桌面
用 Chrome 開上面的網址 → 右上角 ⋮ → 「安裝應用程式」（或「加到主畫面」）。
第一次需要連網下載題庫；之後離線也能練習，作答紀錄會在有網路時自動上傳。

## 4. 之後更新
- **新匯入題目（part2…）**：用 import_questions.py 匯入後，App 的「統計」頁按「重新同步題庫與進度」
- **修改了程式檔案**：把 `service-worker.js` 第一行的 `osh-quiz-v1` 改成 `v2`（每次 +1），手機才會抓到新版

## 5. 前提
Supabase 已執行過 schema.sql（questions / user_progress 兩張表 + RLS policy）。
