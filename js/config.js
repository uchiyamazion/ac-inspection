// ★ GASデプロイURLの設定ファイル
// GASを再デプロイしてURLが変わった場合はここだけ更新してください
const GAS_URL = 'https://script.google.com/macros/s/AKfycbxgC4dWlIAfnta3K055q4ure9I5sqXL4m0-SEOTiCWTz9Evt3dCYhvoYTrACXMn-to/exec';

// ★ Googleログインの設定
// Google Cloud Console (https://console.cloud.google.com/apis/credentials) で
// 「OAuth クライアント ID」(種類: ウェブ アプリケーション) を作成し、
// 承認済みの JavaScript 生成元 に GitHub Pages の URL (例: https://uchiyamazion.github.io) を登録してください。
const GOOGLE_CLIENT_ID = ''; // ここに発行されたクライアントIDを設定（未設定の間はログイン画面にエラー表示）

// 会社のGoogle Workspaceドメインでまとめて許可する場合はここに設定（例: 'siontechnos.co.jp'）。不要なら空文字のまま。
const ALLOWED_DOMAIN = '';

// 個別にアクセスを許可するメールアドレス（ALLOWED_DOMAINと併用可）。両方空の場合は誰でもログイン可能になります。
const ALLOWED_EMAILS = [
  // 'example@gmail.com',
];

