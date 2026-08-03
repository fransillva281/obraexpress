const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
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
  calcularFinanceiroPedido,
  normalizarPlanoLoja
} = require('./financial-utils');

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

// Configurações da plataforma
const PLATAFORMA = {
  nome: 'ObraExpress',
  perc_motoboy: 0.85,    // 85% da taxa de entrega pro motoboy
  perc_plataforma: 0.15, // 15% temporário da taxa de entrega para a plataforma
  mensalidade_loja: 0,   // Sem mensalidade na fase inicial
  comissao_pedido: 0.10  // 10% sobre os produtos nos dois planos
};
const TAXA_ENTREGA_TEMPORARIA = 5;

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
function authLojas(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token não fornecido' });
  try {
    req.usuario = jwt.verify(token, JWT_SECRET);
    if (req.usuario.tipo !== 'loja') return res.status(403).json({ error: 'Acesso apenas para lojas' });
    next();
  } catch { res.status(401).json({ error: 'Token inválido' }); }
}

function authCliente(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token não fornecido' });
  try {
    req.usuario = jwt.verify(token, JWT_SECRET);
    if (req.usuario.tipo !== 'cliente') return res.status(403).json({ error: 'Acesso apenas para clientes' });
    next();
  } catch { res.status(401).json({ error: 'Token inválido' }); }
}

function authEntregador(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token não fornecido' });
  try {
    req.usuario = jwt.verify(token, JWT_SECRET);
    if (req.usuario.tipo !== 'entregador') return res.status(403).json({ error: 'Acesso apenas para entregadores' });
    next();
  } catch { res.status(401).json({ error: 'Token inválido' }); }
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

// ============ LOJAS API ============
app.post('/api/lojas/cadastro', async (req, res) => {
  const { nome, email, senha, telefone, endereco, bairro, latitude, longitude, descricao, categorias, taxa_entrega_km, chave_pix, plano, tempo_entrega_min } = req.body;
  try {
    if (!nome || !email || !senha) return res.status(400).json({ error: 'Nome, email e senha são obrigatórios' });
    const planoEscolhido = normalizarPlanoLoja(plano);
    const hash = bcrypt.hashSync(senha, 10);
    const taxaKm = Number(taxa_entrega_km || 2);
    const result = await dbRun('INSERT INTO lojas (nome, email, senha, telefone, endereco, bairro, latitude, longitude, descricao, categorias, taxa_entrega_km, chave_pix, plano, comissao_percentual, tempo_entrega_min) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', 
      [nome, email, hash, telefone, endereco, bairro, latitude, longitude, descricao, categorias, taxaKm, chave_pix || null, planoEscolhido, 10, tempo_entrega_min || '30-60 min']);
    const token = jwt.sign({ id: result.lastID, tipo: 'loja' }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, id: result.lastID, token, loja: { id: result.lastID, nome, email, plano: planoEscolhido, comissao_percentual: 10, taxa_entrega_km: taxaKm, chave_pix: chave_pix || null } });
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
  const token = jwt.sign({ id: loja.id, tipo: 'loja' }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ success: true, token, loja: { id: loja.id, nome: loja.nome, email: loja.email, logo: loja.logo, aberto: loja.aberto, taxa_entrega_km: loja.taxa_entrega_km, chave_pix: loja.chave_pix, plano: normalizarPlanoLoja(loja.plano), comissao_percentual: Number(loja.comissao_percentual || 10) } });
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
  const loja = await dbGet('SELECT id, nome, logo, descricao, categorias, endereco, bairro, cidade, estado, telefone, whatsapp, chave_pix, taxa_entrega_km, entrega_gratis_ate, tempo_entrega_min, aberto, latitude, longitude, plano, comissao_percentual FROM lojas WHERE id = ?', [req.params.id]);
  if (!loja) return res.status(404).json({ error: 'Loja não encontrada' });
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
    const hash = bcrypt.hashSync(senha, 10);
    const result = await dbRun('INSERT INTO clientes (nome, email, senha, telefone, endereco_padrao, bairro, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [nome, email, hash, telefone, endereco_padrao, bairro, latitude, longitude]);
    const token = jwt.sign({ id: result.lastID, tipo: 'cliente' }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, token, cliente: { id: result.lastID, nome, email } });
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
  res.json({ success: true, token, cliente: { id: cliente.id, nome: cliente.nome, email: cliente.email, telefone: cliente.telefone, endereco_padrao: cliente.endereco_padrao, bairro: cliente.bairro } });
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
    const hash = bcrypt.hashSync(senha, 10);
    const result = await dbRun('INSERT INTO entregadores (nome, cpf, email, senha, telefone, veiculo, placa, chave_pix) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [nome, cpf, email, hash, telefone, veiculo, placa, chave_pix || null]);
    const token = jwt.sign({ id: result.lastID, tipo: 'entregador' }, JWT_SECRET, { expiresIn: '7d' });
    // Criar saldo inicial
    await dbRun('INSERT INTO saldo_entregadores (entregador_id, saldo) VALUES (?, 0) ON CONFLICT (entregador_id) DO NOTHING', [result.lastID]);
    res.json({ success: true, token, entregador: { id: result.lastID, nome, email } });
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
  res.json({ success: true, token, entregador: { id: entregador.id, nome: entregador.nome, email: entregador.email, veiculo: entregador.veiculo, disponivel: entregador.disponivel, chave_pix: entregador.chave_pix } });
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

// Cliente faz pedido. Preços e comissão são sempre recalculados no servidor.
app.post('/api/pedidos', authCliente, async (req, res) => {
  try {
    const { loja_id, itens, tipo_entrega, endereco_entrega, bairro_entrega, latitude_entrega, longitude_entrega, distancia_km, forma_pagamento, observacao } = req.body;
    if (!['entrega', 'retirada'].includes(tipo_entrega)) return res.status(400).json({ error: 'Tipo de entrega inválido' });
    if (tipo_entrega === 'entrega' && !endereco_entrega) return res.status(400).json({ error: 'Informe o endereço de entrega' });
    const loja = await dbGet('SELECT id, plano, comissao_percentual FROM lojas WHERE id = ? AND aberto = 1', [loja_id]);
    if (!loja) return res.status(404).json({ error: 'Loja não encontrada ou fechada' });
    const carrinho = await montarItensPedido(loja_id, itens);
    const taxaEntrega = tipo_entrega === 'entrega' ? TAXA_ENTREGA_TEMPORARIA : 0;
    const financeiro = calcularFinanceiroPedido({
      totalProdutos: carrinho.totalProdutos,
      taxaEntrega,
      tipoEntrega: tipo_entrega,
      planoLoja: loja.plano,
      comissaoPercentual: 10,
      percentualEntregador: PLATAFORMA.perc_motoboy * 100
    });
    const codigo = Math.random().toString(36).substring(2, 8).toUpperCase();

    const result = await dbRun(`INSERT INTO pedidos
      (cliente_id, loja_id, itens, total_produtos, taxa_entrega, total_final, tipo_entrega,
       endereco_entrega, bairro_entrega, latitude_entrega, longitude_entrega, distancia_km,
       forma_pagamento, observacao, codigo_retirada, status, valor_motoboy, valor_plataforma,
       plano_loja, comissao_loja_percentual, valor_comissao_loja, valor_liquido_loja)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.usuario.id, loja_id, JSON.stringify(carrinho.itens), carrinho.totalProdutos,
       financeiro.taxaEntrega, financeiro.totalFinal, tipo_entrega, endereco_entrega,
       bairro_entrega, latitude_entrega, longitude_entrega, distancia_km || 0,
       forma_pagamento || 'pix', observacao, tipo_entrega === 'retirada' ? codigo : null, 'aguardando_confirmacao',
       financeiro.valorMotoboy, financeiro.valorPlataformaEntrega, financeiro.planoLoja,
       financeiro.comissaoPercentual, financeiro.valorComissaoLoja, financeiro.valorLiquidoLoja]);

    res.json({
      success: true,
      pedido_id: result.lastID,
      codigo_retirada: tipo_entrega === 'retirada' ? codigo : null,
      total_produtos: carrinho.totalProdutos,
      taxa_entrega: financeiro.taxaEntrega,
      total_final: financeiro.totalFinal
    });
  } catch (error) {
    const mensagensPermitidas = ['Carrinho vazio', 'Item ou quantidade inválida', 'Um produto não está mais disponível', 'Todos os produtos precisam ser da mesma loja'];
    if (mensagensPermitidas.includes(error.message) || error.message.startsWith('Estoque insuficiente')) {
      return res.status(400).json({ error: error.message });
    }
    console.error('Erro ao criar pedido:', error);
    res.status(500).json({ error: 'Não foi possível criar o pedido' });
  }
});

// Cliente confirma o pedido (vê o valor e decide)
app.put('/api/pedidos/:id/confirmar', authCliente, async (req, res) => {
  const pedido = await dbGet('SELECT * FROM pedidos WHERE id = ?', [req.params.id]);
  if (!pedido) return res.status(404).json({ error: 'Pedido não encontrado' });
  if (pedido.cliente_id != req.usuario.id) return res.status(403).json({ error: 'Esse pedido não é seu' });
  if (pedido.status !== 'aguardando_confirmacao') return res.status(400).json({ error: 'Pedido já foi processado' });
  
  const { confirmou } = req.body;
  if (confirmou) {
    await dbRun("UPDATE pedidos SET cliente_confirmou = 1, status = 'aguardando', data_confirmacao = CURRENT_TIMESTAMP WHERE id = ?", [req.params.id]);
    res.json({ success: true, message: 'Pedido enviado para a loja confirmar.' });
  } else {
    await dbRun("UPDATE pedidos SET status = 'cancelado' WHERE id = ?", [req.params.id]);
    res.json({ success: true, message: 'Pedido cancelado.' });
  }
});

// Lojas veem pedidos
app.get('/api/pedidos/loja/:loja_id', authLojas, async (req, res) => {
  if (req.usuario.id != req.params.loja_id) return res.status(403).json({ error: 'Permissão negada' });
  const { status } = req.query;
  let sql = `SELECT p.*, c.nome as cliente_nome, c.telefone as cliente_telefone, c.endereco_padrao, c.bairro
    FROM pedidos p JOIN clientes c ON p.cliente_id = c.id
    WHERE p.loja_id = ? AND p.status <> 'aguardando_confirmacao'`;
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
  const pedidos = await dbAll(`SELECT p.*, l.nome as loja_nome, l.logo as loja_logo, l.chave_pix,
    e.nome as entregador_nome, e.foto as entregador_foto, e.veiculo as entregador_veiculo
    FROM pedidos p 
    JOIN lojas l ON p.loja_id = l.id 
    LEFT JOIN entregadores e ON p.entregador_id = e.id
    WHERE p.cliente_id = ? ORDER BY p.data_pedido DESC`, [req.params.cliente_id]);
  res.json({ pedidos });
});

// Entregador vê os pedidos dele
app.get('/api/pedidos/entregador/:entregador_id', authEntregador, async (req, res) => {
  if (req.usuario.id != req.params.entregador_id) return res.status(403).json({ error: 'Permissão negada' });
  const pedidos = await dbAll(`SELECT p.*, l.nome as loja_nome, l.endereco as loja_endereco, 
    l.latitude as loja_latitude, l.longitude as loja_longitude, l.telefone as loja_telefone,
    c.nome as cliente_nome, c.telefone as cliente_telefone, c.endereco_padrao as cliente_endereco,
    c.latitude as cliente_latitude, c.longitude as cliente_longitude
    FROM pedidos p 
    JOIN lojas l ON p.loja_id = l.id 
    JOIN clientes c ON p.cliente_id = c.id 
    WHERE p.entregador_id = ? ORDER BY p.data_pedido DESC`, [req.params.entregador_id]);
  res.json({ pedidos });
});

// ENTREGADOR: Ver pedidos disponíveis (status = separado, precisa de entrega)
app.get('/api/pedidos/disponiveis', async (req, res) => {
  const pedidos = await dbAll(`SELECT p.*, l.nome as loja_nome, l.endereco as loja_endereco, 
    l.latitude as loja_latitude, l.longitude as loja_longitude, l.telefone as loja_telefone, l.chave_pix,
    c.nome as cliente_nome, c.telefone as cliente_telefone, c.endereco_padrao as cliente_endereco,
    c.latitude as cliente_latitude, c.longitude as cliente_longitude
    FROM pedidos p 
    JOIN lojas l ON p.loja_id = l.id 
    JOIN clientes c ON p.cliente_id = c.id 
    WHERE p.status = 'separado' AND p.tipo_entrega = 'entrega'
      AND p.plano_loja = 'entrega_obraexpress' AND p.entregador_id IS NULL 
    ORDER BY p.data_pedido ASC`);
  res.json({ pedidos });
});

// ENTREGADOR: Aceitar pedido
app.put('/api/pedidos/:id/aceitar', authEntregador, async (req, res) => {
  const atualizacao = await dbRun(`UPDATE pedidos SET entregador_id = ?, status = ?
    WHERE id = ? AND status = 'separado' AND entregador_id IS NULL AND plano_loja = 'entrega_obraexpress'`,
    [req.usuario.id, 'em_coleta', req.params.id]);
  if (!atualizacao.changes) return res.status(409).json({ error: 'Essa entrega não está mais disponível' });
  await dbRun('UPDATE entregadores SET disponivel = 0 WHERE id = ?', [req.usuario.id]);
  
  res.json({ success: true, message: 'Pedido aceito! Vá até a loja para buscar.' });
});

// ENTREGADOR: Recusar pedido (volta pra lista)
app.put('/api/pedidos/:id/recusar', authEntregador, async (req, res) => {
  const pedido = await dbGet('SELECT * FROM pedidos WHERE id = ?', [req.params.id]);
  if (!pedido) return res.status(404).json({ error: 'Pedido não encontrado' });
  if (pedido.entregador_id != req.usuario.id) return res.status(403).json({ error: 'Você não pode recusar um pedido que não é seu' });
  
  await dbRun('UPDATE pedidos SET entregador_id = NULL, status = ? WHERE id = ?', 
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

  await tx.run('INSERT INTO saldo_lojas (loja_id) VALUES (?) ON CONFLICT (loja_id) DO NOTHING', [pedido.loja_id]);
  await tx.run(`UPDATE saldo_lojas SET saldo = saldo + ?, total_recebido = total_recebido + ?
    WHERE loja_id = ?`, [valorLoja, valorLoja, pedido.loja_id]);
  await tx.run(`INSERT INTO movimentacoes_lojas
    (loja_id, pedido_id, descricao, valor_bruto, valor_comissao, valor_liquido, tipo)
    VALUES (?, ?, ?, ?, ?, ?, ?)`, [pedido.loja_id, pedido.id, `Venda do pedido #${pedido.id}`,
    Number(pedido.total_produtos || 0), comissaoLoja, valorLoja, 'credito']);

  if (comissaoLoja > 0) {
    await tx.run('INSERT INTO saldo_plataforma (descricao, valor, tipo, pedido_id) VALUES (?, ?, ?, ?)',
      [`Comissão de 10% da loja — pedido #${pedido.id}`, comissaoLoja, 'credito', pedido.id]);
  }
  if (valorPlataformaEntrega > 0) {
    await tx.run('INSERT INTO saldo_plataforma (descricao, valor, tipo, pedido_id) VALUES (?, ?, ?, ?)',
      [`Receita da entrega — pedido #${pedido.id}`, valorPlataformaEntrega, 'credito', pedido.id]);
  }

  if (entregadorId) {
    await tx.run('INSERT INTO saldo_entregadores (entregador_id, saldo) VALUES (?, 0) ON CONFLICT (entregador_id) DO NOTHING', [entregadorId]);
    await tx.run(`UPDATE saldo_entregadores SET saldo = saldo + ?, total_ganho = total_ganho + ?
      WHERE entregador_id = ?`, [valorMotoboy, valorMotoboy, entregadorId]);
    await tx.run('UPDATE entregadores SET total_entregas = total_entregas + 1, disponivel = 1 WHERE id = ?', [entregadorId]);
  }

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
      return { creditado: Number(pedido.valor_motoboy || 0), valorPlataforma: Number(pedido.valor_plataforma || 0) + Number(pedido.valor_comissao_loja || 0) };
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
app.get('/api/distancia', (req, res) => {
  const { origem_lat, origem_lng, dest_lat, dest_lng } = req.query;
  if (!origem_lat || !origem_lng || !dest_lat || !dest_lng) {
    return res.status(400).json({ error: 'Coordenadas necessárias' });
  }
  const R = 6371;
  const dLat = (parseFloat(dest_lat) - parseFloat(origem_lat)) * Math.PI / 180;
  const dLon = (parseFloat(dest_lng) - parseFloat(origem_lng)) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) + 
    Math.cos(parseFloat(origem_lat) * Math.PI / 180) * Math.cos(parseFloat(dest_lat) * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  const distancia = R * c;
  const valor_frete = Math.round(distancia * 2 * 10) / 10; // R$ 2/km
  res.json({ distancia_km: Math.round(distancia * 10) / 10, valor_frete });
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

// Excluir a própria conta e seus dados relacionados
app.delete('/api/clientes/:id', authCliente, async (req, res) => {
  if (req.usuario.id != req.params.id) return res.status(403).json({ error: 'Permissão negada' });
  try {
    await dbRun('DELETE FROM avaliacoes WHERE cliente_id = ?', [req.params.id]);
    await dbRun('DELETE FROM pedidos WHERE cliente_id = ?', [req.params.id]);
    await dbRun('DELETE FROM clientes WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Conta do cliente excluída. O e-mail pode ser reutilizado.' });
  } catch (e) { res.status(500).json({ error: 'Não foi possível excluir a conta' }); }
});

app.delete('/api/entregadores/:id', authEntregador, async (req, res) => {
  if (req.usuario.id != req.params.id) return res.status(403).json({ error: 'Permissão negada' });
  try {
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
      'DELETE FROM avaliacoes', 'DELETE FROM saldo_plataforma',
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
  const faturamento = await dbGet('SELECT COALESCE(SUM(valor), 0) as total FROM saldo_plataforma WHERE tipo = ?', ['credito']);
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
  let sql = `SELECT p.*, l.nome as loja_nome, c.nome as cliente_nome, e.nome as entregador_nome
    FROM pedidos p 
    JOIN lojas l ON p.loja_id = l.id 
    JOIN clientes c ON p.cliente_id = c.id 
    LEFT JOIN entregadores e ON p.entregador_id = e.id`;
  const params = [];
  if (status) { sql += ' WHERE p.status = ?'; params.push(status); }
  sql += ' ORDER BY p.data_pedido DESC LIMIT 50';
  const pedidos = await dbAll(sql, params);
  res.json({ pedidos });
});

app.get('/api/admin/financeiro', authAdmin, async (req, res) => {
  const saldoPlataforma = await dbAll('SELECT * FROM saldo_plataforma ORDER BY data DESC LIMIT 50');
  const saldoEntregadores = await dbAll(`SELECT se.*, e.nome as entregador_nome, e.email, e.chave_pix 
    FROM saldo_entregadores se 
    JOIN entregadores e ON se.entregador_id = e.id 
    ORDER BY se.saldo DESC`);
  const saldoLojas = await dbAll(`SELECT sl.loja_id,
    sl.saldo::double precision AS saldo,
    sl.total_recebido::double precision AS total_recebido,
    sl.total_sacado::double precision AS total_sacado,
    l.nome as loja_nome, l.email, l.chave_pix, l.plano,
    l.comissao_percentual::double precision AS comissao_percentual
    FROM saldo_lojas sl
    JOIN lojas l ON sl.loja_id = l.id
    ORDER BY sl.saldo DESC`);
  const totalPlataforma = await dbGet('SELECT COALESCE(SUM(valor), 0) as total FROM saldo_plataforma WHERE tipo = ?', ['credito']);
  res.json({ saldoPlataforma, saldoEntregadores, saldoLojas, totalPlataforma: totalPlataforma?.total || 0 });
});

// ============ SERVE FRONTEND ============
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 ObraExpress rodando na porta ${PORT}`);
});
