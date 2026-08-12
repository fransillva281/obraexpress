const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
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
const { calcularJanelaOfertaEntrega } = require('./dispatch-utils');
const { apenasDigitos, validarCPF, validarCNPJ } = require('./document-validator');
const {
  VALIDADE_CODIGO_MINUTOS,
  MAX_TENTATIVAS_CODIGO,
  normalizarTipoConta,
  normalizarEmail,
  gerarCodigoRecuperacao,
  criarHashCodigo,
  codigoFormatoValido
} = require('./password-reset-utils');
const { emailRecuperacaoConfigurado, enviarCodigoRecuperacao } = require('./email-utils');

const app = express();
const PORT = process.env.PORT || 3000;
app.set('trust proxy', Number(process.env.TRUST_PROXY || 1));
app.disable('x-powered-by');

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

const TERMOS_VERSION = '2026-08-12.1';
const PRIVACIDADE_VERSION = '2026-08-12.1';
const STATUS_CADASTRO = Object.freeze({
  PENDENTE: 'pendente',
  APROVADO: 'aprovado',
  RECUSADO: 'recusado',
  SUSPENSO: 'suspenso'
});

function textoSeguro(valor, limite = 255) {
  return String(valor ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/</g, '‹').replace(/>/g, '›')
    .trim().slice(0, limite);
}

function emailValido(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim()) && String(email).length <= 254;
}

function senhaValida(senha) {
  return typeof senha === 'string' && senha.length >= 8 && senha.length <= 128;
}

function tabelaContaPorTipo(tipo) {
  return { cliente: 'clientes', loja: 'lojas', entregador: 'entregadores' }[tipo] || null;
}

function criarTokenConta(conta, tipo) {
  return jwt.sign({ id: conta.id, tipo, sv: Number(conta.sessao_versao || 1) }, JWT_SECRET, { expiresIn: '7d' });
}

function cepValido(cep) {
  return apenasDigitos(cep).length === 8;
}

function ufValida(estado) {
  return /^[A-Z]{2}$/.test(String(estado || '').trim().toUpperCase());
}

function documentoValido(valor, tamanho) {
  if (tamanho === 11) return validarCPF(valor);
  if (tamanho === 14) return validarCNPJ(valor);
  return false;
}

function imagemValida(foto) {
  if (!foto) return true;
  if (typeof foto !== 'string' || foto.length > 2_800_000) return false;
  return /^data:image\/(jpeg|jpg|png|webp);base64,/i.test(foto) || /^https:\/\//i.test(foto);
}

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

function horarioDePico(agora = new Date(), fusoHorario = FUSO_PLATAFORMA) {
  let fuso = textoSeguro(fusoHorario, 64) || FUSO_PLATAFORMA;
  try { new Intl.DateTimeFormat('pt-BR', { timeZone: fuso }).format(agora); } catch { fuso = FUSO_PLATAFORMA; }
  const partes = new Intl.DateTimeFormat('pt-BR', {
    timeZone: fuso,
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
    raio_expansao_coleta: 8,
    tempo_expansao_coleta_segundos: 30,
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
  const configCidade = loja.cidade && loja.estado ? await dbGet(`SELECT ativa, fuso_horario, distancia_maxima_entrega
    FROM configuracoes_cidades WHERE LOWER(TRIM(cidade)) = LOWER(TRIM(?))
      AND UPPER(TRIM(estado)) = UPPER(TRIM(?)) LIMIT 1`, [loja.cidade, loja.estado]) : null;
  if (configCidade && !Number(configCidade.ativa)) {
    throw Object.assign(new Error('As entregas estão temporariamente pausadas nesta cidade'), { status: 409 });
  }
  if (!Number(config.entregas_ativas) || config.condicao_climatica === 'perigoso') {
    throw Object.assign(new Error('Entregas temporariamente pausadas por segurança'), { status: 409 });
  }
  const distanciaReta = calcularDistanciaRetaKm(loja.latitude, loja.longitude, latitudeEntrega, longitudeEntrega);
  const distanciaEstimada = Math.max(0.5, distanciaReta * Number(config.fator_rota || 1.2));
  const limiteLoja = Math.min(
    Number(loja.raio_entrega_km || 30),
    Number(configCidade?.distancia_maxima_entrega || config.distancia_maxima_entrega || 8)
  );
  if (distanciaEstimada > limiteLoja) {
    throw Object.assign(new Error(`Endereço fora da área desta loja. Limite: ${limiteLoja.toFixed(1)} km.`), { status: 400 });
  }
  const faixaFrete = calcularFretePorFaixa(distanciaEstimada, config);
  if (!faixaFrete.disponivel) {
    throw Object.assign(new Error(`Endereço fora da área de entrega por moto. Limite atual: ${faixaFrete.distanciaMaxima} km da loja.`), { status: 400 });
  }
  const taxaBase = faixaFrete.valor;
  const adicionalClima = config.condicao_climatica === 'chuva' ? Number(config.adicional_chuva_percentual || 0) : 0;
  const pico = horarioDePico(agora, configCidade?.fuso_horario || loja.fuso_horario || FUSO_PLATAFORMA);
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
    coletaPermitida: coletaEstimada <= Math.max(
      Number(configuracao.raio_preferencial_coleta || 3),
      Number(configuracao.raio_maximo_coleta || 5),
      Number(configuracao.raio_expansao_coleta || 8)
    ),
    margemPlataformaEntrega: arredondarDinheiro(Number(pedido.taxa_entrega || 0) - ganho.valorLiquido)
  };
}

// Segurança HTTP. O front oficial usa a mesma origem; domínios adicionais
// precisam ser declarados explicitamente em CORS_ORIGINS.
const origensPermitidas = new Set(
  String(process.env.CORS_ORIGINS || process.env.PUBLIC_URL || 'https://obraexpress-1.onrender.com,http://localhost:3000')
    .split(',').map(item => item.trim()).filter(Boolean)
);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      // Compatibilidade temporaria com os botoes atuais, que ainda usam
      // atributos onclick. Sem esta diretiva o Helmet acrescenta
      // `script-src-attr 'none'` e toda a interface fica sem responder.
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      frameSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: 'no-referrer' }
}));
app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)');
  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
  }
  next();
});
app.use(cors({
  origin(origin, callback) {
    if (!origin || origensPermitidas.has(origin)) return callback(null, true);
    return callback(new Error('Origem não autorizada'));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: process.env.JSON_LIMIT || '3mb', strict: true }));

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 180,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Muitas solicitações. Aguarde um minuto e tente novamente.' }
});
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Muitas tentativas de acesso. Aguarde 15 minutos.' }
});
const recuperacaoSenhaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Muitas tentativas. Aguarde 15 minutos e tente novamente.' }
});
app.use('/api', apiLimiter);
app.use(['/api/admin/login', '/api/clientes/login', '/api/lojas/login', '/api/entregadores/login'], loginLimiter);
app.use(['/api/auth/recuperacao-senha/solicitar', '/api/auth/recuperacao-senha/redefinir'], recuperacaoSenhaLimiter);
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
    const tabelaConta = tabelaContaPorTipo(req.usuario.tipo);
    const situacao = tabelaConta ? await dbGet(`SELECT status_cadastro, status_motivo, sessao_versao FROM ${tabelaConta} WHERE id = ?`, [req.usuario.id]) : null;
    if (!situacao) return res.status(404).json({ error: 'Conta não encontrada' });
    if (Number(req.usuario.sv || 1) !== Number(situacao.sessao_versao || 1)) {
      return res.status(401).json({ error: 'Sessão encerrada. Entre novamente com sua senha.' });
    }
    if (situacao.status_cadastro === STATUS_CADASTRO.SUSPENSO) {
      return res.status(403).json({ error: 'Conta suspensa. Consulte o suporte.', motivo: situacao.status_motivo || null });
    }
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

async function authQualquer(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token não fornecido' });
  try {
    req.usuario = jwt.verify(token, JWT_SECRET);
    if (!['cliente', 'loja', 'entregador', 'admin'].includes(req.usuario.tipo)) {
      return res.status(403).json({ error: 'Tipo de conta inválido' });
    }
    const tabelaConta = tabelaContaPorTipo(req.usuario.tipo);
    if (tabelaConta) {
      const conta = await dbGet(`SELECT sessao_versao FROM ${tabelaConta} WHERE id = ?`, [req.usuario.id]);
      if (!conta) return res.status(404).json({ error: 'Conta não encontrada' });
      if (Number(req.usuario.sv || 1) !== Number(conta.sessao_versao || 1)) {
        return res.status(401).json({ error: 'Sessão encerrada. Entre novamente com sua senha.' });
      }
    }
    next();
  } catch { res.status(401).json({ error: 'Token inválido' }); }
}

async function exigirCadastroAprovado(req, res, next) {
  if (!['loja', 'entregador'].includes(req.usuario?.tipo)) return next();
  const tabela = req.usuario.tipo === 'loja' ? 'lojas' : 'entregadores';
  const conta = await dbGet(`SELECT status_cadastro, status_motivo FROM ${tabela} WHERE id = ?`, [req.usuario.id]);
  if (!conta) return res.status(404).json({ error: 'Conta não encontrada' });
  if (conta.status_cadastro !== STATUS_CADASTRO.APROVADO) {
    return res.status(403).json({
      error: conta.status_cadastro === STATUS_CADASTRO.SUSPENSO
        ? 'Conta suspensa. Consulte o suporte.'
        : 'Cadastro aguardando aprovação administrativa.',
      codigo: 'CADASTRO_NAO_APROVADO',
      status_cadastro: conta.status_cadastro,
      motivo: conta.status_motivo || null
    });
  }
  next();
}

async function criarNotificacao(executor, { tipoUsuario, usuarioId = null, titulo, mensagem, pedidoId = null }) {
  await executor.run(`INSERT INTO notificacoes
    (tipo_usuario, usuario_id, titulo, mensagem, pedido_id)
    VALUES (?, ?, ?, ?, ?)`,
  [tipoUsuario, usuarioId, textoSeguro(titulo, 120), textoSeguro(mensagem, 500), pedidoId]);
}

async function registrarAuditoria(req, acao, entidade, entidadeId, detalhes = '') {
  await dbRun(`INSERT INTO auditoria_admin (acao, entidade, entidade_id, detalhes, ip_hash)
    VALUES (?, ?, ?, ?, ?)`,
  [textoSeguro(acao, 80), textoSeguro(entidade, 80), entidadeId || null, textoSeguro(detalhes, 1000), hashIpRequisicao(req)]);
}

function itensDoPedido(pedido) {
  try {
    const itens = JSON.parse(pedido.itens || '[]');
    if (!Array.isArray(itens)) throw new Error();
    return itens;
  } catch {
    throw Object.assign(new Error('Itens do pedido inválidos'), { status: 500 });
  }
}

async function reservarEstoque(tx, pedido) {
  const existente = await tx.get('SELECT id FROM reservas_estoque WHERE pedido_id = ? LIMIT 1', [pedido.id]);
  if (existente) return;
  for (const item of itensDoPedido(pedido)) {
    const produto = await tx.get('SELECT id, nome, estoque, estoque_baixo_limite, ativo FROM produtos WHERE id = ? AND loja_id = ? FOR UPDATE', [item.id, pedido.loja_id]);
    const quantidade = Number(item.qty);
    if (!produto || !Number(produto.ativo)) {
      throw Object.assign(new Error(`${item.nome || 'Produto'} não está mais disponível`), { status: 409 });
    }
    if (!Number.isInteger(quantidade) || quantidade < 1 || Number(produto.estoque) < quantidade) {
      throw Object.assign(new Error(`Estoque insuficiente para ${produto.nome}`), { status: 409 });
    }
    await tx.run('UPDATE produtos SET estoque = estoque - ? WHERE id = ?', [quantidade, produto.id]);
    await tx.run(`INSERT INTO reservas_estoque (pedido_id, produto_id, quantidade, status)
      VALUES (?, ?, ?, 'reservado')`, [pedido.id, produto.id, quantidade]);
    if (Number(produto.estoque) - quantidade <= Number(produto.estoque_baixo_limite || 5)) {
      await criarNotificacao(tx, { tipoUsuario: 'loja', usuarioId: pedido.loja_id, titulo: 'Estoque baixo', mensagem: `${produto.nome} ficou com ${Number(produto.estoque) - quantidade} unidade(s).`, pedidoId: pedido.id });
    }
  }
}

async function liberarReservaEstoque(tx, pedidoId) {
  const reservas = await tx.all(`SELECT id, produto_id, quantidade FROM reservas_estoque
    WHERE pedido_id = ? AND status IN ('reservado', 'confirmado') FOR UPDATE`, [pedidoId]);
  for (const reserva of reservas) {
    await tx.run('UPDATE produtos SET estoque = estoque + ? WHERE id = ?', [reserva.quantidade, reserva.produto_id]);
    await tx.run("UPDATE reservas_estoque SET status = 'liberado', atualizado_em = CURRENT_TIMESTAMP WHERE id = ?", [reserva.id]);
  }
}

async function confirmarReservaEstoque(tx, pedidoId) {
  await tx.run("UPDATE reservas_estoque SET status = 'confirmado', atualizado_em = CURRENT_TIMESTAMP WHERE pedido_id = ? AND status = 'reservado'", [pedidoId]);
}

async function consumirReservaEstoque(tx, pedidoId) {
  await tx.run("UPDATE reservas_estoque SET status = 'consumido', atualizado_em = CURRENT_TIMESTAMP WHERE pedido_id = ? AND status IN ('reservado', 'confirmado')", [pedidoId]);
}

async function cancelarPedidoComSeguranca(tx, pedido, solicitadoPor, motivo) {
  if (['entregue', 'cancelado'].includes(pedido.status)) {
    throw Object.assign(new Error('Este pedido não pode mais ser cancelado'), { status: 409 });
  }
  if (['separado', 'em_coleta', 'saiu_entrega'].includes(pedido.status)) {
    throw Object.assign(new Error('O pedido já está em preparação ou entrega. Solicite ajuda ao suporte.'), { status: 409 });
  }
  await liberarReservaEstoque(tx, pedido.id);
  let reembolsoStatus = 'nao_aplicavel';
  if (Number(pedido.pix_pago)) {
    reembolsoStatus = 'pendente';
    await tx.run(`INSERT INTO reembolsos (pedido_id, solicitado_por, motivo, valor, status)
      VALUES (?, ?, ?, ?, 'pendente')
      ON CONFLICT (pedido_id) DO UPDATE SET motivo = EXCLUDED.motivo, atualizado_em = CURRENT_TIMESTAMP`,
    [pedido.id, solicitadoPor, textoSeguro(motivo, 500), Number(pedido.total_final)]);
  } else {
    await tx.run("UPDATE pagamentos SET status = 'cancelado', atualizado_em = CURRENT_TIMESTAMP WHERE pedido_id = ? AND status = 'aguardando'", [pedido.id]);
  }
  await tx.run(`UPDATE pedidos SET status = 'cancelado', cancelado_por = ?, motivo_cancelamento = ?,
    reembolso_status = ? WHERE id = ?`,
  [solicitadoPor, textoSeguro(motivo, 500), reembolsoStatus, pedido.id]);
  await criarNotificacao(tx, { tipoUsuario: 'cliente', usuarioId: pedido.cliente_id, titulo: 'Pedido cancelado', mensagem: Number(pedido.pix_pago) ? 'Cancelamento registrado. O reembolso está em análise.' : 'O pedido foi cancelado.', pedidoId: pedido.id });
  await criarNotificacao(tx, { tipoUsuario: 'loja', usuarioId: pedido.loja_id, titulo: 'Pedido cancelado', mensagem: `Pedido #${pedido.id} cancelado.`, pedidoId: pedido.id });
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

// ============ CENTRAL DE PRIVACIDADE E DIREITOS LGPD ============
const TIPOS_SOLICITACAO_PRIVACIDADE = new Set([
  'acesso', 'correcao', 'exclusao', 'revisao_decisao_automatizada',
  'revogacao_consentimento', 'outro'
]);
const STATUS_SOLICITACAO_PRIVACIDADE = new Set(['recebida', 'em_analise', 'concluida', 'recusada']);

function exigirTitular(req, res) {
  if (!['cliente', 'loja', 'entregador'].includes(req.usuario?.tipo)) {
    res.status(403).json({ error: 'Esta função é exclusiva do titular dos dados' });
    return false;
  }
  return true;
}

app.get('/api/privacidade/exportar', authQualquer, async (req, res) => {
  if (!exigirTitular(req, res)) return;
  const { tipo, id } = req.usuario;
  let perfil;
  let historico = [];
  let dadosComplementares = {};

  if (tipo === 'cliente') {
    perfil = await dbGet(`SELECT id, nome, email, telefone, endereco_padrao, bairro, cep,
      cidade, estado, latitude, longitude, status_cadastro, data_cadastro
      FROM clientes WHERE id = ?`, [id]);
    historico = await dbAll(`SELECT id, total_produtos, taxa_entrega, taxa_pedido_pequeno,
      total_final, tipo_entrega, endereco_entrega, bairro_entrega, distancia_km,
      forma_pagamento, observacao, status, data_pedido, data_confirmacao, data_entrega
      FROM pedidos WHERE cliente_id = ? ORDER BY data_pedido DESC`, [id]);
  } else if (tipo === 'loja') {
    perfil = await dbGet(`SELECT id, nome, cnpj, email, telefone, whatsapp, chave_pix,
      endereco, bairro, cep, cidade, estado, latitude, longitude, raio_entrega_km,
      status_cadastro, status_motivo, descricao, categorias, plano, data_cadastro
      FROM lojas WHERE id = ?`, [id]);
    historico = await dbAll(`SELECT id, total_produtos, taxa_entrega, taxa_pedido_pequeno,
      total_final, tipo_entrega, status, data_pedido, data_confirmacao, data_entrega,
      valor_comissao_loja, valor_liquido_loja
      FROM pedidos WHERE loja_id = ? ORDER BY data_pedido DESC`, [id]);
    dadosComplementares.produtos = await dbAll(`SELECT id, nome, descricao, preco, categoria,
      marca, unidade, estoque, ativo, data_cadastro FROM produtos WHERE loja_id = ?
      ORDER BY data_cadastro DESC`, [id]);
  } else {
    perfil = await dbGet(`SELECT id, nome, cpf, email, telefone, veiculo, placa, cep,
      cidade, estado, chave_pix, disponivel, avaliacao, total_entregas,
      status_cadastro, status_motivo, data_cadastro
      FROM entregadores WHERE id = ?`, [id]);
    historico = await dbAll(`SELECT id, taxa_entrega, status, data_pedido, data_coleta,
      data_saida, data_entrega, distancia_coleta_km, distancia_total_entrega_km,
      valor_motoboy FROM pedidos WHERE entregador_id = ? ORDER BY data_pedido DESC`, [id]);
  }

  if (!perfil) return res.status(404).json({ error: 'Conta não encontrada' });
  const aceites = await dbAll(`SELECT versao_termos, versao_privacidade, aceito_em
    FROM aceites_termos WHERE tipo_usuario = ? AND usuario_id = ? ORDER BY aceito_em DESC`, [tipo, id]);
  const solicitacoes = await dbAll(`SELECT id, tipo, descricao, status, resposta_admin,
    criada_em, atualizada_em FROM solicitacoes_privacidade
    WHERE tipo_usuario = ? AND usuario_id = ? ORDER BY criada_em DESC`, [tipo, id]);

  res.json({
    gerado_em: new Date().toISOString(),
    aviso: 'Arquivo destinado ao titular. Guarde-o em local seguro.',
    tipo_conta: tipo,
    perfil,
    historico,
    aceites,
    solicitacoes_privacidade: solicitacoes,
    ...dadosComplementares
  });
});

app.get('/api/privacidade/solicitacoes', authQualquer, async (req, res) => {
  if (!exigirTitular(req, res)) return;
  const solicitacoes = await dbAll(`SELECT id, tipo, descricao, status, resposta_admin,
    criada_em, atualizada_em FROM solicitacoes_privacidade
    WHERE tipo_usuario = ? AND usuario_id = ? ORDER BY criada_em DESC LIMIT 50`,
  [req.usuario.tipo, req.usuario.id]);
  res.json({ solicitacoes });
});

app.post('/api/privacidade/solicitacoes', authQualquer, async (req, res) => {
  if (!exigirTitular(req, res)) return;
  const tipoSolicitacao = textoSeguro(req.body.tipo, 50);
  const descricao = textoSeguro(req.body.descricao, 1000);
  if (!TIPOS_SOLICITACAO_PRIVACIDADE.has(tipoSolicitacao)) {
    return res.status(400).json({ error: 'Escolha um tipo de solicitação válido' });
  }
  const recentes = await dbGet(`SELECT COUNT(*) AS total FROM solicitacoes_privacidade
    WHERE tipo_usuario = ? AND usuario_id = ? AND criada_em > CURRENT_TIMESTAMP - INTERVAL '24 hours'`,
  [req.usuario.tipo, req.usuario.id]);
  if (Number(recentes?.total || 0) >= 5) {
    return res.status(429).json({ error: 'Limite diário atingido. Aguarde para enviar uma nova solicitação.' });
  }
  const resultado = await dbRun(`INSERT INTO solicitacoes_privacidade
    (tipo_usuario, usuario_id, tipo, descricao) VALUES (?, ?, ?, ?)`,
  [req.usuario.tipo, req.usuario.id, tipoSolicitacao, descricao || null]);
  await criarNotificacao({ run: dbRun }, {
    tipoUsuario: 'admin',
    titulo: 'Nova solicitação de privacidade',
    mensagem: `${req.usuario.tipo} enviou uma solicitação do tipo ${tipoSolicitacao}.`
  });
  res.status(201).json({
    success: true,
    id: resultado.lastID,
    status: 'recebida',
    message: 'Solicitação registrada. Acompanhe a resposta nesta central.'
  });
});

app.get('/api/privacidade/verificacao-identidade', authQualquer, async (req, res) => {
  if (!exigirTitular(req, res)) return;
  if (!['loja', 'entregador'].includes(req.usuario.tipo)) {
    return res.json({ aplicavel: false, coleta_biometrica_ativa: false });
  }
  const verificacao = await dbGet(`SELECT status, provedor, resultado_codigo, motivo,
    criada_em, atualizada_em, verificada_em FROM verificacoes_identidade
    WHERE tipo_usuario = ? AND usuario_id = ?`, [req.usuario.tipo, req.usuario.id]);
  res.json({
    aplicavel: true,
    coleta_biometrica_ativa: false,
    status: verificacao?.status || 'nao_iniciada',
    aviso: 'O ObraExpress ainda não recebe CNH, selfies ou biometria. A validação será ativada somente com provedor especializado e armazenamento privado.',
    verificacao: verificacao || null
  });
});

// ============ NOTIFICAÇÕES ============
app.get('/api/notificacoes', authQualquer, async (req, res) => {
  const notificacoes = await dbAll(`SELECT id, titulo, mensagem, pedido_id, lida, criada_em
    FROM notificacoes
    WHERE tipo_usuario = ? AND usuario_id = ?
    ORDER BY criada_em DESC LIMIT 50`, [req.usuario.tipo, req.usuario.id]);
  res.json({ notificacoes, nao_lidas: notificacoes.filter(item => !Number(item.lida)).length });
});

app.put('/api/notificacoes/:id/lida', authQualquer, async (req, res) => {
  await dbRun(`UPDATE notificacoes SET lida = 1
    WHERE id = ? AND tipo_usuario = ? AND usuario_id = ?`,
  [req.params.id, req.usuario.tipo, req.usuario.id]);
  res.json({ success: true });
});

app.put('/api/notificacoes/lidas/todas', authQualquer, async (req, res) => {
  await dbRun(`UPDATE notificacoes SET lida = 1
    WHERE tipo_usuario = ? AND usuario_id = ?`,
  [req.usuario.tipo, req.usuario.id]);
  res.json({ success: true });
});

// ============ RECUPERAÇÃO SEGURA DE SENHA ============
const MENSAGEM_RECUPERACAO = 'Se existir uma conta com esse e-mail, enviaremos um código válido por 10 minutos.';

app.post('/api/auth/recuperacao-senha/solicitar', async (req, res) => {
  const tipo = normalizarTipoConta(req.body.tipo_usuario);
  const email = normalizarEmail(req.body.email);
  if (!tipo) return res.status(400).json({ error: 'Escolha cliente, loja ou entregador' });
  if (!emailValido(email)) return res.json({ success: true, message: MENSAGEM_RECUPERACAO, envio_disponivel: emailRecuperacaoConfigurado() });
  if (!emailRecuperacaoConfigurado()) {
    return res.status(503).json({
      error: 'A recuperação por e-mail ainda não está configurada. Entre em contato com o suporte.',
      envio_disponivel: false
    });
  }

  const tabela = tabelaContaPorTipo(tipo);
  const conta = await dbGet(`SELECT id, nome, email FROM ${tabela} WHERE email = ?`, [email]);
  if (!conta) {
    await new Promise(resolve => setTimeout(resolve, 120));
    return res.json({ success: true, message: MENSAGEM_RECUPERACAO, envio_disponivel: true });
  }

  const codigo = gerarCodigoRecuperacao();
  const codigoHash = criarHashCodigo({ tipo, usuarioId: conta.id, codigo, segredo: JWT_SECRET });
  await dbRun(`UPDATE recuperacoes_senha SET usado_em = CURRENT_TIMESTAMP
    WHERE tipo_usuario = ? AND usuario_id = ? AND usado_em IS NULL`, [tipo, conta.id]);
  const registro = await dbRun(`INSERT INTO recuperacoes_senha
    (tipo_usuario, usuario_id, codigo_hash, expira_em, ip_hash)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP + INTERVAL '10 minutes', ?)`,
  [tipo, conta.id, codigoHash, hashIpRequisicao(req)]);

  try {
    const envio = await enviarCodigoRecuperacao({
      email: conta.email,
      nome: conta.nome,
      codigo,
      validadeMinutos: VALIDADE_CODIGO_MINUTOS,
      idempotencyKey: `obraexpress-recuperacao-${registro.lastID}`
    });
    await dbRun('UPDATE recuperacoes_senha SET envio_id = ? WHERE id = ?', [envio.id, registro.lastID]);
  } catch (error) {
    await dbRun('UPDATE recuperacoes_senha SET usado_em = CURRENT_TIMESTAMP WHERE id = ?', [registro.lastID]);
    console.error('Falha no envio do código de recuperação:', error.codigo || error.message);
  }

  res.json({ success: true, message: MENSAGEM_RECUPERACAO, envio_disponivel: true });
});

app.post('/api/auth/recuperacao-senha/redefinir', async (req, res) => {
  const tipo = normalizarTipoConta(req.body.tipo_usuario);
  const email = normalizarEmail(req.body.email);
  const codigo = String(req.body.codigo || '').trim();
  const novaSenha = req.body.nova_senha;
  if (!tipo) return res.status(400).json({ error: 'Escolha cliente, loja ou entregador' });
  if (!emailValido(email) || !codigoFormatoValido(codigo)) {
    return res.status(400).json({ error: 'Código inválido ou expirado' });
  }
  if (!senhaValida(novaSenha)) {
    return res.status(400).json({ error: 'A nova senha precisa ter entre 8 e 128 caracteres' });
  }

  const tabela = tabelaContaPorTipo(tipo);
  const conta = await dbGet(`SELECT id FROM ${tabela} WHERE email = ?`, [email]);
  if (!conta) return res.status(400).json({ error: 'Código inválido ou expirado' });

  const recuperacao = await dbGet(`SELECT id, codigo_hash, tentativas FROM recuperacoes_senha
    WHERE tipo_usuario = ? AND usuario_id = ? AND usado_em IS NULL
      AND expira_em > CURRENT_TIMESTAMP AND tentativas < ?
    ORDER BY criada_em DESC LIMIT 1`, [tipo, conta.id, MAX_TENTATIVAS_CODIGO]);
  if (!recuperacao) return res.status(400).json({ error: 'Código inválido ou expirado' });

  const recebidoHash = criarHashCodigo({ tipo, usuarioId: conta.id, codigo, segredo: JWT_SECRET });
  const codigoCorreto = crypto.timingSafeEqual(Buffer.from(recebidoHash, 'hex'), Buffer.from(recuperacao.codigo_hash, 'hex'));
  if (!codigoCorreto) {
    await dbRun(`UPDATE recuperacoes_senha
      SET tentativas = tentativas + 1,
          usado_em = CASE WHEN tentativas + 1 >= ? THEN CURRENT_TIMESTAMP ELSE usado_em END
      WHERE id = ?`, [MAX_TENTATIVAS_CODIGO, recuperacao.id]);
    return res.status(400).json({ error: 'Código inválido ou expirado' });
  }

  const novaSenhaHash = bcrypt.hashSync(novaSenha, 10);
  try {
    await dbTransaction(async tx => {
      const bloqueio = await tx.get(`SELECT id FROM recuperacoes_senha
        WHERE id = ? AND usado_em IS NULL AND expira_em > CURRENT_TIMESTAMP
          AND tentativas < ? FOR UPDATE`, [recuperacao.id, MAX_TENTATIVAS_CODIGO]);
      if (!bloqueio) throw Object.assign(new Error('Código inválido ou expirado'), { status: 400 });
      await tx.run(`UPDATE ${tabela} SET senha = ?, sessao_versao = COALESCE(sessao_versao, 1) + 1 WHERE id = ?`, [novaSenhaHash, conta.id]);
      await tx.run(`UPDATE recuperacoes_senha SET usado_em = CURRENT_TIMESTAMP
        WHERE tipo_usuario = ? AND usuario_id = ? AND usado_em IS NULL`, [tipo, conta.id]);
    });
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: 'Código inválido ou expirado' });
    console.error('Falha ao redefinir senha:', error.message);
    return res.status(500).json({ error: 'Não foi possível redefinir a senha' });
  }

  res.json({ success: true, message: 'Senha redefinida. Entre novamente usando a nova senha.' });
});

// ============ LOJAS API ============
app.post('/api/lojas/cadastro', async (req, res) => {
  const { nome, cnpj, email, senha, telefone, endereco, bairro, cep, cidade, estado, latitude, longitude, descricao, categorias, taxa_entrega_km, chave_pix, plano, tempo_entrega_min, raio_entrega_km } = req.body;
  try {
    if (!nome || !email || !senha || !cnpj) return res.status(400).json({ error: 'Nome, CNPJ, email e senha são obrigatórios' });
    if (!emailValido(email)) return res.status(400).json({ error: 'Informe um email válido' });
    if (!senhaValida(senha)) return res.status(400).json({ error: 'A senha precisa ter entre 8 e 128 caracteres' });
    if (!documentoValido(cnpj, 14)) return res.status(400).json({ error: 'Informe um CNPJ válido, com 14 números' });
    if (!cepValido(cep) || !cidade || !ufValida(estado)) return res.status(400).json({ error: 'Informe CEP, cidade e estado válidos' });
    if (!validarAceiteNoCadastro(req.body)) return res.status(400).json({ error: 'Leia e aceite os Termos e a Política de Privacidade' });
    const planoEscolhido = normalizarPlanoLoja(plano);
    const hash = bcrypt.hashSync(senha, 10);
    const taxaKm = Number(taxa_entrega_km || 2);
    if (!coordenadaValida(latitude, longitude)) return res.status(400).json({ error: 'Use o botão de GPS para marcar a localização da loja' });
    const result = await dbTransaction(async tx => {
      const insercao = await tx.run(`INSERT INTO lojas
        (nome, cnpj, email, senha, telefone, endereco, bairro, cep, cidade, estado,
         latitude, longitude, descricao, categorias, taxa_entrega_km, chave_pix, plano,
         comissao_percentual, tempo_entrega_min, raio_entrega_km, status_cadastro)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendente')`,
      [textoSeguro(nome, 160), apenasDigitos(cnpj), String(email).trim().toLowerCase(), hash,
        textoSeguro(telefone, 30), textoSeguro(endereco, 300), textoSeguro(bairro, 120), apenasDigitos(cep),
        textoSeguro(cidade, 120), String(estado).trim().toUpperCase(), Number(latitude), Number(longitude),
        textoSeguro(descricao, 1000), textoSeguro(categorias, 1000), taxaKm, textoSeguro(chave_pix, 180) || null,
        planoEscolhido, 5, textoSeguro(tempo_entrega_min, 40) || '30-60 min',
        Math.min(Math.max(Number(raio_entrega_km || 8), 1), 30)]);
      await tx.run(`INSERT INTO verificacoes_identidade (tipo_usuario, usuario_id, status)
        VALUES ('loja', ?, 'nao_iniciada')
        ON CONFLICT (tipo_usuario, usuario_id) DO NOTHING`, [insercao.lastID]);
      await registrarAceiteTermos('loja', insercao.lastID, req, tx);
      await criarNotificacao(tx, { tipoUsuario: 'admin', titulo: 'Nova loja aguardando aprovação', mensagem: `${textoSeguro(nome, 160)} enviou um cadastro para análise.` });
      return insercao;
    });
    const token = criarTokenConta({ id: result.lastID, sessao_versao: 1 }, 'loja');
    res.json({ success: true, id: result.lastID, token, termos_pendentes: false, status_cadastro: 'pendente', message: 'Cadastro enviado para aprovação.', loja: { id: result.lastID, nome, email, plano: planoEscolhido, comissao_percentual: 5, taxa_entrega_km: taxaKm, chave_pix: chave_pix || null, latitude: Number(latitude), longitude: Number(longitude), inicio_promocao: null, status_cadastro: 'pendente' } });
  } catch (e) {
    if (isUniqueViolation(e)) return res.status(400).json({ error: 'Email já cadastrado' });
    console.error('Erro ao cadastrar loja:', e);
    res.status(500).json({ error: 'Não foi possível cadastrar a loja' });
  }
});

app.post('/api/lojas/login', async (req, res) => {
  const { email, senha } = req.body;
  if (!emailValido(email) || typeof senha !== 'string') return res.status(400).json({ error: 'Informe email e senha' });
  const loja = await dbGet('SELECT * FROM lojas WHERE email = ?', [String(email).trim().toLowerCase()]);
  if (!loja) return res.status(401).json({ error: 'Email não encontrado' });
  if (!bcrypt.compareSync(senha, loja.senha)) return res.status(401).json({ error: 'Senha incorreta' });
  if (loja.status_cadastro === STATUS_CADASTRO.SUSPENSO) return res.status(403).json({ error: 'Conta suspensa. Consulte o suporte.', motivo: loja.status_motivo || null });
  loja.comissao_percentual = calcularPercentualPromocional(loja.inicio_promocao);
  await dbRun('UPDATE lojas SET comissao_percentual = ? WHERE id = ?', [loja.comissao_percentual, loja.id]);
  const token = criarTokenConta(loja, 'loja');
  res.json({ success: true, token, termos_pendentes: !(await possuiAceiteAtual('loja', loja.id)), status_cadastro: loja.status_cadastro, loja: { id: loja.id, nome: loja.nome, email: loja.email, logo: loja.logo, aberto: loja.aberto, taxa_entrega_km: loja.taxa_entrega_km, chave_pix: loja.chave_pix, plano: normalizarPlanoLoja(loja.plano), comissao_percentual: Number(loja.comissao_percentual), inicio_promocao: loja.inicio_promocao, latitude: loja.latitude, longitude: loja.longitude, cidade: loja.cidade, estado: loja.estado, cep: loja.cep, raio_entrega_km: loja.raio_entrega_km, status_cadastro: loja.status_cadastro, status_motivo: loja.status_motivo } });
});

app.get('/api/lojas', async (req, res) => {
  const { categoria, bairro, busca, cidade, estado, latitude, longitude } = req.query;
  let sql = `SELECT id, nome, logo, descricao, categorias, endereco, bairro, cep, cidade, estado,
    taxa_entrega_km, entrega_gratis_ate, tempo_entrega_min, aberto, latitude, longitude,
    raio_entrega_km, plano, comissao_percentual
    FROM lojas WHERE aberto = 1 AND status_cadastro = 'aprovado'`;
  const params = [];
  if (categoria) { sql += ' AND categorias ILIKE ?'; params.push(`%${categoria}%`); }
  if (bairro) { sql += ' AND bairro ILIKE ?'; params.push(`%${bairro}%`); }
  if (cidade) { sql += ' AND cidade ILIKE ?'; params.push(textoSeguro(cidade, 120)); }
  if (estado) { sql += ' AND UPPER(estado) = ?'; params.push(String(estado).trim().toUpperCase()); }
  if (busca) {
    sql += ' AND (nome ILIKE ? OR descricao ILIKE ? OR categorias ILIKE ? OR bairro ILIKE ?)';
    params.push(`%${busca}%`, `%${busca}%`, `%${busca}%`, `%${busca}%`);
  }
  sql += ' ORDER BY nome';
  let lojas = await dbAll(sql, params);
  if (coordenadaValida(latitude, longitude)) {
    lojas = lojas.map(loja => ({
      ...loja,
      distancia_km: Math.round(calcularDistanciaRetaKm(latitude, longitude, loja.latitude, loja.longitude) * 12) / 10
    })).filter(loja => Number.isFinite(loja.distancia_km) && loja.distancia_km <= Number(loja.raio_entrega_km || 8))
      .sort((a, b) => a.distancia_km - b.distancia_km);
  }
  res.json({ lojas });
});

app.get('/api/lojas/:id', async (req, res) => {
  const loja = await dbGet(`SELECT id, nome, logo, descricao, categorias, endereco, bairro, cep,
    cidade, estado, telefone, whatsapp, taxa_entrega_km, entrega_gratis_ate, tempo_entrega_min,
    aberto, latitude, longitude, raio_entrega_km, plano, comissao_percentual, inicio_promocao
    FROM lojas WHERE id = ? AND status_cadastro = 'aprovado'`, [req.params.id]);
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
  const { nome, telefone, whatsapp, chave_pix, endereco, bairro, cep, cidade, estado, latitude, longitude, descricao, categorias, taxa_entrega_km, entrega_gratis_ate, tempo_entrega_min, aberto, logo, plano, raio_entrega_km } = req.body;
  const updates = [];
  const params = [];
  if (nome !== undefined) { updates.push('nome = ?'); params.push(nome); }
  if (telefone !== undefined) { updates.push('telefone = ?'); params.push(telefone); }
  if (whatsapp !== undefined) { updates.push('whatsapp = ?'); params.push(whatsapp); }
  if (chave_pix !== undefined) { updates.push('chave_pix = ?'); params.push(chave_pix); }
  if (endereco !== undefined) { updates.push('endereco = ?'); params.push(endereco); }
  if (bairro !== undefined) { updates.push('bairro = ?'); params.push(bairro); }
  if (cep !== undefined) {
    if (!cepValido(cep)) return res.status(400).json({ error: 'CEP inválido' });
    updates.push('cep = ?'); params.push(apenasDigitos(cep));
  }
  if (cidade !== undefined) { updates.push('cidade = ?'); params.push(textoSeguro(cidade, 120)); }
  if (estado !== undefined) {
    if (!ufValida(estado)) return res.status(400).json({ error: 'Estado inválido' });
    updates.push('estado = ?'); params.push(String(estado).trim().toUpperCase());
  }
  if (latitude !== undefined) { updates.push('latitude = ?'); params.push(latitude); }
  if (longitude !== undefined) { updates.push('longitude = ?'); params.push(longitude); }
  if (descricao !== undefined) { updates.push('descricao = ?'); params.push(descricao); }
  if (categorias !== undefined) { updates.push('categorias = ?'); params.push(categorias); }
  if (taxa_entrega_km !== undefined) { updates.push('taxa_entrega_km = ?'); params.push(taxa_entrega_km); }
  if (entrega_gratis_ate !== undefined) { updates.push('entrega_gratis_ate = ?'); params.push(entrega_gratis_ate); }
  if (tempo_entrega_min !== undefined) { updates.push('tempo_entrega_min = ?'); params.push(tempo_entrega_min); }
  if (aberto !== undefined) { updates.push('aberto = ?'); params.push(aberto ? 1 : 0); }
  if (logo !== undefined) {
    if (!imagemValida(logo)) return res.status(400).json({ error: 'Imagem inválida ou maior que 2 MB' });
    updates.push('logo = ?'); params.push(logo);
  }
  if (plano !== undefined) { updates.push('plano = ?'); params.push(normalizarPlanoLoja(plano)); }
  if (raio_entrega_km !== undefined) {
    const raio = Number(raio_entrega_km);
    if (!Number.isFinite(raio) || raio < 1 || raio > 30) return res.status(400).json({ error: 'Raio de entrega inválido' });
    updates.push('raio_entrega_km = ?'); params.push(raio);
  }
  if (updates.length === 0) return res.status(400).json({ error: 'Nada para atualizar' });
  params.push(req.params.id);
  await dbRun(`UPDATE lojas SET ${updates.join(', ')} WHERE id = ?`, params);
  res.json({ success: true });
});

// ============ PRODUTOS API ============
app.post('/api/produtos', authLojas, exigirCadastroAprovado, async (req, res) => {
  const { loja_id, nome, descricao, preco, foto, categoria, marca, unidade, estoque } = req.body;
  if (req.usuario.id != loja_id) return res.status(403).json({ error: 'Permissão negada' });
  if (!nome || !preco || Number(preco) <= 0) return res.status(400).json({ error: 'Informe o nome e um preço válido' });
  if (!categoria) return res.status(400).json({ error: 'Escolha uma categoria' });
  const estoqueInicial = estoque === undefined ? 0 : Number(estoque);
  if (!Number.isInteger(estoqueInicial) || estoqueInicial < 0 || estoqueInicial > 1000000) return res.status(400).json({ error: 'Informe uma quantidade de estoque válida' });
  if (!imagemValida(foto)) return res.status(400).json({ error: 'Imagem inválida ou maior que 2 MB' });
  try {
    const loja = await dbGet('SELECT id FROM lojas WHERE id = ?', [loja_id]);
    if (!loja) return res.status(404).json({ error: 'A loja desta sessão não foi encontrada no banco atual. Faça o cadastro novamente.' });
    const categoriaOficial = await dbGet('SELECT nome FROM categorias WHERE LOWER(TRIM(nome)) = LOWER(TRIM(?)) AND COALESCE(ativa, 1) = 1', [categoria]);
    if (!categoriaOficial) return res.status(400).json({ error: 'Categoria inválida. Escolha uma opção da lista.' });
    const result = await dbRun('INSERT INTO produtos (loja_id, nome, descricao, preco, foto, categoria, marca, unidade, estoque) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [loja_id, textoSeguro(nome, 180), textoSeguro(descricao, 1000) || null, Number(preco), foto || null, categoriaOficial.nome, textoSeguro(marca, 120) || null, textoSeguro(unidade, 30) || 'un', estoqueInicial]);
    const produto = await dbGet('SELECT * FROM produtos WHERE id = ?', [result.lastID]);
    if (!produto) return res.status(500).json({ error: 'O produto não foi confirmado no banco de dados' });
    res.json({ success: true, id: result.lastID, produto });
  } catch (e) {
    console.error('Erro ao cadastrar produto:', e);
    res.status(500).json({ error: 'Não foi possível salvar o produto. Tente novamente.' });
  }
});

app.put('/api/produtos/:id', authLojas, exigirCadastroAprovado, async (req, res) => {
  const produto = await dbGet('SELECT * FROM produtos WHERE id = ?', [req.params.id]);
  if (!produto) return res.status(404).json({ error: 'Produto não encontrado' });
  if (req.usuario.id != produto.loja_id) return res.status(403).json({ error: 'Permissão negada' });
  const { nome, descricao, preco, foto, categoria, marca, unidade, estoque, ativo, destaque } = req.body;
  if (foto !== undefined && !imagemValida(foto)) return res.status(400).json({ error: 'Imagem inválida ou maior que 2 MB' });
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
  if (estoque !== undefined) {
    const quantidade = Number(estoque);
    if (!Number.isInteger(quantidade) || quantidade < 0 || quantidade > 1000000) return res.status(400).json({ error: 'Quantidade de estoque inválida' });
    updates.push('estoque = ?'); params.push(quantidade);
  }
  if (ativo !== undefined) { updates.push('ativo = ?'); params.push(ativo ? 1 : 0); }
  if (destaque !== undefined) { updates.push('destaque = ?'); params.push(destaque ? 1 : 0); }
  if (updates.length === 0) return res.status(400).json({ error: 'Nada para atualizar' });
  params.push(req.params.id);
  await dbRun(`UPDATE produtos SET ${updates.join(', ')} WHERE id = ?`, params);
  res.json({ success: true });
});

app.delete('/api/produtos/:id', authLojas, exigirCadastroAprovado, async (req, res) => {
  const produto = await dbGet('SELECT * FROM produtos WHERE id = ?', [req.params.id]);
  if (!produto) return res.status(404).json({ error: 'Produto não encontrado' });
  if (req.usuario.id != produto.loja_id) return res.status(403).json({ error: 'Permissão negada' });
  await dbRun('DELETE FROM produtos WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

app.get('/api/produtos', async (req, res) => {
  const { categoria, loja_id, busca, ordem, cidade, estado, latitude, longitude } = req.query;
  let sql = `SELECT p.*, l.nome as loja_nome, l.logo as loja_logo, l.bairro as loja_bairro,
    l.cidade as loja_cidade, l.estado as loja_estado, l.latitude as loja_latitude,
    l.longitude as loja_longitude, l.raio_entrega_km
    FROM produtos p
    JOIN lojas l ON p.loja_id = l.id
    JOIN categorias c ON LOWER(TRIM(c.nome)) = LOWER(TRIM(p.categoria))
      AND COALESCE(c.ativa, 1) = 1
    WHERE p.ativo = 1 AND p.estoque > 0 AND l.aberto = 1 AND l.status_cadastro = 'aprovado'`;
  const params = [];
  if (categoria) { sql += ' AND LOWER(TRIM(p.categoria)) = LOWER(TRIM(?))'; params.push(categoria); }
  if (loja_id) { sql += ' AND p.loja_id = ?'; params.push(loja_id); }
  if (cidade) { sql += ' AND l.cidade ILIKE ?'; params.push(textoSeguro(cidade, 120)); }
  if (estado) { sql += ' AND UPPER(l.estado) = ?'; params.push(String(estado).trim().toUpperCase()); }
  if (busca) {
    sql += ' AND (p.nome ILIKE ? OR p.descricao ILIKE ? OR p.marca ILIKE ? OR p.categoria ILIKE ? OR l.nome ILIKE ?)';
    params.push(`%${busca}%`, `%${busca}%`, `%${busca}%`, `%${busca}%`, `%${busca}%`);
  }
  sql += ordem === 'menor_preco'
    ? ' ORDER BY p.preco ASC, p.nome ASC, l.nome ASC'
    : ' ORDER BY p.destaque DESC, p.nome ASC';
  let produtos = await dbAll(sql, params);
  if (coordenadaValida(latitude, longitude)) {
    produtos = produtos.map(produto => ({
      ...produto,
      distancia_loja_km: Math.round(calcularDistanciaRetaKm(latitude, longitude, produto.loja_latitude, produto.loja_longitude) * 12) / 10
    })).filter(produto => Number.isFinite(produto.distancia_loja_km) && produto.distancia_loja_km <= Number(produto.raio_entrega_km || 8));
    if (ordem !== 'menor_preco') produtos.sort((a, b) => a.distancia_loja_km - b.distancia_loja_km);
  }
  res.json({ produtos });
});

// ============ CLIENTES API ============
app.post('/api/clientes/cadastro', async (req, res) => {
  const { nome, email, senha, telefone, endereco_padrao, bairro, cep, cidade, estado, latitude, longitude } = req.body;
  try {
    if (!nome || !email || !senha) return res.status(400).json({ error: 'Nome, email e senha são obrigatórios' });
    if (!emailValido(email)) return res.status(400).json({ error: 'Informe um email válido' });
    if (!senhaValida(senha)) return res.status(400).json({ error: 'A senha precisa ter entre 8 e 128 caracteres' });
    if (!cepValido(cep)) return res.status(400).json({ error: 'Informe um CEP válido' });
    if (!textoSeguro(cidade, 120)) return res.status(400).json({ error: 'Informe a cidade' });
    if (!ufValida(estado)) return res.status(400).json({ error: 'Informe a sigla do estado' });
    if (!coordenadaValida(latitude, longitude)) return res.status(400).json({ error: 'Marque a localização do endereço pelo GPS' });
    if (!validarAceiteNoCadastro(req.body)) return res.status(400).json({ error: 'Leia e aceite os Termos e a Política de Privacidade' });
    const hash = bcrypt.hashSync(senha, 10);
    const result = await dbTransaction(async tx => {
      const insercao = await tx.run(`INSERT INTO clientes
        (nome, email, senha, telefone, endereco_padrao, bairro, cep, cidade, estado, latitude, longitude)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [textoSeguro(nome, 160), String(email).trim().toLowerCase(), hash, textoSeguro(telefone, 30),
        textoSeguro(endereco_padrao, 300), textoSeguro(bairro, 120), cep ? apenasDigitos(cep) : null,
        textoSeguro(cidade, 120) || null, estado ? String(estado).trim().toUpperCase() : null,
        latitude || null, longitude || null]);
      await registrarAceiteTermos('cliente', insercao.lastID, req, tx);
      return insercao;
    });
    const token = criarTokenConta({ id: result.lastID, sessao_versao: 1 }, 'cliente');
    res.json({ success: true, token, termos_pendentes: false, cliente: { id: result.lastID, nome, email, telefone, endereco_padrao, bairro, cep, cidade, estado, latitude: latitude || null, longitude: longitude || null } });
  } catch (e) {
    if (isUniqueViolation(e)) return res.status(400).json({ error: 'Email já cadastrado' });
    console.error('Erro ao cadastrar cliente:', e);
    res.status(500).json({ error: 'Não foi possível cadastrar o cliente' });
  }
});

app.post('/api/clientes/login', async (req, res) => {
  const { email, senha } = req.body;
  if (!emailValido(email) || typeof senha !== 'string') return res.status(400).json({ error: 'Informe email e senha' });
  const cliente = await dbGet('SELECT * FROM clientes WHERE email = ?', [String(email).trim().toLowerCase()]);
  if (!cliente) return res.status(401).json({ error: 'Email não encontrado' });
  if (!bcrypt.compareSync(senha, cliente.senha)) return res.status(401).json({ error: 'Senha incorreta' });
  if (cliente.status_cadastro === STATUS_CADASTRO.SUSPENSO) return res.status(403).json({ error: 'Conta suspensa. Consulte o suporte.', motivo: cliente.status_motivo || null });
  const token = criarTokenConta(cliente, 'cliente');
  res.json({ success: true, token, termos_pendentes: !(await possuiAceiteAtual('cliente', cliente.id)), cliente: { id: cliente.id, nome: cliente.nome, email: cliente.email, telefone: cliente.telefone, endereco_padrao: cliente.endereco_padrao, bairro: cliente.bairro, cep: cliente.cep, cidade: cliente.cidade, estado: cliente.estado, latitude: cliente.latitude, longitude: cliente.longitude } });
});

app.get('/api/clientes/:id', authCliente, async (req, res) => {
  if (req.usuario.id != req.params.id) return res.status(403).json({ error: 'Permissão negada' });
  const cliente = await dbGet('SELECT id, nome, email, telefone, endereco_padrao, bairro, cep, cidade, estado, latitude, longitude FROM clientes WHERE id = ?', [req.params.id]);
  if (!cliente) return res.status(404).json({ error: 'Cliente não encontrado' });
  res.json({ cliente });
});

app.put('/api/clientes/:id', authCliente, async (req, res) => {
  if (req.usuario.id != req.params.id) return res.status(403).json({ error: 'Permissão negada' });
  const { nome, telefone, endereco_padrao, bairro, cep, cidade, estado, latitude, longitude } = req.body;
  const updates = []; const params = [];
  if (nome !== undefined) { updates.push('nome = ?'); params.push(nome); }
  if (telefone !== undefined) { updates.push('telefone = ?'); params.push(telefone); }
  if (endereco_padrao !== undefined) { updates.push('endereco_padrao = ?'); params.push(endereco_padrao); }
  if (bairro !== undefined) { updates.push('bairro = ?'); params.push(bairro); }
  if (cep !== undefined) {
    if (!cepValido(cep)) return res.status(400).json({ error: 'CEP inválido' });
    updates.push('cep = ?'); params.push(apenasDigitos(cep));
  }
  if (cidade !== undefined) { updates.push('cidade = ?'); params.push(textoSeguro(cidade, 120)); }
  if (estado !== undefined) {
    if (!ufValida(estado)) return res.status(400).json({ error: 'Estado inválido' });
    updates.push('estado = ?'); params.push(String(estado).trim().toUpperCase());
  }
  if (latitude !== undefined) { updates.push('latitude = ?'); params.push(latitude); }
  if (longitude !== undefined) { updates.push('longitude = ?'); params.push(longitude); }
  if (updates.length === 0) return res.status(400).json({ error: 'Nada para atualizar' });
  params.push(req.params.id);
  await dbRun(`UPDATE clientes SET ${updates.join(', ')} WHERE id = ?`, params);
  res.json({ success: true });
});

// ============ ENTREGADORES API ============
app.post('/api/entregadores/cadastro', async (req, res) => {
  const { nome, cpf, email, senha, telefone, veiculo, placa, chave_pix, cep, cidade, estado } = req.body;
  try {
    if (!nome || !email || !senha || !cpf || !placa || !cidade || !estado) return res.status(400).json({ error: 'Preencha nome, CPF, email, senha, placa, cidade e estado' });
    if (!emailValido(email)) return res.status(400).json({ error: 'Informe um email válido' });
    if (!senhaValida(senha)) return res.status(400).json({ error: 'A senha precisa ter entre 8 e 128 caracteres' });
    if (!documentoValido(cpf, 11)) return res.status(400).json({ error: 'Informe um CPF válido, com 11 números' });
    if (cep && !cepValido(cep)) return res.status(400).json({ error: 'CEP inválido' });
    if (!ufValida(estado)) return res.status(400).json({ error: 'Estado inválido' });
    if (!validarAceiteNoCadastro(req.body)) return res.status(400).json({ error: 'Leia e aceite os Termos e a Política de Privacidade' });
    if (req.body.declarou_requisitos_profissionais !== true) return res.status(400).json({ error: 'Confirme que atende aos requisitos legais e de segurança da atividade' });
    const hash = bcrypt.hashSync(senha, 10);
    const result = await dbTransaction(async tx => {
      const insercao = await tx.run(`INSERT INTO entregadores
        (nome, cpf, email, senha, telefone, veiculo, placa, chave_pix, cep, cidade, estado, status_cadastro, disponivel)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendente', 0)`,
      [textoSeguro(nome, 160), apenasDigitos(cpf), String(email).trim().toLowerCase(), hash,
        textoSeguro(telefone, 30), textoSeguro(veiculo, 100), textoSeguro(placa, 10).toUpperCase(),
        textoSeguro(chave_pix, 180) || null, cep ? apenasDigitos(cep) : null,
        textoSeguro(cidade, 120), String(estado).trim().toUpperCase()]);
      await tx.run('INSERT INTO saldo_entregadores (entregador_id, saldo) VALUES (?, 0) ON CONFLICT (entregador_id) DO NOTHING', [insercao.lastID]);
      await tx.run(`INSERT INTO verificacoes_identidade (tipo_usuario, usuario_id, status)
        VALUES ('entregador', ?, 'nao_iniciada')
        ON CONFLICT (tipo_usuario, usuario_id) DO NOTHING`, [insercao.lastID]);
      await registrarAceiteTermos('entregador', insercao.lastID, req, tx);
      await criarNotificacao(tx, { tipoUsuario: 'admin', titulo: 'Novo entregador aguardando aprovação', mensagem: `${textoSeguro(nome, 160)} enviou um cadastro para análise.` });
      return insercao;
    });
    const token = criarTokenConta({ id: result.lastID, sessao_versao: 1 }, 'entregador');
    res.json({ success: true, token, termos_pendentes: false, status_cadastro: 'pendente', message: 'Cadastro enviado para aprovação.', entregador: { id: result.lastID, nome, email, comissao_percentual: 5, inicio_promocao: null, disponivel: 0, cidade, estado, status_cadastro: 'pendente' } });
  } catch (e) {
    if (isUniqueViolation(e)) return res.status(400).json({ error: 'CPF ou email já cadastrado' });
    console.error('Erro ao cadastrar entregador:', e);
    res.status(500).json({ error: 'Não foi possível cadastrar o entregador' });
  }
});

app.post('/api/entregadores/login', async (req, res) => {
  const { email, senha } = req.body;
  if (!emailValido(email) || typeof senha !== 'string') return res.status(400).json({ error: 'Informe email e senha' });
  const entregador = await dbGet('SELECT * FROM entregadores WHERE email = ?', [String(email).trim().toLowerCase()]);
  if (!entregador) return res.status(401).json({ error: 'Email não encontrado' });
  if (!bcrypt.compareSync(senha, entregador.senha)) return res.status(401).json({ error: 'Senha incorreta' });
  if (entregador.status_cadastro === STATUS_CADASTRO.SUSPENSO) return res.status(403).json({ error: 'Conta suspensa. Consulte o suporte.', motivo: entregador.status_motivo || null });
  const token = criarTokenConta(entregador, 'entregador');
  const comissaoPercentual = calcularPercentualPromocional(entregador.inicio_promocao);
  await dbRun('UPDATE entregadores SET comissao_percentual = ? WHERE id = ?', [comissaoPercentual, entregador.id]);
  res.json({ success: true, token, termos_pendentes: !(await possuiAceiteAtual('entregador', entregador.id)), status_cadastro: entregador.status_cadastro, entregador: { id: entregador.id, nome: entregador.nome, email: entregador.email, veiculo: entregador.veiculo, disponivel: entregador.disponivel, chave_pix: entregador.chave_pix, comissao_percentual: comissaoPercentual, inicio_promocao: entregador.inicio_promocao, cep: entregador.cep, cidade: entregador.cidade, estado: entregador.estado, status_cadastro: entregador.status_cadastro, status_motivo: entregador.status_motivo } });
});

app.get('/api/entregadores/disponiveis', authAdmin, async (req, res) => {
  const entregadores = await dbAll("SELECT id, nome, veiculo, total_entregas, cidade, estado FROM entregadores WHERE disponivel = 1 AND status_cadastro = 'aprovado'");
  res.json({ entregadores });
});

app.put('/api/entregadores/:id/localizacao', authEntregador, async (req, res) => {
  if (req.usuario.id != req.params.id) return res.status(403).json({ error: 'Permissão negada' });
  const { latitude, longitude, disponivel } = req.body;
  const updates = []; const params = [];
  if (latitude !== undefined) { updates.push('latitude = ?'); params.push(latitude); }
  if (longitude !== undefined) { updates.push('longitude = ?'); params.push(longitude); }
  if (disponivel !== undefined) {
    const cadastro = await dbGet('SELECT status_cadastro FROM entregadores WHERE id = ?', [req.params.id]);
    if (disponivel && cadastro?.status_cadastro !== STATUS_CADASTRO.APROVADO) {
      return res.status(403).json({ error: 'Aguarde a aprovação do cadastro para ficar disponível' });
    }
    updates.push('disponivel = ?'); params.push(disponivel ? 1 : 0);
  }
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

// Solicitações de saque ficam preparadas para o futuro provedor real. No modo
// atual nenhum dinheiro é transferido; o administrador apenas testa o fluxo.
app.get('/api/saques', authQualquer, async (req, res) => {
  if (!['loja', 'entregador'].includes(req.usuario.tipo)) return res.status(403).json({ error: 'Saques disponíveis somente para lojas e entregadores' });
  const saques = await dbAll('SELECT * FROM saques WHERE tipo_usuario = ? AND usuario_id = ? ORDER BY criado_em DESC LIMIT 50', [req.usuario.tipo, req.usuario.id]);
  res.json({ saques, ambiente_teste: PAYMENT_MODE === 'mock' });
});

app.post('/api/saques', authQualquer, async (req, res) => {
  if (!['loja', 'entregador'].includes(req.usuario.tipo)) return res.status(403).json({ error: 'Saques disponíveis somente para lojas e entregadores' });
  const tabelaConta = req.usuario.tipo === 'loja' ? 'lojas' : 'entregadores';
  const tabelaSaldo = req.usuario.tipo === 'loja' ? 'saldo_lojas' : 'saldo_entregadores';
  const campoId = req.usuario.tipo === 'loja' ? 'loja_id' : 'entregador_id';
  const conta = await dbGet(`SELECT status_cadastro, chave_pix FROM ${tabelaConta} WHERE id = ?`, [req.usuario.id]);
  if (conta?.status_cadastro !== STATUS_CADASTRO.APROVADO) return res.status(403).json({ error: 'Cadastro não aprovado para solicitar saque' });
  if (!conta.chave_pix) return res.status(400).json({ error: 'Cadastre uma chave Pix antes de solicitar saque' });
  const valor = Number(req.body.valor);
  if (!Number.isFinite(valor) || valor < 10) return res.status(400).json({ error: 'O saque mínimo de teste é R$ 10,00' });
  const saldo = await dbGet(`SELECT saldo FROM ${tabelaSaldo} WHERE ${campoId} = ?`, [req.usuario.id]);
  const pendente = await dbGet(`SELECT COALESCE(SUM(valor), 0) AS total FROM saques
    WHERE tipo_usuario = ? AND usuario_id = ? AND status IN ('pendente', 'aprovado')`, [req.usuario.tipo, req.usuario.id]);
  const disponivel = Number(saldo?.saldo || 0) - Number(pendente?.total || 0);
  if (valor > disponivel) return res.status(409).json({ error: `Saldo disponível para saque: R$ ${disponivel.toFixed(2)}` });
  const resultado = await dbRun(`INSERT INTO saques (tipo_usuario, usuario_id, valor, chave_pix)
    VALUES (?, ?, ?, ?)`, [req.usuario.tipo, req.usuario.id, valor, conta.chave_pix]);
  await dbRun(`INSERT INTO notificacoes (tipo_usuario, usuario_id, titulo, mensagem)
    VALUES ('admin', NULL, 'Nova solicitação de saque', ?)`, [`${req.usuario.tipo} solicitou saque de R$ ${valor.toFixed(2)}.`]);
  res.json({ success: true, id: resultado.lastID, message: 'Solicitação de saque registrada em modo de teste.' });
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
    const loja = await dbGet(`SELECT id, latitude, longitude, raio_entrega_km, fuso_horario, cidade, estado
      FROM lojas WHERE id = ? AND aberto = 1 AND status_cadastro = 'aprovado'`, [loja_id]);
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
    const loja = await dbGet(`SELECT id, plano, comissao_percentual, inicio_promocao, latitude,
      longitude, raio_entrega_km, fuso_horario, cidade, estado FROM lojas
      WHERE id = ? AND aberto = 1 AND status_cadastro = 'aprovado'`, [loja_id]);
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
        await cancelarPedidoComSeguranca(tx, pedido, 'cliente', 'Cliente não confirmou o pedido');
        return { cancelado: true };
      }

      if (!['aguardando_confirmacao', 'aguardando_pagamento'].includes(pedido.status)) {
        throw Object.assign(new Error('Pedido já foi processado'), { status: 400 });
      }
      await reservarEstoque(tx, pedido);
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
      const pedido = await tx.get('SELECT * FROM pedidos WHERE id = ? FOR UPDATE', [pagamento.pedido_id]);
      if (pedido?.status === 'aguardando_pagamento') {
        await liberarReservaEstoque(tx, pedido.id);
        await tx.run("UPDATE pedidos SET status = 'cancelado', cancelado_por = 'sistema', motivo_cancelamento = 'Pix expirado' WHERE id = ?", [pagamento.pedido_id]);
      }
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
      await confirmarReservaEstoque(tx, pedido.id);
      await criarNotificacao(tx, { tipoUsuario: 'loja', usuarioId: pedido.loja_id, titulo: 'Novo pedido pago', mensagem: `O pedido #${pedido.id} está aguardando sua confirmação.`, pedidoId: pedido.id });
      await criarNotificacao(tx, { tipoUsuario: 'cliente', usuarioId: pedido.cliente_id, titulo: 'Pagamento confirmado', mensagem: `O pedido #${pedido.id} foi enviado para a loja.`, pedidoId: pedido.id });
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

// Cancelamento seguro. Reembolso real será executado pelo provedor no futuro;
// enquanto isso, o pedido pago entra na fila administrativa de teste.
app.post('/api/pedidos/:id/cancelar', authQualquer, async (req, res) => {
  try {
    const motivo = textoSeguro(req.body.motivo, 500);
    if (motivo.length < 5) return res.status(400).json({ error: 'Explique brevemente o motivo do cancelamento' });
    await dbTransaction(async tx => {
      const pedido = await tx.get('SELECT * FROM pedidos WHERE id = ? FOR UPDATE', [req.params.id]);
      if (!pedido) throw Object.assign(new Error('Pedido não encontrado'), { status: 404 });
      const autorizado = req.usuario.tipo === 'admin'
        || (req.usuario.tipo === 'cliente' && Number(pedido.cliente_id) === Number(req.usuario.id))
        || (req.usuario.tipo === 'loja' && Number(pedido.loja_id) === Number(req.usuario.id));
      if (!autorizado) throw Object.assign(new Error('Você não pode cancelar este pedido'), { status: 403 });
      await cancelarPedidoComSeguranca(tx, pedido, req.usuario.tipo, motivo);
    });
    if (req.usuario.tipo === 'admin') await registrarAuditoria(req, 'cancelar_pedido', 'pedido', req.params.id, motivo);
    res.json({ success: true, message: 'Cancelamento registrado com segurança.' });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Não foi possível cancelar o pedido' });
  }
});

app.get('/api/admin/reembolsos', authAdmin, async (req, res) => {
  const reembolsos = await dbAll(`SELECT r.*, p.total_final, p.status AS pedido_status,
    c.nome AS cliente_nome, l.nome AS loja_nome
    FROM reembolsos r JOIN pedidos p ON p.id = r.pedido_id
    JOIN clientes c ON c.id = p.cliente_id JOIN lojas l ON l.id = p.loja_id
    ORDER BY r.criado_em DESC LIMIT 100`);
  res.json({ reembolsos, ambiente_teste: PAYMENT_MODE === 'mock' });
});

app.put('/api/admin/reembolsos/:id', authAdmin, async (req, res) => {
  const status = textoSeguro(req.body.status, 30);
  if (!['aprovado', 'recusado', 'processado'].includes(status)) return res.status(400).json({ error: 'Status de reembolso inválido' });
  const reembolso = await dbGet('SELECT * FROM reembolsos WHERE id = ?', [req.params.id]);
  if (!reembolso) return res.status(404).json({ error: 'Reembolso não encontrado' });
  if (status === 'processado' && PAYMENT_MODE !== 'mock') {
    return res.status(409).json({ error: 'No modo real, o processamento será confirmado somente pelo provedor de pagamento' });
  }
  await dbTransaction(async tx => {
    await tx.run('UPDATE reembolsos SET status = ?, observacao_admin = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?', [status, textoSeguro(req.body.observacao, 500), reembolso.id]);
    await tx.run('UPDATE pedidos SET reembolso_status = ? WHERE id = ?', [status, reembolso.pedido_id]);
    const pedido = await tx.get('SELECT cliente_id FROM pedidos WHERE id = ?', [reembolso.pedido_id]);
    await criarNotificacao(tx, { tipoUsuario: 'cliente', usuarioId: pedido.cliente_id, titulo: 'Atualização do reembolso', mensagem: `O reembolso do pedido #${reembolso.pedido_id} está com status: ${status}.`, pedidoId: reembolso.pedido_id });
  });
  await registrarAuditoria(req, 'atualizar_reembolso', 'reembolso', reembolso.id, `${status}: ${textoSeguro(req.body.observacao, 500)}`);
  res.json({ success: true });
});

app.get('/api/admin/saques', authAdmin, async (req, res) => {
  const saques = await dbAll(`SELECT s.*,
    CASE WHEN s.tipo_usuario = 'loja' THEN l.nome ELSE e.nome END AS nome
    FROM saques s LEFT JOIN lojas l ON s.tipo_usuario = 'loja' AND l.id = s.usuario_id
    LEFT JOIN entregadores e ON s.tipo_usuario = 'entregador' AND e.id = s.usuario_id
    ORDER BY s.criado_em DESC LIMIT 100`);
  res.json({ saques, ambiente_teste: PAYMENT_MODE === 'mock' });
});

app.put('/api/admin/saques/:id', authAdmin, async (req, res) => {
  const status = textoSeguro(req.body.status, 30);
  if (!['aprovado', 'recusado', 'processado'].includes(status)) return res.status(400).json({ error: 'Status de saque inválido' });
  const saque = await dbGet('SELECT * FROM saques WHERE id = ?', [req.params.id]);
  if (!saque) return res.status(404).json({ error: 'Saque não encontrado' });
  if (saque.status === 'processado') return res.status(409).json({ error: 'Este saque já foi processado' });
  if (status === 'processado' && PAYMENT_MODE !== 'mock') return res.status(409).json({ error: 'O provedor real deverá confirmar a transferência' });
  await dbTransaction(async tx => {
    if (status === 'processado') {
      const tabelaSaldo = saque.tipo_usuario === 'loja' ? 'saldo_lojas' : 'saldo_entregadores';
      const campoId = saque.tipo_usuario === 'loja' ? 'loja_id' : 'entregador_id';
      const saldo = await tx.get(`SELECT saldo FROM ${tabelaSaldo} WHERE ${campoId} = ? FOR UPDATE`, [saque.usuario_id]);
      if (Number(saldo?.saldo || 0) < Number(saque.valor)) throw Object.assign(new Error('Saldo insuficiente para concluir o saque'), { status: 409 });
      await tx.run(`UPDATE ${tabelaSaldo} SET saldo = saldo - ?, total_sacado = total_sacado + ? WHERE ${campoId} = ?`, [saque.valor, saque.valor, saque.usuario_id]);
    }
    await tx.run('UPDATE saques SET status = ?, observacao_admin = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?', [status, textoSeguro(req.body.observacao, 500), saque.id]);
    await criarNotificacao(tx, { tipoUsuario: saque.tipo_usuario, usuarioId: saque.usuario_id, titulo: 'Atualização do saque', mensagem: `Sua solicitação de R$ ${Number(saque.valor).toFixed(2)} está com status: ${status}.` });
  });
  await registrarAuditoria(req, 'atualizar_saque', 'saque', saque.id, `${status}: ${textoSeguro(req.body.observacao, 500)}`);
  res.json({ success: true });
});

// Lojas veem pedidos
app.get('/api/pedidos/loja/:loja_id', authLojas, exigirCadastroAprovado, async (req, res) => {
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
app.put('/api/pedidos/:id/separar', authLojas, exigirCadastroAprovado, async (req, res) => {
  const pedido = await dbGet('SELECT * FROM pedidos WHERE id = ?', [req.params.id]);
  if (!pedido) return res.status(404).json({ error: 'Pedido não encontrado' });
  if (pedido.loja_id != req.usuario.id) return res.status(403).json({ error: 'Esse pedido não é da sua loja' });
  if (pedido.status !== 'confirmado') return res.status(400).json({ error: 'Pedido precisa estar confirmado' });
  
  const { separado_por } = req.body;
  if (!separado_por) return res.status(400).json({ error: 'Informe quem separou o pedido' });
  
  await dbRun("UPDATE pedidos SET status = 'separado', separado_por = ?, data_separado = CURRENT_TIMESTAMP WHERE id = ?", [separado_por, req.params.id]);
  if (pedido.tipo_entrega === 'entrega' && normalizarPlanoLoja(pedido.plano_loja) === 'entrega_obraexpress') {
    await dbRun(`INSERT INTO notificacoes (tipo_usuario, usuario_id, titulo, mensagem, pedido_id)
      SELECT 'entregador', id, 'Nova entrega disponível', ?, ? FROM entregadores
      WHERE status_cadastro = 'aprovado'`, [`Coleta do pedido #${pedido.id} entrou na fila e está buscando entregadores próximos.`, pedido.id]);
  }
  res.json({ success: true, message: 'Pedido separado e disponível para entrega!' });
});

// A loja inicia a entrega quando escolheu usar entregador próprio.
app.put('/api/pedidos/:id/iniciar-entrega-loja', authLojas, exigirCadastroAprovado, async (req, res) => {
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

// Rastreamento protegido: a localização do entregador só é mostrada ao cliente
// dono do pedido e apenas durante a coleta/entrega ativa.
app.get('/api/pedidos/:id/rastreamento', authCliente, async (req, res) => {
  const pedido = await dbGet(`SELECT p.id, p.cliente_id, p.status, p.distancia_km,
    p.latitude_entrega, p.longitude_entrega, l.latitude AS loja_latitude,
    l.longitude AS loja_longitude, e.id AS entregador_id, e.nome AS entregador_nome,
    e.veiculo AS entregador_veiculo, e.latitude AS entregador_latitude,
    e.longitude AS entregador_longitude
    FROM pedidos p JOIN lojas l ON l.id = p.loja_id
    LEFT JOIN entregadores e ON e.id = p.entregador_id WHERE p.id = ?`, [req.params.id]);
  if (!pedido) return res.status(404).json({ error: 'Pedido não encontrado' });
  if (Number(pedido.cliente_id) !== Number(req.usuario.id)) return res.status(403).json({ error: 'Esse pedido não é seu' });
  const ativo = ['em_coleta', 'saiu_entrega'].includes(pedido.status) && pedido.entregador_id;
  if (!ativo || !coordenadaValida(pedido.entregador_latitude, pedido.entregador_longitude)) {
    return res.json({ ativo: false, status: pedido.status, mensagem: 'O rastreamento ficará disponível quando a entrega estiver em andamento.' });
  }
  const destinoLat = pedido.status === 'em_coleta' ? pedido.loja_latitude : pedido.latitude_entrega;
  const destinoLng = pedido.status === 'em_coleta' ? pedido.loja_longitude : pedido.longitude_entrega;
  const distancia = coordenadaValida(destinoLat, destinoLng)
    ? calcularDistanciaRetaKm(pedido.entregador_latitude, pedido.entregador_longitude, destinoLat, destinoLng) * 1.2
    : null;
  res.json({
    ativo: true,
    status: pedido.status,
    entregador: { nome: pedido.entregador_nome, veiculo: pedido.entregador_veiculo },
    localizacao: { latitude: Number(pedido.entregador_latitude), longitude: Number(pedido.entregador_longitude) },
    destino: coordenadaValida(destinoLat, destinoLng) ? { latitude: Number(destinoLat), longitude: Number(destinoLng) } : null,
    distancia_restante_km: distancia === null ? null : Math.round(distancia * 10) / 10,
    estimativa_minutos: distancia === null ? null : Math.max(2, Math.round(distancia / 25 * 60))
  });
});

// Entregador vê os pedidos dele
app.get('/api/pedidos/entregador/:entregador_id', authEntregador, exigirCadastroAprovado, async (req, res) => {
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
app.get('/api/pedidos/disponiveis', authEntregador, exigirCadastroAprovado, async (req, res) => {
  const entregador = await dbGet("SELECT latitude, longitude, cidade, estado FROM entregadores WHERE id = ? AND status_cadastro = 'aprovado'", [req.usuario.id]);
  if (!coordenadaValida(entregador?.latitude, entregador?.longitude)) {
    return res.json({ pedidos: [], gps_pendente: true, mensagem: 'Aguardando uma localização GPS válida' });
  }
  const entregaAtiva = await dbGet("SELECT id FROM pedidos WHERE entregador_id = ? AND status IN ('em_coleta', 'saiu_entrega') LIMIT 1", [req.usuario.id]);
  if (entregaAtiva) {
    return res.json({ pedidos: [], entrega_ativa: true, pedido_ativo_id: entregaAtiva.id, mensagem: 'Conclua sua entrega atual antes de aceitar outra.' });
  }
  const configuracao = await obterConfiguracaoFrete();
  const pedidos = await dbAll(`SELECT p.*, l.nome as loja_nome, l.endereco as loja_endereco, 
    l.latitude as loja_latitude, l.longitude as loja_longitude, l.telefone as loja_telefone,
    c.nome as cliente_nome, c.telefone as cliente_telefone, COALESCE(p.endereco_entrega, c.endereco_padrao) as cliente_endereco,
    COALESCE(p.latitude_entrega, c.latitude) as cliente_latitude,
    COALESCE(p.longitude_entrega, c.longitude) as cliente_longitude
    FROM pedidos p 
    JOIN lojas l ON p.loja_id = l.id 
    JOIN clientes c ON p.cliente_id = c.id 
    WHERE p.status = 'separado' AND p.tipo_entrega = 'entrega'
      AND p.plano_loja = 'entrega_obraexpress' AND p.entregador_id IS NULL 
    ORDER BY p.data_pedido ASC`);
  const agora = new Date();
  const candidatas = pedidos.map(pedido => {
    const oferta = calcularOfertaEntregador(pedido, entregador, configuracao);
    const janela = calcularJanelaOfertaEntrega(pedido, oferta.distanciaColetaKm, configuracao, agora);
    return {
      ...pedido,
      valor_motoboy: oferta.valorLiquido,
      distancia_coleta_km: oferta.distanciaColetaKm,
      distancia_total_entrega_km: oferta.distanciaTotalKm,
      bonus_entregador_percentual: oferta.bonusPercentual,
      coleta_preferencial: oferta.coletaPreferencial,
      oferta_etapa: janela.etapa,
      oferta_raio_atual_km: janela.raioAtual,
      oferta_raio_final_km: janela.raioFinal,
      proxima_expansao_em_segundos: janela.proximaExpansaoEmSegundos,
      liberada_em_segundos: janela.liberadaEmSegundos,
      disponivel_agora: janela.disponivelAgora
    };
  });
  const ofertas = candidatas.filter(pedido => pedido.disponivel_agora)
    .sort((a, b) => Number(b.coleta_preferencial) - Number(a.coleta_preferencial) || Number(a.distancia_coleta_km) - Number(b.distancia_coleta_km));
  const proximas = candidatas.map(pedido => pedido.liberada_em_segundos)
    .filter(segundos => Number.isFinite(segundos) && segundos > 0);
  const proximaOfertaEmSegundos = proximas.length ? Math.min(...proximas) : null;
  res.json({
    pedidos: ofertas,
    aguardando_expansao: ofertas.length === 0 && proximaOfertaEmSegundos !== null,
    proxima_oferta_em_segundos: proximaOfertaEmSegundos,
    raio_inicial_coleta: Number(configuracao.raio_preferencial_coleta || 3),
    raio_intermediario_coleta: Number(configuracao.raio_maximo_coleta || 5),
    raio_final_coleta: Number(configuracao.raio_expansao_coleta || 8)
  });
});

// ENTREGADOR: Aceitar pedido
app.put('/api/pedidos/:id/aceitar', authEntregador, exigirCadastroAprovado, async (req, res) => {
  try {
    const configuracao = await obterConfiguracaoFrete();
    const resultado = await dbTransaction(async tx => {
      const entregador = await tx.get('SELECT id, latitude, longitude FROM entregadores WHERE id = ? FOR UPDATE', [req.usuario.id]);
      const entregaAtiva = await tx.get("SELECT id FROM pedidos WHERE entregador_id = ? AND status IN ('em_coleta', 'saiu_entrega') LIMIT 1 FOR UPDATE", [req.usuario.id]);
      if (entregaAtiva) {
        throw Object.assign(new Error('Conclua sua entrega atual antes de aceitar outra.'), { status: 409 });
      }
      const pedido = await tx.get(`SELECT p.*, l.latitude AS loja_latitude, l.longitude AS loja_longitude
        FROM pedidos p JOIN lojas l ON l.id = p.loja_id WHERE p.id = ? FOR UPDATE`, [req.params.id]);
      if (!pedido || pedido.status !== 'separado' || pedido.entregador_id || pedido.plano_loja !== 'entrega_obraexpress') {
        throw Object.assign(new Error('Essa entrega não está mais disponível'), { status: 409 });
      }
      const oferta = calcularOfertaEntregador(pedido, entregador, configuracao);
      const janela = calcularJanelaOfertaEntrega(pedido, oferta.distanciaColetaKm, configuracao);
      if (!janela.disponivelAgora) {
        if (janela.liberadaEmSegundos === null) {
          throw Object.assign(new Error(`Você está além do raio final de coleta de ${janela.raioFinal} km`), { status: 409 });
        }
        throw Object.assign(new Error(`Esta oferta chegará à sua região em aproximadamente ${janela.liberadaEmSegundos} segundos.`), { status: 409 });
      }
      await tx.run(`UPDATE pedidos SET entregador_id = ?, status = 'em_coleta',
        comissao_entrega_percentual = 0, valor_motoboy = ?, valor_plataforma = ?,
        distancia_coleta_km = ?, distancia_total_entrega_km = ? WHERE id = ?`,
      [req.usuario.id, oferta.valorLiquido, oferta.margemPlataformaEntrega,
        oferta.distanciaColetaKm, oferta.distanciaTotalKm, pedido.id]);
      await tx.run('UPDATE entregadores SET disponivel = 0 WHERE id = ?', [req.usuario.id]);
      await criarNotificacao(tx, { tipoUsuario: 'cliente', usuarioId: pedido.cliente_id, titulo: 'Entregador a caminho da loja', mensagem: `O entregador aceitou o pedido #${pedido.id}.`, pedidoId: pedido.id });
      await criarNotificacao(tx, { tipoUsuario: 'loja', usuarioId: pedido.loja_id, titulo: 'Entregador a caminho', mensagem: `A coleta do pedido #${pedido.id} foi aceita.`, pedidoId: pedido.id });
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
app.put('/api/pedidos/:id/recusar', authEntregador, exigirCadastroAprovado, async (req, res) => {
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
app.put('/api/pedidos/:id/foto-coleta', authEntregador, exigirCadastroAprovado, async (req, res) => {
  const pedido = await dbGet('SELECT * FROM pedidos WHERE id = ?', [req.params.id]);
  if (!pedido) return res.status(404).json({ error: 'Pedido não encontrado' });
  if (pedido.entregador_id != req.usuario.id) return res.status(403).json({ error: 'Permissão negada' });
  if (pedido.status !== 'em_coleta') return res.status(400).json({ error: 'Status inválido para foto de coleta' });
  
  const { foto } = req.body;
  if (!foto) return res.status(400).json({ error: 'Envie a foto da coleta' });
  if (!imagemValida(foto)) return res.status(400).json({ error: 'Foto inválida ou maior que 2 MB' });
  
  await dbRun("UPDATE pedidos SET foto_coleta = ?, data_coleta = CURRENT_TIMESTAMP, status = 'saiu_entrega' WHERE id = ?", [foto, req.params.id]);
  await dbRun(`INSERT INTO notificacoes (tipo_usuario, usuario_id, titulo, mensagem, pedido_id)
    VALUES ('cliente', ?, 'Pedido saiu para entrega', ?, ?)`, [pedido.cliente_id, `O pedido #${pedido.id} está a caminho.`, pedido.id]);
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
app.put('/api/pedidos/:id/finalizar', authEntregador, exigirCadastroAprovado, async (req, res) => {
  const { foto } = req.body;
  if (!foto) return res.status(400).json({ error: 'Tire a foto da entrega para finalizar' });
  if (!imagemValida(foto)) return res.status(400).json({ error: 'Foto inválida ou maior que 2 MB' });
  try {
    const resultado = await dbTransaction(async tx => {
      const pedido = await tx.get('SELECT * FROM pedidos WHERE id = ? FOR UPDATE', [req.params.id]);
      if (!pedido) throw Object.assign(new Error('Pedido não encontrado'), { status: 404 });
      if (pedido.entregador_id != req.usuario.id) throw Object.assign(new Error('Permissão negada'), { status: 403 });
      if (pedido.status !== 'saiu_entrega') throw Object.assign(new Error('Pedido não está em entrega'), { status: 400 });
      await tx.run("UPDATE pedidos SET foto_entrega = ?, status = 'entregue', data_entrega = CURRENT_TIMESTAMP WHERE id = ?", [foto, pedido.id]);
      await consumirReservaEstoque(tx, pedido.id);
      await registrarRepasseFinanceiro(tx, pedido, req.usuario.id);
      await criarNotificacao(tx, { tipoUsuario: 'cliente', usuarioId: pedido.cliente_id, titulo: 'Pedido entregue', mensagem: `A entrega do pedido #${pedido.id} foi concluída.`, pedidoId: pedido.id });
      await criarNotificacao(tx, { tipoUsuario: 'loja', usuarioId: pedido.loja_id, titulo: 'Pedido entregue', mensagem: `O pedido #${pedido.id} foi concluído.`, pedidoId: pedido.id });
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
app.put('/api/pedidos/:id/finalizar-loja', authLojas, exigirCadastroAprovado, async (req, res) => {
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
      await consumirReservaEstoque(tx, pedido.id);
      await registrarRepasseFinanceiro(tx, pedido, null);
      await criarNotificacao(tx, { tipoUsuario: 'cliente', usuarioId: pedido.cliente_id, titulo: 'Pedido concluído', mensagem: `O pedido #${pedido.id} foi concluído.`, pedidoId: pedido.id });
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
    if (!status || !['confirmado', 'cancelado'].includes(status)) {
      return res.status(400).json({ error: 'Mudança de status inválida para esta rota' });
    }
    if (usuario.tipo === 'admin' && status !== 'cancelado') {
      return res.status(403).json({ error: 'O administrador não pode pular as etapas operacionais do pedido' });
    }
    if (usuario.tipo === 'loja' && pedido.loja_id != usuario.id) {
      return res.status(403).json({ error: 'Esse pedido não pertence à sua loja' });
    }
    if (usuario.tipo === 'loja') {
      const loja = await dbGet('SELECT status_cadastro FROM lojas WHERE id = ?', [usuario.id]);
      if (loja?.status_cadastro !== STATUS_CADASTRO.APROVADO) return res.status(403).json({ error: 'Cadastro da loja ainda não está aprovado' });
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

    if (status === 'cancelado') {
      const motivo = textoSeguro(req.body.motivo || 'Cancelado pela loja', 500);
      await dbTransaction(async tx => {
        const atual = await tx.get('SELECT * FROM pedidos WHERE id = ? FOR UPDATE', [pedido.id]);
        await cancelarPedidoComSeguranca(tx, atual, usuario.tipo, motivo);
      });
      if (usuario.tipo === 'admin') await registrarAuditoria(req, 'cancelar_pedido', 'pedido', pedido.id, motivo);
      return res.json({ success: true });
    }

    const updates = []; const params = [];
    if (status) { updates.push('status = ?'); params.push(status); }
    if (status === 'confirmado') updates.push('data_confirmacao = CURRENT_TIMESTAMP');
    if (status === 'saiu_entrega') updates.push('data_saida = CURRENT_TIMESTAMP');
    if (status === 'entregue') updates.push('data_entrega = CURRENT_TIMESTAMP');
    if (updates.length === 0) return res.status(400).json({ error: 'Nada para atualizar' });
    params.push(req.params.id);
    await dbRun(`UPDATE pedidos SET ${updates.join(', ')} WHERE id = ?`, params);
    if (status === 'confirmado') {
      await dbRun(`INSERT INTO notificacoes (tipo_usuario, usuario_id, titulo, mensagem, pedido_id)
        VALUES ('cliente', ?, 'Pedido aceito pela loja', ?, ?)`, [pedido.cliente_id, `A loja confirmou o pedido #${pedido.id}.`, pedido.id]);
    }
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

app.get('/api/cidades', async (req, res) => {
  const cidades = await dbAll(`SELECT cidade, estado, fuso_horario,
    distancia_maxima_entrega FROM configuracoes_cidades WHERE ativa = 1
    ORDER BY estado, cidade`);
  res.json({ cidades });
});

app.get('/api/admin/cidades', authAdmin, async (req, res) => {
  res.json({ cidades: await dbAll('SELECT * FROM configuracoes_cidades ORDER BY estado, cidade') });
});

app.put('/api/admin/cidades/:id', authAdmin, async (req, res) => {
  const cidade = await dbGet('SELECT * FROM configuracoes_cidades WHERE id = ?', [req.params.id]);
  if (!cidade) return res.status(404).json({ error: 'Cidade não encontrada' });
  const fuso = textoSeguro(req.body.fuso_horario ?? cidade.fuso_horario, 64);
  try { new Intl.DateTimeFormat('pt-BR', { timeZone: fuso }).format(new Date()); } catch { return res.status(400).json({ error: 'Fuso horário inválido' }); }
  const distancia = req.body.distancia_maxima_entrega === undefined || req.body.distancia_maxima_entrega === null || req.body.distancia_maxima_entrega === ''
    ? null : Number(req.body.distancia_maxima_entrega);
  if (distancia !== null && (!Number.isFinite(distancia) || distancia < 1 || distancia > 30)) return res.status(400).json({ error: 'Distância máxima inválida' });
  await dbRun(`UPDATE configuracoes_cidades SET fuso_horario = ?, ativa = ?, distancia_maxima_entrega = ? WHERE id = ?`,
    [fuso, req.body.ativa === undefined ? cidade.ativa : (req.body.ativa ? 1 : 0), distancia, cidade.id]);
  await dbRun('UPDATE lojas SET fuso_horario = ? WHERE LOWER(TRIM(cidade)) = LOWER(TRIM(?)) AND UPPER(TRIM(estado)) = UPPER(TRIM(?))', [fuso, cidade.cidade, cidade.estado]);
  await registrarAuditoria(req, 'configurar_cidade', 'cidade', cidade.id, `${cidade.cidade}/${cidade.estado}`);
  res.json({ success: true });
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

app.get('/api/admin/privacidade/resumo', authAdmin, async (req, res) => {
  const porStatus = await dbAll(`SELECT status, COUNT(*)::integer AS total
    FROM solicitacoes_privacidade GROUP BY status ORDER BY status`);
  res.json({
    solicitacoes_por_status: porStatus,
    coleta_biometrica_ativa: false,
    provedor_identidade_configurado: false,
    armazenamento_documentos: 'bloqueado',
    aviso: 'Não envie nem solicite documentos reais por este painel enquanto o provedor seguro não estiver integrado.'
  });
});

app.get('/api/admin/operacao/status-servicos', authAdmin, async (req, res) => {
  const banco = await getDatabaseHealth();
  res.json({
    banco: { conectado: Boolean(banco.connected), tipo: banco.database },
    recuperacao_senha: {
      ativa: emailRecuperacaoConfigurado(),
      provedor: 'Resend',
      codigo_validade_minutos: VALIDADE_CODIGO_MINUTOS,
      tentativas_maximas: MAX_TENTATIVAS_CODIGO
    },
    pix_real: false,
    biometria: false
  });
});

app.get('/api/admin/privacidade/solicitacoes', authAdmin, async (req, res) => {
  const status = textoSeguro(req.query.status || '', 30);
  if (status && !STATUS_SOLICITACAO_PRIVACIDADE.has(status)) {
    return res.status(400).json({ error: 'Status inválido' });
  }
  const filtro = status ? 'WHERE sp.status = ?' : '';
  const params = status ? [status] : [];
  const solicitacoes = await dbAll(`SELECT sp.*,
    CASE sp.tipo_usuario
      WHEN 'cliente' THEN (SELECT nome FROM clientes WHERE id = sp.usuario_id)
      WHEN 'loja' THEN (SELECT nome FROM lojas WHERE id = sp.usuario_id)
      WHEN 'entregador' THEN (SELECT nome FROM entregadores WHERE id = sp.usuario_id)
    END AS nome_titular,
    CASE sp.tipo_usuario
      WHEN 'cliente' THEN (SELECT email FROM clientes WHERE id = sp.usuario_id)
      WHEN 'loja' THEN (SELECT email FROM lojas WHERE id = sp.usuario_id)
      WHEN 'entregador' THEN (SELECT email FROM entregadores WHERE id = sp.usuario_id)
    END AS email_titular
    FROM solicitacoes_privacidade sp ${filtro}
    ORDER BY CASE WHEN sp.status IN ('recebida','em_analise') THEN 0 ELSE 1 END,
      sp.criada_em ASC LIMIT 200`, params);
  res.json({ solicitacoes });
});

app.put('/api/admin/privacidade/solicitacoes/:id', authAdmin, async (req, res) => {
  const solicitacao = await dbGet('SELECT * FROM solicitacoes_privacidade WHERE id = ?', [req.params.id]);
  if (!solicitacao) return res.status(404).json({ error: 'Solicitação não encontrada' });
  const status = textoSeguro(req.body.status, 30);
  const resposta = textoSeguro(req.body.resposta, 1500);
  if (!STATUS_SOLICITACAO_PRIVACIDADE.has(status)) return res.status(400).json({ error: 'Status inválido' });
  if (['concluida', 'recusada'].includes(status) && resposta.length < 10) {
    return res.status(400).json({ error: 'Explique a decisão ao titular com pelo menos 10 caracteres' });
  }
  await dbRun(`UPDATE solicitacoes_privacidade SET status = ?, resposta_admin = ?,
    atualizada_em = CURRENT_TIMESTAMP WHERE id = ?`, [status, resposta || null, solicitacao.id]);
  await criarNotificacao({ run: dbRun }, {
    tipoUsuario: solicitacao.tipo_usuario,
    usuarioId: solicitacao.usuario_id,
    titulo: 'Solicitação de privacidade atualizada',
    mensagem: `Sua solicitação #${solicitacao.id} agora está como ${status}. ${resposta}`
  });
  await registrarAuditoria(req, 'responder_privacidade', 'solicitacao_privacidade', solicitacao.id, `${status}: ${resposta}`);
  res.json({ success: true });
});

app.get('/api/admin/cadastros', authAdmin, async (req, res) => {
  const status = textoSeguro(req.query.status || '', 30);
  const filtro = status ? ' WHERE status_cadastro = ?' : '';
  const params = status ? [status] : [];
  const lojas = await dbAll(`SELECT id, nome, cnpj, email, telefone, cep, cidade, estado,
    status_cadastro, status_motivo, data_cadastro FROM lojas${filtro} ORDER BY data_cadastro DESC`, params);
  const entregadores = await dbAll(`SELECT id, nome, cpf, email, telefone, veiculo, placa, cep,
    cidade, estado, status_cadastro, status_motivo, data_cadastro FROM entregadores${filtro} ORDER BY data_cadastro DESC`, params);
  const clientes = await dbAll(`SELECT id, nome, email, telefone, cep, cidade, estado,
    status_cadastro, status_motivo, data_cadastro FROM clientes${filtro} ORDER BY data_cadastro DESC`, params);
  res.json({ lojas, entregadores, clientes });
});

app.put('/api/admin/cadastros/:tipo/:id/status', authAdmin, async (req, res) => {
  const tabelas = { loja: 'lojas', entregador: 'entregadores', cliente: 'clientes' };
  const tabela = tabelas[req.params.tipo];
  if (!tabela) return res.status(400).json({ error: 'Tipo de cadastro inválido' });
  const status = textoSeguro(req.body.status, 30);
  if (!Object.values(STATUS_CADASTRO).includes(status)) return res.status(400).json({ error: 'Status inválido' });
  const conta = await dbGet(`SELECT id, nome, cidade, estado FROM ${tabela} WHERE id = ?`, [req.params.id]);
  if (!conta) return res.status(404).json({ error: 'Cadastro não encontrado' });
  await dbTransaction(async tx => {
    await tx.run(`UPDATE ${tabela} SET status_cadastro = ?, status_motivo = ? WHERE id = ?`,
      [status, textoSeguro(req.body.motivo, 500) || null, conta.id]);
    if (req.params.tipo === 'entregador' && status !== STATUS_CADASTRO.APROVADO) {
      await tx.run('UPDATE entregadores SET disponivel = 0 WHERE id = ?', [conta.id]);
    }
    if (req.params.tipo === 'loja' && status === STATUS_CADASTRO.APROVADO && conta.cidade && conta.estado) {
      await tx.run(`INSERT INTO configuracoes_cidades (cidade, estado, fuso_horario, ativa)
        VALUES (?, ?, 'America/Araguaina', 1)
        ON CONFLICT DO NOTHING`, [conta.cidade, conta.estado]);
    }
    const tipoNotificacao = req.params.tipo === 'loja' ? 'loja' : req.params.tipo === 'entregador' ? 'entregador' : 'cliente';
    await criarNotificacao(tx, { tipoUsuario: tipoNotificacao, usuarioId: conta.id, titulo: 'Situação do cadastro atualizada', mensagem: status === STATUS_CADASTRO.APROVADO ? 'Seu cadastro foi aprovado.' : `Situação atual: ${status}. ${textoSeguro(req.body.motivo, 300)}` });
  });
  await registrarAuditoria(req, 'alterar_status_cadastro', req.params.tipo, conta.id, `${status}: ${textoSeguro(req.body.motivo, 500)}`);
  res.json({ success: true, status_cadastro: status });
});

app.get('/api/admin/estoque-baixo', authAdmin, async (req, res) => {
  const produtos = await dbAll(`SELECT p.id, p.nome, p.estoque, p.estoque_baixo_limite,
    l.id AS loja_id, l.nome AS loja_nome FROM produtos p JOIN lojas l ON l.id = p.loja_id
    WHERE p.ativo = 1 AND p.estoque <= p.estoque_baixo_limite ORDER BY p.estoque ASC LIMIT 200`);
  res.json({ produtos });
});

app.get('/api/admin/auditoria', authAdmin, async (req, res) => {
  const registros = await dbAll('SELECT id, acao, entidade, entidade_id, detalhes, criada_em FROM auditoria_admin ORDER BY criada_em DESC LIMIT 200');
  res.json({ registros });
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
    raio_expansao_coleta: [0, 30],
    tempo_expansao_coleta_segundos: [10, 300],
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
  if (valorFinal('raio_expansao_coleta') < valorFinal('raio_maximo_coleta')) {
    return res.status(400).json({ error: 'O raio final de coleta não pode ser menor que o raio máximo' });
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

// Exclusão segura: dados pessoais são anonimizados e o histórico transacional
// obrigatório é preservado para auditoria, reembolso e conciliação.
app.delete('/api/clientes/:id', authCliente, async (req, res) => {
  if (req.usuario.id != req.params.id) return res.status(403).json({ error: 'Permissão negada' });
  try {
    const ativo = await dbGet("SELECT id FROM pedidos WHERE cliente_id = ? AND status NOT IN ('entregue','cancelado') LIMIT 1", [req.params.id]);
    if (ativo) return res.status(409).json({ error: 'Conclua ou cancele o pedido ativo antes de excluir a conta' });
    await dbTransaction(async tx => {
      await tx.run(`UPDATE solicitacoes_privacidade SET descricao = NULL,
        resposta_admin = 'Conta anonimizada a pedido do titular', status = 'concluida',
        atualizada_em = CURRENT_TIMESTAMP WHERE tipo_usuario = 'cliente' AND usuario_id = ?`, [req.params.id]);
      await tx.run("DELETE FROM aceites_termos WHERE tipo_usuario = 'cliente' AND usuario_id = ?", [req.params.id]);
      await tx.run("DELETE FROM notificacoes WHERE tipo_usuario = 'cliente' AND usuario_id = ?", [req.params.id]);
      await tx.run("DELETE FROM recuperacoes_senha WHERE tipo_usuario = 'cliente' AND usuario_id = ?", [req.params.id]);
      await tx.run('DELETE FROM avaliacoes WHERE cliente_id = ?', [req.params.id]);
      await tx.run(`UPDATE clientes SET nome = 'Cliente excluído', email = ?, senha = ?, telefone = NULL,
        endereco_padrao = NULL, bairro = NULL, cep = NULL, cidade = NULL, estado = NULL,
        latitude = NULL, longitude = NULL, status_cadastro = 'suspenso', status_motivo = 'Conta excluída pelo titular'
        WHERE id = ?`, [`excluido-cliente-${req.params.id}-${Date.now()}@invalid.local`, bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 10), req.params.id]);
    });
    res.json({ success: true, message: 'Dados pessoais removidos e histórico transacional anonimizado. O e-mail pode ser reutilizado.' });
  } catch (e) { res.status(500).json({ error: 'Não foi possível excluir a conta' }); }
});

app.delete('/api/entregadores/:id', authEntregador, async (req, res) => {
  if (req.usuario.id != req.params.id) return res.status(403).json({ error: 'Permissão negada' });
  try {
    const ativo = await dbGet("SELECT id FROM pedidos WHERE entregador_id = ? AND status IN ('em_coleta','saiu_entrega') LIMIT 1", [req.params.id]);
    if (ativo) return res.status(409).json({ error: 'Finalize ou devolva a entrega ativa antes de excluir a conta' });
    await dbTransaction(async tx => {
      await tx.run(`UPDATE solicitacoes_privacidade SET descricao = NULL,
        resposta_admin = 'Conta anonimizada a pedido do titular', status = 'concluida',
        atualizada_em = CURRENT_TIMESTAMP WHERE tipo_usuario = 'entregador' AND usuario_id = ?`, [req.params.id]);
      await tx.run(`UPDATE verificacoes_identidade SET referencia_externa = NULL,
        resultado_codigo = NULL, motivo = 'Conta anonimizada', status = 'nao_iniciada',
        atualizada_em = CURRENT_TIMESTAMP WHERE tipo_usuario = 'entregador' AND usuario_id = ?`, [req.params.id]);
      await tx.run("DELETE FROM aceites_termos WHERE tipo_usuario = 'entregador' AND usuario_id = ?", [req.params.id]);
      await tx.run("DELETE FROM notificacoes WHERE tipo_usuario = 'entregador' AND usuario_id = ?", [req.params.id]);
      await tx.run("DELETE FROM recuperacoes_senha WHERE tipo_usuario = 'entregador' AND usuario_id = ?", [req.params.id]);
      await tx.run('DELETE FROM avaliacoes WHERE entregador_id = ?', [req.params.id]);
      await tx.run(`UPDATE entregadores SET nome = 'Entregador excluído', cpf = NULL, email = ?, senha = ?, telefone = NULL,
        placa = NULL, cep = NULL, cidade = NULL, estado = NULL, foto = NULL, chave_pix = NULL,
        disponivel = 0, latitude = NULL, longitude = NULL, status_cadastro = 'suspenso', status_motivo = 'Conta excluída pelo titular'
        WHERE id = ?`, [`excluido-entregador-${req.params.id}-${Date.now()}@invalid.local`, bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 10), req.params.id]);
    });
    res.json({ success: true, message: 'Dados pessoais removidos e histórico transacional anonimizado. E-mail e CPF podem ser reutilizados.' });
  } catch (e) { res.status(500).json({ error: 'Não foi possível excluir a conta' }); }
});

app.delete('/api/lojas/:id', authLojas, async (req, res) => {
  if (req.usuario.id != req.params.id) return res.status(403).json({ error: 'Permissão negada' });
  try {
    const ativo = await dbGet("SELECT id FROM pedidos WHERE loja_id = ? AND status NOT IN ('entregue','cancelado') LIMIT 1", [req.params.id]);
    if (ativo) return res.status(409).json({ error: 'Conclua ou cancele os pedidos ativos antes de excluir a loja' });
    await dbTransaction(async tx => {
      await tx.run(`UPDATE solicitacoes_privacidade SET descricao = NULL,
        resposta_admin = 'Conta anonimizada a pedido do titular', status = 'concluida',
        atualizada_em = CURRENT_TIMESTAMP WHERE tipo_usuario = 'loja' AND usuario_id = ?`, [req.params.id]);
      await tx.run(`UPDATE verificacoes_identidade SET referencia_externa = NULL,
        resultado_codigo = NULL, motivo = 'Conta anonimizada', status = 'nao_iniciada',
        atualizada_em = CURRENT_TIMESTAMP WHERE tipo_usuario = 'loja' AND usuario_id = ?`, [req.params.id]);
      await tx.run("DELETE FROM aceites_termos WHERE tipo_usuario = 'loja' AND usuario_id = ?", [req.params.id]);
      await tx.run("DELETE FROM notificacoes WHERE tipo_usuario = 'loja' AND usuario_id = ?", [req.params.id]);
      await tx.run("DELETE FROM recuperacoes_senha WHERE tipo_usuario = 'loja' AND usuario_id = ?", [req.params.id]);
      await tx.run('UPDATE produtos SET ativo = 0 WHERE loja_id = ?', [req.params.id]);
      await tx.run(`UPDATE lojas SET nome = 'Loja excluída', cnpj = NULL, email = ?, senha = ?, telefone = NULL,
        whatsapp = NULL, chave_pix = NULL, logo = NULL, endereco = NULL, bairro = NULL, cep = NULL,
        latitude = NULL, longitude = NULL, aberto = 0, status_cadastro = 'suspenso', status_motivo = 'Conta excluída pelo titular'
        WHERE id = ?`, [`excluido-loja-${req.params.id}-${Date.now()}@invalid.local`, bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 10), req.params.id]);
    });
    res.json({ success: true, message: 'Dados da loja removidos, produtos desativados e histórico transacional anonimizado.' });
  } catch (e) { res.status(500).json({ error: 'Não foi possível excluir a conta da loja' }); }
});

// Limpeza autorizada das contas e dados de teste, somente pelo administrador
app.post('/api/admin/limpar-dados-teste', authAdmin, async (req, res) => {
  if (req.body.confirmacao !== 'LIMPAR TESTES') {
    return res.status(400).json({ error: 'Confirmação de limpeza inválida' });
  }
  try {
    await dbTransaction(async tx => {
      for (const sql of [
        'DELETE FROM notificacoes', 'DELETE FROM auditoria_admin', 'DELETE FROM solicitacoes_privacidade',
        'DELETE FROM verificacoes_identidade', 'DELETE FROM recuperacoes_senha', 'DELETE FROM reembolsos',
        'DELETE FROM reservas_estoque', 'DELETE FROM pagamentos', 'DELETE FROM saques',
        'DELETE FROM aceites_termos', 'DELETE FROM avaliacoes', 'DELETE FROM saldo_plataforma',
        'DELETE FROM movimentacoes_lojas', 'DELETE FROM saldo_lojas',
        'DELETE FROM saldo_entregadores', 'DELETE FROM pedidos',
        'DELETE FROM produtos', 'DELETE FROM lojas',
        'DELETE FROM clientes', 'DELETE FROM entregadores'
      ]) await tx.run(sql);
    });
    res.json({ success: true, message: 'Todos os dados de teste foram excluídos. E-mails, CPFs e CNPJs podem ser reutilizados.' });
  } catch (e) { console.error('Limpeza de teste:', e); res.status(500).json({ error: 'A limpeza não foi concluída' }); }
});

app.get('/api/admin/dashboard', authAdmin, async (req, res) => {
  const totalLojas = await dbGet('SELECT COUNT(*) as total FROM lojas');
  const totalEntregadores = await dbGet('SELECT COUNT(*) as total FROM entregadores');
  const totalClientes = await dbGet('SELECT COUNT(*) as total FROM clientes');
  const pedidosHoje = await dbGet("SELECT COUNT(*) as total FROM pedidos WHERE (data_pedido::timestamptz AT TIME ZONE 'America/Araguaina')::date = (CURRENT_TIMESTAMP AT TIME ZONE 'America/Araguaina')::date");
  const pedidosPendentes = await dbGet("SELECT COUNT(*) as total FROM pedidos WHERE status NOT IN ('entregue', 'cancelado')");
  const cadastrosPendentes = await dbGet(`SELECT
    (SELECT COUNT(*) FROM lojas WHERE status_cadastro = 'pendente') +
    (SELECT COUNT(*) FROM entregadores WHERE status_cadastro = 'pendente') AS total`);
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
    cadastrosPendentes: cadastrosPendentes?.total || 0,
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
