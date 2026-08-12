const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { buildRunSql, isUniqueViolation, toPostgresSql } = require('../database-utils');
const { calcularFinanceiroPedido, calcularFretePorFaixa, calcularGanhoLiquidoEntregador, calcularPercentualPromocional, calcularTaxaPedidoPequeno, normalizarPlanoLoja } = require('../financial-utils');
const { criarReferenciaPagamentoTeste, pagamentoExpirado } = require('../payment-utils');
const { calcularJanelaOfertaEntrega } = require('../dispatch-utils');
const { validarCPF, validarCNPJ } = require('../document-validator');
const {
  gerarCodigoRecuperacao,
  criarHashCodigo,
  codigoFormatoValido,
  normalizarTipoConta
} = require('../password-reset-utils');

test('recuperação de senha gera código temporário protegido', () => {
  const codigo = gerarCodigoRecuperacao();
  assert.match(codigo, /^\d{6}$/);
  assert.equal(codigoFormatoValido(codigo), true);
  assert.equal(codigoFormatoValido('12345'), false);
  assert.equal(normalizarTipoConta('LOJA'), 'loja');
  assert.equal(normalizarTipoConta('admin'), null);
  const hash = criarHashCodigo({ tipo:'cliente', usuarioId:7, codigo, segredo:'segredo-de-teste' });
  assert.equal(hash.length, 64);
  assert.doesNotMatch(hash, new RegExp(codigo));
});

test('recuperação de senha existe nos três painéis e invalida sessões antigas', () => {
  const raiz = path.join(__dirname, '..');
  const schema = fs.readFileSync(path.join(raiz, 'db', 'schema.sql'), 'utf8');
  const servidor = fs.readFileSync(path.join(raiz, 'server.js'), 'utf8');
  assert.match(schema, /CREATE TABLE IF NOT EXISTS recuperacoes_senha/);
  assert.match(schema, /sessao_versao INTEGER NOT NULL DEFAULT 1/);
  assert.match(servidor, /\/api\/auth\/recuperacao-senha\/solicitar/);
  assert.match(servidor, /\/api\/auth\/recuperacao-senha\/redefinir/);
  assert.match(servidor, /sessao_versao = COALESCE\(sessao_versao, 1\) \+ 1/);
  assert.match(servidor, /MENSAGEM_RECUPERACAO/);
  assert.match(servidor, /DELETE FROM recuperacoes_senha/);
  assert.match(servidor, /MAX_TENTATIVAS_CODIGO/);
  for (const arquivo of ['frontend/index.html', 'loja/index.html', 'entregador/index.html']) {
    const painel = fs.readFileSync(path.join(raiz, arquivo), 'utf8');
    assert.match(painel, /Esqueci minha senha/);
    assert.match(painel, /recuperacao-senha\/solicitar/);
    assert.match(painel, /recuperacao-senha\/redefinir/);
  }
});

test('valida os dígitos verificadores de CPF e CNPJ', () => {
  assert.equal(validarCPF('529.982.247-25'), true);
  assert.equal(validarCPF('529.982.247-24'), false);
  assert.equal(validarCPF('111.111.111-11'), false);
  assert.equal(validarCNPJ('11.222.333/0001-81'), true);
  assert.equal(validarCNPJ('11.222.333/0001-82'), false);
  assert.equal(validarCNPJ('00.000.000/0000-00'), false);
});

test('central de privacidade protege direitos e bloqueia biometria sem provedor', () => {
  const raiz = path.join(__dirname, '..');
  const schema = fs.readFileSync(path.join(raiz, 'db', 'schema.sql'), 'utf8');
  const servidor = fs.readFileSync(path.join(raiz, 'server.js'), 'utf8');
  const central = fs.readFileSync(path.join(raiz, 'frontend', 'privacidade.html'), 'utf8');
  const admin = fs.readFileSync(path.join(raiz, 'admin', 'index.html'), 'utf8');
  assert.match(schema, /CREATE TABLE IF NOT EXISTS solicitacoes_privacidade/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS verificacoes_identidade/);
  assert.match(servidor, /\/api\/privacidade\/exportar/);
  assert.match(servidor, /\/api\/privacidade\/solicitacoes/);
  assert.match(servidor, /coleta_biometrica_ativa: false/);
  assert.match(central, /Baixar uma cópia dos meus dados/);
  assert.match(central, /não permite enviar CNH, selfie ou biometria/i);
  assert.match(admin, /Solicitações dos titulares/);
  assert.match(admin, /Documentos e reconhecimento facial/);
});

test('politica de seguranca permite os cliques usados pelos paineis atuais', () => {
  const servidor = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const cliente = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'index.html'), 'utf8');
  assert.match(cliente, /onclick=/);
  assert.match(servidor, /scriptSrcAttr:\s*\["'unsafe-inline'"\]/);
});

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
  assert.match(cliente, /ordem:'menor_preco'/);
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
  assert.match(cliente, /urlComLocalizacao\('\/api\/lojas', \{busca:q\}\)/);
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

test('frete do cliente usa faixas simples e bloqueia acima de 8 km', () => {
  assert.deepEqual(calcularFretePorFaixa(1.8), {disponivel:true, distanciaMaxima:8, valor:5.99, faixa:'até 2 km'});
  assert.equal(calcularFretePorFaixa(3.2).valor, 7.99);
  assert.equal(calcularFretePorFaixa(5.5).valor, 10.99);
  assert.equal(calcularFretePorFaixa(7.9).valor, 13.99);
  assert.equal(calcularFretePorFaixa(8.1).disponivel, false);
});

test('entregador recebe mínimo ou valor da rota completa com bônus limitado', () => {
  const curta = calcularGanhoLiquidoEntregador({distanciaColetaKm:1, distanciaEntregaKm:2});
  assert.equal(curta.distanciaTotalKm, 3);
  assert.equal(curta.valorLiquido, 7.5);
  const longa = calcularGanhoLiquidoEntregador({distanciaColetaKm:3, distanciaEntregaKm:5, adicionalPercentual:20});
  assert.equal(longa.valorBase, 12);
  assert.equal(longa.bonusPercentual, 15);
  assert.equal(longa.valorLiquido, 13.8);
});

test('termos, privacidade e aceite versionado existem nos três painéis', () => {
  const raiz = path.join(__dirname, '..');
  const schema = fs.readFileSync(path.join(raiz, 'db', 'schema.sql'), 'utf8');
  const servidor = fs.readFileSync(path.join(raiz, 'server.js'), 'utf8');
  const termos = fs.readFileSync(path.join(raiz, 'frontend', 'termos.html'), 'utf8');
  assert.match(schema, /CREATE TABLE IF NOT EXISTS aceites_termos/);
  assert.match(schema, /aceite_termos_unico/);
  assert.match(servidor, /TERMOS_VERSION/);
  assert.match(servidor, /\/api\/legal\/aceite/);
  assert.match(servidor, /validarAceiteNoCadastro/);
  assert.match(termos, /Política de Privacidade/);
  assert.match(termos, /Regras do cliente/);
  assert.match(termos, /Regras da loja/);
  assert.match(termos, /Regras do entregador/);
  for (const arquivo of ['frontend/index.html', 'loja/index.html', 'entregador/index.html']) {
    const painel = fs.readFileSync(path.join(raiz, arquivo), 'utf8');
    assert.match(painel, /termos\.html/);
    assert.match(painel, /aceitou_termos/);
    assert.match(painel, /aceitou_privacidade/);
  }
});

test('Pix de teste não gera código bancário real e expira em 30 minutos', () => {
  const agora = new Date('2026-08-07T18:00:00Z');
  const pagamento = criarReferenciaPagamentoTeste({pedidoId: 7, valor: 23.75, agora, nonce:'ABC123'});
  assert.equal(pagamento.provedor, 'mock');
  assert.match(pagamento.pixCopiaCola, /^OBRAEXPRESS\.TESTE\|PEDIDO=7\|VALOR=23\.75/);
  assert.equal(pagamento.expiraEm.toISOString(), '2026-08-07T18:30:00.000Z');
  assert.equal(pagamentoExpirado({status:'aguardando', expira_em:'2026-08-07T18:29:59.000Z'}, agora), false);
  assert.equal(pagamentoExpirado({status:'aguardando', expira_em:'2026-08-07T17:59:59.000Z'}, agora), true);
});

test('pedido Pix fica bloqueado até confirmação administrativa de teste', () => {
  const raiz = path.join(__dirname, '..');
  const schema = fs.readFileSync(path.join(raiz, 'db', 'schema.sql'), 'utf8');
  const servidor = fs.readFileSync(path.join(raiz, 'server.js'), 'utf8');
  const cliente = fs.readFileSync(path.join(raiz, 'frontend', 'index.html'), 'utf8');
  const admin = fs.readFileSync(path.join(raiz, 'admin', 'index.html'), 'utf8');
  assert.match(schema, /CREATE TABLE IF NOT EXISTS pagamentos/);
  assert.match(schema, /idempotency_key TEXT UNIQUE NOT NULL/);
  assert.match(servidor, /status = 'aguardando_pagamento'/);
  assert.match(servidor, /NOT IN \('aguardando_confirmacao', 'aguardando_pagamento'\)/);
  assert.match(servidor, /\/api\/admin\/pagamentos\/:pedido_id\/simular/);
  assert.match(cliente, /SIMULAÇÃO — NÃO É PIX REAL/);
  assert.doesNotMatch(cliente, /Pix da loja:/);
  assert.match(admin, /Confirmar Pix de teste/);
});

test('versão segura contém aprovação, estoque, cancelamento, avisos e auditoria', () => {
  const raiz = path.join(__dirname, '..');
  const schema = fs.readFileSync(path.join(raiz, 'db', 'schema.sql'), 'utf8');
  const servidor = fs.readFileSync(path.join(raiz, 'server.js'), 'utf8');
  const admin = fs.readFileSync(path.join(raiz, 'admin', 'index.html'), 'utf8');
  for (const tabela of ['reservas_estoque', 'reembolsos', 'saques', 'notificacoes', 'auditoria_admin', 'configuracoes_cidades']) {
    assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${tabela}`));
  }
  assert.match(servidor, /helmet\(/);
  assert.match(servidor, /rateLimit\(/);
  assert.match(servidor, /\/api\/admin\/cadastros/);
  assert.match(servidor, /cancelarPedidoComSeguranca/);
  assert.match(servidor, /reservarEstoque/);
  assert.match(admin, /Verificação de cadastros/);
  assert.match(admin, /Cancelamentos e reembolsos/);
  assert.match(admin, /Auditoria administrativa/);
});

test('painéis mostram avisos, estoque real e rastreamento protegido', () => {
  const raiz = path.join(__dirname, '..');
  const cliente = fs.readFileSync(path.join(raiz, 'frontend', 'index.html'), 'utf8');
  const loja = fs.readFileSync(path.join(raiz, 'loja', 'index.html'), 'utf8');
  const entregador = fs.readFileSync(path.join(raiz, 'entregador', 'index.html'), 'utf8');
  assert.match(cliente, /carregarRastreamentoPedido/);
  assert.match(cliente, /cancelarPedidoCliente/);
  assert.match(cliente, /carregarAvisosCliente/);
  assert.match(loja, /novo-produto-estoque/);
  assert.match(loja, /carregarAvisosLoja/);
  assert.match(entregador, /carregarAvisosEntregador/);
  assert.match(entregador, /status_cadastro==='aprovado'\)iniciarGPS/);
});

test('PWA usa cache v12 e ícones que realmente existem', () => {
  const raiz = path.join(__dirname, '..');
  const sw = fs.readFileSync(path.join(raiz, 'frontend', 'sw.js'), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(path.join(raiz, 'frontend', 'manifest.json'), 'utf8'));
  assert.match(sw, /obraexpress-v12-preproducao-segura/);
  for (const icon of manifest.icons) {
    assert.equal(fs.existsSync(path.join(raiz, 'frontend', icon.src.replace(/^\//, ''))), true, `ícone ausente: ${icon.src}`);
  }
});

test('limpeza de teste exige confirmação dupla e preserva configurações', () => {
  const raiz = path.join(__dirname, '..');
  const servidor = fs.readFileSync(path.join(raiz, 'server.js'), 'utf8');
  const admin = fs.readFileSync(path.join(raiz, 'admin', 'index.html'), 'utf8');
  assert.match(servidor, /req\.body\.confirmacao !== 'LIMPAR TESTES'/);
  assert.match(servidor, /\/api\/admin\/limpar-dados-teste/);
  assert.match(admin, /Apagar dados de teste/);
  assert.match(admin, /digite exatamente: LIMPAR TESTES/);
  assert.doesNotMatch(servidor.match(/app\.post\('\/api\/admin\/limpar-dados-teste'[\s\S]*?\n\}\);/)?.[0] || '', /DELETE FROM categorias|DELETE FROM configuracoes_plataforma/);
});

test('oferta de entrega expande de 3 para 5 e 8 km a cada 30 segundos', () => {
  const configuracao = {
    raio_preferencial_coleta: 3,
    raio_maximo_coleta: 5,
    raio_expansao_coleta: 8,
    tempo_expansao_coleta_segundos: 30
  };
  const pedido = { data_separado: '2026-08-09T12:00:00.000Z' };
  const inicio = new Date('2026-08-09T12:00:00.000Z');
  const depois30 = new Date('2026-08-09T12:00:30.000Z');
  const depois60 = new Date('2026-08-09T12:01:00.000Z');

  assert.equal(calcularJanelaOfertaEntrega(pedido, 2, configuracao, inicio).disponivelAgora, true);
  assert.equal(calcularJanelaOfertaEntrega(pedido, 4, configuracao, inicio).liberadaEmSegundos, 30);
  assert.equal(calcularJanelaOfertaEntrega(pedido, 4, configuracao, depois30).etapa, 2);
  assert.equal(calcularJanelaOfertaEntrega(pedido, 4, configuracao, depois30).disponivelAgora, true);
  assert.equal(calcularJanelaOfertaEntrega(pedido, 7, configuracao, inicio).liberadaEmSegundos, 60);
  assert.equal(calcularJanelaOfertaEntrega(pedido, 7, configuracao, depois60).etapa, 3);
  assert.equal(calcularJanelaOfertaEntrega(pedido, 7, configuracao, depois60).disponivelAgora, true);
  assert.equal(calcularJanelaOfertaEntrega(pedido, 9, configuracao, depois60).liberadaEmSegundos, null);
});

test('painel do entregador mostra temporizador e servidor protege o primeiro aceite', () => {
  const raiz = path.join(__dirname, '..');
  const servidor = fs.readFileSync(path.join(raiz, 'server.js'), 'utf8');
  const entregador = fs.readFileSync(path.join(raiz, 'entregador', 'index.html'), 'utf8');
  const admin = fs.readFileSync(path.join(raiz, 'admin', 'index.html'), 'utf8');
  const schema = fs.readFileSync(path.join(raiz, 'db', 'schema.sql'), 'utf8');
  assert.match(servidor, /calcularJanelaOfertaEntrega/);
  assert.match(servidor, /WHERE p\.id = \? FOR UPDATE/);
  assert.match(servidor, /Essa entrega não está mais disponível/);
  assert.match(entregador, /data-oferta-segundos/);
  assert.match(entregador, /Este pedido continuará disponível para você/);
  assert.match(admin, /Raio final depois da expansão/);
  assert.match(schema, /raio_expansao_coleta/);
  assert.match(schema, /tempo_expansao_coleta_segundos/);
});
