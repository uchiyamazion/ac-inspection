# 空調機器 点検・作業報告システム

Google スプレッドシート + GAS をDBとして使用。GitHub Pages でフロントエンドを公開。

## 構成

```
フロントエンド (GitHub Pages)
        ↓ fetch API
Google Apps Script (ウェブアプリ)
        ↓
Google スプレッドシート (DB)
```

---

## セットアップ手順

### ① Google スプレッドシートの作成

1. [Google スプレッドシート](https://sheets.google.com) で新規作成（名前は任意）

### ② GASを設定する

1. スプレッドシート → メニュー「拡張機能」→「Apps Script」
2. `コード.gs` の内容をすべて削除 → **Code.gs** の内容を貼り付けて保存

### ③ ウェブアプリとしてデプロイ

1. 「デプロイ」→「新しいデプロイ」
2. 種類: **ウェブアプリ**
3. 実行ユーザー: **自分**  /  アクセス: **全員**（または「組織内全員」）
4. デプロイ → 承認 → **ウェブアプリのURL** をコピー

### ④ フロントにURLを設定

`js/app.js` 先頭の `GAS_URL` を書き換える：

```js
const GAS_URL = 'https://script.google.com/macros/s/AKfyc.../exec';
```

### ⑤ GitHubにプッシュ → Pages公開

```bash
git init && git add . && git commit -m "init"
git remote add origin https://github.com/YOUR_NAME/ac-inspection.git
git push -u origin main
```

Settings → Pages → Source: **GitHub Actions** を選択。

---

## GASを更新したとき

コードを変更後、「デプロイ」→「デプロイを管理」→「✏ 編集」→「新しいバージョン」で保存。URLは変わりません。
