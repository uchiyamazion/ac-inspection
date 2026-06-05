// ============================================================
// 空調機器 点検・作業報告システム — Google Apps Script バックエンド
// ============================================================
// 【設定】このスクリプトが紐付いているスプレッドシートのシート名
const SHEET_NAME = '点検報告';

// ヘッダー列の定義（スプレッドシートの列順）
const COLUMNS = [
  'id', 'customerName', 'address', 'requester', 'reception',
  'systemName', 'productType', 'maker', 'model', 'serial', 'refrigerant',
  'refShip', 'refAdd', 'refRecover', 'refFill',
  'workDate', 'workStart', 'workEnd',
  'symptom', 'cause', 'workContent', 'remarks',
  'tempIndoorIn', 'tempIndoorOut', 'pressDischarge', 'pressSuction',
  'tempDischarge', 'tempSuction', 'tempOutdoor', 'current',
  'parts',       // JSON文字列で保存
  'status', 'worker', 'confirmer',
  'createdAt', 'updatedAt'
];

// ===== CORS対応レスポンス =====
function makeRes(data, status) {
  const payload = JSON.stringify({ status: status || 'ok', data });
  return ContentService
    .createTextOutput(payload)
    .setMimeType(ContentService.MimeType.JSON);
}

// ===== GETリクエスト（一覧取得） =====
function doGet(e) {
  try {
    const sheet = getSheet();
    const rows = sheet.getDataRange().getValues();
    if (rows.length <= 1) return makeRes([]);

    const headers = rows[0];
    const records = rows.slice(1).map(row => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i]; });
      // partsをJSONパース
      if (obj.parts && typeof obj.parts === 'string') {
        try { obj.parts = JSON.parse(obj.parts); } catch { obj.parts = []; }
      }
      return obj;
    });

    // 作業日の降順で返す
    records.sort((a, b) => (b.workDate || '').localeCompare(a.workDate || ''));
    return makeRes(records);
  } catch (err) {
    return makeRes({ message: err.message }, 'error');
  }
}

// ===== POSTリクエスト（追加・更新・削除） =====
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;

    if (action === 'create') return createRecord(body.data);
    if (action === 'update') return updateRecord(body.id, body.data);
    if (action === 'delete') return deleteRecord(body.id);

    return makeRes({ message: '不明なaction' }, 'error');
  } catch (err) {
    return makeRes({ message: err.message }, 'error');
  }
}

// ===== 作成 =====
function createRecord(data) {
  const sheet = getSheet();
  ensureHeader(sheet);
  const id = Utilities.getUuid();
  const now = new Date().toISOString();
  const row = COLUMNS.map(col => {
    if (col === 'id') return id;
    if (col === 'createdAt') return now;
    if (col === 'updatedAt') return now;
    if (col === 'parts') return JSON.stringify(data.parts || []);
    return data[col] !== undefined ? data[col] : '';
  });
  sheet.appendRow(row);
  return makeRes({ id });
}

// ===== 更新 =====
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
        if (col === 'updatedAt') {
          sheet.getRange(i + 1, j + 1).setValue(now);
          return;
        }
        if (col === 'parts') {
          sheet.getRange(i + 1, j + 1).setValue(JSON.stringify(data.parts || []));
          return;
        }
        if (data[col] !== undefined) {
          sheet.getRange(i + 1, j + 1).setValue(data[col]);
        }
      });
      return makeRes({ id });
    }
  }
  return makeRes({ message: 'レコードが見つかりません' }, 'error');
}

// ===== 削除 =====
function deleteRecord(id) {
  const sheet = getSheet();
  const rows = sheet.getDataRange().getValues();
  const headers = rows[0];
  const idCol = headers.indexOf('id');

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][idCol] === id) {
      sheet.deleteRow(i + 1);
      return makeRes({ id });
    }
  }
  return makeRes({ message: 'レコードが見つかりません' }, 'error');
}

// ===== ヘルパー =====
function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(COLUMNS);
    // ヘッダー行を装飾
    const headerRange = sheet.getRange(1, 1, 1, COLUMNS.length);
    headerRange.setBackground('#0066cc');
    headerRange.setFontColor('white');
    headerRange.setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function ensureHeader(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(COLUMNS);
  }
}
