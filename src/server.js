const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const { initDb, get, run } = require('./config/db');
const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }));
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());
app.use(morgan('dev'));

const uploadsRoot = path.resolve(process.env.UPLOAD_ROOT || path.join(process.cwd(), 'uploads'));
const receiptsDir = path.resolve(process.env.UPLOAD_DIR || path.join(uploadsRoot, 'receipts'));
fs.mkdirSync(receiptsDir, { recursive: true });
app.use('/uploads', express.static(uploadsRoot));
app.use(express.static(path.resolve(process.cwd(), 'public')));

app.get('/health', async (req, res) => {
  res.json({ ok: true, service: 'imoveis-em-dia-render-postgres' });
});

app.use('/api/auth', authRoutes);
app.use('/api', apiRoutes);

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next();
  res.sendFile(path.resolve(process.cwd(), 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Erro interno do servidor.', detail: err.message });
});

async function ensureDemoUser() {
  const email = 'admin@teste.com';
  let user = await get('SELECT id FROM users WHERE email = ?', [email]);
  if (!user) {
    const hash = await bcrypt.hash('123456', 10);
    const result = await run('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)', ['Administrador Demo', email, hash]);
    user = { id: result.id };
  }

  const methodNames = ['Pix', 'Dinheiro', 'Transferência', 'Boleto'];
  const accountNames = ['Conta Hélio Itaú', 'Conta Hélio Santander', 'Caixa'];
  for (const name of methodNames) {
    const exists = await get('SELECT id FROM payment_methods WHERE user_id = ? AND name = ?', [user.id, name]);
    if (!exists) await run('INSERT INTO payment_methods (user_id, name) VALUES (?, ?)', [user.id, name]);
  }
  for (const name of accountNames) {
    const exists = await get('SELECT id FROM receiving_accounts WHERE user_id = ? AND name = ?', [user.id, name]);
    if (!exists) await run('INSERT INTO receiving_accounts (user_id, name) VALUES (?, ?)', [user.id, name]);
  }
}

async function start() {
  await initDb();
  await ensureDemoUser();

  if (process.argv.includes('--seed-only')) {
    console.log('Banco inicializado com usuário demo.');
    process.exit(0);
  }

  app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
  });
}

start().catch((error) => {
  console.error('Falha ao iniciar servidor:', error);
  process.exit(1);
});
