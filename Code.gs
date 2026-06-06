const SHEET_NAME = '点検報告';

const COLUMNS = [
  'id', 'customerName', 'address', 'requester', 'reception',
  'systemName', 'productType', 'maker', 'model', 'serial', 'refrigerant',
  'refShip', 'refAdd', 'refRecover', 'refFill',
  'workDate', 'workStart', 'workEnd',
  'symptom', 'cause', 'workContent', 'remarks',
  'tempIndoorIn', 'tempIndoorOut', 'pressDischarge', 'pressSuction',
  'tempDischarge', 'tempSuction', 'tempOutdoor', 'current',
  'parts',
  'status', 'worker', 'confirmer',
  'createdAt', 'updatedAt', 'customerSign'
];

// CORSヘッダー付きレスポンス
function makeRes(data, status) {
  const payload = JSON.stringify({ status: status || 'ok', data: data });
  return ContentService
    .createTextOutput(payload)
    .setMimeType(ContentService.MimeType.JSON);
}

// GETリクエスト（list / get / create / update / delete）
function doGet(e) {
  const p = e.parameter;
  try {
    const action = p.action || 'list';
    if (action === 'list')   return makeRes(listRecords());
    if (action === 'get')    return makeRes(getRecord(p.id));
    if (action === 'create') return makeRes(createRecord(JSON.parse(decodeURIComponent(p.data))));
    if (action === 'update') return makeRes(updateRecord(p.id, JSON.parse(decodeURIComponent(p.data))));
    if (action === 'delete') return makeRes(deleteRecord(p.id));
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
    obj[h] = val instanceof Date
      ? Utilities.formatDate(val, 'Asia/Tokyo', 'yyyy-MM-dd')
      : val;
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
