const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL não configurada. Defina a variável de ambiente antes de iniciar o servidor.');
}

const useSsl = process.env.PGSSL === 'true';
const pool = new Pool({
  connectionString,
  ssl: useSsl ? { rejectUnauthorized: false } : false
});

function normalizeSql(sql) {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

async function run(sql, params = []) {
  const isInsert = /^\s*insert\s+/i.test(sql);
  let text = normalizeSql(sql);
  if (isInsert && !/\sreturning\s+/i.test(text)) {
    text = `${text} RETURNING id`;
  }
  const result = await pool.query(text, params);
  return {
    id: result.rows?.[0]?.id ?? null,
    changes: result.rowCount ?? 0
  };
}

async function get(sql, params = []) {
  const result = await pool.query(normalizeSql(sql), params);
  return result.rows?.[0] ?? null;
}

async function all(sql, params = []) {
  const result = await pool.query(normalizeSql(sql), params);
  return result.rows ?? [];
}

async function initDb() {
  const schemaPath = path.resolve(process.cwd(), 'database', 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  await pool.query(schema);
}

module.exports = { pool, run, get, all, initDb };
