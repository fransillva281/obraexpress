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
  plano TEXT DEFAULT 'entrega_obraexpress',
  comissao_percentual NUMERIC(5,2) DEFAULT 5.00,
  inicio_promocao TIMESTAMPTZ,
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
  comissao_percentual NUMERIC(5,2) DEFAULT 5.00,
  inicio_promocao TIMESTAMPTZ,
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
  taxa_pedido_pequeno NUMERIC(12,2) DEFAULT 0,
  pedido_minimo_aplicado NUMERIC(12,2) DEFAULT 15.00,
  limite_pedido_pequeno_aplicado NUMERIC(12,2) DEFAULT 25.00,
  total_final DOUBLE PRECISION NOT NULL DEFAULT 0,
  tipo_entrega TEXT DEFAULT 'entrega',
  endereco_entrega TEXT,
  bairro_entrega TEXT,
  latitude_entrega DOUBLE PRECISION,
  longitude_entrega DOUBLE PRECISION,
  distancia_km DOUBLE PRECISION DEFAULT 0,
  distancia_coleta_km DOUBLE PRECISION DEFAULT 0,
  distancia_total_entrega_km DOUBLE PRECISION DEFAULT 0,
  forma_pagamento TEXT DEFAULT 'pix',
  observacao TEXT,
  status TEXT DEFAULT 'aguardando_confirmacao',
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
  plano_loja TEXT DEFAULT 'entrega_obraexpress',
  comissao_loja_percentual NUMERIC(5,2) DEFAULT 5.00,
  comissao_entrega_percentual NUMERIC(5,2) DEFAULT 5.00,
  taxa_base_entrega NUMERIC(12,2) DEFAULT 0,
  adicional_clima_percentual NUMERIC(5,2) DEFAULT 0,
  adicional_pico_percentual NUMERIC(5,2) DEFAULT 0,
  valor_comissao_loja NUMERIC(12,2) DEFAULT 0,
  valor_liquido_loja NUMERIC(12,2) DEFAULT 0,
  repasse_processado INTEGER DEFAULT 0,
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

CREATE TABLE IF NOT EXISTS saldo_lojas (
  id SERIAL PRIMARY KEY,
  loja_id INTEGER UNIQUE NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
  saldo NUMERIC(12,2) DEFAULT 0,
  total_recebido NUMERIC(12,2) DEFAULT 0,
  total_sacado NUMERIC(12,2) DEFAULT 0
);

CREATE TABLE IF NOT EXISTS movimentacoes_lojas (
  id SERIAL PRIMARY KEY,
  loja_id INTEGER NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
  pedido_id INTEGER UNIQUE REFERENCES pedidos(id) ON DELETE CASCADE,
  descricao TEXT NOT NULL,
  valor_bruto NUMERIC(12,2) DEFAULT 0,
  valor_comissao NUMERIC(12,2) DEFAULT 0,
  valor_liquido NUMERIC(12,2) DEFAULT 0,
  tipo TEXT DEFAULT 'credito',
  data TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
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

-- Registro auditável do aceite. O IP não é guardado em texto: somente um hash
-- protegido, suficiente para reduzir fraude sem expor o endereço original.
CREATE TABLE IF NOT EXISTS aceites_termos (
  id SERIAL PRIMARY KEY,
  tipo_usuario TEXT NOT NULL CHECK (tipo_usuario IN ('cliente', 'loja', 'entregador')),
  usuario_id INTEGER NOT NULL,
  versao_termos TEXT NOT NULL,
  versao_privacidade TEXT NOT NULL,
  aceito_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ip_hash TEXT,
  user_agent TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS aceite_termos_unico
  ON aceites_termos (tipo_usuario, usuario_id, versao_termos, versao_privacidade);
CREATE INDEX IF NOT EXISTS idx_aceites_usuario
  ON aceites_termos (tipo_usuario, usuario_id, aceito_em DESC);

CREATE TABLE IF NOT EXISTS categorias (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  icone TEXT,
  ordem INTEGER DEFAULT 0,
  ativa INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS configuracoes_plataforma (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  frete_base NUMERIC(12,2) NOT NULL DEFAULT 4.00,
  valor_km NUMERIC(12,2) NOT NULL DEFAULT 1.50,
  frete_faixa_ate_2 NUMERIC(12,2) NOT NULL DEFAULT 5.99,
  frete_faixa_ate_4 NUMERIC(12,2) NOT NULL DEFAULT 7.99,
  frete_faixa_ate_6 NUMERIC(12,2) NOT NULL DEFAULT 10.99,
  frete_faixa_ate_8 NUMERIC(12,2) NOT NULL DEFAULT 13.99,
  distancia_maxima_entrega NUMERIC(6,2) NOT NULL DEFAULT 8.00,
  ganho_minimo_entregador NUMERIC(12,2) NOT NULL DEFAULT 7.50,
  ganho_km_entregador NUMERIC(12,2) NOT NULL DEFAULT 1.50,
  limite_bonus_entregador_percentual NUMERIC(5,2) NOT NULL DEFAULT 15.00,
  raio_preferencial_coleta NUMERIC(6,2) NOT NULL DEFAULT 3.00,
  raio_maximo_coleta NUMERIC(6,2) NOT NULL DEFAULT 5.00,
  fator_rota NUMERIC(5,2) NOT NULL DEFAULT 1.20,
  adicional_chuva_percentual NUMERIC(5,2) NOT NULL DEFAULT 10.00,
  adicional_pico_percentual NUMERIC(5,2) NOT NULL DEFAULT 5.00,
  limite_adicionais_percentual NUMERIC(5,2) NOT NULL DEFAULT 10.00,
  condicao_climatica TEXT NOT NULL DEFAULT 'normal',
  entregas_ativas INTEGER NOT NULL DEFAULT 1,
  pedido_minimo NUMERIC(12,2) NOT NULL DEFAULT 15.00,
  limite_pedido_pequeno NUMERIC(12,2) NOT NULL DEFAULT 25.00,
  taxa_pedido_pequeno NUMERIC(12,2) NOT NULL DEFAULT 1.99,
  atualizado_em TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO configuracoes_plataforma (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE categorias ADD COLUMN IF NOT EXISTS ativa INTEGER DEFAULT 1;

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
ALTER TABLE lojas ADD COLUMN IF NOT EXISTS comissao_percentual NUMERIC(5,2) DEFAULT 5.00;
ALTER TABLE lojas ADD COLUMN IF NOT EXISTS inicio_promocao TIMESTAMPTZ;
ALTER TABLE entregadores ADD COLUMN IF NOT EXISTS comissao_percentual NUMERIC(5,2) DEFAULT 5.00;
ALTER TABLE entregadores ADD COLUMN IF NOT EXISTS inicio_promocao TIMESTAMPTZ;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS plano_loja TEXT DEFAULT 'entrega_obraexpress';
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS comissao_loja_percentual NUMERIC(5,2) DEFAULT 5.00;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS comissao_entrega_percentual NUMERIC(5,2) DEFAULT 5.00;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS taxa_base_entrega NUMERIC(12,2) DEFAULT 0;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS adicional_clima_percentual NUMERIC(5,2) DEFAULT 0;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS adicional_pico_percentual NUMERIC(5,2) DEFAULT 0;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS valor_comissao_loja NUMERIC(12,2) DEFAULT 0;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS valor_liquido_loja NUMERIC(12,2) DEFAULT 0;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS repasse_processado INTEGER DEFAULT 0;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS taxa_pedido_pequeno NUMERIC(12,2) DEFAULT 0;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS distancia_coleta_km DOUBLE PRECISION DEFAULT 0;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS distancia_total_entrega_km DOUBLE PRECISION DEFAULT 0;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS pedido_minimo_aplicado NUMERIC(12,2) DEFAULT 15.00;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS limite_pedido_pequeno_aplicado NUMERIC(12,2) DEFAULT 25.00;
ALTER TABLE pedidos ALTER COLUMN status SET DEFAULT 'aguardando_confirmacao';

ALTER TABLE configuracoes_plataforma ADD COLUMN IF NOT EXISTS pedido_minimo NUMERIC(12,2) NOT NULL DEFAULT 15.00;
ALTER TABLE configuracoes_plataforma ADD COLUMN IF NOT EXISTS limite_pedido_pequeno NUMERIC(12,2) NOT NULL DEFAULT 25.00;
ALTER TABLE configuracoes_plataforma ADD COLUMN IF NOT EXISTS taxa_pedido_pequeno NUMERIC(12,2) NOT NULL DEFAULT 1.99;
ALTER TABLE configuracoes_plataforma ADD COLUMN IF NOT EXISTS frete_faixa_ate_2 NUMERIC(12,2) NOT NULL DEFAULT 5.99;
ALTER TABLE configuracoes_plataforma ADD COLUMN IF NOT EXISTS frete_faixa_ate_4 NUMERIC(12,2) NOT NULL DEFAULT 7.99;
ALTER TABLE configuracoes_plataforma ADD COLUMN IF NOT EXISTS frete_faixa_ate_6 NUMERIC(12,2) NOT NULL DEFAULT 10.99;
ALTER TABLE configuracoes_plataforma ADD COLUMN IF NOT EXISTS frete_faixa_ate_8 NUMERIC(12,2) NOT NULL DEFAULT 13.99;
ALTER TABLE configuracoes_plataforma ADD COLUMN IF NOT EXISTS distancia_maxima_entrega NUMERIC(6,2) NOT NULL DEFAULT 8.00;
ALTER TABLE configuracoes_plataforma ADD COLUMN IF NOT EXISTS ganho_minimo_entregador NUMERIC(12,2) NOT NULL DEFAULT 7.50;
ALTER TABLE configuracoes_plataforma ADD COLUMN IF NOT EXISTS ganho_km_entregador NUMERIC(12,2) NOT NULL DEFAULT 1.50;
ALTER TABLE configuracoes_plataforma ADD COLUMN IF NOT EXISTS limite_bonus_entregador_percentual NUMERIC(5,2) NOT NULL DEFAULT 15.00;
ALTER TABLE configuracoes_plataforma ADD COLUMN IF NOT EXISTS raio_preferencial_coleta NUMERIC(6,2) NOT NULL DEFAULT 3.00;
ALTER TABLE configuracoes_plataforma ADD COLUMN IF NOT EXISTS raio_maximo_coleta NUMERIC(6,2) NOT NULL DEFAULT 5.00;

UPDATE configuracoes_plataforma
SET limite_adicionais_percentual = 10.00, atualizado_em = CURRENT_TIMESTAMP
WHERE id = 1 AND limite_adicionais_percentual = 15.00;

-- A instalação antiga usava um frete mais alto. Apenas a configuração padrão
-- antiga é migrada; ajustes personalizados feitos pelo administrador são preservados.
UPDATE configuracoes_plataforma
SET frete_base = 4.00,
    valor_km = 1.50,
    adicional_chuva_percentual = 10.00,
    adicional_pico_percentual = 5.00,
    limite_adicionais_percentual = 10.00,
    atualizado_em = CURRENT_TIMESTAMP
WHERE id = 1
  AND frete_base = 5.00
  AND valor_km = 2.00
  AND adicional_chuva_percentual = 15.00
  AND adicional_pico_percentual = 10.00
  AND limite_adicionais_percentual = 25.00;

ALTER TABLE lojas ALTER COLUMN plano SET DEFAULT 'entrega_obraexpress';
UPDATE lojas SET plano = 'entrega_obraexpress' WHERE plano IS NULL OR plano NOT IN ('loja', 'entrega_obraexpress');
ALTER TABLE lojas ALTER COLUMN comissao_percentual SET DEFAULT 5.00;
ALTER TABLE entregadores ALTER COLUMN comissao_percentual SET DEFAULT 5.00;
ALTER TABLE pedidos ALTER COLUMN comissao_loja_percentual SET DEFAULT 5.00;
ALTER TABLE pedidos ALTER COLUMN comissao_entrega_percentual SET DEFAULT 5.00;
UPDATE lojas SET comissao_percentual = CASE
  WHEN inicio_promocao IS NULL OR inicio_promocao + INTERVAL '5 months' > CURRENT_TIMESTAMP THEN 5.00
  ELSE 7.00 END;
UPDATE entregadores SET comissao_percentual = CASE
  WHEN inicio_promocao IS NULL OR inicio_promocao + INTERVAL '5 months' > CURRENT_TIMESTAMP THEN 5.00
  ELSE 7.00 END;

-- Pedidos ainda não concluídos recebem a regra promocional vigente.
UPDATE pedidos
SET plano_loja = COALESCE((SELECT l.plano FROM lojas l WHERE l.id = pedidos.loja_id), 'entrega_obraexpress'),
    comissao_loja_percentual = COALESCE((SELECT l.comissao_percentual FROM lojas l WHERE l.id = pedidos.loja_id), 5.00),
    comissao_entrega_percentual = COALESCE((SELECT e.comissao_percentual FROM entregadores e WHERE e.id = pedidos.entregador_id), 5.00),
    valor_comissao_loja = ROUND(total_produtos::numeric * COALESCE((SELECT l.comissao_percentual FROM lojas l WHERE l.id = pedidos.loja_id), 5.00) / 100, 2),
    valor_liquido_loja = ROUND(
      total_produtos::numeric * (100 - COALESCE((SELECT l.comissao_percentual FROM lojas l WHERE l.id = pedidos.loja_id), 5.00)) / 100
      + CASE WHEN tipo_entrega = 'entrega' AND (SELECT l.plano FROM lojas l WHERE l.id = pedidos.loja_id) = 'loja'
        THEN taxa_entrega::numeric ELSE 0 END, 2),
    valor_motoboy = CASE WHEN tipo_entrega = 'entrega' AND COALESCE((SELECT l.plano FROM lojas l WHERE l.id = pedidos.loja_id), 'entrega_obraexpress') = 'entrega_obraexpress'
      THEN ROUND(taxa_entrega::numeric * (100 - COALESCE((SELECT e.comissao_percentual FROM entregadores e WHERE e.id = pedidos.entregador_id), 5.00)) / 100, 2)
      ELSE 0 END,
    valor_plataforma = CASE WHEN tipo_entrega = 'entrega' AND COALESCE((SELECT l.plano FROM lojas l WHERE l.id = pedidos.loja_id), 'entrega_obraexpress') = 'entrega_obraexpress'
      THEN ROUND(taxa_entrega::numeric * COALESCE((SELECT e.comissao_percentual FROM entregadores e WHERE e.id = pedidos.entregador_id), 5.00) / 100, 2)
      ELSE 0 END
WHERE status <> 'entregue' AND status <> 'cancelado'
  AND COALESCE(repasse_processado, 0) = 0
  AND (comissao_loja_percentual IS NULL OR comissao_loja_percentual >= 10.00);

CREATE INDEX IF NOT EXISTS idx_produtos_loja ON produtos(loja_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_cliente_data ON pedidos(cliente_id, data_pedido DESC);
CREATE INDEX IF NOT EXISTS idx_pedidos_loja_data ON pedidos(loja_id, data_pedido DESC);
CREATE INDEX IF NOT EXISTS idx_pedidos_entregador ON pedidos(entregador_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_status ON pedidos(status);
CREATE INDEX IF NOT EXISTS idx_produtos_categoria_preco ON produtos(categoria, preco);
CREATE INDEX IF NOT EXISTS idx_movimentacoes_loja_data ON movimentacoes_lojas(loja_id, data DESC);

-- Remove categorias repetidas que possam ter sido criadas pela versão antiga.
DELETE FROM categorias repetida
USING categorias original
WHERE repetida.id > original.id
  AND LOWER(TRIM(repetida.nome)) = LOWER(TRIM(original.nome));

CREATE UNIQUE INDEX IF NOT EXISTS categorias_nome_unico
  ON categorias (LOWER(TRIM(nome)));

-- O catálogo inicial aceita somente itens leves, adequados para entrega de moto.
-- As categorias antigas não são apagadas: ficam inativas para uma futura
-- modalidade de entrega com carro, utilitário ou caminhão.
UPDATE categorias SET ativa = 0;

WITH catalogo(nome, icone, ordem) AS (VALUES
  ('Hidráulica', '🔧', 1),
  ('Elétrica', '⚡', 2),
  ('Conexões Hidráulicas', '🔩', 3),
  ('Parafusos, Porcas e Arruelas', '🔩', 4),
  ('Buchas, Chumbadores e Fixadores', '🧰', 5),
  ('Fechaduras, Dobradiças e Travas', '🔐', 6),
  ('Brocas, Discos e Lixas', '⚙️', 7),
  ('Acessórios de Pintura', '🖌️', 8),
  ('Tintas', '🎨', 9),
  ('Ferramentas', '🛠️', 10),
  ('Segurança e EPI', '🪖', 11),
  ('Iluminação', '💡', 12),
  ('Banheiro e Cozinha', '🚿', 13),
  ('Jardinagem', '🌱', 14),
  ('Mantas e Impermeabilização', '💧', 15),
  ('Colas, Selantes e Vedação', '🧴', 16),
  ('Medição e Marcação', '📏', 17),
  ('Acabamento e Reparos', '🏡', 18),
  ('Limpeza Pós-Obra', '🧹', 19)
)
UPDATE categorias
SET icone = catalogo.icone, ordem = catalogo.ordem, ativa = 1
FROM catalogo
WHERE LOWER(TRIM(categorias.nome)) = LOWER(TRIM(catalogo.nome));

INSERT INTO categorias (nome, icone, ordem) VALUES
  ('Hidráulica', '🔧', 1),
  ('Elétrica', '⚡', 2),
  ('Conexões Hidráulicas', '🔩', 3),
  ('Parafusos, Porcas e Arruelas', '🔩', 4),
  ('Buchas, Chumbadores e Fixadores', '🧰', 5),
  ('Fechaduras, Dobradiças e Travas', '🔐', 6),
  ('Brocas, Discos e Lixas', '⚙️', 7),
  ('Acessórios de Pintura', '🖌️', 8),
  ('Tintas', '🎨', 9),
  ('Ferramentas', '🛠️', 10),
  ('Segurança e EPI', '🪖', 11),
  ('Iluminação', '💡', 12),
  ('Banheiro e Cozinha', '🚿', 13),
  ('Jardinagem', '🌱', 14),
  ('Mantas e Impermeabilização', '💧', 15),
  ('Colas, Selantes e Vedação', '🧴', 16),
  ('Medição e Marcação', '📏', 17),
  ('Acabamento e Reparos', '🏡', 18),
  ('Limpeza Pós-Obra', '🧹', 19)
ON CONFLICT DO NOTHING;

UPDATE categorias SET ativa = 1
WHERE LOWER(TRIM(nome)) IN (
  'hidráulica', 'elétrica', 'conexões hidráulicas',
  'parafusos, porcas e arruelas', 'buchas, chumbadores e fixadores',
  'fechaduras, dobradiças e travas', 'brocas, discos e lixas',
  'acessórios de pintura', 'tintas', 'ferramentas', 'segurança e epi',
  'iluminação', 'banheiro e cozinha', 'jardinagem',
  'mantas e impermeabilização', 'colas, selantes e vedação',
  'medição e marcação', 'acabamento e reparos', 'limpeza pós-obra'
);
