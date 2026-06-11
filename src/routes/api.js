const express = require('express');
const path = require('path');
const fs = require('fs');
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
    const safeName = String(file.originalname || 'arquivo').replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}-${safeName}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const isPdf = file.mimetype === 'application/pdf';
    const isImage = String(file.mimetype || '').startsWith('image/');
    if (isPdf || isImage) return cb(null, true);
    cb(new Error('Envie um arquivo PDF ou imagem para o recibo.'));
  }
});

function parseId(value) {
  const id = Number(value);
  return Number.isFinite(id) ? id : 0;
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round2(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function requireFields(res, fields, body) {
  const missing = fields.filter((field) => body[field] === undefined || body[field] === null || body[field] === '');
  if (missing.length) {
    res.status(400).json({ error: `Campos obrigatórios: ${missing.join(', ')}` });
    return true;
  }
  return false;
}

async function ensureOwnershipOr404(res, table, id, userId) {
  const row = await get(`SELECT * FROM ${table} WHERE id = ? AND user_id = ?`, [id, userId]);
  if (!row) {
    res.status(404).json({ error: 'Registro não encontrado.' });
    return null;
  }
  return row;
}

function computePaymentTotals(launch, payload = {}) {
  const expected = round2(toNumber(launch.amount_expected));
  const fine = round2(toNumber(payload.fine_amount));
  const interest = round2(toNumber(payload.interest_amount));
  const adminFeePercent = round2(toNumber(payload.admin_fee_percent, launch.admin_fee_percent || 0) || toNumber(launch.admin_fee_percent));
  const receivedAmount = round2(expected + fine + interest);
  const adminFeeAmount = round2((receivedAmount * adminFeePercent) / 100);
  const netReceivedAmount = round2(receivedAmount - adminFeeAmount);

  return {
    fine_amount: fine,
    interest_amount: interest,
    admin_fee_percent: adminFeePercent,
    received_amount: receivedAmount,
    admin_fee_amount: adminFeeAmount,
    net_received_amount: netReceivedAmount
  };
}

function normalizeBackupPayload(body) {
  if (body && body.data && typeof body.data === 'object') return body.data;
  return body || {};
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
    all('SELECT * FROM tenants WHERE user_id = ? ORDER BY id', [userId]),
    all('SELECT * FROM managers WHERE user_id = ? ORDER BY id', [userId]),
    all('SELECT * FROM payment_methods WHERE user_id = ? ORDER BY id', [userId]),
    all('SELECT * FROM receiving_accounts WHERE user_id = ? ORDER BY id', [userId]),
    all('SELECT * FROM properties WHERE user_id = ? ORDER BY id', [userId]),
    all('SELECT * FROM category_configs WHERE user_id = ? ORDER BY id', [userId]),
    all('SELECT * FROM launches WHERE user_id = ? ORDER BY id', [userId]),
    all('SELECT * FROM payments WHERE user_id = ? ORDER BY id', [userId])
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

router.get('/dashboard', async (req, res, next) => {
  try {
    const month = req.query.month;
    const managerId = req.query.manager_id;
    if (!month) return res.status(400).json({ error: 'month é obrigatório no formato AAAA-MM.' });

    let sql = `
      SELECT l.*, p.name as property_name, m.name as manager_name, t.name as tenant_name,
             pay.received_amount, pay.payment_date, pay.fine_amount, pay.interest_amount,
             pay.admin_fee_percent as payment_admin_fee_percent,
             pay.admin_fee_amount, pay.net_received_amount
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
      params.push(parseId(managerId));
    }
    sql += ' ORDER BY l.due_date, p.name, l.category_name';

    const items = await all(sql, params);
    const today = new Date().toISOString().slice(0, 10);
    const summary = items.reduce((acc, item) => {
      const status = item.received_amount != null
        ? (Number(item.received_amount) >= Number(item.amount_expected) ? 'Pago' : 'Pago parcial')
        : (item.due_date < today ? 'Atrasado' : 'Em aberto');

      acc.total_expected += Number(item.amount_expected || 0);
      acc.total_received += Number(item.received_amount || 0);
      if (status === 'Atrasado') acc.late_count += 1;
      if (status === 'Em aberto' || status === 'Atrasado') acc.open_count += 1;
      return acc;
    }, { total_expected: 0, total_received: 0, open_count: 0, late_count: 0 });

    res.json({ summary, items });
  } catch (error) {
    next(error);
  }
});

router.get('/tenants', async (req, res, next) => {
  try {
    res.json(await all('SELECT * FROM tenants WHERE user_id = ? ORDER BY name', [req.user.id]));
  } catch (error) {
    next(error);
  }
});

router.post('/tenants', async (req, res, next) => {
  try {
    if (requireFields(res, ['name'], req.body)) return;
    const { name, phone = null, email = null, notes = null } = req.body;
    const result = await run(
      'INSERT INTO tenants (user_id, name, phone, email, notes) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, name, phone, email, notes]
    );
    res.status(201).json(await get('SELECT * FROM tenants WHERE id = ?', [result.id]));
  } catch (error) {
    next(error);
  }
});

router.put('/tenants/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const row = await ensureOwnershipOr404(res, 'tenants', id, req.user.id);
    if (!row) return;

    const { name, phone = null, email = null, notes = null } = req.body;
    await run(
      'UPDATE tenants SET name = ?, phone = ?, email = ?, notes = ? WHERE id = ? AND user_id = ?',
      [name || row.name, phone, email, notes, id, req.user.id]
    );
    res.json(await get('SELECT * FROM tenants WHERE id = ?', [id]));
  } catch (error) {
    next(error);
  }
});

router.delete('/tenants/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const row = await ensureOwnershipOr404(res, 'tenants', id, req.user.id);
    if (!row) return;

    await run('UPDATE properties SET tenant_id = NULL WHERE tenant_id = ? AND user_id = ?', [id, req.user.id]);
    await run('DELETE FROM tenants WHERE id = ? AND user_id = ?', [id, req.user.id]);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.get('/managers', async (req, res, next) => {
  try {
    res.json(await all('SELECT * FROM managers WHERE user_id = ? ORDER BY name', [req.user.id]));
  } catch (error) {
    next(error);
  }
});

router.post('/managers', async (req, res, next) => {
  try {
    if (requireFields(res, ['name'], req.body)) return;
    const { name, phone = null, email = null, notes = null } = req.body;
    const result = await run(
      'INSERT INTO managers (user_id, name, phone, email, notes) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, name, phone, email, notes]
    );
    res.status(201).json(await get('SELECT * FROM managers WHERE id = ?', [result.id]));
  } catch (error) {
    next(error);
  }
});

router.put('/managers/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const row = await ensureOwnershipOr404(res, 'managers', id, req.user.id);
    if (!row) return;

    const { name, phone = null, email = null, notes = null } = req.body;
    await run(
      'UPDATE managers SET name = ?, phone = ?, email = ?, notes = ? WHERE id = ? AND user_id = ?',
      [name || row.name, phone, email, notes, id, req.user.id]
    );
    res.json(await get('SELECT * FROM managers WHERE id = ?', [id]));
  } catch (error) {
    next(error);
  }
});

router.delete('/managers/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const row = await ensureOwnershipOr404(res, 'managers', id, req.user.id);
    if (!row) return;

    await run('UPDATE properties SET manager_id = NULL WHERE manager_id = ? AND user_id = ?', [id, req.user.id]);
    await run('DELETE FROM managers WHERE id = ? AND user_id = ?', [id, req.user.id]);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.get('/payment-methods', async (req, res, next) => {
  try {
    res.json(await all('SELECT * FROM payment_methods WHERE user_id = ? ORDER BY name', [req.user.id]));
  } catch (error) {
    next(error);
  }
});

router.post('/payment-methods', async (req, res, next) => {
  try {
    if (requireFields(res, ['name'], req.body)) return;
    const name = String(req.body.name || '').trim();
    const exists = await get('SELECT * FROM payment_methods WHERE user_id = ? AND LOWER(name) = LOWER(?)', [req.user.id, name]);
    if (exists) return res.status(409).json({ error: 'Já existe um meio de pagamento com esse nome.' });

    const result = await run('INSERT INTO payment_methods (user_id, name) VALUES (?, ?)', [req.user.id, name]);
    res.status(201).json(await get('SELECT * FROM payment_methods WHERE id = ?', [result.id]));
  } catch (error) {
    next(error);
  }
});

router.delete('/payment-methods/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const inUse = await get('SELECT id FROM payments WHERE payment_method_id = ? AND user_id = ?', [id, req.user.id]);
    if (inUse) return res.status(409).json({ error: 'Não é possível excluir: meio de pagamento em uso.' });

    await run('DELETE FROM payment_methods WHERE id = ? AND user_id = ?', [id, req.user.id]);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.get('/receiving-accounts', async (req, res, next) => {
  try {
    res.json(await all('SELECT * FROM receiving_accounts WHERE user_id = ? ORDER BY name', [req.user.id]));
  } catch (error) {
    next(error);
  }
});

router.post('/receiving-accounts', async (req, res, next) => {
  try {
    if (requireFields(res, ['name'], req.body)) return;
    const name = String(req.body.name || '').trim();
    const exists = await get('SELECT * FROM receiving_accounts WHERE user_id = ? AND LOWER(name) = LOWER(?)', [req.user.id, name]);
    if (exists) return res.status(409).json({ error: 'Já existe uma conta de recebimento com esse nome.' });

    const result = await run('INSERT INTO receiving_accounts (user_id, name) VALUES (?, ?)', [req.user.id, name]);
    res.status(201).json(await get('SELECT * FROM receiving_accounts WHERE id = ?', [result.id]));
  } catch (error) {
    next(error);
  }
});

router.delete('/receiving-accounts/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const inUse = await get('SELECT id FROM payments WHERE receiving_account_id = ? AND user_id = ?', [id, req.user.id]);
    if (inUse) return res.status(409).json({ error: 'Não é possível excluir: conta de recebimento em uso.' });

    await run('DELETE FROM receiving_accounts WHERE id = ? AND user_id = ?', [id, req.user.id]);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.get('/properties', async (req, res, next) => {
  try {
    const rows = await all(`
      SELECT p.*, t.name as tenant_name, m.name as manager_name
      FROM properties p
      LEFT JOIN tenants t ON t.id = p.tenant_id
      LEFT JOIN managers m ON m.id = p.manager_id
      WHERE p.user_id = ?
      ORDER BY p.name
    `, [req.user.id]);
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

router.post('/properties', async (req, res, next) => {
  try {
    if (requireFields(res, ['name', 'address'], req.body)) return;
    const { name, address, tenant_id = null, manager_id = null, rent_value = 0, notes = null } = req.body;
    const result = await run(
      'INSERT INTO properties (user_id, name, address, tenant_id, manager_id, rent_value, notes) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [req.user.id, name, address, tenant_id || null, manager_id || null, toNumber(rent_value), notes]
    );
    res.status(201).json(await get('SELECT * FROM properties WHERE id = ?', [result.id]));
  } catch (error) {
    next(error);
  }
});

router.put('/properties/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const row = await ensureOwnershipOr404(res, 'properties', id, req.user.id);
    if (!row) return;

    const {
      name = row.name,
      address = row.address,
      tenant_id = row.tenant_id,
      manager_id = row.manager_id,
      rent_value = row.rent_value,
      notes = row.notes
    } = req.body;

    await run(
      'UPDATE properties SET name = ?, address = ?, tenant_id = ?, manager_id = ?, rent_value = ?, notes = ? WHERE id = ? AND user_id = ?',
      [name, address, tenant_id || null, manager_id || null, toNumber(rent_value), notes, id, req.user.id]
    );
    res.json(await get('SELECT * FROM properties WHERE id = ?', [id]));
  } catch (error) {
    next(error);
  }
});

router.delete('/properties/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const row = await ensureOwnershipOr404(res, 'properties', id, req.user.id);
    if (!row) return;

    await run('DELETE FROM properties WHERE id = ? AND user_id = ?', [id, req.user.id]);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.get('/category-configs', async (req, res, next) => {
  try {
    const rows = await all(`
      SELECT c.*, p.name as property_name
      FROM category_configs c
      JOIN properties p ON p.id = c.property_id
      WHERE c.user_id = ?
      ORDER BY p.name, c.category_name
    `, [req.user.id]);
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

router.post('/category-configs', async (req, res, next) => {
  try {
    if (requireFields(res, ['property_id', 'category_name', 'amount', 'due_day'], req.body)) return;
    const result = await run(
      'INSERT INTO category_configs (user_id, property_id, category_name, amount, admin_fee_percent, due_day, active) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        req.user.id,
        parseId(req.body.property_id),
        req.body.category_name,
        toNumber(req.body.amount),
        toNumber(req.body.admin_fee_percent),
        Number(req.body.due_day),
        Number(req.body.active ?? 1)
      ]
    );
    res.status(201).json(await get('SELECT * FROM category_configs WHERE id = ?', [result.id]));
  } catch (error) {
    next(error);
  }
});

router.put('/category-configs/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const row = await ensureOwnershipOr404(res, 'category_configs', id, req.user.id);
    if (!row) return;

    const {
      property_id = row.property_id,
      category_name = row.category_name,
      amount = row.amount,
      admin_fee_percent = row.admin_fee_percent,
      due_day = row.due_day,
      active = row.active
    } = req.body;

    await run(
      'UPDATE category_configs SET property_id = ?, category_name = ?, amount = ?, admin_fee_percent = ?, due_day = ?, active = ? WHERE id = ? AND user_id = ?',
      [property_id, category_name, toNumber(amount), toNumber(admin_fee_percent), Number(due_day), Number(active) ? 1 : 0, id, req.user.id]
    );
    res.json(await get('SELECT * FROM category_configs WHERE id = ?', [id]));
  } catch (error) {
    next(error);
  }
});

router.delete('/category-configs/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const row = await ensureOwnershipOr404(res, 'category_configs', id, req.user.id);
    if (!row) return;

    await run('DELETE FROM category_configs WHERE id = ? AND user_id = ?', [id, req.user.id]);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.get('/launches', async (req, res, next) => {
  try {
    const { month, manager_id } = req.query;
    let sql = `
      SELECT l.*, p.name as property_name, m.name as manager_name,
             pay.received_amount, pay.payment_date, pay.fine_amount, pay.interest_amount,
             pay.admin_fee_percent as payment_admin_fee_percent,
             pay.admin_fee_amount, pay.net_received_amount
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
    if (manager_id) {
      sql += ' AND p.manager_id = ?';
      params.push(parseId(manager_id));
    }

    sql += ' ORDER BY l.due_date, p.name';
    res.json(await all(sql, params));
  } catch (error) {
    next(error);
  }
});

router.post('/launches/generate', async (req, res, next) => {
  try {
    const { month } = req.body;
    if (!month) return res.status(400).json({ error: 'month é obrigatório.' });

    const configs = await all('SELECT * FROM category_configs WHERE user_id = ? AND active = 1 ORDER BY id', [req.user.id]);
    const created = [];

    for (const cfg of configs) {
      const exists = await get('SELECT id FROM launches WHERE user_id = ? AND config_id = ? AND competence = ?', [req.user.id, cfg.id, month]);
      if (exists) continue;

      const [year, monthNum] = month.split('-').map(Number);
      const lastDay = new Date(year, monthNum, 0).getDate();
      const safeDay = Math.min(Number(cfg.due_day), lastDay);
      const dueDate = `${year}-${String(monthNum).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`;

      const result = await run(
        'INSERT INTO launches (user_id, property_id, config_id, category_name, competence, amount_expected, due_date, notes, admin_fee_percent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          req.user.id,
          cfg.property_id,
          cfg.id,
          cfg.category_name,
          month,
          toNumber(cfg.amount),
          dueDate,
          null,
          toNumber(cfg.admin_fee_percent)
        ]
      );

      created.push(await get('SELECT * FROM launches WHERE id = ?', [result.id]));
    }

    res.status(201).json({ created_count: created.length, created });
  } catch (error) {
    next(error);
  }
});

router.put('/launches/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const row = await ensureOwnershipOr404(res, 'launches', id, req.user.id);
    if (!row) return;

    const {
      amount_expected = row.amount_expected,
      due_date = row.due_date,
      notes = row.notes,
      category_name = row.category_name,
      admin_fee_percent = row.admin_fee_percent
    } = req.body;

    await run(
      'UPDATE launches SET amount_expected = ?, due_date = ?, notes = ?, category_name = ?, admin_fee_percent = ? WHERE id = ? AND user_id = ?',
      [toNumber(amount_expected), due_date, notes, category_name, toNumber(admin_fee_percent), id, req.user.id]
    );

    res.json(await get('SELECT * FROM launches WHERE id = ?', [id]));
  } catch (error) {
    next(error);
  }
});

router.delete('/launches/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const row = await ensureOwnershipOr404(res, 'launches', id, req.user.id);
    if (!row) return;

    await run('DELETE FROM launches WHERE id = ? AND user_id = ?', [id, req.user.id]);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.get('/payments', async (req, res, next) => {
  try {
    const rows = await all(`
      SELECT pay.*, l.category_name, l.competence, l.amount_expected, l.due_date, l.admin_fee_percent as launch_admin_fee_percent,
             p.name as property_name, pm.name as payment_method_name, ra.name as receiving_account_name,
             pay.rental_period_start, pay.rental_period_end, pay.receipt_file_path, pay.receipt_original_name
      FROM payments pay
      JOIN launches l ON l.id = pay.launch_id
      JOIN properties p ON p.id = l.property_id
      LEFT JOIN payment_methods pm ON pm.id = pay.payment_method_id
      LEFT JOIN receiving_accounts ra ON ra.id = pay.receiving_account_id
      WHERE pay.user_id = ?
      ORDER BY pay.payment_date DESC, pay.id DESC
    `, [req.user.id]);
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

router.post('/payments', async (req, res, next) => {
  try {
    if (requireFields(res, ['launch_id', 'payment_date'], req.body)) return;

    const launch = await get('SELECT * FROM launches WHERE id = ? AND user_id = ?', [req.body.launch_id, req.user.id]);
    if (!launch) return res.status(404).json({ error: 'Lançamento não encontrado.' });

    const totals = computePaymentTotals(launch, req.body);
    const existing = await get('SELECT id FROM payments WHERE launch_id = ? AND user_id = ?', [req.body.launch_id, req.user.id]);

    if (existing) {
      await run(
        'UPDATE payments SET received_amount = ?, fine_amount = ?, interest_amount = ?, admin_fee_percent = ?, admin_fee_amount = ?, net_received_amount = ?, payment_date = ?, payment_method_id = ?, receiving_account_id = ?, rental_period_start = ?, rental_period_end = ?, notes = ? WHERE id = ? AND user_id = ?',
        [
          totals.received_amount,
          totals.fine_amount,
          totals.interest_amount,
          totals.admin_fee_percent,
          totals.admin_fee_amount,
          totals.net_received_amount,
          req.body.payment_date,
          req.body.payment_method_id || null,
          req.body.receiving_account_id || null,
          req.body.rental_period_start || null,
          req.body.rental_period_end || null,
          req.body.notes || null,
          existing.id,
          req.user.id
        ]
      );
      return res.json(await get('SELECT * FROM payments WHERE id = ?', [existing.id]));
    }

    const result = await run(
      'INSERT INTO payments (user_id, launch_id, received_amount, fine_amount, interest_amount, admin_fee_percent, admin_fee_amount, net_received_amount, payment_date, payment_method_id, receiving_account_id, rental_period_start, rental_period_end, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        req.user.id,
        req.body.launch_id,
        totals.received_amount,
        totals.fine_amount,
        totals.interest_amount,
        totals.admin_fee_percent,
        totals.admin_fee_amount,
        totals.net_received_amount,
        req.body.payment_date,
        req.body.payment_method_id || null,
        req.body.receiving_account_id || null,
        req.body.rental_period_start || null,
        req.body.rental_period_end || null,
        req.body.notes || null
      ]
    );

    res.status(201).json(await get('SELECT * FROM payments WHERE id = ?', [result.id]));
  } catch (error) {
    next(error);
  }
});

router.post('/payments/:id/receipt', upload.single('receipt'), async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const row = await ensureOwnershipOr404(res, 'payments', id, req.user.id);
    if (!row) return;
    if (!req.file) return res.status(400).json({ error: 'Arquivo receipt é obrigatório.' });

    await run(
      'UPDATE payments SET receipt_file_path = ?, receipt_original_name = ? WHERE id = ? AND user_id = ?',
      [`/uploads/receipts/${req.file.filename}`, req.file.originalname, id, req.user.id]
    );
    res.json(await get('SELECT * FROM payments WHERE id = ?', [id]));
  } catch (error) {
    next(error);
  }
});

router.put('/payments/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const row = await ensureOwnershipOr404(res, 'payments', id, req.user.id);
    if (!row) return;

    const launch = await get('SELECT * FROM launches WHERE id = ? AND user_id = ?', [req.body.launch_id || row.launch_id, req.user.id]);
    if (!launch) return res.status(404).json({ error: 'Lançamento não encontrado.' });

    const mergedPayload = {
      fine_amount: req.body.fine_amount ?? row.fine_amount,
      interest_amount: req.body.interest_amount ?? row.interest_amount,
      admin_fee_percent: req.body.admin_fee_percent ?? row.admin_fee_percent ?? launch.admin_fee_percent
    };

    const totals = computePaymentTotals(launch, mergedPayload);

    const payment_date = req.body.payment_date || row.payment_date;
    const payment_method_id = req.body.payment_method_id !== undefined ? (req.body.payment_method_id || null) : row.payment_method_id;
    const receiving_account_id = req.body.receiving_account_id !== undefined ? (req.body.receiving_account_id || null) : row.receiving_account_id;
    const rental_period_start = req.body.rental_period_start !== undefined ? (req.body.rental_period_start || null) : row.rental_period_start;
    const rental_period_end = req.body.rental_period_end !== undefined ? (req.body.rental_period_end || null) : row.rental_period_end;
    const notes = req.body.notes !== undefined ? req.body.notes : row.notes;

    await run(
      'UPDATE payments SET launch_id = ?, received_amount = ?, fine_amount = ?, interest_amount = ?, admin_fee_percent = ?, admin_fee_amount = ?, net_received_amount = ?, payment_date = ?, payment_method_id = ?, receiving_account_id = ?, rental_period_start = ?, rental_period_end = ?, notes = ? WHERE id = ? AND user_id = ?',
      [
        launch.id,
        totals.received_amount,
        totals.fine_amount,
        totals.interest_amount,
        totals.admin_fee_percent,
        totals.admin_fee_amount,
        totals.net_received_amount,
        payment_date,
        payment_method_id,
        receiving_account_id,
        rental_period_start,
        rental_period_end,
        notes,
        id,
        req.user.id
      ]
    );

    res.json(await get('SELECT * FROM payments WHERE id = ?', [id]));
  } catch (error) {
    next(error);
  }
});

router.delete('/payments/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const row = await ensureOwnershipOr404(res, 'payments', id, req.user.id);
    if (!row) return;

    await run('DELETE FROM payments WHERE id = ? AND user_id = ?', [id, req.user.id]);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.get('/backup/export', async (req, res, next) => {
  try {
    const data = await exportUserData(req.user.id);
    res.json({
      app: 'imoveis-em-dia',
      backup_version: 2,
      exported_at: new Date().toISOString(),
      receipts_included: false,
      note: 'Este backup inclui apenas os dados do banco. Os arquivos físicos de recibo não são incluídos.',
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

    await client.query('DELETE FROM payments WHERE user_id = $1', [req.user.id]);
    await client.query('DELETE FROM launches WHERE user_id = $1', [req.user.id]);
    await client.query('DELETE FROM category_configs WHERE user_id = $1', [req.user.id]);
    await client.query('DELETE FROM properties WHERE user_id = $1', [req.user.id]);
    await client.query('DELETE FROM payment_methods WHERE user_id = $1', [req.user.id]);
    await client.query('DELETE FROM receiving_accounts WHERE user_id = $1', [req.user.id]);
    await client.query('DELETE FROM tenants WHERE user_id = $1', [req.user.id]);
    await client.query('DELETE FROM managers WHERE user_id = $1', [req.user.id]);

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
        'INSERT INTO properties (user_id, name, address, tenant_id, manager_id, rent_value, notes) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
        [
          req.user.id,
          row.name,
          row.address,
          row.tenant_id != null ? (tenantMap.get(String(row.tenant_id)) || null) : null,
          row.manager_id != null ? (managerMap.get(String(row.manager_id)) || null) : null,
          toNumber(row.rent_value),
          row.notes || null
        ]
      );
      propertyMap.set(String(row.id), result.rows[0].id);
    }

    for (const row of categoryConfigs) {
      const result = await client.query(
        'INSERT INTO category_configs (user_id, property_id, category_name, amount, admin_fee_percent, due_day, active) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
        [
          req.user.id,
          propertyMap.get(String(row.property_id)),
          row.category_name,
          toNumber(row.amount),
          toNumber(row.admin_fee_percent),
          Number(row.due_day),
          Number(row.active ?? 1) ? 1 : 0
        ]
      );
      configMap.set(String(row.id), result.rows[0].id);
    }

    for (const row of launches) {
      const configId = row.config_id != null ? (configMap.get(String(row.config_id)) || null) : null;
      const result = await client.query(
        'INSERT INTO launches (user_id, property_id, config_id, category_name, competence, amount_expected, due_date, notes, admin_fee_percent) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id',
        [
          req.user.id,
          propertyMap.get(String(row.property_id)),
          configId,
          row.category_name,
          row.competence,
          toNumber(row.amount_expected),
          row.due_date,
          row.notes || null,
          toNumber(row.admin_fee_percent)
        ]
      );
      launchMap.set(String(row.id), result.rows[0].id);
    }

    for (const row of payments) {
      const newLaunchId = launchMap.get(String(row.launch_id));
      if (!newLaunchId) continue;

      await client.query(
        'INSERT INTO payments (user_id, launch_id, received_amount, fine_amount, interest_amount, admin_fee_percent, admin_fee_amount, net_received_amount, payment_date, payment_method_id, receiving_account_id, rental_period_start, rental_period_end, receipt_file_path, receipt_original_name, notes) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)',
        [
          req.user.id,
          newLaunchId,
          toNumber(row.received_amount),
          toNumber(row.fine_amount),
          toNumber(row.interest_amount),
          toNumber(row.admin_fee_percent),
          toNumber(row.admin_fee_amount),
          toNumber(row.net_received_amount),
          row.payment_date,
          row.payment_method_id != null ? (methodMap.get(String(row.payment_method_id)) || null) : null,
          row.receiving_account_id != null ? (accountMap.get(String(row.receiving_account_id)) || null) : null,
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
      success: true,
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

router.get('/reports/monthly', async (req, res, next) => {
  try {
    const { month, manager_id } = req.query;
    if (!month) return res.status(400).json({ error: 'month é obrigatório.' });

    let sql = `
      SELECT m.name as manager_name, p.name as property_name, l.category_name, l.competence,
             l.amount_expected, l.due_date, l.admin_fee_percent as launch_admin_fee_percent,
             pay.received_amount, pay.fine_amount, pay.interest_amount,
             pay.admin_fee_percent, pay.admin_fee_amount, pay.net_received_amount,
             pay.payment_date, pay.rental_period_start, pay.rental_period_end,
             pay.receipt_original_name, pay.receipt_file_path
      FROM launches l
      JOIN properties p ON p.id = l.property_id
      LEFT JOIN managers m ON m.id = p.manager_id
      LEFT JOIN payments pay ON pay.launch_id = l.id
      WHERE l.user_id = ? AND l.competence = ?
    `;

    const params = [req.user.id, month];
    if (manager_id) {
      sql += ' AND p.manager_id = ?';
      params.push(parseId(manager_id));
    }

    sql += ' ORDER BY m.name, p.name, l.category_name';
    const rows = await all(sql, params);
    const totals = rows.reduce((acc, row) => {
      acc.expected += Number(row.amount_expected || 0);
      acc.received += Number(row.received_amount || 0);
      acc.admin_fee += Number(row.admin_fee_amount || 0);
      acc.net_received += Number(row.net_received_amount || 0);
      return acc;
    }, { expected: 0, received: 0, admin_fee: 0, net_received: 0 });

    res.json({ month, totals, rows });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
