const TOKEN_KEY = 'imoveis_em_dia_token';
const USER_KEY = 'imoveis_em_dia_user';

const cache = {
  tenants: [],
  managers: [],
  properties: [],
  configs: [],
  launches: [],
  payments: [],
  methods: [],
  accounts: [],
  dashboard: { summary: {}, items: [] },
  reportRows: []
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const byId = (id) => document.getElementById(id);

const NUMERIC_FIELDS = [
  'rent_value',
  'amount',
  'amount_expected',
  'received_amount',
  'fine_amount',
  'interest_amount',
  'admin_fee_percent',
  'admin_fee_amount',
  'net_received_amount',
  'total_expected',
  'total_received',
  'expected',
  'received',
  'admin_fee',
  'net',
  'net_received'
];

const DATE_FIELDS = [
  'due_date',
  'competence_start',
  'competence_end',
  'payment_date',
  'rental_period_start',
  'rental_period_end',
  'created_at'
];

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function toNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;

  const str = String(value).trim();
  if (!str) return fallback;

  if (str.includes(',')) {
    const normalized = str.replace(/\./g, '').replace(',', '.');
    const num = Number(normalized);
    return Number.isFinite(num) ? num : fallback;
  }

  const num = Number(str);
  return Number.isFinite(num) ? num : fallback;
}

function round2(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function money(value) {
  return Number(value || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  });
}

function normalizeDateOnly(value) {
  if (!value) return '';

  const str = String(value).trim();

  if (str.includes('T')) return str.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  return str;
}

function dateBR(value) {
  if (!value) return '—';

  const normalized = normalizeDateOnly(value);

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    const [year, month, day] = normalized.split('-');
    return `${day}/${month}/${year}`;
  }

  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) return date.toLocaleDateString('pt-BR');

  return String(value);
}

function brDateToIso(value) {
  const str = String(value || '').trim();
  if (!str) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  const match = str.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return '';
  const [, dd, mm, yyyy] = match;
  return `${yyyy}-${mm}-${dd}`;
}

function isoToBrInput(value) {
  const normalized = normalizeDateOnly(value);
  return normalized ? dateBR(normalized) : '';
}

function monthBR(value) {
  if (!value) return '—';
  const [year, month] = String(value).split('-').map(Number);
  if (!year || !month) return value;
  const date = new Date(year, month - 1, 1);
  return date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function currentDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function monthFromDate(value) {
  if (!value) return '';
  return normalizeDateOnly(value).slice(0, 7);
}

function firstDayOfMonth(month) {
  if (!month) return '';
  return `${month}-01`;
}

function lastDayOfMonth(month) {
  if (!month) return '';
  const [year, monthNum] = month.split('-').map(Number);
  const date = new Date(year, monthNum, 0);
  return `${year}-${String(monthNum).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function nextMonth(month) {
  if (!month) return '';
  const [year, monthNum] = month.split('-').map(Number);
  const date = new Date(year, monthNum, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function lastDayOfDateMonth(dateStr) {
  if (!dateStr) return '';
  const normalized = normalizeDateOnly(dateStr);
  const [year, month] = normalized.slice(0, 7).split('-').map(Number);
  const last = new Date(year, month, 0);
  return `${year}-${String(month).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`;
}

function formatPeriod(start, end) {
  if (!start && !end) return '—';
  if (start && end) return `${dateBR(start)} a ${dateBR(end)}`;
  return dateBR(start || end);
}

function normalizeRecord(record) {
  if (!record || typeof record !== 'object') return record;

  const normalized = { ...record };

  for (const key of NUMERIC_FIELDS) {
    if (key in normalized && normalized[key] !== null && normalized[key] !== undefined && normalized[key] !== '') {
      normalized[key] = round2(toNumber(normalized[key]));
    }
  }

  for (const key of DATE_FIELDS) {
    if (key in normalized && normalized[key]) {
      normalized[key] = normalizeDateOnly(normalized[key]);
    }
  }

  if (normalized.competence && String(normalized.competence).includes('T')) {
    normalized.competence = String(normalized.competence).slice(0, 7);
  }

  return normalized;
}

function normalizeArray(items) {
  return Array.isArray(items) ? items.map(normalizeRecord) : [];
}

function computeDashboardSummary(items) {
  const today = currentDate();

  return items.reduce(
    (acc, item) => {
      const expected = round2(toNumber(item.amount_expected));
      const received = round2(toNumber(item.received_amount));
      const dueDate = normalizeDateOnly(item.due_date || '');

      let status = 'Em aberto';
      if (item.payment_date || received > 0) {
        status = received >= expected && expected > 0 ? 'Pago' : 'Pago parcial';
      } else if (dueDate && dueDate < today) {
        status = 'Atrasado';
      }

      acc.total_expected += expected;
      acc.total_received += received;
      if (status === 'Atrasado') acc.late_count += 1;
      if (status === 'Em aberto' || status === 'Atrasado') acc.open_count += 1;

      return acc;
    },
    { total_expected: 0, total_received: 0, open_count: 0, late_count: 0 }
  );
}

function statusFromItem(item) {
  const expected = round2(toNumber(item.amount_expected));
  const received = round2(toNumber(item.received_amount));
  const dueDate = normalizeDateOnly(item.due_date || '');
  const today = currentDate();

  if (item.payment_date || received > 0) {
    if (received >= expected && expected > 0) return 'Pago';
    return 'Pago parcial';
  }

  if (dueDate && dueDate < today) return 'Atrasado';
  return 'Em aberto';
}

function statusClass(status) {
  const map = {
    Pago: 'success',
    'Pago parcial': 'warning',
    Atrasado: 'danger',
    'Em aberto': 'muted'
  };
  return map[status] || 'muted';
}

function statusTag(status) {
  return `<span class="status-badge ${statusClass(status)}">${escapeHtml(status)}</span>`;
}

function getToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

function getUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
  } catch (_) {
    return null;
  }
}

function setSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user || null));
}

function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

async function api(url, options = {}) {
  const opts = { ...options };
  const headers = new Headers(opts.headers || {});
  const token = getToken();

  if (token) headers.set('Authorization', `Bearer ${token}`);

  const isFormData = typeof FormData !== 'undefined' && opts.body instanceof FormData;
  if (!isFormData && opts.body && typeof opts.body === 'object') {
    headers.set('Content-Type', 'application/json');
    opts.body = JSON.stringify(opts.body);
  }

  opts.headers = headers;

  const response = await fetch(url, opts);
  const raw = await response.text();

  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch (_) {
    data = raw;
  }

  if (!response.ok) {
    const message =
      (data && typeof data === 'object' && (data.error || data.message)) ||
      raw ||
      `Erro HTTP ${response.status}`;

    if (response.status === 401) {
      clearSession();
      showApp(false);
    }

    throw new Error(message);
  }

  return data;
}

function setAuthMessage(message = '', type = 'error') {
  const el = byId('authMessage');
  if (!el) return;
  el.textContent = message;
  el.className = `auth-message ${type}`.trim();
}

function showApp(isLoggedIn) {
  const authScreen = byId('authScreen');
  const appShell = byId('appShell');

  if (authScreen) authScreen.style.display = isLoggedIn ? 'none' : '';
  if (appShell) appShell.style.display = isLoggedIn ? '' : 'none';

  if (isLoggedIn) fillCurrentUser();
}

function fillCurrentUser() {
  const user = getUser();
  const target =
    byId('currentUserName') ||
    byId('loggedUserName') ||
    byId('sidebarUserName') ||
    $('[data-current-user]');

  if (!target) return;
  target.textContent = user?.name || user?.email || 'Usuário';
}

function switchTab(tab) {
  const loginTab = byId('loginTab');
  const registerTab = byId('registerTab');
  const loginPanel = byId('loginPanel') || byId('loginFormWrap') || byId('loginBox');
  const registerPanel = byId('registerPanel') || byId('registerFormWrap') || byId('registerBox');

  if (loginTab) loginTab.classList.toggle('active', tab === 'login');
  if (registerTab) registerTab.classList.toggle('active', tab === 'register');

  if (loginPanel) loginPanel.style.display = tab === 'login' ? '' : 'none';
  if (registerPanel) registerPanel.style.display = tab === 'register' ? '' : 'none';
}

function switchScreen(screen) {

  $$('.screen, section[data-screen], main section[id]').forEach((section) => {
    if (!section.id) return;
    const isTarget = section.id === screen;

    if (['dashboard', 'tenants', 'managers', 'properties', 'configs', 'launches', 'payments', 'reports'].includes(section.id)) {
      section.style.display = isTarget ? '' : 'none';
      section.classList.toggle('active', isTarget);
    }
  });


  $$('[data-screen]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.screen === screen);
  });
}

function fillMonthDefaults() {
  const monthFields = ['dashboardMonth', 'launchMonth', 'reportMonth', 'paymentMonthFilter', 'paymentCompetenceFilter'];

  monthFields.forEach((id) => {
    const field = byId(id);
    if (field && !field.value) field.value = currentMonth();
  });

  const reportType = byId('reportTypeFilter');
  if (reportType && !reportType.value) reportType.value = 'all';
}

function resetForm(form) {
  if (!form) return;
  form.reset();
  const hiddenId = form.querySelector('[name="id"]');
  if (hiddenId) hiddenId.value = '';
}

function formField(form, name, fallbackId = '') {
  return (
    form?.querySelector(`[name="${name}"]`) ||
    (fallbackId ? byId(fallbackId) : null) ||
    byId(name)
  );
}

function setSelectOptions(select, items, config = {}) {
  if (!select) return;

  const {
    placeholder = 'Selecione',
    valueKey = 'id',
    label = (item) => item.name ?? item.label ?? String(item.id)
  } = config;

  const current = select.value;

  select.innerHTML =
    `<option value="">${escapeHtml(placeholder)}</option>` +
    items
      .map((item) => {
        const value = item[valueKey];
        return `<option value="${escapeHtml(value)}">${escapeHtml(label(item))}</option>`;
      })
      .join('');

  if (current) select.value = current;
}

function findLaunchById(id) {
  return cache.launches.find((item) => Number(item.id) === Number(id)) || null;
}

function findPaymentById(id) {
  return cache.payments.find((item) => Number(item.id) === Number(id)) || null;
}

function buildLaunchDisplayName(item) {
  const period = formatPeriod(item.competence_start, item.competence_end);
  return `${item.property_name || item.property_label || 'Imóvel'} • ${item.category_name || 'Categoria'} • ${period}`;
}

function refreshAllSelects() {
  setSelectOptions(
    byId('propertyTenantSelect') || $('[name="tenant_id"]', byId('propertyForm')),
    cache.tenants,
    { placeholder: 'Selecione o inquilino', label: (item) => item.name }
  );

  setSelectOptions(
    byId('propertyManagerSelect') || $('[name="manager_id"]', byId('propertyForm')),
    cache.managers,
    { placeholder: 'Selecione a administradora', label: (item) => item.name }
  );

  setSelectOptions(
    byId('configPropertySelect') || $('[name="property_id"]', byId('configForm')),
    cache.properties,
    { placeholder: 'Selecione o imóvel', label: (item) => item.name }
  );

  setSelectOptions(
    byId('paymentLaunchSelect'),
    cache.launches,
    { placeholder: 'Selecione o lançamento', label: buildLaunchDisplayName }
  );

  setSelectOptions(
    byId('paymentMethodSelect'),
    cache.methods,
    { placeholder: 'Selecione o meio de pagamento', label: (item) => item.name }
  );

  setSelectOptions(
    byId('receivingAccountSelect'),
    cache.accounts,
    { placeholder: 'Selecione a conta', label: (item) => item.name }
  );

  setSelectOptions(
    byId('dashboardManagerFilter'),
    cache.managers,
    { placeholder: 'Todas as administradoras', label: (item) => item.name }
  );

  setSelectOptions(
    byId('reportManagerFilter'),
    cache.managers,
    { placeholder: 'Todas as administradoras', label: (item) => item.name }
  );

  setSelectOptions(
    byId('reportPropertyFilter'),
    cache.properties,
    { placeholder: 'Todos os imóveis', label: (item) => item.name }
  );

  const paymentCategoryFilter = byId('paymentCategoryFilter');
  if (paymentCategoryFilter) {
    const categories = [...new Set(cache.payments.map((item) => item.category_name).filter(Boolean))]
      .sort()
      .map((name, index) => ({ id: index + 1, name }));

    paymentCategoryFilter.innerHTML =
      `<option value="">Todas as categorias</option>` +
      categories.map((item) => `<option value="${escapeHtml(item.name)}">${escapeHtml(item.name)}</option>`).join('');
  }

  const paymentAccountFilter = byId('paymentAccountFilter');
  if (paymentAccountFilter) {
    paymentAccountFilter.innerHTML =
      `<option value="">Todas as contas</option>` +
      cache.accounts.map((item) => `<option value="${escapeHtml(item.name)}">${escapeHtml(item.name)}</option>`).join('');
  }

  const paymentMethodFilter = byId('paymentMethodFilter');
  if (paymentMethodFilter) {
    paymentMethodFilter.innerHTML =
      `<option value="">Todos os meios</option>` +
      cache.methods.map((item) => `<option value="${escapeHtml(item.name)}">${escapeHtml(item.name)}</option>`).join('');
  }

  const reportCategoryFilter = byId('reportCategoryFilter');
  if (reportCategoryFilter) {
    const reportCategories = [...new Set(cache.reportRows.map((item) => item.category_name).filter(Boolean))].sort();

    reportCategoryFilter.innerHTML =
      `<option value="">Todas as categorias</option>` +
      reportCategories.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
  }
}

function renderDashboard() {
  const summary = cache.dashboard.summary || {};
  const items = cache.dashboard.items || [];

  const totalExpected = byId('dashboardTotalExpected');
  const totalReceived = byId('dashboardTotalReceived');
  const openCount = byId('dashboardOpenCount');
  const lateCount = byId('dashboardLateCount');

  if (totalExpected) totalExpected.textContent = money(summary.total_expected || 0);
  if (totalReceived) totalReceived.textContent = money(summary.total_received || 0);
  if (openCount) openCount.textContent = String(summary.open_count || 0);
  if (lateCount) lateCount.textContent = String(summary.late_count || 0);

  const list = byId('dashboardList') || byId('dashboardItems') || byId('dashboardTable');
  if (!list) return;

  if (!items.length) {
    list.innerHTML = '<div class="empty-state">Nenhum lançamento encontrado para o período.</div>';
    return;
  }

  list.innerHTML = `
    <div class="table-scroll">
      <table class="data-table">
        <thead>
          <tr>
            <th>Imóvel</th>
            <th>Categoria</th>
            <th>Período do aluguel</th>
            <th>Vencimento</th>
            <th>Previsto</th>
            <th>Recebido</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((item) => {
            const status = statusFromItem(item);
            return `
              <tr>
                <td>${escapeHtml(item.property_name || '—')}</td>
                <td>${escapeHtml(item.category_name || '—')}</td>
                <td>${escapeHtml(formatPeriod(item.competence_start, item.competence_end))}</td>
                <td>${escapeHtml(dateBR(item.due_date))}</td>
                <td>${escapeHtml(money(item.amount_expected))}</td>
                <td>${escapeHtml(money(item.received_amount || 0))}</td>
                <td>${statusTag(status)}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderTenants() {
  const list = byId('tenantList');
  if (!list) return;

  if (!cache.tenants.length) {
    list.innerHTML = '<div class="empty-state">Nenhum inquilino cadastrado.</div>';
    return;
  }

  list.innerHTML = cache.tenants.map((item) => `
    <article class="card-item">
      <div class="card-item__header">
        <h3>${escapeHtml(item.name)}</h3>
        <div class="card-actions">
          <button type="button" data-action="tenant-edit" data-id="${item.id}">Editar</button>
          <button type="button" data-action="tenant-delete" data-id="${item.id}" class="danger">Excluir</button>
        </div>
      </div>
      <p><strong>Telefone:</strong> ${escapeHtml(item.phone || '—')}</p>
      <p><strong>E-mail:</strong> ${escapeHtml(item.email || '—')}</p>
      <p><strong>Período padrão do aluguel:</strong> ${escapeHtml(formatPeriod(item.rental_period_start, item.rental_period_end))}</p>
      <p><strong>Observações:</strong> ${escapeHtml(item.notes || '—')}</p>
    </article>
  `).join('');
}

function renderManagers() {
  const list = byId('managerList');
  if (!list) return;

  if (!cache.managers.length) {
    list.innerHTML = '<div class="empty-state">Nenhuma administradora cadastrada.</div>';
    return;
  }

  list.innerHTML = cache.managers.map((item) => `
    <article class="card-item">
      <div class="card-item__header">
        <h3>${escapeHtml(item.name)}</h3>
        <div class="card-actions">
          <button type="button" data-action="manager-edit" data-id="${item.id}">Editar</button>
          <button type="button" data-action="manager-delete" data-id="${item.id}" class="danger">Excluir</button>
        </div>
      </div>
      <p><strong>Telefone:</strong> ${escapeHtml(item.phone || '—')}</p>
      <p><strong>E-mail:</strong> ${escapeHtml(item.email || '—')}</p>
      <p><strong>Observações:</strong> ${escapeHtml(item.notes || '—')}</p>
    </article>
  `).join('');
}

function renderProperties() {
  const list = byId('propertyList');
  if (!list) return;

  if (!cache.properties.length) {
    list.innerHTML = '<div class="empty-state">Nenhum imóvel cadastrado.</div>';
    return;
  }

  list.innerHTML = cache.properties.map((item) => `
    <article class="card-item">
      <div class="card-item__header">
        <h3>${escapeHtml(item.name)}</h3>
        <div class="card-actions">
          <button type="button" data-action="property-edit" data-id="${item.id}">Editar</button>
          <button type="button" data-action="property-delete" data-id="${item.id}" class="danger">Excluir</button>
        </div>
      </div>
      <p><strong>Endereço:</strong> ${escapeHtml(item.address || '—')}</p>
      <p><strong>Inquilino:</strong> ${escapeHtml(item.tenant_name || '—')}</p>
      <p><strong>Administradora:</strong> ${escapeHtml(item.manager_name || '—')}</p>
      <p><strong>Aluguel base:</strong> ${escapeHtml(money(item.rent_value || 0))}</p>
      <p><strong>Observações:</strong> ${escapeHtml(item.notes || '—')}</p>
    </article>
  `).join('');
}

function renderConfigs() {
  const list = byId('configList');
  if (!list) return;

  if (!cache.configs.length) {
    list.innerHTML = '<div class="empty-state">Nenhuma categoria de cobrança cadastrada.</div>';
    return;
  }

  list.innerHTML = cache.configs.map((item) => `
    <article class="card-item">
      <div class="card-item__header">
        <h3>${escapeHtml(item.category_name)}</h3>
        <div class="card-actions">
          <button type="button" data-action="config-edit" data-id="${item.id}">Editar</button>
          <button type="button" data-action="config-delete" data-id="${item.id}" class="danger">Excluir</button>
        </div>
      </div>
      <p><strong>Imóvel:</strong> ${escapeHtml(item.property_name || '—')}</p>
      <p><strong>Valor:</strong> ${escapeHtml(money(item.amount || 0))}</p>
      <p><strong>% administradora:</strong> ${escapeHtml(String(item.admin_fee_percent || 0))}%</p>
      <p><strong>Vence dia:</strong> ${escapeHtml(String(item.due_day || '—'))}</p>
      <p><strong>Ativa:</strong> ${Number(item.active) === 1 ? 'Sim' : 'Não'}</p>
    </article>
  `).join('');
}

function renderLaunches() {
  const list = byId('launchList');
  if (!list) return;

  if (!cache.launches.length) {
    list.innerHTML = '<div class="empty-state">Nenhum lançamento encontrado.</div>';
    return;
  }

  list.innerHTML = `
    <div class="table-scroll">
      <table class="data-table">
        <thead>
          <tr>
            <th>Imóvel</th>
            <th>Categoria</th>
            <th>Período do aluguel</th>
            <th>Vencimento</th>
            <th>Previsto</th>
            <th>% Adm.</th>
            <th>Status</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody>
          ${cache.launches.map((item) => {
            const payment = cache.payments.find((p) => Number(p.launch_id) === Number(item.id));
            const row = { ...item, ...(payment || {}) };
            const status = statusFromItem(row);

            return `
              <tr>
                <td>${escapeHtml(item.property_name || '—')}</td>
                <td>${escapeHtml(item.category_name || '—')}</td>
                <td>${escapeHtml(formatPeriod(item.competence_start, item.competence_end))}</td>
                <td>${escapeHtml(dateBR(item.due_date))}</td>
                <td>${escapeHtml(money(item.amount_expected || 0))}</td>
                <td>${escapeHtml(String(item.admin_fee_percent || 0))}%</td>
                <td>${statusTag(status)}</td>
                <td>
                  <div class="inline-actions">
                    <button type="button" data-action="launch-edit" data-id="${item.id}">Editar</button>
                    <button type="button" data-action="launch-delete" data-id="${item.id}" class="danger">Excluir</button>
                  </div>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function getFilteredPayments() {
  const search = (byId('paymentSearch')?.value || '').trim().toLowerCase();
  const month = byId('paymentCompetenceFilter')?.value || byId('paymentMonthFilter')?.value || '';
  const category = byId('paymentCategoryFilter')?.value || '';
  const account = byId('paymentAccountFilter')?.value || '';
  const method = byId('paymentMethodFilter')?.value || '';
  const statusFilter = byId('paymentStatusFilter')?.value || '';

  return cache.payments.filter((item) => {
    const status = statusFromItem(item);

    const text = [
      item.property_name,
      item.category_name,
      item.manager_name,
      item.payment_method_name,
      item.receiving_account_name,
      item.notes,
      formatPeriod(item.competence_start, item.competence_end)
    ].join(' ').toLowerCase();

    const matchesSearch = !search || text.includes(search);
    const matchesMonth =
      !month ||
      monthFromDate(item.competence_start) === month ||
      monthFromDate(item.competence_end) === month ||
      String(item.competence || '').slice(0, 7) === month;
    const matchesCategory = !category || item.category_name === category;
    const matchesAccount = !account || item.receiving_account_name === account;
    const matchesMethod = !method || item.payment_method_name === method;
    const matchesStatus = !statusFilter || status === statusFilter;

    return (
      matchesSearch &&
      matchesMonth &&
      matchesCategory &&
      matchesAccount &&
      matchesMethod &&
      matchesStatus
    );
  });
}

function renderPayments() {
  const list = byId('paymentList');
  if (!list) return;

  const items = getFilteredPayments();

  if (!items.length) {
    list.innerHTML = '<div class="empty-state">Nenhum pagamento encontrado.</div>';
    return;
  }

  list.innerHTML = `
    <div class="table-scroll">
      <table class="data-table">
        <thead>
          <tr>
            <th>Imóvel</th>
            <th>Categoria</th>
            <th>Período do aluguel</th>
            <th>Vencimento</th>
            <th>Previsto</th>
            <th>Multa</th>
            <th>Juros</th>
            <th>Recebido</th>
            <th>Taxa adm.</th>
            <th>Líquido</th>
            <th>Pagamento</th>
            <th>Status</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((item) => {
            const status = statusFromItem(item);
            const receiptLink = item.receipt_file_path
              ? `<a href="${escapeHtml(item.receipt_file_path)}" target="_blank" rel="noopener">Abrir recibo</a>`
              : 'Sem recibo';

            return `
              <tr>
                <td>${escapeHtml(item.property_name || '—')}</td>
                <td>${escapeHtml(item.category_name || '—')}</td>
                <td>${escapeHtml(formatPeriod(item.competence_start, item.competence_end))}</td>
                <td>${escapeHtml(dateBR(item.due_date))}</td>
                <td>${escapeHtml(money(item.amount_expected || 0))}</td>
                <td>${escapeHtml(money(item.fine_amount || 0))}</td>
                <td>${escapeHtml(money(item.interest_amount || 0))}</td>
                <td>${escapeHtml(money(item.received_amount || 0))}</td>
                <td>${escapeHtml(money(item.admin_fee_amount || 0))}</td>
                <td>${escapeHtml(money(item.net_received_amount || 0))}</td>
                <td>${escapeHtml(dateBR(item.payment_date))}</td>
                <td>${statusTag(status)}</td>
                <td>
                  <div class="inline-actions">
                    <button type="button" data-action="payment-edit" data-id="${item.id}">Editar</button>
                    <button type="button" data-action="payment-delete" data-id="${item.id}" class="danger">Excluir</button>
                    ${item.receipt_file_path ? `<button type="button" data-action="payment-receipt" data-id="${item.id}">Recibo</button>` : ''}
                  </div>
                  <div class="inline-note">${receiptLink}</div>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function getFilteredReportRows() {
  const propertyFilter = byId('reportPropertyFilter')?.value || '';
  const managerFilter = byId('reportManagerFilter')?.value || '';
  const categoryFilter = byId('reportCategoryFilter')?.value || '';
  const typeFilter = byId('reportTypeFilter')?.value || 'all';

  return (cache.reportRows || []).filter((row) => {
    const paid = !!row.payment_date || toNumber(row.received_amount) > 0;
    const status = statusFromItem(row);
    const includeType =
      typeFilter === 'all' ||
      (typeFilter === 'payments' && paid) ||
      (typeFilter === 'due' && !paid) ||
      (typeFilter === 'late' && status === 'Atrasado') ||
      (typeFilter === 'open' && status === 'Em aberto');

    const includeProperty = !propertyFilter || String(row.property_id) === String(propertyFilter);
    const includeManager = !managerFilter || String(row.manager_id) === String(managerFilter);
    const includeCategory = !categoryFilter || row.category_name === categoryFilter;

    return includeType && includeProperty && includeManager && includeCategory;
  });
}

function getReportTitle() {
  const typeFilter = byId('reportTypeFilter')?.value || 'all';
  const titles = {
    all: 'Relatório mensal',
    payments: 'Relatório de pagamentos',
    due: 'Relatório de vencimentos',
    late: 'Relatório de atrasados',
    open: 'Relatório em aberto'
  };
  return titles[typeFilter] || 'Relatório mensal';
}

function renderMonthlyReport() {
  const container = byId('reportList') || byId('reportTable') || byId('reportContainer');
  if (!container) return;

  const rows = getFilteredReportRows();

  const totals = rows.reduce(
    (acc, row) => {
      acc.expected += toNumber(row.amount_expected);
      acc.received += toNumber(row.received_amount);
      acc.adminFee += toNumber(row.admin_fee_amount);
      acc.net += toNumber(row.net_received_amount);
      return acc;
    },
    { expected: 0, received: 0, adminFee: 0, net: 0 }
  );

  if (!rows.length) {
    container.innerHTML = '<div class="empty-state">Nenhum registro encontrado para o relatório.</div>';
    return;
  }

  container.innerHTML = `
    <div class="report-summary">
      <div><strong>Total previsto:</strong> ${money(totals.expected)}</div>
      <div><strong>Total recebido:</strong> ${money(totals.received)}</div>
      <div><strong>Total taxa adm.:</strong> ${money(totals.adminFee)}</div>
      <div><strong>Total líquido:</strong> ${money(totals.net)}</div>
    </div>

    <div class="table-scroll">
      <table class="data-table report-print-table">
        <thead>
          <tr>
            <th>Administradora</th>
            <th>Imóvel</th>
            <th>Categoria</th>
            <th>Período do aluguel</th>
            <th>Vencimento</th>
            <th>Previsto</th>
            <th>Recebido</th>
            <th>Pagamento</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => {
            const status = statusFromItem(row);
            return `
              <tr>
                <td>${escapeHtml(row.manager_name || '—')}</td>
                <td>${escapeHtml(row.property_name || '—')}</td>
                <td>${escapeHtml(row.category_name || '—')}</td>
                <td>${escapeHtml(formatPeriod(row.competence_start, row.competence_end))}</td>
                <td>${escapeHtml(dateBR(row.due_date))}</td>
                <td>${escapeHtml(money(row.amount_expected || 0))}</td>
                <td>${escapeHtml(money(row.received_amount || 0))}</td>
                <td>${escapeHtml(dateBR(row.payment_date))}</td>
                <td>${statusTag(status)}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function syncPaymentPreview() {
  const form = byId('paymentForm');
  if (!form) return;

  const launchId = byId('paymentLaunchSelect')?.value || formField(form, 'launch_id')?.value;
  const launch = findLaunchById(launchId);

  const expectedInput = byId('paymentExpected') || formField(form, 'amount_expected');
  const dueDateInput = byId('paymentDueDate') || formField(form, 'due_date');
  const competenceInput = byId('paymentCompetence') || formField(form, 'competence_label');
  const periodStartInput = formField(form, 'rental_period_start');
  const periodEndInput = formField(form, 'rental_period_end');

  const fineInput = formField(form, 'fine_amount');
  const interestInput = formField(form, 'interest_amount');
  const receivedInput = formField(form, 'received_amount');
  const adminFeePercentInput = formField(form, 'admin_fee_percent');
  const adminFeeAmountInput = formField(form, 'admin_fee_amount');
  const netReceivedInput = formField(form, 'net_received_amount');

  if (launch) {
    if (expectedInput) expectedInput.value = round2(launch.amount_expected || 0).toFixed(2);
    if (dueDateInput) dueDateInput.value = normalizeDateOnly(launch.due_date || '');
    if (competenceInput) competenceInput.value = formatPeriod(launch.competence_start, launch.competence_end);
    if (periodStartInput && !periodStartInput.value) periodStartInput.value = normalizeDateOnly(launch.competence_start || '');
    if (periodEndInput && !periodEndInput.value) periodEndInput.value = normalizeDateOnly(launch.competence_end || '');
    if (adminFeePercentInput && !adminFeePercentInput.value) {
      adminFeePercentInput.value = round2(launch.admin_fee_percent || 0).toFixed(2);
    }
  } else {
    if (expectedInput) expectedInput.value = '';
    if (dueDateInput) dueDateInput.value = '';
    if (competenceInput) competenceInput.value = '';
  }

  const expected = toNumber(expectedInput?.value);
  const fine = toNumber(fineInput?.value);
  const interest = toNumber(interestInput?.value);
  const adminFeePercent = toNumber(adminFeePercentInput?.value || launch?.admin_fee_percent || 0);

  const received = receivedInput?.value !== '' ? toNumber(receivedInput.value) : round2(expected + fine + interest);
  const adminFeeAmount = round2((received * adminFeePercent) / 100);
  const netReceived = round2(received - adminFeeAmount);

  if (receivedInput && receivedInput.value === '') {
    receivedInput.value = received ? received.toFixed(2) : '';
  }
  if (adminFeeAmountInput) adminFeeAmountInput.value = adminFeeAmount.toFixed(2);
  if (netReceivedInput) netReceivedInput.value = netReceived.toFixed(2);
}

function fillTenantForm(item) {
  const form = byId('tenantForm');
  if (!form) return;
  formField(form, 'id').value = item.id || '';
  formField(form, 'name').value = item.name || '';
  formField(form, 'phone').value = item.phone || '';
  formField(form, 'email').value = item.email || '';
  formField(form, 'rental_period_start_br', 'tenantRentalStart').value = isoToBrInput(item.rental_period_start || '');
  formField(form, 'rental_period_end_br', 'tenantRentalEnd').value = isoToBrInput(item.rental_period_end || '');
  formField(form, 'notes').value = item.notes || '';
  switchScreen('tenants');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function fillManagerForm(item) {
  const form = byId('managerForm');
  if (!form) return;
  formField(form, 'id').value = item.id || '';
  formField(form, 'name').value = item.name || '';
  formField(form, 'phone').value = item.phone || '';
  formField(form, 'email').value = item.email || '';
  formField(form, 'notes').value = item.notes || '';
  switchScreen('managers');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function fillPropertyForm(item) {
  const form = byId('propertyForm');
  if (!form) return;
  formField(form, 'id').value = item.id || '';
  formField(form, 'name').value = item.name || '';
  formField(form, 'address').value = item.address || '';
  formField(form, 'tenant_id').value = item.tenant_id || '';
  formField(form, 'manager_id').value = item.manager_id || '';
  formField(form, 'rent_value').value = round2(item.rent_value || 0).toFixed(2);
  formField(form, 'notes').value = item.notes || '';
  switchScreen('properties');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function fillConfigForm(item) {
  const form = byId('configForm');
  if (!form) return;
  formField(form, 'id').value = item.id || '';
  formField(form, 'property_id').value = item.property_id || '';
  formField(form, 'category_name').value = item.category_name || '';
  formField(form, 'amount').value = round2(item.amount || 0).toFixed(2);
  formField(form, 'admin_fee_percent').value = round2(item.admin_fee_percent || 0).toFixed(2);
  formField(form, 'due_day').value = item.due_day || '';
  const activeField = formField(form, 'active');
  if (activeField) activeField.value = Number(item.active) === 1 ? '1' : '0';
  switchScreen('configs');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function editLaunch(id) {
  const item = cache.launches.find((row) => Number(row.id) === Number(id));
  if (!item) return;

  const propertyMsg = cache.properties.map((p) => `${p.id} - ${p.name}`).join('\n') || 'Nenhum imóvel disponível';
  const configMsg = cache.configs
    .filter((c) => Number(c.property_id) === Number(item.property_id))
    .map((c) => `${c.id} - ${c.category_name}`)
    .join('\n') || 'Sem categoria vinculada';

  const propertyId = prompt(`ID do imóvel:\n${propertyMsg}`, String(item.property_id || ''));
  if (propertyId === null) return;

  const configId = prompt(`ID da categoria de cobrança (opcional):\n${configMsg}`, item.config_id ? String(item.config_id) : '');
  if (configId === null) return;

  const categoryName = prompt('Categoria:', item.category_name || '');
  if (categoryName === null) return;

  const competenceStart = prompt(
    'Início do período do aluguel (AAAA-MM-DD):',
    normalizeDateOnly(item.competence_start || firstDayOfMonth(item.competence || currentMonth()))
  );
  if (competenceStart === null) return;

  const competenceEnd = prompt(
    'Fim do período do aluguel (AAAA-MM-DD):',
    normalizeDateOnly(item.competence_end || lastDayOfDateMonth(competenceStart))
  );
  if (competenceEnd === null) return;

  const dueDate = prompt(
    'Vencimento (AAAA-MM-DD):',
    normalizeDateOnly(item.due_date || `${nextMonth(monthFromDate(competenceStart))}-05`)
  );
  if (dueDate === null) return;

  const amountExpected = prompt('Valor previsto:', String(round2(item.amount_expected || 0).toFixed(2)));
  if (amountExpected === null) return;

  const adminFeePercent = prompt('% administradora:', String(round2(item.admin_fee_percent || 0).toFixed(2)));
  if (adminFeePercent === null) return;

  const notes = prompt('Observações:', item.notes || '');
  if (notes === null) return;

  const payload = {
    property_id: Number(propertyId) || null,
    config_id: configId ? Number(configId) : null,
    category_name: categoryName.trim(),
    competence: monthFromDate(competenceStart),
    competence_start: competenceStart,
    competence_end: competenceEnd,
    due_date: dueDate,
    amount_expected: round2(toNumber(amountExpected)),
    admin_fee_percent: round2(toNumber(adminFeePercent)),
    notes
  };

  await api(`/api/launches/${item.id}`, { method: 'PUT', body: payload });
  await refreshAll();
  alert('Lançamento atualizado com sucesso.');
}

function fillPaymentForm(item) {
  const form = byId('paymentForm');
  if (!form) return;

  formField(form, 'id').value = item.id || '';
  const launchSelect = byId('paymentLaunchSelect') || formField(form, 'launch_id');
  if (launchSelect) launchSelect.value = item.launch_id || '';

  formField(form, 'fine_amount').value = round2(item.fine_amount || 0).toFixed(2);
  formField(form, 'interest_amount').value = round2(item.interest_amount || 0).toFixed(2);
  formField(form, 'received_amount').value = round2(item.received_amount || 0).toFixed(2);
  formField(form, 'payment_date').value = normalizeDateOnly(item.payment_date || '');
  formField(form, 'payment_method_id').value = item.payment_method_id || '';
  formField(form, 'receiving_account_id').value = item.receiving_account_id || '';
  formField(form, 'rental_period_start').value = normalizeDateOnly(item.rental_period_start || item.competence_start || '');
  formField(form, 'rental_period_end').value = normalizeDateOnly(item.rental_period_end || item.competence_end || '');
  formField(form, 'admin_fee_percent').value = round2(item.admin_fee_percent || 0).toFixed(2);
  formField(form, 'admin_fee_amount').value = round2(item.admin_fee_amount || 0).toFixed(2);
  formField(form, 'net_received_amount').value = round2(item.net_received_amount || 0).toFixed(2);
  formField(form, 'notes').value = item.notes || '';

  syncPaymentPreview();
  switchScreen('payments');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function clearPaymentForm() {
  const form = byId('paymentForm');
  if (!form) return;
  resetForm(form);

  const previewFields = ['paymentExpected', 'paymentDueDate', 'paymentCompetence'];
  previewFields.forEach((id) => {
    const field = byId(id);
    if (field) field.value = '';
  });

  syncPaymentPreview();
}

async function loadDashboard() {
  const month = byId('dashboardMonth')?.value || currentMonth();
  const managerId = byId('dashboardManagerFilter')?.value || '';
  const params = new URLSearchParams({ month });
  if (managerId) params.set('manager_id', managerId);

  const result = await api(`/api/dashboard?${params.toString()}`);
  const items = normalizeArray(result?.items || []);
  const summary = computeDashboardSummary(items);

  cache.dashboard = {
    summary: normalizeRecord(summary),
    items
  };

  renderDashboard();
}

async function loadReferenceLists() {
  const [tenants, managers, properties, configs, methods, accounts] = await Promise.all([
    api('/api/tenants'),
    api('/api/managers'),
    api('/api/properties'),
    api('/api/category-configs'),
    api('/api/payment-methods'),
    api('/api/receiving-accounts')
  ]);

  cache.tenants = normalizeArray(tenants);
  cache.managers = normalizeArray(managers);
  cache.properties = normalizeArray(properties);
  cache.configs = normalizeArray(configs);
  cache.methods = normalizeArray(methods);
  cache.accounts = normalizeArray(accounts);

  renderTenants();
  renderManagers();
  renderProperties();
  renderConfigs();
  refreshAllSelects();
}

async function loadLaunches() {
  const month = byId('launchMonth')?.value || currentMonth();
  const params = new URLSearchParams({ month });
  const items = await api(`/api/launches?${params.toString()}`);
  cache.launches = normalizeArray(items);
  renderLaunches();
  refreshAllSelects();
}

async function loadPayments() {
  const items = await api('/api/payments');
  cache.payments = normalizeArray(items);
  renderPayments();
}

async function loadReport() {
  const reportMonth = byId('reportMonth')?.value || byId('dashboardMonth')?.value || currentMonth();
  const managerId = byId('reportManagerFilter')?.value || '';
  const params = new URLSearchParams({ month: reportMonth });
  if (managerId) params.set('manager_id', managerId);

  try {
    const result = await api(`/api/reports/monthly?${params.toString()}`);
    cache.reportRows = normalizeArray(result?.rows || []);
  } catch (_) {
    cache.reportRows = [];
  }

  refreshAllSelects();
  renderMonthlyReport();
}

async function refreshAll() {
  await loadReferenceLists();
  await Promise.all([
    loadDashboard(),
    loadLaunches(),
    loadPayments(),
    loadReport()
  ]);
  syncPaymentPreview();
}

function buildPaymentPayload(form) {
  const launchId = Number((byId('paymentLaunchSelect')?.value || formField(form, 'launch_id')?.value || 0));
  const launch = findLaunchById(launchId);

  const fineAmount = round2(toNumber(formField(form, 'fine_amount')?.value));
  const interestAmount = round2(toNumber(formField(form, 'interest_amount')?.value));
  const expectedValue = round2(
    toNumber((byId('paymentExpected') || formField(form, 'amount_expected'))?.value || launch?.amount_expected || 0)
  );

  let receivedAmount = round2(toNumber(formField(form, 'received_amount')?.value));
  if (!receivedAmount) {
    receivedAmount = round2(expectedValue + fineAmount + interestAmount);
  }

  const adminFeePercent = round2(
    toNumber(formField(form, 'admin_fee_percent')?.value || launch?.admin_fee_percent || 0)
  );
  const adminFeeAmount = round2((receivedAmount * adminFeePercent) / 100);
  const netReceivedAmount = round2(receivedAmount - adminFeeAmount);

  const rentalPeriodStart =
    normalizeDateOnly(formField(form, 'rental_period_start')?.value) ||
    normalizeDateOnly(launch?.competence_start) ||
    firstDayOfMonth(launch?.competence || currentMonth());

  const rentalPeriodEnd =
    normalizeDateOnly(formField(form, 'rental_period_end')?.value) ||
    normalizeDateOnly(launch?.competence_end) ||
    lastDayOfDateMonth(rentalPeriodStart);

  const payload = {
    launch_id: launchId,
    received_amount: receivedAmount,
    fine_amount: fineAmount,
    interest_amount: interestAmount,
    admin_fee_percent: adminFeePercent,
    admin_fee_amount: adminFeeAmount,
    net_received_amount: netReceivedAmount,
    payment_date: normalizeDateOnly(formField(form, 'payment_date')?.value) || null,
    payment_method_id: Number(formField(form, 'payment_method_id')?.value || 0) || null,
    receiving_account_id: Number(formField(form, 'receiving_account_id')?.value || 0) || null,
    rental_period_start: rentalPeriodStart || null,
    rental_period_end: rentalPeriodEnd || null,
    notes: formField(form, 'notes')?.value || ''
  };

  const adminFeeAmountInput = formField(form, 'admin_fee_amount');
  const netReceivedInput = formField(form, 'net_received_amount');

  if (adminFeeAmountInput) adminFeeAmountInput.value = adminFeeAmount.toFixed(2);
  if (netReceivedInput) netReceivedInput.value = netReceivedAmount.toFixed(2);

  return payload;
}

function downloadJsonBackup(data) {
  const fileName = `backup-imoveis-em-dia-${currentDate()}.json`;
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json;charset=utf-8'
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function buildImportSummary(counts = {}) {
  return [
    'Backup restaurado com sucesso:',
    `• Inquilinos: ${counts.tenants || 0}`,
    `• Administradoras: ${counts.managers || 0}`,
    `• Imóveis: ${counts.properties || 0}`,
    `• Categorias: ${counts.category_configs || 0}`,
    `• Lançamentos: ${counts.launches || 0}`,
    `• Pagamentos: ${counts.payments || 0}`,
    `• Meios de pagamento: ${counts.payment_methods || 0}`,
    `• Contas de recebimento: ${counts.receiving_accounts || 0}`
  ].join('\n');
}

function exportReportCsv() {
  const rows = getFilteredReportRows();
  if (!rows.length) {
    alert('Não há dados para exportar.');
    return;
  }

  const headers = [
    'Administradora',
    'Imóvel',
    'Categoria',
    'Período início',
    'Período fim',
    'Vencimento',
    'Valor previsto',
    'Valor recebido',
    'Data pagamento',
    'Status'
  ];

  const lines = [headers.join(';')];

  rows.forEach((row) => {
    lines.push(
      [
        row.manager_name || '',
        row.property_name || '',
        row.category_name || '',
        normalizeDateOnly(row.competence_start || ''),
        normalizeDateOnly(row.competence_end || ''),
        normalizeDateOnly(row.due_date || ''),
        round2(row.amount_expected || 0).toFixed(2),
        round2(row.received_amount || 0).toFixed(2),
        normalizeDateOnly(row.payment_date || ''),
        statusFromItem(row)
      ]
        .map((value) => `"${String(value).replaceAll('"', '""')}"`)
        .join(';')
    );
  });

  const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const reportType = byId('reportTypeFilter')?.value || 'all';
  link.download = `relatorio-${reportType}-${byId('reportMonth')?.value || currentMonth()}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function printReport() {
  const area = byId('reportList') || byId('reportTable') || byId('reportContainer');
  if (!area || !area.innerHTML.trim()) {
    alert('Não há relatório para imprimir.');
    return;
  }

  const win = window.open('', '_blank');
  if (!win) {
    alert('Não foi possível abrir a janela de impressão.');
    return;
  }

  win.document.write(`
    <html>
      <head>
        <title>${getReportTitle()}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 24px; color: #222; }
          h1 { margin-bottom: 16px; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; }
          th, td { border: 1px solid #ccc; padding: 8px; text-align: left; }
          th { background: #f4f4f4; }
          .status-badge { padding: 2px 8px; border-radius: 999px; font-size: 11px; }
          .status-badge.success { background: #d1fae5; color: #065f46; }
          .status-badge.warning { background: #fef3c7; color: #92400e; }
          .status-badge.danger { background: #fee2e2; color: #991b1b; }
          .status-badge.muted { background: #e5e7eb; color: #374151; }
          .report-summary { display: grid; gap: 6px; margin-bottom: 16px; }
        </style>
      </head>
      <body>
        <h1>${getReportTitle()}</h1>
        ${area.innerHTML}
      </body>
    </html>
  `);

  win.document.close();
  win.focus();
  win.print();
}

async function submitNewLookup(kind, name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return null;

  const endpoint = kind === 'method' ? '/api/payment-methods' : '/api/receiving-accounts';
  const result = await api(endpoint, {
    method: 'POST',
    body: { name: trimmed }
  });

  if (kind === 'method') {
    cache.methods.push(normalizeRecord(result));
  } else {
    cache.accounts.push(normalizeRecord(result));
  }

  refreshAllSelects();
  return normalizeRecord(result);
}

async function handleAuthLogin(event) {
  event.preventDefault();
  setAuthMessage('');

  const form = event.currentTarget;
  const email = formField(form, 'email', 'loginEmail')?.value?.trim();
  const password = formField(form, 'password', 'loginPassword')?.value || '';

  try {
    const result = await api('/api/auth/login', {
      method: 'POST',
      body: { email, password }
    });

    setSession(result.token, result.user);
    showApp(true);
    await refreshAll();
    switchScreen('dashboard');
  } catch (error) {
    setAuthMessage(error.message || 'Não foi possível entrar.');
  }
}

async function handleAuthRegister(event) {
  event.preventDefault();
  setAuthMessage('');

  const form = event.currentTarget;
  const name = formField(form, 'name', 'registerName')?.value?.trim();
  const email = formField(form, 'email', 'registerEmail')?.value?.trim();
  const password = formField(form, 'password', 'registerPassword')?.value || '';

  try {
    await api('/api/auth/register', {
      method: 'POST',
      body: { name, email, password }
    });

    setAuthMessage('Cadastro realizado. Agora faça o login.', 'success');
    switchTab('login');
    form.reset();
  } catch (error) {
    setAuthMessage(error.message || 'Não foi possível cadastrar.');
  }
}

async function handleTenantSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const id = formField(form, 'id')?.value;

  const rentalPeriodStart = brDateToIso(formField(form, 'rental_period_start_br', 'tenantRentalStart')?.value || '');
  const rentalPeriodEnd = brDateToIso(formField(form, 'rental_period_end_br', 'tenantRentalEnd')?.value || '');

  if ((formField(form, 'rental_period_start_br', 'tenantRentalStart')?.value || '').trim() && !rentalPeriodStart) {
    alert('Informe o início do período do aluguel no formato DD/MM/AAAA.');
    return;
  }

  if ((formField(form, 'rental_period_end_br', 'tenantRentalEnd')?.value || '').trim() && !rentalPeriodEnd) {
    alert('Informe o fim do período do aluguel no formato DD/MM/AAAA.');
    return;
  }

  const payload = {
    name: formField(form, 'name')?.value?.trim(),
    phone: formField(form, 'phone')?.value?.trim() || null,
    email: formField(form, 'email')?.value?.trim() || null,
    rental_period_start: rentalPeriodStart || null,
    rental_period_end: rentalPeriodEnd || null,
    notes: formField(form, 'notes')?.value?.trim() || null
  };

  await api(id ? `/api/tenants/${id}` : '/api/tenants', {
    method: id ? 'PUT' : 'POST',
    body: payload
  });

  resetForm(form);
  await refreshAll();
}

async function handleManagerSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const id = formField(form, 'id')?.value;

  const payload = {
    name: formField(form, 'name')?.value?.trim(),
    phone: formField(form, 'phone')?.value?.trim() || null,
    email: formField(form, 'email')?.value?.trim() || null,
    notes: formField(form, 'notes')?.value?.trim() || null
  };

  await api(id ? `/api/managers/${id}` : '/api/managers', {
    method: id ? 'PUT' : 'POST',
    body: payload
  });

  resetForm(form);
  await refreshAll();
}

async function handlePropertySubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const id = formField(form, 'id')?.value;

  const payload = {
    name: formField(form, 'name')?.value?.trim(),
    address: formField(form, 'address')?.value?.trim() || null,
    tenant_id: Number(formField(form, 'tenant_id')?.value || 0) || null,
    manager_id: Number(formField(form, 'manager_id')?.value || 0) || null,
    rent_value: round2(toNumber(formField(form, 'rent_value')?.value)),
    notes: formField(form, 'notes')?.value?.trim() || null
  };

  await api(id ? `/api/properties/${id}` : '/api/properties', {
    method: id ? 'PUT' : 'POST',
    body: payload
  });

  resetForm(form);
  await refreshAll();
}

async function handleConfigSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const id = formField(form, 'id')?.value;

  const payload = {
    property_id: Number(formField(form, 'property_id')?.value || 0),
    category_name: formField(form, 'category_name')?.value?.trim(),
    amount: round2(toNumber(formField(form, 'amount')?.value)),
    admin_fee_percent: round2(toNumber(formField(form, 'admin_fee_percent')?.value)),
    due_day: Number(formField(form, 'due_day')?.value || 0),
    active: Number(formField(form, 'active')?.value || 1)
  };

  await api(id ? `/api/category-configs/${id}` : '/api/category-configs', {
    method: id ? 'PUT' : 'POST',
    body: payload
  });

  resetForm(form);
  await refreshAll();
}

async function handleGenerateLaunches() {
  const month = byId('launchMonth')?.value || currentMonth();

  await api('/api/launches/generate', {
    method: 'POST',
    body: { month }
  });

  await refreshAll();
  alert(`Lançamentos gerados para ${monthBR(month)}.`);
}

async function handlePaymentSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const id = formField(form, 'id')?.value;

  const newMethodName = formField(form, 'new_payment_method', 'newPaymentMethod')?.value?.trim();
  const newAccountName = formField(form, 'new_receiving_account', 'newReceivingAccount')?.value?.trim();

  if (newMethodName) {
    const created = await submitNewLookup('method', newMethodName);
    if (created) formField(form, 'payment_method_id').value = created.id;
    const field = formField(form, 'new_payment_method', 'newPaymentMethod');
    if (field) field.value = '';
  }

  if (newAccountName) {
    const created = await submitNewLookup('account', newAccountName);
    if (created) formField(form, 'receiving_account_id').value = created.id;
    const field = formField(form, 'new_receiving_account', 'newReceivingAccount');
    if (field) field.value = '';
  }

  const payload = buildPaymentPayload(form);

  if (!payload.launch_id) {
    alert('Selecione um lançamento.');
    return;
  }

  const result = await api(id ? `/api/payments/${id}` : '/api/payments', {
    method: id ? 'PUT' : 'POST',
    body: payload
  });

  const receiptInput = formField(form, 'receipt', 'paymentReceipt');
  const receipt = receiptInput?.files?.[0];

  if (receipt && result?.id) {
    const fd = new FormData();
    fd.append('receipt', receipt);

    await api(`/api/payments/${result.id}/receipt`, {
      method: 'POST',
      body: fd
    });
  }

  clearPaymentForm();
  await refreshAll();
}

async function handleBackupExport() {
  const data = await api('/api/backup/export');
  downloadJsonBackup(data);
}

async function handleBackupImport(file) {
  const text = await file.text();
  const parsed = JSON.parse(text);

  const ok = window.confirm('A restauração vai substituir os dados atuais da sua conta.\n\nDeseja continuar?');
  if (!ok) return;

  const result = await api('/api/backup/import', {
    method: 'POST',
    body: parsed
  });

  await refreshAll();
  alert(buildImportSummary(result?.counts || {}));
}

async function handleDelete(endpoint, label) {
  const ok = window.confirm(`Tem certeza que deseja excluir ${label}?`);
  if (!ok) return;
  await api(endpoint, { method: 'DELETE' });
  await refreshAll();
}

function bindStaticEvents() {
  byId('loginTab')?.addEventListener('click', () => switchTab('login'));
  byId('registerTab')?.addEventListener('click', () => switchTab('register'));

  byId('loginForm')?.addEventListener('submit', handleAuthLogin);
  byId('registerForm')?.addEventListener('submit', handleAuthRegister);

  byId('logoutBtn')?.addEventListener('click', () => {
    clearSession();
    showApp(false);
    switchTab('login');
  });


  $$('[data-screen]').forEach((btn) => {
    btn.addEventListener('click', () => switchScreen(btn.dataset.screen));
  });

  byId('tenantForm')?.addEventListener('submit', (event) => {
    handleTenantSubmit(event).catch((error) => alert(error.message || 'Erro ao salvar inquilino.'));
  });

  byId('managerForm')?.addEventListener('submit', (event) => {
    handleManagerSubmit(event).catch((error) => alert(error.message || 'Erro ao salvar administradora.'));
  });

  byId('propertyForm')?.addEventListener('submit', (event) => {
    handlePropertySubmit(event).catch((error) => alert(error.message || 'Erro ao salvar imóvel.'));
  });

  byId('configForm')?.addEventListener('submit', (event) => {
    handleConfigSubmit(event).catch((error) => alert(error.message || 'Erro ao salvar categoria.'));
  });

  byId('generateLaunchesBtn')?.addEventListener('click', () => {
    handleGenerateLaunches().catch((error) => alert(error.message || 'Erro ao gerar lançamentos.'));
  });

  byId('refreshLaunchesBtn')?.addEventListener('click', () => {
    loadLaunches().catch((error) => alert(error.message || 'Erro ao atualizar lançamentos.'));
  });

  byId('paymentForm')?.addEventListener('submit', (event) => {
    handlePaymentSubmit(event).catch((error) => alert(error.message || 'Erro ao salvar pagamento.'));
  });

  byId('cancelPaymentEdit')?.addEventListener('click', () => clearPaymentForm());

  [
    byId('paymentLaunchSelect'),
    formField(byId('paymentForm'), 'fine_amount'),
    formField(byId('paymentForm'), 'interest_amount'),
    formField(byId('paymentForm'), 'received_amount'),
    formField(byId('paymentForm'), 'admin_fee_percent')
  ]
    .filter(Boolean)
    .forEach((field) => {
      field.addEventListener('input', syncPaymentPreview);
      field.addEventListener('change', syncPaymentPreview);
    });

  byId('dashboardMonth')?.addEventListener('change', () => {
    loadDashboard().catch((error) => alert(error.message || 'Erro ao carregar painel.'));
  });

  byId('dashboardManagerFilter')?.addEventListener('change', () => {
    loadDashboard().catch((error) => alert(error.message || 'Erro ao carregar painel.'));
  });

  byId('refreshDashboardBtn')?.addEventListener('click', () => {
    loadDashboard().catch((error) => alert(error.message || 'Erro ao carregar painel.'));
  });

  byId('paymentSearch')?.addEventListener('input', renderPayments);
  byId('paymentCompetenceFilter')?.addEventListener('change', renderPayments);
  byId('paymentMonthFilter')?.addEventListener('change', renderPayments);
  byId('paymentCategoryFilter')?.addEventListener('change', renderPayments);
  byId('paymentAccountFilter')?.addEventListener('change', renderPayments);
  byId('paymentMethodFilter')?.addEventListener('change', renderPayments);
  byId('paymentStatusFilter')?.addEventListener('change', renderPayments);

  byId('backupExportBtn')?.addEventListener('click', () => {
    handleBackupExport().catch((error) => alert(error.message || 'Erro ao exportar backup.'));
  });

  byId('backupImportBtn')?.addEventListener('click', () => {
    byId('backupImportFile')?.click();
  });

  byId('backupImportFile')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      await handleBackupImport(file);
    } catch (error) {
      alert(error.message || 'Erro ao importar backup.');
    } finally {
      event.target.value = '';
    }
  });

  byId('reportMonth')?.addEventListener('change', () => {
    loadReport().catch((error) => alert(error.message || 'Erro ao carregar relatório.'));
  });

  byId('reportManagerFilter')?.addEventListener('change', () => {
    loadReport().catch((error) => alert(error.message || 'Erro ao carregar relatório.'));
  });

  byId('reportPropertyFilter')?.addEventListener('change', renderMonthlyReport);
  byId('reportCategoryFilter')?.addEventListener('change', renderMonthlyReport);
  byId('reportTypeFilter')?.addEventListener('change', renderMonthlyReport);

  byId('refreshReportBtn')?.addEventListener('click', () => {
    loadReport().catch((error) => alert(error.message || 'Erro ao atualizar relatório.'));
  });

  byId('exportReportBtn')?.addEventListener('click', exportReportCsv);
  byId('printReportBtn')?.addEventListener('click', printReport);
}

function bindDelegatedActions() {
  document.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-action]');
    if (!btn) return;

    const id = Number(btn.dataset.id || 0);
    const action = btn.dataset.action;

    const run = async () => {
      switch (action) {
        case 'tenant-edit': {
          const item = cache.tenants.find((row) => Number(row.id) === id);
          if (item) fillTenantForm(item);
          break;
        }
        case 'tenant-delete':
          await handleDelete(`/api/tenants/${id}`, 'este inquilino');
          break;

        case 'manager-edit': {
          const item = cache.managers.find((row) => Number(row.id) === id);
          if (item) fillManagerForm(item);
          break;
        }
        case 'manager-delete':
          await handleDelete(`/api/managers/${id}`, 'esta administradora');
          break;

        case 'property-edit': {
          const item = cache.properties.find((row) => Number(row.id) === id);
          if (item) fillPropertyForm(item);
          break;
        }
        case 'property-delete':
          await handleDelete(`/api/properties/${id}`, 'este imóvel');
          break;

        case 'config-edit': {
          const item = cache.configs.find((row) => Number(row.id) === id);
          if (item) fillConfigForm(item);
          break;
        }
        case 'config-delete':
          await handleDelete(`/api/category-configs/${id}`, 'esta categoria');
          break;

        case 'launch-edit': {
          await editLaunch(id);
          break;
        }
        case 'launch-delete':
          await handleDelete(`/api/launches/${id}`, 'este lançamento');
          break;

        case 'payment-edit': {
          const item = findPaymentById(id);
          if (item) fillPaymentForm(item);
          break;
        }
        case 'payment-delete':
          await handleDelete(`/api/payments/${id}`, 'este pagamento');
          break;

        case 'payment-receipt': {
          const item = findPaymentById(id);
          if (item?.receipt_file_path) {
            window.open(item.receipt_file_path, '_blank', 'noopener');
          } else {
            alert('Este pagamento não possui recibo anexado.');
          }
          break;
        }

        default:
          break;
      }
    };

    run().catch((error) => {
      console.error(error);
      alert(error.message || 'Erro ao executar ação.');
    });
  });
}

async function bootFromSession() {
  fillMonthDefaults();
  bindStaticEvents();
  bindDelegatedActions();

  const token = getToken();
  if (!token) {
    showApp(false);
    switchTab('login');
    return;
  }

  try {
    showApp(true);
    await refreshAll();
    switchScreen('dashboard');
  } catch (error) {
    console.error(error);
    clearSession();
    showApp(false);
    switchTab('login');
    setAuthMessage(error.message || 'Sua sessão expirou. Faça login novamente.');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  bootFromSession().catch((error) => {
    console.error(error);
    showApp(false);
    switchTab('login');
    setAuthMessage(error.message || 'Erro ao iniciar aplicação.');
  });
});
