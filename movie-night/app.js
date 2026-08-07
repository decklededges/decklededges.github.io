// ---- CONFIG: paste your Apps Script Web App /exec URL here ----
const API_URL = "PASTE_YOUR_APPS_SCRIPT_EXEC_URL_HERE";

const els = {
  who: document.getElementById('who'),
  overrideName: document.getElementById('overrideName'),
  loadingMsg: document.getElementById('loadingMsg'),
  app: document.getElementById('app'),
  claimsTable: document.querySelector('#claimsTable tbody'),
  pointsTable: document.querySelector('#pointsTable tbody'),
  reservationsTable: document.querySelector('#reservationsTable tbody'),
  logTable: document.querySelector('#logTable tbody'),
  resolveDate: document.getElementById('resolveDate'),
  reserveDate: document.getElementById('reserveDate'),
  overrideDate: document.getElementById('overrideDate'),
};

let state = null;

function whoAmI() { return els.who.value; }

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

async function api(action, params = {}) {
  const usp = new URLSearchParams({ action, ...params });
  const res = await fetch(`${API_URL}?${usp.toString()}`);
  const data = await res.json();
  if (data.error) {
    toast(data.error);
    throw new Error(data.error);
  }
  return data;
}

function toast(msg) {
  let t = document.querySelector('.toast');
  if (!t) {
    t = document.createElement('div');
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.display = 'block';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => (t.style.display = 'none'), 3500);
}

function populateNameDropdowns(members) {
  const names = members.map(m => m.Name);
  [els.who, els.overrideName].forEach(sel => {
    const prev = sel.value;
    sel.innerHTML = names.map(n => `<option value="${n}">${n}</option>`).join('');
    if (names.includes(prev)) sel.value = prev;
  });
  const saved = localStorage.getItem('movieNightWho');
  if (saved && names.includes(saved)) els.who.value = saved;
}

function render(s) {
  state = s;
  populateNameDropdowns(s.members);

  els.claimsTable.innerHTML = s.thisWeek.map(r => `
    <tr>
      <td>${r.Name}</td>
      <td>${r.ClaimType}</td>
      <td class="status-${r.Status}">${r.Status}</td>
    </tr>`).join('') || '<tr><td colspan="3">No claims yet this week.</td></tr>';

  const sortedMembers = [...s.members].sort((a, b) => b.Points - a.Points);
  els.pointsTable.innerHTML = sortedMembers.map(m => `
    <tr>
      <td>${m.Name}</td>
      <td>${m.Points}</td>
      <td>${m.FillerOptIn === 'yes' ? '✅' : ''}</td>
      <td>${m.LastPickDate ? new Date(m.LastPickDate).toLocaleDateString() : '—'}</td>
    </tr>`).join('');

  els.reservationsTable.innerHTML = s.reservations
    .sort((a, b) => new Date(a.Date) - new Date(b.Date))
    .map(r => `<tr><td>${r.Date}</td><td>${r.Name}</td><td>${r.Status}</td></tr>`).join('')
    || '<tr><td colspan="3">No upcoming reservations.</td></tr>';

  els.logTable.innerHTML = s.log.map(l => `
    <tr><td>${new Date(l.Timestamp).toLocaleString()}</td><td>${l.Actor}</td><td>${l.Action}</td><td>${l.Detail}</td></tr>`
  ).join('');

  els.loadingMsg.hidden = true;
  els.app.hidden = false;
}

async function refresh() {
  const s = await api('getState');
  render(s);
}

els.who.addEventListener('change', () => localStorage.setItem('movieNightWho', whoAmI()));

document.getElementById('claimSingleBtn').onclick = () => api('claim', { name: whoAmI(), type: 'single' }).then(refresh);
document.getElementById('claimDoubleBtn').onclick = () => api('claim', { name: whoAmI(), type: 'double' }).then(refresh);
document.getElementById('cancelClaimBtn').onclick = () => api('cancelClaim', { name: whoAmI() }).then(refresh);
document.getElementById('cantMakeItBtn').onclick = () => api('cantMakeIt', { name: whoAmI() }).then(refresh);
document.getElementById('fillerToggleBtn').onclick = () => api('toggleFiller', { name: whoAmI() }).then(refresh);

document.getElementById('resolveBtn').onclick = () => {
  const date = els.resolveDate.value || todayStr();
  api('resolveWeek', { actor: whoAmI(), date }).then(res => {
    toast(`Resolved: ${res.winners.map(w => w.name).join(', ') || 'no winners'}`);
    render(res.state);
  });
};

document.getElementById('startNewWeekBtn').onclick = () => {
  if (!confirm('Archive and clear this week\'s board? Do this after the event is over.')) return;
  api('startNewWeek', { actor: whoAmI() }).then(refresh);
};

document.getElementById('reserveBtn').onclick = () => {
  const date = els.reserveDate.value;
  if (!date) return toast('Pick a date first');
  api('reserve', { name: whoAmI(), date }).then(refresh);
};

document.getElementById('cancelReserveBtn').onclick = () => {
  const date = els.reserveDate.value;
  if (!date) return toast('Pick a date first');
  api('cancelReservation', { name: whoAmI(), date }).then(refresh);
};

document.getElementById('overrideBtn').onclick = () => {
  const date = els.overrideDate.value || todayStr();
  api('override', { actor: whoAmI(), name: els.overrideName.value, date }).then(refresh);
};

els.resolveDate.value = todayStr();
els.reserveDate.value = todayStr();
els.overrideDate.value = todayStr();

refresh().catch(err => {
  els.loadingMsg.textContent = 'Could not reach the sheet — check API_URL in app.js. (' + err.message + ')';
});
