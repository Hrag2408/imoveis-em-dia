const TOKEN_KEY = 'imoveisFullstackToken';
const USER_KEY = 'imoveisFullstackUser';
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const money = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v || 0));

function toDateSafe(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  const raw = String(value).trim();
  if (!raw) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const d = new Date(`${raw}T12:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) {
    const [dd, mm, yyyy] = raw.split('/');
    const d = new Date(`${yyyy}-${mm}-${dd}T12:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

const dateBR = (value) => {
  const d = toDateSafe(value);
  return d ? d.toLocaleDateString('pt-BR') : '-';
};

const currentMonth = () => new Date().toISOString().slice(0, 7);
const currentDate = () => new Date().toISOString().slice(0, 10);
const monthBR = (ym) => {
  const raw = String(ym || '').trim();
  if (!/^\d{4}-\d{2}$/.test(raw)) return raw || '-';
  const [y, m] = raw.split('-');
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
};

function calcAdminFeeValues(receivedAmount, adminFeePercent) {
  const received = Number(receivedAmount || 0);
  const percent = Number(adminFeePercent || 0);
  const feeAmount = Number(((received * percent) / 100).toFixed(2));
  const netReceived = Number((received - feeAmount).toFixed(2));
  return { percent, feeAmount, netReceived };
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'pt-BR'));
}

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

function renderPaymentFilterOptions() {
  const competenceEl = $('#paymentCompetenceFilter');
  const categoryEl = $('#paymentCategoryFilter');
  const accountEl = $('#paymentAccountFilter');
  const methodEl = $('#paymentMethodFilter');

  if (!competenceEl || !categoryEl || !accountEl || !methodEl) return;

  const current = {
    competence: competenceEl.value,
    category: categoryEl.value,
    account: accountEl.value,
    method: methodEl.value
  };

  const competences = [...new Set(cache.payments.map((p) => p.competence).filter(Boolean))].sort();
  const categories = uniqueSorted(cache.payments.map((p) => p.category_name));
  const accounts = uniqueSorted(cache.payments.map((p) => p.receiving_account_name));
  const methods = uniqueSorted(cache.payments.map((p) => p.payment_method_name));

  competenceEl.innerHTML = ['<option value="">Todas</option>']
    .concat(competences.map((value) => `<option value="${value}">${monthBR(value)}</option>`))
    .join('');

  categoryEl.innerHTML = ['<option value="">Todas</option>']
    .concat(categories.map((value) => `<option value="${value}">${value}</option>`))
    .join('');

  accountEl.innerHTML = ['<option value="">Todas</option>']
    .concat(accounts.map((value) => `<option value="${value}">${value}</option>`))
    .join('');

  methodEl.innerHTML = ['<option value="">Todos</option>']
    .concat(methods.map((value) => `<option value="${value}">${value}</option>`))
    .join('');

  if ([...competenceEl.options].some((o) => o.value === current.competence)) competenceEl.value = current.competence;
  if ([...categoryEl.options].some((o) => o.value === current.category)) categoryEl.value = current.category;
  if ([...accountEl.options].some((o) => o.value === current.account)) accountEl.value = current.account;
  if ([...methodEl.options].some((o) => o.value === current.method)) methodEl.value = current.method;
}

function getFilteredPayments() {
  const search = normalizeText($('#paymentSearch')?.value);
  const competence = $('#paymentCompetenceFilter')?.value || '';
  const category = $('#paymentCategoryFilter')?.value || '';
  const account = $('#paymentAccountFilter')?.value || '';
  const method = $('#paymentMethodFilter')?.value || '';

  return cache.payments.filter((p) => {
    const searchableText = normalizeText([
      p.property_name,
      p.category_name,
      p.receipt_original_name,
      p.notes,
      p.payment_method_name,
      p.receiving_account_name
    ].join(' '));

    if (search && !searchableText.includes(search)) return false;
    if (competence && p.competence !== competence) return false;
    if (category && String(p.category_name || '') !== category) return false;
    if (account && String(p.receiving_account_name || '') !== account) return false;
    if (method && String(p.payment_method_name || '') !== method) return false;

    return true;
  });
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
  $('#tenantList').innerHTML = cache.tenants.length ? `<div class="list">${cache.tenants.map((t) => `<div class="item"><strong>${t.name}</strong><br><span class="muted small">${t.phone || '-'} ${t.email ? '· ' + t.email : ''}</span>${t.notes ? `<div class="muted small" style="margin-top:8px">${t.notes}</div>` : ''}<div class="mini-actions"><button type="button" class="secondary" data-action="edit-tenant" data-id="${t.id}">Editar</button><button type="button" class="danger" data-action="delete-tenant" data-id="${t.id}">Excluir</button></div></div>`).join('')}</div>` : '<div class="empty">Nenhum inquilino cadastrado.</div>';
}

function renderManagers() {
  $('#managerList').innerHTML = cache.managers.length ? `<div class="list">${cache.managers.map((m) => `<div class="item"><strong>${m.name}</strong><br><span class="muted small">${m.phone || '-'} ${m.email ? '· ' + m.email : ''}</span>${m.notes ? `<div class="muted small" style="margin-top:8px">${m.notes}</div>` : ''}<div class="mini-actions"><button type="button" class="secondary" data-action="edit-manager" data-id="${m.id}">Editar</button><button type="button" class="danger" data-action="delete-manager" data-id="${m.id}">Excluir</button></div></div>`).join('')}</div>` : '<div class="empty">Nenhuma administradora cadastrada.</div>';
}

function renderProperties() {
  $('#propertyList').innerHTML = cache.properties.length ? `<div class="list">${cache.properties.map((p) => `<div class="item"><strong>${p.name}</strong><br><span class="muted small">${p.address}</span><br><span class="small">Inquilino: ${p.tenant_name || '-'} | Administradora: ${p.manager_name || '-'}</span><div style="margin-top:8px"><span class="chip">Aluguel base ${money(p.rent_value)}</span></div>${p.notes ? `<div class="muted small" style="margin-top:8px">${p.notes}</div>` : ''}<div class="mini-actions"><button type="button" class="secondary" data-action="edit-property" data-id="${p.id}">Editar</button><button type="button" class="danger" data-action="delete-property" data-id="${p.id}">Excluir</button></div></div>`).join('')}</div>` : '<div class="empty">Nenhum imóvel cadastrado.</div>';
}

function renderConfigs() {
  $('#configList').innerHTML = cache.configs.length ? `<div class="list">${cache.configs.map((c) => `<div class="item"><strong>${c.property_name}</strong><div style="margin-top:8px"><span class="chip">${c.category_name}</span><span class="chip">${money(c.amount)}</span><span class="chip">taxa adm ${Number(c.admin_fee_percent || 0).toFixed(2)}%</span><span class="chip">vence dia ${c.due_day}</span><span class="chip">${c.active ? 'ativa' : 'inativa'}</span></div><div class="mini-actions"><button type="button" class="secondary" data-action="edit-config" data-id="${c.id}">Editar</button><button type="button" class="danger" data-action="delete-config" data-id="${c.id}">Excluir</button></div></div>`).join('')}</div>` : '<div class="empty">Nenhuma categoria cadastrada.</div>';
}

function renderLaunches() {
  $('#launchList').innerHTML = cache.launches.length ? `<div class="table-wrap"><table><thead><tr><th>Imóvel</th><th>Categoria</th><th>Competência</th><th>Valor</th><th>Vencimento</th><th>Status</th><th>Ações</th></tr></thead><tbody>${cache.launches.map((l) => `<tr><td>${l.property_name}</td><td>${l.category_name}</td><td>${monthBR(l.competence)}</td><td>${money(l.amount_expected)}</td><td>${dateBR(l.due_date)}</td><td>${statusTag(statusFromItem(l))}</td><td><div class="mini-actions"><button type="button" class="secondary" data-action="edit-launch" data-id="${l.id}">Editar</button><button type="button" class="danger" data-action="delete-launch" data-id="${l.id}">Excluir</button></div></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Nenhum lançamento neste mês.</div>';
}

function renderPayments() {
  if (!cache.payments.length) {
    $('#paymentList').innerHTML = '<div class="empty">Nenhum pagamento cadastrado.</div>';
    return;
  }

  const payments = getFilteredPayments();

  if (!payments.length) {
    $('#paymentList').innerHTML = '<div class="empty">Nenhum pagamento encontrado com os filtros informados.</div>';
    return;
  }

  $('#paymentList').innerHTML = `
    <div class="muted small" style="margin-bottom:12px">
      ${payments.length} pagamento(s) encontrado(s)
    </div>
    <div class="list">
      ${payments.map((p) => {
        const receipt = p.receipt_file_path
          ? `<br>Recibo: <a href="${p.receipt_file_path}" target="_blank">${p.receipt_original_name || 'Abrir arquivo'}</a>`
          : '';

        const period = (p.rental_period_start || p.rental_period_end)
          ? `<br>Período: <strong>${dateBR(p.rental_period_start)}</strong> até <strong>${dateBR(p.rental_period_end)}</strong>`
          : '';

        return `<div class="item">
          <strong>${p.property_name}</strong><br>
          <span class="chip">${p.category_name}</span>
          <span class="chip">${monthBR(p.competence)}</span>
          <div class="small" style="margin-top:8px">
            Valor recebido: <strong>${money(p.received_amount)}</strong><br>
            Taxa administradora: <strong>${money(p.admin_fee_amount)}</strong> (${Number(p.admin_fee_percent || 0).toFixed(2)}%)<br>
            Recebimento líquido: <strong>${money(p.net_received_amount)}</strong><br>
            Data: <strong>${dateBR(p.payment_date)}</strong><br>
            Meio: <strong>${p.payment_method_name || '-'}</strong> | Conta: <strong>${p.receiving_account_name || '-'}</strong>
            ${period}
            ${receipt}
          </div>
          ${p.notes ? `<div class="muted small" style="margin-top:8px">${p.notes}</div>` : ''}
          <div class="mini-actions">
            <button type="button" class="secondary" data-action="edit-payment" data-id="${p.id}">Editar</button>
            <button type="button" class="danger" data-action="delete-payment" data-id="${p.id}">Excluir</button>
          </div>
        </div>`;
      }).join('')}
    </div>
  `;
}

function resetForm(formId, titleId, titleText, cancelId) {
  const form = $(formId); form.reset();
  const hidden = form.querySelector('[name="id"]'); if (hidden) hidden.value = '';
  $(titleId).textContent = titleText;
  $(cancelId).classList.add('hidden');
}

function fillForm(formId, data) {
  if (!data) return;
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
  renderPaymentFilterOptions();
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
  return cache.launches.find((l) => Number(l.id) === Number(id)) || null;
}

function updatePaymentFeePreview() {
  const launch = currentLaunchBySelect();
  const received = Number($('#paymentForm [name="received_amount"]')?.value || 0);
  const percent = Number(launch?.admin_fee_percent || 0);
  const { feeAmount, netReceived } = calcAdminFeeValues(received, percent);

  $('#paymentAdminFeePercent').value = `${percent.toFixed(2)}%`;
  $('#paymentAdminFeeAmount').value = money(feeAmount);
  $('#paymentNetReceived').value = money(netReceived);
}

function updatePaymentLaunchInfo() {
  const launch = currentLaunchBySelect();
  $('#paymentExpected').value = launch ? money(launch.amount_expected) : '';
  $('#paymentDueDate').value = launch ? dateBR(launch.due_date) : '';
  $('#paymentCompetence').value = launch ? monthBR(launch.competence) : '';

  if (launch && !$('#paymentForm [name="id"]').value) {
    $('#paymentForm [name="received_amount"]').value = launch.amount_expected;
    $('#paymentForm [name="payment_date"]').value = currentDate();
    $('#paymentForm [name="rental_period_start"]').value = /^\d{4}-\d{2}-\d{2}$/.test(String(launch.competence || '')) ? `${launch.competence}-01` : '';
    $('#paymentForm [name="rental_period_end"]').value = /^\d{4}-\d{2}-\d{2}/.test(String(launch.due_date || '')) ? String(launch.due_date).slice(0, 10) : '';
  }

  updatePaymentFeePreview();
}

async function createPaymentMethod() {
  const input = $('#newPaymentMethodName');
  const name = input?.value?.trim();
  if (!name) return alert('Informe o nome do meio de pagamento.');
  try {
    const created = await api('/api/payment-methods', { method: 'POST', body: JSON.stringify({ name }) });
    input.value = '';
    await loadLists();
    if ($('#paymentMethodSelect')) $('#paymentMethodSelect').value = String(created.id);
    renderPayments();
  } catch (err) {
    alert(err.message || 'Erro ao cadastrar meio de pagamento.');
  }
}

async function createReceivingAccount() {
  const input = $('#newReceivingAccountName');
  const name = input?.value?.trim();
  if (!name) return alert('Informe o nome da conta de recebimento.');
  try {
    const created = await api('/api/receiving-accounts', { method: 'POST', body: JSON.stringify({ name }) });
    input.value = '';
    await loadLists();
    if ($('#receivingAccountSelect')) $('#receivingAccountSelect').value = String(created.id);
    renderPayments();
  } catch (err) {
    alert(err.message || 'Erro ao cadastrar conta de recebimento.');
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
$('#paymentLaunchSelect').addEventListener('change', () => {
  updatePaymentLaunchInfo();
  updatePaymentFeePreview();
});
$('#paymentForm [name="received_amount"]').addEventListener('input', updatePaymentFeePreview);
$('#paymentSearch')?.addEventListener('input', renderPayments);
$('#paymentCompetenceFilter')?.addEventListener('change', renderPayments);
$('#paymentCategoryFilter')?.addEventListener('change', renderPayments);
$('#paymentAccountFilter')?.addEventListener('change', renderPayments);
$('#paymentMethodFilter')?.addEventListener('change', renderPayments);
$('#paymentClearFilters')?.addEventListener('click', () => {
  if ($('#paymentSearch')) $('#paymentSearch').value = '';
  if ($('#paymentCompetenceFilter')) $('#paymentCompetenceFilter').value = '';
  if ($('#paymentCategoryFilter')) $('#paymentCategoryFilter').value = '';
  if ($('#paymentAccountFilter')) $('#paymentAccountFilter').value = '';
  if ($('#paymentMethodFilter')) $('#paymentMethodFilter').value = '';
  renderPayments();
});
$('#addPaymentMethodBtn')?.addEventListener('click', createPaymentMethod);
$('#addReceivingAccountBtn')?.addEventListener('click', createReceivingAccount);
$('#newPaymentMethodName')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); createPaymentMethod(); }
});
$('#newReceivingAccountName')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); createReceivingAccount(); }
});

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
window.editTenant = (id) => { const item = cache.tenants.find((x) => Number(x.id) === Number(id)); fillForm('#tenantForm', item); $('#tenantFormTitle').textContent = 'Editar inquilino'; $('#cancelTenantEdit').classList.remove('hidden'); switchScreen('tenants'); };
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
window.editManager = (id) => { const item = cache.managers.find((x) => Number(x.id) === Number(id)); fillForm('#managerForm', item); $('#managerFormTitle').textContent = 'Editar administradora'; $('#cancelManagerEdit').classList.remove('hidden'); switchScreen('managers'); };
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
window.editProperty = (id) => { const item = cache.properties.find((x) => Number(x.id) === Number(id)); fillForm('#propertyForm', item); $('#propertyFormTitle').textContent = 'Editar imóvel'; $('#cancelPropertyEdit').classList.remove('hidden'); switchScreen('properties'); };
window.deleteProperty = async (id) => { if (!confirm('Excluir este imóvel e seus vínculos?')) return; await api(`/api/properties/${id}`, { method: 'DELETE' }); await refreshAll(); };

$('#configForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const data = Object.fromEntries(new FormData(e.target).entries());
    const id = data.id; delete data.id;
    data.amount = Number(data.amount || 0);
    data.admin_fee_percent = Number(data.admin_fee_percent || 0);
    data.due_day = Number(data.due_day || 1);
    data.active = Number(data.active || 0);
    await api(id ? `/api/category-configs/${id}` : '/api/category-configs', { method: id ? 'PUT' : 'POST', body: JSON.stringify(data) });
    resetForm('#configForm', '#configFormTitle', 'Nova categoria', '#cancelConfigEdit');
    await refreshAll();
  } catch (err) { alert(err.message); }
});
$('#cancelConfigEdit').addEventListener('click', () => resetForm('#configForm', '#configFormTitle', 'Nova categoria', '#cancelConfigEdit'));
window.editConfig = (id) => { const item = cache.configs.find((x) => Number(x.id) === Number(id)); fillForm('#configForm', item); $('#configFormTitle').textContent = 'Editar categoria'; $('#cancelConfigEdit').classList.remove('hidden'); switchScreen('configs'); };
window.deleteConfig = async (id) => { if (!confirm('Excluir esta categoria?')) return; await api(`/api/category-configs/${id}`, { method: 'DELETE' }); await refreshAll(); };

$('#generateLaunchesBtn').addEventListener('click', async () => {
  try {
    await api('/api/launches/generate', { method: 'POST', body: JSON.stringify({ month: $('#launchMonth').value || currentMonth() }) });
    await refreshAll();
  } catch (err) { alert(err.message); }
});
window.editLaunch = async (id) => {
  const item = cache.launches.find((x) => Number(x.id) === Number(id));
  if (!item) return;
  const amount = prompt('Novo valor do lançamento:', item.amount_expected);
  if (amount === null) return;
  const due = prompt('Nova data de vencimento (AAAA-MM-DD):', String(item.due_date || '').slice(0, 10));
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
    $('#paymentExpected').value = '';
    $('#paymentDueDate').value = '';
    $('#paymentCompetence').value = '';
    $('#paymentAdminFeePercent').value = '';
    $('#paymentAdminFeeAmount').value = '';
    $('#paymentNetReceived').value = '';
    await refreshAll();
  } catch (err) { alert(err.message); }
});
$('#cancelPaymentEdit').addEventListener('click', () => {
  resetForm('#paymentForm', '#paymentFormTitle', 'Registrar pagamento', '#cancelPaymentEdit');
  $('#paymentExpected').value = '';
  $('#paymentDueDate').value = '';
  $('#paymentCompetence').value = '';
  $('#paymentAdminFeePercent').value = '';
  $('#paymentAdminFeeAmount').value = '';
  $('#paymentNetReceived').value = '';
});
window.editPayment = (id) => {
  const item = cache.payments.find((x) => Number(x.id) === Number(id));
  if (!item) return;
  fillForm('#paymentForm', item);
  $('#paymentFormTitle').textContent = 'Editar pagamento';
  $('#cancelPaymentEdit').classList.remove('hidden');
  const launch = cache.launches.find((l) => Number(l.id) === Number(item.launch_id));
  $('#paymentExpected').value = launch ? money(launch.amount_expected) : '';
  $('#paymentDueDate').value = launch ? dateBR(launch.due_date) : '';
  $('#paymentCompetence').value = launch ? monthBR(launch.competence) : '';
  $('#paymentAdminFeePercent').value = `${Number(item.admin_fee_percent || launch?.admin_fee_percent || 0).toFixed(2)}%`;
  $('#paymentAdminFeeAmount').value = money(item.admin_fee_amount || 0);
  $('#paymentNetReceived').value = money(item.net_received_amount || 0);
  switchScreen('payments');
};
window.deletePayment = async (id) => { if (!confirm('Excluir este pagamento?')) return; await api(`/api/payments/${id}`, { method: 'DELETE' }); await refreshAll(); };

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action][data-id]');
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();
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
