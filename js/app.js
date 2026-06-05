// ============================================================
// 空調機器 点検・作業報告システム — フロントエンド
// バックエンド: Google Apps Script (GAS)
// ============================================================

// ★ GASのデプロイURLをここに貼り付けてください
const GAS_URL = 'https://script.google.com/macros/s/AKfycbymy6FDAsnFY-r24BNs5AlzJNBNOskCVe8D8x1ygT4As6plCkpq1rwvWZ1xR2HYSpM1Hg/exec';

let allReports = [];
let currentReportId = null;

document.addEventListener('DOMContentLoaded', () => {
  setTodayDate();
  addPartRow();
  loadReports();
});

function setTodayDate() {
  document.getElementById('work-date').value = new Date().toISOString().split('T')[0];
}

window.showView = function(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + view).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  if (view === 'form' && !currentReportId) resetForm();
};

async function gasGet() {
  const res = await fetch(GAS_URL, { method: 'GET' });
  const json = await res.json();
  if (json.status === 'error') throw new Error(json.data?.message || 'エラー');
  return json.data;
}

async function gasPost(body) {
  const res = await fetch(GAS_URL, { method: 'POST', body: JSON.stringify(body) });
  const json = await res.json();
  if (json.status === 'error') throw new Error(json.data?.message || 'エラー');
  return json.data;
}

async function loadReports() {
  try {
    allReports = await gasGet();
    renderTable(allReports);
  } catch (e) {
    renderTable([]);
    if (GAS_URL.includes('YOUR_DEPLOYMENT_ID')) {
      showToast('⚠ js/app.js の GAS_URL を設定してください', 'error');
    } else {
      showToast('読込失敗: ' + e.message, 'error');
    }
  }
}

function renderTable(reports) {
  const tbody = document.getElementById('report-tbody');
  if (!reports.length) {
    tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state"><span class="empty-icon">📋</span><p>報告書がありません。「新規報告書」から作成してください。</p></div></td></tr>';
    return;
  }
  tbody.innerHTML = reports.map(r => '<tr>' +
    '<td style="white-space:nowrap;font-family:var(--mono);font-size:12px">' + formatDate(r.workDate) + '</td>' +
    '<td><strong>' + esc(r.systemName||'—') + '</strong><br><span style="color:var(--text-sub);font-size:11px">' + esc(r.customerName||'') + '</span></td>' +
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

window.saveReport = async function(e) {
  e.preventDefault();
  const btn = document.getElementById('submit-btn');
  btn.disabled = true; btn.textContent = '保存中…';
  const data = collectFormData();
  try {
    if (currentReportId) {
      await gasPost({ action: 'update', id: currentReportId, data });
      showToast('更新しました', 'success');
    } else {
      await gasPost({ action: 'create', data });
      showToast('保存しました', 'success');
    }
    currentReportId = null;
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
    serial: v('serial'), refrigerant: v('refrigerant'),
    refShip: vn('ref-ship'), refAdd: vn('ref-add'), refRecover: vn('ref-recover'), refFill: vn('ref-fill'),
    workDate: v('work-date'), workStart: v('work-start'), workEnd: v('work-end'),
    symptom: v('symptom'), cause: v('cause'), workContent: v('work-content'), remarks: v('remarks'),
    tempIndoorIn: vn('temp-indoor-in'), tempIndoorOut: vn('temp-indoor-out'),
    pressDischarge: vn('press-discharge'), pressSuction: vn('press-suction'),
    tempDischarge: vn('temp-discharge'), tempSuction: vn('temp-suction'),
    tempOutdoor: vn('temp-outdoor'), current: vn('current'),
    parts, status: v('status'), worker: v('worker'), confirmer: v('confirmer'),
  };
}

window.viewReport = function(id) {
  const r = allReports.find(x => x.id === id);
  if (!r) return;
  currentReportId = id;
  document.getElementById('modal-title').textContent = formatDate(r.workDate) + ' — ' + (r.systemName || '');
  const p = r.parts && r.parts.length ? '<div class="detail-section"><h4>使用部品</h4><table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="background:var(--primary-light)"><th style="padding:8px;text-align:left">部品名</th><th style="padding:8px">数量</th><th style="padding:8px">単位</th><th style="padding:8px;text-align:left">コード</th></tr></thead><tbody>' + r.parts.map(p => '<tr style="border-bottom:1px solid var(--border-light)"><td style="padding:8px">' + esc(p.name) + '</td><td style="padding:8px;text-align:center">' + esc(p.qty) + '</td><td style="padding:8px;text-align:center">' + esc(p.unit) + '</td><td style="padding:8px;font-family:var(--mono);font-size:12px">' + esc(p.code) + '</td></tr>').join('') + '</tbody></table></div>' : '';
  document.getElementById('modal-body').innerHTML =
    '<div class="detail-section"><h4>基本情報</h4><div class="detail-grid">' + df('お客様名',r.customerName) + df('ご住所',r.address) + df('ご依頼元',r.requester) + df('受付内容',r.reception) + '</div></div>' +
    '<div class="detail-section"><h4>機器情報</h4><div class="detail-grid">' + df('系統名',r.systemName) + df('品種',r.productType) + df('メーカー',r.maker) + df('型式',r.model,true) + df('製番',r.serial,true) + df('使用冷媒',r.refrigerant) + df('出荷時充填量',r.refShip!=null?r.refShip+' kg':'') + df('追加充填量',r.refAdd!=null?r.refAdd+' kg':'') + df('冷媒回収量',r.refRecover!=null?r.refRecover+' kg':'') + df('冷媒充填量',r.refFill!=null?r.refFill+' kg':'') + '</div></div>' +
    '<div class="detail-section"><h4>作業情報</h4><div class="detail-grid">' + df('作業日',formatDate(r.workDate)) + df('作業時間',r.workStart&&r.workEnd?r.workStart+'～'+r.workEnd:'') + '</div>' + dft('症状',r.symptom) + dft('原因',r.cause) + dft('作業内容',r.workContent) + dft('備考',r.remarks) + '</div>' +
    '<div class="detail-section"><h4>運転データ</h4><div class="detail-grid">' + df('室内吸入温',r.tempIndoorIn!=null?r.tempIndoorIn+' ℃':'',true) + df('室内吹出温',r.tempIndoorOut!=null?r.tempIndoorOut+' ℃':'',true) + df('吐出圧力',r.pressDischarge!=null?r.pressDischarge+' MPa':'',true) + df('吸入圧力',r.pressSuction!=null?r.pressSuction+' MPa':'',true) + df('吐出温',r.tempDischarge!=null?r.tempDischarge+' ℃':'',true) + df('吸入温',r.tempSuction!=null?r.tempSuction+' ℃':'',true) + df('外気温',r.tempOutdoor!=null?r.tempOutdoor+' ℃':'',true) + df('運転電流',r.current!=null?r.current+' A':'',true) + '</div></div>' +
    p +
    '<div class="detail-section"><h4>作業確認</h4><div class="detail-grid">' + df('ステータス',r.status) + df('作業者',r.worker) + df('確認者',r.confirmer) + '</div></div>';
  document.getElementById('detail-modal').classList.add('open');
};

window.closeModal = function(e) {
  if (!e || e.target === document.getElementById('detail-modal'))
    document.getElementById('detail-modal').classList.remove('open');
};
window.editCurrentReport = function() { closeModal(); editReport(currentReportId); };

window.editReport = function(id) {
  const r = allReports.find(x => x.id === id);
  if (!r) return;
  currentReportId = id;
  document.getElementById('form-title').textContent = '点検・作業報告書 — 編集';
  const map = [['customer-name','customerName'],['address','address'],['requester','requester'],['reception','reception'],['system-name','systemName'],['product-type','productType'],['maker','maker'],['model','model'],['serial','serial'],['refrigerant','refrigerant'],['ref-ship','refShip'],['ref-add','refAdd'],['ref-recover','refRecover'],['ref-fill','refFill'],['work-date','workDate'],['work-start','workStart'],['work-end','workEnd'],['symptom','symptom'],['cause','cause'],['work-content','workContent'],['remarks','remarks'],['temp-indoor-in','tempIndoorIn'],['temp-indoor-out','tempIndoorOut'],['press-discharge','pressDischarge'],['press-suction','pressSuction'],['temp-discharge','tempDischarge'],['temp-suction','tempSuction'],['temp-outdoor','tempOutdoor'],['current','current'],['status','status'],['worker','worker'],['confirmer','confirmer']];
  map.forEach(([fid, key]) => setv(fid, r[key]));
  const pl = document.getElementById('parts-list'); pl.innerHTML = '';
  (r.parts && r.parts.length ? r.parts : [{}]).forEach(p => addPartRow(p));
  showView('form');
};

window.deleteReport = async function(id) {
  if (!confirm('この報告書を削除しますか？')) return;
  try {
    await gasPost({ action: 'delete', id });
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
}

window.addPartRow = function(data) {
  data = data || {};
  const div = document.createElement('div');
  div.className = 'part-row';
  div.innerHTML = '<input type="text" class="form-input" placeholder="部品名" value="' + esc(data.name||'') + '">' +
    '<input type="number" class="form-input" placeholder="数量" value="' + (data.qty||'') + '" min="0">' +
    '<input type="text" class="form-input" placeholder="単位" value="' + esc(data.unit||'') + '">' +
    '<input type="text" class="form-input" placeholder="部品コード" value="' + esc(data.code||'') + '">' +
    '<button type="button" class="remove-btn" onclick="this.parentElement.remove()">✕</button>';
  document.getElementById('parts-list').appendChild(div);
};

function showToast(msg, type) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (type ? ' ' + type : '');
  setTimeout(() => t.className = 'toast', 3500);
}

const v = id => (document.getElementById(id)?.value || '').trim();
const vn = id => { const val = document.getElementById(id)?.value; return val !== '' && val != null ? Number(val) : null; };
const setv = (id, val) => { const el = document.getElementById(id); if (el && val != null && val !== '') el.value = val; };
const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const formatDate = d => { if (!d) return '—'; const dt = new Date(d); return isNaN(dt) ? d : dt.getFullYear() + '/' + String(dt.getMonth()+1).padStart(2,'0') + '/' + String(dt.getDate()).padStart(2,'0'); };
const df = (label, val, mono) => val != null && val !== '' ? '<div class="detail-field"><div class="detail-label">' + esc(label) + '</div><div class="detail-value' + (mono?' mono':'') + '">' + esc(val) + '</div></div>' : '';
const dft = (label, val) => val ? '<div class="detail-field" style="margin-bottom:12px"><div class="detail-label">' + esc(label) + '</div><div class="detail-text">' + esc(val) + '</div></div>' : '';
