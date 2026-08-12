const test = require('node:test');
const assert = require('node:assert/strict');

const databaseUrl = process.env.TEST_DATABASE_URL;

test('PostgreSQL cria e consulta as tabelas principais', { skip: !databaseUrl }, async () => {
  process.env.DATABASE_URL = databaseUrl;
  process.env.PGSSLMODE = 'disable';
  const { databaseReady, dbGet, getDatabaseHealth, closeDatabase } = require('../database');

  try {
    await databaseReady;
    const health = await getDatabaseHealth();
    assert.equal(health.connected, true);
    assert.equal(health.database, 'postgresql');

    for (const table of ['clientes', 'lojas', 'entregadores', 'produtos', 'pedidos']) {
      const result = await dbGet(`SELECT to_regclass('public.${table}') AS tabela`);
      assert.equal(result.tabela, table);
    }
  } finally {
    await closeDatabase();
  }
});
