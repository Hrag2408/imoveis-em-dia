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
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
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
  return Number(value);
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

router.get('/dashboard', async (req, res, next) => {
  try {
    const month = req.query.month;
    const managerId = req.query.manager_id;
    if (!month) return res.status(400).json({ error: 'month é obrigatório no formato AAAA-MM.' });

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
    const result =
