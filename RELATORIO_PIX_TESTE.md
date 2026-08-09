# Pix de teste — ObraExpress

## O que esta versão faz

1. O cliente confere o valor total e confirma o pedido.
2. O servidor cria um QR Code identificado claramente como simulação.
3. O pedido fica com o status `aguardando_pagamento` e não aparece para a loja.
4. O administrador abre **Pedidos** e clica em **Confirmar Pix de teste**.
5. A confirmação é registrada uma única vez no PostgreSQL.
6. Somente depois disso o pedido muda para `aguardando` e aparece no painel da loja.

## Segurança

- O código de teste não segue o padrão bancário do Pix e não recebe dinheiro.
- Apenas o administrador autenticado pode confirmar a simulação.
- A confirmação é idempotente: repetir a solicitação não libera duas vezes.
- A chave Pix particular da loja deixou de ser mostrada ao cliente.
- A cobrança expira em 30 minutos.
- O banco mantém o pedido e o pagamento em tabelas separadas para auditoria.

## Como testar

1. No Render, crie `PAYMENT_MODE` com o valor `mock`.
2. Faça um pedido pelo painel do cliente e confirme o valor.
3. Confira a tela **Simulação — não é Pix real**.
4. Entre no painel administrativo e abra a aba **Pedidos**.
5. No pedido com status **Pix pendente**, clique em **Confirmar Pix de teste**.
6. O cliente verá a confirmação e a loja receberá o pedido.

## O que ainda não faz

Esta versão não recebe nem transfere dinheiro. Para o Pix real será necessário
contratar um provedor autorizado que aceite o modelo de marketplace, concluir a
análise empresarial, configurar webhooks autenticados e homologar os repasses.
