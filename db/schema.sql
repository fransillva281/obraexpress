CREATE TABLE IF NOT EXISTS lojas (
  id SERIAL PRIMARY KEY,
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
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  descricao TEXT,
  categorias TEXT,
  taxa_entrega_km DOUBLE PRECISION DEFAULT 2.00,
  entrega_gratis_ate DOUBLE PRECISION DEFAULT 0,
  tempo_entrega_min TEXT DEFAULT '30-60 min',
  aberto INTEGER DEFAULT 1,
  plano TEXT DEFAULT 'comissao',
  data_cadastro TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS produtos (
  id SERIAL PRIMARY KEY,
  loja_id INTEGER NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  descricao TEXT,
  preco DOUBLE PRECISION NOT NULL,
  foto TEXT,
  categoria TEXT,
  marca TEXT,
  unidade TEXT DEFAULT 'un',
  estoque INTEGER DEFAULT 999,
  destaque INTEGER DEFAULT 0,
  ativo INTEGER DEFAULT 1,
  data_cadastro TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS clientes (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  senha TEXT NOT NULL,
  telefone TEXT,
  endereco_padrao TEXT,
  bairro TEXT,
  cidade TEXT DEFAULT 'São Luís',
  estado TEXT DEFAULT 'MA',
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  data_cadastro TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS entregadores (
  id SERIAL PRIMARY KEY,
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
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  avaliacao DOUBLE PRECISION DEFAULT 5.0,
  total_entregas INTEGER DEFAULT 0,
  data_cadastro TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pedidos (
  id SERIAL PRIMARY KEY,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  loja_id INTEGER NOT NULL REFERENCES lojas(id),
  entregador_id INTEGER REFERENCES entregadores(id),
  itens TEXT NOT NULL,
  total_produtos DOUBLE PRECISION NOT NULL DEFAULT 0,
  taxa_entrega DOUBLE PRECISION DEFAULT 0,
  total_final DOUBLE PRECISION NOT NULL DEFAULT 0,
  tipo_entrega TEXT DEFAULT 'entrega',
  endereco_entrega TEXT,
  bairro_entrega TEXT,
  latitude_entrega DOUBLE PRECISION,
  longitude_entrega DOUBLE PRECISION,
  distancia_km DOUBLE PRECISION DEFAULT 0,
  forma_pagamento TEXT DEFAULT 'pix',
  observacao TEXT,
  status TEXT DEFAULT 'aguardando',
  codigo_retirada TEXT,
  data_pedido TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  data_confirmacao TIMESTAMPTZ,
  data_entrega TIMESTAMPTZ,
  separado_por TEXT,
  foto_coleta TEXT,
  foto_entrega TEXT,
  cliente_confirmou INTEGER DEFAULT 0,
  valor_motoboy DOUBLE PRECISION DEFAULT 0,
  valor_plataforma DOUBLE PRECISION DEFAULT 0,
  pix_pago INTEGER DEFAULT 0,
  data_separado TIMESTAMPTZ,
  data_coleta TIMESTAMPTZ,
  data_saida TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS saldo_entregadores (
  id SERIAL PRIMARY KEY,
  entregador_id INTEGER UNIQUE NOT NULL REFERENCES entregadores(id) ON DELETE CASCADE,
  saldo DOUBLE PRECISION DEFAULT 0,
  total_ganho DOUBLE PRECISION DEFAULT 0,
  total_sacado DOUBLE PRECISION DEFAULT 0
);

CREATE TABLE IF NOT EXISTS saldo_plataforma (
  id SERIAL PRIMARY KEY,
  descricao TEXT,
  valor DOUBLE PRECISION NOT NULL,
  tipo TEXT DEFAULT 'credito',
  pedido_id INTEGER,
  data TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS avaliacoes (
  id SERIAL PRIMARY KEY,
  pedido_id INTEGER NOT NULL REFERENCES pedidos(id),
  cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  loja_id INTEGER,
  entregador_id INTEGER,
  nota INTEGER NOT NULL CHECK(nota >= 1 AND nota <= 5),
  comentario TEXT,
  data TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS categorias (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  icone TEXT,
  ordem INTEGER DEFAULT 0
);

ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS separado_por TEXT;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS foto_coleta TEXT;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS foto_entrega TEXT;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS cliente_confirmou INTEGER DEFAULT 0;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS valor_motoboy DOUBLE PRECISION DEFAULT 0;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS valor_plataforma DOUBLE PRECISION DEFAULT 0;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS pix_pago INTEGER DEFAULT 0;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS data_separado TIMESTAMPTZ;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS data_coleta TIMESTAMPTZ;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS data_saida TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_produtos_loja ON produtos(loja_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_cliente_data ON pedidos(cliente_id, data_pedido DESC);
CREATE INDEX IF NOT EXISTS idx_pedidos_loja_data ON pedidos(loja_id, data_pedido DESC);
CREATE INDEX IF NOT EXISTS idx_pedidos_entregador ON pedidos(entregador_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_status ON pedidos(status);

INSERT INTO categorias (nome, icone, ordem)
SELECT categoria.nome, categoria.icone, categoria.ordem
FROM (VALUES
  ('Hidráulica', '🔧', 1),
  ('Elétrica', '⚡', 2),
  ('Conexões', '🔩', 3),
  ('Ferragens', '🔨', 4),
  ('Acabamento', '🏠', 5),
  ('Pisos e Revestimentos', '🧱', 6),
  ('Tintas', '🎨', 7),
  ('Ferramentas', '🛠️', 8),
  ('Segurança', '🪖', 9)
) AS categoria(nome, icone, ordem)
WHERE NOT EXISTS (SELECT 1 FROM categorias);
