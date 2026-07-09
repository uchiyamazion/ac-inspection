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
  const signCol = headers.indexOf('signData');
  if (idCol < 0 || signCol < 0) return makeErr('カラムが見つかりません');

  for (let i = 1; i < vals.length; i++) {
    if (vals[i][idCol] == payload.id) {
      sh.getRange(i + 1, signCol + 1).setValue(payload.signData);
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
function autoTransferRefrigerant(data, reportId) {
  try {
    const refAdd = parseFloat(data.refAdd) || 0;
    const refRecover = parseFloat(data.refRecover) || 0;
    if (refAdd === 0 && refRecover === 0) return;

    const refrigerant = data.refrigerant || '';
    const date = data.workDate ? new Date(data.workDate) : new Date();
    const eqKey = (data.customerName || '') + '|' + (data.systemName || '') + '|' + (data.serial || '');
    const eqId = findOrCreateEquipment(data);

    const sh = sheet('充填・回収記録');
    if (!sh) return;

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
