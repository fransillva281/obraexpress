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

// Configurações da plataforma
const PLATAFORMA = {
  nome: 'ObraExpress',
  perc_motoboy: 0.85,    // 85% da taxa de entrega pro motoboy
  perc_plataforma: 0.15, // 15% da taxa de entrega pra plataforma (Adalto)
  mensalidade_loja: 70,  // R$ 70/mês (opcional)
  comissao_pedido: 0.10  // 10% por pedido (plano comissão)
};

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

// Database setup: PostgreSQL no Render; SQLite apenas como fallback local.
const usePostgres = Boolean(process.env.DATABASE_URL);
let db, pgPool;
if (usePostgres) {
  const { Pool } = require('pg');
  pgPool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
}
function pgSql(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => '$' + (++i))
    .replace(/date\(data_pedido\) = date\('now', '-3 hours'\)/gi, "data_pedido::date = (CURRENT_TIMESTAMP - INTERVAL '3 hours')::date");
}
const dbRun = (sql, params = []) => {
  if (usePostgres) {
    let q = pgSql(sql);
    const ignore = /INSERT OR IGNORE/i.test(q);
    q = q.replace(/INSERT OR IGNORE INTO/gi, 'INSERT INTO');
    if (ignore) q += ' ON CONFLICT DO NOTHING';
    else if (/^\s*INSERT\s+INTO/i.test(q) && !/RETURNING/i.test(q)) q += ' RETURNING id';
    return pgPool.query(q, params).then(r => ({ lastID: r.rows[0]?.id, changes: r.rowCount }));
  }
  return new Promise((resolve, reject) => db.run(sql, params, function(err) { if (err) reject(err); else resolve(this); }));
};
const dbAll = (sql, params = []) => usePostgres ? pgPool.query(pgSql(sql), params).then(r => r.rows) : new Promise((resolve, reject) => db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows)));
const dbGet = (sql, params = []) => usePostgres ? pgPool.query(pgSql(sql), params).then(r => r.rows[0]) : new Promise((resolve, reject) => db.get(sql, params, (err, row) => err ? reject(err) : resolve(row)));
const pgTables = ["CREATE TABLE IF NOT EXISTS lojas (\n      id SERIAL PRIMARY KEY,\n      nome TEXT NOT NULL,\n      cnpj TEXT UNIQUE,\n      email TEXT UNIQUE NOT NULL,\n      senha TEXT NOT NULL,\n      telefone TEXT,\n      whatsapp TEXT,\n      chave_pix TEXT,\n      logo TEXT,\n      endereco TEXT,\n      bairro TEXT,\n      cidade TEXT DEFAULT 'São Luís',\n      estado TEXT DEFAULT 'MA',\n      latitude DOUBLE PRECISION,\n      longitude DOUBLE PRECISION,\n      descricao TEXT,\n      categorias TEXT,\n      taxa_entrega_km DOUBLE PRECISION DEFAULT 2.00,\n      entrega_gratis_ate DOUBLE PRECISION DEFAULT 0,\n      tempo_entrega_min TEXT DEFAULT '30-60 min',\n      aberto INTEGER DEFAULT 1,\n      plano TEXT DEFAULT 'comissao',\n      data_cadastro TEXT DEFAULT ((CURRENT_TIMESTAMP - INTERVAL '3 hours'))\n    )", "CREATE TABLE IF NOT EXISTS produtos (\n      id SERIAL PRIMARY KEY,\n      loja_id INTEGER NOT NULL,\n      nome TEXT NOT NULL,\n      descricao TEXT,\n      preco DOUBLE PRECISION NOT NULL,\n      foto TEXT,\n      categoria TEXT,\n      marca TEXT,\n      unidade TEXT DEFAULT 'un',\n      estoque INTEGER DEFAULT 999,\n      destaque INTEGER DEFAULT 0,\n      ativo INTEGER DEFAULT 1,\n      data_cadastro TEXT DEFAULT ((CURRENT_TIMESTAMP - INTERVAL '3 hours')),\n      FOREIGN KEY (loja_id) REFERENCES lojas(id) ON DELETE CASCADE\n    )", "CREATE TABLE IF NOT EXISTS clientes (\n      id SERIAL PRIMARY KEY,\n      nome TEXT NOT NULL,\n      email TEXT UNIQUE NOT NULL,\n      senha TEXT NOT NULL,\n      telefone TEXT,\n      endereco_padrao TEXT,\n      bairro TEXT,\n      cidade TEXT DEFAULT 'São Luís',\n      estado TEXT DEFAULT 'MA',\n      latitude DOUBLE PRECISION,\n      longitude DOUBLE PRECISION,\n      data_cadastro TEXT DEFAULT ((CURRENT_TIMESTAMP - INTERVAL '3 hours'))\n    )", "CREATE TABLE IF NOT EXISTS pedidos (\n      id SERIAL PRIMARY KEY,\n      cliente_id INTEGER NOT NULL,\n      loja_id INTEGER NOT NULL,\n      entregador_id INTEGER,\n      itens TEXT NOT NULL,\n      total_produtos DOUBLE PRECISION NOT NULL DEFAULT 0,\n      taxa_entrega DOUBLE PRECISION DEFAULT 0,\n      total_final DOUBLE PRECISION NOT NULL DEFAULT 0,\n      tipo_entrega TEXT DEFAULT 'entrega',\n      endereco_entrega TEXT,\n      bairro_entrega TEXT,\n      latitude_entrega DOUBLE PRECISION,\n      longitude_entrega DOUBLE PRECISION,\n      distancia_km DOUBLE PRECISION DEFAULT 0,\n      forma_pagamento TEXT DEFAULT 'pix',\n      observacao TEXT,\n      status TEXT DEFAULT 'aguardando',\n      codigo_retirada TEXT,\n      data_pedido TEXT DEFAULT ((CURRENT_TIMESTAMP - INTERVAL '3 hours')),\n      data_confirmacao TEXT,\n      data_entrega TEXT,\n      FOREIGN KEY (cliente_id) REFERENCES clientes(id),\n      FOREIGN KEY (loja_id) REFERENCES lojas(id)\n    )", "CREATE TABLE IF NOT EXISTS entregadores (\n      id SERIAL PRIMARY KEY,\n      nome TEXT NOT NULL,\n      cpf TEXT UNIQUE,\n      email TEXT UNIQUE NOT NULL,\n      senha TEXT NOT NULL,\n      telefone TEXT,\n      veiculo TEXT,\n      placa TEXT,\n      foto TEXT,\n      chave_pix TEXT,\n      disponivel INTEGER DEFAULT 1,\n      latitude DOUBLE PRECISION,\n      longitude DOUBLE PRECISION,\n      avaliacao DOUBLE PRECISION DEFAULT 5.0,\n      total_entregas INTEGER DEFAULT 0,\n      data_cadastro TEXT DEFAULT ((CURRENT_TIMESTAMP - INTERVAL '3 hours'))\n    )", "CREATE TABLE IF NOT EXISTS saldo_entregadores (\n      id SERIAL PRIMARY KEY,\n      entregador_id INTEGER UNIQUE NOT NULL,\n      saldo DOUBLE PRECISION DEFAULT 0,\n      total_ganho DOUBLE PRECISION DEFAULT 0,\n      total_sacado DOUBLE PRECISION DEFAULT 0,\n      FOREIGN KEY (entregador_id) REFERENCES entregadores(id) ON DELETE CASCADE\n    )", "CREATE TABLE IF NOT EXISTS saldo_plataforma (\n      id SERIAL PRIMARY KEY,\n      descricao TEXT,\n      valor DOUBLE PRECISION NOT NULL,\n      tipo TEXT DEFAULT 'credito',\n      pedido_id INTEGER,\n      data TEXT DEFAULT ((CURRENT_TIMESTAMP - INTERVAL '3 hours'))\n    )", "CREATE TABLE IF NOT EXISTS avaliacoes (\n      id SERIAL PRIMARY KEY,\n      pedido_id INTEGER NOT NULL,\n      cliente_id INTEGER NOT NULL,\n      loja_id INTEGER,\n      entregador_id INTEGER,\n      nota INTEGER NOT NULL CHECK(nota >= 1 AND nota <= 5),\n      comentario TEXT,\n      data TEXT DEFAULT ((CURRENT_TIMESTAMP - INTERVAL '3 hours')),\n      FOREIGN KEY (pedido_id) REFERENCES pedidos(id),\n      FOREIGN KEY (cliente_id) REFERENCES clientes(id)\n    )", "CREATE TABLE IF NOT EXISTS categorias (\n      id SERIAL PRIMARY KEY,\n      nome TEXT NOT NULL,\n      icone TEXT,\n      ordem INTEGER DEFAULT 0\n    )"];
async function initPostgres() {
  // A tabela de entregadores vem antes de pedidos para respeitar a referência.
  const ordered = [...pgTables.filter(x => /CREATE TABLE IF NOT EXISTS entregadores/.test(x)), ...pgTables.filter(x => !/CREATE TABLE IF NOT EXISTS entregadores/.test(x))];
  for (const sql of ordered) await pgPool.query(sql);
  const extra = [['separado_por','TEXT'],['foto_coleta','TEXT'],['foto_entrega','TEXT'],['cliente_confirmou','INTEGER DEFAULT 0'],['valor_motoboy','DOUBLE PRECISION DEFAULT 0'],['valor_plataforma','DOUBLE PRECISION DEFAULT 0'],['pix_pago','INTEGER DEFAULT 0'],['data_separado','TEXT'],['data_coleta','TEXT'],['data_saida','TEXT']];
  for (const [name,type] of extra) await pgPool.query(`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS ${name} ${type}`);
  const count = await dbGet('SELECT COUNT(*) as count FROM categorias');
  if (Number(count.count) === 0) {
    const cats = [['Hidráulica','🔧',1],['Elétrica','⚡',2],['Conexões','🔩',3],['Ferragens','🔨',4],['Acabamento','🏠',5],['Pisos e Revestimentos','🧱',6],['Tintas','🎨',7],['Ferramentas','🛠️',8],['Segurança','🪖',9],['Hidráulica','🚿',10]];
    for (const c of cats) await dbRun('INSERT INTO categorias (nome, icone, ordem) VALUES (?, ?, ?)', c);
  }
}
const databaseReady = usePostgres ? initPostgres() : Promise.resolve();
if (!usePostgres) {
  const sqlite3 = require('sqlite3').verbose();
  db = new sqlite3.Database('obraexpress.db');
  // ============ CREATE TABLES ============
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
      chave_pix TEXT,
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
      plano TEXT DEFAULT 'comissao',
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
    CREATE TABLE IF NOT EXISTS pedidos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cliente_id INTEGER NOT NULL,
      loja_id INTEGER NOT NULL,
      entregador_id INTEGER,
      itens TEXT NOT NULL,
      total_produtos REAL NOT NULL DEFAULT 0,
      taxa_entrega REAL DEFAULT 0,
      total_final REAL NOT NULL DEFAULT 0,
      tipo_entrega TEXT DEFAULT 'entrega',
      endereco_entrega TEXT,
      bairro_entrega TEXT,
      latitude_entrega REAL,
      longitude_entrega REAL,
      distancia_km REAL DEFAULT 0,
      forma_pagamento TEXT DEFAULT 'pix',
      observacao TEXT,
      status TEXT DEFAULT 'aguardando',
      codigo_retirada TEXT,
      data_pedido TEXT DEFAULT (datetime('now', '-3 hours')),
      data_confirmacao TEXT,
      data_entrega TEXT,
      FOREIGN KEY (cliente_id) REFERENCES clientes(id),
      FOREIGN KEY (loja_id) REFERENCES lojas(id),
      FOREIGN KEY (entregador_id) REFERENCES entregadores(id)
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
      chave_pix TEXT,
      disponivel INTEGER DEFAULT 1,
      latitude REAL,
      longitude REAL,
      avaliacao REAL DEFAULT 5.0,
      total_entregas INTEGER DEFAULT 0,
      data_cadastro TEXT DEFAULT (datetime('now', '-3 hours'))
    )`);

  // Nova tabela: saldo dos entregadores
  db.run(`
    CREATE TABLE IF NOT EXISTS saldo_entregadores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entregador_id INTEGER UNIQUE NOT NULL,
      saldo REAL DEFAULT 0,
      total_ganho REAL DEFAULT 0,
      total_sacado REAL DEFAULT 0,
      FOREIGN KEY (entregador_id) REFERENCES entregadores(id) ON DELETE CASCADE
    )`);

  // Nova tabela: saldo da plataforma (Adalto)
  db.run(`
    CREATE TABLE IF NOT EXISTS saldo_plataforma (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      descricao TEXT,
      valor REAL NOT NULL,
      tipo TEXT DEFAULT 'credito',
      pedido_id INTEGER,
      data TEXT DEFAULT (datetime('now', '-3 hours'))
    )`);

  // Nova tabela: avaliações
  db.run(`
    CREATE TABLE IF NOT EXISTS avaliacoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pedido_id INTEGER NOT NULL,
      cliente_id INTEGER NOT NULL,
      loja_id INTEGER,
      entregador_id INTEGER,
      nota INTEGER NOT NULL CHECK(nota >= 1 AND nota <= 5),
      comentario TEXT,
      data TEXT DEFAULT (datetime('now', '-3 hours')),
      FOREIGN KEY (pedido_id) REFERENCES pedidos(id),
      FOREIGN KEY (cliente_id) REFERENCES clientes(id)
    )`);

  // Adicionar novas colunas na tabela pedidos se não existirem
  db.all("PRAGMA table_info(pedidos)", (err, cols) => {
    if (err) return;
    const colNames = cols.map(c => c.name);
    
    if (!colNames.includes('separado_por')) {
      db.run("ALTER TABLE pedidos ADD COLUMN separado_por TEXT");
    }
    if (!colNames.includes('foto_coleta')) {
      db.run("ALTER TABLE pedidos ADD COLUMN foto_coleta TEXT");
    }
    if (!colNames.includes('foto_entrega')) {
      db.run("ALTER TABLE pedidos ADD COLUMN foto_entrega TEXT");
    }
    if (!colNames.includes('cliente_confirmou')) {
      db.run("ALTER TABLE pedidos ADD COLUMN cliente_confirmou INTEGER DEFAULT 0");
    }
    if (!colNames.includes('valor_motoboy')) {
      db.run("ALTER TABLE pedidos ADD COLUMN valor_motoboy REAL DEFAULT 0");
    }
    if (!colNames.includes('valor_plataforma')) {
      db.run("ALTER TABLE pedidos ADD COLUMN valor_plataforma REAL DEFAULT 0");
    }
    if (!colNames.includes('pix_pago')) {
      db.run("ALTER TABLE pedidos ADD COLUMN pix_pago INTEGER DEFAULT 0");
    }
    if (!colNames.includes('data_separado')) {
      db.run("ALTER TABLE pedidos ADD COLUMN data_separado TEXT");
    }
    if (!colNames.includes('data_coleta')) {
      db.run("ALTER TABLE pedidos ADD COLUMN data_coleta TEXT");
    }
  });

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


}

databaseReady.catch(err => { console.error('Falha ao inicializar o banco:', err); process.exit(1); });
app.use('/api', async (req, res, next) => {
  try { await databaseReady; next(); } catch { res.status(503).json({ error: 'Banco de dados indisponível' }); }
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
  const { nome, email, senha, telefone, endereco, bairro, latitude, longitude, descricao, categorias, taxa_entrega_km, chave_pix } = req.body;
  try {
    const hash = bcrypt.hashSync(senha, 10);
    const result = await dbRun('INSERT INTO lojas (nome, email, senha, telefone, endereco, bairro, latitude, longitude, descricao, categorias, taxa_entrega_km, chave_pix) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', 
      [nome, email, hash, telefone, endereco, bairro, latitude, longitude, descricao, categorias, taxa_entrega_km || 2.00, chave_pix || null]);
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
  res.json({ success: true, token, loja: { id: loja.id, nome: loja.nome, email: loja.email, logo: loja.logo, aberto: loja.aberto, taxa_entrega_km: loja.taxa_entrega_km, chave_pix: loja.chave_pix } });
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
  const loja = await dbGet('SELECT id, nome, logo, descricao, categorias, endereco, bairro, cidade, estado, telefone, whatsapp, chave_pix, taxa_entrega_km, entrega_gratis_ate, tempo_entrega_min, aberto, latitude, longitude FROM lojas WHERE id = ?', [req.params.id]);
  if (!loja) return res.status(404).json({ error: 'Loja não encontrada' });
  const produtos = await dbAll('SELECT * FROM produtos WHERE loja_id = ? AND ativo = 1 ORDER BY destaque DESC, nome', [req.params.id]);
  res.json({ loja, produtos });
});

app.put('/api/lojas/:id', authLojas, async (req, res) => {
  if (req.usuario.id != req.params.id) return res.status(403).json({ error: 'Permissão negada' });
  const { nome, telefone, whatsapp, chave_pix, endereco, bairro, latitude, longitude, descricao, categorias, taxa_entrega_km, entrega_gratis_ate, tempo_entrega_min, aberto, logo } = req.body;
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
  try {
    const loja = await dbGet('SELECT id FROM lojas WHERE id = ?', [loja_id]);
    if (!loja) return res.status(404).json({ error: 'A loja desta sessão não foi encontrada no banco atual. Faça o cadastro novamente.' });
    const result = await dbRun('INSERT INTO produtos (loja_id, nome, descricao, preco, foto, categoria, marca, unidade, estoque) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [loja_id, nome, descricao || null, Number(preco), foto || null, categoria || null, marca || null, unidade || 'un', estoque || 999]);
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
  const { nome, cpf, email, senha, telefone, veiculo, placa, chave_pix } = req.body;
  try {
    const hash = bcrypt.hashSync(senha, 10);
    const result = await dbRun('INSERT INTO entregadores (nome, cpf, email, senha, telefone, veiculo, placa, chave_pix) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [nome, cpf, email, hash, telefone, veiculo, placa, chave_pix || null]);
    const token = jwt.sign({ id: result.lastID, tipo: 'entregador' }, JWT_SECRET);
    // Criar saldo inicial
    await dbRun('INSERT OR IGNORE INTO saldo_entregadores (entregador_id, saldo) VALUES (?, 0)', [result.lastID]);
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

// ============ PEDIDOS API (NOVO FLUXO COMPLETO) ============

// Cliente faz pedido
app.post('/api/pedidos', authCliente, async (req, res) => {
  const { loja_id, itens, total_produtos, taxa_entrega, tipo_entrega, endereco_entrega, bairro_entrega, latitude_entrega, longitude_entrega, distancia_km, forma_pagamento, observacao } = req.body;
  const total_final = total_produtos + (taxa_entrega || 0);
  const codigo = Math.random().toString(36).substring(2, 8).toUpperCase();
  
  // Calcular quanto o motoboy e a plataforma ganham
  const valor_motoboy = Math.round((taxa_entrega || 0) * PLATAFORMA.perc_motoboy * 100) / 100;
  const valor_plataforma = Math.round((taxa_entrega || 0) * PLATAFORMA.perc_plataforma * 100) / 100;
  
  const result = await dbRun('INSERT INTO pedidos (cliente_id, loja_id, itens, total_produtos, taxa_entrega, total_final, tipo_entrega, endereco_entrega, bairro_entrega, latitude_entrega, longitude_entrega, distancia_km, forma_pagamento, observacao, codigo_retirada, valor_motoboy, valor_plataforma) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', 
    [req.usuario.id, loja_id, JSON.stringify(itens), total_produtos, taxa_entrega || 0, total_final, tipo_entrega, endereco_entrega, bairro_entrega, latitude_entrega, longitude_entrega, distancia_km || 0, forma_pagamento || 'entrega', observacao, tipo_entrega === 'retirada' ? codigo : null, valor_motoboy, valor_plataforma]);
  
  res.json({ success: true, pedido_id: result.lastID, codigo_retirada: tipo_entrega === 'retirada' ? codigo : null, total_final, valor_motoboy, valor_plataforma });
});

// Cliente confirma o pedido (vê o valor e decide)
app.put('/api/pedidos/:id/confirmar', authCliente, async (req, res) => {
  const pedido = await dbGet('SELECT * FROM pedidos WHERE id = ?', [req.params.id]);
  if (!pedido) return res.status(404).json({ error: 'Pedido não encontrado' });
  if (pedido.cliente_id != req.usuario.id) return res.status(403).json({ error: 'Esse pedido não é seu' });
  if (pedido.status !== 'aguardando') return res.status(400).json({ error: 'Pedido já foi processado' });
  
  const { confirmou } = req.body;
  if (confirmou) {
    await dbRun("UPDATE pedidos SET cliente_confirmou = 1, status = 'confirmado', data_confirmacao = datetime('now', '-3 hours') WHERE id = ?", [req.params.id]);
    res.json({ success: true, message: 'Pedido confirmado com sucesso! Vai para a loja.' });
  } else {
    await dbRun("UPDATE pedidos SET status = 'cancelado' WHERE id = ?", [req.params.id]);
    res.json({ success: true, message: 'Pedido cancelado.' });
  }
});

// Lojas veem pedidos
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

// LOJA: Separar pedido (coloca quem separou e finaliza)
app.put('/api/pedidos/:id/separar', authLojas, async (req, res) => {
  const pedido = await dbGet('SELECT * FROM pedidos WHERE id = ?', [req.params.id]);
  if (!pedido) return res.status(404).json({ error: 'Pedido não encontrado' });
  if (pedido.loja_id != req.usuario.id) return res.status(403).json({ error: 'Esse pedido não é da sua loja' });
  if (pedido.status !== 'confirmado') return res.status(400).json({ error: 'Pedido precisa estar confirmado' });
  
  const { separado_por } = req.body;
  if (!separado_por) return res.status(400).json({ error: 'Informe quem separou o pedido' });
  
  await dbRun("UPDATE pedidos SET status = 'separado', separado_por = ?, data_separado = datetime('now', '-3 hours') WHERE id = ?", [separado_por, req.params.id]);
  res.json({ success: true, message: 'Pedido separado e disponível para entrega!' });
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
    WHERE p.status = 'separado' AND p.tipo_entrega = 'entrega' AND p.entregador_id IS NULL 
    ORDER BY p.data_pedido ASC`);
  res.json({ pedidos });
});

// ENTREGADOR: Aceitar pedido
app.put('/api/pedidos/:id/aceitar', authEntregador, async (req, res) => {
  const pedido = await dbGet('SELECT * FROM pedidos WHERE id = ?', [req.params.id]);
  if (!pedido) return res.status(404).json({ error: 'Pedido não encontrado' });
  if (pedido.status !== 'separado') return res.status(400).json({ error: 'Pedido não está disponível' });
  if (pedido.entregador_id) return res.status(400).json({ error: 'Outro entregador já pegou esse pedido' });
  
  await dbRun('UPDATE pedidos SET entregador_id = ?, status = ? WHERE id = ?', 
    [req.usuario.id, 'em_coleta', req.params.id]);
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
  
  await dbRun("UPDATE pedidos SET foto_coleta = ?, data_coleta = datetime('now', '-3 hours'), status = 'saiu_entrega' WHERE id = ?", [foto, req.params.id]);
  res.json({ success: true, message: 'Foto da coleta registrada! Vá entregar.' });
});

// ENTREGADOR: Finalizar entrega (foto + crédito automático)
app.put('/api/pedidos/:id/finalizar', authEntregador, async (req, res) => {
  const pedido = await dbGet('SELECT * FROM pedidos WHERE id = ?', [req.params.id]);
  if (!pedido) return res.status(404).json({ error: 'Pedido não encontrado' });
  if (pedido.entregador_id != req.usuario.id) return res.status(403).json({ error: 'Permissão negada' });
  if (pedido.status !== 'saiu_entrega') return res.status(400).json({ error: 'Pedido não está em entrega' });
  
  const { foto } = req.body;
  if (!foto) return res.status(400).json({ error: 'Tire a foto da entrega para finalizar' });
  
  // Finalizar pedido
  await dbRun("UPDATE pedidos SET foto_entrega = ?, status = 'entregue', data_entrega = datetime('now', '-3 hours') WHERE id = ?", [foto, req.params.id]);
  
  // CRÉDITO AUTOMÁTICO: motoboy recebe a parte dele
  const valor_motoboy = pedido.valor_motoboy || 0;
  const valor_plataforma = pedido.valor_plataforma || 0;
  
  // Garantir que existe registro de saldo
  await dbRun('INSERT OR IGNORE INTO saldo_entregadores (entregador_id, saldo) VALUES (?, 0)', [req.usuario.id]);
  
  // Creditar pro motoboy
  await dbRun('UPDATE saldo_entregadores SET saldo = saldo + ?, total_ganho = total_ganho + ? WHERE entregador_id = ?', 
    [valor_motoboy, valor_motoboy, req.usuario.id]);
  
  // Creditar pra plataforma (Adalto)
  await dbRun('INSERT INTO saldo_plataforma (descricao, valor, tipo, pedido_id) VALUES (?, ?, ?, ?)', 
    [`Comissão entrega #${pedido.id}`, valor_plataforma, 'credito', pedido.id]);
  
  // Atualizar entregas do motoboy
  await dbRun('UPDATE entregadores SET total_entregas = total_entregas + 1, disponivel = 1 WHERE id = ?', [req.usuario.id]);
  
  res.json({ 
    success: true, 
    message: '✅ Entrega finalizada!',
    creditado: valor_motoboy,
    valor_plataforma: valor_plataforma
  });
});

// Admin: atualizar status manualmente
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
  const categorias = await dbAll('SELECT * FROM categorias ORDER BY ordem');
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
  if (email === 'admin@obraexpress.com' && senha === 'admin123') {
    const token = jwt.sign({ id: 0, tipo: 'admin' }, JWT_SECRET);
    return res.json({ success: true, token });
  }
  res.status(401).json({ error: 'Credenciais de admin inválidas' });
});

app.get('/api/admin/dashboard', authAdmin, async (req, res) => {
  const totalLojas = await dbGet('SELECT COUNT(*) as total FROM lojas');
  const totalEntregadores = await dbGet('SELECT COUNT(*) as total FROM entregadores');
  const totalClientes = await dbGet('SELECT COUNT(*) as total FROM clientes');
  const pedidosHoje = await dbGet("SELECT COUNT(*) as total FROM pedidos WHERE date(data_pedido) = date('now', '-3 hours')");
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
  const totalPlataforma = await dbGet('SELECT COALESCE(SUM(valor), 0) as total FROM saldo_plataforma WHERE tipo = ?', ['credito']);
  res.json({ saldoPlataforma, saldoEntregadores, totalPlataforma: totalPlataforma?.total || 0 });
});

// ============ SERVE FRONTEND ============
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 ObraExpress rodando na porta ${PORT}`);
});
