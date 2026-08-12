# Passo a passo simples — ObraExpress v11.5

## Parte 1 — enviar ao GitHub

1. Entre no repositório do ObraExpress no GitHub.
2. Clique em **Adicionar arquivo → Fazer upload de arquivos**.
3. Descompacte o ZIP no computador.
4. Abra a pasta descompactada.
5. Selecione tudo o que está **dentro** dela.
6. Arraste os arquivos e pastas para a página do GitHub.
7. Confira se aparecem caminhos como `/admin/index.html`, `/frontend/index.html`,
   `/loja/index.html`, `/entregador/index.html` e `server.js`.
8. Na primeira linha de **Alterações de commit**, escreva:

   `Implementa recuperação segura de senha por email`

9. Marque **Comprometer-se diretamente com o ramo principal**.
10. Clique no botão verde **Alterações de commit**.

## Parte 2 — acompanhar o Render

1. Abra o Web Service `obraexpress-1` no Render.
2. Entre em **Logs**.
3. Aguarde aparecer:

   `✅ PostgreSQL conectado; tabelas e migrações verificadas`

   `🚀 ObraExpress rodando na porta 10000`

4. Se o deploy automático não começar, use **Manual Deploy → Deploy latest commit**.

## Parte 3 — conferir a nova função

1. Abra o painel do cliente, da loja ou do entregador.
2. Saia da conta, caso esteja conectado.
3. Na tela de entrada, confirme que aparece **🔑 Esqueci minha senha**.
4. Abra **Administração → Operação**.
5. Em **Saúde dos serviços**, confirme:
   - PostgreSQL conectado;
   - recuperação de senha aguardando configuração ou ativa.

## Parte 4 — ativar o envio de e-mail depois

Quando houver um domínio verificado no provedor de e-mail:

1. No Render, abra `obraexpress-1`.
2. Entre em **Environment**.
3. Clique em **Edit**.
4. Adicione `RESEND_API_KEY` e coloque a chave secreta no campo de valor.
5. Adicione `EMAIL_FROM` e coloque o remetente do domínio verificado.
6. Salve iniciando um novo deploy.

Não coloque a chave no GitHub. Não mostre a chave em imagens ou mensagens.
