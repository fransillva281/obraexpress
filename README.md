# ObraMobi

Marketplace em desenvolvimento para produtos leves de construção, com painéis de cliente, loja, entregador e administração. O projeto se chamava ObraExpress e adotou a marca pública ObraMobi em agosto de 2026.

Domínio adquirido: `obramobi.com.br`. O DNS ainda será configurado; durante essa etapa, os links de teste do Render continuam válidos.

> **Situação atual:** versão de pré-produção para testes. O Pix é uma simulação e não movimenta dinheiro. Não cadastre documentos reais nem use a plataforma com clientes reais antes de concluir o checklist de lançamento.

## Painéis de teste

- Cliente: <https://obraexpress-1.onrender.com/>
- Loja: <https://obraexpress-1.onrender.com/loja/>
- Entregador: <https://obraexpress-1.onrender.com/entregador/>
- Administração: <https://obraexpress-1.onrender.com/admin/>

## O que já funciona

- PostgreSQL sem fallback para SQLite;
- cadastros, aprovação e suspensão de contas;
- catálogo, estoque, carrinho e pedidos;
- cálculo de frete e rotas por localização;
- oferta de entregas e acompanhamento;
- financeiro interno de teste;
- Pix demonstrativo com QR Code e código para copiar;
- termos, privacidade e solicitações dos titulares;
- recuperação de senha preparada para a Resend;
- testes unitários, teste real de migração PostgreSQL e análise automática no GitHub.

## Executar localmente

1. Instale Node.js 20 e PostgreSQL.
2. Copie `.env.example` para `.env` e preencha somente no seu computador.
3. Execute `npm ci`.
4. Execute `npm test`.
5. Execute `npm start`.

O servidor exige `DATABASE_URL`, `JWT_SECRET`, `ADMIN_EMAIL` e `ADMIN_PASSWORD`. Nenhuma senha ou chave deve ser colocada no GitHub.

## Segurança da pré-produção

Esta versão aceita apenas:

- `APP_STAGE=test` ou `APP_STAGE=sandbox`;
- `PAYMENT_MODE=mock`.

Se alguém tentar ligar pagamento real somente alterando uma variável, o servidor é bloqueado. A ativação real exigirá outra versão revisada, conta empresarial homologada, webhook seguro e testes do Asaas.

Consulte [CHECKLIST_LANCAMENTO.md](CHECKLIST_LANCAMENTO.md), [PREPRODUCAO_V12.md](PREPRODUCAO_V12.md) e [PREPRODUCAO_V13.md](PREPRODUCAO_V13.md).
