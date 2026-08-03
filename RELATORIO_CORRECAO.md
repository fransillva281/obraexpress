# Correção da persistência do ObraExpress

## Causa encontrada

O servidor escolhia o banco com esta lógica: se `DATABASE_URL` estivesse
disponível, usava PostgreSQL; caso contrário, criava `obraexpress.db` em SQLite.
Como o filesystem do Web Service é temporário, esse fallback permitia cadastrar
normalmente e perder tudo no deploy seguinte.

Além disso, algumas rotas ainda usavam funções SQL do SQLite, como
`datetime('now', '-3 hours')` e `INSERT OR IGNORE`.

## Correções aplicadas

- PostgreSQL agora é obrigatório; não existe fallback silencioso para SQLite.
- A dependência `sqlite3` foi removida.
- A conexão foi centralizada em `database.js`.
- A estrutura e as migrações ficam em `db/schema.sql`.
- A inicialização usa comandos idempotentes e não apaga registros existentes.
- As datas agora usam `CURRENT_TIMESTAMP` do PostgreSQL.
- Foi criado `GET /api/health` para confirmar a conexão ativa.
- Erros de e-mail/CPF duplicado agora usam o código oficial `23505` do PostgreSQL.
- A chave JWT e as credenciais administrativas foram removidas do código e
  passaram a vir de variáveis de ambiente.
- Tokens de cliente, loja e entregador expiram em 7 dias; o token administrativo
  expira em 8 horas.
- A atualização de status foi limitada à loja responsável ou ao administrador.
- Dependências não utilizadas foram removidas e foi criado `package-lock.json`.

## Validações executadas

- verificação de sintaxe dos arquivos JavaScript;
- instalação limpa com `npm ci`;
- 3 testes automatizados aprovados;
- schema validado com as 9 tabelas esperadas;
- auditoria das dependências: 0 vulnerabilidades conhecidas;
- busca final sem referências a SQLite ou às antigas credenciais administrativas.

## Antes do deploy

Configure no Web Service do Render:

- `DATABASE_URL`
- `JWT_SECRET`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`

Depois siga `DEPLOY_RENDER.md` e confirme o endpoint `/api/health`.

## Limitação da validação local

O código e o schema foram testados localmente, mas a conexão com o banco real do
Render só pode ser confirmada depois do deploy, porque a credencial do banco não
foi e não deve ser incluída no projeto.
