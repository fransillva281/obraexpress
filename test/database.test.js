const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { buildRunSql, isUniqueViolation, toPostgresSql } = require('../database-utils');
const { calcularFinanceiroPedido, calcularPercentualPromocional, calcularTaxaPedidoPequeno, normalizarPlanoLoja } = require('../financial-utils');

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

test('painel administrativo trata sessão vencida e permite sair', () => {
  const admin = fs.readFileSync(path.join(__dirname, '..', 'admin', 'index.html'), 'utf8');
  assert.match(admin, /onclick="sair\(\)"/);
  assert.match(admin, /function encerrarSessao/);
  assert.match(admin, /localStorage\.removeItem\('obraexpress_admin_token'\)/);
  assert.match(admin, /resposta\.status === 401/);
  assert.match(admin, /Sua sessão venceu/);
});

test('aplica comissão promocional de 5% no plano Entrega ObraExpress', () => {
  const calculo = calcularFinanceiroPedido({
    totalProdutos: 100,
    taxaEntrega: 10,
    tipoEntrega: 'entrega',
    planoLoja: 'entrega_obraexpress',
    comissaoPercentual: 5,
    percentualEntregador: 95
  });
  assert.equal(calculo.valorComissaoLoja, 5);
  assert.equal(calculo.valorLiquidoLoja, 95);
  assert.equal(calculo.valorMotoboy, 9.5);
  assert.equal(calculo.valorPlataformaEntrega, 0.5);
  assert.equal(calculo.totalFinal, 110);
});

test('bloqueia pedido abaixo de R$ 15 e informa quanto falta', () => {
  const regra = calcularTaxaPedidoPequeno(9.99, {
    pedido_minimo: 15,
    limite_pedido_pequeno: 25,
    taxa_pedido_pequeno: 1.99
  });
  assert.equal(regra.permitido, false);
  assert.equal(regra.valorFaltante, 5.01);
  assert.equal(regra.taxaAplicada, 0);
});

test('cobra taxa apenas entre o pedido mínimo e o limite pequeno', () => {
  const configuracao = { pedido_minimo: 15, limite_pedido_pequeno: 25, taxa_pedido_pequeno: 1.99 };
  assert.equal(calcularTaxaPedidoPequeno(20, configuracao).taxaAplicada, 1.99);
  assert.equal(calcularTaxaPedidoPequeno(25, configuracao).taxaAplicada, 0);
});

test('taxa de pedido pequeno pertence à plataforma e entra no total', () => {
  const calculo = calcularFinanceiroPedido({
    totalProdutos: 20,
    taxaEntrega: 10,
    taxaPedidoPequeno: 1.99,
    tipoEntrega: 'entrega',
    planoLoja: 'entrega_obraexpress',
    comissaoPercentual: 5,
    percentualEntregador: 95
  });
  assert.equal(calculo.valorLiquidoLoja, 19);
  assert.equal(calculo.valorMotoboy, 9.5);
  assert.equal(calculo.valorPlataformaPedidoPequeno, 1.99);
  assert.equal(calculo.totalFinal, 31.99);
});

test('aplica comissão de 5% e repassa o frete no Plano Loja', () => {
  const calculo = calcularFinanceiroPedido({
    totalProdutos: 100,
    taxaEntrega: 10,
    tipoEntrega: 'entrega',
    planoLoja: 'loja',
    comissaoPercentual: 5
  });
  assert.equal(calculo.valorComissaoLoja, 5);
  assert.equal(calculo.valorLiquidoLoja, 105);
  assert.equal(calculo.valorMotoboy, 0);
  assert.equal(calculo.valorPlataformaEntrega, 0);
});

test('muda a comissão promocional de 5% para 7% após cinco meses', () => {
  assert.equal(calcularPercentualPromocional(null, new Date('2026-08-03T00:00:00Z')), 5);
  assert.equal(calcularPercentualPromocional('2026-06-01T00:00:00Z', new Date('2026-08-03T00:00:00Z')), 5);
  assert.equal(calcularPercentualPromocional('2026-01-01T00:00:00Z', new Date('2026-08-03T00:00:00Z')), 7);
});

test('plano antigo ou inválido migra para Entrega ObraExpress', () => {
  assert.equal(normalizarPlanoLoja('comissao'), 'entrega_obraexpress');
  assert.equal(normalizarPlanoLoja('loja'), 'loja');
});

test('schema contém saldo e extrato financeiro das lojas', () => {
  const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  assert.match(schema, /CREATE TABLE IF NOT EXISTS saldo_lojas/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS movimentacoes_lojas/);
  assert.match(schema, /comissao_percentual NUMERIC\(5,2\) DEFAULT 5\.00/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS configuracoes_plataforma/);
  assert.match(schema, /inicio_promocao TIMESTAMPTZ/);
});

test('GPS e frete dinâmico estão ligados nas quatro interfaces', () => {
  const raiz = path.join(__dirname, '..');
  const servidor = fs.readFileSync(path.join(raiz, 'server.js'), 'utf8');
  const cliente = fs.readFileSync(path.join(raiz, 'frontend', 'index.html'), 'utf8');
  const loja = fs.readFileSync(path.join(raiz, 'loja', 'index.html'), 'utf8');
  const entregador = fs.readFileSync(path.join(raiz, 'entregador', 'index.html'), 'utf8');
  const admin = fs.readFileSync(path.join(raiz, 'admin', 'index.html'), 'utf8');
  assert.match(servidor, /\/api\/frete\/cotacao/);
  assert.match(servidor, /calcularCotacaoFrete/);
  assert.match(cliente, /capturarLocalizacaoEntrega/);
  assert.match(loja, /atualizarLocalizacaoLoja/);
  assert.match(entregador, /Rota 1: ir até a loja/);
  assert.match(entregador, /Rota 2: ir até o cliente/);
  assert.match(admin, /configuracoes-entrega/);
});

test('pedido mínimo é configurável e validado no servidor', () => {
  const raiz = path.join(__dirname, '..');
  const schema = fs.readFileSync(path.join(raiz, 'db', 'schema.sql'), 'utf8');
  const servidor = fs.readFileSync(path.join(raiz, 'server.js'), 'utf8');
  const cliente = fs.readFileSync(path.join(raiz, 'frontend', 'index.html'), 'utf8');
  const admin = fs.readFileSync(path.join(raiz, 'admin', 'index.html'), 'utf8');
  assert.match(schema, /pedido_minimo NUMERIC\(12,2\).*DEFAULT 15\.00/);
  assert.match(schema, /taxa_pedido_pequeno NUMERIC\(12,2\).*DEFAULT 1\.99/);
  assert.match(servidor, /PEDIDO_MINIMO_NAO_ATINGIDO/);
  assert.match(servidor, /calcularTaxaPedidoPequeno\(carrinho\.totalProdutos/);
  assert.match(cliente, /Taxa de pedido pequeno/);
  assert.match(admin, /cfg-pedido-minimo/);

  const insertPedido = servidor.match(/INSERT INTO pedidos\s*\(([\s\S]*?)\)\s*VALUES\s*\(([\s\S]*?)\)/);
  assert.ok(insertPedido, 'cadastro do pedido não encontrado');
  const totalColunas = insertPedido[1].split(',').length;
  const totalValores = (insertPedido[2].match(/\?/g) || []).length;
  assert.equal(totalColunas, 29);
  assert.equal(totalValores, totalColunas);
});
