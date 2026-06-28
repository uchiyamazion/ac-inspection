const SHEET_NAME = '点検報告';
const USERS_SHEET_NAME = 'Users';

// フロントエンドのjs/config.jsと同じGoogle OAuthクライアントID（トークン検証用）
const GOOGLE_CLIENT_ID = '782190614995-5d4fur401smd1gpnnvs43h3m2q2q2ar3.apps.googleusercontent.com';

// 初回のみ：Usersシートが存在しない場合にここに記載のアドレスを管理者として登録する
const INITIAL_ADMINS = ['uchiyama@zion.co.jp', 'uchiyamazion@gmail.com'];


const COLUMNS = [
  'id', 'customerName', 'address', 'requester', 'reception',
  'systemName', 'productType', 'maker', 'model', 'serial', 'refrigerant',
  'refShip', 'refAdd', 'refRecover', 'refFill',
  'workDate', 'workStart', 'workEnd',
  'symptom', 'cause', 'workContent', 'remarks',
  'tempIndoorIn', 'tempIndoorOut', 'pressDischarge', 'pressSuction',
  'tempDischarge', 'tempSuction', 'tempOutdoor', 'current',
  'parts',
  'status', 'worker',
  'createdAt', 'updatedAt', 'customerSign'
];

function makeRes(data, status) {
  const payload = JSON.stringify({ status: status || 'ok', data: data });
  return ContentService
    .createTextOutput(payload)
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  const p = e.parameter;
  try {
    const action = p.action || 'list';
    if (action === 'list')   return makeRes(listRecords());
    if (action === 'get')    return makeRes(getRecord(p.id));
    if (action === 'saveSign') return makeRes(saveSignImage(p.id, p.signData, 'jpeg'));
    if (action === 'create') return makeRes(createRecord(JSON.parse(decodeURIComponent(p.data))));
    if (action === 'update') return makeRes(updateRecord(p.id, JSON.parse(decodeURIComponent(p.data))));
    if (action === 'delete') return makeRes(deleteRecord(p.id));
    if (action === 'checkAccess') return makeRes(checkAccess(p.idToken));
    if (action === 'listUsers')   return makeRes(adminListUsers(p.idToken));
    if (action === 'addUser')    return makeRes(adminAddUser(p.idToken, p.email, p.name, p.role));
    if (action === 'removeUser') return makeRes(adminRemoveUser(p.idToken, p.email));
    return makeRes({ message: '不明なaction' }, 'error');
  } catch (err) {
    return makeRes({ message: err.message }, 'error');
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;
    if (action === 'saveSign') return makeRes(saveSignImage(body.id, body.signData));
    if (action === 'update') return makeRes(updateRecord(body.id, body.data));
    if (action === 'create') return makeRes(createRecord(body.data));
    if (action === 'delete') return makeRes(deleteRecord(body.id));
    return makeRes({ message: '不明なaction' }, 'error');
  } catch (err) {
    return makeRes({ message: err.message }, 'error');
  }
}

function listRecords() {
  const sheet = getSheet();
  const rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return [];
  const headers = rows[0];
  const records = rows.slice(1).map(row => rowToObj(headers, row));
  records.sort((a, b) => {
    const da = a.workDate ? new Date(a.workDate).getTime() : 0;
    const db = b.workDate ? new Date(b.workDate).getTime() : 0;
    return db - da;
  });
  return records;
}

function getRecord(id) {
  const sheet = getSheet();
  const rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return null;
  const headers = rows[0];
  const idCol = headers.indexOf('id');
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][idCol] === id) return rowToObj(headers, rows[i]);
  }
  return null;
}

function rowToObj(headers, row) {
  const obj = {};
  headers.forEach((h, i) => {
    const val = row[i];
    if (val instanceof Date) {
      if (h === 'workStart' || h === 'workEnd') {
        obj[h] = Utilities.formatDate(val, 'Asia/Tokyo', 'HH:mm');
        if (obj[h] === '00:00') obj[h] = '';
      } else {
        obj[h] = Utilities.formatDate(val, 'Asia/Tokyo', 'yyyy-MM-dd');
      }
    } else {
      obj[h] = val;
    }
  });
  if (obj.parts && typeof obj.parts === 'string') {
    try { obj.parts = JSON.parse(obj.parts); } catch(e) { obj.parts = []; }
  }
  return obj;
}

function createRecord(data) {
  const sheet = getSheet();
  const id = Utilities.getUuid();
  const now = new Date().toISOString();
  const row = COLUMNS.map(col => {
    if (col === 'id') return id;
    if (col === 'createdAt' || col === 'updatedAt') return now;
    if (col === 'parts') return JSON.stringify(data.parts || []);
    return data[col] !== undefined ? data[col] : '';
  });
  sheet.appendRow(row);
  return { id };
}

function updateRecord(id, data) {
  const sheet = getSheet();
  const rows = sheet.getDataRange().getValues();
  const headers = rows[0];
  const idCol = headers.indexOf('id');
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][idCol] === id) {
      const now = new Date().toISOString();
      COLUMNS.forEach((col, j) => {
        if (col === 'id' || col === 'createdAt') return;
        if (col === 'updatedAt') { sheet.getRange(i+1, j+1).setValue(now); return; }
        if (col === 'parts') { sheet.getRange(i+1, j+1).setValue(JSON.stringify(data.parts || [])); return; }
        if (data[col] !== undefined) sheet.getRange(i+1, j+1).setValue(data[col]);
      });
      return { id };
    }
  }
  throw new Error('レコードが見つかりません');
}

function deleteRecord(id) {
  const sheet = getSheet();
  const rows = sheet.getDataRange().getValues();
  const headers = rows[0];
  const idCol = headers.indexOf('id');
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][idCol] === id) { sheet.deleteRow(i+1); return { id }; }
  }
  throw new Error('レコードが見つかりません');
}

function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(COLUMNS);
    const hr = sheet.getRange(1, 1, 1, COLUMNS.length);
    hr.setBackground('#0066cc');
    hr.setFontColor('white');
    hr.setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// ===== Google Driveにサイン画像を保存 =====
function saveSignImage(reportId, base64Data, imgType) {
  imgType = imgType || 'png';
  const mimeType = imgType === 'jpeg' ? 'image/jpeg' : 'image/png';
  const ext = imgType === 'jpeg' ? 'jpg' : 'png';
  const base64 = base64Data.replace(/^data:image\/(png|jpeg);base64,/, '');
  const blob = Utilities.newBlob(
    Utilities.base64Decode(base64),
    mimeType,
    'sign_' + reportId + '.' + ext
  );

  const folderName = '点検報告_サイン';
  let folder;
  const folders = DriveApp.getFoldersByName(folderName);
  if (folders.hasNext()) {
    folder = folders.next();
  } else {
    folder = DriveApp.createFolder(folderName);
  }

  ['png', 'jpg'].forEach(e => {
    const existing = folder.getFilesByName('sign_' + reportId + '.' + e);
    while (existing.hasNext()) existing.next().setTrashed(true);
  });

  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  const fileId = file.getId();
  const imageUrl = 'https://lh3.googleusercontent.com/d/' + fileId;

  updateSignUrl(reportId, imageUrl);

  return { imageUrl, fileId };
}

function updateSignUrl(reportId, imageUrl) {
  const sheet = getSheet();
  const rows = sheet.getDataRange().getValues();
  const headers = rows[0];
  const idCol = headers.indexOf('id');
  const signCol = headers.indexOf('customerSign');
  if (signCol === -1) return;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][idCol] === reportId) {
      sheet.getRange(i + 1, signCol + 1).setValue(imageUrl);
      return;
    }
  }
}

function authorizeApp() {
  DriveApp.getFolders();
  DriveApp.createFolder('__auth_test_delete_me__').setTrashed(true);
  SpreadsheetApp.getActiveSpreadsheet();
}

// ===== Googleログイン・ユーザー管理 =====

// フロントから送られたGoogleのID Tokenを検証し、本人確認済みのpayload(email/name/picture)を返す
function verifyIdToken(idToken) {
  if (!idToken) throw new Error('idTokenが指定されていません');
  const res = UrlFetchApp.fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
    { muteHttpExceptions: true }
  );
  if (res.getResponseCode() !== 200) throw new Error('トークンの検証に失敗しました（期限切れの可能性があります。再読み込みしてください）');
  const payload = JSON.parse(res.getContentText());
  if (payload.aud !== GOOGLE_CLIENT_ID) throw new Error('トークンの検証に失敗しました（クライアントIDが一致しません）');
  return payload;
}

function getUsersSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(USERS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(USERS_SHEET_NAME);
    sheet.appendRow(['email', 'name', 'role', 'addedAt']);
    const hr = sheet.getRange(1, 1, 1, 4);
    hr.setBackground('#0066cc');
    hr.setFontColor('white');
    hr.setFontWeight('bold');
    sheet.setFrozenRows(1);
    const now = new Date().toISOString();
    INITIAL_ADMINS.forEach(email => {
      sheet.appendRow([email.toLowerCase(), '', 'admin', now]);
    });
  }
  return sheet;
}

function listUsersRaw() {
  const sheet = getUsersSheet();
  const rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return [];
  return rows.slice(1)
    .filter(r => r[0])
    .map(r => ({ email: String(r[0]).toLowerCase(), name: r[1] || '', role: r[2] || 'user', addedAt: r[3] || '' }));
}

function findUserByEmail(email) {
  const target = (email || '').toLowerCase();
  return listUsersRaw().find(u => u.email === target) || null;
}

function requireAdmin(email) {
  const user = findUserByEmail(email);
  if (!user || user.role !== 'admin') throw new Error('管理者権限が必要です');
  return user;
}

// ログイン時のアクセス確認。idTokenはGoogleログイン直後に取得した本人確認済みトークン。
function checkAccess(idToken) {
  const payload = verifyIdToken(idToken);
  const email = (payload.email || '').toLowerCase();
  const user = findUserByEmail(email);
  return {
    allowed: !!user,
    isAdmin: !!(user && user.role === 'admin'),
    email: payload.email,
    name: payload.name || (user && user.name) || '',
    picture: payload.picture || ''
  };
}

function adminListUsers(idToken) {
  const payload = verifyIdToken(idToken);
  requireAdmin(payload.email);
  return listUsersRaw();
}

function adminAddUser(idToken, email, name, role) {
  const payload = verifyIdToken(idToken);
  requireAdmin(payload.email);
  if (!email) throw new Error('メールアドレスを入力してください');
  const sheet = getUsersSheet();
  const rows = sheet.getDataRange().getValues();
  const target = email.toLowerCase();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).toLowerCase() === target) {
      // 既存ユーザーは情報を更新
      sheet.getRange(i + 1, 2).setValue(name || rows[i][1] || '');
      sheet.getRange(i + 1, 3).setValue(role === 'admin' ? 'admin' : 'user');
      return listUsersRaw();
    }
  }
  sheet.appendRow([target, name || '', role === 'admin' ? 'admin' : 'user', new Date().toISOString()]);
  return listUsersRaw();
}

function adminRemoveUser(idToken, email) {
  const payload = verifyIdToken(idToken);
  requireAdmin(payload.email);
  const target = (email || '').toLowerCase();
  const users = listUsersRaw();
  const targetUser = users.find(u => u.email === target);
  if (targetUser && targetUser.role === 'admin') {
    const adminCount = users.filter(u => u.role === 'admin').length;
    if (adminCount <= 1) throw new Error('最後の管理者は削除できません');
  }
  const sheet = getUsersSheet();
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).toLowerCase() === target) {
      sheet.deleteRow(i + 1);
      return listUsersRaw();
    }
  }
  throw new Error('ユーザーが見つかりません');
}
