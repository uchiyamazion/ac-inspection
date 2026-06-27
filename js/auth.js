// Googleアカウントでのログイン処理
// セッション中のみ有効（タブを閉じる/ブラウザを終了すると再ログインが必要）

function initGoogleAuth() {
  const saved = sessionStorage.getItem('authUser');
  if (saved) {
    try {
      showApp(JSON.parse(saved));
      return;
    } catch (e) { sessionStorage.removeItem('authUser'); }
  }

  if (!GOOGLE_CLIENT_ID) {
    showLoginError('GoogleクライアントIDが設定されていません（js/config.js の GOOGLE_CLIENT_ID）');
    return;
  }
  if (typeof google === 'undefined' || !google.accounts) {
    showLoginError('Googleログインの読み込みに失敗しました。通信環境を確認してください。');
    return;
  }

  const initOptions = {
    client_id: GOOGLE_CLIENT_ID,
    callback: handleGoogleLogin,
  };
  if (typeof ALLOWED_DOMAIN !== 'undefined' && ALLOWED_DOMAIN) {
    initOptions.hd = ALLOWED_DOMAIN;
  }
  google.accounts.id.initialize(initOptions);
  google.accounts.id.renderButton(
    document.getElementById('g_id_signin'),
    { theme: 'outline', size: 'large', text: 'signin_with', locale: 'ja', width: 280 }
  );
}

function handleGoogleLogin(response) {
  const payload = decodeJwt(response.credential);
  if (!payload || !payload.email) {
    showLoginError('ログインに失敗しました。もう一度お試しください。');
    return;
  }
  if (!isEmailAllowed(payload.email)) {
    showLoginError('このアカウント（' + payload.email + '）はアクセスが許可されていません。管理者にお問い合わせください。');
    return;
  }
  const user = { email: payload.email, name: payload.name || payload.email, picture: payload.picture || '' };
  sessionStorage.setItem('authUser', JSON.stringify(user));
  showApp(user);
}

function isEmailAllowed(email) {
  const hasDomain = typeof ALLOWED_DOMAIN !== 'undefined' && ALLOWED_DOMAIN;
  const hasList = typeof ALLOWED_EMAILS !== 'undefined' && ALLOWED_EMAILS.length > 0;
  if (!hasDomain && !hasList) return true; // 制限未設定なら誰でも許可
  if (hasDomain && email.toLowerCase().endsWith('@' + ALLOWED_DOMAIN.toLowerCase())) return true;
  if (hasList && ALLOWED_EMAILS.map(e => e.toLowerCase()).includes(email.toLowerCase())) return true;
  return false;
}

function decodeJwt(token) {
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(base64).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')
    );
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
}

function showApp(user) {
  window.currentUser = user;
  document.getElementById('login-overlay').style.display = 'none';
  document.getElementById('app-root').style.display = '';
  const nameEl = document.getElementById('logged-in-name');
  if (nameEl) nameEl.textContent = user.name;
  const avatarEl = document.getElementById('logged-in-avatar');
  if (avatarEl && user.picture) avatarEl.src = user.picture;
}

function showLoginError(msg) {
  const el = document.getElementById('login-error');
  if (!el) return;
  el.textContent = msg;
  el.style.display = '';
}

window.logout = function () {
  sessionStorage.removeItem('authUser');
  if (typeof google !== 'undefined' && google.accounts) {
    google.accounts.id.disableAutoSelect();
  }
  location.reload();
};

window.addEventListener('DOMContentLoaded', initGoogleAuth);
