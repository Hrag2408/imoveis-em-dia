const TOKEN_KEY = 'imoveisFullstackToken';
const USER_KEY = 'imoveisFullstackUser';
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const money = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v || 0));
const dateBR = (d) => d ? new Date(d + 'T12:00:00').toLocaleDateString('pt-BR') : '-';
const currentMonth = () => new Date().toISOString().slice(0, 7);
const currentDate = () => new Date().toISOString().slice(0, 10);
const monthBR = (ym) => { const [y, m] = ym.split('-'); return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }); };

let cache = { tenants: [], managers: [], properties: [], configs: [], launches: [], payments: [], methods: [], accounts: [] };

function getToken() { return localStorage.getItem(TOKEN_KEY) || ''; }
function setSession(token, user) { localStorage.setItem(TOKEN_KEY, token); localStorage.setItem(USER_KEY, JSON.stringify(user)); }
function clearSession() { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); }
function getUser() { try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; } }

async function api(path, options = {}) {
  const headers = options.headers ? { ...options.headers } : {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const isForm = options.body instanceof FormData;
  if (!isForm && options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Erro na requisição');
  return data;
}

function setAuthMessage(text, ok = false) {
  const el = $('#authMessage');
  el.textContent = text || '';
  el.className = `message ${ok ? 'success-text' : 'error-text'}`;
}

function showApp(show) {
  $('#authScreen').classList.toggle('hidden', show);
  $('#appShell').classList.toggle('hidden', !show);
}

function switchScreen(id) {
  $$('.screen').forEach((el) => el.classList.add('hidden'));
  $('#' + id).classList.remove('hidden');
  $$('.nav-btn').forEach((btn) => btn.classList.toggle('active', btn.dataset.screen === id));
}

function switchTab(id) {
  $$('.tab-panel').forEach((el) => el.classList.add('hidden'));
  $('#' + id).classList.remove('hidden');
  $$('.tab-btn').forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === id));
}

function statusFromItem(item) {
  if (item.received_amount != null) return Number(item.received_amount) >= Number(item.amount_expected) ? 'Pago' : 'Pago parcial';
  return item.due_date < currentDate() ? 'Atrasado' : 'Em aberto';
}

function statusTag(status) {
  const cls = status === 'Pago' ? 'pago' : status === 'Pago parcial' ? 'parcial' : status === 'Atrasado' ? 'atrasado' : 'aberto';
  return `<span class="tag ${cls}">${status}</span>`;
}

function fillMonthDefaults() {
  ['#dashboardMonth', '#launchMonth'].forEach((sel) => { const el = $(sel); if (el) el.value = currentMonth(); });
}

function fillCurrentUser() {
  const user = getUser();
  $('#currentUserName').textContent = user?.name || '-';
  $('#currentUserEmail').textContent = user?.email || '-';
}

function renderManagerFilters() {
  const opts = ['<option value="">Todas as administradoras</option>'].concat(cache.managers.map((m) => `<option value="${m.id}">${m.name}</option>`)).join('');
  $('#dashboardManagerFilter').innerHTML = opts;
}

function renderPropertyAndRelationSelects() {
  const tenantOpts = ['<option value="">Selecione</option>'].concat(cache.tenants.map((t) => `<option value="${t.id}">${t.name}</option>`)).join('');
  const managerOpts = ['<option value="">Selecione</option>'].concat(cache.managers.map((m) => `<option value="${m.id}">${m.name}</option>`)).join('');
  const propertyOpts = ['<option value="">Selecione</option>'].concat(cache.properties.map((p) => `<option value="${p.id}">${p.name}</option>`)).join('');
  $('#propertyTenantSelect').innerHTML = tenantOpts;
  $('#propertyManagerSelect').innerHTML = managerOpts;
  $('#configPropertySelect').innerHTML = propertyOpts;
}

function renderPaymentSelects() {
  const methodOpts = ['<option value="">Selecione</option>'].concat(cache.methods.map((m) => `<option value="${m.id}">${m.name}</option>`)).join('');
  const accountOpts = ['<option value="">Selecione</option>'].concat(cache.accounts.map((a) => `<option value="${a.id}">${a.name}</option>`)).join('');
  const launchOpts = ['<option value="">Selecione</option>'].concat(cache.launches.map((l) => `<option value="${l.id}">${l.property_name} · ${l.category_name} · ${monthBR(l.competence)} · vence ${dateBR(l.due_date)}</option>`)).join('');
  $('#paymentMethodSelect').innerHTML = methodOpts;
  $('#receivingAccountSelect').innerHTML = accountOpts;
  $('#paymentLaunchSelect').innerHTML = launchOpts;
}

function renderDashboard(data) {
  $('#dashboardCards').innerHTML = `
    <div class="card"><div class="kpi-title">Previsto</div><div class="kpi-value">${money(data.summary.total_expected)}</div><div class="muted small">${monthBR($('#dashboardMonth').value || currentMonth())}</div></div>
    <div class="card"><div class="kpi-title">Recebido</div><div class="kpi-value">${money(data.summary.total_received)}</div><div class="muted small">pagamentos lançados</div></div>
    <div class="card"><div class="kpi-title">Em aberto</div><div class="kpi-value">${data.summary.open_count}</div><div class="muted small">cobranças pendentes</div></div>
    <div class="card"><div class="kpi-title">Atrasados</div><div class="kpi-value">${data.summary.late_count}</div><div class="muted small">vencidos sem baixa</div></div>`;

  const rows = data.items.map((item) => `<tr>
    <td>${item.property_name}</td>
    <td>${item.manager_name || '-'}</td>
    <td>${item.tenant_name || '-'}</td>
    <td>${item.category_name}</td>
    <td>${money(item.amount_expected)}</td>
    <td>${dateBR(item.due_date)}</td>
    <td>${statusTag(statusFromItem(item))}</td>
    <td>${item.payment_date ? dateBR(item.payment_date) : '-'}</td>
    <td>${item.received_amount != null ? money(item.received_amount) : '-'}</td>
  </tr>`).join('');

  $('#dashboardTable').innerHTML = data.items.length
    ? `<div class="table-wrap"><table><thead><tr><th>Imóvel</th><th>Administradora</th><th>Inquilino</th><th>Categoria</th><th>Valor</th><th>Vencimento</th><th>Status</th><th>Pagamento</th><th>Recebido</th></tr></thead><tbody>${rows}</tbody></table></div>`
    : '<div class="empty">Nenhum dado para este mês.</div>';
}

function renderTenants() {
  $('#tenantList').innerHTML = cache.tenants.length ? `<div class="list">${cache.tenants.map((t) => `<div class="item"><strong>${t.name}</strong><br><span class="muted small">${t.phone || '-'} ${t.email ? '· ' + t.email : ''}</span>${t.notes ? `<div class="muted small" style="margin-top:8px">${t.notes}</div>` : ''}<div class="mini-actions"><button class="secondary" data-action="edit-tenant" data-id="${t.id}">Editar</button><button class="danger" data-action="delete-tenant" data-id="${t.id}">Excluir</button></div></div>`).join('')}</div>` : '<div class="empty">Nenhum inquilino cadastrado.</div>';
}

function renderManagers() {
  $('#managerList').innerHTML = cache.managers.length ? `<div class="list">${cache.managers.map((m) => `<div class="item"><strong>${m.name}</strong><br><span class="muted small">${m.phone || '-'} ${m.email ? '· ' + m.email : ''}</span>${m.notes ? `<div class="muted small" style="margin-top:8px">${m.notes}</div>` : ''}<div class="mini-actions"><button class="secondary" data-action="edit-manager" data-id="${m.id}">Editar</button><button class="danger" data-action="delete-manager" data-id="${m.id}">Excluir</button></div></div>`).join('')}</div>` : '<div class="empty">Nenhuma administradora cadastrada.</div>';
}

function renderProperties() {
  $('#propertyList').innerHTML = cache.properties.length ? `<div class="list">${cache.properties.map((p) => `<div class="item"><strong>${p.name}</strong><br><span class="muted small">${p.address}</span><br><span class="small">Inquilino: ${p.tenant_name || '-'} | Administradora: ${p.manager_name || '-'}</span><div style="margin-top:8px"><span class="chip">Aluguel base ${money(p.rent_value)}</span></div>${p.notes ? `<div class="muted small" style="margin-top:8px">${p.notes}</div>` : ''}<div class="mini-actions"><button class="secondary" data-action="edit-property" data-id="${p.id}">Editar</button><button class="danger" data-action="delete-property" data-id="${p.id}">Excluir</button></div></div>`).join('')}</div>` : '<div class="empty">Nenhum imóvel cadastrado.</div>';
}

function renderConfigs() {
  $('#configList').innerHTML = cache.configs.length ? `<div class="list">${cache.configs.map((c) => `<div class="item"><strong>${c.property_name}</strong><div style="margin-top:8px"><span class="chip">${c.category_name}</span><span class="chip">${money(c.amount)}</span><span class="chip">vence dia ${c.due_day}</span><span class="chip">${c.active ? 'ativa' : 'inativa'}</span></div><div class="mini-actions"><button class="secondary" data-action="edit-config" data-id="${c.id}">Editar</button><button class="danger" data-action="delete-config" data-id="${c.id}">Excluir</button></div></div>`).join('')}</div>` : '<div class="empty">Nenhuma categoria cadastrada.</div>';
}

function renderLaunches() {
  $('#launchList').innerHTML = cache.launches.length ? `<div class="table-wrap"><table><thead><tr><th>Imóvel</th><th>Categoria</th><th>Competência</th><th>Valor</th><th>Vencimento</th><th>Status</th><th>Ações</th></tr></thead><tbody>${cache.launches.map((l) => `<tr><td>${l.property_name}</td><td>${l.category_name}</td><td>${monthBR(l.competence)}</td><td>${money(l.amount_expected)}</td><td>${dateBR(l.due_date)}</td><td>${statusTag(statusFromItem(l))}</td><td><div class="mini-actions"><button class="secondary" data-action="edit-launch" data-id="${l.id}">Editar</button><button class="danger" data-action="delete-launch" data-id="${l.id}">Excluir</button></div></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Nenhum lançamento neste mês.</div>';
}

function renderPayments() {
  $('#paymentList').innerHTML = cache.payments.length ? `<div class="list">${cache.payments.map((p) => {
    const receipt = p.receipt_file_path ? `<br>Recibo: <a href="${p.receipt_file_path}" target="_blank">${p.receipt_original_name || 'Abrir arquivo'}</a>` : '';
    const period = (p.rental_period_start || p.rental_period_end) ? `<br>Período: <strong>${dateBR(p.rental_period_start)}</strong> até <strong>${dateBR(p.rental_period_end)}</strong>` : '';
    return `<div class="item"><strong>${p.property_name}</strong><br><span class="chip">${p.category_name}</span><span class="chip">${monthBR(p.competence)}</span><div class="small" style="margin-top:8px">Valor recebido: <strong>${money(p.received_amount)}</strong> | Data: <strong>${dateBR(p.payment_date)}</strong><br>Meio: <strong>${p.payment_method_name || '-'}</strong> | Conta: <strong>${p.receiving_account_name || '-'}</strong>${period}${receipt}</div>${p.notes ? `<div class="muted small" style="margin-top:8px">${p.notes}</div>` : ''}<div class="mini-actions"><button class="secondary" data-action="edit-payment" data-id="${p.id}">Editar</button><button class="danger" data-action="delete-payment" data-id="${p.id}">Excluir</button></div></div>`;
  }).join('')}</div>` : '<div class="empty">Nenhum pagamento cadastrado.</div>';
}

function resetForm(formId, titleId, titleText, cancelId) {
  const form = $(formId); form.reset();
  const hidden = form.querySelector('[name="id"]'); if (hidden) hidden.value = '';
  $(titleId).textContent = titleText;
  $(cancelId).classList.add('hidden');
}

function fillForm(formId, data) {
  Object.entries(data).forEach(([key, value]) => {
    const input = $(`${formId} [name="${key}"]`);
    if (input) input.value = value ?? '';
  });
}

async function loadDashboard() {
  const month = $('#dashboardMonth').value || currentMonth();
  const managerId = $('#dashboardManagerFilter').value || '';
  const params = new URLSearchParams({ month });
  if (managerId) params.set('manager_id', managerId);
  const data = await api(`/api/dashboard?${params.toString()}`);
  renderDashboard(data);
}

async function loadLists() {
  const month = $('#launchMonth').value || currentMonth();
  const [tenants, managers, properties, configs, launches, payments, methods, accounts] = await Promise.all([
    api('/api/tenants'),
    api('/api/managers'),
    api('/api/properties'),
    api('/api/category-configs'),
    api(`/api/launches?month=${encodeURIComponent(month)}`),
    api('/api/payments'),
    api('/api/payment-methods'),
    api('/api/receiving-accounts')
  ]);
  cache = { tenants, managers, properties, configs, launches, payments, methods, accounts };
  renderManagerFilters();
  renderPropertyAndRelationSelects();
  renderPaymentSelects();
  renderTenants();
  renderManagers();
  renderProperties();
  renderConfigs();
  renderLaunches();
  renderPayments();
}

async function refreshAll() {
  await loadLists();
  await loadDashboard();
}

function currentLaunchBySelect() {
  const id = Number($('#paymentLaunchSelect').value || 0);
  return cache.launches.find((l) => l.id === id) || null;
}

function updatePaymentLaunchInfo() {
  const launch = currentLaunchBySelect();
  $('#paymentExpected').value = launch ? money(launch.amount_expected) : '';
  $('#paymentDueDate').value = launch ? dateBR(launch.due_date) : '';
  $('#paymentCompetence').value = launch ? monthBR(launch.competence) : '';
  if (launch && !$('#paymentForm [name="id"]').value) {
    $('#paymentForm [name="received_amount"]').value = launch.amount_expected;
    $('#paymentForm [name="payment_date"]').value = currentDate();
    $('#paymentForm [name="rental_period_start"]').value = `${launch.competence}-01`;
    $('#paymentForm [name="rental_period_end"]').value = launch.due_date;
  }
}

async function bootFromSession() {
  const token = getToken();
  if (!token) { showApp(false); return; }
  try {
    const me = await api('/api/auth/me');
    setSession(token, me);
    fillCurrentUser();
    showApp(true);
    await refreshAll();
  } catch {
    clearSession();
    showApp(false);
  }
}

$('#loginTab').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const data = Object.fromEntries(new FormData(e.target).entries());
    const result = await api('/api/auth/login', { method: 'POST', body: JSON.stringify(data) });
    setSession(result.token, result.user);
    setAuthMessage('Login realizado com sucesso.', true);
    fillCurrentUser();
    showApp(true);
    await refreshAll();
  } catch (err) {
    setAuthMessage(err.message || 'Erro ao entrar.');
  }
});

$('#registerTab').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const data = Object.fromEntries(new FormData(e.target).entries());
    await api('/api/auth/register', { method: 'POST', body: JSON.stringify(data) });
    setAuthMessage('Conta criada. Agora faça login.', true);
    switchTab('loginTab');
  } catch (err) {
    setAuthMessage(err.message || 'Erro ao cadastrar.');
  }
});

$('#logoutBtn').addEventListener('click', () => {
  clearSession();
  showApp(false);
});

$$('.tab-btn').forEach((btn) => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
$$('.nav-btn').forEach((btn) => btn.addEventListener('click', () => switchScreen(btn.dataset.screen)));
$('#dashboardMonth').addEventListener('change', loadDashboard);
$('#dashboardManagerFilter').addEventListener('change', loadDashboard);
$('#refreshDashboardBtn').addEventListener('click', loadDashboard);
$('#launchMonth').addEventListener('change', loadLists);
$('#refreshLaunchesBtn').addEventListener('click', loadLists);
$('#paymentLaunchSelect').addEventListener('change', updatePaymentLaunchInfo);

$('#tenantForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const data = Object.fromEntries(new FormData(e.target).entries());
    const id = data.id; delete data.id;
    await api(id ? `/api/tenants/${id}` : '/api/tenants', { method: id ? 'PUT' : 'POST', body: JSON.stringify(data) });
    resetForm('#tenantForm', '#tenantFormTitle', 'Novo inquilino', '#cancelTenantEdit');
    await refreshAll();
  } catch (err) { alert(err.message); }
});
$('#cancelTenantEdit').addEventListener('click', () => resetForm('#tenantForm', '#tenantFormTitle', 'Novo inquilino', '#cancelTenantEdit'));
window.editTenant = (id) => { const item = cache.tenants.find((x) => x.id === id); fillForm('#tenantForm', item); $('#tenantFormTitle').textContent = 'Editar inquilino'; $('#cancelTenantEdit').classList.remove('hidden'); switchScreen('tenants'); };
window.deleteTenant = async (id) => { if (!confirm('Excluir este inquilino?')) return; await api(`/api/tenants/${id}`, { method: 'DELETE' }); await refreshAll(); };

$('#managerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const data = Object.fromEntries(new FormData(e.target).entries());
    const id = data.id; delete data.id;
    await api(id ? `/api/managers/${id}` : '/api/managers', { method: id ? 'PUT' : 'POST', body: JSON.stringify(data) });
    resetForm('#managerForm', '#managerFormTitle', 'Nova administradora', '#cancelManagerEdit');
    await refreshAll();
  } catch (err) { alert(err.message); }
});
$('#cancelManagerEdit').addEventListener('click', () => resetForm('#managerForm', '#managerFormTitle', 'Nova administradora', '#cancelManagerEdit'));
window.editManager = (id) => { const item = cache.managers.find((x) => x.id === id); fillForm('#managerForm', item); $('#managerFormTitle').textContent = 'Editar administradora'; $('#cancelManagerEdit').classList.remove('hidden'); switchScreen('managers'); };
window.deleteManager = async (id) => { if (!confirm('Excluir esta administradora?')) return; await api(`/api/managers/${id}`, { method: 'DELETE' }); await refreshAll(); };


$('#propertyForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const data = Object.fromEntries(new FormData(e.target).entries());
    const id = data.id; delete data.id;
    data.tenant_id = data.tenant_id || null;
    data.manager_id = data.manager_id || null;
    data.rent_value = Number(data.rent_value || 0);
    await api(id ? `/api/properties/${id}` : '/api/properties', { method: id ? 'PUT' : 'POST', body: JSON.stringify(data) });
    resetForm('#propertyForm', '#propertyFormTitle', 'Novo imóvel', '#cancelPropertyEdit');
    await refreshAll();
  } catch (err) { alert(err.message); }
});
$('#cancelPropertyEdit').addEventListener('click', () => resetForm('#propertyForm', '#propertyFormTitle', 'Novo imóvel', '#cancelPropertyEdit'));
window.editProperty = (id) => { const item = cache.properties.find((x) => x.id === id); fillForm('#propertyForm', item); $('#propertyFormTitle').textContent = 'Editar imóvel'; $('#cancelPropertyEdit').classList.remove('hidden'); switchScreen('properties'); };
window.deleteProperty = async (id) => { if (!confirm('Excluir este imóvel e seus vínculos?')) return; await api(`/api/properties/${id}`, { method: 'DELETE' }); await refreshAll(); };

$('#configForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const data = Object.fromEntries(new FormData(e.target).entries());
    const id = data.id; delete data.id;
    data.amount = Number(data.amount || 0);
    data.due_day = Number(data.due_day || 1);
    data.active = Number(data.active || 0);
    await api(id ? `/api/category-configs/${id}` : '/api/category-configs', { method: id ? 'PUT' : 'POST', body: JSON.stringify(data) });
    resetForm('#configForm', '#configFormTitle', 'Nova categoria', '#cancelConfigEdit');
    await refreshAll();
  } catch (err) { alert(err.message); }
});
$('#cancelConfigEdit').addEventListener('click', () => resetForm('#configForm', '#configFormTitle', 'Nova categoria', '#cancelConfigEdit'));
window.editConfig = (id) => { const item = cache.configs.find((x) => x.id === id); fillForm('#configForm', item); $('#configFormTitle').textContent = 'Editar categoria'; $('#cancelConfigEdit').classList.remove('hidden'); switchScreen('configs'); };
window.deleteConfig = async (id) => { if (!confirm('Excluir esta categoria?')) return; await api(`/api/category-configs/${id}`, { method: 'DELETE' }); await refreshAll(); };

$('#generateLaunchesBtn').addEventListener('click', async () => {
  try {
    await api('/api/launches/generate', { method: 'POST', body: JSON.stringify({ month: $('#launchMonth').value || currentMonth() }) });
    await refreshAll();
  } catch (err) { alert(err.message); }
});
window.editLaunch = async (id) => {
  const item = cache.launches.find((x) => x.id === id);
  if (!item) return;
  const amount = prompt('Novo valor do lançamento:', item.amount_expected);
  if (amount === null) return;
  const due = prompt('Nova data de vencimento (AAAA-MM-DD):', item.due_date);
  if (due === null) return;
  await api(`/api/launches/${id}`, { method: 'PUT', body: JSON.stringify({ amount_expected: Number(amount), due_date: due, category_name: item.category_name, notes: item.notes || null }) });
  await refreshAll();
};
window.deleteLaunch = async (id) => { if (!confirm('Excluir este lançamento?')) return; await api(`/api/launches/${id}`, { method: 'DELETE' }); await refreshAll(); };

$('#paymentForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const fd = new FormData(e.target);
    const id = fd.get('id');
    const receipt = fd.get('receipt');
    const payload = {
      launch_id: Number(fd.get('launch_id')),
      received_amount: Number(fd.get('received_amount') || 0),
      payment_date: fd.get('payment_date'),
      payment_method_id: fd.get('payment_method_id') || null,
      receiving_account_id: fd.get('receiving_account_id') || null,
      rental_period_start: fd.get('rental_period_start') || null,
      rental_period_end: fd.get('rental_period_end') || null,
      notes: fd.get('notes') || null
    };
    const payment = await api(id ? `/api/payments/${id}` : '/api/payments', { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
    if (receipt && receipt.size > 0) {
      const receiptFd = new FormData();
      receiptFd.append('receipt', receipt);
      await api(`/api/payments/${payment.id}/receipt`, { method: 'POST', body: receiptFd });
    }
    resetForm('#paymentForm', '#paymentFormTitle', 'Registrar pagamento', '#cancelPaymentEdit');
    $('#paymentExpected').value = ''; $('#paymentDueDate').value = ''; $('#paymentCompetence').value = '';
    await refreshAll();
  } catch (err) { alert(err.message); }
});
$('#cancelPaymentEdit').addEventListener('click', () => { resetForm('#paymentForm', '#paymentFormTitle', 'Registrar pagamento', '#cancelPaymentEdit'); $('#paymentExpected').value = ''; $('#paymentDueDate').value = ''; $('#paymentCompetence').value = ''; });
window.editPayment = (id) => {
  const item = cache.payments.find((x) => x.id === id);
  if (!item) return;
  fillForm('#paymentForm', item);
  $('#paymentFormTitle').textContent = 'Editar pagamento';
  $('#cancelPaymentEdit').classList.remove('hidden');
  const launch = cache.launches.find((l) => l.id === item.launch_id);
  $('#paymentExpected').value = launch ? money(launch.amount_expected) : '';
  $('#paymentDueDate').value = launch ? dateBR(launch.due_date) : '';
  $('#paymentCompetence').value = launch ? monthBR(launch.competence) : '';
  switchScreen('payments');
};
window.deletePayment = async (id) => { if (!confirm('Excluir este pagamento?')) return; await api(`/api/payments/${id}`, { method: 'DELETE' }); await refreshAll(); };

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action][data-id]');
  if (!btn) return;
  const id = Number(btn.dataset.id || 0);
  if (!id) return;
  const action = btn.dataset.action;
  if (action === 'edit-tenant') return window.editTenant(id);
  if (action === 'delete-tenant') return window.deleteTenant(id);
  if (action === 'edit-manager') return window.editManager(id);
  if (action === 'delete-manager') return window.deleteManager(id);
  if (action === 'edit-property') return window.editProperty(id);
  if (action === 'delete-property') return window.deleteProperty(id);
  if (action === 'edit-config') return window.editConfig(id);
  if (action === 'delete-config') return window.deleteConfig(id);
  if (action === 'edit-launch') return window.editLaunch(id);
  if (action === 'delete-launch') return window.deleteLaunch(id);
  if (action === 'edit-payment') return window.editPayment(id);
  if (action === 'delete-payment') return window.deletePayment(id);
});

fillMonthDefaults();
bootFromSession();
