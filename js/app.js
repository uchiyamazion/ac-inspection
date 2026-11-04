// GAS_URLはjs/config.jsで設定

let allReports = [];
let currentReportId = null;
let currentParentId = null; // 「続きを作成」で紐付ける元レコードのid
let currentSignDataUrl = ''; // 入力フォームのサイン（base64）
let pendingOnly = false;      // 一覧を「対応待ち」のみ表示
let parentIdSet = new Set();  // 続きの記録を持つ（=最新ではない）記録のid集合
let modalFromForm = false;    // 入力フォーム上から詳細を開いたか（閉じたとき入力中の状態を戻す）
let formReportIdBackup = null;

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
  if (view === 'form') { if (keepId) hideDraftBanner(); updateEquipHistory(); }
};

// ===== GAS通信（読み取りGET・書き込みPOST）=====
const WRITE_ACTIONS = new Set(['create','update','delete','saveSign']);

async function gasCall(params) {
  const parseGasError = (json) => {
    if (json.status !== 'error') return null;
    // GASのエラー文字列は文字化けする場合があるため、内容をログのみ残してUIには表示しない
    const raw = typeof json.data === 'string' ? json.data : (json.data?.message || '');
    console.error('[GAS error]', raw);
    return raw || 'GASエラー';
  };

  if (WRITE_ACTIONS.has(params.action)) {
    const res = await fetch(GAS_URL, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(params)
    });
    const json = await res.json();
    const err = parseGasError(json);
    if (err) throw new Error(err);
    return json.data;
  } else {
    const url = GAS_URL + '?' + new URLSearchParams(params).toString();
    const res = await fetch(url, { redirect: 'follow' });
    const json = await res.json();
    const err = parseGasError(json);
    if (err) throw new Error(err);
    return json.data;
  }
}

// ===== Load =====
async function loadReports() {
  try {
    allReports = await gasCall({ action: 'list' });
    renderTable(allReports);
    checkSchemaColumns();
    populateSuggestions();
    if (location.hash.length > 1) openFromHash();
  } catch (e) {
    renderTable([]);
    showToast('データの読み込みに失敗しました', 'error');
  }
}

// ===== 過去のお客様名・ご依頼元をサジェスト =====
function populateSuggestions() {
  const uniq = (arr) => Array.from(new Set(arr.filter(Boolean)));
  const customerList = document.getElementById('customer-name-list');
  const requesterList = document.getElementById('requester-list');
  if (customerList) customerList.innerHTML = uniq(allReports.map(r => r.customerName)).map(v => '<option value="' + esc(v) + '">').join('');
  if (requesterList) requesterList.innerHTML = uniq(allReports.map(r => r.requester)).map(v => '<option value="' + esc(v) + '">').join('');
}

// ===== Render =====
let lastRenderedReports = [];
const siteToggleOverride = new Map(); // 現場名 -> 開いているか（手動で開閉した分）

function isFilteringList() {
  return !!(document.getElementById('search-site').value || document.getElementById('filter-month').value || document.getElementById('filter-status').value || document.getElementById('filter-parts').value);
}

function tsOf(r) { const t = new Date(r.workDate).getTime(); return isNaN(t) ? 0 : t; }
function daysSince(d) {
  const dt = new Date(d); if (isNaN(dt)) return 0;
  const a0 = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
  const n = new Date(); const b0 = new Date(n.getFullYear(), n.getMonth(), n.getDate());
  return Math.max(0, Math.round((b0 - a0) / 86400000));
}
// 対応待ち＝続きの記録が無い最新の記録のうち、完了していないもの（見積書提出・未完了）
function isPendingRecord(r) { return !parentIdSet.has(r.id) && !!r.status && r.status !== '完了'; }
function elapsedBadge(r) {
  const d = daysSince(r.workDate);
  const cls = d >= 14 ? 'elapsed-late' : (d >= 7 ? 'elapsed-warn' : '');
  return '<span class="badge badge-elapsed ' + cls + '" style="white-space:nowrap" title="作業日から' + d + '日経過">経過' + d + '日</span>';
}
const TRACK_CLASS = { '発注連絡あり': '', '部品未手配': 't-unordered', '部品手配済': 't-ordered', '部品使用なし': 't-none', '見積未提出': 't-unordered', '見積提出済': 't-ordered', '見積不要': 't-none' };
function trackBadges(r) {
  return [r.orderContact, r.partsStatus, r.estimateStatus].filter(Boolean)
    .map(t => '<span class="badge badge-track ' + (TRACK_CLASS[t] || '') + '">' + esc(t) + (t === '見積提出済' && r.estimateDate ? '（' + esc(formatDate(r.estimateDate).slice(5)) + '）' : '') + '</span>').join(' ');
}
function updatePendingUi() {
  const n = allReports.filter(isPendingRecord).length;
  const c = document.getElementById('pending-count'); if (c) c.textContent = n ? '(' + n + ')' : '';
  const btn = document.getElementById('pending-btn'); if (btn) btn.classList.toggle('active', pendingOnly);
  const note = document.getElementById('pending-note');
  if (note) {
    note.style.display = pendingOnly ? '' : 'none';
    note.textContent = '⏳ 対応待ち ' + n + '件（作業日が古い順）　※続きの記録が無い「見積書提出」「未完了」の案件です';
  }
}
window.togglePending = function() { pendingOnly = !pendingOnly; filterReports(); };

function buildRowHtml(r, inGroup) {
  const tip = getChainTipRecord(r);
  const statusCell = '<span class="badge badge-' + esc(r.status) + '">' + esc(r.status||'—') + '</span>' +
    (tip ? ' <span class="badge badge-' + esc(tip.status) + '" style="opacity:0.85;cursor:pointer;white-space:nowrap" title="続きの記録（' + esc(formatDate(tip.workDate)) + '）を見る" onclick="viewReport(\'' + tip.id + '\')">→ ' + esc(tip.status||'—') + '</span>' : '');
  // スマホでは右のステータス列まで横スクロールしないと見えないため、左の列にも小さく表示する（PCでは非表示）
  const nameStatus = '<div class="name-status"><span class="badge badge-' + esc(r.status) + '">' + esc(r.status||'—') + '</span>' + (isPendingRecord(r) ? elapsedBadge(r) : '') + trackBadges(r) + '</div>';
  const nameCell = inGroup
    ? '<td style="padding-left:28px"><strong>' + esc(r.systemName||'—') + '</strong>' + nameStatus + '</td>'
    : '<td><strong>' + esc(r.customerName||'—') + '</strong><br><span style="color:var(--text-sub);font-size:11px">' + esc(r.systemName||'') + '</span>' + nameStatus + '</td>';
  return '<tr' + (inGroup ? ' class="group-child"' : '') + '>' +
    '<td style="white-space:nowrap;font-family:var(--mono);font-size:12px">' + formatDate(r.workDate) + '</td>' +
    nameCell +
    '<td>' + esc(r.maker||'—') + '</td>' +
    '<td style="font-family:var(--mono);font-size:12px">' + esc(r.model||'—') + '</td>' +
    '<td>' + esc(r.refrigerant||'—') + '</td>' +
    '<td>' + statusCell + (isPendingRecord(r) ? ' ' + elapsedBadge(r) : '') + (trackBadges(r) ? ' ' + trackBadges(r) : '') + '</td>' +
    '<td><div class="row-actions">' +
      '<button class="row-btn" onclick="viewReport(\'' + r.id + '\')">詳細</button>' +
      '<button class="row-btn" onclick="editReport(\'' + r.id + '\')">編集</button>' +
      '<button class="row-btn danger" onclick="deleteReport(\'' + r.id + '\')">削除</button>' +
    '</div></td></tr>';
}

function renderTable(reports) {
  parentIdSet = new Set(allReports.map(x => x.parentId).filter(Boolean));
  lastRenderedReports = reports || [];
  updatePendingUi();
  if (pendingOnly) reports = (reports || []).filter(isPendingRecord).sort((x, y) => tsOf(x) - tsOf(y)); // 古い順
  const tbody = document.getElementById('report-tbody');
  if (!reports || !reports.length) {
    tbody.innerHTML = pendingOnly
      ? '<tr><td colspan="7"><div class="empty-state"><span class="empty-icon">✅</span><p>対応待ちの案件はありません。</p></div></td></tr>'
      : '<tr><td colspan="7"><div class="empty-state"><span class="empty-icon">📋</span><p>報告書がありません。「新規報告書」から作成してください。</p></div></td></tr>';
    return;
  }
  const modeEl = document.getElementById('list-mode');
  const mode = pendingOnly ? 'date' : (modeEl ? modeEl.value : 'site');
  if (mode !== 'site') {
    tbody.innerHTML = reports.map(r => buildRowHtml(r, false)).join('');
    return;
  }

  // 現場（お客様名）ごとにグループ化
  const ts = r => { const t = new Date(r.workDate).getTime(); return isNaN(t) ? 0 : t; };
  const groups = new Map();
  reports.forEach(r => {
    const k = r.customerName || '（現場名なし）';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  });
  const parentIds = new Set(allReports.map(x => x.parentId).filter(Boolean));
  const filtering = isFilteringList();
  const ordered = Array.from(groups.entries()).map(([name, list]) => {
    list.sort((a, b) => ts(b) - ts(a));
    return { name, list };
  }).sort((a, b) => ts(b.list[0]) - ts(a.list[0]));

  tbody.innerHTML = ordered.map(({ name, list }) => {
    const open = siteToggleOverride.has(name) ? siteToggleOverride.get(name) : filtering;
    // 対応待ち＝続きが作られていない最新の記録のうち、完了していないもの
    const pending = {};
    list.forEach(x => {
      if (!parentIds.has(x.id) && x.status && x.status !== '完了') {
        const p = pending[x.status] || (pending[x.status] = { n: 0, maxDays: 0 });
        p.n++; p.maxDays = Math.max(p.maxDays, daysSince(x.workDate));
      }
    });
    const pendingHtml = Object.keys(pending).map(st => '<span class="badge badge-' + esc(st) + '">' + esc(st) + ' ' + pending[st].n + '件・最長' + pending[st].maxDays + '日</span>').join(' ');
    const head = '<tr class="group-row" data-key="' + encodeURIComponent(name) + '" onclick="toggleSite(this.dataset.key)"><td colspan="7"><div class="group-head">' +
      '<span class="group-arrow">' + (open ? '▼' : '▶') + '</span> <strong>' + esc(name) + '</strong>' +
      '<span class="group-meta">' + list.length + '件　最終 ' + esc(formatDate(list[0].workDate)) + '</span> ' + pendingHtml +
      '</div></td></tr>';
    return head + (open ? list.map(r => buildRowHtml(r, true)).join('') : '');
  }).join('');
}

window.toggleSite = function(enc) {
  const name = decodeURIComponent(enc);
  const cur = siteToggleOverride.has(name) ? siteToggleOverride.get(name) : isFilteringList();
  siteToggleOverride.set(name, !cur);
  renderTable(lastRenderedReports);
};

// 一覧で「→続きあり」を表示するため、記録の一連の続きの最終到達点(チェーンの先端)を返す（続きがなければnull）
function getChainTipRecord(r) {
  let cur = r;
  let tip = null;
  const seen = new Set([r.id]);
  while (true) {
    const children = allReports.filter(x => x.parentId === cur.id && !seen.has(x.id));
    if (!children.length) break;
    children.sort((a,b) => new Date(b.workDate) - new Date(a.workDate));
    cur = children[0];
    seen.add(cur.id);
    tip = cur;
  }
  return tip;
}

// ===== Filter =====
window.filterReports = function() {
  siteToggleOverride.clear();
  const site = document.getElementById('search-site').value.toLowerCase();
  const month = document.getElementById('filter-month').value;
  const status = document.getElementById('filter-status').value;
  const track = document.getElementById('filter-parts').value;
  const est = document.getElementById('filter-estimate').value;
  renderTable(allReports.filter(r =>
    (!site || (r.systemName||'').toLowerCase().includes(site) || (r.customerName||'').toLowerCase().includes(site)) &&
    (!month || (r.workDate||'').startsWith(month)) &&
    (!status || r.status === status) &&
    (!track || (track === '発注連絡あり' ? r.orderContact === track : r.partsStatus === track)) &&
    (!est || r.estimateStatus === est)
  ));
};
window.clearFilters = function() {
  siteToggleOverride.clear();
  pendingOnly = false;
  document.getElementById('search-site').value = '';
  document.getElementById('filter-month').value = '';
  document.getElementById('filter-status').value = '';
  document.getElementById('filter-parts').value = '';
  document.getElementById('filter-estimate').value = '';
  renderTable(allReports);
};

// ===== サイン画像を圧縮（保存サイズを抑える）=====
function compressSign(srcDataUrl, maxW, maxH, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = () => reject(new Error('サイン画像の読み込みに失敗しました'));
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
  const wasNew = !currentReportId;
  try {
    // POSTはpayloadキーにデータを入れる（doPost: payload = body.payload || body）
    const action = currentReportId ? 'update' : 'create';
    const payload = Object.assign({}, data);
    if (currentReportId) payload.id = currentReportId;
    const params = { action, payload };

    let savedId = currentReportId;
    const result = await gasCall(params);
    if (!savedId) savedId = result.id;

    // 新しく書いたサイン（data URL）のみ送信。編集時に既存サイン（保存済みURL）が入っている場合は再送しない
    let signFailed = false;
    if (currentSignDataUrl && currentSignDataUrl.startsWith('data:image/png') && savedId) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const compressed = await compressSign(currentSignDataUrl, 300, 100, 0.92);
          const base64only = compressed.replace(/^data:image\/jpeg;base64,/, '');
          await gasCall({ action: 'saveSign', id: savedId, signData: base64only });
          signFailed = false;
          break;
        } catch (signErr) {
          signFailed = true;
          console.error('サイン保存失敗(' + attempt + '回目):', signErr);
        }
      }
    }

    if (signFailed) {
      showToast('報告書は保存しましたが、サインの保存に失敗しました。詳細を開いて編集から、サインを入れ直してください', 'error', 9000);
    } else {
      showToast(currentReportId ? '更新しました' : '保存しました', 'success');
    }
    if (data.worker) { try { localStorage.setItem('acLastWorker', data.worker); } catch (e) {} } // 次回の作業者を自動入力
    if (wasNew) clearDraft(); // 保存できたので下書きは不要
    currentReportId = null;
    currentParentId = null;
    currentSignDataUrl = '';
    await loadReports();
    showView('list');
  } catch (err) {
    showToast('保存に失敗しました。GASの設定を確認してください', 'error');
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
    refShip: vn('ref-ship'), refAdd: vn('ref-add'), refRecover: vn('ref-recover'), refReturn: vn('ref-return'), refFill: vn('ref-fill'),
    workDate: v('work-date'), workStart: v('work-start'), workEnd: v('work-end'),
    symptom: v('symptom'), cause: v('cause'), workContent: v('work-content'), remarks: v('remarks'),
    tempIndoorIn: vn('temp-indoor-in'), tempIndoorOut: vn('temp-indoor-out'),
    pressDischarge: vn('press-discharge'), pressSuction: vn('press-suction'),
    tempDischarge: vn('temp-discharge'), tempSuction: vn('temp-suction'),
    tempOutdoor: vn('temp-outdoor'), current: vn('current'),
    parts, status: v('status'), worker: v('worker'), parentId: currentParentId || '',
    orderContact: v('order-contact'), partsStatus: v('parts-status'),
    estimateStatus: v('estimate-status'), estimateDate: v('estimate-date'),
  };
}

// ===== 発注・部品の管理（詳細画面からワンタップで更新）=====
function buildManageHtml(r) {
  const chip = (field, val) => '<button type="button" class="chip' + (r[field] === val ? ' on' : '') + '" onclick="quickSet(\'' + field + '\',\'' + val + '\')">' + val + '</button>';
  return '<div class="manage-box"><h4>発注・部品の管理</h4>' +
    '<p class="manage-hint">タップするとその場で保存されます（もう一度押すと解除）</p>' +
    '<div class="manage-row"><span class="manage-label">発注</span>' + chip('orderContact', '発注連絡あり') + '</div>' +
    '<div class="manage-row"><span class="manage-label">部品</span>' + chip('partsStatus', '部品未手配') + chip('partsStatus', '部品手配済') + chip('partsStatus', '部品使用なし') + '</div>' +
    '<div class="manage-row"><span class="manage-label">見積</span>' + chip('estimateStatus', '見積未提出') + chip('estimateStatus', '見積提出済') + chip('estimateStatus', '見積不要') + '</div>' +
    (r.estimateStatus === '見積提出済' ? '<div class="manage-row"><span class="manage-label">提出日</span><input type="date" id="manage-estimate-date" class="form-input manage-date" value="' + esc(toDateInputValue(r.estimateDate)) + '" onclick="openPicker(this)" onchange="quickSetEstimateDate(this.value)"></div>' : '') + '</div>';
}
const TRACK_COLUMNS = ['orderContact', 'partsStatus', 'estimateStatus', 'estimateDate'];
function localToday() { return toDateInputValue(new Date()); }
// カレンダーを開く（未対応のブラウザは標準動作に任せる）
window.openPicker = function(el) { try { if (el && el.showPicker) el.showPicker(); } catch (e) {} };
window.quickSet = async function(field, value) {
  const r = allReports.find(x => x.id === currentReportId); if (!r) return;
  const missing = TRACK_COLUMNS.filter(k => !(k in r));
  if (missing.length) { showToast('スプレッドシートに「' + missing.join('」「') + '」列がないため保存できません', 'error', 6000); return; }
  const next = r[field] === value ? '' : value; // 同じものをもう一度押すと解除
  // 見積提出済にしたら提出日（今日）も一緒に記録、解除・変更時は提出日を消す
  const extra = {};
  if (field === 'estimateStatus') extra.estimateDate = next === '見積提出済' ? (toDateInputValue(r.estimateDate) || localToday()) : '';
  document.querySelectorAll('.manage-box .chip').forEach(b => b.disabled = true);
  try {
    // acUpdate は parts を必ず上書きするため、現在の部品を一緒に送る（他の項目は送らない＝そのまま保持される）
    await gasCall({ action: 'update', payload: { id: r.id, parts: Array.isArray(r.parts) ? r.parts : [], [field]: next, ...extra } });
    r[field] = next; Object.assign(r, extra);
    showToast(next ? '「' + next + '」に更新しました' : '「' + value + '」を解除しました', 'success');
  } catch (e) {
    console.error('quickSet失敗:', e);
    showToast('更新に失敗しました。通信状況を確認してもう一度お試しください', 'error', 5000);
  }
  if (currentReportId === r.id) viewReport(r.id); // 詳細を再描画
  filterReports();                                  // 一覧にも反映
  if (field === 'estimateStatus' && r.estimateStatus === '見積提出済') setTimeout(() => openPicker(document.getElementById('manage-estimate-date')), 150); // 日付を直せるようカレンダーを開く
};

// 詳細画面で提出日だけ変更
window.quickSetEstimateDate = async function(value) {
  const r = allReports.find(x => x.id === currentReportId); if (!r || !value) return;
  try {
    await gasCall({ action: 'update', payload: { id: r.id, parts: Array.isArray(r.parts) ? r.parts : [], estimateDate: value } });
    r.estimateDate = value;
    showToast('見積提出日を ' + value.replace(/-/g, '/') + ' にしました', 'success');
  } catch (e) {
    console.error('見積提出日の更新失敗:', e);
    showToast('更新に失敗しました。通信状況を確認してもう一度お試しください', 'error', 5000);
  }
  if (currentReportId === r.id) viewReport(r.id);
  filterReports();
};

// 必須の列がスプレッドシートに無いと保存されない（エラーにならず値だけ捨てられる）ため、気づけるよう警告する
const REQUIRED_COLUMNS = ['parentId', 'refReturn', 'orderContact', 'partsStatus', 'estimateStatus', 'estimateDate'];
function checkSchemaColumns() {
  const box = document.getElementById('schema-warning'); if (!box) return;
  const missing = allReports.length ? REQUIRED_COLUMNS.filter(k => !(k in allReports[0])) : [];
  if (!missing.length) { box.style.display = 'none'; return; }
  box.innerHTML = '⚠️ スプレッドシート「点検報告」の1行目に、次の列見出しを追加してください：<b>' + missing.map(esc).join('、') +
    '</b><br>追加するまで、この項目は保存されません（綴り・大文字小文字は完全一致）。';
  box.style.display = '';
}

// ===== 関連する対応履歴（parentIdで連なった一連の記録）=====
function buildHistoryChain(r) {
  const byId = {};
  allReports.forEach(x => { byId[x.id] = x; });
  const chain = [r];
  const seen = new Set([r.id]);
  // 過去方向（親）へさかのぼる
  let cur = r;
  while (cur.parentId && byId[cur.parentId] && !seen.has(cur.parentId)) {
    cur = byId[cur.parentId];
    chain.unshift(cur);
    seen.add(cur.id);
  }
  // 未来方向（子）へたどる
  let frontier = [r.id];
  while (frontier.length) {
    const next = [];
    frontier.forEach(pid => {
      allReports.filter(x => x.parentId === pid).forEach(child => {
        if (!seen.has(child.id)) { chain.push(child); seen.add(child.id); next.push(child.id); }
      });
    });
    frontier = next;
  }
  return chain;
}

function buildHistoryHtml(r, readOnly) {
  const chain = buildHistoryChain(r);
  if (chain.length <= 1) return '';
  return '<div class="detail-section"><h4>関連する対応履歴（' + chain.length + '件）</h4>' +
    '<div style="display:flex;flex-direction:column;gap:6px">' +
    chain.map(x => {
      const isCurrent = x.id === r.id;
      return '<div' + (isCurrent ? '' : ' onclick="viewReport(\'' + x.id + '\'' + (readOnly ? ',true' : '') + ')"') +
        ' style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;border-radius:6px;background:' + (isCurrent ? 'var(--primary-light)' : '#f5f5f5') + ';' + (isCurrent ? '' : 'cursor:pointer;') + '">' +
        '<span>' + formatDate(x.workDate) + (isCurrent ? '（表示中）' : '') + '</span>' +
        '<span style="font-size:12px;color:var(--text-sub)">' + esc(x.status||'') + '</span>' +
        '</div>';
    }).join('') +
    '</div></div>';
}

// ===== Detail Modal =====
window.viewReport = function(id, readOnly) {
  try {
    const r = allReports.find(x => x.id === id);
    if (!r) { showToast('該当データが見つかりません(id:' + id + ')', 'error'); return; }
    if (document.getElementById('view-form').classList.contains('active') && !modalFromForm) {
      modalFromForm = true; formReportIdBackup = currentReportId; // 入力中のフォームの状態を覚えておく
    }
    currentReportId = id;
    document.getElementById('modal-title').textContent = formatDate(r.workDate) + ' — ' + (r.systemName || '');
    const partsHtml = Array.isArray(r.parts) && r.parts.length
      ? '<div class="detail-section"><h4>使用部品</h4><table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="background:var(--primary-light)"><th style="padding:8px;text-align:left">部品名</th><th style="padding:8px">数量</th><th style="padding:8px">単位</th><th style="padding:8px;text-align:left">コード</th></tr></thead><tbody>'
        + r.parts.map(p => '<tr style="border-bottom:1px solid var(--border-light)"><td style="padding:8px">' + esc(p.name) + '</td><td style="padding:8px;text-align:center">' + esc(p.qty) + '</td><td style="padding:8px;text-align:center">' + esc(p.unit) + '</td><td style="padding:8px;font-family:var(--mono);font-size:12px">' + esc(p.code) + '</td></tr>').join('')
        + '</tbody></table></div>' : '';
    const signHtml = r.customerSign
      ? '<div class="detail-section"><h4>お客様サイン</h4><img src="' + esc(r.customerSign) + '" style="max-width:240px;max-height:80px;border:1px solid var(--border-light);border-radius:6px;padding:6px;background:#fafafa;"></div>'
      : '';
    const historyHtml = buildHistoryHtml(r, readOnly);
    document.getElementById('modal-body').innerHTML =
      historyHtml +
      (readOnly ? '' : buildManageHtml(r)) +
      '<div class="detail-section"><h4>基本情報</h4><div class="detail-grid">' + df('お客様名',r.customerName) + df('ご住所',r.address) + df('ご依頼元',r.requester) + df('受付内容',r.reception) + '</div></div>' +
      '<div class="detail-section"><h4>機器情報</h4><div class="detail-grid">' + df('系統名',r.systemName) + df('品種',r.productType) + df('メーカー',r.maker) + df('型式',r.model,true) + df('製番',r.serial,true) + df('使用冷媒',r.refrigerant) + df('出荷時充填量',r.refShip!=null&&r.refShip!==''?r.refShip+' kg':'') + df('追加充填量',r.refAdd!=null&&r.refAdd!==''?r.refAdd+' kg':'') + df('冷媒回収量',r.refRecover!=null&&r.refRecover!==''?r.refRecover+' kg':'') + df('冷媒戻し量',r.refReturn!=null&&r.refReturn!==''?r.refReturn+' kg':'') + df('冷媒新規充填量',r.refFill!=null&&r.refFill!==''?r.refFill+' kg':'') + '</div></div>' +
      '<div class="detail-section"><h4>作業情報</h4><div class="detail-grid">' + df('作業日',formatDate(r.workDate)) + df('作業時間',r.workStart&&r.workEnd?formatTime(r.workStart)+'～'+formatTime(r.workEnd):'') + '</div>' + dft('症状',r.symptom) + dft('原因',r.cause) + dft('作業内容',r.workContent) + dft('備考',r.remarks) + '</div>' +
      '<div class="detail-section"><h4>運転データ</h4><div class="detail-grid">' + df('室内吸入温',r.tempIndoorIn!=null&&r.tempIndoorIn!==''?r.tempIndoorIn+' ℃':'',true) + df('室内吹出温',r.tempIndoorOut!=null&&r.tempIndoorOut!==''?r.tempIndoorOut+' ℃':'',true) + df('吐出圧力',r.pressDischarge!=null&&r.pressDischarge!==''?r.pressDischarge+' MPa':'',true) + df('吸入圧力',r.pressSuction!=null&&r.pressSuction!==''?r.pressSuction+' MPa':'',true) + df('吐出温',r.tempDischarge!=null&&r.tempDischarge!==''?r.tempDischarge+' ℃':'',true) + df('吸入温',r.tempSuction!=null&&r.tempSuction!==''?r.tempSuction+' ℃':'',true) + df('外気温',r.tempOutdoor!=null&&r.tempOutdoor!==''?r.tempOutdoor+' ℃':'',true) + df('運転電流',r.current!=null&&r.current!==''?r.current+' A':'',true) + '</div></div>' +
      partsHtml +
      '<div class="detail-section"><h4>作業確認</h4><div class="detail-grid">' + df('ステータス',r.status) + df('発注連絡',r.orderContact) + df('部品の状況',r.partsStatus) + df('見積',r.estimateStatus ? r.estimateStatus + (r.estimateStatus === '見積提出済' && r.estimateDate ? '（' + formatDate(r.estimateDate) + '）' : '') : '') + df('作業者',r.worker) + '</div></div>' +
      signHtml;

    const editBtn = document.getElementById('edit-btn');
    const printBtn = document.getElementById('print-btn');
    const continueBtn = document.getElementById('continue-btn');
    if (editBtn) editBtn.style.display = readOnly ? 'none' : '';
    if (printBtn) printBtn.style.display = readOnly ? 'none' : '';
    if (continueBtn) continueBtn.style.display = readOnly ? 'none' : '';
    document.getElementById('detail-modal').classList.add('open');
  } catch (err) {
    console.error('viewReport error:', err);
    showToast('詳細表示エラー: ' + err.message, 'error');
  }
};

window.closeModal = function(e) {
  if (!e || e.target === document.getElementById('detail-modal')) {
    document.getElementById('detail-modal').classList.remove('open');
    if (modalFromForm) { currentReportId = formReportIdBackup; modalFromForm = false; } // フォーム上で開いた詳細を閉じたら、入力中の状態に戻す
  }
};
window.editCurrentReport = function() { closeModal(); editReport(currentReportId); };
window.continueCurrentReport = function() { closeModal(); continueReport(currentReportId); };

// ===== 対応済み物件から選択 =====
function getDistinctProperties() {
  const map = new Map();
  allReports.forEach(r => {
    if (!r.customerName) return;
    const key = (r.customerName||'') + '|' + (r.systemName||'');
    const existing = map.get(key);
    if (!existing || new Date(r.workDate) > new Date(existing.workDate)) map.set(key, r);
  });
  return Array.from(map.values()).sort((a,b) => (a.customerName||'').localeCompare(b.customerName||'', 'ja') || (a.systemName||'').localeCompare(b.systemName||'', 'ja'));
}

window.openPropertyPicker = function() {
  document.getElementById('property-search').value = '';
  renderPropertyList();
  document.getElementById('property-modal').classList.add('open');
};
window.closePropertyPicker = function(e) {
  if (!e || e.target === document.getElementById('property-modal'))
    document.getElementById('property-modal').classList.remove('open');
};

function renderPropertyList() {
  const q = (document.getElementById('property-search').value || '').trim().toLowerCase();
  const list = getDistinctProperties().filter(r =>
    !q || (r.customerName||'').toLowerCase().includes(q) || (r.systemName||'').toLowerCase().includes(q)
  );
  const container = document.getElementById('property-list');
  if (!list.length) {
    container.innerHTML = '<div class="empty-state" style="padding:24px 0"><p>該当する物件がありません</p></div>';
    return;
  }
  container.innerHTML = list.map(r =>
    '<div onclick="selectProperty(\'' + r.id + '\')" style="padding:10px 12px;border:1px solid var(--border-light);border-radius:8px;margin-bottom:8px;cursor:pointer" onmouseover="this.style.background=\'#f5f5f5\'" onmouseout="this.style.background=\'\'">' +
    '<div style="font-weight:600">' + esc(r.customerName) + (r.systemName ? '　<span style="color:var(--text-sub);font-weight:400;font-size:12px">' + esc(r.systemName) + '</span>' : '') + '</div>' +
    '<div style="font-size:12px;color:var(--text-sub);margin-top:2px">' + esc(r.address||'') + (r.maker||r.model ? '　' + esc(r.maker||'') + ' ' + esc(r.model||'') : '') + '</div>' +
    '</div>'
  ).join('');
}

window.selectProperty = function(id) {
  const r = allReports.find(x => x.id === id);
  if (!r) return;
  const carryOver = [
    ['customer-name','customerName'], ['address','address'], ['requester','requester'],
    ['system-name','systemName'], ['product-type','productType'], ['maker','maker'], ['model','model'], ['serial','serial'],
    ['ref-ship','refShip'], ['ref-add','refAdd'],
  ];
  carryOver.forEach(([fid, key]) => setv(fid, r[key]));

  const refSel = document.getElementById('refrigerant');
  const refOther = document.getElementById('refrigerant-other');
  const refVal = r.refrigerant || '';
  const knownRef = ['R-32','R-410A','R-407C','R-22','R-404A','R-134a'];
  if (refVal && !knownRef.includes(refVal)) {
    refSel.value = 'その他'; refOther.value = refVal; refOther.style.display = '';
  } else if (refVal) {
    refSel.value = refVal; refOther.value = ''; refOther.style.display = 'none';
  }

  closePropertyPicker();
  updateEquipHistory();
  showToast('物件情報を呼び出しました', 'success');
};

// ===== 続きを作成（見積提出→部品交換完了などの簡易入力）=====
window.continueReport = function(id) {
  const r = allReports.find(x => x.id === id);
  if (!r) return;
  currentReportId = null; // 新規レコードとして保存させる
  currentParentId = id;   // 元レコードと紐付け（履歴追跡用）
  document.getElementById('form-title').textContent = '点検・作業報告書 — 続きを作成（' + (r.systemName || r.customerName || '') + '）';
  document.getElementById('report-form').reset();
  document.getElementById('parts-list').innerHTML = '';
  addPartRow();
  clearSignInputDisplay();

  // お客様情報・機器情報を引き継ぐ
  const carryOver = [
    ['customer-name','customerName'], ['address','address'], ['requester','requester'], ['reception','reception'],
    ['system-name','systemName'], ['product-type','productType'], ['maker','maker'], ['model','model'], ['serial','serial'],
    ['ref-ship','refShip'], ['ref-add','refAdd'],
    ['symptom','symptom'], ['cause','cause'], // 前回の症状・原因は参照として引き継ぐ
    ['worker','worker'],
  ];
  carryOver.forEach(([fid, key]) => setv(fid, r[key]));
  if (!v('worker')) { try { setv('worker', localStorage.getItem('acLastWorker')); } catch (e) {} }

  const refSel = document.getElementById('refrigerant');
  const refOther = document.getElementById('refrigerant-other');
  const refVal = r.refrigerant || '';
  const knownRef = ['R-32','R-410A','R-407C','R-22','R-404A','R-134a'];
  if (refVal && !knownRef.includes(refVal)) {
    refSel.value = 'その他'; refOther.value = refVal; refOther.style.display = '';
  } else {
    refSel.value = refVal; refOther.value = ''; refOther.style.display = 'none';
  }

  // 今回の結果は毎回変わりうる（直らないこともある）ため、ステータスは必ず手動選択させる
  document.getElementById('status').value = '';

  // 今回の入力項目は空のまま：作業日は今日、作業時間・作業内容・部品・運転データ・サインは新規入力
  setTodayDate();

  showView('form', true);
  showToast('前回の情報を引き継ぎました。今回分の作業内容とステータスを入力してください', 'success');
};

// ===== Edit =====
window.editReport = function(id) {
  const r = allReports.find(x => x.id === id);
  if (!r) return;
  document.getElementById('report-form').reset(); // 直前に開いた別の記録の値が、空欄の項目に残らないように
  clearTimeout(draftTimer);
  currentReportId = id;
  currentParentId = r.parentId || null;
  document.getElementById('form-title').textContent = '点検・作業報告書 — 編集';
  const map = [['customer-name','customerName'],['address','address'],['requester','requester'],['reception','reception'],['system-name','systemName'],['product-type','productType'],['maker','maker'],['model','model'],['serial','serial'],['ref-ship','refShip'],['ref-add','refAdd'],['ref-recover','refRecover'],['ref-return','refReturn'],['ref-fill','refFill'],['symptom','symptom'],['cause','cause'],['work-content','workContent'],['remarks','remarks'],['temp-indoor-in','tempIndoorIn'],['temp-indoor-out','tempIndoorOut'],['press-discharge','pressDischarge'],['press-suction','pressSuction'],['temp-discharge','tempDischarge'],['temp-suction','tempSuction'],['temp-outdoor','tempOutdoor'],['current','current'],['status','status'],['worker','worker']];
  map.forEach(([fid, key]) => setv(fid, r[key]));
  document.getElementById('order-contact').value = r.orderContact || '';
  document.getElementById('parts-status').value = r.partsStatus || '';
  document.getElementById('estimate-status').value = r.estimateStatus || '';
  document.getElementById('estimate-date').value = toDateInputValue(r.estimateDate);
  // 作業日・作業時間は生のISO日時文字列で返ることがあるため、input要素が受け付ける形式に変換してセット
  setv('work-date', toDateInputValue(r.workDate));
  setv('work-start', formatTime(r.workStart) !== '—' ? formatTime(r.workStart) : '');
  setv('work-end', formatTime(r.workEnd) !== '—' ? formatTime(r.workEnd) : '');
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
  } catch (err) { showToast('削除に失敗しました', 'error'); }
};

function resetForm() {
  currentReportId = null;
  currentParentId = null;
  document.getElementById('form-title').textContent = '新規 点検・作業報告書';
  document.getElementById('report-form').reset();
  setTodayDate();
  document.getElementById('parts-list').innerHTML = '';
  addPartRow();
  clearSignInputDisplay();
  document.getElementById('refrigerant-other').style.display = 'none';
  try { const w = localStorage.getItem('acLastWorker'); if (w) document.getElementById('worker').value = w; } catch (e) {}
  showDraftBannerIfAny();
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
  // サイン画像を含むとURLが長すぎて開けなくなるため、データはURLに載せずIDだけ渡す。
  // データはlocalStorageに一時保存し、使えない場合は印刷画面側でGASから取得する。
  try {
    Object.keys(localStorage).filter(k => k.startsWith('acPrint:')).forEach(k => localStorage.removeItem(k));
    localStorage.setItem('acPrint:' + r.id, JSON.stringify(r));
  } catch (e) { console.warn('一時保存に失敗。印刷画面でGASから取得します', e); }
  window.open('print.html?id=' + encodeURIComponent(r.id), '_blank');
};

// ===== ハッシュから閲覧専用で開く =====
function openFromHash() {
  const id = location.hash.replace('#', '');
  if (!id) return;
  const r = allReports.find(x => x.id === id);
  if (r) { currentReportId = id; viewReport(id, true); }
}

let toastTimer = null;
function showToast(msg, type, ms) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.className = 'toast', ms || 3500);
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
  const modal = document.getElementById('sign-pad-modal');
  modal.classList.add('open');
  fitSignModalHeight();
  setTimeout(resizePadCanvas, 80);
};
window.closeSignPad = function() {
  document.getElementById('sign-pad-modal').classList.remove('open');
};
function fitSignModalHeight() {
  // 100dvh未対応のブラウザ向けの保険：実測の可視領域高さを直接指定し、
  // モバイルのアドレスバー表示/非表示で保存ボタンが画面外に出るのを防ぐ
  const modal = document.getElementById('sign-pad-modal');
  if (modal.classList.contains('open')) {
    modal.style.height = window.innerHeight + 'px';
  }
}
window.addEventListener('resize', fitSignModalHeight);
window.addEventListener('orientationchange', () => setTimeout(fitSignModalHeight, 150));
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
  scheduleDraftSave();
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

// ===== 過去の入力から選ぶ（症状・原因・作業内容）=====
const PHRASE_FIELDS = {
  'symptom':      { key: 'symptom',     label: '症状' },
  'cause':        { key: 'cause',       label: '原因' },
  'work-content': { key: 'workContent', label: '作業内容' },
};
let phraseTarget = '';
let phraseList = [];

// 過去の記録を1行ずつ分解し、よく使う順（同数なら新しい順）に並べる
function getPhraseCandidates(fieldId) {
  const key = PHRASE_FIELDS[fieldId].key;
  const count = new Map(); const last = new Map();
  allReports.forEach(r => {
    const t = tsOf(r);
    String(r[key] || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean).forEach(p => {
      count.set(p, (count.get(p) || 0) + 1);
      if (!(last.get(p) >= t)) last.set(p, t);
    });
  });
  return Array.from(count.entries()).map(([text, n]) => ({ text, n, last: last.get(text) || 0 }))
    .sort((x, y) => y.n - x.n || y.last - x.last);
}

window.openPhrasePicker = function(fieldId) {
  phraseTarget = fieldId;
  document.getElementById('phrase-title').textContent = PHRASE_FIELDS[fieldId].label + ' — 過去の入力から選ぶ';
  document.getElementById('phrase-search').value = '';
  phraseList = getPhraseCandidates(fieldId);
  renderPhraseList();
  document.getElementById('phrase-modal').classList.add('open');
};
window.closePhrasePicker = function(e) {
  if (!e || e.target === document.getElementById('phrase-modal'))
    document.getElementById('phrase-modal').classList.remove('open');
};
function currentLines(fieldId) {
  return String(document.getElementById(fieldId).value || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
}
window.renderPhraseList = function() {
  const q = (document.getElementById('phrase-search').value || '').trim().toLowerCase();
  const used = new Set(currentLines(phraseTarget));
  const container = document.getElementById('phrase-list');
  const items = phraseList.map((p, i) => ({ p, i })).filter(({ p }) => !q || p.text.toLowerCase().includes(q));
  if (!items.length) {
    container.innerHTML = '<div class="empty-state" style="padding:24px 0"><p>' + (phraseList.length ? '該当する候補がありません' : '過去の入力がまだありません') + '</p></div>';
    return;
  }
  container.innerHTML = items.map(({ p, i }) =>
    '<div class="phrase-item' + (used.has(p.text) ? ' added' : '') + '" onclick="addPhrase(' + i + ')">' +
    '<span class="phrase-text">' + (used.has(p.text) ? '✓ ' : '') + esc(p.text) + '</span>' +
    (p.n > 1 ? '<span class="phrase-count">×' + p.n + '</span>' : '') + '</div>'
  ).join('');
};
window.addPhrase = function(i) {
  const p = phraseList[i]; if (!p) return;
  const el = document.getElementById(phraseTarget);
  if (currentLines(phraseTarget).includes(p.text)) { showToast('すでに入力されています'); return; }
  const cur = el.value.replace(/\s+$/, '');
  el.value = (cur ? cur + '\n' : '') + p.text;
  el.dispatchEvent(new Event('input', { bubbles: true })); // 下書き保存などを動かす
  renderPhraseList();
};

// ===== 下書きの自動保存（電波が悪い・画面が閉じても入力が消えない）=====
const DRAFT_KEY = 'acDraft:new';
const DRAFT_MAX_AGE_MS = 7 * 24 * 3600 * 1000;
let draftTimer = null;

function formHasUserInput() {
  const skip = new Set(['work-date', 'worker', 'status', 'doc-id']);
  const fields = document.querySelectorAll('#report-form input[id], #report-form select[id], #report-form textarea[id]');
  if (Array.from(fields).some(el => !skip.has(el.id) && el.value)) return true;
  if (Array.from(document.querySelectorAll('.part-row input')).some(i => i.value)) return true;
  return !!currentSignDataUrl;
}
function snapshotForm() {
  const fields = {};
  document.querySelectorAll('#report-form input[id], #report-form select[id], #report-form textarea[id]').forEach(el => {
    if (el.id !== 'doc-id') fields[el.id] = el.value;
  });
  const parts = Array.from(document.querySelectorAll('.part-row')).map(row => Array.from(row.querySelectorAll('input')).map(i => i.value)).filter(p => p.some(v => v)); // 空の行は保存しない
  return {
    savedAt: Date.now(), fields, parts,
    parentId: currentParentId || '',
    sign: (currentSignDataUrl && currentSignDataUrl.startsWith('data:image/png')) ? currentSignDataUrl : '',
    title: document.getElementById('form-title').textContent,
  };
}
function saveDraft() {
  if (currentReportId) return; // 編集中の記録は対象外（保存済みデータがあるため）
  if (!document.getElementById('view-form').classList.contains('active')) return;
  if (!formHasUserInput()) return;
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(snapshotForm())); } catch (e) { /* 容量不足などは無視 */ }
}
function scheduleDraftSave() { clearTimeout(draftTimer); draftTimer = setTimeout(saveDraft, 700); }
function readDraft() {
  try {
    const s = localStorage.getItem(DRAFT_KEY); if (!s) return null;
    const d = JSON.parse(s);
    if (!d || !d.fields || Date.now() - (d.savedAt || 0) > DRAFT_MAX_AGE_MS) { localStorage.removeItem(DRAFT_KEY); return null; }
    return d;
  } catch (e) { return null; }
}
function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch (e) {} clearTimeout(draftTimer); hideDraftBanner(); }
function hideDraftBanner() { const b = document.getElementById('draft-banner'); if (b) b.style.display = 'none'; }
function showDraftBannerIfAny() {
  const d = readDraft(); const b = document.getElementById('draft-banner');
  if (!b) return;
  if (!d) { b.style.display = 'none'; return; }
  const when = new Date(d.savedAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const who = d.fields['customer-name'] || d.fields['system-name'] || '';
  document.getElementById('draft-banner-text').textContent = '📝 入力途中の下書きがあります（' + when + (who ? '・' + who : '') + '）';
  b.style.display = '';
}
window.discardDraft = function() { clearDraft(); };
window.restoreDraft = function() {
  const d = readDraft(); if (!d) { hideDraftBanner(); return; }
  currentReportId = null;
  Object.keys(d.fields).forEach(id => { const el = document.getElementById(id); if (el) el.value = d.fields[id]; });
  const list = document.getElementById('parts-list'); list.innerHTML = '';
  (d.parts || []).forEach(p => addPartRow({ name: p[0], qty: p[1], unit: p[2], code: p[3] }));
  if (!list.children.length) addPartRow();
  const refSel = document.getElementById('refrigerant');
  document.getElementById('refrigerant-other').style.display = refSel.value === 'その他' ? '' : 'none';
  currentParentId = d.parentId || null;
  if (d.title) document.getElementById('form-title').textContent = d.title;
  if (d.sign) {
    currentSignDataUrl = d.sign;
    const img = document.getElementById('sign-preview-img');
    img.src = d.sign; img.style.display = 'block';
    document.getElementById('sign-preview-ph').style.display = 'none';
    document.getElementById('sign-preview').classList.add('signed');
  }
  hideDraftBanner();
  updateEquipHistory();
  showToast('下書きを復元しました', 'success');
};

// ===== 同じ機器・系統の過去の対応（入力中に表示）=====
const normKey = s => String(s || '').replace(/[\s\u3000]+/g, '').toLowerCase();
const serialTokens = s => String(s || '').split(/[、,，\/／\s\u3000]+/).map(normKey).filter(t => t.length >= 3);
let equipExpanded = false;

function findEquipHistory() {
  const serials = serialTokens(document.getElementById('serial').value);
  const cust = normKey(document.getElementById('customer-name').value);
  const sys = normKey(document.getElementById('system-name').value);
  if (!serials.length && !(cust && sys)) return [];
  return allReports.filter(r => {
    if (r.id === currentReportId) return false;
    if (serials.length && serialTokens(r.serial).some(t => serials.includes(t))) return true;
    return !!(cust && sys && normKey(r.customerName) === cust && normKey(r.systemName) === sys);
  }).sort((x, y) => tsOf(y) - tsOf(x));
}
window.toggleEquipMore = function() { equipExpanded = !equipExpanded; updateEquipHistory(); };
function updateEquipHistory() {
  const box = document.getElementById('equip-history'); if (!box) return;
  const list = findEquipHistory();
  if (!list.length) { box.style.display = 'none'; box.innerHTML = ''; return; }
  const LIMIT = 3;
  const shown = equipExpanded ? list : list.slice(0, LIMIT);
  const brief = r => {
    const t = [r.symptom, r.cause].map(s => String(s || '').replace(/\s+/g, ' ').trim()).filter(Boolean).join(' → ') || String(r.workContent || '').replace(/\s+/g, ' ').trim();
    return t.length > 60 ? t.slice(0, 60) + '…' : t;
  };
  box.innerHTML = '<div class="equip-history-head">🕘 この機器・系統の過去の対応（' + list.length + '件）— タップで詳細</div>' +
    shown.map(r =>
      '<div class="equip-item" onclick="viewReport(\'' + r.id + '\', true)">' +
      '<span class="eh-date">' + esc(formatDate(r.workDate)) + '</span>' +
      '<span class="badge badge-' + esc(r.status) + '">' + esc(r.status || '—') + '</span>' +
      '<span class="eh-text">' + esc(brief(r)) + '</span></div>'
    ).join('') +
    (list.length > LIMIT ? '<button type="button" class="equip-more" onclick="toggleEquipMore()">' + (equipExpanded ? '閉じる' : 'ほか' + (list.length - LIMIT) + '件を表示') + '</button>' : '');
  box.style.display = '';
}

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('report-form');
  form.addEventListener('input', scheduleDraftSave);
  // 見積提出日：欄をタップでカレンダー表示。「見積提出済」を選んだら今日の日付を入れてカレンダーを開く
  const estDate = document.getElementById('estimate-date');
  estDate.addEventListener('click', () => openPicker(estDate));
  document.getElementById('estimate-status').addEventListener('change', function() {
    if (this.value === '見積提出済') { if (!estDate.value) estDate.value = localToday(); openPicker(estDate); }
    else if (this.value !== '') estDate.value = '';
  });
  form.addEventListener('change', scheduleDraftSave);
  let eqTimer = null;
  ['customer-name', 'system-name', 'serial'].forEach(id =>
    document.getElementById(id).addEventListener('input', () => { clearTimeout(eqTimer); eqTimer = setTimeout(updateEquipHistory, 300); }));
  // スマホでアプリを切り替えたり閉じたりする直前にも保存
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveDraft(); });
  window.addEventListener('pagehide', saveDraft);
});

// ===== Helpers =====
const v = id => (document.getElementById(id)?.value || '').trim();
const vn = id => { const val = document.getElementById(id)?.value; return val !== '' && val != null ? Number(val) : null; };
const setv = (id, val) => { const el = document.getElementById(id); if (el && val != null && val !== '') el.value = val; };
const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const formatDate = d => { if (!d) return '—'; const dt = new Date(d); return isNaN(dt) ? d : dt.getFullYear() + '/' + String(dt.getMonth()+1).padStart(2,'0') + '/' + String(dt.getDate()).padStart(2,'0'); };
// <input type="date">用にYYYY-MM-DD形式へ変換（生のISO日時文字列やDateにも対応）
const toDateInputValue = d => {
  if (!d) return '';
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const dt = new Date(d);
  if (isNaN(dt)) return '';
  return dt.getFullYear() + '-' + String(dt.getMonth()+1).padStart(2,'0') + '-' + String(dt.getDate()).padStart(2,'0');
};
const formatTime = t => {
  if (!t) return '—';
  // "HH:mm" のような文字列ならそのまま、Dateやdatetime文字列なら時刻部分を抽出
  if (typeof t === 'string' && /^\d{1,2}:\d{2}/.test(t)) return t;
  const dt = new Date(t);
  return isNaN(dt) ? String(t) : String(dt.getHours()).padStart(2,'0') + ':' + String(dt.getMinutes()).padStart(2,'0');
};
const df = (label, val, mono) => val != null && val !== '' ? '<div class="detail-field"><div class="detail-label">' + esc(label) + '</div><div class="detail-value' + (mono?' mono':'') + '">' + esc(val) + '</div></div>' : '';
const dft = (label, val) => val ? '<div class="detail-field" style="margin-bottom:12px"><div class="detail-label">' + esc(label) + '</div><div class="detail-text">' + esc(val) + '</div></div>' : '';
