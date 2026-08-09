const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const QRCode = require('qrcode');
const path = require('path');
const crypto = require('crypto');
const {
  databaseReady,
  dbAll,
  dbGet,
  dbRun,
  dbTransaction,
  getDatabaseHealth,
  isUniqueViolation
} = require('./database');
const {
  arredondarDinheiro,
  calcularFretePorFaixa,
  calcularGanhoLiquidoEntregador,
  calcularPercentualPromocional,
  calcularTaxaPedidoPequeno,
  calcularFinanceiroPedido,
  normalizarPlanoLoja
} = require('./financial-utils');
const {
  STATUS_PAGAMENTO,
  criarReferenciaPagamentoTeste,
  pagamentoExpirado
} = require('./payment-utils');

const app = express();
const PORT = process.env.PORT || 3000;

function requireEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} não configurada no ambiente`);
  return value;
}

const JWT_SECRET = requireEnvironment('JWT_SECRET');
const ADMIN_EMAIL = requireEnvironment('ADMIN_EMAIL');
const ADMIN_PASSWORD = requireEnvironment('ADMIN_PASSWORD');
// Esta versão aceita apenas o simulador. Nenhuma chave Pix real é usada.
const PAYMENT_MODE = process.env.PAYMENT_MODE || 'mock';

const TERMOS_VERSION = '2026-08-04.1';
const PRIVACIDADE_VERSION = '2026-08-04.1';

function dadosPublicosEmpresa() {
  const dados = {
    nome: process.env.EMPRESA_NOME || '',
    documento: process.env.EMPRESA_DOCUMENTO || '',
    endereco: process.env.EMPRESA_ENDERECO || '',
    email_suporte: process.env.EMPRESA_EMAIL_SUPORTE || '',
    email_privacidade: process.env.EMPRESA_EMAIL_PRIVACIDADE || ''
  };
  return {
    ...dados,
    identificacao_completa: Object.values(dados).every(valor => String(valor).trim())
  };
}

function validarAceiteNoCadastro(body) {
  return body.aceitou_termos === true && body.aceitou_privacidade === true;
}

function hashIpRequisicao(req) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
  if (!ip) return null;
  return crypto.createHmac('sha256', JWT_SECRET).update(ip).digest('hex');
}

async function registrarAceiteTermos(tipoUsuario, usuarioId, req, executor = { run: dbRun }) {
  await executor.run(`INSERT INTO aceites_termos
    (tipo_usuario, usuario_id, versao_termos, versao_privacidade, ip_hash, user_agent)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (tipo_usuario, usuario_id, versao_termos, versao_privacidade) DO NOTHING`,
  [tipoUsuario, usuarioId, TERMOS_VERSION, PRIVACIDADE_VERSION, hashIpRequisicao(req), String(req.headers['user-agent'] || '').slice(0, 500)]);
}

async function possuiAceiteAtual(tipoUsuario, usuarioId) {
  const aceite = await dbGet(`SELECT id FROM aceites_termos
    WHERE tipo_usuario = ? AND usuario_id = ? AND versao_termos = ? AND versao_privacidade = ?`,
  [tipoUsuario, usuarioId, TERMOS_VERSION, PRIVACIDADE_VERSION]);
  return Boolean(aceite);
}

const FUSO_PLATAFORMA = 'America/Araguaina';

function coordenadaValida(latitude, longitude) {
  if (latitude === null || latitude === undefined || latitude === '' || longitude === null || longitude === undefined || longitude === '') return false;
  const lat = Number(latitude);
  const lng = Number(longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

function calcularDistanciaRetaKm(origemLat, origemLng, destinoLat, destinoLng) {
  const raioTerra = 6371;
  const rad = valor => Number(valor) * Math.PI / 180;
  const dLat = rad(Number(destinoLat) - Number(origemLat));
  const dLng = rad(Number(destinoLng) - Number(origemLng));
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(origemLat)) * Math.cos(rad(destinoLat)) * Math.sin(dLng / 2) ** 2;
  return raioTerra * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function horarioDePico(agora = new Date()) {
  const partes = new Intl.DateTimeFormat('pt-BR', {
    timeZone: FUSO_PLATAFORMA,
    hour: '2-digit',
    hour12: false
  }).formatToParts(agora);
  const hora = Number(partes.find(parte => parte.type === 'hour')?.value || 0);
  return (hora >= 11 && hora < 14) || (hora >= 17 && hora < 20);
}

async function obterConfiguracaoFrete() {
  return (await dbGet('SELECT * FROM configuracoes_plataforma WHERE id = 1')) || {
    frete_base: 4,
    valor_km: 1.5,
    frete_faixa_ate_2: 5.99,
    frete_faixa_ate_4: 7.99,
    frete_faixa_ate_6: 10.99,
    frete_faixa_ate_8: 13.99,
    distancia_maxima_entrega: 8,
    ganho_minimo_entregador: 7.5,
    ganho_km_entregador: 1.5,
    limite_bonus_entregador_percentual: 15,
    raio_preferencial_coleta: 3,
    raio_maximo_coleta: 5,
    fator_rota: 1.2,
    adicional_chuva_percentual: 10,
    adicional_pico_percentual: 5,
    limite_adicionais_percentual: 10,
    condicao_climatica: 'normal',
    entregas_ativas: 1,
    pedido_minimo: 15,
    limite_pedido_pequeno: 25,
    taxa_pedido_pequeno: 1.99
  };
}

async function calcularCotacaoFrete(loja, latitudeEntrega, longitudeEntrega, agora = new Date()) {
  if (!coordenadaValida(loja.latitude, loja.longitude)) {
    throw Object.assign(new Error('A loja ainda precisa cadastrar a localização GPS'), { status: 400 });
  }
  if (!coordenadaValida(latitudeEntrega, longitudeEntrega)) {
    throw Object.assign(new Error('Use o botão de GPS para marcar o local da entrega'), { status: 400 });
  }
  const config = await obterConfiguracaoFrete();
  if (!Number(config.entregas_ativas) || config.condicao_climatica === 'perigoso') {
    throw Object.assign(new Error('Entregas temporariamente pausadas por segurança'), { status: 409 });
  }
  const distanciaReta = calcularDistanciaRetaKm(loja.latitude, loja.longitude, latitudeEntrega, longitudeEntrega);
  const distanciaEstimada = Math.max(0.5, distanciaReta * Number(config.fator_rota || 1.2));
  const faixaFrete = calcularFretePorFaixa(distanciaEstimada, config);
  if (!faixaFrete.disponivel) {
    throw Object.assign(new Error(`Endereço fora da área de entrega por moto. Limite atual: ${faixaFrete.distanciaMaxima} km da loja.`), { status: 400 });
  }
  const taxaBase = faixaFrete.valor;
  const adicionalClima = config.condicao_climatica === 'chuva' ? Number(config.adicional_chuva_percentual || 0) : 0;
  const pico = horarioDePico(agora);
  const adicionalPico = pico ? Number(config.adicional_pico_percentual || 0) : 0;
  const adicionaisAplicados = Math.min(adicionalClima + adicionalPico, Number(config.limite_adicionais_percentual || 0), 10);
  return {
    distancia_km: Math.round(distanciaEstimada * 10) / 10,
    distancia_reta_km: Math.round(distanciaReta * 10) / 10,
    taxa_base: taxaBase,
    faixa_frete: faixaFrete.faixa,
    adicional_clima_percentual: adicionalClima,
    adicional_pico_percentual: adicionalPico,
    adicional_total_percentual: adicionaisAplicados,
    horario_pico: pico,
    condicao_climatica: config.condicao_climatica,
    valor_frete: arredondarDinheiro(taxaBase * (1 + adicionaisAplicados / 100))
  };
}

function calcularOfertaEntregador(pedido, entregador, configuracao) {
  if (!coordenadaValida(entregador.latitude, entregador.longitude)) {
    throw Object.assign(new Error('Aguarde o GPS do entregador ficar ativo antes de aceitar'), { status: 400 });
  }
  if (!coordenadaValida(pedido.loja_latitude, pedido.loja_longitude)) {
    throw Object.assign(new Error('A loja ainda não possui localização GPS válida'), { status: 400 });
  }
  const coletaReta = calcularDistanciaRetaKm(entregador.latitude, entregador.longitude, pedido.loja_latitude, pedido.loja_longitude);
  const coletaEstimada = coletaReta * Number(configuracao.fator_rota || 1.2);
  const adicionalTotal = Number(pedido.adicional_clima_percentual || 0) + Number(pedido.adicional_pico_percentual || 0);
  const ganho = calcularGanhoLiquidoEntregador({
    distanciaColetaKm: coletaEstimada,
    distanciaEntregaKm: Number(pedido.distancia_km || 0),
    adicionalPercentual: adicionalTotal,
    configuracao
  });
  return {
    ...ganho,
    coletaPreferencial: coletaEstimada <= Number(configuracao.raio_preferencial_coleta || 3),
    coletaPermitida: coletaEstimada <= Number(configuracao.raio_maximo_coleta || 5),
    margemPlataformaEntrega: arredondarDinheiro(Number(pedido.taxa_entrega || 0) - ganho.valorLiquido)
  };
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'frontend')));
app.use('/loja', express.static(path.join(__dirname, 'loja')));
app.use('/entregador', express.static(path.join(__dirname, 'entregador')));
app.use('/admin', express.static(path.join(__dirname, 'admin')));

// Fallback para rotas do PWA
app.get('/loja/*', (req, res) => {
  res.sendFile(path.join(__dirname, 'loja', 'index.html'));
});
app.get('/entregador/*', (req, res) => {
  res.sendFile(path.join(__dirname, 'entregador', 'index.html'));
});
app.get('/admin/*', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'index.html'));
});

databaseReady.catch(err => { console.error('Falha ao inicializar o banco:', err); process.exit(1); });
app.use('/api', async (req, res, next) => {
  try { await databaseReady; next(); } catch { res.status(503).json({ error: 'Banco de dados indisponível' }); }
});

app.get('/api/health', async (req, res) => {
  try {
    res.json(await getDatabaseHealth());
  } catch (error) {
    res.status(503).json({ status: 'error', database: 'postgresql' });
  }
});

// ============ MIDDLEWARE ============
async function autenticarUsuario(req, res, next, tipoEsperado) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token não fornecido' });
  try {
    req.usuario = jwt.verify(token, JWT_SECRET);
    if (req.usuario.tipo !== tipoEsperado) return res.status(403).json({ error: `Acesso apenas para ${tipoEsperado}` });
    if (!(await possuiAceiteAtual(req.usuario.tipo, req.usuario.id))) {
      return res.status(428).json({
        error: 'Leia e aceite os Termos e a Política de Privacidade para continuar',
        codigo: 'TERMOS_PENDENTES',
        termos_pendentes: true
      });
    }
    next();
  } catch (error) {
    console.error('Falha de autenticação:', error.message);
    res.status(401).json({ error: 'Token inválido' });
  }
}

function authLojas(req, res, next) {
  autenticarUsuario(req, res, next, 'loja');
}

function authCliente(req, res, next) {
  autenticarUsuario(req, res, next, 'cliente');
}

function authEntregador(req, res, next) {
  autenticarUsuario(req, res, next, 'entregador');
}

function authAdmin(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token não fornecido' });
  try {
    req.usuario = jwt.verify(token, JWT_SECRET);
    if (req.usuario.tipo !== 'admin') return res.status(403).json({ error: 'Acesso apenas para admin' });
    next();
  } catch { res.status(401).json({ error: 'Token inválido' }); }
}

// ============ TERMOS, REGRAS E PRIVACIDADE ============
app.get('/api/legal/documentos', async (req, res) => {
  res.json({
    termos_versao: TERMOS_VERSION,
    privacidade_versao: PRIVACIDADE_VERSION,
    empresa: dadosPublicosEmpresa(),
    links: {
      termos: '/termos.html#termos',
      privacidade: '/termos.html#privacidade',
      cliente: '/termos.html#regras-cliente',
      loja: '/termos.html#regras-loja',
      entregador: '/termos.html#regras-entregador'
    }
  });
});

function usuarioDoTokenLegal(req, res) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    res.status(401).json({ error: 'Entre na sua conta para registrar o aceite' });
    return null;
  }
  try {
    const usuario = jwt.verify(token, JWT_SECRET);
    if (!['cliente', 'loja', 'entregador'].includes(usuario.tipo)) {
      res.status(403).json({ error: 'Tipo de conta inválido para este aceite' });
      return null;
    }
    return usuario;
  } catch {
    res.status(401).json({ error: 'Sessão vencida. Entre novamente.' });
    return null;
  }
}

app.get('/api/legal/aceite', async (req, res) => {
  const usuario = usuarioDoTokenLegal(req, res);
  if (!usuario) return;
  const aceitou = await possuiAceiteAtual(usuario.tipo, usuario.id);
  res.json({
    aceitou,
    termos_pendentes: !aceitou,
    termos_versao: TERMOS_VERSION,
    privacidade_versao: PRIVACIDADE_VERSION
  });
});

app.post('/api/legal/aceite', async (req, res) => {
  const usuario = usuarioDoTokenLegal(req, res);
  if (!usuario) return;
  if (!validarAceiteNoCadastro(req.body)) {
    return res.status(400).json({ error: 'Marque as duas confirmações para continuar' });
  }
  await registrarAceiteTermos(usuario.tipo, usuario.id, req);
  res.json({
    success: true,
    termos_versao: TERMOS_VERSION,
    privacidade_versao: PRIVACIDADE_VERSION,
    aceito_em: new Date().toISOString()
  });
});

// ============ LOJAS API ============
app.post('/api/lojas/cadastro', async (req, res) => {
  const { nome, email, senha, telefone, endereco, bairro, latitude, longitude, descricao, categorias, taxa_entrega_km, chave_pix, plano, tempo_entrega_min } = req.body;
  try {
    if (!nome || !email || !senha) return res.status(400).json({ error: 'Nome, email e senha são obrigatórios' });
    if (!validarAceiteNoCadastro(req.body)) return res.status(400).json({ error: 'Leia e aceite os Termos e a Política de Privacidade' });
    const planoEscolhido = normalizarPlanoLoja(plano);
    const hash = bcrypt.hashSync(senha, 10);
    const taxaKm = Number(taxa_entrega_km || 2);
    if (!coordenadaValida(latitude, longitude)) return res.status(400).json({ error: 'Use o botão de GPS para marcar a localização da loja' });
    const result = await dbTransaction(async tx => {
      const insercao = await tx.run('INSERT INTO lojas (nome, email, senha, telefone, endereco, bairro, latitude, longitude, descricao, categorias, taxa_entrega_km, chave_pix, plano, comissao_percentual, tempo_entrega_min) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [nome, email, hash, telefone, endereco, bairro, Number(latitude), Number(longitude), descricao, categorias, taxaKm, chave_pix || null, planoEscolhido, 5, tempo_entrega_min || '30-60 min']);
      await registrarAceiteTermos('loja', insercao.lastID, req, tx);
      return insercao;
    });
    const token = jwt.sign({ id: result.lastID, tipo: 'loja' }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, id: result.lastID, token, termos_pendentes: false, loja: { id: result.lastID, nome, email, plano: planoEscolhido, comissao_percentual: 5, taxa_entrega_km: taxaKm, chave_pix: chave_pix || null, latitude: Number(latitude), longitude: Number(longitude), inicio_promocao: null } });
  } catch (e) {
    if (isUniqueViolation(e)) return res.status(400).json({ error: 'Email já cadastrado' });
    console.error('Erro ao cadastrar loja:', e);
    res.status(500).json({ error: 'Não foi possível cadastrar a loja' });
  }
});

app.post('/api/lojas/login', async (req, res) => {
  const { email, senha } = req.body;
  const loja = await dbGet('SELECT * FROM lojas WHERE email = ?', [email]);
  if (!loja) return res.status(401).json({ error: 'Email não encontrado' });
  if (!bcrypt.compareSync(senha, loja.senha)) return res.status(401).json({ error: 'Senha incorreta' });
  loja.comissao_percentual = calcularPercentualPromocional(loja.inicio_promocao);
  await dbRun('UPDATE lojas SET comissao_percentual = ? WHERE id = ?', [loja.comissao_percentual, loja.id]);
  const token = jwt.sign({ id: loja.id, tipo: 'loja' }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ success: true, token, termos_pendentes: !(await possuiAceiteAtual('loja', loja.id)), loja: { id: loja.id, nome: loja.nome, email: loja.email, logo: loja.logo, aberto: loja.aberto, taxa_entrega_km: loja.taxa_entrega_km, chave_pix: loja.chave_pix, plano: normalizarPlanoLoja(loja.plano), comissao_percentual: Number(loja.comissao_percentual), inicio_promocao: loja.inicio_promocao, latitude: loja.latitude, longitude: loja.longitude } });
});

app.get('/api/lojas', async (req, res) => {
  const { categoria, bairro, busca } = req.query;
  let sql = 'SELECT id, nome, logo, descricao, categorias, endereco, bairro, taxa_entrega_km, entrega_gratis_ate, tempo_entrega_min, aberto, latitude, longitude, plano, comissao_percentual FROM lojas WHERE aberto = 1';
  const params = [];
  if (categoria) { sql += ' AND categorias ILIKE ?'; params.push(`%${categoria}%`); }
  if (bairro) { sql += ' AND bairro ILIKE ?'; params.push(`%${bairro}%`); }
  if (busca) {
    sql += ' AND (nome ILIKE ? OR descricao ILIKE ? OR categorias ILIKE ? OR bairro ILIKE ?)';
    params.push(`%${busca}%`, `%${busca}%`, `%${busca}%`, `%${busca}%`);
  }
  sql += ' ORDER BY nome';
  const lojas = await dbAll(sql, params);
  res.json({ lojas });
});

app.get('/api/lojas/:id', async (req, res) => {
  const loja = await dbGet('SELECT id, nome, logo, descricao, categorias, endereco, bairro, cidade, estado, telefone, whatsapp, chave_pix, taxa_entrega_km, entrega_gratis_ate, tempo_entrega_min, aberto, latitude, longitude, plano, comissao_percentual, inicio_promocao FROM lojas WHERE id = ?', [req.params.id]);
  if (!loja) return res.status(404).json({ error: 'Loja não encontrada' });
  loja.comissao_percentual = calcularPercentualPromocional(loja.inicio_promocao);
  const produtos = await dbAll(`SELECT p.*,
    CASE WHEN EXISTS (
      SELECT 1 FROM categorias c
      WHERE LOWER(TRIM(c.nome)) = LOWER(TRIM(p.categoria))
        AND COALESCE(c.ativa, 1) = 1
    ) THEN 1 ELSE 0 END AS categoria_disponivel
    FROM produtos p WHERE p.loja_id = ? AND p.ativo = 1
    ORDER BY p.destaque DESC, p.nome`, [req.params.id]);
  res.json({ loja, produtos });
});

app.put('/api/lojas/:id', authLojas, async (req, res) => {
  if (req.usuario.id != req.params.id) return res.status(403).json({ error: 'Permissão negada' });
  const { nome, telefone, whatsapp, chave_pix, endereco, bairro, latitude, longitude, descricao, categorias, taxa_entrega_km, entrega_gratis_ate, tempo_entrega_min, aberto, logo, plano } = req.body;
  const updates = [];
  const params = [];
  if (nome !== undefined) { updates.push('nome = ?'); params.push(nome); }
  if (telefone !== undefined) { updates.push('telefone = ?'); params.push(telefone); }
  if (whatsapp !== undefined) { updates.push('whatsapp = ?'); params.push(whatsapp); }
  if (chave_pix !== undefined) { updates.push('chave_pix = ?'); params.push(chave_pix); }
  if (endereco !== undefined) { updates.push('endereco = ?'); params.push(endereco); }
  if (bairro !== undefined) { updates.push('bairro = ?'); params.push(bairro); }
  if (latitude !== undefined) { updates.push('latitude = ?'); params.push(latitude); }
  if (longitude !== undefined) { updates.push('longitude = ?'); params.push(longitude); }
  if (descricao !== undefined) { updates.push('descricao = ?'); params.push(descricao); }
  if (categorias !== undefined) { updates.push('categorias = ?'); params.push(categorias); }
  if (taxa_entrega_km !== undefined) { updates.push('taxa_entrega_km = ?'); params.push(taxa_entrega_km); }
  if (entrega_gratis_ate !== undefined) { updates.push('entrega_gratis_ate = ?'); params.push(entrega_gratis_ate); }
  if (tempo_entrega_min !== undefined) { updates.push('tempo_entrega_min = ?'); params.push(tempo_entrega_min); }
  if (aberto !== undefined) { updates.push('aberto = ?'); params.push(aberto ? 1 : 0); }
  if (logo !== undefined) { updates.push('logo = ?'); params.push(logo); }
  if (plano !== undefined) { updates.push('plano = ?'); params.push(normalizarPlanoLoja(plano)); }
  if (updates.length === 0) return res.status(400).json({ error: 'Nada para atualizar' });
  params.push(req.params.id);
  await dbRun(`UPDATE lojas SET ${updates.join(', ')} WHERE id = ?`, params);
  res.json({ success: true });
});

// ============ PRODUTOS API ============
app.post('/api/produtos', authLojas, async (req, res) => {
  const { loja_id, nome, descricao, preco, foto, categoria, marca, unidade, estoque } = req.body;
  if (req.usuario.id != loja_id) return res.status(403).json({ error: 'Permissão negada' });
  if (!nome || !preco || Number(preco) <= 0) return res.status(400).json({ error: 'Informe o nome e um preço válido' });
  if (!categoria) return res.status(400).json({ error: 'Escolha uma categoria' });
  try {
    const loja = await dbGet('SELECT id FROM lojas WHERE id = ?', [loja_id]);
    if (!loja) return res.status(404).json({ error: 'A loja desta sessão não foi encontrada no banco atual. Faça o cadastro novamente.' });
    const categoriaOficial = await dbGet('SELECT nome FROM categorias WHERE LOWER(TRIM(nome)) = LOWER(TRIM(?)) AND COALESCE(ativa, 1) = 1', [categoria]);
    if (!categoriaOficial) return res.status(400).json({ error: 'Categoria inválida. Escolha uma opção da lista.' });
    const result = await dbRun('INSERT INTO produtos (loja_id, nome, descricao, preco, foto, categoria, marca, unidade, estoque) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [loja_id, nome, descricao || null, Number(preco), foto || null, categoriaOficial.nome, marca || null, unidade || 'un', estoque || 999]);
    const produto = await dbGet('SELECT * FROM produtos WHERE id = ?', [result.lastID]);
    if (!produto) return res.status(500).json({ error: 'O produto não foi confirmado no banco de dados' });
    res.json({ success: true, id: result.lastID, produto });
  } catch (e) {
    console.error('Erro ao cadastrar produto:', e);
    res.status(500).json({ error: 'Não foi possível salvar o produto. Tente novamente.' });
  }
});

app.put('/api/produtos/:id', authLojas, async (req, res) => {
  const produto = await dbGet('SELECT * FROM produtos WHERE id = ?', [req.params.id]);
  if (!produto) return res.status(404).json({ error: 'Produto não encontrado' });
  if (req.usuario.id != produto.loja_id) return res.status(403).json({ error: 'Permissão negada' });
  const { nome, descricao, preco, foto, categoria, marca, unidade, estoque, ativo, destaque } = req.body;
  const updates = []; const params = [];
  if (nome !== undefined) { updates.push('nome = ?'); params.push(nome); }
  if (descricao !== undefined) { updates.push('descricao = ?'); params.push(descricao); }
  if (preco !== undefined) { updates.push('preco = ?'); params.push(preco); }
  if (foto !== undefined) { updates.push('foto = ?'); params.push(foto); }
  if (categoria !== undefined) {
    const categoriaOficial = await dbGet('SELECT nome FROM categorias WHERE LOWER(TRIM(nome)) = LOWER(TRIM(?)) AND COALESCE(ativa, 1) = 1', [categoria]);
    if (!categoriaOficial) return res.status(400).json({ error: 'Categoria inválida. Escolha uma opção da lista.' });
    updates.push('categoria = ?'); params.push(categoriaOficial.nome);
  }
  if (marca !== undefined) { updates.push('marca = ?'); params.push(marca); }
  if (unidade !== undefined) { updates.push('unidade = ?'); params.push(unidade); }
  if (estoque !== undefined) { updates.push('estoque = ?'); params.push(estoque); }
  if (ativo !== undefined) { updates.push('ativo = ?'); params.push(ativo ? 1 : 0); }
  if (destaque !== undefined) { updates.push('destaque = ?'); params.push(destaque ? 1 : 0); }
  if (updates.length === 0) return res.status(400).json({ error: 'Nada para atualizar' });
  params.push(req.params.id);
  await dbRun(`UPDATE produtos SET ${updates.join(', ')} WHERE id = ?`, params);
  res.json({ success: true });
});

app.delete('/api/produtos/:id', authLojas, async (req, res) => {
  const produto = await dbGet('SELECT * FROM produtos WHERE id = ?', [req.params.id]);
  if (!produto) return res.status(404).json({ error: 'Produto não encontrado' });
  if (req.usuario.id != produto.loja_id) return res.status(403).json({ error: 'Permissão negada' });
  await dbRun('DELETE FROM produtos WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

app.get('/api/produtos', async (req, res) => {
  const { categoria, loja_id, busca, ordem } = req.query;
  let sql = `SELECT p.*, l.nome as loja_nome, l.logo as loja_logo, l.bairro as loja_bairro
    FROM produtos p
    JOIN lojas l ON p.loja_id = l.id
    JOIN categorias c ON LOWER(TRIM(c.nome)) = LOWER(TRIM(p.categoria))
      AND COALESCE(c.ativa, 1) = 1
    WHERE p.ativo = 1 AND l.aberto = 1`;
  const params = [];
  if (categoria) { sql += ' AND LOWER(TRIM(p.categoria)) = LOWER(TRIM(?))'; params.push(categoria); }
  if (loja_id) { sql += ' AND p.loja_id = ?'; params.push(loja_id); }
  if (busca) {
    sql += ' AND (p.nome ILIKE ? OR p.descricao ILIKE ? OR p.marca ILIKE ? OR p.categoria ILIKE ? OR l.nome ILIKE ?)';
    params.push(`%${busca}%`, `%${busca}%`, `%${busca}%`, `%${busca}%`, `%${busca}%`);
  }
  sql += ordem === 'menor_preco'
    ? ' ORDER BY p.preco ASC, p.nome ASC, l.nome ASC'
    : ' ORDER BY p.destaque DESC, p.nome ASC';
  const produtos = await dbAll(sql, params);
  res.json({ produtos });
});

// ============ CLIENTES API ============
app.post('/api/clientes/cadastro', async (req, res) => {
  const { nome, email, senha, telefone, endereco_padrao, bairro, latitude, longitude } = req.body;
  try {
    if (!nome || !email || !senha) return res.status(400).json({ error: 'Nome, email e senha são obrigatórios' });
    if (!validarAceiteNoCadastro(req.body)) return res.status(400).json({ error: 'Leia e aceite os Termos e a Política de Privacidade' });
    const hash = bcrypt.hashSync(senha, 10);
    const result = await dbTransaction(async tx => {
      const insercao = await tx.run('INSERT INTO clientes (nome, email, senha, telefone, endereco_padrao, bairro, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [nome, email, hash, telefone, endereco_padrao, bairro, latitude, longitude]);
      await registrarAceiteTermos('cliente', insercao.lastID, req, tx);
      return insercao;
    });
    const token = jwt.sign({ id: result.lastID, tipo: 'cliente' }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, token, termos_pendentes: false, cliente: { id: result.lastID, nome, email, telefone, endereco_padrao, bairro, latitude: latitude || null, longitude: longitude || null } });
  } catch (e) {
    if (isUniqueViolation(e)) return res.status(400).json({ error: 'Email já cadastrado' });
    console.error('Erro ao cadastrar cliente:', e);
    res.status(500).json({ error: 'Não foi possível cadastrar o cliente' });
  }
});

app.post('/api/clientes/login', async (req, res) => {
  const { email, senha } = req.body;
  const cliente = await dbGet('SELECT * FROM clientes WHERE email = ?', [email]);
  if (!cliente) return res.status(401).json({ error: 'Email não encontrado' });
  if (!bcrypt.compareSync(senha, cliente.senha)) return res.status(401).json({ error: 'Senha incorreta' });
  const token = jwt.sign({ id: cliente.id, tipo: 'cliente' }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ success: true, token, termos_pendentes: !(await possuiAceiteAtual('cliente', cliente.id)), cliente: { id: cliente.id, nome: cliente.nome, email: cliente.email, telefone: cliente.telefone, endereco_padrao: cliente.endereco_padrao, bairro: cliente.bairro, latitude: cliente.latitude, longitude: cliente.longitude } });
});

app.get('/api/clientes/:id', authCliente, async (req, res) => {
  if (req.usuario.id != req.params.id) return res.status(403).json({ error: 'Permissão negada' });
  const cliente = await dbGet('SELECT id, nome, email, telefone, endereco_padrao, bairro, cidade, estado, latitude, longitude FROM clientes WHERE id = ?', [req.params.id]);
  if (!cliente) return res.status(404).json({ error: 'Cliente não encontrado' });
  res.json({ cliente });
});

app.put('/api/clientes/:id', authCliente, async (req, res) => {
  if (req.usuario.id != req.params.id) return res.status(403).json({ error: 'Permissão negada' });
  const { nome, telefone, endereco_padrao, bairro, latitude, longitude } = req.body;
  const updates = []; const params = [];
  if (nome !== undefined) { updates.push('nome = ?'); params.push(nome); }
  if (telefone !== undefined) { updates.push('telefone = ?'); params.push(telefone); }
  if (endereco_padrao !== undefined) { updates.push('endereco_padrao = ?'); params.push(endereco_padrao); }
  if (bairro !== undefined) { updates.push('bairro = ?'); params.push(bairro); }
  if (latitude !== undefined) { updates.push('latitude = ?'); params.push(latitude); }
  if (longitude !== undefined) { updates.push('longitude = ?'); params.push(longitude); }
  if (updates.length === 0) return res.status(400).json({ error: 'Nada para atualizar' });
  params.push(req.params.id);
  await dbRun(`UPDATE clientes SET ${updates.join(', ')} WHERE id = ?`, params);
  res.json({ success: true });
});

// ============ ENTREGADORES API ============
app.post('/api/entregadores/cadastro', async (req, res) => {
  const { nome, cpf, email, senha, telefone, veiculo, placa, chave_pix } = req.body;
  try {
    if (!nome || !email || !senha) return res.status(400).json({ error: 'Nome, email e senha são obrigatórios' });
    if (!validarAceiteNoCadastro(req.body)) return res.status(400).json({ error: 'Leia e aceite os Termos e a Política de Privacidade' });
    if (req.body.declarou_requisitos_profissionais !== true) return res.status(400).json({ error: 'Confirme que atende aos requisitos legais e de segurança da atividade' });
    const hash = bcrypt.hashSync(senha, 10);
    const result = await dbTransaction(async tx => {
      const insercao = await tx.run('INSERT INTO entregadores (nome, cpf, email, senha, telefone, veiculo, placa, chave_pix) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [nome, cpf, email, hash, telefone, veiculo, placa, chave_pix || null]);
      await tx.run('INSERT INTO saldo_entregadores (entregador_id, saldo) VALUES (?, 0) ON CONFLICT (entregador_id) DO NOTHING', [insercao.lastID]);
      await registrarAceiteTermos('entregador', insercao.lastID, req, tx);
      return insercao;
    });
    const token = jwt.sign({ id: result.lastID, tipo: 'entregador' }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, token, termos_pendentes: false, entregador: { id: result.lastID, nome, email, comissao_percentual: 5, inicio_promocao: null } });
  } catch (e) {
    if (isUniqueViolation(e)) return res.status(400).json({ error: 'CPF ou email já cadastrado' });
    console.error('Erro ao cadastrar entregador:', e);
    res.status(500).json({ error: 'Não foi possível cadastrar o entregador' });
  }
});

app.post('/api/entregadores/login', async (req, res) => {
  const { email, senha } = req.body;
  const entregador = await dbGet('SELECT * FROM entregadores WHERE email = ?', [email]);
  if (!entregador) return res.status(401).json({ error: 'Email não encontrado' });
  if (!bcrypt.compareSync(senha, entregador.senha)) return res.status(401).json({ error: 'Senha incorreta' });
  const token = jwt.sign({ id: entregador.id, tipo: 'entregador' }, JWT_SECRET, { expiresIn: '7d' });
  const comissaoPercentual = calcularPercentualPromocional(entregador.inicio_promocao);
  await dbRun('UPDATE entregadores SET comissao_percentual = ? WHERE id = ?', [comissaoPercentual, entregador.id]);
  res.json({ success: true, token, termos_pendentes: !(await possuiAceiteAtual('entregador', entregador.id)), entregador: { id: entregador.id, nome: entregador.nome, email: entregador.email, veiculo: entregador.veiculo, disponivel: entregador.disponivel, chave_pix: entregador.chave_pix, comissao_percentual: comissaoPercentual, inicio_promocao: entregador.inicio_promocao } });
});

app.get('/api/entregadores/disponiveis', async (req, res) => {
  const entregadores = await dbAll('SELECT id, nome, veiculo, total_entregas, latitude, longitude FROM entregadores WHERE disponivel = 1');
  res.json({ entregadores });
});

app.put('/api/entregadores/:id/localizacao', authEntregador, async (req, res) => {
  if (req.usuario.id != req.params.id) return res.status(403).json({ error: 'Permissão negada' });
  const { latitude, longitude, disponivel } = req.body;
  const updates = []; const params = [];
  if (latitude !== undefined) { updates.push('latitude = ?'); params.push(latitude); }
  if (longitude !== undefined) { updates.push('longitude = ?'); params.push(longitude); }
  if (disponivel !== undefined) { updates.push('disponivel = ?'); params.push(disponivel ? 1 : 0); }
  if (updates.length === 0) return res.status(400).json({ error: 'Nada para atualizar' });
  params.push(req.params.id);
  await dbRun(`UPDATE entregadores SET ${updates.join(', ')} WHERE id = ?`, params);
  res.json({ success: true });
});

// Saldo do entregador
app.get('/api/entregadores/:id/saldo', authEntregador, async (req, res) => {
  if (req.usuario.id != req.params.id) return res.status(403).json({ error: 'Permissão negada' });
  let saldo = await dbGet('SELECT * FROM saldo_entregadores WHERE entregador_id = ?', [req.params.id]);
  if (!saldo) {
    await dbRun('INSERT INTO saldo_entregadores (entregador_id, saldo) VALUES (?, 0)', [req.params.id]);
    saldo = { entregador_id: parseInt(req.params.id), saldo: 0, total_ganho: 0, total_sacado: 0 };
  }
  res.json({ saldo });
});

// Saldo e extrato calculado da loja. O repasse real será integrado ao provedor de pagamento depois.
app.get('/api/lojas/:id/financeiro', authLojas, async (req, res) => {
  if (req.usuario.id != req.params.id) return res.status(403).json({ error: 'Permissão negada' });
  let saldo = await dbGet(`SELECT loja_id, saldo::double precision AS saldo,
    total_recebido::double precision AS total_recebido,
    total_sacado::double precision AS total_sacado
    FROM saldo_lojas WHERE loja_id = ?`, [req.params.id]);
  if (!saldo) {
    await dbRun('INSERT INTO saldo_lojas (loja_id) VALUES (?) ON CONFLICT (loja_id) DO NOTHING', [req.params.id]);
    saldo = { loja_id: Number(req.params.id), saldo: 0, total_recebido: 0, total_sacado: 0 };
  }
  const movimentacoes = await dbAll(`SELECT id, pedido_id, descricao,
    valor_bruto::double precision AS valor_bruto,
    valor_comissao::double precision AS valor_comissao,
    valor_liquido::double precision AS valor_liquido, tipo, data
    FROM movimentacoes_lojas WHERE loja_id = ? ORDER BY data DESC LIMIT 50`, [req.params.id]);
  res.json({ saldo, movimentacoes });
});

// ============ PEDIDOS API (NOVO FLUXO COMPLETO) ============

async function montarItensPedido(lojaId, itens) {
  if (!Array.isArray(itens) || itens.length === 0) throw new Error('Carrinho vazio');
  const quantidades = new Map();
  for (const item of itens) {
    const id = Number(item.id);
    const quantidade = Number(item.qty);
    if (!Number.isInteger(id) || !Number.isInteger(quantidade) || quantidade < 1 || quantidade > 999) {
      throw new Error('Item ou quantidade inválida');
    }
    quantidades.set(id, (quantidades.get(id) || 0) + quantidade);
  }
  const ids = [...quantidades.keys()];
  const marcadores = ids.map(() => '?').join(', ');
  const produtos = await dbAll(`SELECT id, loja_id, nome, preco, estoque FROM produtos
    WHERE id IN (${marcadores}) AND ativo = 1`, ids);
  if (produtos.length !== ids.length) throw new Error('Um produto não está mais disponível');

  let total = 0;
  const itensConfirmados = produtos.map(produto => {
    if (Number(produto.loja_id) !== Number(lojaId)) throw new Error('Todos os produtos precisam ser da mesma loja');
    const qty = quantidades.get(Number(produto.id));
    if (Number(produto.estoque) < qty) throw new Error(`Estoque insuficiente para ${produto.nome}`);
    const preco = Number(produto.preco);
    total += preco * qty;
    return { id: produto.id, nome: produto.nome, preco, qty };
  });
  return { itens: itensConfirmados, totalProdutos: arredondarDinheiro(total) };
}

function pagamentoPublico(pagamento) {
  if (!pagamento) return null;
  return {
    pedido_id: Number(pagamento.pedido_id),
    status: pagamento.status,
    valor: Number(pagamento.valor),
    pix_copia_cola: pagamento.pix_copia_cola,
    qr_code: pagamento.pix_qr_code,
    expira_em: pagamento.expira_em,
    confirmado_em: pagamento.confirmado_em,
    ambiente_teste: pagamento.provedor === 'mock',
    permite_simulacao_admin: pagamento.provedor === 'mock'
  };
}

async function obterOuCriarPagamentoTeste(tx, pedido) {
  const existente = await tx.get('SELECT * FROM pagamentos WHERE pedido_id = ?', [pedido.id]);
  if (existente) return existente;

  if (PAYMENT_MODE !== 'mock') {
    throw Object.assign(new Error('O provedor Pix real ainda não está habilitado'), { status: 503 });
  }

  const referencia = criarReferenciaPagamentoTeste({ pedidoId: pedido.id, valor: pedido.total_final });
  const qrCode = await QRCode.toDataURL(referencia.pixCopiaCola, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 280
  });
  await tx.run(`INSERT INTO pagamentos
    (pedido_id, provedor, provedor_pagamento_id, idempotency_key, status, valor,
     pix_copia_cola, pix_qr_code, expira_em)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [pedido.id, referencia.provedor, referencia.provedorPagamentoId, referencia.idempotencyKey,
    STATUS_PAGAMENTO.AGUARDANDO, Number(pedido.total_final), referencia.pixCopiaCola,
    qrCode, referencia.expiraEm]);
  return tx.get('SELECT * FROM pagamentos WHERE pedido_id = ?', [pedido.id]);
}

app.get('/api/configuracoes-compra', async (req, res) => {
  const config = await obterConfiguracaoFrete();
  res.json({
    pedido_minimo: Number(config.pedido_minimo),
    limite_pedido_pequeno: Number(config.limite_pedido_pequeno),
    taxa_pedido_pequeno: Number(config.taxa_pedido_pequeno)
  });
});

app.post('/api/frete/cotacao', authCliente, async (req, res) => {
  try {
    const { loja_id, latitude, longitude } = req.body;
    const loja = await dbGet('SELECT id, latitude, longitude FROM lojas WHERE id = ? AND aberto = 1', [loja_id]);
    if (!loja) return res.status(404).json({ error: 'Loja não encontrada ou fechada' });
    const cotacao = await calcularCotacaoFrete(loja, latitude, longitude);
    res.json({ success: true, ...cotacao });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error('Erro ao calcular frete:', error);
    res.status(500).json({ error: 'Não foi possível calcular o frete' });
  }
});

// Cliente faz pedido. Preços e comissão são sempre recalculados no servidor.
app.post('/api/pedidos', authCliente, async (req, res) => {
  try {
    const { loja_id, itens, tipo_entrega, endereco_entrega, bairro_entrega, latitude_entrega, longitude_entrega, forma_pagamento, observacao } = req.body;
    if (!['entrega', 'retirada'].includes(tipo_entrega)) return res.status(400).json({ error: 'Tipo de entrega inválido' });
    if (tipo_entrega === 'entrega' && !endereco_entrega) return res.status(400).json({ error: 'Informe o endereço de entrega' });
    const loja = await dbGet('SELECT id, plano, comissao_percentual, inicio_promocao, latitude, longitude FROM lojas WHERE id = ? AND aberto = 1', [loja_id]);
    if (!loja) return res.status(404).json({ error: 'Loja não encontrada ou fechada' });
    const carrinho = await montarItensPedido(loja_id, itens);
    const configuracao = await obterConfiguracaoFrete();
    const regraPedido = calcularTaxaPedidoPequeno(carrinho.totalProdutos, configuracao);
    if (!regraPedido.permitido) {
      return res.status(400).json({
        error: `O pedido mínimo é R$ ${regraPedido.pedidoMinimo.toFixed(2)}. Adicione mais R$ ${regraPedido.valorFaltante.toFixed(2)} em produtos.`,
        codigo: 'PEDIDO_MINIMO_NAO_ATINGIDO',
        pedido_minimo: regraPedido.pedidoMinimo,
        valor_faltante: regraPedido.valorFaltante
      });
    }
    const cotacao = tipo_entrega === 'entrega'
      ? await calcularCotacaoFrete(loja, latitude_entrega, longitude_entrega)
      : { valor_frete: 0, distancia_km: 0, taxa_base: 0, adicional_clima_percentual: 0, adicional_pico_percentual: 0 };
    const comissaoLoja = calcularPercentualPromocional(loja.inicio_promocao);
    // O ganho do entregador é calculado quando ele aceita, usando a rota completa
    // (posição atual -> loja -> cliente). Até lá o pedido não reserva repasse.
    const comissaoEntrega = 0;
    const financeiro = calcularFinanceiroPedido({
      totalProdutos: carrinho.totalProdutos,
      taxaEntrega: cotacao.valor_frete,
      taxaPedidoPequeno: regraPedido.taxaAplicada,
      tipoEntrega: tipo_entrega,
      planoLoja: loja.plano,
      comissaoPercentual: comissaoLoja,
      percentualEntregador: 0
    });
    const codigo = Math.random().toString(36).substring(2, 8).toUpperCase();

    const result = await dbRun(`INSERT INTO pedidos
      (cliente_id, loja_id, itens, total_produtos, taxa_entrega, taxa_pedido_pequeno,
       pedido_minimo_aplicado, limite_pedido_pequeno_aplicado, total_final, tipo_entrega,
       endereco_entrega, bairro_entrega, latitude_entrega, longitude_entrega, distancia_km,
       forma_pagamento, observacao, codigo_retirada, status, valor_motoboy, valor_plataforma,
       plano_loja, comissao_loja_percentual, comissao_entrega_percentual,
       taxa_base_entrega, adicional_clima_percentual, adicional_pico_percentual,
       valor_comissao_loja, valor_liquido_loja)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.usuario.id, loja_id, JSON.stringify(carrinho.itens), carrinho.totalProdutos,
       financeiro.taxaEntrega, financeiro.taxaPedidoPequeno, regraPedido.pedidoMinimo,
       regraPedido.limitePedidoPequeno, financeiro.totalFinal, tipo_entrega, endereco_entrega,
       bairro_entrega, latitude_entrega || null, longitude_entrega || null, cotacao.distancia_km,
       forma_pagamento || 'pix', observacao, tipo_entrega === 'retirada' ? codigo : null, 'aguardando_confirmacao',
       financeiro.valorMotoboy, financeiro.valorPlataformaEntrega, financeiro.planoLoja,
       financeiro.comissaoPercentual, comissaoEntrega, cotacao.taxa_base,
       cotacao.adicional_clima_percentual, cotacao.adicional_pico_percentual,
       financeiro.valorComissaoLoja, financeiro.valorLiquidoLoja]);

    res.json({
      success: true,
      pedido_id: result.lastID,
      codigo_retirada: tipo_entrega === 'retirada' ? codigo : null,
      total_produtos: carrinho.totalProdutos,
      taxa_entrega: financeiro.taxaEntrega,
      taxa_pedido_pequeno: financeiro.taxaPedidoPequeno,
      total_final: financeiro.totalFinal,
      distancia_km: cotacao.distancia_km,
      adicional_clima_percentual: cotacao.adicional_clima_percentual,
      adicional_pico_percentual: cotacao.adicional_pico_percentual,
      faixa_frete: cotacao.faixa_frete || null
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    const mensagensPermitidas = ['Carrinho vazio', 'Item ou quantidade inválida', 'Um produto não está mais disponível', 'Todos os produtos precisam ser da mesma loja'];
    if (mensagensPermitidas.includes(error.message) || error.message.startsWith('Estoque insuficiente')) {
      return res.status(400).json({ error: error.message });
    }
    console.error('Erro ao criar pedido:', error);
    res.status(500).json({ error: 'Não foi possível criar o pedido' });
  }
});

// Cliente confirma o valor. O pedido fica invisível para a loja até o Pix ser confirmado.
app.put('/api/pedidos/:id/confirmar', authCliente, async (req, res) => {
  try {
    const resultado = await dbTransaction(async tx => {
      const pedido = await tx.get('SELECT * FROM pedidos WHERE id = ? FOR UPDATE', [req.params.id]);
      if (!pedido) throw Object.assign(new Error('Pedido não encontrado'), { status: 404 });
      if (pedido.cliente_id != req.usuario.id) throw Object.assign(new Error('Esse pedido não é seu'), { status: 403 });

      const { confirmou } = req.body;
      if (!confirmou) {
        if (!['aguardando_confirmacao', 'aguardando_pagamento'].includes(pedido.status)) {
          throw Object.assign(new Error('Pedido já foi processado'), { status: 400 });
        }
        await tx.run("UPDATE pedidos SET status = 'cancelado' WHERE id = ?", [pedido.id]);
        await tx.run("UPDATE pagamentos SET status = 'cancelado', atualizado_em = CURRENT_TIMESTAMP WHERE pedido_id = ? AND status = 'aguardando'", [pedido.id]);
        return { cancelado: true };
      }

      if (!['aguardando_confirmacao', 'aguardando_pagamento'].includes(pedido.status)) {
        throw Object.assign(new Error('Pedido já foi processado'), { status: 400 });
      }
      const pagamento = await obterOuCriarPagamentoTeste(tx, pedido);
      await tx.run("UPDATE pedidos SET cliente_confirmou = 1, status = 'aguardando_pagamento' WHERE id = ?", [pedido.id]);
      return { cancelado: false, pagamento };
    });

    if (resultado.cancelado) return res.json({ success: true, message: 'Pedido cancelado.' });
    res.json({
      success: true,
      message: 'Pedido criado. A loja só receberá depois da confirmação do Pix.',
      pagamento: pagamentoPublico(resultado.pagamento)
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error('Erro ao preparar Pix de teste:', error);
    res.status(500).json({ error: 'Não foi possível preparar o pagamento de teste' });
  }
});

// Cliente consulta somente o pagamento de um pedido que pertence à sua conta.
app.get('/api/pagamentos/pedido/:pedido_id', authCliente, async (req, res) => {
  let pagamento = await dbGet(`SELECT pg.* FROM pagamentos pg
    JOIN pedidos p ON p.id = pg.pedido_id
    WHERE pg.pedido_id = ? AND p.cliente_id = ?`, [req.params.pedido_id, req.usuario.id]);
  if (!pagamento) return res.status(404).json({ error: 'Pagamento não encontrado' });

  if (pagamentoExpirado(pagamento)) {
    await dbTransaction(async tx => {
      await tx.run("UPDATE pagamentos SET status = 'expirado', atualizado_em = CURRENT_TIMESTAMP WHERE id = ? AND status = 'aguardando'", [pagamento.id]);
      await tx.run("UPDATE pedidos SET status = 'cancelado' WHERE id = ? AND status = 'aguardando_pagamento'", [pagamento.pedido_id]);
    });
    pagamento = await dbGet('SELECT * FROM pagamentos WHERE id = ?', [pagamento.id]);
  }
  res.json({ pagamento: pagamentoPublico(pagamento) });
});

// O botão existe somente no painel administrativo e somente no modo de teste.
app.post('/api/admin/pagamentos/:pedido_id/simular', authAdmin, async (req, res) => {
  if (PAYMENT_MODE !== 'mock') return res.status(403).json({ error: 'Simulação desativada fora do ambiente de teste' });
  try {
    const resultado = await dbTransaction(async tx => {
      const pagamento = await tx.get('SELECT * FROM pagamentos WHERE pedido_id = ? FOR UPDATE', [req.params.pedido_id]);
      const pedido = await tx.get('SELECT * FROM pedidos WHERE id = ? FOR UPDATE', [req.params.pedido_id]);
      if (!pagamento || !pedido) throw Object.assign(new Error('Pagamento não encontrado'), { status: 404 });
      if (pagamento.status === STATUS_PAGAMENTO.RECEBIDO) return pagamento;
      if (pagamento.status !== STATUS_PAGAMENTO.AGUARDANDO || pedido.status !== 'aguardando_pagamento') {
        throw Object.assign(new Error('Esse pagamento não pode mais ser confirmado'), { status: 409 });
      }
      await tx.run(`UPDATE pagamentos SET status = 'recebido', confirmado_em = CURRENT_TIMESTAMP,
        atualizado_em = CURRENT_TIMESTAMP WHERE id = ?`, [pagamento.id]);
      await tx.run(`UPDATE pedidos SET pix_pago = 1, status = 'aguardando',
        data_confirmacao = CURRENT_TIMESTAMP WHERE id = ?`, [pedido.id]);
      return tx.get('SELECT * FROM pagamentos WHERE id = ?', [pagamento.id]);
    });
    res.json({
      success: true,
      message: 'Pix de teste confirmado. O pedido foi liberado para a loja.',
      pagamento: pagamentoPublico(resultado)
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error('Erro ao simular pagamento:', error);
    res.status(500).json({ error: 'Não foi possível confirmar o pagamento de teste' });
  }
});

// Lojas veem pedidos
app.get('/api/pedidos/loja/:loja_id', authLojas, async (req, res) => {
  if (req.usuario.id != req.params.loja_id) return res.status(403).json({ error: 'Permissão negada' });
  const { status } = req.query;
  let sql = `SELECT p.*, c.nome as cliente_nome, c.telefone as cliente_telefone, c.endereco_padrao, c.bairro
    FROM pedidos p JOIN clientes c ON p.cliente_id = c.id
    WHERE p.loja_id = ? AND p.status NOT IN ('aguardando_confirmacao', 'aguardando_pagamento')`;
  const params = [req.params.loja_id];
  if (status) { sql += ' AND p.status = ?'; params.push(status); }
  sql += ' ORDER BY p.data_pedido DESC';
  const pedidos = await dbAll(sql, params);
  res.json({ pedidos });
});

// LOJA: Separar pedido (coloca quem separou e finaliza)
app.put('/api/pedidos/:id/separar', authLojas, async (req, res) => {
  const pedido = await dbGet('SELECT * FROM pedidos WHERE id = ?', [req.params.id]);
  if (!pedido) return res.status(404).json({ error: 'Pedido não encontrado' });
  if (pedido.loja_id != req.usuario.id) return res.status(403).json({ error: 'Esse pedido não é da sua loja' });
  if (pedido.status !== 'confirmado') return res.status(400).json({ error: 'Pedido precisa estar confirmado' });
  
  const { separado_por } = req.body;
  if (!separado_por) return res.status(400).json({ error: 'Informe quem separou o pedido' });
  
  await dbRun("UPDATE pedidos SET status = 'separado', separado_por = ?, data_separado = CURRENT_TIMESTAMP WHERE id = ?", [separado_por, req.params.id]);
  res.json({ success: true, message: 'Pedido separado e disponível para entrega!' });
});

// A loja inicia a entrega quando escolheu usar entregador próprio.
app.put('/api/pedidos/:id/iniciar-entrega-loja', authLojas, async (req, res) => {
  const pedido = await dbGet('SELECT * FROM pedidos WHERE id = ?', [req.params.id]);
  if (!pedido) return res.status(404).json({ error: 'Pedido não encontrado' });
  if (pedido.loja_id != req.usuario.id) return res.status(403).json({ error: 'Esse pedido não é da sua loja' });
  if (normalizarPlanoLoja(pedido.plano_loja) !== 'loja' || pedido.tipo_entrega !== 'entrega') {
    return res.status(400).json({ error: 'Este pedido usa entrega ObraExpress ou retirada' });
  }
  if (pedido.status !== 'separado') return res.status(400).json({ error: 'O pedido precisa estar separado' });
  await dbRun("UPDATE pedidos SET status = 'saiu_entrega', data_saida = CURRENT_TIMESTAMP WHERE id = ?", [req.params.id]);
  res.json({ success: true, message: 'Pedido saiu para entrega pela loja' });
});

// Cliente vê seus pedidos
app.get('/api/pedidos/cliente/:cliente_id', authCliente, async (req, res) => {
  if (req.usuario.id != req.params.cliente_id) return res.status(403).json({ error: 'Permissão negada' });
  const pedidos = await dbAll(`SELECT p.*, l.nome as loja_nome, l.logo as loja_logo,
    e.nome as entregador_nome, e.foto as entregador_foto, e.veiculo as entregador_veiculo,
    pg.status AS pagamento_status, pg.expira_em AS pagamento_expira_em
    FROM pedidos p 
    JOIN lojas l ON p.loja_id = l.id 
    LEFT JOIN entregadores e ON p.entregador_id = e.id
    LEFT JOIN pagamentos pg ON pg.pedido_id = p.id
    WHERE p.cliente_id = ? ORDER BY p.data_pedido DESC`, [req.params.cliente_id]);
  res.json({ pedidos });
});

// Entregador vê os pedidos dele
app.get('/api/pedidos/entregador/:entregador_id', authEntregador, async (req, res) => {
  if (req.usuario.id != req.params.entregador_id) return res.status(403).json({ error: 'Permissão negada' });
  const pedidos = await dbAll(`SELECT p.*, l.nome as loja_nome, l.endereco as loja_endereco, 
    l.latitude as loja_latitude, l.longitude as loja_longitude, l.telefone as loja_telefone,
    c.nome as cliente_nome, c.telefone as cliente_telefone, COALESCE(p.endereco_entrega, c.endereco_padrao) as cliente_endereco,
    COALESCE(p.latitude_entrega, c.latitude) as cliente_latitude,
    COALESCE(p.longitude_entrega, c.longitude) as cliente_longitude
    FROM pedidos p 
    JOIN lojas l ON p.loja_id = l.id 
    JOIN clientes c ON p.cliente_id = c.id 
    WHERE p.entregador_id = ? ORDER BY p.data_pedido DESC`, [req.params.entregador_id]);
  res.json({ pedidos });
});

// ENTREGADOR: Ver pedidos disponíveis (status = separado, precisa de entrega)
app.get('/api/pedidos/disponiveis', authEntregador, async (req, res) => {
  const entregador = await dbGet('SELECT latitude, longitude FROM entregadores WHERE id = ?', [req.usuario.id]);
  if (!coordenadaValida(entregador?.latitude, entregador?.longitude)) {
    return res.json({ pedidos: [], gps_pendente: true, mensagem: 'Aguardando uma localização GPS válida' });
  }
  const configuracao = await obterConfiguracaoFrete();
  const pedidos = await dbAll(`SELECT p.*, l.nome as loja_nome, l.endereco as loja_endereco, 
    l.latitude as loja_latitude, l.longitude as loja_longitude, l.telefone as loja_telefone, l.chave_pix,
    c.nome as cliente_nome, c.telefone as cliente_telefone, COALESCE(p.endereco_entrega, c.endereco_padrao) as cliente_endereco,
    COALESCE(p.latitude_entrega, c.latitude) as cliente_latitude,
    COALESCE(p.longitude_entrega, c.longitude) as cliente_longitude
    FROM pedidos p 
    JOIN lojas l ON p.loja_id = l.id 
    JOIN clientes c ON p.cliente_id = c.id 
    WHERE p.status = 'separado' AND p.tipo_entrega = 'entrega'
      AND p.plano_loja = 'entrega_obraexpress' AND p.entregador_id IS NULL 
    ORDER BY p.data_pedido ASC`);
  const ofertas = pedidos.map(pedido => {
    const oferta = calcularOfertaEntregador(pedido, entregador, configuracao);
    return {
      ...pedido,
      valor_motoboy: oferta.valorLiquido,
      distancia_coleta_km: oferta.distanciaColetaKm,
      distancia_total_entrega_km: oferta.distanciaTotalKm,
      bonus_entregador_percentual: oferta.bonusPercentual,
      coleta_preferencial: oferta.coletaPreferencial
    };
  }).filter(pedido => Number(pedido.distancia_coleta_km) <= Number(configuracao.raio_maximo_coleta || 5))
    .sort((a, b) => Number(b.coleta_preferencial) - Number(a.coleta_preferencial) || Number(a.distancia_coleta_km) - Number(b.distancia_coleta_km));
  res.json({ pedidos: ofertas, raio_maximo_coleta: Number(configuracao.raio_maximo_coleta || 5) });
});

// ENTREGADOR: Aceitar pedido
app.put('/api/pedidos/:id/aceitar', authEntregador, async (req, res) => {
  try {
    const configuracao = await obterConfiguracaoFrete();
    const resultado = await dbTransaction(async tx => {
      const entregador = await tx.get('SELECT id, latitude, longitude FROM entregadores WHERE id = ? FOR UPDATE', [req.usuario.id]);
      const pedido = await tx.get(`SELECT p.*, l.latitude AS loja_latitude, l.longitude AS loja_longitude
        FROM pedidos p JOIN lojas l ON l.id = p.loja_id WHERE p.id = ? FOR UPDATE`, [req.params.id]);
      if (!pedido || pedido.status !== 'separado' || pedido.entregador_id || pedido.plano_loja !== 'entrega_obraexpress') {
        throw Object.assign(new Error('Essa entrega não está mais disponível'), { status: 409 });
      }
      const oferta = calcularOfertaEntregador(pedido, entregador, configuracao);
      if (!oferta.coletaPermitida) {
        throw Object.assign(new Error(`Você está além do raio de coleta de ${Number(configuracao.raio_maximo_coleta || 5)} km`), { status: 409 });
      }
      await tx.run(`UPDATE pedidos SET entregador_id = ?, status = 'em_coleta',
        comissao_entrega_percentual = 0, valor_motoboy = ?, valor_plataforma = ?,
        distancia_coleta_km = ?, distancia_total_entrega_km = ? WHERE id = ?`,
      [req.usuario.id, oferta.valorLiquido, oferta.margemPlataformaEntrega,
        oferta.distanciaColetaKm, oferta.distanciaTotalKm, pedido.id]);
      await tx.run('UPDATE entregadores SET disponivel = 0 WHERE id = ?', [req.usuario.id]);
      return oferta;
    });
    res.json({
      success: true,
      message: 'Pedido aceito! Vá até a loja para buscar.',
      valor_liquido: resultado.valorLiquido,
      distancia_total_km: resultado.distanciaTotalKm,
      bonus_percentual: resultado.bonusPercentual
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error('Erro ao aceitar entrega:', error);
    res.status(500).json({ error: 'Não foi possível aceitar a entrega' });
  }
});

// ENTREGADOR: Recusar pedido (volta pra lista)
app.put('/api/pedidos/:id/recusar', authEntregador, async (req, res) => {
  const pedido = await dbGet('SELECT * FROM pedidos WHERE id = ?', [req.params.id]);
  if (!pedido) return res.status(404).json({ error: 'Pedido não encontrado' });
  if (pedido.entregador_id != req.usuario.id) return res.status(403).json({ error: 'Você não pode recusar um pedido que não é seu' });
  
  await dbRun(`UPDATE pedidos SET entregador_id = NULL, status = ?, valor_motoboy = 0,
    valor_plataforma = taxa_entrega, distancia_coleta_km = 0,
    distancia_total_entrega_km = distancia_km WHERE id = ?`,
  ['separado', req.params.id]);
  await dbRun('UPDATE entregadores SET disponivel = 1 WHERE id = ?', [req.usuario.id]);
  
  res.json({ success: true, message: 'Pedido recusado. Voltou para a lista de disponíveis.' });
});

// ENTREGADOR: Foto da coleta (depois de conferir na loja)
app.put('/api/pedidos/:id/foto-coleta', authEntregador, async (req, res) => {
  const pedido = await dbGet('SELECT * FROM pedidos WHERE id = ?', [req.params.id]);
  if (!pedido) return res.status(404).json({ error: 'Pedido não encontrado' });
  if (pedido.entregador_id != req.usuario.id) return res.status(403).json({ error: 'Permissão negada' });
  if (pedido.status !== 'em_coleta') return res.status(400).json({ error: 'Status inválido para foto de coleta' });
  
  const { foto } = req.body;
  if (!foto) return res.status(400).json({ error: 'Envie a foto da coleta' });
  
  await dbRun("UPDATE pedidos SET foto_coleta = ?, data_coleta = CURRENT_TIMESTAMP, status = 'saiu_entrega' WHERE id = ?", [foto, req.params.id]);
  res.json({ success: true, message: 'Foto da coleta registrada! Vá entregar.' });
});

async function registrarRepasseFinanceiro(tx, pedido, entregadorId = null) {
  if (Number(pedido.repasse_processado)) return false;
  const valorLoja = Number(pedido.valor_liquido_loja || 0);
  const comissaoLoja = Number(pedido.valor_comissao_loja || 0);
  const valorMotoboy = entregadorId ? Number(pedido.valor_motoboy || 0) : 0;
  const valorPlataformaEntrega = Number(pedido.valor_plataforma || 0);
  const taxaPedidoPequeno = Number(pedido.taxa_pedido_pequeno || 0);

  await tx.run('INSERT INTO saldo_lojas (loja_id) VALUES (?) ON CONFLICT (loja_id) DO NOTHING', [pedido.loja_id]);
  await tx.run(`UPDATE saldo_lojas SET saldo = saldo + ?, total_recebido = total_recebido + ?
    WHERE loja_id = ?`, [valorLoja, valorLoja, pedido.loja_id]);
  await tx.run(`INSERT INTO movimentacoes_lojas
    (loja_id, pedido_id, descricao, valor_bruto, valor_comissao, valor_liquido, tipo)
    VALUES (?, ?, ?, ?, ?, ?, ?)`, [pedido.loja_id, pedido.id, `Venda do pedido #${pedido.id}`,
    Number(pedido.total_produtos || 0), comissaoLoja, valorLoja, 'credito']);

  if (comissaoLoja > 0) {
    await tx.run('INSERT INTO saldo_plataforma (descricao, valor, tipo, pedido_id) VALUES (?, ?, ?, ?)',
      [`Comissão de ${Number(pedido.comissao_loja_percentual || 5)}% da loja — pedido #${pedido.id}`, comissaoLoja, 'credito', pedido.id]);
  }
  if (valorPlataformaEntrega > 0) {
    await tx.run('INSERT INTO saldo_plataforma (descricao, valor, tipo, pedido_id) VALUES (?, ?, ?, ?)',
      [`Margem positiva da entrega — pedido #${pedido.id}`, valorPlataformaEntrega, 'credito', pedido.id]);
  } else if (valorPlataformaEntrega < 0) {
    await tx.run('INSERT INTO saldo_plataforma (descricao, valor, tipo, pedido_id) VALUES (?, ?, ?, ?)',
      [`Complemento pago ao entregador — pedido #${pedido.id}`, Math.abs(valorPlataformaEntrega), 'debito', pedido.id]);
  }
  if (taxaPedidoPequeno > 0) {
    await tx.run('INSERT INTO saldo_plataforma (descricao, valor, tipo, pedido_id) VALUES (?, ?, ?, ?)',
      [`Taxa de pedido pequeno — pedido #${pedido.id}`, taxaPedidoPequeno, 'credito', pedido.id]);
  }

  if (entregadorId) {
    await tx.run('INSERT INTO saldo_entregadores (entregador_id, saldo) VALUES (?, 0) ON CONFLICT (entregador_id) DO NOTHING', [entregadorId]);
    await tx.run(`UPDATE saldo_entregadores SET saldo = saldo + ?, total_ganho = total_ganho + ?
      WHERE entregador_id = ?`, [valorMotoboy, valorMotoboy, entregadorId]);
    await tx.run('UPDATE entregadores SET total_entregas = total_entregas + 1, disponivel = 1 WHERE id = ?', [entregadorId]);
    await tx.run(`UPDATE entregadores SET inicio_promocao = COALESCE(inicio_promocao, CURRENT_TIMESTAMP),
      comissao_percentual = ? WHERE id = ?`, [Number(pedido.comissao_entrega_percentual ?? 0), entregadorId]);
  }

  await tx.run(`UPDATE lojas SET inicio_promocao = COALESCE(inicio_promocao, CURRENT_TIMESTAMP),
    comissao_percentual = ? WHERE id = ?`, [Number(pedido.comissao_loja_percentual || 5), pedido.loja_id]);

  await tx.run('UPDATE pedidos SET repasse_processado = 1 WHERE id = ?', [pedido.id]);
  return true;
}

// ENTREGADOR: Finalizar entrega (foto + crédito automático)
app.put('/api/pedidos/:id/finalizar', authEntregador, async (req, res) => {
  const { foto } = req.body;
  if (!foto) return res.status(400).json({ error: 'Tire a foto da entrega para finalizar' });
  try {
    const resultado = await dbTransaction(async tx => {
      const pedido = await tx.get('SELECT * FROM pedidos WHERE id = ? FOR UPDATE', [req.params.id]);
      if (!pedido) throw Object.assign(new Error('Pedido não encontrado'), { status: 404 });
      if (pedido.entregador_id != req.usuario.id) throw Object.assign(new Error('Permissão negada'), { status: 403 });
      if (pedido.status !== 'saiu_entrega') throw Object.assign(new Error('Pedido não está em entrega'), { status: 400 });
      await tx.run("UPDATE pedidos SET foto_entrega = ?, status = 'entregue', data_entrega = CURRENT_TIMESTAMP WHERE id = ?", [foto, pedido.id]);
      await registrarRepasseFinanceiro(tx, pedido, req.usuario.id);
      return { creditado: Number(pedido.valor_motoboy || 0), valorPlataforma: Number(pedido.valor_plataforma || 0) + Number(pedido.valor_comissao_loja || 0) + Number(pedido.taxa_pedido_pequeno || 0) };
    });
    res.json({ success: true, message: '✅ Entrega finalizada!', creditado: resultado.creditado, valor_plataforma: resultado.valorPlataforma });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error('Erro ao finalizar entrega:', error);
    res.status(500).json({ error: 'Não foi possível finalizar a entrega' });
  }
});

// Loja conclui retirada ou entrega feita por sua própria equipe.
app.put('/api/pedidos/:id/finalizar-loja', authLojas, async (req, res) => {
  try {
    const resultado = await dbTransaction(async tx => {
      const pedido = await tx.get('SELECT * FROM pedidos WHERE id = ? FOR UPDATE', [req.params.id]);
      if (!pedido) throw Object.assign(new Error('Pedido não encontrado'), { status: 404 });
      if (pedido.loja_id != req.usuario.id) throw Object.assign(new Error('Esse pedido não é da sua loja'), { status: 403 });
      const retiradaValida = pedido.tipo_entrega === 'retirada' && pedido.status === 'separado';
      const entregaLojaValida = pedido.tipo_entrega === 'entrega' && normalizarPlanoLoja(pedido.plano_loja) === 'loja' && pedido.status === 'saiu_entrega';
      if (!retiradaValida && !entregaLojaValida) throw Object.assign(new Error('Pedido ainda não pode ser concluído pela loja'), { status: 400 });
      if (retiradaValida && String(req.body.codigo_retirada || '').trim().toUpperCase() !== String(pedido.codigo_retirada || '').toUpperCase()) {
        throw Object.assign(new Error('Código de retirada incorreto'), { status: 400 });
      }
      await tx.run("UPDATE pedidos SET status = 'entregue', data_entrega = CURRENT_TIMESTAMP WHERE id = ?", [pedido.id]);
      await registrarRepasseFinanceiro(tx, pedido, null);
      return { valorLoja: Number(pedido.valor_liquido_loja || 0) };
    });
    res.json({ success: true, message: 'Pedido concluído e repasse calculado', valor_loja: resultado.valorLoja });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error('Erro ao concluir pedido da loja:', error);
    res.status(500).json({ error: 'Não foi possível concluir o pedido' });
  }
});

// Loja responsável ou administrador atualiza o status do pedido.
app.put('/api/pedidos/:id/status', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token não fornecido' });
  try {
    const usuario = jwt.verify(token, JWT_SECRET);
    const { status, entregador_id } = req.body;
    const pedido = await dbGet('SELECT * FROM pedidos WHERE id = ?', [req.params.id]);
    if (!pedido) return res.status(404).json({ error: 'Pedido não encontrado' });
    if (!['admin', 'loja'].includes(usuario.tipo)) {
      return res.status(403).json({ error: 'Permissão negada' });
    }
    if (usuario.tipo === 'loja' && pedido.loja_id != usuario.id) {
      return res.status(403).json({ error: 'Esse pedido não pertence à sua loja' });
    }
    if (usuario.tipo === 'loja' && !['confirmado', 'cancelado'].includes(status)) {
      return res.status(403).json({ error: 'A loja não pode aplicar esse status' });
    }
    if (usuario.tipo === 'loja' && status === 'confirmado' && pedido.status !== 'aguardando') {
      return res.status(400).json({ error: 'Este pedido não está aguardando confirmação da loja' });
    }
    if (usuario.tipo === 'loja' && status === 'cancelado' && !['aguardando', 'confirmado'].includes(pedido.status)) {
      return res.status(400).json({ error: 'Este pedido não pode mais ser cancelado pela loja' });
    }
    if (pedido.forma_pagamento === 'pix' && !Number(pedido.pix_pago)
      && status && !['aguardando_confirmacao', 'aguardando_pagamento', 'cancelado'].includes(status)) {
      return res.status(409).json({ error: 'O pedido ainda não possui confirmação de pagamento' });
    }

    const updates = []; const params = [];
    if (status) { updates.push('status = ?'); params.push(status); }
    if (entregador_id !== undefined) { updates.push('entregador_id = ?'); params.push(entregador_id); }
    if (status === 'confirmado') updates.push('data_confirmacao = CURRENT_TIMESTAMP');
    if (status === 'saiu_entrega') updates.push('data_saida = CURRENT_TIMESTAMP');
    if (status === 'entregue') updates.push('data_entrega = CURRENT_TIMESTAMP');
    if (updates.length === 0) return res.status(400).json({ error: 'Nada para atualizar' });
    params.push(req.params.id);
    await dbRun(`UPDATE pedidos SET ${updates.join(', ')} WHERE id = ?`, params);
    res.json({ success: true });
  } catch { res.status(401).json({ error: 'Token inválido' }); }
});

// ============ AVALIAÇÕES ============
app.post('/api/avaliacoes', authCliente, async (req, res) => {
  const { pedido_id, loja_id, entregador_id, nota, comentario } = req.body;
  if (!nota || nota < 1 || nota > 5) return res.status(400).json({ error: 'Nota deve ser entre 1 e 5' });
  
  const pedido = await dbGet('SELECT * FROM pedidos WHERE id = ?', [pedido_id]);
  if (!pedido) return res.status(404).json({ error: 'Pedido não encontrado' });
  if (pedido.cliente_id != req.usuario.id) return res.status(403).json({ error: 'Permissão negada' });
  if (pedido.status !== 'entregue') return res.status(400).json({ error: 'Só pode avaliar pedidos entregues' });
  
  await dbRun('INSERT INTO avaliacoes (pedido_id, cliente_id, loja_id, entregador_id, nota, comentario) VALUES (?, ?, ?, ?, ?, ?)',
    [pedido_id, req.usuario.id, loja_id || null, entregador_id || null, nota, comentario || null]);
  
  // Atualizar avaliação do entregador
  if (entregador_id) {
    const media = await dbGet('SELECT AVG(nota) as media FROM avaliacoes WHERE entregador_id = ?', [entregador_id]);
    if (media && media.media) {
      await dbRun('UPDATE entregadores SET avaliacao = ? WHERE id = ?', [Math.round(media.media * 10) / 10, entregador_id]);
    }
  }
  
  res.json({ success: true, message: 'Avaliação registrada! ⭐' });
});

// ============ CATEGORIAS ============
app.get('/api/categorias', async (req, res) => {
  const categorias = await dbAll('SELECT * FROM categorias WHERE COALESCE(ativa, 1) = 1 ORDER BY ordem');
  res.json({ categorias });
});

// ============ DISTÂNCIA ============
app.get('/api/distancia', async (req, res) => {
  const { origem_lat, origem_lng, dest_lat, dest_lng } = req.query;
  if (!coordenadaValida(origem_lat, origem_lng) || !coordenadaValida(dest_lat, dest_lng)) {
    return res.status(400).json({ error: 'Coordenadas necessárias' });
  }
  try {
    const cotacao = await calcularCotacaoFrete({ latitude: origem_lat, longitude: origem_lng }, dest_lat, dest_lng);
    res.json(cotacao);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Não foi possível calcular a distância' });
  }
});

// ============ ADMIN API ============
app.post('/api/admin/login', async (req, res) => {
  const { email, senha } = req.body;
  if (email === ADMIN_EMAIL && senha === ADMIN_PASSWORD) {
    const token = jwt.sign({ id: 0, tipo: 'admin' }, JWT_SECRET, { expiresIn: '8h' });
    return res.json({ success: true, token });
  }
  res.status(401).json({ error: 'Credenciais de admin inválidas' });
});

app.get('/api/admin/configuracoes-entrega', authAdmin, async (req, res) => {
  res.json({ configuracao: await obterConfiguracaoFrete(), horario_pico: horarioDePico() });
});

app.put('/api/admin/configuracoes-entrega', authAdmin, async (req, res) => {
  const configuracaoAtual = await obterConfiguracaoFrete();
  const limites = {
    frete_base: [0, 100],
    valor_km: [0, 100],
    frete_faixa_ate_2: [0, 100],
    frete_faixa_ate_4: [0, 100],
    frete_faixa_ate_6: [0, 100],
    frete_faixa_ate_8: [0, 100],
    distancia_maxima_entrega: [1, 30],
    ganho_minimo_entregador: [0, 100],
    ganho_km_entregador: [0, 100],
    limite_bonus_entregador_percentual: [0, 100],
    raio_preferencial_coleta: [0, 30],
    raio_maximo_coleta: [0, 30],
    fator_rota: [1, 3],
    adicional_chuva_percentual: [0, 100],
    adicional_pico_percentual: [0, 100],
    limite_adicionais_percentual: [0, 10],
    pedido_minimo: [0, 1000],
    limite_pedido_pequeno: [0, 1000],
    taxa_pedido_pequeno: [0, 100]
  };
  const updates = [];
  const params = [];
  for (const [campo, [minimo, maximo]] of Object.entries(limites)) {
    if (req.body[campo] !== undefined) {
      const valor = Number(req.body[campo]);
      if (!Number.isFinite(valor) || valor < minimo || valor > maximo) return res.status(400).json({ error: `Valor inválido em ${campo}` });
      updates.push(`${campo} = ?`); params.push(valor);
    }
  }
  const pedidoMinimo = req.body.pedido_minimo === undefined ? Number(configuracaoAtual.pedido_minimo) : Number(req.body.pedido_minimo);
  const limitePedidoPequeno = req.body.limite_pedido_pequeno === undefined ? Number(configuracaoAtual.limite_pedido_pequeno) : Number(req.body.limite_pedido_pequeno);
  if (limitePedidoPequeno < pedidoMinimo) {
    return res.status(400).json({ error: 'O limite do pedido pequeno não pode ser menor que o pedido mínimo' });
  }
  const valorFinal = campo => req.body[campo] === undefined ? Number(configuracaoAtual[campo]) : Number(req.body[campo]);
  const faixas = ['frete_faixa_ate_2', 'frete_faixa_ate_4', 'frete_faixa_ate_6', 'frete_faixa_ate_8'].map(valorFinal);
  if (faixas.some((valor, indice) => indice > 0 && valor < faixas[indice - 1])) {
    return res.status(400).json({ error: 'As faixas de frete precisam crescer junto com a distância' });
  }
  if (valorFinal('raio_maximo_coleta') < valorFinal('raio_preferencial_coleta')) {
    return res.status(400).json({ error: 'O raio máximo de coleta não pode ser menor que o raio preferencial' });
  }
  if (req.body.condicao_climatica !== undefined) {
    if (!['normal', 'chuva', 'perigoso'].includes(req.body.condicao_climatica)) return res.status(400).json({ error: 'Condição climática inválida' });
    updates.push('condicao_climatica = ?'); params.push(req.body.condicao_climatica);
  }
  if (req.body.entregas_ativas !== undefined) {
    updates.push('entregas_ativas = ?'); params.push(req.body.entregas_ativas ? 1 : 0);
  }
  if (!updates.length) return res.status(400).json({ error: 'Nada para atualizar' });
  updates.push('atualizado_em = CURRENT_TIMESTAMP');
  params.push(1);
  await dbRun(`UPDATE configuracoes_plataforma SET ${updates.join(', ')} WHERE id = ?`, params);
  res.json({ success: true, configuracao: await obterConfiguracaoFrete() });
});

// Excluir a própria conta e seus dados relacionados
app.delete('/api/clientes/:id', authCliente, async (req, res) => {
  if (req.usuario.id != req.params.id) return res.status(403).json({ error: 'Permissão negada' });
  try {
    await dbRun("DELETE FROM aceites_termos WHERE tipo_usuario = 'cliente' AND usuario_id = ?", [req.params.id]);
    await dbRun('DELETE FROM avaliacoes WHERE cliente_id = ?', [req.params.id]);
    await dbRun('DELETE FROM pedidos WHERE cliente_id = ?', [req.params.id]);
    await dbRun('DELETE FROM clientes WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Conta do cliente excluída. O e-mail pode ser reutilizado.' });
  } catch (e) { res.status(500).json({ error: 'Não foi possível excluir a conta' }); }
});

app.delete('/api/entregadores/:id', authEntregador, async (req, res) => {
  if (req.usuario.id != req.params.id) return res.status(403).json({ error: 'Permissão negada' });
  try {
    await dbRun("DELETE FROM aceites_termos WHERE tipo_usuario = 'entregador' AND usuario_id = ?", [req.params.id]);
    await dbRun('DELETE FROM avaliacoes WHERE entregador_id = ?', [req.params.id]);
    await dbRun('DELETE FROM saldo_entregadores WHERE entregador_id = ?', [req.params.id]);
    await dbRun('UPDATE pedidos SET entregador_id = NULL WHERE entregador_id = ?', [req.params.id]);
    await dbRun('DELETE FROM entregadores WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Conta do entregador excluída. O e-mail e CPF podem ser reutilizados.' });
  } catch (e) { res.status(500).json({ error: 'Não foi possível excluir a conta' }); }
});

app.delete('/api/lojas/:id', authLojas, async (req, res) => {
  if (req.usuario.id != req.params.id) return res.status(403).json({ error: 'Permissão negada' });
  try {
    await dbRun("DELETE FROM aceites_termos WHERE tipo_usuario = 'loja' AND usuario_id = ?", [req.params.id]);
    const pedidos = await dbAll('SELECT id FROM pedidos WHERE loja_id = ?', [req.params.id]);
    for (const p of pedidos) await dbRun('DELETE FROM avaliacoes WHERE pedido_id = ?', [p.id]);
    await dbRun('DELETE FROM pedidos WHERE loja_id = ?', [req.params.id]);
    await dbRun('DELETE FROM produtos WHERE loja_id = ?', [req.params.id]);
    await dbRun('DELETE FROM lojas WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Conta da loja e produtos excluídos. O e-mail pode ser reutilizado.' });
  } catch (e) { res.status(500).json({ error: 'Não foi possível excluir a conta da loja' }); }
});

// Limpeza autorizada das contas e dados de teste, somente pelo administrador
app.post('/api/admin/limpar-dados-teste', authAdmin, async (req, res) => {
  try {
    for (const sql of [
      'DELETE FROM aceites_termos', 'DELETE FROM avaliacoes', 'DELETE FROM saldo_plataforma',
      'DELETE FROM movimentacoes_lojas', 'DELETE FROM saldo_lojas',
      'DELETE FROM saldo_entregadores', 'DELETE FROM pedidos',
      'DELETE FROM produtos', 'DELETE FROM lojas',
      'DELETE FROM clientes', 'DELETE FROM entregadores'
    ]) await dbRun(sql);
    res.json({ success: true, message: 'Todos os dados de teste foram excluídos. E-mails, CPFs e CNPJs podem ser reutilizados.' });
  } catch (e) { console.error('Limpeza de teste:', e); res.status(500).json({ error: 'A limpeza não foi concluída' }); }
});

app.get('/api/admin/dashboard', authAdmin, async (req, res) => {
  const totalLojas = await dbGet('SELECT COUNT(*) as total FROM lojas');
  const totalEntregadores = await dbGet('SELECT COUNT(*) as total FROM entregadores');
  const totalClientes = await dbGet('SELECT COUNT(*) as total FROM clientes');
  const pedidosHoje = await dbGet("SELECT COUNT(*) as total FROM pedidos WHERE (data_pedido::timestamptz AT TIME ZONE 'America/Araguaina')::date = (CURRENT_TIMESTAMP AT TIME ZONE 'America/Araguaina')::date");
  const pedidosPendentes = await dbGet("SELECT COUNT(*) as total FROM pedidos WHERE status NOT IN ('entregue', 'cancelado')");
  const faturamento = await dbGet("SELECT COALESCE(SUM(CASE WHEN tipo = 'credito' THEN valor ELSE -valor END), 0) as total FROM saldo_plataforma");
  const ultimosPedidos = await dbAll(`SELECT p.id, p.status, p.total_final, p.data_pedido, 
    l.nome as loja_nome, c.nome as cliente_nome, e.nome as entregador_nome
    FROM pedidos p 
    JOIN lojas l ON p.loja_id = l.id 
    JOIN clientes c ON p.cliente_id = c.id 
    LEFT JOIN entregadores e ON p.entregador_id = e.id
    ORDER BY p.data_pedido DESC LIMIT 20`);
  
  res.json({
    lojas: totalLojas?.total || 0,
    entregadores: totalEntregadores?.total || 0,
    clientes: totalClientes?.total || 0,
    pedidosHoje: pedidosHoje?.total || 0,
    pedidosPendentes: pedidosPendentes?.total || 0,
    faturamento: faturamento?.total || 0,
    ultimosPedidos
  });
});

app.get('/api/admin/pedidos', authAdmin, async (req, res) => {
  const { status } = req.query;
  let sql = `SELECT p.*, l.nome as loja_nome, c.nome as cliente_nome, e.nome as entregador_nome,
    pg.status AS pagamento_status, pg.provedor AS pagamento_provedor
    FROM pedidos p 
    JOIN lojas l ON p.loja_id = l.id 
    JOIN clientes c ON p.cliente_id = c.id 
    LEFT JOIN entregadores e ON p.entregador_id = e.id
    LEFT JOIN pagamentos pg ON pg.pedido_id = p.id`;
  const params = [];
  if (status) { sql += ' WHERE p.status = ?'; params.push(status); }
  sql += ' ORDER BY p.data_pedido DESC LIMIT 50';
  const pedidos = await dbAll(sql, params);
  res.json({ pedidos });
});

app.get('/api/admin/financeiro', authAdmin, async (req, res) => {
  const saldoPlataforma = await dbAll('SELECT * FROM saldo_plataforma ORDER BY data DESC LIMIT 50');
  const saldoEntregadores = await dbAll(`SELECT se.*, e.nome as entregador_nome, e.email, e.chave_pix,
    e.inicio_promocao, e.comissao_percentual
    FROM saldo_entregadores se 
    JOIN entregadores e ON se.entregador_id = e.id 
    ORDER BY se.saldo DESC`);
  const saldoLojas = await dbAll(`SELECT sl.loja_id,
    sl.saldo::double precision AS saldo,
    sl.total_recebido::double precision AS total_recebido,
    sl.total_sacado::double precision AS total_sacado,
    l.nome as loja_nome, l.email, l.chave_pix, l.plano, l.inicio_promocao,
    l.comissao_percentual::double precision AS comissao_percentual
    FROM saldo_lojas sl
    JOIN lojas l ON sl.loja_id = l.id
    ORDER BY sl.saldo DESC`);
  const totalPlataforma = await dbGet("SELECT COALESCE(SUM(CASE WHEN tipo = 'credito' THEN valor ELSE -valor END), 0) as total FROM saldo_plataforma");
  res.json({
    saldoPlataforma,
    saldoEntregadores: saldoEntregadores.map(item => ({
      ...item,
      comissao_percentual: calcularPercentualPromocional(item.inicio_promocao)
    })),
    saldoLojas: saldoLojas.map(item => ({
      ...item,
      comissao_percentual: calcularPercentualPromocional(item.inicio_promocao)
    })),
    totalPlataforma: totalPlataforma?.total || 0
  });
});

// ============ SERVE FRONTEND ============
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 ObraExpress rodando na porta ${PORT}`);
});
