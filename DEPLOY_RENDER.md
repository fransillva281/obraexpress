# Publicação segura no Render

Esta versão do ObraExpress usa **somente PostgreSQL**. Ela não cria um arquivo
SQLite local. Se `DATABASE_URL` estiver ausente ou inválida, o servidor encerra
com uma mensagem clara para impedir gravações temporárias.

## 1. Conferir o PostgreSQL

1. No painel do Render, abra o banco PostgreSQL usado pelo ObraExpress.
2. Confirme que o banco e o Web Service estão na mesma região.
3. No menu **Connect**, copie a **Internal Database URL**.
4. Não publique nem envie essa URL para outras pessoas.

## 2. Configurar o Web Service

1. Abra o Web Service `obraexpress-1` no Render.
2. Entre em **Environment**.
3. Crie ou atualize a variável `DATABASE_URL` com a Internal Database URL.
4. Crie `JWT_SECRET` e use o botão **Generate** do Render para gerar o valor.
5. Crie `ADMIN_EMAIL` com o e-mail que poderá entrar no painel administrativo.
6. Crie `ADMIN_PASSWORD` com uma senha forte e exclusiva.
7. Preencha os dados públicos obrigatórios que aparecerão nos Termos:
   - `EMPRESA_NOME`: nome empresarial ou nome do responsável;
   - `EMPRESA_DOCUMENTO`: CNPJ ou documento aplicável;
   - `EMPRESA_ENDERECO`: endereço completo para atendimento;
   - `EMPRESA_EMAIL_SUPORTE`: contato do consumidor;
   - `EMPRESA_EMAIL_PRIVACIDADE`: contato para pedidos da LGPD.
8. Crie `PAYMENT_MODE` com o valor `mock`. Esse modo gera apenas uma simulação e não movimenta dinheiro.
9. Use `npm ci` como **Build Command**.
10. Use `npm start` como **Start Command**.
11. Salve escolhendo a opção que também inicia um novo deploy.

## 3. Confirmar nos logs

Depois do deploy, os logs devem mostrar as duas mensagens:

```text
✅ PostgreSQL conectado; tabelas e migrações verificadas
🚀 ObraExpress rodando na porta 10000
```

Se aparecer uma mensagem informando que uma variável não está configurada, ela
não foi vinculada ao Web Service correto. Os valores precisam estar no serviço
do site, não apenas na página do banco.

## 4. Testar a persistência

1. Abra `https://obraexpress-1.onrender.com/api/health`.
2. Confirme que a resposta contém `"database":"postgresql"` e
   `"connected":true`.
3. Cadastre um cliente de teste e confirme que consegue entrar.
4. No Render, faça **Manual Deploy → Deploy latest commit**.
5. Depois do deploy, tente entrar novamente com o mesmo cliente.

Se o login continuar funcionando, o cadastro permaneceu no PostgreSQL.

## Observações importantes

- A inicialização cria tabelas e colunas ausentes sem apagar registros existentes.
- Dados de um arquivo SQLite perdido em deploys anteriores não podem ser
  recuperados sem uma cópia desse arquivo.
- Não coloque a URL real do banco em `.env`, documentação ou commits do GitHub.
- Não inicie pagamentos reais enquanto a identificação empresarial estiver
  incompleta e os Termos não tiverem sido revisados por profissional jurídico.
- Não coloque chave de provedor financeiro no GitHub. A versão atual usa apenas
  `PAYMENT_MODE=mock`; o QR Code gerado é uma demonstração que não pode receber dinheiro.
- Para serviços no mesmo Render e na mesma região, prefira a Internal Database
  URL, conforme a documentação oficial do Render.

Documentação oficial:

- https://render.com/docs/postgresql-creating-connecting
- https://render.com/docs/multi-service-architecture
