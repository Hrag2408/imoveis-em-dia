const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { run, get } = require('../config/db');
const { authRequired } = require('../middleware/auth');
require('dotenv').config();

const router = express.Router();

async function seedDefaultLookups(userId) {
  const methodNames = ['Pix', 'Dinheiro', 'Transferência', 'Boleto'];
  const accountNames = ['Conta Hélio Itaú', 'Conta Hélio Santander', 'Caixa'];
  for (const name of methodNames) {
    await run('INSERT INTO payment_methods (user_id, name) VALUES (?, ?)', [userId, name]);
  }
  for (const name of accountNames) {
    await run('INSERT INTO receiving_accounts (user_id, name) VALUES (?, ?)', [userId, name]);
  }
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas. Tente novamente em alguns minutos.' }
});

router.post('/register', authLimiter, async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'name, email e password são obrigatórios.' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres.' });
    }

    const exists = await get('SELECT id FROM users WHERE email = ?', [email.toLowerCase()]);
    if (exists) {
      return res.status(409).json({ error: 'E-mail já cadastrado.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await run(
      'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)',
      [name, email.toLowerCase(), passwordHash]
    );
    await seedDefaultLookups(result.id);

    return res.status(201).json({ id: result.id, name, email: email.toLowerCase() });
  } catch (error) {
    next(error);
  }
});

router.post('/login', authLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'email e password são obrigatórios.' });
    }

    const user = await get('SELECT * FROM users WHERE email = ?', [email.toLowerCase()]);
    if (!user) {
      return res.status(401).json({ error: 'Credenciais inválidas.' });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Credenciais inválidas.' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name },
      process.env.JWT_SECRET || 'troque-esta-chave',
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    return res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email }
    });
  } catch (error) {
    next(error);
  }
});

router.get('/me', authRequired, async (req, res, next) => {
  try {
    const user = await get('SELECT id, name, email, created_at FROM users WHERE id = ?', [req.user.id]);
    return res.json(user);
  } catch (error) {
    next(error);
  }
});

module.exports = router;