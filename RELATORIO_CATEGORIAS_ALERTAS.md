# ObraExpress — Categorias, comparação de preços e alertas

## O que esta versão entrega

- Catálogo oficial com 19 categorias diferentes e sem repetição.
- A loja escolhe categorias oficiais no cadastro.
- A loja escolhe uma categoria oficial ao cadastrar cada produto.
- Ao tocar em uma categoria, o cliente vê produtos daquela categoria de todas as lojas.
- Os produtos aparecem do menor preço para o maior preço.
- O primeiro resultado recebe a marca "Menor preço da lista".
- A loja pode ativar um bip para novos pedidos.
- O entregador pode ativar um bip para novas entregas disponíveis.
- Os painéis consultam novidades a cada 15 segundos enquanto estão abertos.
- O cache do aplicativo foi atualizado para carregar a versão nova após o deploy.

## Como testar os bipes

1. Abra o painel da loja e toque em **Ativar alertas sonoros**.
2. Faça um pedido novo usando uma conta de cliente.
3. Aguarde até 15 segundos com o painel da loja aberto.
4. Confirme e separe o pedido na loja.
5. Abra o painel do entregador e toque em **Ativar alertas sonoros**.
6. Aguarde até 15 segundos: a entrega nova deve aparecer e tocar o bip.

O navegador exige que a pessoa toque no botão uma vez para permitir o som. O bip desta versão funciona com o painel aberto. Notificações com o navegador fechado serão uma etapa futura usando notificações push.

## Testes executados

- Sintaxe do backend, banco, cache e JavaScript dos quatro painéis.
- Testes automáticos do PostgreSQL.
- Teste do catálogo com 19 categorias únicas.
- Teste da ordenação por menor preço e da presença dos alertas.

