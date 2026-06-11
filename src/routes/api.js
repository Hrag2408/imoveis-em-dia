const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { pool, all, get, run } = require('../config/db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();
router.use(authRequired);

const uploadsRoot = path.resolve(process.env.UPLOAD_ROOT || path.join(process.cwd(), 'uploads'));
const receiptsDir = path.resolve(process.env.UPLOAD_DIR || path.join(uploadsRoot, 'receipts'));
fs.mkdirSync(receiptsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, receiptsDir),
  filename: (req, file, cb) => {
    const safeName = String(file.originalname || 'recibo')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}-${safeName}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const mime = String(file.mimetype || '');
    const isPdf = mime === 'application/pdf';
    const isImage = mime.startsWith('image/');
    if (isPdf || isImage) return cb(null, true);
    return cb(new Error('Envie apenas PDF ou imagem para o recibo.'));
  }
});

function parseId(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function toNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const normalized = String(value).replace(/\./g, '').replace(',', '.');
  const num = Number(normalized);
  return Number.isFinite(num) ? num : fallback;
}

function round2(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function requireFields(res, fields, body) {
  const missing = fields.filter((field) => body[field] === undefined || body[field] === null || body[field] === '');
  if (!missing.length) return false;
  res.status(400).json({ error: `Campos obrigatórios: ${missing.join(', ')}` });
  return true;
}

async function ensureOwnershipOr404(res, table, id, userId) {
  const row = await get(`SELECT * FROM ${table} WHERE id=? AND user_id=?`, [id, userId]);
  if (!row) {
    res.status(404).json({ error: 'Registro não encontrado.' });
    return null;
  }
  return row;
}

function ymd(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function firstDayOfMonth(month) {
  return `${month}-01`;
}

function lastDayOfMonth(month) {
  const [year, monthNum] = String(month).split('-').map(Number);
  const last = new Date(year, monthNum, 0);
  return `${year}-${String(monthNum).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`;
}

function nextMonth(month) {
  const [year, monthNum] = String(month).split('-').map(Number);
  const dt = new Date(year, monthNum, 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
}

function buildDueDate(competenceMonth, dueDay) {
  const targetMonth = nextMonth(competenceMonth);
  const [year, monthNum] = targetMonth.split('-').map(Number);
  const last = new Date(year, monthNum, 0).getDate();
  const safeDay = Math.min(Math.max(Number(dueDay || 1), 1), last);
  return `${year}-${String(monthNum).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`;
}

function normalizePeriod(month, start, end) {
  const competence = month || String(start || '').slice(0, 7);
  const competenceStart = start || firstDayOfMonth(competence);
  const competenceEnd = end || lastDayOfMonth(competence);
  return {
    competence,
    competence_start: competenceStart,
    competence_end: competenceEnd
  };
}

function computePaymentValues(launch, payload = {}) {
  const expected = round2(toNumber(payload.received_amount, toNumber(launch.amount_expected)));
  const fine = round2(toNumber(payload.fine_amount));
  const interest = round2(toNumber(payload.interest_amount));
  const adminFeePercent = round2(
    toNumber(payload.admin_fee_percent, toNumber(launch.admin_fee_percent))
  );

  const received = round2(
    payload.received_amount === undefined || payload.received_amount === null || payload.received_amount === ''
      ? toNumber(launch.amount_expected) + fine + interest
      : expected
  );

  const adminFeeAmount = round2(
    payload.admin_fee_amount === undefined || payload.admin_fee_amount === null || payload.admin_fee_amount === ''
      ? (received * adminFeePercent) / 100
      : toNumber(payload.admin_fee_amount)
  );

  const netReceivedAmount = round2(
    payload.net_received_amount === undefined || payload.net_received_amount === null || payload.net_received_amount === ''
      ? received - adminFeeAmount
      : toNumber(payload.net_received_amount)
  );

  return {
    fine_amount: fine,
    interest_amount: interest,
    admin_fee_percent: adminFeePercent,
    received_amount: received,
    admin_fee_amount: adminFeeAmount,
    net_received_amount: netReceivedAmount
  };
}

async function exportUserData(userId) {
  const [
    tenants,
    managers,
    payment_methods,
    receiving_accounts,
    properties,
    category_configs,
    launches,
    payments
  ] = await Promise.all([
    all('SELECT * FROM tenants WHERE user_id=? ORDER BY id', [userId]),
    all('SELECT * FROM managers WHERE user_id=? ORDER BY id', [userId]),
    all('SELECT * FROM payment_methods WHERE user_id=? ORDER BY id', [userId]),
    all('SELECT * FROM receiving_accounts WHERE user_id=? ORDER BY id', [userId]),
    all('SELECT * FROM properties WHERE user_id=? ORDER BY id', [userId]),
    all('SELECT * FROM category_configs WHERE user_id=? ORDER BY id', [userId]),
    all('SELECT * FROM launches WHERE user_id=? ORDER BY id', [userId]),
    all('SELECT * FROM payments WHERE user_id=? ORDER BY id', [userId])
  ]);

  return {
    tenants,
    managers,
    payment_methods,
    receiving_accounts,
    properties,
    category_configs,
    launches,
    payments
  };
}

function normalizeBackupPayload(body) {
  if (body && body.data && typeof body.data === 'object') return body.data;
  return body || {};
}

/* =========================
   DASHBOARD
========================= */

router.get('/dashboard', async (req, res, next) => {
  try {
    const month = String(req.query.month || '').trim();
    const managerId = parseId(req.query.manager_id);

    if (!month) {
      return res.status(400).json({ error: 'month é obrigatório no formato AAAA-MM.' });
    }

    let sql = `
      SELECT
        l.*,
        p.name AS property_name,
        p.manager_id,
        m.name AS manager_name,
        t.name AS tenant_name,
        pay.id AS payment_id,
        pay.received_amount,
        pay.payment_date,
        pay.fine_amount,
        pay.interest_amount,
        pay.admin_fee_amount,
        pay.net_received_amount
      FROM launches l
      JOIN properties p ON p.id = l.property_id
      LEFT JOIN managers m ON m.id = p.manager_id
      LEFT JOIN tenants t ON t.id = p.tenant_id
      LEFT JOIN payments pay ON pay.launch_id = l.id
      WHERE l.user_id = ? AND l.competence = ?
    `;

    const params = [req.user.id, month];

    if (managerId) {
      sql += ' AND p.manager_id = ?';
      params.push(managerId);
    }

    sql += ' ORDER BY l.due_date, p.name, l.category_name';

    const items = await all(sql, params);
    const today = ymd(new Date());

    const summary = items.reduce(
      (acc, item) => {
        const expected = toNumber(item.amount_expected);
        const received = toNumber(item.received_amount);
        const status = item.payment_id
          ? (received >= expected ? 'Pago' : 'Pago parcial')
          : (item.due_date && item.due_date < today ? 'Atrasado' : 'Em aberto');

        acc.total_expected += expected;
        acc.total_received += received;
        if (status === 'Atrasado') acc.late_count += 1;
        if (status === 'Em aberto' || status === 'Atrasado') acc.open_count += 1;

        return acc;
      },
      { total_expected: 0, total_received: 0, open_count: 0, late_count: 0 }
    );

    summary.total_expected = round2(summary.total_expected);
    summary.total_received = round2(summary.total_received);

    res.json({ summary, items });
  } catch (error) {
    next(error);
  }
});

/* =========================
   TENANTS
========================= */

router.get('/tenants', async (req, res, next) => {
  try {
    const rows = await all('SELECT * FROM tenants WHERE user_id=? ORDER BY name, id', [req.user.id]);
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

router.post('/tenants', async (req, res, next) => {
  try {
    if (requireFields(res, ['name'], req.body)) return;

    const result = await run(
      'INSERT INTO tenants (user_id, name, phone, email, notes) VALUES (?, ?, ?, ?, ?)',
      [
        req.user.id,
        String(req.body.name).trim(),
        req.body.phone || null,
        req.body.email || null,
        req.body.notes || null
      ]
    );

    const row = await get('SELECT * FROM tenants WHERE id=?', [result.id]);
    res.status(201).json(row);
  } catch (error) {
    next(error);
  }
});

router.put('/tenants/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const current = await ensureOwnershipOr404(res, 'tenants', id, req.user.id);
    if (!current) return;
    if (requireFields(res, ['name'], req.body)) return;

    await run(
      'UPDATE tenants SET name=?, phone=?, email=?, notes=? WHERE id=? AND user_id=?',
      [
        String(req.body.name).trim(),
        req.body.phone || null,
        req.body.email || null,
        req.body.notes || null,
        id,
        req.user.id
      ]
    );

    const row = await get('SELECT * FROM tenants WHERE id=?', [id]);
    res.json(row);
  } catch (error) {
    next(error);
  }
});

router.delete('/tenants/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const current = await ensureOwnershipOr404(res, 'tenants', id, req.user.id);
    if (!current) return;

    await run('UPDATE properties SET tenant_id=NULL WHERE tenant_id=? AND user_id=?', [id, req.user.id]);
    await run('DELETE FROM tenants WHERE id=? AND user_id=?', [id, req.user.id]);

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

/* =========================
   MANAGERS
========================= */

router.get('/managers', async (req, res, next) => {
  try {
    const rows = await all('SELECT * FROM managers WHERE user_id=? ORDER BY name, id', [req.user.id]);
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

router.post('/managers', async (req, res, next) => {
  try {
    if (requireFields(res, ['name'], req.body)) return;

    const result = await run(
      'INSERT INTO managers (user_id, name, phone, email, notes) VALUES (?, ?, ?, ?, ?)',
      [
        req.user.id,
        String(req.body.name).trim(),
        req.body.phone || null,
        req.body.email || null,
        req.body.notes || null
      ]
    );

    const row = await get('SELECT * FROM managers WHERE id=?', [result.id]);
    res.status(201).json(row);
  } catch (error) {
    next(error);
  }
});

router.put('/managers/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const current = await ensureOwnershipOr404(res, 'managers', id, req.user.id);
    if (!current) return;
    if (requireFields(res, ['name'], req.body)) return;

    await run(
      'UPDATE managers SET name=?, phone=?, email=?, notes=? WHERE id=? AND user_id=?',
      [
        String(req.body.name).trim(),
        req.body.phone || null,
        req.body.email || null,
        req.body.notes || null,
        id,
        req.user.id
      ]
    );

    const row = await get('SELECT * FROM managers WHERE id=?', [id]);
    res.json(row);
  } catch (error) {
    next(error);
  }
});

router.delete('/managers/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const current = await ensureOwnershipOr404(res, 'managers', id, req.user.id);
    if (!current) return;

    await run('UPDATE properties SET manager_id=NULL WHERE manager_id=? AND user_id=?', [id, req.user.id]);
    await run('DELETE FROM managers WHERE id=? AND user_id=?', [id, req.user.id]);

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

/* =========================
   PAYMENT METHODS
========================= */

router.get('/payment-methods', async (req, res, next) => {
  try {
    const rows = await all('SELECT * FROM payment_methods WHERE user_id=? ORDER BY name, id', [req.user.id]);
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

router.post('/payment-methods', async (req, res, next) => {
  try {
    if (requireFields(res, ['name'], req.body)) return;

    const result = await run(
      'INSERT INTO payment_methods (user_id, name) VALUES (?, ?)',
      [req.user.id, String(req.body.name).trim()]
    );

    const row = await get('SELECT * FROM payment_methods WHERE id=?', [result.id]);
    res.status(201).json(row);
  } catch (error) {
    next(error);
  }
});

router.put('/payment-methods/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const current = await ensureOwnershipOr404(res, 'payment_methods', id, req.user.id);
    if (!current) return;
    if (requireFields(res, ['name'], req.body)) return;

    await run('UPDATE payment_methods SET name=? WHERE id=? AND user_id=?', [
      String(req.body.name).trim(),
      id,
      req.user.id
    ]);

    const row = await get('SELECT * FROM payment_methods WHERE id=?', [id]);
    res.json(row);
  } catch (error) {
    next(error);
  }
});

router.delete('/payment-methods/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const current = await ensureOwnershipOr404(res, 'payment_methods', id, req.user.id);
    if (!current) return;

    const usage = await get('SELECT COUNT(*)::int AS total FROM payments WHERE user_id=? AND payment_method_id=?', [
      req.user.id,
      id
    ]);

    if (Number(usage?.total || 0) > 0) {
      return res.status(400).json({ error: 'Este meio de pagamento já está em uso.' });
    }

    await run('DELETE FROM payment_methods WHERE id=? AND user_id=?', [id, req.user.id]);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

/* =========================
   RECEIVING ACCOUNTS
========================= */

router.get('/receiving-accounts', async (req, res, next) => {
  try {
    const rows = await all('SELECT * FROM receiving_accounts WHERE user_id=? ORDER BY name, id', [req.user.id]);
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

router.post('/receiving-accounts', async (req, res, next) => {
  try {
    if (requireFields(res, ['name'], req.body)) return;

    const result = await run(
      'INSERT INTO receiving_accounts (user_id, name) VALUES (?, ?)',
      [req.user.id, String(req.body.name).trim()]
    );

    const row = await get('SELECT * FROM receiving_accounts WHERE id=?', [result.id]);
    res.status(201).json(row);
  } catch (error) {
    next(error);
  }
});

router.put('/receiving-accounts/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const current = await ensureOwnershipOr404(res, 'receiving_accounts', id, req.user.id);
    if (!current) return;
    if (requireFields(res, ['name'], req.body)) return;

    await run('UPDATE receiving_accounts SET name=? WHERE id=? AND user_id=?', [
      String(req.body.name).trim(),
      id,
      req.user.id
    ]);

    const row = await get('SELECT * FROM receiving_accounts WHERE id=?', [id]);
    res.json(row);
  } catch (error) {
    next(error);
  }
});

router.delete('/receiving-accounts/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const current = await ensureOwnershipOr404(res, 'receiving_accounts', id, req.user.id);
    if (!current) return;

    const usage = await get('SELECT COUNT(*)::int AS total FROM payments WHERE user_id=? AND receiving_account_id=?', [
      req.user.id,
      id
    ]);

    if (Number(usage?.total || 0) > 0) {
      return res.status(400).json({ error: 'Esta conta de recebimento já está em uso.' });
    }

    await run('DELETE FROM receiving_accounts WHERE id=? AND user_id=?', [id, req.user.id]);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

/* =========================
   PROPERTIES
========================= */

router.get('/properties', async (req, res, next) => {
  try {
    const rows = await all(
      `
      SELECT
        p.*,
        t.name AS tenant_name,
        m.name AS manager_name
      FROM properties p
      LEFT JOIN tenants t ON t.id = p.tenant_id
      LEFT JOIN managers m ON m.id = p.manager_id
      WHERE p.user_id=?
      ORDER BY p.name, p.id
      `,
      [req.user.id]
    );

    res.json(rows);
  } catch (error) {
    next(error);
  }
});

router.post('/properties', async (req, res, next) => {
  try {
    if (requireFields(res, ['name'], req.body)) return;

    const result = await run(
      `
      INSERT INTO properties
      (user_id, name, address, tenant_id, manager_id, rent_value, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        req.user.id,
        String(req.body.name).trim(),
        req.body.address || null,
        parseId(req.body.tenant_id) || null,
        parseId(req.body.manager_id) || null,
        round2(toNumber(req.body.rent_value)),
        req.body.notes || null
      ]
    );

    const row = await get(
      `
      SELECT
        p.*,
        t.name AS tenant_name,
        m.name AS manager_name
      FROM properties p
      LEFT JOIN tenants t ON t.id = p.tenant_id
      LEFT JOIN managers m ON m.id = p.manager_id
      WHERE p.id=?
      `,
      [result.id]
    );

    res.status(201).json(row);
  } catch (error) {
    next(error);
  }
});

router.put('/properties/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const current = await ensureOwnershipOr404(res, 'properties', id, req.user.id);
    if (!current) return;
    if (requireFields(res, ['name'], req.body)) return;

    await run(
      `
      UPDATE properties
      SET name=?, address=?, tenant_id=?, manager_id=?, rent_value=?, notes=?
      WHERE id=? AND user_id=?
      `,
      [
        String(req.body.name).trim(),
        req.body.address || null,
        parseId(req.body.tenant_id) || null,
        parseId(req.body.manager_id) || null,
        round2(toNumber(req.body.rent_value)),
        req.body.notes || null,
        id,
        req.user.id
      ]
    );

    const row = await get(
      `
      SELECT
        p.*,
        t.name AS tenant_name,
        m.name AS manager_name
      FROM properties p
      LEFT JOIN tenants t ON t.id = p.tenant_id
      LEFT JOIN managers m ON m.id = p.manager_id
      WHERE p.id=?
      `,
      [id]
    );

    res.json(row);
  } catch (error) {
    next(error);
  }
});

router.delete('/properties/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const current = await ensureOwnershipOr404(res, 'properties', id, req.user.id);
    if (!current) return;

    const linkedLaunches = await get('SELECT COUNT(*)::int AS total FROM launches WHERE user_id=? AND property_id=?', [
      req.user.id,
      id
    ]);

    if (Number(linkedLaunches?.total || 0) > 0) {
      return res.status(400).json({ error: 'Este imóvel possui lançamentos vinculados e não pode ser excluído.' });
    }

    await run('DELETE FROM category_configs WHERE user_id=? AND property_id=?', [req.user.id, id]);
    await run('DELETE FROM properties WHERE id=? AND user_id=?', [id, req.user.id]);

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

/* =========================
   CATEGORY CONFIGS
========================= */

router.get('/category-configs', async (req, res, next) => {
  try {
    const rows = await all(
      `
      SELECT
        c.*,
        p.name AS property_name
      FROM category_configs c
      JOIN properties p ON p.id = c.property_id
      WHERE c.user_id=?
      ORDER BY p.name, c.category_name, c.id
      `,
      [req.user.id]
    );

    res.json(rows);
  } catch (error) {
    next(error);
  }
});

router.post('/category-configs', async (req, res, next) => {
  try {
    if (requireFields(res, ['property_id', 'category_name', 'amount', 'due_day'], req.body)) return;

    const result = await run(
      `
      INSERT INTO category_configs
      (user_id, property_id, category_name, amount, admin_fee_percent, due_day, active)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        req.user.id,
        parseId(req.body.property_id),
        String(req.body.category_name).trim(),
        round2(toNumber(req.body.amount)),
        round2(toNumber(req.body.admin_fee_percent)),
        parseId(req.body.due_day),
        Number(req.body.active ?? 1) ? 1 : 0
      ]
    );

    const row = await get(
      `
      SELECT c.*, p.name AS property_name
      FROM category_configs c
      JOIN properties p ON p.id = c.property_id
      WHERE c.id=?
      `,
      [result.id]
    );

    res.status(201).json(row);
  } catch (error) {
    next(error);
  }
});

router.put('/category-configs/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const current = await ensureOwnershipOr404(res, 'category_configs', id, req.user.id);
    if (!current) return;
    if (requireFields(res, ['property_id', 'category_name', 'amount', 'due_day'], req.body)) return;

    await run(
      `
      UPDATE category_configs
      SET property_id=?, category_name=?, amount=?, admin_fee_percent=?, due_day=?, active=?
      WHERE id=? AND user_id=?
      `,
      [
        parseId(req.body.property_id),
        String(req.body.category_name).trim(),
        round2(toNumber(req.body.amount)),
        round2(toNumber(req.body.admin_fee_percent)),
        parseId(req.body.due_day),
        Number(req.body.active ?? 1) ? 1 : 0,
        id,
        req.user.id
      ]
    );

    const row = await get(
      `
      SELECT c.*, p.name AS property_name
      FROM category_configs c
      JOIN properties p ON p.id = c.property_id
      WHERE c.id=?
      `,
      [id]
    );

    res.json(row);
  } catch (error) {
    next(error);
  }
});

router.delete('/category-configs/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const current = await ensureOwnershipOr404(res, 'category_configs', id, req.user.id);
    if (!current) return;

    await run('UPDATE launches SET config_id=NULL WHERE user_id=? AND config_id=?', [req.user.id, id]);
    await run('DELETE FROM category_configs WHERE id=? AND user_id=?', [id, req.user.id]);

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

/* =========================
   LAUNCHES
========================= */

router.get('/launches', async (req, res, next) => {
  try {
    const month = String(req.query.month || '').trim();
    const managerId = parseId(req.query.manager_id);

    let sql = `
      SELECT
        l.*,
        p.name AS property_name,
        p.manager_id,
        m.name AS manager_name,
        pay.id AS payment_id,
        pay.received_amount,
        pay.payment_date
      FROM launches l
      JOIN properties p ON p.id = l.property_id
      LEFT JOIN managers m ON m.id = p.manager_id
      LEFT JOIN payments pay ON pay.launch_id = l.id
      WHERE l.user_id = ?
    `;

    const params = [req.user.id];

    if (month) {
      sql += ' AND l.competence = ?';
      params.push(month);
    }

    if (managerId) {
      sql += ' AND p.manager_id = ?';
      params.push(managerId);
    }

    sql += ' ORDER BY l.competence_start, l.due_date, p.name, l.category_name';

    const rows = await all(sql, params);
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

router.post('/launches/generate', async (req, res, next) => {
  try {
    const month = String(req.body.month || '').trim();
    if (!month) {
      return res.status(400).json({ error: 'month é obrigatório no formato AAAA-MM.' });
    }

    const configs = await all(
      `
      SELECT
        c.*,
        p.name AS property_name
      FROM category_configs c
      JOIN properties p ON p.id = c.property_id
      WHERE c.user_id=? AND c.active=1
      ORDER BY p.name, c.category_name, c.id
      `,
      [req.user.id]
    );

    const created = [];
    const competence_start = firstDayOfMonth(month);
    const competence_end = lastDayOfMonth(month);

    for (const config of configs) {
      const existing = await get(
        'SELECT id FROM launches WHERE user_id=? AND config_id=? AND competence=?',
        [req.user.id, config.id, month]
      );

      if (existing) continue;

      const due_date = buildDueDate(month, config.due_day);

      const result = await run(
        `
        INSERT INTO launches
        (user_id, property_id, config_id, category_name, competence, competence_start, competence_end, amount_expected, due_date, notes, admin_fee_percent)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          req.user.id,
          config.property_id,
          config.id,
          config.category_name,
          month,
          competence_start,
          competence_end,
          round2(toNumber(config.amount)),
          due_date,
          null,
          round2(toNumber(config.admin_fee_percent))
        ]
      );

      created.push(result.id);
    }

    res.json({ ok: true, created: created.length, ids: created });
  } catch (error) {
    next(error);
  }
});

router.put('/launches/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const current = await ensureOwnershipOr404(res, 'launches', id, req.user.id);
    if (!current) return;
    if (requireFields(res, ['property_id', 'category_name', 'amount_expected', 'competence_start', 'competence_end', 'due_date'], req.body)) return;

    const period = normalizePeriod(req.body.competence, req.body.competence_start, req.body.competence_end);

    await run(
      `
      UPDATE launches
      SET property_id=?, config_id=?, category_name=?, competence=?, competence_start=?, competence_end=?, amount_expected=?, due_date=?, notes=?, admin_fee_percent=?
      WHERE id=? AND user_id=?
      `,
      [
        parseId(req.body.property_id),
        parseId(req.body.config_id) || null,
        String(req.body.category_name).trim(),
        period.competence,
        period.competence_start,
        period.competence_end,
        round2(toNumber(req.body.amount_expected)),
        req.body.due_date,
        req.body.notes || null,
        round2(toNumber(req.body.admin_fee_percent)),
        id,
        req.user.id
      ]
    );

    const row = await get(
      `
      SELECT
        l.*,
        p.name AS property_name,
        p.manager_id,
        m.name AS manager_name
      FROM launches l
      JOIN properties p ON p.id = l.property_id
      LEFT JOIN managers m ON m.id = p.manager_id
      WHERE l.id=?
      `,
      [id]
    );

    const payment = await get('SELECT * FROM payments WHERE user_id=? AND launch_id=?', [req.user.id, id]);
    if (payment) {
      const recalculated = computePaymentValues(row, payment);
      await run(
        `
        UPDATE payments
        SET admin_fee_percent=?, admin_fee_amount=?, net_received_amount=?
        WHERE id=? AND user_id=?
        `,
        [
          recalculated.admin_fee_percent,
          recalculated.admin_fee_amount,
          recalculated.net_received_amount,
          payment.id,
          req.user.id
        ]
      );
    }

    res.json(row);
  } catch (error) {
    next(error);
  }
});

router.delete('/launches/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const current = await ensureOwnershipOr404(res, 'launches', id, req.user.id);
    if (!current) return;

    await run('DELETE FROM payments WHERE user_id=? AND launch_id=?', [req.user.id, id]);
    await run('DELETE FROM launches WHERE id=? AND user_id=?', [id, req.user.id]);

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

/* =========================
   PAYMENTS
========================= */

router.get('/payments', async (req, res, next) => {
  try {
    const rows = await all(
      `
      SELECT
        pay.*,
        l.property_id,
        l.category_name,
        l.competence,
        l.competence_start,
        l.competence_end,
        l.amount_expected,
        l.due_date,
        l.admin_fee_percent AS launch_admin_fee_percent,
        p.name AS property_name,
        p.manager_id,
        m.name AS manager_name,
        pm.name AS payment_method_name,
        ra.name AS receiving_account_name
      FROM payments pay
      JOIN launches l ON l.id = pay.launch_id
      JOIN properties p ON p.id = l.property_id
      LEFT JOIN managers m ON m.id = p.manager_id
      LEFT JOIN payment_methods pm ON pm.id = pay.payment_method_id
      LEFT JOIN receiving_accounts ra ON ra.id = pay.receiving_account_id
      WHERE pay.user_id=?
      ORDER BY COALESCE(pay.payment_date, l.due_date) DESC, pay.id DESC
      `,
      [req.user.id]
    );

    res.json(rows);
  } catch (error) {
    next(error);
  }
});

router.post('/payments', async (req, res, next) => {
  try {
    if (requireFields(res, ['launch_id'], req.body)) return;

    const launchId = parseId(req.body.launch_id);
    const launch = await get('SELECT * FROM launches WHERE id=? AND user_id=?', [launchId, req.user.id]);
    if (!launch) {
      return res.status(404).json({ error: 'Lançamento não encontrado.' });
    }

    const values = computePaymentValues(launch, req.body);
    const rentalPeriodStart = req.body.rental_period_start || launch.competence_start || firstDayOfMonth(launch.competence);
    const rentalPeriodEnd = req.body.rental_period_end || launch.competence_end || lastDayOfMonth(launch.competence);

    const existing = await get('SELECT * FROM payments WHERE user_id=? AND launch_id=?', [req.user.id, launchId]);

    if (existing) {
      await run(
        `
        UPDATE payments
        SET received_amount=?, fine_amount=?, interest_amount=?, admin_fee_percent=?, admin_fee_amount=?, net_received_amount=?, payment_date=?, payment_method_id=?, receiving_account_id=?, rental_period_start=?, rental_period_end=?, notes=?
        WHERE id=? AND user_id=?
        `,
        [
          values.received_amount,
          values.fine_amount,
          values.interest_amount,
          values.admin_fee_percent,
          values.admin_fee_amount,
          values.net_received_amount,
          req.body.payment_date || null,
          parseId(req.body.payment_method_id) || null,
          parseId(req.body.receiving_account_id) || null,
          rentalPeriodStart,
          rentalPeriodEnd,
          req.body.notes || null,
          existing.id,
          req.user.id
        ]
      );

      const row = await get('SELECT * FROM payments WHERE id=?', [existing.id]);
      return res.json(row);
    }

    const result = await run(
      `
      INSERT INTO payments
      (user_id, launch_id, received_amount, fine_amount, interest_amount, admin_fee_percent, admin_fee_amount, net_received_amount, payment_date, payment_method_id, receiving_account_id, rental_period_start, rental_period_end, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        req.user.id,
        launchId,
        values.received_amount,
        values.fine_amount,
        values.interest_amount,
        values.admin_fee_percent,
        values.admin_fee_amount,
        values.net_received_amount,
        req.body.payment_date || null,
        parseId(req.body.payment_method_id) || null,
        parseId(req.body.receiving_account_id) || null,
        rentalPeriodStart,
        rentalPeriodEnd,
        req.body.notes || null
      ]
    );

    const row = await get('SELECT * FROM payments WHERE id=?', [result.id]);
    res.status(201).json(row);
  } catch (error) {
    next(error);
  }
});

router.put('/payments/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const current = await ensureOwnershipOr404(res, 'payments', id, req.user.id);
    if (!current) return;

    const launchId = parseId(req.body.launch_id || current.launch_id);
    const launch = await get('SELECT * FROM launches WHERE id=? AND user_id=?', [launchId, req.user.id]);
    if (!launch) {
      return res.status(404).json({ error: 'Lançamento não encontrado.' });
    }

    const conflict = await get(
      'SELECT id FROM payments WHERE user_id=? AND launch_id=? AND id<>?',
      [req.user.id, launchId, id]
    );

    if (conflict) {
      return res.status(400).json({ error: 'Já existe um pagamento para este lançamento.' });
    }

    const values = computePaymentValues(launch, req.body);
    const rentalPeriodStart = req.body.rental_period_start || launch.competence_start || firstDayOfMonth(launch.competence);
    const rentalPeriodEnd = req.body.rental_period_end || launch.competence_end || lastDayOfMonth(launch.competence);

    await run(
      `
      UPDATE payments
      SET launch_id=?, received_amount=?, fine_amount=?, interest_amount=?, admin_fee_percent=?, admin_fee_amount=?, net_received_amount=?, payment_date=?, payment_method_id=?, receiving_account_id=?, rental_period_start=?, rental_period_end=?, notes=?
      WHERE id=? AND user_id=?
      `,
      [
        launchId,
        values.received_amount,
        values.fine_amount,
        values.interest_amount,
        values.admin_fee_percent,
        values.admin_fee_amount,
        values.net_received_amount,
        req.body.payment_date || null,
        parseId(req.body.payment_method_id) || null,
        parseId(req.body.receiving_account_id) || null,
        rentalPeriodStart,
        rentalPeriodEnd,
        req.body.notes || null,
        id,
        req.user.id
      ]
    );

    const row = await get('SELECT * FROM payments WHERE id=?', [id]);
    res.json(row);
  } catch (error) {
    next(error);
  }
});

router.post('/payments/:id/receipt', upload.single('receipt'), async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const current = await ensureOwnershipOr404(res, 'payments', id, req.user.id);
    if (!current) return;

    if (!req.file) {
      return res.status(400).json({ error: 'Arquivo de recibo não enviado.' });
    }

    const publicPath = `/uploads/receipts/${req.file.filename}`;

    await run(
      'UPDATE payments SET receipt_file_path=?, receipt_original_name=? WHERE id=? AND user_id=?',
      [publicPath, req.file.originalname, id, req.user.id]
    );

    const row = await get('SELECT * FROM payments WHERE id=?', [id]);
    res.json(row);
  } catch (error) {
    next(error);
  }
});

router.delete('/payments/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const current = await ensureOwnershipOr404(res, 'payments', id, req.user.id);
    if (!current) return;

    await run('DELETE FROM payments WHERE id=? AND user_id=?', [id, req.user.id]);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

/* =========================
   BACKUP
========================= */

router.get('/backup/export', async (req, res, next) => {
  try {
    const data = await exportUserData(req.user.id);

    res.json({
      app: 'imoveis-em-dia',
      backup_version: 3,
      exported_at: new Date().toISOString(),
      receipts_included: false,
      note: 'O backup inclui apenas os dados do banco. Os arquivos físicos de recibo não são incluídos.',
      data
    });
  } catch (error) {
    next(error);
  }
});

router.post('/backup/import', async (req, res, next) => {
  const client = await pool.connect();

  try {
    const payload = normalizeBackupPayload(req.body);
    const tenants = Array.isArray(payload.tenants) ? payload.tenants : [];
    const managers = Array.isArray(payload.managers) ? payload.managers : [];
    const paymentMethods = Array.isArray(payload.payment_methods) ? payload.payment_methods : [];
    const receivingAccounts = Array.isArray(payload.receiving_accounts) ? payload.receiving_accounts : [];
    const properties = Array.isArray(payload.properties) ? payload.properties : [];
    const categoryConfigs = Array.isArray(payload.category_configs) ? payload.category_configs : [];
    const launches = Array.isArray(payload.launches) ? payload.launches : [];
    const payments = Array.isArray(payload.payments) ? payload.payments : [];

    await client.query('BEGIN');

    await client.query('DELETE FROM payments WHERE user_id=$1', [req.user.id]);
    await client.query('DELETE FROM launches WHERE user_id=$1', [req.user.id]);
    await client.query('DELETE FROM category_configs WHERE user_id=$1', [req.user.id]);
    await client.query('DELETE FROM properties WHERE user_id=$1', [req.user.id]);
    await client.query('DELETE FROM payment_methods WHERE user_id=$1', [req.user.id]);
    await client.query('DELETE FROM receiving_accounts WHERE user_id=$1', [req.user.id]);
    await client.query('DELETE FROM tenants WHERE user_id=$1', [req.user.id]);
    await client.query('DELETE FROM managers WHERE user_id=$1', [req.user.id]);

    const tenantMap = new Map();
    const managerMap = new Map();
    const methodMap = new Map();
    const accountMap = new Map();
    const propertyMap = new Map();
    const configMap = new Map();
    const launchMap = new Map();

    for (const row of tenants) {
      const result = await client.query(
        'INSERT INTO tenants (user_id, name, phone, email, notes) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [req.user.id, row.name, row.phone || null, row.email || null, row.notes || null]
      );
      tenantMap.set(String(row.id), result.rows[0].id);
    }

    for (const row of managers) {
      const result = await client.query(
        'INSERT INTO managers (user_id, name, phone, email, notes) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [req.user.id, row.name, row.phone || null, row.email || null, row.notes || null]
      );
      managerMap.set(String(row.id), result.rows[0].id);
    }

    for (const row of paymentMethods) {
      const result = await client.query(
        'INSERT INTO payment_methods (user_id, name) VALUES ($1, $2) RETURNING id',
        [req.user.id, row.name]
      );
      methodMap.set(String(row.id), result.rows[0].id);
    }

    for (const row of receivingAccounts) {
      const result = await client.query(
        'INSERT INTO receiving_accounts (user_id, name) VALUES ($1, $2) RETURNING id',
        [req.user.id, row.name]
      );
      accountMap.set(String(row.id), result.rows[0].id);
    }

    for (const row of properties) {
      const result = await client.query(
        `
        INSERT INTO properties
        (user_id, name, address, tenant_id, manager_id, rent_value, notes)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id
        `,
        [
          req.user.id,
          row.name,
          row.address || null,
          row.tenant_id ? tenantMap.get(String(row.tenant_id)) || null : null,
          row.manager_id ? managerMap.get(String(row.manager_id)) || null : null,
          round2(toNumber(row.rent_value)),
          row.notes || null
        ]
      );
      propertyMap.set(String(row.id), result.rows[0].id);
    }

    for (const row of categoryConfigs) {
      const result = await client.query(
        `
        INSERT INTO category_configs
        (user_id, property_id, category_name, amount, admin_fee_percent, due_day, active)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id
        `,
        [
          req.user.id,
          propertyMap.get(String(row.property_id)),
          row.category_name,
          round2(toNumber(row.amount)),
          round2(toNumber(row.admin_fee_percent)),
          parseId(row.due_day),
          Number(row.active ?? 1) ? 1 : 0
        ]
      );
      configMap.set(String(row.id), result.rows[0].id);
    }

    for (const row of launches) {
      const period = normalizePeriod(row.competence, row.competence_start, row.competence_end);

      const result = await client.query(
        `
        INSERT INTO launches
        (user_id, property_id, config_id, category_name, competence, competence_start, competence_end, amount_expected, due_date, notes, admin_fee_percent)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING id
        `,
        [
          req.user.id,
          propertyMap.get(String(row.property_id)),
          row.config_id ? configMap.get(String(row.config_id)) || null : null,
          row.category_name,
          period.competence,
          period.competence_start,
          period.competence_end,
          round2(toNumber(row.amount_expected)),
          row.due_date,
          row.notes || null,
          round2(toNumber(row.admin_fee_percent))
        ]
      );
      launchMap.set(String(row.id), result.rows[0].id);
    }

    for (const row of payments) {
      const newLaunchId = launchMap.get(String(row.launch_id));
      if (!newLaunchId) continue;

      await client.query(
        `
        INSERT INTO payments
        (user_id, launch_id, received_amount, fine_amount, interest_amount, admin_fee_percent, admin_fee_amount, net_received_amount, payment_date, payment_method_id, receiving_account_id, rental_period_start, rental_period_end, receipt_file_path, receipt_original_name, notes)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        `,
        [
          req.user.id,
          newLaunchId,
          round2(toNumber(row.received_amount)),
          round2(toNumber(row.fine_amount)),
          round2(toNumber(row.interest_amount)),
          round2(toNumber(row.admin_fee_percent)),
          round2(toNumber(row.admin_fee_amount)),
          round2(toNumber(row.net_received_amount)),
          row.payment_date || null,
          row.payment_method_id ? methodMap.get(String(row.payment_method_id)) || null : null,
          row.receiving_account_id ? accountMap.get(String(row.receiving_account_id)) || null : null,
          row.rental_period_start || null,
          row.rental_period_end || null,
          row.receipt_file_path || null,
          row.receipt_original_name || null,
          row.notes || null
        ]
      );
    }

    await client.query('COMMIT');

    res.json({
      ok: true,
      counts: {
        tenants: tenants.length,
        managers: managers.length,
        payment_methods: paymentMethods.length,
        receiving_accounts: receivingAccounts.length,
        properties: properties.length,
        category_configs: categoryConfigs.length,
        launches: launches.length,
        payments: payments.length
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
});

/* =========================
   REPORTS
========================= */

router.get('/reports/monthly', async (req, res, next) => {
  try {
    const month = String(req.query.month || '').trim();
    const managerId = parseId(req.query.manager_id);

    if (!month) {
      return res.status(400).json({ error: 'month é obrigatório.' });
    }

    let sql = `
      SELECT
        l.id AS launch_id,
        l.property_id,
        l.category_name,
        l.competence,
        l.competence_start,
        l.competence_end,
        l.amount_expected,
        l.due_date,
        l.admin_fee_percent AS launch_admin_fee_percent,
        p.name AS property_name,
        p.manager_id,
        m.name AS manager_name,
        pay.id AS payment_id,
        pay.received_amount,
        pay.fine_amount,
        pay.interest_amount,
        pay.admin_fee_percent,
        pay.admin_fee_amount,
        pay.net_received_amount,
        pay.payment_date,
        pay.rental_period_start,
        pay.rental_period_end,
        pay.receipt_original_name,
        pay.receipt_file_path
      FROM launches l
      JOIN properties p ON p.id = l.property_id
      LEFT JOIN managers m ON m.id = p.manager_id
      LEFT JOIN payments pay ON pay.launch_id = l.id
      WHERE l.user_id = ? AND l.competence = ?
    `;

    const params = [req.user.id, month];

    if (managerId) {
      sql += ' AND p.manager_id = ?';
      params.push(managerId);
    }

    sql += ' ORDER BY m.name NULLS LAST, p.name, l.category_name, l.due_date';

    const rows = await all(sql, params);

    const totals = rows.reduce(
      (acc, row) => {
        acc.expected += toNumber(row.amount_expected);
        acc.received += toNumber(row.received_amount);
        acc.admin_fee += toNumber(row.admin_fee_amount);
        acc.net_received += toNumber(row.net_received_amount);
        return acc;
      },
      { expected: 0, received: 0, admin_fee: 0, net_received: 0 }
    );

    totals.expected = round2(totals.expected);
    totals.received = round2(totals.received);
    totals.admin_fee = round2(totals.admin_fee);
    totals.net_received = round2(totals.net_received);

    res.json({ month, totals, rows });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
