// GAS_URLはjs/config.jsで設定

let allReports = [];
let currentReportId = null;
let currentSignDataUrl = ''; // 入力フォームのサイン（base64）

document.addEventListener('DOMContentLoaded', () => {
  setTodayDate();
  addPartRow();
  loadReports();
  initSignPad();
});

function setTodayDate() {
  document.getElementById('work-date').value = new Date().toISOString().split('T')[0];
}

window.showView = function(view, keepId) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + view).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  if (view === 'form' && !keepId) resetForm();
};

// ===== GAS通信（読み取りGET・書き込みPOST）=====
const WRITE_ACTIONS = new Set(['create','update','delete','saveSign']);

async function gasCall(params) {
  if (WRITE_ACTIONS.has(params.action)) {
    // POST（URL長制限を回避）
    const res = await fetch(GAS_URL, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain' }, // GASはapplication/jsonをブロックするのでtext/plain
      body: JSON.stringify(params)
    });
    const json = await res.json();
    if (json.status === 'error') throw new Error(json.data?.message || 'エラー');
    return json.data;
  } else {
    // GET
    const url = GAS_URL + '?' + new URLSearchParams(params).toString();
    const res = await fetch(url, { redirect: 'follow' });
    const json = await res.json();
    if (json.status === 'error') throw new Error(json.data?.message || 'エラー');
    return json.data;
  }
}

// ===== Load =====
async function loadReports() {
  try {
    allReports = await gasCall({ action: 'list' });
    renderTable(allReports);
    if (location.hash.length > 1) openFromHash();
  } catch (e) {
    renderTable([]);
    showToast('読込失敗: ' + e.message, 'error');
  }
}

// ===== Render =====
function renderTable(reports) {
  const tbody = document.getElementById('report-tbody');
  if (!reports || !reports.length) {
    tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state"><span class="empty-icon">📋</span><p>報告書がありません。「新規報告書」から作成してください。</p></div></td></tr>';
    return;
  }
  tbody.innerHTML = reports.map(r =>
    '<tr>' +
    '<td style="white-space:nowrap;font-family:var(--mono);font-size:12px">' + formatDate(r.workDate) + '</td>' +
    '<td><strong>' + esc(r.customerName||'—') + '</strong><br><span style="color:var(--text-sub);font-size:11px">' + esc(r.systemName||'') + '</span></td>' +
    '<td>' + esc(r.maker||'—') + '</td>' +
    '<td style="font-family:var(--mono);font-size:12px">' + esc(r.model||'—') + '</td>' +
    '<td>' + esc(r.refrigerant||'—') + '</td>' +
    '<td><span class="badge badge-' + esc(r.status) + '">' + esc(r.status||'—') + '</span></td>' +
    '<td><div class="row-actions">' +
      '<button class="row-btn" onclick="viewReport(\'' + r.id + '\')">詳細</button>' +
      '<button class="row-btn" onclick="editReport(\'' + r.id + '\')">編集</button>' +
      '<button class="row-btn danger" onclick="deleteReport(\'' + r.id + '\')">削除</button>' +
    '</div></td></tr>'
  ).join('');
}

// ===== Filter =====
window.filterReports = function() {
  const site = document.getElementById('search-site').value.toLowerCase();
  const month = document.getElementById('filter-month').value;
  const status = document.getElementById('filter-status').value;
  renderTable(allReports.filter(r =>
    (!site || (r.systemName||'').toLowerCase().includes(site) || (r.customerName||'').toLowerCase().includes(site)) &&
    (!month || (r.workDate||'').startsWith(month)) &&
    (!status || r.status === status)
  ));
};
window.clearFilters = function() {
  document.getElementById('search-site').value = '';
  document.getElementById('filter-month').value = '';
  document.getElementById('filter-status').value = '';
  renderTable(allReports);
};

// ===== サイン画像を圧縮（保存サイズを抑える）=====
function compressSign(srcDataUrl, maxW, maxH, quality) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = function() {
      const canvas = document.createElement('canvas');
      let w = img.width, h = img.height;
      if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
      if (h > maxH) { w = Math.round(w * maxH / h); h = maxH; }
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      const imgData = ctx.getImageData(0, 0, w, h);
      const px = imgData.data;
      for (let i = 0; i < px.length; i += 4) {
        const gray = (px[i] + px[i+1] + px[i+2]) / 3;
        const factor = gray < 220 ? 0.2 : 1;
        px[i] = px[i+1] = px[i+2] = Math.max(0, gray * factor);
      }
      ctx.putImageData(imgData, 0, 0);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.src = srcDataUrl;
  });
}

// ===== Save =====
window.saveReport = async function(e) {
  e.preventDefault();
  const btn = document.getElementById('submit-btn');
  btn.disabled = true; btn.textContent = '保存中…';
  const data = collectFormData();
  try {
    // POSTはpayloadキーにデータを入れる（doPost: payload = body.payload || body）
    const action = currentReportId ? 'update' : 'create';
    const payload = Object.assign({}, data);
    if (currentReportId) payload.id = currentReportId;
    const params = { action, payload };

    let savedId = currentReportId;
    const result = await gasCall(params);
    if (!savedId) savedId = result.id;

    if (currentSignDataUrl && savedId) {
      try {
        const compressed = await compressSign(currentSignDataUrl, 300, 100, 0.92);
        const base64only = compressed.replace(/^data:image\/jpeg;base64,/, '');
        await gasCall({ action: 'saveSign', id: savedId, signData: base64only });
      } catch (signErr) {
        console.error('サイン保存失敗:', signErr);
      }
    }

    showToast(currentReportId ? '更新しました' : '保存しました', 'success');
    currentReportId = null;
    currentSignDataUrl = '';
    await loadReports();
    showView('list');
  } catch (err) {
    showToast('保存失敗: ' + err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = '保存する';
  }
};

function collectFormData() {
  const parts = [];
  document.querySelectorAll('.part-row').forEach(row => {
    const ins = row.querySelectorAll('input');
    if (ins[0].value) parts.push({ name: ins[0].value, qty: ins[1].value, unit: ins[2].value, code: ins[3].value });
  });
  return {
    customerName: v('customer-name'), address: v('address'), requester: v('requester'), reception: v('reception'),
    systemName: v('system-name'), productType: v('product-type'), maker: v('maker'), model: v('model'),
    serial: v('serial'), refrigerant: v('refrigerant') === 'その他' ? v('refrigerant-other') : v('refrigerant'),
    refShip: vn('ref-ship'), refAdd: vn('ref-add'), refRecover: vn('ref-recover'), refFill: vn('ref-fill'),
    workDate: v('work-date'), workStart: v('work-start'), workEnd: v('work-end'),
    symptom: v('symptom'), cause: v('cause'), workContent: v('work-content'), remarks: v('remarks'),
    tempIndoorIn: vn('temp-indoor-in'), tempIndoorOut: vn('temp-indoor-out'),
    pressDischarge: vn('press-discharge'), pressSuction: vn('press-suction'),
    tempDischarge: vn('temp-discharge'), tempSuction: vn('temp-suction'),
    tempOutdoor: vn('temp-outdoor'), current: vn('current'),
    parts, status: v('status'), worker: v('worker'),
  };
}

// ===== Detail Modal =====
window.viewReport = function(id, readOnly) {
  try {
    const r = allReports.find(x => x.id === id);
    if (!r) { showToast('該当データが見つかりません(id:' + id + ')', 'error'); return; }
    currentReportId = id;
    document.getElementById('modal-title').textContent = formatDate(r.workDate) + ' — ' + (r.systemName || '');
    const partsHtml = Array.isArray(r.parts) && r.parts.length
      ? '<div class="detail-section"><h4>使用部品</h4><table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="background:var(--primary-light)"><th style="padding:8px;text-align:left">部品名</th><th style="padding:8px">数量</th><th style="padding:8px">単位</th><th style="padding:8px;text-align:left">コード</th></tr></thead><tbody>'
        + r.parts.map(p => '<tr style="border-bottom:1px solid var(--border-light)"><td style="padding:8px">' + esc(p.name) + '</td><td style="padding:8px;text-align:center">' + esc(p.qty) + '</td><td style="padding:8px;text-align:center">' + esc(p.unit) + '</td><td style="padding:8px;font-family:var(--mono);font-size:12px">' + esc(p.code) + '</td></tr>').join('')
        + '</tbody></table></div>' : '';
    const signHtml = r.customerSign
      ? '<div class="detail-section"><h4>お客様サイン</h4><img src="' + esc(r.customerSign) + '" style="max-width:240px;max-height:80px;border:1px solid var(--border-light);border-radius:6px;padding:6px;background:#fafafa;"></div>'
      : '';
    document.getElementById('modal-body').innerHTML =
      '<div class="detail-section"><h4>基本情報</h4><div class="detail-grid">' + df('お客様名',r.customerName) + df('ご住所',r.address) + df('ご依頼元',r.requester) + df('受付内容',r.reception) + '</div></div>' +
      '<div class="detail-section"><h4>機器情報</h4><div class="detail-grid">' + df('系統名',r.systemName) + df('品種',r.productType) + df('メーカー',r.maker) + df('型式',r.model,true) + df('製番',r.serial,true) + df('使用冷媒',r.refrigerant) + df('出荷時充填量',r.refShip!=null&&r.refShip!==''?r.refShip+' kg':'') + df('追加充填量',r.refAdd!=null&&r.refAdd!==''?r.refAdd+' kg':'') + df('冷媒回収量',r.refRecover!=null&&r.refRecover!==''?r.refRecover+' kg':'') + df('冷媒充填量',r.refFill!=null&&r.refFill!==''?r.refFill+' kg':'') + '</div></div>' +
      '<div class="detail-section"><h4>作業情報</h4><div class="detail-grid">' + df('作業日',formatDate(r.workDate)) + df('作業時間',r.workStart&&r.workEnd?formatTime(r.workStart)+'～'+formatTime(r.workEnd):'') + '</div>' + dft('症状',r.symptom) + dft('原因',r.cause) + dft('作業内容',r.workContent) + dft('備考',r.remarks) + '</div>' +
      '<div class="detail-section"><h4>運転データ</h4><div class="detail-grid">' + df('室内吸入温',r.tempIndoorIn!=null&&r.tempIndoorIn!==''?r.tempIndoorIn+' ℃':'',true) + df('室内吹出温',r.tempIndoorOut!=null&&r.tempIndoorOut!==''?r.tempIndoorOut+' ℃':'',true) + df('吐出圧力',r.pressDischarge!=null&&r.pressDischarge!==''?r.pressDischarge+' MPa':'',true) + df('吸入圧力',r.pressSuction!=null&&r.pressSuction!==''?r.pressSuction+' MPa':'',true) + df('吐出温',r.tempDischarge!=null&&r.tempDischarge!==''?r.tempDischarge+' ℃':'',true) + df('吸入温',r.tempSuction!=null&&r.tempSuction!==''?r.tempSuction+' ℃':'',true) + df('外気温',r.tempOutdoor!=null&&r.tempOutdoor!==''?r.tempOutdoor+' ℃':'',true) + df('運転電流',r.current!=null&&r.current!==''?r.current+' A':'',true) + '</div></div>' +
      partsHtml +
      '<div class="detail-section"><h4>作業確認</h4><div class="detail-grid">' + df('ステータス',r.status) + df('作業者',r.worker) + '</div></div>' +
      signHtml;

    const editBtn = document.getElementById('edit-btn');
    const printBtn = document.getElementById('print-btn');
    if (editBtn) editBtn.style.display = readOnly ? 'none' : '';
    if (printBtn) printBtn.style.display = readOnly ? 'none' : '';
    document.getElementById('detail-modal').classList.add('open');
  } catch (err) {
    console.error('viewReport error:', err);
    showToast('詳細表示エラー: ' + err.message, 'error');
  }
};

window.closeModal = function(e) {
  if (!e || e.target === document.getElementById('detail-modal'))
    document.getElementById('detail-modal').classList.remove('open');
};
window.editCurrentReport = function() { closeModal(); editReport(currentReportId); };

// ===== Edit =====
window.editReport = function(id) {
  const r = allReports.find(x => x.id === id);
  if (!r) return;
  currentReportId = id;
  document.getElementById('form-title').textContent = '点検・作業報告書 — 編集';
  const map = [['customer-name','customerName'],['address','address'],['requester','requester'],['reception','reception'],['system-name','systemName'],['product-type','productType'],['maker','maker'],['model','model'],['serial','serial'],['ref-ship','refShip'],['ref-add','refAdd'],['ref-recover','refRecover'],['ref-fill','refFill'],['work-date','workDate'],['work-start','workStart',true],['work-end','workEnd',true],['symptom','symptom'],['cause','cause'],['work-content','workContent'],['remarks','remarks'],['temp-indoor-in','tempIndoorIn'],['temp-indoor-out','tempIndoorOut'],['press-discharge','pressDischarge'],['press-suction','pressSuction'],['temp-discharge','tempDischarge'],['temp-suction','tempSuction'],['temp-outdoor','tempOutdoor'],['current','current'],['status','status'],['worker','worker']];
  map.forEach(([fid, key]) => setv(fid, r[key]));
  const refSel = document.getElementById('refrigerant');
  const refOther = document.getElementById('refrigerant-other');
  const refVal = r.refrigerant || '';
  const knownRef = ['R-32','R-410A','R-407C','R-22','R-404A','R-134a'];
  if (refVal && !knownRef.includes(refVal)) {
    refSel.value = 'その他'; refOther.value = refVal; refOther.style.display = '';
  } else {
    refSel.value = refVal; refOther.value = ''; refOther.style.display = 'none';
  }
  const pl = document.getElementById('parts-list'); pl.innerHTML = '';
  (Array.isArray(r.parts) && r.parts.length ? r.parts : [{}]).forEach(p => addPartRow(p));

  if (r.customerSign) {
    currentSignDataUrl = r.customerSign;
    const img = document.getElementById('sign-preview-img');
    img.src = r.customerSign; img.style.display = 'block';
    document.getElementById('sign-preview-ph').style.display = 'none';
    document.getElementById('sign-preview').classList.add('signed');
  } else {
    clearSignInputDisplay();
  }

  showView('form', true);
};

// ===== Delete =====
window.deleteReport = async function(id) {
  if (!confirm('この報告書を削除しますか？')) return;
  try {
    await gasCall({ action: 'delete', id });
    showToast('削除しました', 'success');
    await loadReports();
  } catch (err) { showToast('削除失敗: ' + err.message, 'error'); }
};

function resetForm() {
  currentReportId = null;
  document.getElementById('form-title').textContent = '新規 点検・作業報告書';
  document.getElementById('report-form').reset();
  setTodayDate();
  document.getElementById('parts-list').innerHTML = '';
  addPartRow();
  clearSignInputDisplay();
  document.getElementById('refrigerant-other').style.display = 'none';
}

window.addPartRow = function(data) {
  data = data || {};
  const div = document.createElement('div');
  div.className = 'part-row';
  div.innerHTML =
    '<input type="text" class="form-input" placeholder="部品名" value="' + esc(data.name||'') + '">' +
    '<input type="number" class="form-input" placeholder="数量" value="' + (data.qty||'') + '" min="0">' +
    '<input type="text" class="form-input" placeholder="単位" value="' + esc(data.unit||'') + '">' +
    '<input type="text" class="form-input" placeholder="部品コード" value="' + esc(data.code||'') + '">' +
    '<button type="button" class="remove-btn" onclick="this.parentElement.remove()">✕</button>';
  document.getElementById('parts-list').appendChild(div);
};

// ===== 印刷（帳票）=====
window.openPrint = function() {
  const r = allReports.find(x => x.id === currentReportId);
  if (!r) return;
  const url = 'print.html?data=' + encodeURIComponent(JSON.stringify(r));
  window.open(url, '_blank');
};

// ===== ハッシュから閲覧専用で開く =====
function openFromHash() {
  const id = location.hash.replace('#', '');
  if (!id) return;
  const r = allReports.find(x => x.id === id);
  if (r) { currentReportId = id; viewReport(id, true); }
}

function showToast(msg, type) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (type ? ' ' + type : '');
  setTimeout(() => t.className = 'toast', 3500);
}

// ============================================================
// 入力フォーム用サインパッド
// ============================================================
let padCanvas, padCtx, padDrawing = false;

function initSignPad() {
  padCanvas = document.getElementById('sign-pad-canvas');
  padCtx = padCanvas.getContext('2d');

  function pos(e) {
    const r = padCanvas.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return { x: t.clientX - r.left, y: t.clientY - r.top };
  }
  padCanvas.addEventListener('mousedown', e => { padDrawing = true; const p = pos(e); padCtx.beginPath(); padCtx.moveTo(p.x, p.y); });
  padCanvas.addEventListener('mousemove', e => { if (!padDrawing) return; const p = pos(e); padCtx.lineTo(p.x, p.y); padCtx.stroke(); });
  padCanvas.addEventListener('mouseup', () => padDrawing = false);
  padCanvas.addEventListener('mouseleave', () => padDrawing = false);
  padCanvas.addEventListener('touchstart', e => { e.preventDefault(); padDrawing = true; const p = pos(e); padCtx.beginPath(); padCtx.moveTo(p.x, p.y); });
  padCanvas.addEventListener('touchmove', e => { e.preventDefault(); if (!padDrawing) return; const p = pos(e); padCtx.lineTo(p.x, p.y); padCtx.stroke(); });
  padCanvas.addEventListener('touchend', () => padDrawing = false);
}

function resizePadCanvas() {
  const dpr = window.devicePixelRatio || 1;
  padCanvas.width = padCanvas.offsetWidth * dpr;
  padCanvas.height = padCanvas.offsetHeight * dpr;
  padCtx.scale(dpr, dpr);
  padCtx.strokeStyle = '#000';
  padCtx.lineWidth = 6;
  padCtx.lineCap = 'round';
  padCtx.lineJoin = 'round';
}

window.openSignPad = function() {
  document.getElementById('sign-pad-modal').classList.add('open');
  setTimeout(resizePadCanvas, 80);
};
window.closeSignPad = function() {
  document.getElementById('sign-pad-modal').classList.remove('open');
};
window.clearSignPad = function() {
  padCtx.clearRect(0, 0, padCanvas.width, padCanvas.height);
};
window.confirmSignPad = function() {
  const px = padCtx.getImageData(0, 0, padCanvas.width, padCanvas.height).data;
  if (!px.some((v, i) => i % 4 === 3 && v > 0)) {
    alert('サインを入力してください');
    return;
  }
  const dataUrl = padCanvas.toDataURL('image/png');
  currentSignDataUrl = dataUrl;
  const img = document.getElementById('sign-preview-img');
  img.src = dataUrl; img.style.display = 'block';
  document.getElementById('sign-preview-ph').style.display = 'none';
  document.getElementById('sign-preview').classList.add('signed');
  closeSignPad();
};
window.clearSignInput = function() {
  currentSignDataUrl = '';
  clearSignInputDisplay();
};
function clearSignInputDisplay() {
  const img = document.getElementById('sign-preview-img');
  img.src = ''; img.style.display = 'none';
  document.getElementById('sign-preview-ph').style.display = '';
  document.getElementById('sign-preview').classList.remove('signed');
}

// ===== Helpers =====
const v = id => (document.getElementById(id)?.value || '').trim();
const vn = id => { const val = document.getElementById(id)?.value; return val !== '' && val != null ? Number(val) : null; };
const setv = (id, val) => { const el = document.getElementById(id); if (el && val != null && val !== '') el.value = val; };
const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const formatDate = d => { if (!d) return '—'; const dt = new Date(d); return isNaN(dt) ? d : dt.getFullYear() + '/' + String(dt.getMonth()+1).padStart(2,'0') + '/' + String(dt.getDate()).padStart(2,'0'); };
const df = (label, val, mono) => val != null && val !== '' ? '<div class="detail-field"><div class="detail-label">' + esc(label) + '</div><div class="detail-value' + (mono?' mono':'') + '">' + esc(val) + '</div></div>' : '';
const dft = (label, val) => val ? '<div class="detail-field" style="margin-bottom:12px"><div class="detail-label">' + esc(label) + '</div><div class="detail-text">' + esc(val) + '</div></div>' : '';
