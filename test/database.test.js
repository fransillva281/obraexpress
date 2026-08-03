const test = require('node:test');
const assert = require('node:assert/strict');

const { buildRunSql, isUniqueViolation, toPostgresSql } = require('../database-utils');

test('converte placeholders para o formato do PostgreSQL', () => {
  assert.equal(
    toPostgresSql('SELECT * FROM pedidos WHERE cliente_id = ? AND status = ?'),
    'SELECT * FROM pedidos WHERE cliente_id = $1 AND status = $2'
  );
});

test('reconhece violação de campo único do PostgreSQL', () => {
  assert.equal(isUniqueViolation({ code: '23505' }), true);
  assert.equal(isUniqueViolation({ code: '23503' }), false);
});

test('mantém ON CONFLICT e adiciona retorno do id no cadastro', () => {
  assert.equal(
    buildRunSql('INSERT INTO saldo_entregadores (entregador_id) VALUES (?) ON CONFLICT (entregador_id) DO NOTHING'),
    'INSERT INTO saldo_entregadores (entregador_id) VALUES ($1) ON CONFLICT (entregador_id) DO NOTHING RETURNING id'
  );
});
