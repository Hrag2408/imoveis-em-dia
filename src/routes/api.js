const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { all, get, run, pool } = require('../config/db');
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

function calcAdminFeeValues(receivedAmount, adminFeePercent) {
  const received = Number(receivedAmount || 0);
  const percent = Number(adminFeePercent || 0);
  const adminFeeAmount = Number(((received * percent) / 100).toFixed(2));
  const netReceivedAmount = Number((received - adminFeeAmount).toFixed(2));

  return {
    admin_fee_percent: percent,
    admin_fee_amount: adminFeeAmount,
    net_received_amount: netReceivedAmount
  };
}

async function hasColumn(db, tableName, columnName) {
  const result = await db.query(
    `SELECT 1
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
        AND column_name = $2
      LIMIT 1`,
    [tableName, columnName]
  );
  return result.rowCount > 0;
}

/* =========================
   DASHBOARD
========================= */

router.get('/dashboard', async (req, res, next) => {
  try {
    const month = req.query.month;
    const managerId = req.query.manager_id;

    if (!month) {
      return res.status(400).json({ error: 'month é obrigatório no formato AAAA-MM.' });
    }

    let sql = `
      SELECT l.*, p.name as property_name, m.name as manager_name, t.name as tenant_name,
             pay.received_amount, pay.payment_date
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

/* =========================
   TENANTS
========================= */

router.get('/tenants', async (req, res, next) => {
  try {
    const rows = await all('SELECT * FROM tenants WHERE user_id = ? ORDER BY name', [req.user.id]);
    res.json(rows);
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

/* =========================
   MANAGERS
========================= */

router.get('/managers', async (req, res, next) => {
  try {
    const rows = await all('SELECT * FROM managers WHERE user_id = ? ORDER BY name', [req.user.id]);
    res.json(rows);
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

/* =========================
   PAYMENT METHODS
========================= */

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

    const result = await run(
      'INSERT INTO payment_methods (user_id, name) VALUES (?, ?)',
      [req.user.id, req.body.name]
    );

    res.status(201).json(await get('SELECT * FROM payment_methods WHERE id = ?', [result.id]));
  } catch (error) {
    next(error);
  }
});

router.delete('/payment-methods/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const inUse = await get('SELECT id FROM payments WHERE payment_method_id = ? AND user_id = ?', [id, req.user.id]);

    if (inUse) {
      return res.status(409).json({ error: 'Não é possível excluir: meio de pagamento em uso.' });
    }

    await run('DELETE FROM payment_methods WHERE id = ? AND user_id = ?', [id, req.user.id]);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

/* =========================
   RECEIVING ACCOUNTS
========================= */

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

    const result = await run(
      'INSERT INTO receiving_accounts (user_id, name) VALUES (?, ?)',
      [req.user.id, req.body.name]
    );

    res.status(201).json(await get('SELECT * FROM receiving_accounts WHERE id = ?', [result.id]));
  } catch (error) {
    next(error);
  }
});

router.delete('/receiving-accounts/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const inUse = await get('SELECT id FROM payments WHERE receiving_account_id = ? AND user_id = ?', [id, req.user.id]);

    if (inUse) {
      return res.status(409).json({ error: 'Não é possível excluir: conta de recebimento em uso.' });
    }

    await run('DELETE FROM receiving_accounts WHERE id = ? AND user_id = ?', [id, req.user.id]);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

/* =========================
   PROPERTIES
========================= */

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
      [req.user.id, name, address, tenant_id || null, manager_id || null, Number(rent_value || 0), notes]
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
      [name, address, tenant_id || null, manager_id || null, Number(rent_value || 0), notes, id, req.user.id]
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

/* =========================
   CATEGORY CONFIGS
========================= */

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

    const {
      property_id,
      category_name,
      amount,
      admin_fee_percent = 0,
      due_day,
      active = 1
    } = req.body;

    const result = await run(
      'INSERT INTO category_configs (user_id, property_id, category_name, amount, admin_fee_percent, due_day, active) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        req.user.id,
        parseId(property_id),
        category_name,
        Number(amount || 0),
        Number(admin_fee_percent || 0),
        Number(due_day || 1),
        Number(active ? 1 : 0)
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
      admin_fee_percent = row.admin_fee_percent || 0,
      due_day = row.due_day,
      active = row.active
    } = req.body;

    await run(
      'UPDATE category_configs SET property_id = ?, category_name = ?, amount = ?, admin_fee_percent = ?, due_day = ?, active = ? WHERE id = ? AND user_id = ?',
      [
        parseId(property_id),
        category_name,
        Number(amount || 0),
        Number(admin_fee_percent || 0),
        Number(due_day || 1),
        Number(active ? 1 : 0),
        id,
        req.user.id
      ]
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

/* =========================
   LAUNCHES
========================= */

router.get('/launches', async (req, res, next) => {
  try {
    const { month, manager_id } = req.query;

    let sql = `
      SELECT l.*, p.name as property_name, m.name as manager_name, pay.received_amount, pay.payment_date
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

    const configs = await all(
      'SELECT * FROM category_configs WHERE user_id = ? AND active = 1',
      [req.user.id]
    );

    const created = [];

    for (const cfg of configs) {
      const exists = await get(
        'SELECT id FROM launches WHERE user_id = ? AND config_id = ? AND competence = ?',
        [req.user.id, cfg.id, month]
      );

      if (!exists) {
        const dueDate = (() => {
          const [year, monthNum] = month.split('-').map(Number);
          const lastDay = new Date(year, monthNum, 0).getDate();
          const safeDay = Math.min(Number(cfg.due_day), lastDay);
          return `${year}-${String(monthNum).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`;
        })();

        const result = await run(
          'INSERT INTO launches (user_id, property_id, config_id, category_name, competence, amount_expected, due_date, notes, admin_fee_percent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [
            req.user.id,
            cfg.property_id,
            cfg.id,
            cfg.category_name,
            month,
            Number(cfg.amount || 0),
            dueDate,
            null,
            Number(cfg.admin_fee_percent || 0)
          ]
        );

        created.push(await get('SELECT * FROM launches WHERE id = ?', [result.id]));
      }
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
      admin_fee_percent = row.admin_fee_percent || 0
    } = req.body;

    await run(
      'UPDATE launches SET amount_expected = ?, due_date = ?, notes = ?, category_name = ?, admin_fee_percent = ? WHERE id = ? AND user_id = ?',
      [
        Number(amount_expected || 0),
        due_date,
        notes,
        category_name,
        Number(admin_fee_percent || 0),
        id,
        req.user.id
      ]
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

/* =========================
   PAYMENTS
========================= */

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
    if (requireFields(res, ['launch_id', 'received_amount', 'payment_date'], req.body)) return;

    const launch = await get(
      'SELECT * FROM launches WHERE id = ? AND user_id = ?',
      [req.body.launch_id, req.user.id]
    );

    if (!launch) {
      return res.status(404).json({ error: 'Lançamento não encontrado.' });
    }

    const feeValues = calcAdminFeeValues(
      req.body.received_amount,
      launch.admin_fee_percent || 0
    );

    const existing = await get(
      'SELECT id FROM payments WHERE launch_id = ? AND user_id = ?',
      [req.body.launch_id, req.user.id]
    );

    if (existing) {
      await run(
        'UPDATE payments SET received_amount = ?, payment_date = ?, payment_method_id = ?, receiving_account_id = ?, rental_period_start = ?, rental_period_end = ?, notes = ?, admin_fee_percent = ?, admin_fee_amount = ?, net_received_amount = ? WHERE id = ? AND user_id = ?',
        [
          Number(req.body.received_amount || 0),
          req.body.payment_date,
          req.body.payment_method_id || null,
          req.body.receiving_account_id || null,
          req.body.rental_period_start || null,
          req.body.rental_period_end || null,
          req.body.notes || null,
          feeValues.admin_fee_percent,
          feeValues.admin_fee_amount,
          feeValues.net_received_amount,
          existing.id,
          req.user.id
        ]
      );

      return res.json(await get('SELECT * FROM payments WHERE id = ?', [existing.id]));
    }

    const result = await run(
      'INSERT INTO payments (user_id, launch_id, received_amount, payment_date, payment_method_id, receiving_account_id, rental_period_start, rental_period_end, notes, admin_fee_percent, admin_fee_amount, net_received_amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        req.user.id,
        req.body.launch_id,
        Number(req.body.received_amount || 0),
        req.body.payment_date,
        req.body.payment_method_id || null,
        req.body.receiving_account_id || null,
        req.body.rental_period_start || null,
        req.body.rental_period_end || null,
        req.body.notes || null,
        feeValues.admin_fee_percent,
        feeValues.admin_fee_amount,
        feeValues.net_received_amount
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

    if (!req.file) {
      return res.status(400).json({ error: 'Arquivo receipt é obrigatório.' });
    }

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

    const launch = await get(
      'SELECT * FROM launches WHERE id = ? AND user_id = ?',
      [row.launch_id, req.user.id]
    );

    if (!launch) {
      return res.status(404).json({ error: 'Lançamento não encontrado.' });
    }

    const received_amount = req.body.received_amount !== undefined ? req.body.received_amount : row.received_amount;
    const payment_date = req.body.payment_date || row.payment_date;
    const payment_method_id = req.body.payment_method_id !== undefined ? (req.body.payment_method_id || null) : row.payment_method_id;
    const receiving_account_id = req.body.receiving_account_id !== undefined ? (req.body.receiving_account_id || null) : row.receiving_account_id;
    const rental_period_start = req.body.rental_period_start !== undefined ? (req.body.rental_period_start || null) : row.rental_period_start;
    const rental_period_end = req.body.rental_period_end !== undefined ? (req.body.rental_period_end || null) : row.rental_period_end;
    const notes = req.body.notes !== undefined ? (req.body.notes || null) : row.notes;

    const feeValues = calcAdminFeeValues(
      received_amount,
      launch.admin_fee_percent || row.admin_fee_percent || 0
    );

    await run(
      'UPDATE payments SET received_amount = ?, payment_date = ?, payment_method_id = ?, receiving_account_id = ?, rental_period_start = ?, rental_period_end = ?, notes = ?, admin_fee_percent = ?, admin_fee_amount = ?, net_received_amount = ? WHERE id = ? AND user_id = ?',
      [
        Number(received_amount || 0),
        payment_date,
        payment_method_id,
        receiving_account_id,
        rental_period_start,
        rental_period_end,
        notes,
        feeValues.admin_fee_percent,
        feeValues.admin_fee_amount,
        feeValues.net_received_amount,
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

/* =========================
   BACKUP EXPORT / IMPORT
========================= */

router.get('/backup/export', async (req, res, next) => {
  try {
    const hasConfigAdminFee = await hasColumn(pool, 'category_configs', 'admin_fee_percent');
    const hasLaunchAdminFee = await hasColumn(pool, 'launches', 'admin_fee_percent');
    const hasPaymentAdminFeePercent = await hasColumn(pool, 'payments', 'admin_fee_percent');
    const hasPaymentAdminFeeAmount = await hasColumn(pool, 'payments', 'admin_fee_amount');
    const hasPaymentNetReceivedAmount = await hasColumn(pool, 'payments', 'net_received_amount');

    const [
      tenants,
      managers,
      paymentMethods,
      receivingAccounts,
      properties,
      categoryConfigs,
      launches,
      payments
    ] = await Promise.all([
      all('SELECT id, name, phone, email, notes, created_at FROM tenants WHERE user_id = ? ORDER BY id', [req.user.id]),
      all('SELECT id, name, phone, email, notes, created_at FROM managers WHERE user_id = ? ORDER BY id', [req.user.id]),
      all('SELECT id, name, created_at FROM payment_methods WHERE user_id = ? ORDER BY id', [req.user.id]),
      all('SELECT id, name, created_at FROM receiving_accounts WHERE user_id = ? ORDER BY id', [req.user.id]),
      all('SELECT id, name, address, tenant_id, manager_id, rent_value, notes, created_at FROM properties WHERE user_id = ? ORDER BY id', [req.user.id]),
      all(
        `SELECT id, property_id, category_name, amount, due_day, active${hasConfigAdminFee ? ', admin_fee_percent' : ''}, created_at
         FROM category_configs
         WHERE user_id = ?
         ORDER BY id`,
        [req.user.id]
      ),
      all(
        `SELECT id, property_id, config_id, category_name, competence, amount_expected, due_date, notes${hasLaunchAdminFee ? ', admin_fee_percent' : ''}, created_at
         FROM launches
         WHERE user_id = ?
         ORDER BY id`,
        [req.user.id]
      ),
      all(
        `SELECT id, launch_id, received_amount, payment_date, payment_method_id, receiving_account_id, rental_period_start, rental_period_end, notes${hasPaymentAdminFeePercent ? ', admin_fee_percent' : ''}${hasPaymentAdminFeeAmount ? ', admin_fee_amount' : ''}${hasPaymentNetReceivedAmount ? ', net_received_amount' : ''}
         FROM payments
         WHERE user_id = ?
         ORDER BY id`,
        [req.user.id]
      )
    ]);

    res.json({
      app: 'imoveis-em-dia',
      backup_version: 1,
      exported_at: new Date().toISOString(),
      note: 'Este backup JSON não inclui os arquivos físicos dos recibos enviados.',
      data: {
        tenants,
        managers,
        payment_methods: paymentMethods,
        receiving_accounts: receivingAccounts,
        properties,
        category_configs: categoryConfigs,
        launches,
        payments
      }
    });
  } catch (error) {
    next(error);
  }
});

router.post('/backup/import', async (req, res, next) => {
  const client = await pool.connect();
  let transactionStarted = false;

  try {
    const payload = req.body && typeof req.body === 'object' ? req.body : null;
    if (!payload) {
      return res.status(400).json({ error: 'Arquivo JSON inválido.' });
    }

    const data = payload.data && typeof payload.data === 'object' ? payload.data : payload;

    const tenants = Array.isArray(data.tenants) ? data.tenants : [];
    const managers = Array.isArray(data.managers) ? data.managers : [];
    const paymentMethods = Array.isArray(data.payment_methods) ? data.payment_methods : [];
    const receivingAccounts = Array.isArray(data.receiving_accounts) ? data.receiving_accounts : [];
    const properties = Array.isArray(data.properties) ? data.properties : [];
    const categoryConfigs = Array.isArray(data.category_configs) ? data.category_configs : [];
    const launches = Array.isArray(data.launches) ? data.launches : [];
    const payments = Array.isArray(data.payments) ? data.payments : [];

    const hasConfigAdminFee = await hasColumn(client, 'category_configs', 'admin_fee_percent');
    const hasLaunchAdminFee = await hasColumn(client, 'launches', 'admin_fee_percent');
    const hasPaymentAdminFeePercent = await hasColumn(client, 'payments', 'admin_fee_percent');
    const hasPaymentAdminFeeAmount = await hasColumn(client, 'payments', 'admin_fee_amount');
    const hasPaymentNetReceivedAmount = await hasColumn(client, 'payments', 'net_received_amount');

    await client.query('BEGIN');
    transactionStarted = true;

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
    const paymentMethodMap = new Map();
    const receivingAccountMap = new Map();
    const propertyMap = new Map();
    const configMap = new Map();
    const launchMap = new Map();
    const launchPercentMap = new Map();

    for (const item of tenants) {
      const result = await client.query(
        'INSERT INTO tenants (user_id, name, phone, email, notes) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [req.user.id, item.name, item.phone || null, item.email || null, item.notes || null]
      );
      tenantMap.set(Number(item.id), result.rows[0].id);
    }

    for (const item of managers) {
      const result = await client.query(
        'INSERT INTO managers (user_id, name, phone, email, notes) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [req.user.id, item.name, item.phone || null, item.email || null, item.notes || null]
      );
      managerMap.set(Number(item.id), result.rows[0].id);
    }

    for (const item of paymentMethods) {
      const result = await client.query(
        'INSERT INTO payment_methods (user_id, name) VALUES ($1, $2) RETURNING id',
        [req.user.id, item.name]
      );
      paymentMethodMap.set(Number(item.id), result.rows[0].id);
    }

    for (const item of receivingAccounts) {
      const result = await client.query(
        'INSERT INTO receiving_accounts (user_id, name) VALUES ($1, $2) RETURNING id',
        [req.user.id, item.name]
      );
      receivingAccountMap.set(Number(item.id), result.rows[0].id);
    }

    for (const item of properties) {
      const result = await client.query(
        `INSERT INTO properties (user_id, name, address, tenant_id, manager_id, rent_value, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          req.user.id,
          item.name,
          item.address,
          item.tenant_id ? (tenantMap.get(Number(item.tenant_id)) || null) : null,
          item.manager_id ? (managerMap.get(Number(item.manager_id)) || null) : null,
          Number(item.rent_value || 0),
          item.notes || null
        ]
      );
      propertyMap.set(Number(item.id), result.rows[0].id);
    }

    for (const item of categoryConfigs) {
      const newPropertyId = propertyMap.get(Number(item.property_id));
      if (!newPropertyId) continue;

      const columns = ['user_id', 'property_id', 'category_name', 'amount', 'due_day', 'active'];
      const values = [
        req.user.id,
        newPropertyId,
        item.category_name,
        Number(item.amount || 0),
        Number(item.due_day || 1),
        Number(item.active ? 1 : 0)
      ];

      if (hasConfigAdminFee) {
        columns.push('admin_fee_percent');
        values.push(Number(item.admin_fee_percent || 0));
      }

      const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
      const result = await client.query(
        `INSERT INTO category_configs (${columns.join(', ')})
         VALUES (${placeholders})
         RETURNING id`,
        values
      );

      configMap.set(Number(item.id), result.rows[0].id);
    }

    for (const item of launches) {
      const newPropertyId = propertyMap.get(Number(item.property_id));
      if (!newPropertyId) continue;

      const newConfigId = item.config_id ? (configMap.get(Number(item.config_id)) || null) : null;

      const columns = ['user_id', 'property_id', 'config_id', 'category_name', 'competence', 'amount_expected', 'due_date', 'notes'];
      const values = [
        req.user.id,
        newPropertyId,
        newConfigId,
        item.category_name,
        item.competence,
        Number(item.amount_expected || 0),
        item.due_date,
        item.notes || null
      ];

      const launchPercent = Number(item.admin_fee_percent || 0);

      if (hasLaunchAdminFee) {
        columns.push('admin_fee_percent');
        values.push(launchPercent);
      }

      const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
      const result = await client.query(
        `INSERT INTO launches (${columns.join(', ')})
         VALUES (${placeholders})
         RETURNING id`,
        values
      );

      launchMap.set(Number(item.id), result.rows[0].id);
      launchPercentMap.set(Number(item.id), launchPercent);
    }

    for (const item of payments) {
      const newLaunchId = launchMap.get(Number(item.launch_id));
      if (!newLaunchId) continue;

      const receivedAmount = Number(item.received_amount || 0);
      const adminFeePercent = Number(
        item.admin_fee_percent != null
          ? item.admin_fee_percent
          : (launchPercentMap.get(Number(item.launch_id)) || 0)
      );

      const defaultFee = calcAdminFeeValues(receivedAmount, adminFeePercent);

      const adminFeeAmount = Number(
        item.admin_fee_amount != null
          ? item.admin_fee_amount
          : defaultFee.admin_fee_amount
      );

      const netReceivedAmount = Number(
        item.net_received_amount != null
          ? item.net_received_amount
          : defaultFee.net_received_amount
      );

      const columns = [
        'user_id',
        'launch_id',
        'received_amount',
        'payment_date',
        'payment_method_id',
        'receiving_account_id',
        'rental_period_start',
        'rental_period_end',
        'notes'
      ];

      const values = [
        req.user.id,
        newLaunchId,
        receivedAmount,
        item.payment_date,
        item.payment_method_id ? (paymentMethodMap.get(Number(item.payment_method_id)) || null) : null,
        item.receiving_account_id ? (receivingAccountMap.get(Number(item.receiving_account_id)) || null) : null,
        item.rental_period_start || null,
        item.rental_period_end || null,
        item.notes || null
      ];

      if (hasPaymentAdminFeePercent) {
        columns.push('admin_fee_percent');
        values.push(adminFeePercent);
      }

      if (hasPaymentAdminFeeAmount) {
        columns.push('admin_fee_amount');
        values.push(adminFeeAmount);
      }

      if (hasPaymentNetReceivedAmount) {
        columns.push('net_received_amount');
        values.push(netReceivedAmount);
      }

      const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');

      await client.query(
        `INSERT INTO payments (${columns.join(', ')})
         VALUES (${placeholders})`,
        values
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
    if (transactionStarted) {
      try {
        await client.query('ROLLBACK');
      } catch (_) {}
    }
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
    const { month, manager_id } = req.query;

    if (!month) {
      return res.status(400).json({ error: 'month é obrigatório.' });
    }

    let sql = `
      SELECT m.name as manager_name, p.name as property_name, l.category_name, l.competence,
             l.amount_expected, l.due_date, pay.received_amount, pay.payment_date,
             pay.rental_period_start, pay.rental_period_end, pay.receipt_original_name, pay.receipt_file_path
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
      return acc;
    }, { expected: 0, received: 0 });

    res.json({ month, totals, rows });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
