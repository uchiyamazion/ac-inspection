// Googleアカウントでのログイン処理
// セッション中のみ有効（タブを閉じる/ブラウザを終了すると再ログインが必要）
// アクセス許可・管理者判定はGAS側のUsersシートで管理（js/config.jsのALLOWED_EMAILSは現在未使用）

async function authGasCall(params) {
  const url = GAS_URL + '?' + new URLSearchParams(params).toString();
  const res = await fetch(url, { redirect: 'follow' });
  const json = await res.json();
  if (json.status === 'error') throw new Error(json.data?.message || 'エラー');
  return json.data;
}

function initGoogleAuth(retryCount) {
  retryCount = retryCount || 0;
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
    // Googleのスクリプトが非同期で読み込み中の場合があるので、少し待って再試行する
    if (retryCount < 25) {
      setTimeout(() => initGoogleAuth(retryCount + 1), 200);
      return;
    }
    showLoginError('Googleログインの読み込みに失敗しました。広告/トラッキングブロッカーをご利用の場合は無効にして再読み込みしてください。');
    return;
  }

  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: handleGoogleLogin,
  });
  google.accounts.id.renderButton(
    document.getElementById('g_id_signin'),
    { theme: 'outline', size: 'large', text: 'signin_with', locale: 'ja', width: 280 }
  );
}

async function handleGoogleLogin(response) {
  const idToken = response.credential;
  const payload = decodeJwt(idToken);
  if (!payload || !payload.email) {
    showLoginError('ログインに失敗しました。もう一度お試しください。');
    return;
  }
  try {
    const result = await authGasCall({ action: 'checkAccess', idToken });
    if (!result.allowed) {
      showLoginError('このアカウント（' + payload.email + '）はアクセスが許可されていません。管理者にお問い合わせください。');
      return;
    }
    const user = {
      email: result.email || payload.email,
      name: result.name || payload.name || payload.email,
      picture: result.picture || payload.picture || '',
      isAdmin: !!result.isAdmin,
      idToken: idToken
    };
    sessionStorage.setItem('authUser', JSON.stringify(user));
    showApp(user);
  } catch (e) {
    showLoginError('アクセス確認中にエラーが発生しました: ' + e.message);
  }
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
  const adminBtn = document.getElementById('admin-nav-btn');
  if (adminBtn) adminBtn.style.display = user.isAdmin ? '' : 'none';
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

// ===== 管理者: ユーザー管理モーダル =====

window.openUsersModal = async function () {
  document.getElementById('users-modal').classList.add('open');
  document.getElementById('users-error').style.display = 'none';
  await refreshUsersList();
};

window.closeUsersModal = function (event) {
  if (event && event.target.id !== 'users-modal') return;
  document.getElementById('users-modal').classList.remove('open');
};

async function refreshUsersList() {
  const listEl = document.getElementById('users-list');
  listEl.innerHTML = '<p style="font-size:13px;color:var(--text-sub)">読み込み中...</p>';
  try {
    const users = await authGasCall({ action: 'listUsers', idToken: window.currentUser.idToken });
    if (!users.length) {
      listEl.innerHTML = '<p style="font-size:13px;color:var(--text-sub)">登録されたユーザーがいません</p>';
      return;
    }
    listEl.innerHTML = users.map(u => (
      '<div class="user-row">' +
        '<div class="user-row-info">' +
          '<div class="user-row-email">' + escapeHtml(u.email) + '</div>' +
          (u.name ? '<div class="user-row-name">' + escapeHtml(u.name) + '</div>' : '') +
        '</div>' +
        (u.role === 'admin' ? '<span class="user-row-badge">管理者</span>' : '') +
        '<button class="btn btn-ghost btn-sm" onclick="removeUserFromModal(\'' + escapeHtml(u.email).replace(/'/g, "\\'") + '\')">削除</button>' +
      '</div>'
    )).join('');
  } catch (e) {
    listEl.innerHTML = '';
    showUsersError(e.message);
  }
}

window.addUserFromModal = async function () {
  const email = document.getElementById('new-user-email').value.trim();
  const name = document.getElementById('new-user-name').value.trim();
  const isAdminChecked = document.getElementById('new-user-admin').checked;
  if (!email) { showUsersError('メールアドレスを入力してください'); return; }
  try {
    await authGasCall({
      action: 'addUser', idToken: window.currentUser.idToken,
      email, name, role: isAdminChecked ? 'admin' : 'user'
    });
    document.getElementById('new-user-email').value = '';
    document.getElementById('new-user-name').value = '';
    document.getElementById('new-user-admin').checked = false;
    document.getElementById('users-error').style.display = 'none';
    await refreshUsersList();
  } catch (e) {
    showUsersError(e.message);
  }
};

window.removeUserFromModal = async function (email) {
  if (!confirm(email + ' を削除しますか？')) return;
  try {
    await authGasCall({ action: 'removeUser', idToken: window.currentUser.idToken, email });
    await refreshUsersList();
  } catch (e) {
    showUsersError(e.message);
  }
};

function showUsersError(msg) {
  const el = document.getElementById('users-error');
  el.textContent = msg;
  el.style.display = '';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

window.addEventListener('DOMContentLoaded', initGoogleAuth);
