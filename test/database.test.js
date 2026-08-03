const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { buildRunSql, isUniqueViolation, toPostgresSql } = require('../database-utils');
const { calcularFinanceiroPedido, normalizarPlanoLoja } = require('../financial-utils');

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

test('catálogo oficial possui 19 categorias diferentes e proteção contra repetição', () => {
  const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  const insert = schema.match(/INSERT INTO categorias \(nome, icone, ordem\) VALUES([\s\S]*?)ON CONFLICT DO NOTHING;/);
  assert.ok(insert, 'catálogo de categorias não encontrado');
  const nomes = [...insert[1].matchAll(/\('([^']+)',\s*'[^']+',\s*\d+\)/g)].map(match => match[1]);
  assert.equal(nomes.length, 19);
  assert.equal(new Set(nomes.map(nome => nome.toLocaleLowerCase('pt-BR'))).size, 19);
  assert.match(schema, /CREATE UNIQUE INDEX IF NOT EXISTS categorias_nome_unico/);
  assert.match(schema, /UPDATE categorias SET ativa = 0/);
  assert.match(schema, /Parafusos, Porcas e Arruelas/);
  assert.doesNotMatch(insert[1], /Cimento e Argamassa|Areia e Brita|Tijolos e Blocos/);
});

test('comparação de produtos e alertas sonoros estão presentes nos painéis', () => {
  const raiz = path.join(__dirname, '..');
  const cliente = fs.readFileSync(path.join(raiz, 'frontend', 'index.html'), 'utf8');
  const loja = fs.readFileSync(path.join(raiz, 'loja', 'index.html'), 'utf8');
  const entregador = fs.readFileSync(path.join(raiz, 'entregador', 'index.html'), 'utf8');
  assert.match(cliente, /ordem=menor_preco/);
  assert.match(cliente, /MENOR PREÇO DA LISTA/);
  assert.match(loja, /alerta-som-loja/);
  assert.match(entregador, /alerta-som-entregador/);
});

test('cliente possui categorias em grade e busca por produto, loja ou categoria', () => {
  const raiz = path.join(__dirname, '..');
  const cliente = fs.readFileSync(path.join(raiz, 'frontend', 'index.html'), 'utf8');
  const servidor = fs.readFileSync(path.join(raiz, 'server.js'), 'utf8');
  assert.match(cliente, /class="category-grid"/);
  assert.match(cliente, /Busque por produto, loja ou categoria/);
  assert.match(cliente, /api\('\/api\/lojas\?busca=/);
  assert.match(cliente, /renderResultadosBusca/);
  assert.match(servidor, /l\.nome ILIKE \?/);
  assert.match(servidor, /categorias ILIKE \?/);
});

test('aplica comissão inicial de 10% no plano Entrega ObraExpress', () => {
  const calculo = calcularFinanceiroPedido({
    totalProdutos: 100,
    taxaEntrega: 10,
    tipoEntrega: 'entrega',
    planoLoja: 'entrega_obraexpress',
    comissaoPercentual: 10,
    percentualEntregador: 85
  });
  assert.equal(calculo.valorComissaoLoja, 10);
  assert.equal(calculo.valorLiquidoLoja, 90);
  assert.equal(calculo.valorMotoboy, 8.5);
  assert.equal(calculo.valorPlataformaEntrega, 1.5);
  assert.equal(calculo.totalFinal, 110);
});

test('aplica comissão de 10% e repassa o frete no Plano Loja', () => {
  const calculo = calcularFinanceiroPedido({
    totalProdutos: 100,
    taxaEntrega: 10,
    tipoEntrega: 'entrega',
    planoLoja: 'loja',
    comissaoPercentual: 10
  });
  assert.equal(calculo.valorComissaoLoja, 10);
  assert.equal(calculo.valorLiquidoLoja, 100);
  assert.equal(calculo.valorMotoboy, 0);
  assert.equal(calculo.valorPlataformaEntrega, 0);
});

test('plano antigo ou inválido migra para Entrega ObraExpress', () => {
  assert.equal(normalizarPlanoLoja('comissao'), 'entrega_obraexpress');
  assert.equal(normalizarPlanoLoja('loja'), 'loja');
});

test('schema contém saldo e extrato financeiro das lojas', () => {
  const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  assert.match(schema, /CREATE TABLE IF NOT EXISTS saldo_lojas/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS movimentacoes_lojas/);
  assert.match(schema, /comissao_percentual NUMERIC\(5,2\) DEFAULT 10\.00/);
});
