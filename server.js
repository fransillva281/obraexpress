const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'obraexpress_secret_key_2026';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'frontend')));
app.use('/loja', express.static(path.join(__dirname, 'frontend')));
app.use('/entregador', express.static(path.join(__dirname, 'entregador')));

// Database setup (sqlite3)
const db = new sqlite3.Database('obraexpress.db');

const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function(err) {
    if (err) reject(err);
    else resolve(this);
  });
});

const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => {
    if (err) reject(err);
    else resolve(rows);
  });
});

const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => {
    if (err) reject(err);
    else resolve(row);
  });
});

// Create tables
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS lojas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      cnpj TEXT UNIQUE,
      email TEXT UNIQUE NOT NULL,
      senha TEXT NOT NULL,
      telefone TEXT,
      whatsapp TEXT,
      logo TEXT,
      endereco TEXT,
      bairro TEXT,
      cidade TEXT DEFAULT 'São Luís',
      estado TEXT DEFAULT 'MA',
      latitude REAL,
      longitude REAL,
      descricao TEXT,
      categorias TEXT,
      taxa_entrega_km REAL DEFAULT 2.00,
      entrega_gratis_ate REAL DEFAULT 0,
      tempo_entrega_min TEXT DEFAULT '30-60 min',
      aberto INTEGER DEFAULT 1,
      data_cadastro TEXT DEFAULT (datetime('now', '-3 hours'))
    )`);

  db.run(`
    CREATE TABLE IF NOT EXISTS produtos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      loja_id INTEGER NOT NULL,
      nome TEXT NOT NULL,
      descricao TEXT,
      preco REAL NOT NULL,
      foto TEXT,
      categoria TEXT,
      marca TEXT,
      unidade TEXT DEFAULT 'un',
      estoque INTEGER DEFAULT 999,
      destaque INTEGER DEFAULT 0,
      ativo INTEGER DEFAULT 1,
      data_cadastro TEXT DEFAULT (datetime('now', '-3 hours')),
      FOREIGN KEY (loja_id) REFERENCES lojas(id) ON DELETE CASCADE
    )`);

  db.run(`
    CREATE TABLE IF NOT EXISTS clientes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      senha TEXT NOT NULL,
      telefone TEXT,
      endereco_padrao TEXT,
      bairro TEXT,
      cidade TEXT DEFAULT 'São Luís',
      estado TEXT DEFAULT 'MA',
      latitude REAL,
      longitude REAL,
      data_cadastro TEXT DEFAULT (datetime('now', '-3 hours'))
    )`);

  db.run(`
    CREATE TABLE IF NOT EXISTS entregadores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      cpf TEXT UNIQUE,
      email TEXT UNIQUE NOT NULL,
      senha TEXT NOT NULL,
      telefone TEXT,
      veiculo TEXT,
      placa TEXT,
      foto TEXT,
      disponivel INTEGER DEFAULT 1,
      latitude REAL,
      longitude REAL,
      avaliacao REAL DEFAULT 5.0,
      total_entregas INTEGER DEFAULT 0,
      data_cadastro TEXT DEFAULT (datetime('now', '-3 hours'))
    )`);

  db.run(`
    CREATE TABLE IF NOT EXISTS pedidos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cliente_id INTEGER NOT NULL,
      loja_id INTEGER NOT NULL,
      entregador_id INTEGER,
      status TEXT DEFAULT 'aguardando',
      itens TEXT NOT NULL,
      total_produtos REAL NOT NULL,
      taxa_entrega REAL DEFAULT 0,
      total_final REAL NOT NULL,
      forma_pagamento TEXT DEFAULT 'entrega',
      tipo_entrega TEXT DEFAULT 'entrega',
      endereco_entrega TEXT,
      bairro_entrega TEXT,
      latitude_entrega REAL,
      longitude_entrega REAL,
      observacao TEXT,
      distancia_km REAL,
      codigo_retirada TEXT,
      data_pedido TEXT DEFAULT (datetime('now', '-3 hours')),
      data_confirmacao TEXT,
      data_saida TEXT,
      data_entrega TEXT,
      FOREIGN KEY (cliente_id) REFERENCES clientes(id),
      FOREIGN KEY (loja_id) REFERENCES lojas(id),
      FOREIGN KEY (entregador_id) REFERENCES entregadores(id)
    )`);

  db.run(`
    CREATE TABLE IF NOT EXISTS categorias (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      icone TEXT,
      ordem INTEGER DEFAULT 0
    )`);

  // Insert default categories if none exist
  db.get('SELECT COUNT(*) as count FROM categorias', (err, row) => {
    if (row && row.count === 0) {
      const cats = [
        ['Hidráulica', '🔧', 1],
        ['Elétrica', '⚡', 2],
        ['Conexões', '🔩', 3],
        ['Ferragens', '🔨', 4],
        ['Acabamento', '🏠', 5],
        ['Pisos e Revestimentos', '🧱', 6],
        ['Tintas', '🎨', 7],
        ['Ferramentas', '🛠️', 8],
        ['Segurança', '🪖', 9],
        ['Hidráulica', '🚿', 10]
      ];
      const stmt = db.prepare('INSERT INTO categorias (nome, icone, ordem) VALUES (?, ?, ?)');
      cats.forEach(c => stmt.run(c));
      stmt.finalize();
    }
  });
});

// ============ MIDDLEWARE ============
function authLojas(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token não fornecido' });
  try {
    req.usuario = jwt.verify(token, JWT_SECRET);
    next();
  } catch { res.status(401).json({ error: 'Token inválido' }); }
}

function authCliente(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token não fornecido' });
  try {
    req.usuario = jwt.verify(token, JWT_SECRET);
    next();
  } catch { res.status(401).json({ error: 'Token inválido' }); }
}

// ============ LOJAS API ============
app.post('/api/lojas/cadastro', async (req, res) => {
  const { nome, email, senha, telefone, endereco, bairro, latitude, longitude, descricao, categorias, taxa_entrega_km } = req.body;
  try {
    const hash = bcrypt.hashSync(senha, 10);
    const result = await dbRun('INSERT INTO lojas (nome, email, senha, telefone, endereco, bairro, latitude, longitude, descricao, categorias, taxa_entrega_km) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [nome, email, hash, telefone, endereco, bairro, latitude, longitude, descricao, categorias, taxa_entrega_km || 2.00]);
    const token = jwt.sign({ id: result.lastID, tipo: 'loja' }, JWT_SECRET);
    res.json({ success: true, id: result.lastID, token, loja: { id: result.lastID, nome, email } });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Email já cadastrado' });
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/lojas/login', async (req, res) => {
  const { email, senha } = req.body;
  const loja = await dbGet('SELECT * FROM lojas WHERE email = ?', [email]);
  if (!loja) return res.status(401).json({ error: 'Email não encontrado' });
  if (!bcrypt.compareSync(senha, loja.senha)) return res.status(401).json({ error: 'Senha incorreta' });
  const token = jwt.sign({ id: loja.id, tipo: 'loja' }, JWT_SECRET);
  res.json({ success: true, token, loja: { id: loja.id, nome: loja.nome, email: loja.email, logo: loja.logo, aberto: loja.aberto, taxa_entrega_km: loja.taxa_entrega_km } });
});

app.get('/api/lojas', async (req, res) => {
  const { categoria, bairro, busca } = req.query;
  let sql = 'SELECT id, nome, logo, descricao, categorias, endereco, bairro, taxa_entrega_km, entrega_gratis_ate, tempo_entrega_min, aberto, latitude, longitude FROM lojas WHERE aberto = 1';
  const params = [];
  if (categoria) { sql += ' AND categorias LIKE ?'; params.push(`%${categoria}%`); }
  if (bairro) { sql += ' AND bairro LIKE ?'; params.push(`%${bairro}%`); }
  if (busca) { sql += ' AND (nome LIKE ? OR descricao LIKE ?)'; params.push(`%${busca}%`, `%${busca}%`); }
  sql += ' ORDER BY nome';
  const lojas = await dbAll(sql, params);
  res.json({ lojas });
});

app.get('/api/lojas/:id', async (req, res) => {
  const loja = await dbGet('SELECT id, nome, logo, descricao, categorias, endereco, bairro, cidade, estado, telefone, whatsapp, taxa_entrega_km, entrega_gratis_ate, tempo_entrega_min, aberto, latitude, longitude FROM lojas WHERE id = ?', [req.params.id]);
  if (!loja) return res.status(404).json({ error: 'Loja não encontrada' });
  const produtos = await dbAll('SELECT * FROM produtos WHERE loja_id = ? AND ativo = 1 ORDER BY destaque DESC, nome', [req.params.id]);
  res.json({ loja, produtos });
});

app.put('/api/lojas/:id', authLojas, async (req, res) => {
  if (req.usuario.id != req.params.id) return res.status(403).json({ error: 'Permissão negada' });
  const { nome, telefone, whatsapp, endereco, bairro, latitude, longitude, descricao, categorias, taxa_entrega_km, entrega_gratis_ate, tempo_entrega_min, aberto, logo } = req.body;
  const updates = [];
  const params = [];
  if (nome !== undefined) { updates.push('nome = ?'); params.push(nome); }
  if (telefone !== undefined) { updates.push('telefone = ?'); params.push(telefone); }
  if (whatsapp !== undefined) { updates.push('whatsapp = ?'); params.push(whatsapp); }
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
  if (updates.length === 0) return res.status(400).json({ error: 'Nada para atualizar' });
  params.push(req.params.id);
  await dbRun(`UPDATE lojas SET ${updates.join(', ')} WHERE id = ?`, params);
  res.json({ success: true });
});

// ============ PRODUTOS API ============
app.post('/api/produtos', authLojas, async (req, res) => {
  const { loja_id, nome, descricao, preco, foto, categoria, marca, unidade, estoque } = req.body;
  if (req.usuario.id != loja_id) return res.status(403).json({ error: 'Permissão negada' });
  const result = await dbRun('INSERT INTO produtos (loja_id, nome, descricao, preco, foto, categoria, marca, unidade, estoque) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [loja_id, nome, descricao, preco, foto, categoria, marca, unidade, estoque || 999]);
  res.json({ success: true, id: result.lastID });
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
  if (categoria !== undefined) { updates.push('categoria = ?'); params.push(categoria); }
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
  const { categoria, loja_id, busca } = req.query;
  let sql = 'SELECT p.*, l.nome as loja_nome, l.logo as loja_logo, l.bairro as loja_bairro FROM produtos p JOIN lojas l ON p.loja_id = l.id WHERE p.ativo = 1 AND l.aberto = 1';
  const params = [];
  if (categoria) { sql += ' AND p.categoria = ?'; params.push(categoria); }
  if (loja_id) { sql += ' AND p.loja_id = ?'; params.push(loja_id); }
  if (busca) { sql += ' AND (p.nome LIKE ? OR p.descricao LIKE ?)'; params.push(`%${busca}%`, `%${busca}%`); }
  sql += ' ORDER BY p.destaque DESC, p.nome';
  const produtos = await dbAll(sql, params);
  res.json({ produtos });
});

// ============ CLIENTES API ============
app.post('/api/clientes/cadastro', async (req, res) => {
  const { nome, email, senha, telefone, endereco_padrao, bairro, latitude, longitude } = req.body;
  try {
    const hash = bcrypt.hashSync(senha, 10);
    const result = await dbRun('INSERT INTO clientes (nome, email, senha, telefone, endereco_padrao, bairro, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [nome, email, hash, telefone, endereco_padrao, bairro, latitude, longitude]);
    const token = jwt.sign({ id: result.lastID, tipo: 'cliente' }, JWT_SECRET);
    res.json({ success: true, token, cliente: { id: result.lastID, nome, email } });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Email já cadastrado' });
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/clientes/login', async (req, res) => {
  const { email, senha } = req.body;
  const cliente = await dbGet('SELECT * FROM clientes WHERE email = ?', [email]);
  if (!cliente) return res.status(401).json({ error: 'Email não encontrado' });
  if (!bcrypt.compareSync(senha, cliente.senha)) return res.status(401).json({ error: 'Senha incorreta' });
  const token = jwt.sign({ id: cliente.id, tipo: 'cliente' }, JWT_SECRET);
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
  const { nome, cpf, email, senha, telefone, veiculo, placa } = req.body;
  try {
    const hash = bcrypt.hashSync(senha, 10);
    const result = await dbRun('INSERT INTO entregadores (nome, cpf, email, senha, telefone, veiculo, placa) VALUES (?, ?, ?, ?, ?, ?, ?)', [nome, cpf, email, hash, telefone, veiculo, placa]);
    const token = jwt.sign({ id: result.lastID, tipo: 'entregador' }, JWT_SECRET);
    res.json({ success: true, token, entregador: { id: result.lastID, nome, email } });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'CPF ou email já cadastrado' });
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/entregadores/login', async (req, res) => {
  const { email, senha } = req.body;
  const entregador = await dbGet('SELECT * FROM entregadores WHERE email = ?', [email]);
  if (!entregador) return res.status(401).json({ error: 'Email não encontrado' });
  if (!bcrypt.compareSync(senha, entregador.senha)) return res.status(401).json({ error: 'Senha incorreta' });
  const token = jwt.sign({ id: entregador.id, tipo: 'entregador' }, JWT_SECRET);
  res.json({ success: true, token, entregador: { id: entregador.id, nome: entregador.nome, email: entregador.email, veiculo: entregador.veiculo, disponivel: entregador.disponivel } });
});

app.get('/api/entregadores/disponiveis', async (req, res) => {
  const entregadores = await dbAll('SELECT id, nome, veiculo, total_entregas, latitude, longitude FROM entregadores WHERE disponivel = 1');
  res.json({ entregadores });
});

app.put('/api/entregadores/:id/localizacao', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token não fornecido' });
  try {
    const usuario = jwt.verify(token, JWT_SECRET);
    if (usuario.id != req.params.id || usuario.tipo != 'entregador') return res.status(403).json({ error: 'Permissão negada' });
    const { latitude, longitude, disponivel } = req.body;
    const updates = []; const params = [];
    if (latitude !== undefined) { updates.push('latitude = ?'); params.push(latitude); }
    if (longitude !== undefined) { updates.push('longitude = ?'); params.push(longitude); }
    if (disponivel !== undefined) { updates.push('disponivel = ?'); params.push(disponivel ? 1 : 0); }
    if (updates.length === 0) return res.status(400).json({ error: 'Nada para atualizar' });
    params.push(req.params.id);
    await dbRun(`UPDATE entregadores SET ${updates.join(', ')} WHERE id = ?`, params);
    res.json({ success: true });
  } catch { res.status(401).json({ error: 'Token inválido' }); }
});

// ============ PEDIDOS API ============
app.post('/api/pedidos', authCliente, async (req, res) => {
  const { loja_id, itens, total_produtos, taxa_entrega, tipo_entrega, endereco_entrega, bairro_entrega, latitude_entrega, longitude_entrega, distancia_km, forma_pagamento, observacao } = req.body;
  const total_final = total_produtos + (taxa_entrega || 0);
  const codigo = Math.random().toString(36).substring(2, 8).toUpperCase();
  const result = await dbRun('INSERT INTO pedidos (cliente_id, loja_id, itens, total_produtos, taxa_entrega, total_final, tipo_entrega, endereco_entrega, bairro_entrega, latitude_entrega, longitude_entrega, distancia_km, forma_pagamento, observacao, codigo_retirada) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [req.usuario.id, loja_id, JSON.stringify(itens), total_produtos, taxa_entrega || 0, total_final, tipo_entrega, endereco_entrega, bairro_entrega, latitude_entrega, longitude_entrega, distancia_km || 0, forma_pagamento || 'entrega', observacao, tipo_entrega === 'retirada' ? codigo : null]);
  res.json({ success: true, pedido_id: result.lastID, codigo_retirada: tipo_entrega === 'retirada' ? codigo : null });
});

app.get('/api/pedidos/loja/:loja_id', authLojas, async (req, res) => {
  if (req.usuario.id != req.params.loja_id) return res.status(403).json({ error: 'Permissão negada' });
  const { status } = req.query;
  let sql = 'SELECT p.*, c.nome as cliente_nome, c.telefone as cliente_telefone, c.endereco_padrao, c.bairro FROM pedidos p JOIN clientes c ON p.cliente_id = c.id WHERE p.loja_id = ?';
  const params = [req.params.loja_id];
  if (status) { sql += ' AND p.status = ?'; params.push(status); }
  sql += ' ORDER BY p.data_pedido DESC';
  const pedidos = await dbAll(sql, params);
  res.json({ pedidos });
});

app.get('/api/pedidos/cliente/:cliente_id', authCliente, async (req, res) => {
  if (req.usuario.id != req.params.cliente_id) return res.status(403).json({ error: 'Permissão negada' });
  const pedidos = await dbAll('SELECT p.*, l.nome as loja_nome, l.logo as loja_logo FROM pedidos p JOIN lojas l ON p.loja_id = l.id WHERE p.cliente_id = ? ORDER BY p.data_pedido DESC', [req.params.cliente_id]);
  res.json({ pedidos });
});

app.get('/api/pedidos/entregador/:entregador_id', async (req, res) => {
  const pedidos = await dbAll('SELECT p.*, l.nome as loja_nome, l.endereco as loja_endereco, c.nome as cliente_nome, c.telefone as cliente_telefone FROM pedidos p JOIN lojas l ON p.loja_id = l.id JOIN clientes c ON p.cliente_id = c.id WHERE p.entregador_id = ? ORDER BY p.data_pedido DESC', [req.params.entregador_id]);
  res.json({ pedidos });
});

app.get('/api/pedidos/disponiveis', async (req, res) => {
  const pedidos = await dbAll("SELECT p.*, l.nome as loja_nome, l.endereco as loja_endereco, l.latitude as loja_latitude, l.longitude as loja_longitude, c.nome as cliente_nome, c.telefone as cliente_telefone, c.endereco_padrao as cliente_endereco, c.latitude as cliente_latitude, c.longitude as cliente_longitude FROM pedidos p JOIN lojas l ON p.loja_id = l.id JOIN clientes c ON p.cliente_id = c.id WHERE p.status = 'confirmado' AND p.tipo_entrega = 'entrega' AND p.entregador_id IS NULL ORDER BY p.data_pedido ASC");
  res.json({ pedidos });
});

app.put('/api/pedidos/:id/status', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token não fornecido' });
  try {
    const usuario = jwt.verify(token, JWT_SECRET);
    const { status, entregador_id } = req.body;
    const pedido = await dbGet('SELECT * FROM pedidos WHERE id = ?', [req.params.id]);
    if (!pedido) return res.status(404).json({ error: 'Pedido não encontrado' });

    const updates = []; const params = [];
    if (status) { updates.push('status = ?'); params.push(status); }
    if (entregador_id !== undefined) { updates.push('entregador_id = ?'); params.push(entregador_id); }
    if (status === 'confirmado') updates.push("data_confirmacao = datetime('now', '-3 hours')");
    if (status === 'saiu_entrega') updates.push("data_saida = datetime('now', '-3 hours')");
    if (status === 'entregue') updates.push("data_entrega = datetime('now', '-3 hours')");
    if (updates.length === 0) return res.status(400).json({ error: 'Nada para atualizar' });
    params.push(req.params.id);
    await dbRun(`UPDATE pedidos SET ${updates.join(', ')} WHERE id = ?`, params);

    if (entregador_id && status === 'saiu_entrega') {
      await dbRun('UPDATE entregadores SET total_entregas = total_entregas + 1 WHERE id = ?', [entregador_id]);
    }
    res.json({ success: true });
  } catch { res.status(401).json({ error: 'Token inválido' }); }
});

// ============ CATEGORIAS ============
app.get('/api/categorias', async (req, res) => {
  const categorias = await dbAll('SELECT * FROM categorias ORDER BY ordem');
  res.json({ categorias });
});

// ============ DISTÂNCIA SIMULADA ============
app.get('/api/distancia', (req, res) => {
  const { origem_lat, origem_lng, dest_lat, dest_lng } = req.query;
  if (!origem_lat || !origem_lng || !dest_lat || !dest_lng) {
    return res.status(400).json({ error: 'Coordenadas necessárias' });
  }
  const R = 6371;
  const dLat = (dest_lat - origem_lat) * Math.PI / 180;
  const dLon = (dest_lng - origem_lng) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(origem_lat * Math.PI / 180) * Math.cos(dest_lat * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  const distancia = R * c;
  res.json({ distancia_km: Math.round(distancia * 10) / 10 });
});

// Serve frontend SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 ObraExpress rodando na porta ${PORT}`);
});
