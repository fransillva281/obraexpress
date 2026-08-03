const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { buildRunSql, isUniqueViolation, toPostgresSql } = require('./database-utils');

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    'DATABASE_URL não configurada. O ObraExpress exige PostgreSQL e não usa banco local temporário.'
  );
}

function shouldUseSsl(url) {
  if (process.env.PGSSLMODE === 'disable') return false;

  try {
    const hostname = new URL(url).hostname;
    return hostname !== 'localhost' && hostname !== '127.0.0.1';
  } catch {
    return true;
  }
}

const pool = new Pool({
  connectionString,
  ssl: shouldUseSsl(connectionString) ? { rejectUnauthorized: false } : false,
  max: Number(process.env.PG_POOL_MAX || 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

pool.on('error', (error) => {
  console.error('Erro inesperado no pool PostgreSQL:', error.message);
});

async function dbRun(sql, params = []) {
  const query = buildRunSql(sql);
  const result = await pool.query(query, params);
  return {
    lastID: result.rows[0]?.id,
    changes: result.rowCount
  };
}

async function dbAll(sql, params = []) {
  const result = await pool.query(toPostgresSql(sql), params);
  return result.rows;
}

async function dbGet(sql, params = []) {
  const result = await pool.query(toPostgresSql(sql), params);
  return result.rows[0];
}

async function initializeDatabase() {
  const schemaPath = path.join(__dirname, 'db', 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(schema);
    await client.query('COMMIT');
    console.log('✅ PostgreSQL conectado; tabelas e migrações verificadas');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function getDatabaseHealth() {
  await databaseReady;
  const result = await pool.query(
    'SELECT current_database() AS name, CURRENT_TIMESTAMP AS checked_at'
  );

  return {
    status: 'ok',
    database: 'postgresql',
    connected: true,
    checked_at: result.rows[0].checked_at
  };
}

const databaseReady = initializeDatabase();

module.exports = {
  databaseReady,
  dbAll,
  dbGet,
  dbRun,
  getDatabaseHealth,
  isUniqueViolation
};
