/**
 * シオンテクノス株式会社
 * 統合GAS - 空調点検報告 + フロン管理システム
 * スプレッドシート: 自社案件SPS
 */

const SS = () => SpreadsheetApp.getActiveSpreadsheet();
const sheet = (name) => SS().getSheetByName(name);

function makeRes(data, status) {
  status = status || 'success';
  const payload = JSON.stringify({ status, data });
  return ContentService.createTextOutput(payload)
    .setMimeType(ContentService.MimeType.JSON);
}

function makeErr(msg) {
  return makeRes(msg, 'error');
}

// ════════════════════════════════════════════════
// doGet / doPost ルーター
// ════════════════════════════════════════════════

function doGet(e) {
  const __g = authGuard_(e); if (__g) return __g;
  try {
    const p = e.parameter || {};
    const action = p.action || 'list';

    // dataパラメータをデコード（create/update/saveSign共通）
    let data = {};
    if (p.data) {
      try { data = JSON.parse(decodeURIComponent(p.data)); } catch(_) {}
    }
    if (p.id) data.id = p.id;

    switch (action) {
      case 'list':        return acList();
      case 'get':         return acGet(p.id);
      case 'create':      return acCreate(data);
      case 'update':      return acUpdate(data);
      case 'delete':      return acDelete(data);
      case 'saveSign':    return acSaveSign({ id: p.id, signData: p.signData });
      case 'fron_load':   return fronLoad();
      case 'eq_list':     return eqList();
      case 'eq_search':   return eqSearch(p.q || '');
      case 'fill_list':   return fillList(p.eqId, p.year);
      case 'leak_summary':return leakSummary(p.year);
      case 'ky_list':     return kyList();
      case 'ky_get':      return kyGet(p.id);
      default:            return makeErr('不明なaction: ' + action);
    }
  } catch(err) {
    return makeErr(err.toString());
  }
}

function doPost(e) {
  const __g = authGuard_(e); if (__g) return __g;
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;
    const payload = body.payload || body;

    switch (action) {
      // ── ac-inspection ──
      case 'create':      return acCreate(payload);
      case 'update':      return acUpdate(payload);
      case 'saveSign':    return acSaveSign(payload);
      case 'delete':      return acDelete(payload);

      // ── フロン管理 ──
      case 'fron_save':   return fronSave(payload);
      case 'eq_upsert':   return eqUpsert(payload.data || payload);
      case 'eq_delete':   return eqDelete(payload.id || payload);
      case 'fill_create': return fillCreate(payload.data || payload);
      case 'fill_delete': return fillDelete(payload.id || payload);
      case 'legal_create':return legalCreate(payload.data || payload);
      case 'legal_delete':return legalDelete(payload.id || payload);

      // ── KY(危険予知)活動 ──
      case 'ky_create':   return kyCreate(payload.data || payload);
      case 'ky_delete':   return kyDelete(payload.id || payload);
      case 'ky_sign':     return kySign(payload.data || payload);

      default:            return makeErr('不明なaction: ' + action);
    }
  } catch(err) {
    return makeErr(err.toString());
  }
}

// ════════════════════════════════════════════════
// ac-inspection: 点検報告
// ════════════════════════════════════════════════

function sheetToObjects(sh) {
  const vals = sh.getDataRange().getValues();
  if (vals.length < 2) return [];
  const headers = vals[0];
  return vals.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => {
      let v = row[i];
      if (h === 'parts') {
        if (typeof v === 'string' && v) {
          try { v = JSON.parse(v); } catch (e) { v = []; }
        } else if (!Array.isArray(v)) {
          v = [];
        }
      }
      obj[h] = v;
    });
    return obj;
  });
}

function acList() {
  const sh = sheet('点検報告');
  if (!sh) return makeErr('点検報告シートが見つかりません');
  return makeRes(sheetToObjects(sh));
}

function acCreate(data) {
  const sh = sheet('点検報告');
  if (!sh) return makeErr('点検報告シートが見つかりません');

  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const id = 'acc' + Utilities.getUuid().replace(/-/g,'').slice(0,12);
  const now = new Date();

  // dataにidとcreatedAtを付与
  data.id = id;
  data.createdAt = now;
  data.updatedAt = now;

  const row = headers.map(h => {
    if (h === 'parts') return JSON.stringify(data.parts || []);
    return data[h] !== undefined ? data[h] : '';
  });
  sh.appendRow(row);

  // 充填・回収記録へ自動転記
  autoTransferRefrigerant(data, id);

  return makeRes({ id });
}

function acUpdate(data) {
  const sh = sheet('点検報告');
  if (!sh) return makeErr('点検報告シートが見つかりません');

  const vals = sh.getDataRange().getValues();
  const headers = vals[0];
  const idCol = headers.indexOf('id');
  if (idCol < 0) return makeErr('idカラムが見つかりません');

  for (let i = 1; i < vals.length; i++) {
    if (vals[i][idCol] == data.id) {
      data.updatedAt = new Date();
      const row = headers.map(h => {
        if (h === 'parts') return JSON.stringify(data.parts || []);
        return data[h] !== undefined ? data[h] : vals[i][headers.indexOf(h)];
      });
      sh.getRange(i + 1, 1, 1, headers.length).setValues([row]);
      autoTransferRefrigerant(data, data.id);
      return makeRes({ id: data.id });
    }
  }
  return makeErr('対象レコードが見つかりません: ' + data.id);
}

function acSaveSign(payload) {
  const sh = sheet('点検報告');
  if (!sh) return makeErr('点検報告シートが見つかりません');

  const vals = sh.getDataRange().getValues();
  const headers = vals[0];
  const idCol = headers.indexOf('id');
  // 画面・印刷・QRページが読む列は customerSign（旧: signData）。どちらかあればそこへ保存する
  let signCol = headers.indexOf('customerSign');
  if (signCol < 0) signCol = headers.indexOf('signData');
  if (idCol < 0 || signCol < 0) return makeErr('カラムが見つかりません（customerSign）');

  let sign = String(payload.signData || '');
  if (!sign) return makeErr('サインデータが空です');
  // フロントはbase64本体のみ送る。画像として表示できるようdata URLにして保存する
  if (sign.indexOf('data:') !== 0) sign = 'data:image/jpeg;base64,' + sign;
  if (sign.length > 49000) return makeErr('サイン画像が大きすぎます');

  for (let i = 1; i < vals.length; i++) {
    if (vals[i][idCol] == payload.id) {
      sh.getRange(i + 1, signCol + 1).setValue(sign);
      return makeRes({ id: payload.id });
    }
  }
  return makeErr('対象レコードが見つかりません: ' + payload.id);
}

function acDelete(payload) {
  const sh = sheet('点検報告');
  if (!sh) return makeErr('点検報告シートが見つかりません');

  const vals = sh.getDataRange().getValues();
  const headers = vals[0];
  const idCol = headers.indexOf('id');

  for (let i = 1; i < vals.length; i++) {
    if (vals[i][idCol] == payload.id) {
      sh.deleteRow(i + 1);
      return makeRes({ id: payload.id });
    }
  }
  return makeErr('対象レコードが見つかりません: ' + payload.id);
}

// 点検報告の充填・回収をfron側へ自動転記
// 同じ報告書から転記済みの行を消してから入れ直すため、編集・再保存しても重複しない
function autoTransferRefrigerant(data, reportId) {
  try {
    // 充填・回収の項目が送られていない更新（ワンタップ更新など）は何もしない
    if (data.refAdd === undefined && data.refRecover === undefined) return;

    const sh = sheet('充填・回収記録');
    if (!sh) return;

    // 同じ報告書の転記済み行を削除（下から消す）。報告書IDの列は見出し reportId、無ければ8列目(H列)
    const last = sh.getLastRow();
    if (last > 1) {
      const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
      let col = headers.indexOf('reportId');
      col = col >= 0 ? col + 1 : 8;
      const ids = sh.getRange(2, col, last - 1, 1).getValues();
      for (let i = ids.length - 1; i >= 0; i--) {
        if (ids[i][0] == reportId) sh.deleteRow(i + 2);
      }
    }

    const refAdd = parseFloat(data.refAdd) || 0;
    const refRecover = parseFloat(data.refRecover) || 0;
    if (refAdd === 0 && refRecover === 0) return;

    const refrigerant = data.refrigerant || '';
    const date = data.workDate ? new Date(data.workDate) : new Date();
    const eqId = findOrCreateEquipment(data);

    if (refAdd > 0) {
      sh.appendRow([
        Utilities.getUuid(),
        eqId, date, '充填', refrigerant, refAdd, '', reportId,
        data.customerName || '', data.systemName || '', new Date()
      ]);
    }
    if (refRecover > 0) {
      sh.appendRow([
        Utilities.getUuid(),
        eqId, date, '回収', refrigerant, refRecover, '', reportId,
        data.customerName || '', data.systemName || '', new Date()
      ]);
    }
  } catch(e) {
    Logger.log('autoTransferRefrigerant error: ' + e);
  }
}

// 機器マスタから機器を検索または新規作成してIDを返す
function findOrCreateEquipment(data) {
  const sh = sheet('機器マスタ');
  if (!sh) return '';

  const vals = sh.getDataRange().getValues();
  const headers = vals[0];
  const nameCol = headers.indexOf('customerName');
  const sysCol  = headers.indexOf('systemName');
  const serCol  = headers.indexOf('serial');
  const idCol   = headers.indexOf('id');

  for (let i = 1; i < vals.length; i++) {
    if (vals[i][nameCol] == data.customerName &&
        vals[i][sysCol]  == data.systemName &&
        vals[i][serCol]  == data.serial) {
      return vals[i][idCol];
    }
  }

  // 見つからなければ新規作成
  const newId = 'eq-' + Utilities.getUuid().slice(0, 8);
  const row = headers.map(h => {
    if (h === 'id') return newId;
    if (h === 'customerName') return data.customerName || '';
    if (h === 'systemName')   return data.systemName || '';
    if (h === 'serial')       return data.serial || '';
    if (h === 'refrigerant')  return data.refrigerant || '';
    if (h === 'createdAt')    return new Date();
    return '';
  });
  sh.appendRow(row);
  return newId;
}

// ════════════════════════════════════════════════
// fron-kanri: データ一括ロード
// ════════════════════════════════════════════════

function fronLoad() {
  const result = {
    equipment:   sheetToObjects(sheet('機器マスタ') || stubSheet()),
    fills:       sheetToObjects(sheet('充填・回収記録') || stubSheet()),
    legal:       sheetToObjects(sheet('法定点検記録') || stubSheet()),
    leakSummary: sheetToObjects(sheet('漏洩量サマリ') || stubSheet()),
    inspections: sheetToObjects(sheet('点検報告') || stubSheet()),
  };
  return makeRes(result);
}

function fronSave(data) {
  // fron_saveはバックアップ用（fron_dataシートにJSONで保存）
  const sh = sheet('fron_data') || SS().insertSheet('fron_data');
  sh.clearContents();
  sh.getRange(1,1).setValue(JSON.stringify(data));
  return makeRes({ saved: true });
}

// ════════════════════════════════════════════════
// 機器マスタ CRUD
// ════════════════════════════════════════════════

function eqList() {
  const sh = sheet('機器マスタ');
  if (!sh) return makeRes([]);
  return makeRes(sheetToObjects(sh));
}

function eqSearch(q) {
  const sh = sheet('機器マスタ');
  if (!sh) return makeRes([]);
  const all = sheetToObjects(sh);
  if (!q) return makeRes(all);
  const lq = q.toLowerCase();
  return makeRes(all.filter(r =>
    Object.values(r).some(v => String(v).toLowerCase().includes(lq))
  ));
}

function eqUpsert(data) {
  const sh = sheet('機器マスタ');
  if (!sh) return makeErr('機器マスタシートが見つかりません');

  const vals = sh.getDataRange().getValues();
  const headers = vals[0];
  const idCol = headers.indexOf('id');

  // 既存レコードを探す
  for (let i = 1; i < vals.length; i++) {
    if (vals[i][idCol] == data.id) {
      data.updatedAt = new Date();
      const row = headers.map(h => (data[h] !== undefined ? data[h] : vals[i][headers.indexOf(h)]));
      sh.getRange(i + 1, 1, 1, headers.length).setValues([row]);
      return makeRes({ id: data.id });
    }
  }

  // 新規追加
  if (!data.id) data.id = 'eq-' + Utilities.getUuid().slice(0, 8);
  data.createdAt = new Date();
  data.updatedAt = new Date();
  const row = headers.map(h => (data[h] !== undefined ? data[h] : ''));
  sh.appendRow(row);
  return makeRes({ id: data.id });
}

function eqDelete(id) {
  const sh = sheet('機器マスタ');
  if (!sh) return makeErr('機器マスタシートが見つかりません');
  return deleteRowById(sh, id);
}

// ════════════════════════════════════════════════
// 充填・回収記録 CRUD
// ════════════════════════════════════════════════

function fillList(eqId, year) {
  const sh = sheet('充填・回収記録');
  if (!sh) return makeRes([]);
  let rows = sheetToObjects(sh);
  if (eqId) rows = rows.filter(r => r.eqId == eqId);
  if (year)  rows = rows.filter(r => {
    const d = new Date(r.date || r.workDate);
    return d.getFullYear() == parseInt(year);
  });
  return makeRes(rows);
}

function fillCreate(data) {
  const sh = sheet('充填・回収記録');
  if (!sh) return makeErr('充填・回収記録シートが見つかりません');
  if (!data.id) data.id = Utilities.getUuid();
  data.createdAt = new Date();
  const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
  sh.appendRow(headers.map(h => data[h] !== undefined ? data[h] : ''));
  return makeRes({ id: data.id });
}

function fillDelete(id) {
  const sh = sheet('充填・回収記録');
  if (!sh) return makeErr('充填・回収記録シートが見つかりません');
  return deleteRowById(sh, id);
}

// ════════════════════════════════════════════════
// 法定点検記録 CRUD
// ════════════════════════════════════════════════

function legalCreate(data) {
  const sh = sheet('法定点検記録');
  if (!sh) return makeErr('法定点検記録シートが見つかりません');
  if (!data.id) data.id = Utilities.getUuid();
  data.createdAt = new Date();
  const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
  sh.appendRow(headers.map(h => data[h] !== undefined ? data[h] : ''));
  return makeRes({ id: data.id });
}

function legalDelete(id) {
  const sh = sheet('法定点検記録');
  if (!sh) return makeErr('法定点検記録シートが見つかりません');
  return deleteRowById(sh, id);
}

// ════════════════════════════════════════════════
// 漏洩量サマリ
// ════════════════════════════════════════════════

function leakSummary(year) {
  const sh = sheet('漏洩量サマリ');
  if (!sh) return makeRes([]);
  let rows = sheetToObjects(sh);
  if (year) rows = rows.filter(r => r.year == year);
  return makeRes(rows);
}

// ════════════════════════════════════════════════
// KY(危険予知)活動記録
// ════════════════════════════════════════════════

const KY_HEADERS = ['id','date','siteName','workContent','workers','workersData','hazards','priorityAction','confirmedBy','confirmedBySignature','createdAt'];

function ensureKySheet() {
  let sh = sheet('KY記録');
  if (!sh) {
    sh = SS().insertSheet('KY記録');
    sh.appendRow(KY_HEADERS);
  }
  return sh;
}

function kyRowToObj(headers, row) {
  const hazardsCol = headers.indexOf('hazards');
  const workersDataCol = headers.indexOf('workersData');
  const obj = {};
  headers.forEach((h, i) => {
    let v = row[i];
    if (i === hazardsCol) {
      if (typeof v === 'string' && v) {
        try { v = JSON.parse(v); } catch(e){ v = []; }
      } else if (!Array.isArray(v)) v = [];
    }
    obj[h] = v;
  });
  // workersData（氏名＋署名の配列）があればそちらを workers として優先返却
  if (workersDataCol >= 0) {
    let wd = row[workersDataCol];
    if (typeof wd === 'string' && wd) {
      try { wd = JSON.parse(wd); } catch(e){ wd = null; }
    } else if (!Array.isArray(wd)) {
      wd = null;
    }
    if (wd && wd.length) obj.workers = wd;
    delete obj.workersData;
  }
  return obj;
}

function kyList() {
  const sh = ensureKySheet();
  const vals = sh.getDataRange().getValues();
  if (vals.length < 2) return makeRes([]);
  const headers = vals[0];
  const rows = vals.slice(1).map(row => kyRowToObj(headers, row));
  rows.reverse(); // 新しい記録を先頭に
  return makeRes(rows);
}

function kyGet(id) {
  const sh = ensureKySheet();
  const vals = sh.getDataRange().getValues();
  if (vals.length < 2) return makeErr('記録が見つかりません: ' + id);
  const headers = vals[0];
  const idCol = headers.indexOf('id');
  for (let i = 1; i < vals.length; i++) {
    if (vals[i][idCol] == id) {
      return makeRes(kyRowToObj(headers, vals[i]));
    }
  }
  return makeErr('記録が見つかりません: ' + id);
}

function kyCreate(data) {
  const sh = ensureKySheet();
  const id = 'ky' + Utilities.getUuid().replace(/-/g,'').slice(0,12);
  data.id = id;
  data.createdAt = new Date();

  const workersArr = Array.isArray(data.workers) ? data.workers : [];
  const workerNames = workersArr.map(w => (typeof w === 'string' ? w : (w && w.name) || '')).filter(Boolean);

  const row = KY_HEADERS.map(h => {
    if (h === 'hazards') return JSON.stringify(data.hazards || []);
    if (h === 'workers') return workerNames.join('、');
    if (h === 'workersData') return JSON.stringify(workersArr);
    return data[h] !== undefined ? data[h] : '';
  });
  sh.appendRow(row);
  return makeRes({ id });
}

function kySign(payload) {
  const sh = ensureKySheet();
  const vals = sh.getDataRange().getValues();
  const headers = vals[0];
  const idCol = headers.indexOf('id');
  const workersDataCol = headers.indexOf('workersData');
  const confirmSignCol = headers.indexOf('confirmedBySignature');

  for (let i = 1; i < vals.length; i++) {
    if (vals[i][idCol] == payload.id) {
      if (payload.target === 'confirm') {
        if (confirmSignCol < 0) return makeErr('confirmedBySignature列が見つかりません');
        sh.getRange(i + 1, confirmSignCol + 1).setValue(payload.signature || '');
        return makeRes({ id: payload.id, target: 'confirm' });
      }

      if (workersDataCol < 0) return makeErr('workersData列が見つかりません');
      let wd = vals[i][workersDataCol];
      if (typeof wd === 'string' && wd) {
        try { wd = JSON.parse(wd); } catch(e) { wd = []; }
      } else if (!Array.isArray(wd)) {
        wd = [];
      }
      const idx = Number(payload.workerIndex);
      if (isNaN(idx) || idx < 0 || idx >= wd.length) return makeErr('対象の作業者が見つかりません');
      wd[idx].signature = payload.signature || '';
      sh.getRange(i + 1, workersDataCol + 1).setValue(JSON.stringify(wd));
      return makeRes({ id: payload.id, target: 'worker', workerIndex: idx });
    }
  }
  return makeErr('対象レコードが見つかりません: ' + payload.id);
}

function kyDelete(id) {
  const sh = ensureKySheet();
  return deleteRowById(sh, id);
}



function deleteRowById(sh, id) {
  const vals = sh.getDataRange().getValues();
  const headers = vals[0];
  const idCol = headers.indexOf('id');
  for (let i = 1; i < vals.length; i++) {
    if (vals[i][idCol] == id) {
      sh.deleteRow(i + 1);
      return makeRes({ id });
    }
  }
  return makeErr('対象レコードが見つかりません: ' + id);
}

function stubSheet() {
  // シートが存在しない場合の空オブジェクト代替
  return { getDataRange: () => ({ getValues: () => [[]] }) };
}

function acGet(id) {
  const sh = sheet('点検報告');
  if (!sh) return makeErr('点検報告シートが見つかりません');
  const objs = sheetToObjects(sh);
  const rec = objs.find(r => r.id == id);
  if (!rec) return makeErr('レコードが見つかりません: ' + id);
  return makeRes(rec);
}

// ════════════════════════════════════════════════
// AuthGuard.gs ― Googleログインの本人確認（GAS側）  v3
//
// ■ 許可リスト
//   ・共通の「アクセス許可」スプレッドシート（シート名「許可アカウント」）を、管理画面から編集します。
//     スクリプト プロパティ ACL_SHEET_ID にそのスプレッドシートのIDを登録してください。
//   ・予備として、スクリプト プロパティ ALLOWED_EMAILS（カンマ区切り）も有効です。
//   ・管理者：シートの「権限」列が「管理者」の人、またはスクリプト プロパティ ADMIN_EMAILS の人。
//   ・許可リストが空のときは全員を拒否します。
//   ・許可のない人は、画面の「利用を申請する」から申請できます。申請はシート「申請中」に入り、
//     管理画面で承認すると、許可アカウントに移ります（管理者にはメールで通知されます）。
//
// ■ 初回だけ：エディタで関数 authorizeOnce を選んで「実行」し、権限を承認してください。
//   （名前の末尾が _ の関数は、実行メニューに表示されません）
//
// ■ doGet(e) と doPost(e) の先頭に、次の2行を入れる
//   const g = authGuard_(e); if (g) return g;
// ════════════════════════════════════════════════

const GOOGLE_CLIENT_ID = '782190614995-5d4fur401smd1gpnnvs43h3m2q2q2ar3.apps.googleusercontent.com';
const ACL_SHEET_NAME = '許可アカウント';
const REQ_SHEET_NAME = '申請中';
const ADMIN_PAGE_URL = 'https://uchiyamazion.github.io/sion-portal/access/';

// 初回だけ実行する関数：外部通信とスプレッドシートの権限の承認画面を出す
function authorizeOnce() {
  UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=test', { muteHttpExceptions: true });
  CacheService.getScriptCache().put('authorize_test', '1', 5);
  MailApp.getRemainingDailyQuota();   // 管理者へのメール通知の権限の承認用
  const id = PropertiesService.getScriptProperties().getProperty('ACL_SHEET_ID');
  if (id) { const sh = aclSheet_(); Logger.log('許可シート: ' + sh.getParent().getName() + ' / 登録 ' + Math.max(0, sh.getLastRow() - 1) + ' 件'); }
  Logger.log('承認OK。ACL_SHEET_ID=' + (id ? '設定あり' : '未設定（ALLOWED_EMAILSだけで動作）'));
}

// ---------- 許可リスト ----------
function listProp_(name) {
  const v = PropertiesService.getScriptProperties().getProperty(name) || '';
  return v.split(/[\s,;]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
}
function aclSheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('ACL_SHEET_ID');
  if (!id) return null;
  const ss = SpreadsheetApp.openById(id);
  let sh = ss.getSheetByName(ACL_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(ACL_SHEET_NAME);
    sh.getRange(1, 1, 1, 4).setValues([['メールアドレス', '名前', '権限', '登録日時']]);
  }
  return sh;
}
function reqSheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('ACL_SHEET_ID');
  if (!id) return null;
  const ss = SpreadsheetApp.openById(id);
  let sh = ss.getSheetByName(REQ_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(REQ_SHEET_NAME);
    sh.getRange(1, 1, 1, 3).setValues([['メールアドレス', '名前', '申請日時']]);
  }
  return sh;
}
function reqRows_(sh) {
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues()
    .map(r => ({ email: String(r[0]).trim().toLowerCase(), name: String(r[1] || ''), at: r[2] instanceof Date ? r[2].getTime() : 0 }))
    .filter(r => r.email);
}

function aclRows_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('acl_rows');
  if (hit) { try { return JSON.parse(hit); } catch (e) { /* 再取得 */ } }
  let rows = [];
  try {
    const sh = aclSheet_();
    if (sh && sh.getLastRow() > 1) {
      rows = sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues()
        .map(r => ({ email: String(r[0]).trim().toLowerCase(), name: String(r[1] || ''), role: String(r[2] || '') }))
        .filter(r => r.email);
    }
  } catch (err) { rows = []; }
  cache.put('acl_rows', JSON.stringify(rows), 60);
  return rows;
}
function allowedEmails_() { return listProp_('ALLOWED_EMAILS').concat(aclRows_().map(r => r.email)); }
function adminEmails_() { return listProp_('ADMIN_EMAILS').concat(aclRows_().filter(r => r.role === '管理者').map(r => r.email)); }

// ---------- IDトークンの確認 ----------
// 戻り値：{ ok:true, email } | { ok:false, reason:'unauthorized' } | { ok:false, reason:'forbidden', email }
function verifyIdToken_(idToken) {
  if (!idToken) return { ok: false, reason: 'unauthorized' };
  const cache = CacheService.getScriptCache();
  const key = 'idt_' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken)).slice(0, 40);
  let info = null;
  const hit = cache.get(key);
  if (hit) { try { info = JSON.parse(hit); } catch (e) { info = null; } }
  if (!info) {
    const res = UrlFetchApp.fetch(
      'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
      { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return { ok: false, reason: 'unauthorized' };
    const r = JSON.parse(res.getContentText());
    info = { aud: r.aud, iss: r.iss, email: r.email, email_verified: r.email_verified, exp: r.exp };
    const ttl = Math.min(300, Number(info.exp) - Math.floor(Date.now() / 1000));
    if (ttl > 0) cache.put(key, JSON.stringify(info), ttl);
  }
  const now = Math.floor(Date.now() / 1000);
  const iss = String(info.iss || '');
  if (info.aud !== GOOGLE_CLIENT_ID) return { ok: false, reason: 'unauthorized' };
  if (iss !== 'accounts.google.com' && iss !== 'https://accounts.google.com') return { ok: false, reason: 'unauthorized' };
  if (Number(info.exp) <= now) return { ok: false, reason: 'unauthorized' };
  if (String(info.email_verified) !== 'true') return { ok: false, reason: 'unauthorized' };
  const email = String(info.email || '').toLowerCase();
  if (allowedEmails_().indexOf(email) < 0) return { ok: false, reason: 'forbidden', email: email };
  return { ok: true, email: email };
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---------- 利用申請（許可のない人も、Googleにログインしていれば申請できる） ----------
function aclRequestHandle_(p, a) {
  if (!a.email) return jsonOut_({ status: 'error', success: false, error: a.reason, data: a.reason, message: a.reason });
  if (a.ok) return jsonOut_({ status: 'success', success: true, data: { state: 'already_allowed' } });
  const sh = reqSheet_();
  if (!sh) return jsonOut_({ status: 'error', success: false, error: 'no_sheet', data: 'no_sheet', message: '申請を受け付けられません。管理者に直接連絡してください' });
  const cache = CacheService.getScriptCache();
  const rk = 'req_' + a.email;
  if (cache.get(rk)) return jsonOut_({ status: 'success', success: true, data: { state: 'already_requested' } });
  cache.put(rk, '1', 60);
  const name = String(p.name || '').slice(0, 60);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  let isNew = false;
  try {
    const rows = reqRows_(sh);
    if (rows.some(r => r.email === a.email)) return jsonOut_({ status: 'success', success: true, data: { state: 'already_requested' } });
    if (rows.length >= 200) return jsonOut_({ status: 'error', success: false, error: 'full', data: 'full', message: '申請が多すぎます。管理者に直接連絡してください' });
    sh.appendRow([a.email, name, new Date()]);
    isNew = true;
  } finally { lock.releaseLock(); }
  if (isNew) notifyAdmins_(a.email, name);
  return jsonOut_({ status: 'success', success: true, data: { state: 'requested' } });
}
function notifyAdmins_(email, name) {
  try {
    const to = adminEmails_().filter((v, i, arr) => arr.indexOf(v) === i);
    if (!to.length) return;
    MailApp.sendEmail({
      to: to.join(','),
      subject: '【アクセス申請】' + email,
      body: '利用の申請がありました。\n\nメールアドレス：' + email + '\n名前：' + (name || '（未入力）') +
            '\n\n承認・却下は、次の管理画面で行ってください。\n' + ADMIN_PAGE_URL
    });
  } catch (err) { /* メール送信に失敗しても申請自体は有効 */ }
}

// ---------- 管理画面用の操作（acl_list / acl_add / acl_remove / acl_approve / acl_reject）。管理者だけが使える ----------
function aclHandle_(action, p, a) {
  const bad = (code, msg) => jsonOut_({ status: 'error', success: false, error: code, data: code, message: msg });
  if (!a.email) return bad(a.reason, a.reason);
  if (adminEmails_().indexOf(a.email) < 0) return bad('not_admin', '管理者のみ操作できます');
  const props = { me: a.email };
  const sheetId = PropertiesService.getScriptProperties().getProperty('ACL_SHEET_ID');
  const result = () => {
    CacheService.getScriptCache().remove('acl_rows');
    props.rows = aclRows_();
    props.pending = reqRows_(reqSheet_());
    props.propEmails = listProp_('ALLOWED_EMAILS');
    props.propAdmins = listProp_('ADMIN_EMAILS');
    props.sheetReady = !!sheetId;
    return jsonOut_({ status: 'success', success: true, data: props });
  };
  if (action === 'acl_list') {
    if (!sheetId) { props.rows = []; props.pending = []; props.propEmails = listProp_('ALLOWED_EMAILS'); props.propAdmins = listProp_('ADMIN_EMAILS'); props.sheetReady = false; return jsonOut_({ status: 'success', success: true, data: props }); }
    return result();
  }
  const sh = aclSheet_();
  if (!sh) return bad('no_sheet', 'スクリプト プロパティ ACL_SHEET_ID が未設定です');
  const email = String(p.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return bad('bad_email', 'メールアドレスの形式が正しくありません');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const last = sh.getLastRow();
    const emails = last > 1 ? sh.getRange(2, 1, last - 1, 1).getValues().map(r => String(r[0]).trim().toLowerCase()) : [];
    const idx = emails.indexOf(email);
    const psh = reqSheet_();
    const pend = reqRows_(psh);
    const pidx = pend.findIndex(r => r.email === email);
    const dropPending = () => { if (pidx >= 0) psh.deleteRow(pidx + 2); };
    if (action === 'acl_add' || action === 'acl_approve') {
      const name = String(p.name || (pidx >= 0 ? pend[pidx].name : '') || '').slice(0, 60);
      const role = p.role === '管理者' ? '管理者' : '';
      if (idx >= 0) sh.getRange(idx + 2, 1, 1, 3).setValues([[email, name, role]]);
      else sh.appendRow([email, name, role, new Date()]);
      dropPending();
    } else if (action === 'acl_reject') {
      dropPending();
    } else if (action === 'acl_remove') {
      if (email === a.email) return bad('self', '自分自身は削除できません');
      if (idx >= 0) sh.deleteRow(idx + 2);
    } else {
      return bad('bad_action', '不明な操作です');
    }
  } finally { lock.releaseLock(); }
  return result();
}

// 許可されていれば null、そうでなければエラー応答（JSON）を返す
function authGuard_(e) {
  const p = (e && e.parameter) || {};
  let token = p.idToken || '';
  if (!token && e && e.postData && e.postData.contents) {
    try { token = (JSON.parse(e.postData.contents) || {}).idToken || ''; } catch (err) { /* JSON以外は無視 */ }
  }
  const a = verifyIdToken_(token);
  if (p.action === 'acl_request') return aclRequestHandle_(p, a);
  if (/^acl_/.test(p.action || '')) return aclHandle_(p.action, p, a);
  if (a.ok) return null;
  return jsonOut_({ status: 'error', success: false, ok: false, error: a.reason, data: a.reason, message: a.reason });
}
