# 空調機器 点検・作業報告システム

シオンテクノス株式会社向け。Google スプレッドシート + GAS をDBとして使用。GitHub Pages でフロントエンドを公開。

## 構成

```
フロントエンド (GitHub Pages)
        ↓ fetch API
Google Apps Script (ウェブアプリ)
        ↓
Google スプレッドシート (DB) + Google Drive (サイン画像)
```

## ファイル

- `index.html` — 入力フォーム＋履歴一覧（お客様サイン欄あり）
- `print.html` — 印刷用帳票（元の紙フォーマットを再現）
- `view.html` — QRコードから開く、お客様向け閲覧専用ページ
- `Code.gs` — GASバックエンド
- `css/style.css` / `css/sign-additions.css` — スタイル
- `js/config.js` — ★ GAS_URLを設定
- `js/app.js` — フロントロジック

## セットアップ

### ① スプレッドシート＋GAS

1. Googleスプレッドシートを新規作成
2. 「拡張機能」→「Apps Script」→ `Code.gs` の内容を貼り付け
3. 「デプロイ」→「新しいデプロイ」→ ウェブアプリ／実行：自分／アクセス：全員
4. デプロイURLをコピー

### ② config.js を設定

`js/config.js` の `GAS_URL` をコピーしたURLに書き換え

### ③ GitHub Pages

Settings → Pages → Source: GitHub Actions

## GAS再デプロイ時の注意

コード変更後は必ず「デプロイを管理」→ 編集 →「新しいバージョン」→「デプロイ」してください。URLは変わりません。

## サイン機能について

- お客様サインは入力フォーム（index.html）の「作業確認」セクションで取得
- 保存時にサイン画像を圧縮してGoogle Driveに保存、URLをスプレッドシートに記録
- print.html・view.htmlは保存済みサインを表示するのみ（入力機能なし）
