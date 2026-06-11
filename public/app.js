const TOKEN_KEY = 'imoveisFullstackToken';
const USER_KEY = 'imoveisFullstackUser';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const money = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v || 0));
const dateBR = (d) => d ? new Date(`${d}T12:00:00`).toLocaleDateString('pt-BR') : '-';
const currentMonth = () => new Date().toISOString().slice(0, 7);
const currentDate = () => new Date().toISOString().slice(0, 10);
const monthBR = (ym) => {
  if (!ym) return '-';
  const [y, m] = ym.split('-');
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
};
const toNumber = (v) => Number(v || 0);
const round2 = (v) => Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;

let cache = {
  tenants: [],
  managers: [],
  properties: [],
  configs: [],
  launches: [],
  payments: [],
  methods: [],
  accounts: []
};

function getToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

function setSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

function getUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
  } catch {
    return null;
  }
}

async function api(path, options = {}) {
  const headers = options.headers ? { ...options.headers } : {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const isForm = options.body instanceof FormData;
  if (!isForm && options.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

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
  if (item.received_amount != null) {
    return Number(item.received_amount) >= Number(item.amount_expected) ? 'Pago' : 'Pago parcial';
  }
  return item.due_date < currentDate() ? 'Atrasado' : 'Em aberto';
}

function statusTag(status) {
  const cls =
    status === 'Pago' ? 'pago'
      : status === 'Pago parcial' ? 'parcial'
      : status === 'Atrasado' ? 'atrasado'
      : 'aberto';
  return `<span class="tag ${cls}">${status}</span>`;
}

function fillMonthDefaults() {
  ['#dashboardMonth', '#launchMonth'].forEach((sel) => {
    const el = $(sel);
    if (el) el.value = currentMonth();
  });
}

function fillCurrentUser() {
  const user = getUser();
  $('#currentUserName').textContent = user?.name || '-';
  $('#currentUserEmail').textContent = user?.email || '-';
}

function resetForm(formId, titleId, titleText, cancelId) {
  const form = $(formId);
  form.reset();
  const hidden = form.querySelector('[name="id"]');
  if (hidden) hidden.value = '';
  $(titleId).textContent = titleText;
  $(cancelId).classList.add('hidden');
}

function fillForm(formId, data) {
  Object.entries(data || {}).forEach(([key, value]) => {
    const input = $(`${formId} [name="${key}"]`);
    if (input) input.value = value ?? '';
  });
}

function renderManagerFilters() {
  const opts = ['<option value="">Todas as administradoras</option>']
    .concat(cache.managers.map((m) => `<option value="${m.id}">${m.name}</option>`))
    .join('');
  $('#dashboardManagerFilter').innerHTML = opts;
}

function renderPropertyAndRelationSelects() {
  const tenantOpts = ['<option value="">Selecione</option>']
    .concat(cache.tenants.map((t) => `<option value="${t.id}">${t.name}</option>`))
    .join('');

  const managerOpts = ['<option value="">Selecione</option>']
    .concat(cache.managers.map((m) => `<option value="${m.id}">${m.name}</option>`))
    .join('');

  const propertyOpts = ['<option value="">Selecione</option>']
    .concat(cache.properties.map((p) => `<option value="${p.id}">${p.name}</option>`))
    .join('');

  $('#propertyTenantSelect').innerHTML = tenantOpts;
  $('#propertyManagerSelect').innerHTML = managerOpts;
  $('#configPropertySelect').innerHTML = propertyOpts;
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'pt-BR'));
}

function renderPaymentFilters() {
  const competences = uniqueSorted(cache.payments.map((p) => p.competence));
  const categories = uniqueSorted(cache.payments.map((p) => p.category_name));
  const accounts = uniqueSorted(cache.payments.map((p) => p.receiving_account_name));
  const methods = uniqueSorted(cache.payments.map((p) => p.payment_method_name));

  $('#paymentCompetenceFilter').innerHTML = ['<option value="">Todas</option>']
    .concat(competences.map((v) => `<option value="${v}">${monthBR(v)}</option>`))
    .join('');

  $('#paymentCategoryFilter').innerHTML = ['<option value="">Todas</option>']
    .concat(categories.map((v) => `<option value="${v}">${v}</option>`))
    .join('');

  $('#paymentAccountFilter').innerHTML = ['<option value="">Todas</option>']
    .concat(accounts.map((v) => `<option value="${v}">${v}</option>`))
    .join('');

  $('#paymentMethodFilter').innerHTML = ['<option value="">Todos</option>']
    .concat(methods.map((v) => `<option value="${v}">${v}</option>`))
    .join('');
}

function renderPaymentSelects() {
  const methodOpts = ['<option value="">Selecione</option>']
    .concat(cache.methods.map((m) => `<option value="${m.id}">${m.name}</option>`))
    .join('');

  const accountOpts = ['<option value="">Selecione</option>']
    .concat(cache.accounts.map((a) => `<option value="${a.id}">${a.name}</option>`))
    .join('');

  const launchOpts = ['<option value="">Selecione</option>']
    .concat(cache.launches.map((l) => `
      <option value="${l.id}">
        ${l.property_name} · ${l.category_name} · ${monthBR(l.competence)} · vence ${dateBR(l.due_date)}
      </option>
    `))
    .join('');

  $('#paymentMethodSelect').innerHTML = methodOpts;
  $('#receivingAccountSelect').innerHTML = accountOpts;
  $('#paymentLaunchSelect').innerHTML = launchOpts;
}

function renderDashboard(data) {
  $('#dashboardCards').innerHTML = `
    <div class="card"><div class="kpi-title">Previsto</div><div class="kpi-value">${money(data.summary.total_expected)}</div><div class="muted small">${monthBR($('#dashboardMonth').value || currentMonth())}</div></div>
    <div class="card"><div class="kpi-title">Recebido</div><div class="kpi-value">${money(data.summary.total_received)}</div><div class="muted small">pagamentos lançados</div></div>
    <div class="card"><div class="kpi-title">Em aberto</div><div class="kpi-value">${data.summary.open_count}</div><div class="muted small">cobranças pendentes</div></div>
    <div class="card"><div class="kpi-title">Atrasados</div><div class="kpi-value">${data.summary.late_count}</div><div class="muted small">vencidos sem baixa</div></div>
  `;

  const rows = data.items.map((item) => `
    <tr>
      <td>${item.property_name}</td>
      <td>${item.manager_name || '-'}</td>
      <td>${item.tenant_name || '-'}</td>
      <td>${item.category_name}</td>
      <td>${money(item.amount_expected)}</td>
      <td>${dateBR(item.due_date)}</td>
      <td>${statusTag(statusFromItem(item))}</td>
      <td>${item.payment_date ? dateBR(item.payment_date) : '-'}</td>
      <td>${item.received_amount != null ? money(item.received_amount) : '-'}</td>
    </tr>
  `).join('');

  $('#dashboardTable').innerHTML = data.items.length
    ? `<div class="table-wrap"><table><thead><tr><th>Imóvel</th><th>Administradora</th><th>Inquilino</th><th>Categoria</th><th>Valor</th><th>Vencimento</th><th>Status</th><th>Pagamento</th><th>Recebido</th></tr></thead><tbody>${rows}</tbody></table></div>`
    : '<div class="empty">Nenhum dado para este mês.</div>';
}

function renderTenants() {
  $('#tenantList').innerHTML = cache.tenants.length
    ? `<div class="list">${cache.tenants.map((t) => `
        <div class="item">
          <strong>${t.name}</strong><br>
          <span class="muted small">${t.phone || '-'} ${t.email ? '· ' + t.email : ''}</span>
          ${t.notes ? `<div class="muted small" style="margin-top:8px">${t.notes}</div>` : ''}
          <div class="mini-actions">
            <button class="secondary" onclick="editTenant(${t.id})">Editar</button>
            <button class="danger" onclick="deleteTenant(${t.id})">Excluir</button>
          </div>
        </div>
      `).join('')}</div>`
    : '<div class="empty">Nenhum inquilino cadastrado.</div>';
}

function renderManagers() {
  $('#managerList').innerHTML = cache.managers.length
    ? `<div class="list">${cache.managers.map((m) => `
        <div class="item">
          <strong>${m.name}</strong><br>
          <span class="muted small">${m.phone || '-'} ${m.email ? '· ' + m.email : ''}</span>
          ${m.notes ? `<div class="muted small" style="margin-top:8px">${m.notes}</div>` : ''}
          <div class="mini-actions">
            <button class="secondary" onclick="editManager(${m.id})">Editar</button>
            <button class="danger" onclick="deleteManager(${m.id})">Excluir</button>
          </div>
        </div>
      `).join('')}</div>`
    : '<div class="empty">Nenhuma administradora cadastrada.</div>';
}

function renderProperties() {
  $('#propertyList').innerHTML = cache.properties.length
    ? `<div class="list">${cache.properties.map((p) => `
        <div class="item">
          <strong>${p.name}</strong><br>
          <span class="muted small">${p.address}</span><br>
          <span class="small">Inquilino: ${p.tenant_name || '-'} | Administradora: ${p.manager_name || '-'}</span>
          <div style="margin-top:8px"><span class="chip">Aluguel base ${money(p.rent_value)}</span></div>
          ${p.notes ? `<div class="muted small" style="margin-top:8px">${p.notes}</div>` : ''}
          <div class="mini-actions">
            <button class="secondary" onclick="editProperty(${p.id})">Editar</button>
            <button class="danger" onclick="deleteProperty(${p.id})">Excluir</button>
          </div>
        </div>
      `).join('')}</div>`
    : '<div class="empty">Nenhum imóvel cadastrado.</div>';
}

function renderConfigs() {
  $('#configList').innerHTML = cache.configs.length
    ? `<div class="list">${cache.configs.map((c) => `
        <div class="item">
          <strong>${c.property_name}</strong>
          <div style="margin-top:8px">
            <span class="chip">${c.category_name}</span>
            <span class="chip">${money(c.amount)}</span>
            <span class="chip">${Number(c.admin_fee_percent || 0).toFixed(2)}%</span>
            <span class="chip">vence dia ${c.due_day}</span>
            <span class="chip">${Number(c.active) ? 'ativa' : 'inativa'}</span>
          </div>
          <div class="mini-actions">
            <button class="secondary" onclick="editConfig(${c.id})">Editar</button>
            <button class="danger" onclick="deleteConfig(${c.id})">Excluir</button>
          </div>
        </div>
      `).join('')}</div>`
    : '<div class="empty">Nenhuma categoria cadastrada.</div>';
}

function renderLaunches() {
  $('#launchList').innerHTML = cache.launches.length
    ? `<div class="table-wrap"><table><thead><tr><th>Imóvel</th><th>Categoria</th><th>Competência</th><th>Valor</th><th>% Adm.</th><th>Vencimento</th><th>Status</th><th>Ações</th></tr></thead><tbody>${cache.launches.map((l) => `
        <tr>
          <td>${l.property_name}</td>
          <td>${l.category_name}</td>
          <td>${monthBR(l.competence)}</td>
          <td>${money(l.amount_expected)}</td>
          <td>${Number(l.admin_fee_percent || 0).toFixed(2)}%</td>
          <td>${dateBR(l.due_date)}</td>
          <td>${statusTag(statusFromItem(l))}</td>
          <td>
            <div class="mini-actions">
              <button class="secondary" onclick="editLaunch(${l.id})">Editar</button>
              <button class="danger" onclick="deleteLaunch(${l.id})">Excluir</button>
            </div>
          </td>
        </tr>
      `).join('')}</tbody></table></div>`
    : '<div class="empty">Nenhum lançamento neste mês.</div>';
}

function getFilteredPayments() {
  const q = ($('#paymentSearch')?.value || '').trim().toLowerCase();
  const competence = $('#paymentCompetenceFilter')?.value || '';
  const category = $('#paymentCategoryFilter')?.value || '';
  const account = $('#paymentAccountFilter')?.value || '';
  const method = $('#paymentMethodFilter')?.value || '';

  return cache.payments.filter((p) => {
    const haystack = [
      p.property_name,
      p.category_name,
      p.notes,
      p.receipt_original_name,
      p.receiving_account_name,
      p.payment_method_name
    ].join(' ').toLowerCase();

    const matchesSearch = !q || haystack.includes(q);
    const matchesCompetence = !competence || p.competence === competence;
    const matchesCategory = !category || p.category_name === category;
    const matchesAccount = !account || (p.receiving_account_name || '') === account;
    const matchesMethod = !method || (p.payment_method_name || '') === method;

    return matchesSearch && matchesCompetence && matchesCategory && matchesAccount && matchesMethod;
  });
}

function renderPayments() {
  const list = getFilteredPayments();

  $('#paymentList').innerHTML = list.length
    ? `<div class="list">${list.map((p) => {
      const receipt = p.receipt_file_path
        ? `<br>Recibo: <a href="${p.receipt_file_path}" target="_blank">${p.receipt_original_name || 'Abrir arquivo'}</a>`
        : '';

      const period = (p.rental_period_start || p.rental_period_end)
        ? `<br>Período: <strong>${dateBR(p.rental_period_start)}</strong> até <strong>${dateBR(p.rental_period_end)}</strong>`
        : '';

      return `
        <div class="item">
          <strong>${p.property_name}</strong><br>
          <span class="chip">${p.category_name}</span>
          <span class="chip">${monthBR(p.competence)}</span>
          <div class="small" style="margin-top:8px">
            Valor previsto: <strong>${money(p.amount_expected)}</strong><br>
            Multa: <strong>${money(p.fine_amount)}</strong> | Juros: <strong>${money(p.interest_amount)}</strong><br>
            Valor recebido: <strong>${money(p.received_amount)}</strong> | Data: <strong>${dateBR(p.payment_date)}</strong><br>
            % administradora: <strong>${Number(p.admin_fee_percent || 0).toFixed(2)}%</strong> |
            Taxa administradora: <strong>${money(p.admin_fee_amount)}</strong><br>
            Recebimento líquido: <strong>${money(p.net_received_amount)}</strong><br>
            Meio: <strong>${p.payment_method_name || '-'}</strong> | Conta: <strong>${p.receiving_account_name || '-'}</strong>
            ${period}
            ${receipt}
          </div>
          ${p.notes ? `<div class="muted small" style="margin-top:8px">${p.notes}</div>` : ''}
          <div class="mini-actions">
            <button class="secondary" onclick="editPayment(${p.id})">Editar</button>
            <button class="danger" onclick="deletePayment(${p.id})">Excluir</button>
          </div>
        </div>
      `;
    }).join('')}</div>`
    : '<div class="empty">Nenhum pagamento cadastrado.</div>';
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
  renderPaymentFilters();
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

function calculatePaymentTotals(launch, fineAmount, interestAmount) {
  const base = round2(Number(launch?.amount_expected || 0));
  const fine = round2(Number(fineAmount || 0));
  const interest = round2(Number(interestAmount || 0));
  const totalReceived = round2(base + fine + interest);
  const adminPercent = round2(Number(launch?.admin_fee_percent || 0));
  const adminFee = round2((totalReceived * adminPercent) / 100);
  const netReceived = round2(totalReceived - adminFee);

  return {
    base,
    fine,
    interest,
    totalReceived,
    adminPercent,
    adminFee,
    netReceived
  };
}

function updatePaymentComputedFields(syncReceived = true) {
  const launch = currentLaunchBySelect();
  const fine = $('#paymentFineAmount')?.value || 0;
  const interest = $('#paymentInterestAmount')?.value || 0;
  const totals = calculatePaymentTotals(launch, fine, interest);

  $('#paymentExpected').value = launch ? money(totals.base) : '';
  $('#paymentDueDate').value = launch ? dateBR(launch.due_date) : '';
  $('#paymentCompetence').value = launch ? monthBR(launch.competence) : '';
  $('#paymentAdminFeePercent').value = launch ? `${totals.adminPercent.toFixed(2)}%` : '';
  $('#paymentAdminFeeAmount').value = launch ? money(totals.adminFee) : '';
  $('#paymentNetReceived').value = launch ? money(totals.netReceived) : '';

  if (launch && syncReceived) {
    $('#paymentReceivedAmount').value = totals.totalReceived.toFixed(2);
  }
}

function updatePaymentLaunchInfo() {
  const launch = currentLaunchBySelect();

  if (launch && !$('#paymentForm [name="id"]').value) {
    $('#paymentFineAmount').value = '0.00';
    $('#paymentInterestAmount').value = '0.00';
    $('#paymentReceivedAmount').value = Number(launch.amount_expected || 0).toFixed(2);
    $('#paymentForm [name="payment_date"]').value = currentDate();
    $('#paymentForm [name="rental_period_start"]').value = `${launch.competence}-01`;
    $('#paymentForm [name="rental_period_end"]').value = launch.due_date;
  }

  updatePaymentComputedFields(true);
}

function clearPaymentComputedFields() {
  $('#paymentExpected').value = '';
  $('#paymentDueDate').value = '';
  $('#paymentCompetence').value = '';
  $('#paymentAdminFeePercent').value = '';
  $('#paymentAdminFeeAmount').value = '';
  $('#paymentNetReceived').value = '';
}

function backupFileName() {
  return `backup-imoveis-em-dia-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
}

function downloadBackupFile(data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = backupFileName();
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function buildImportSummary(counts = {}) {
  return [
    `Inquilinos: ${counts.tenants || 0}`,
    `Administradoras: ${counts.managers || 0}`,
    `Imóveis: ${counts.properties || 0}`,
    `Categorias: ${counts.category_configs || 0}`,
    `Lançamentos: ${counts.launches || 0}`,
    `Pagamentos: ${counts.payments || 0}`,
    `Meios: ${counts.payment_methods || 0}`,
    `Contas: ${counts.receiving_accounts || 0}`
  ].join('\n');
}

async function bootFromSession() {
  const token = getToken();
  if (!token) {
    showApp(false);
    return;
  }

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
$('#paymentFineAmount').addEventListener('input', () => updatePaymentComputedFields(true));
$('#paymentInterestAmount').addEventListener('input', () => updatePaymentComputedFields(true));

$('#paymentSearch').addEventListener('input', renderPayments);
$('#paymentCompetenceFilter').addEventListener('change', renderPayments);
$('#paymentCategoryFilter').addEventListener('change', renderPayments);
$('#paymentAccountFilter').addEventListener('change', renderPayments);
$('#paymentMethodFilter').addEventListener('change', renderPayments);
$('#paymentClearFilters').addEventListener('click', () => {
  $('#paymentSearch').value = '';
  $('#paymentCompetenceFilter').value = '';
  $('#paymentCategoryFilter').value = '';
  $('#paymentAccountFilter').value = '';
  $('#paymentMethodFilter').value = '';
  renderPayments();
});

$('#backupExportBtn').addEventListener('click', async () => {
  try {
    const data = await api('/api/backup/export');
    downloadBackupFile(data);
    alert('Backup gerado com sucesso.');
  } catch (err) {
    alert(err.message || 'Erro ao gerar backup.');
  }
});

$('#backupImportBtn').addEventListener('click', () => {
  $('#backupImportFile').click();
});

$('#backupImportFile').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    const json = JSON.parse(text);

    if (!confirm('A restauração vai substituir os dados atuais da sua conta. Deseja continuar?')) {
      e.target.value = '';
      return;
    }

    const result = await api('/api/backup/import', {
      method: 'POST',
      body: JSON.stringify(json)
    });

    await refreshAll();
    alert(`Restauração concluída.\n\n${buildImportSummary(result.counts)}`);
  } catch (err) {
    alert(err.message || 'Erro ao restaurar backup.');
  } finally {
    e.target.value = '';
  }
});

$('#addPaymentMethodBtn').addEventListener('click', async () => {
  try {
    const name = ($('#newPaymentMethodName').value || '').trim();
    if (!name) return alert('Digite o nome do meio de pagamento.');
    const created = await api('/api/payment-methods', {
      method: 'POST',
      body: JSON.stringify({ name })
    });
    $('#newPaymentMethodName').value = '';
    await loadLists();
    $('#paymentMethodSelect').value = String(created.id);
  } catch (err) {
    alert(err.message || 'Erro ao adicionar meio de pagamento.');
  }
});

$('#addReceivingAccountBtn').addEventListener('click', async () => {
  try {
    const name = ($('#newReceivingAccountName').value || '').trim();
    if (!name) return alert('Digite o nome da conta de recebimento.');
    const created = await api('/api/receiving-accounts', {
      method: 'POST',
      body: JSON.stringify({ name })
    });
    $('#newReceivingAccountName').value = '';
    await loadLists();
    $('#receivingAccountSelect').value = String(created.id);
  } catch (err) {
    alert(err.message || 'Erro ao adicionar conta de recebimento.');
  }
});

$('#tenantForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const data = Object.fromEntries(new FormData(e.target).entries());
    const id = data.id;
    delete data.id;

    await api(id ? `/api/tenants/${id}` : '/api/tenants', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(data)
    });

    resetForm('#tenantForm', '#tenantFormTitle', 'Novo inquilino', '#cancelTenantEdit');
    await refreshAll();
  } catch (err) {
    alert(err.message);
  }
});

$('#cancelTenantEdit').addEventListener('click', () => resetForm('#tenantForm', '#tenantFormTitle', 'Novo inquilino', '#cancelTenantEdit'));
window.editTenant = (id) => {
  const item = cache.tenants.find((x) => x.id === id);
  fillForm('#tenantForm', item);
  $('#tenantFormTitle').textContent = 'Editar inquilino';
  $('#cancelTenantEdit').classList.remove('hidden');
  switchScreen('tenants');
};
window.deleteTenant = async (id) => {
  if (!confirm('Excluir este inquilino?')) return;
  await api(`/api/tenants/${id}`, { method: 'DELETE' });
  await refreshAll();
};

$('#managerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const data = Object.fromEntries(new FormData(e.target).entries());
    const id = data.id;
    delete data.id;

    await api(id ? `/api/managers/${id}` : '/api/managers', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(data)
    });

    resetForm('#managerForm', '#managerFormTitle', 'Nova administradora', '#cancelManagerEdit');
    await refreshAll();
  } catch (err) {
    alert(err.message);
  }
});

$('#cancelManagerEdit').addEventListener('click', () => resetForm('#managerForm', '#managerFormTitle', 'Nova administradora', '#cancelManagerEdit'));
window.editManager = (id) => {
  const item = cache.managers.find((x) => x.id === id);
  fillForm('#managerForm', item);
  $('#managerFormTitle').textContent = 'Editar administradora';
  $('#cancelManagerEdit').classList.remove('hidden');
  switchScreen('managers');
};
window.deleteManager = async (id) => {
  if (!confirm('Excluir esta administradora?')) return;
  await api(`/api/managers/${id}`, { method: 'DELETE' });
  await refreshAll();
};

$('#propertyForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const data = Object.fromEntries(new FormData(e.target).entries());
    const id = data.id;
    delete data.id;

    data.tenant_id = data.tenant_id || null;
    data.manager_id = data.manager_id || null;
    data.rent_value = toNumber(data.rent_value);

    await api(id ? `/api/properties/${id}` : '/api/properties', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(data)
    });

    resetForm('#propertyForm', '#propertyFormTitle', 'Novo imóvel', '#cancelPropertyEdit');
    await refreshAll();
  } catch (err) {
    alert(err.message);
  }
});

$('#cancelPropertyEdit').addEventListener('click', () => resetForm('#propertyForm', '#propertyFormTitle', 'Novo imóvel', '#cancelPropertyEdit'));
window.editProperty = (id) => {
  const item = cache.properties.find((x) => x.id === id);
  fillForm('#propertyForm', item);
  $('#propertyFormTitle').textContent = 'Editar imóvel';
  $('#cancelPropertyEdit').classList.remove('hidden');
  switchScreen('properties');
};
window.deleteProperty = async (id) => {
  if (!confirm('Excluir este imóvel e seus vínculos?')) return;
  await api(`/api/properties/${id}`, { method: 'DELETE' });
  await refreshAll();
};

$('#configForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const data = Object.fromEntries(new FormData(e.target).entries());
    const id = data.id;
    delete data.id;

    data.amount = toNumber(data.amount);
    data.admin_fee_percent = toNumber(data.admin_fee_percent);
    data.due_day = Number(data.due_day || 1);
    data.active = Number(data.active || 0);

    await api(id ? `/api/category-configs/${id}` : '/api/category-configs', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(data)
    });

    resetForm('#configForm', '#configFormTitle', 'Nova categoria', '#cancelConfigEdit');
    await refreshAll();
  } catch (err) {
    alert(err.message);
  }
});

$('#cancelConfigEdit').addEventListener('click', () => resetForm('#configForm', '#configFormTitle', 'Nova categoria', '#cancelConfigEdit'));
window.editConfig = (id) => {
  const item = cache.configs.find((x) => x.id === id);
  fillForm('#configForm', item);
  $('#configFormTitle').textContent = 'Editar categoria';
  $('#cancelConfigEdit').classList.remove('hidden');
  switchScreen('configs');
};
window.deleteConfig = async (id) => {
  if (!confirm('Excluir esta categoria?')) return;
  await api(`/api/category-configs/${id}`, { method: 'DELETE' });
  await refreshAll();
};

$('#generateLaunchesBtn').addEventListener('click', async () => {
  try {
    await api('/api/launches/generate', {
      method: 'POST',
      body: JSON.stringify({ month: $('#launchMonth').value || currentMonth() })
    });
    await refreshAll();
  } catch (err) {
    alert(err.message);
  }
});

window.editLaunch = async (id) => {
  const item = cache.launches.find((x) => x.id === id);
  if (!item) return;

  const amount = prompt('Novo valor do lançamento:', item.amount_expected);
  if (amount === null) return;

  const due = prompt('Nova data de vencimento (AAAA-MM-DD):', item.due_date);
  if (due === null) return;

  const adminFeePercent = prompt('% da administradora:', item.admin_fee_percent ?? 0);
  if (adminFeePercent === null) return;

  await api(`/api/launches/${id}`, {
    method: 'PUT',
    body: JSON.stringify({
      amount_expected: Number(amount),
      due_date: due,
      admin_fee_percent: Number(adminFeePercent || 0),
      category_name: item.category_name,
      notes: item.notes || null
    })
  });

  await refreshAll();
};

window.deleteLaunch = async (id) => {
  if (!confirm('Excluir este lançamento?')) return;
  await api(`/api/launches/${id}`, { method: 'DELETE' });
  await refreshAll();
};

$('#paymentForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  try {
    const fd = new FormData(e.target);
    const id = fd.get('id');
    const receipt = fd.get('receipt');
    const launch = cache.launches.find((l) => l.id === Number(fd.get('launch_id')));

    if (!launch) {
      alert('Selecione um lançamento.');
      return;
    }

    const fineAmount = toNumber(fd.get('fine_amount'));
    const interestAmount = toNumber(fd.get('interest_amount'));
    const totals = calculatePaymentTotals(launch, fineAmount, interestAmount);

    const payload = {
      launch_id: Number(fd.get('launch_id')),
      fine_amount: fineAmount,
      interest_amount: interestAmount,
      received_amount: totals.totalReceived,
      admin_fee_percent: totals.adminPercent,
      admin_fee_amount: totals.adminFee,
      net_received_amount: totals.netReceived,
      payment_date: fd.get('payment_date'),
      payment_method_id: fd.get('payment_method_id') || null,
      receiving_account_id: fd.get('receiving_account_id') || null,
      rental_period_start: fd.get('rental_period_start') || null,
      rental_period_end: fd.get('rental_period_end') || null,
      notes: fd.get('notes') || null
    };

    const payment = await api(id ? `/api/payments/${id}` : '/api/payments', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(payload)
    });

    if (receipt && receipt.size > 0) {
      const receiptFd = new FormData();
      receiptFd.append('receipt', receipt);
      await api(`/api/payments/${payment.id}/receipt`, { method: 'POST', body: receiptFd });
    }

    resetForm('#paymentForm', '#paymentFormTitle', 'Registrar pagamento', '#cancelPaymentEdit');
    $('#paymentFineAmount').value = '0.00';
    $('#paymentInterestAmount').value = '0.00';
    $('#paymentReceivedAmount').value = '';
    clearPaymentComputedFields();
    await refreshAll();
  } catch (err) {
    alert(err.message);
  }
});

$('#cancelPaymentEdit').addEventListener('click', () => {
  resetForm('#paymentForm', '#paymentFormTitle', 'Registrar pagamento', '#cancelPaymentEdit');
  $('#paymentFineAmount').value = '0.00';
  $('#paymentInterestAmount').value = '0.00';
  $('#paymentReceivedAmount').value = '';
  clearPaymentComputedFields();
});

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
  $('#paymentReceivedAmount').value = Number(item.received_amount || 0).toFixed(2);
  $('#paymentFineAmount').value = Number(item.fine_amount || 0).toFixed(2);
  $('#paymentInterestAmount').value = Number(item.interest_amount || 0).toFixed(2);
  $('#paymentAdminFeePercent').value = `${Number(item.admin_fee_percent || launch?.admin_fee_percent || 0).toFixed(2)}%`;
  $('#paymentAdminFeeAmount').value = money(item.admin_fee_amount || 0);
  $('#paymentNetReceived').value = money(item.net_received_amount || 0);

  switchScreen('payments');
};

window.deletePayment = async (id) => {
  if (!confirm('Excluir este pagamento?')) return;
  await api(`/api/payments/${id}`, { method: 'DELETE' });
  await refreshAll();
};

fillMonthDefaults();
bootFromSession();
