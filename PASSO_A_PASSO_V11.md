# Passo a passo simples — atualização v11

## Antes de enviar

1. Baixe e extraia o ZIP no computador.
2. Abra a pasta `obraexpress-main` que está dentro dele.
3. No GitHub, entre no repositório `fransillva281/obraexpress`.
4. Clique em **Adicionar arquivo → Fazer upload de arquivos**.
5. Envie o conteúdo de dentro da pasta, mantendo as pastas `admin`, `db`, `entregador`, `frontend`, `loja` e `test`.
6. Não envie a pasta `node_modules` e não envie o ZIP para dentro do repositório.

## Confirmar no GitHub

Na primeira linha do commit, escreva:

`Implementa operação segura, estoque e aprovações`

Marque a opção de enviar diretamente para o ramo principal e confirme o commit.

## Conferir o Render

Antes do deploy, confira em **Environment**:

- `DATABASE_URL` continua preenchida.
- `JWT_SECRET`, `ADMIN_EMAIL` e `ADMIN_PASSWORD` continuam preenchidas.
- `PAYMENT_MODE` está exatamente como `mock`.
- `PUBLIC_URL` está como `https://obraexpress-1.onrender.com`.
- `CORS_ORIGINS` está como `https://obraexpress-1.onrender.com`.
- `TRUST_PROXY` está como `1`.

O Render normalmente inicia o deploy quando o commit termina. Nos logs, espere:

- `PostgreSQL conectado; tabelas e migrações verificadas`
- `ObraExpress rodando na porta 10000`
- `Your service is live`

## Primeiro teste depois do deploy

1. Crie uma loja de teste. Ela deve aparecer como **pendente**.
2. Crie um entregador de teste. Ele não deve conseguir ficar disponível ainda.
3. Entre no administrador e abra **Cadastros**.
4. Aprove a loja e o entregador.
5. Na loja, cadastre um produto com estoque 2.
6. Faça um pedido no cliente e confirme o Pix de teste pelo administrador.
7. Confirme que o estoque caiu para 1.
8. Teste a coleta, o rastreamento e a entrega.
9. Faça um novo deploy e confirme que todos os registros continuam no banco.

Não altere para Pix real nesta etapa. O arquivo `RELATORIO_OPERACAO_SEGURA_V11.md`
mostra o que ainda precisa de validação externa antes de receber dinheiro.
