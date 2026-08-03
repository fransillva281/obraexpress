# ObraExpress — comissão promocional das lojas e entregadores

## Regra aprovada

- Loja: 5% sobre os produtos nos cinco primeiros meses após a primeira venda concluída; depois 7%.
- Entregador: recebe 95% do frete nos cinco primeiros meses após a primeira entrega; depois recebe 93%.
- A ObraExpress fica com 5% do frete na promoção e 7% depois.
- Sem mensalidade nesta fase.
- Sem taxa extra de pagamento enquanto não houver integração com uma empresa de pagamentos.
- Frete separado da venda dos produtos.

## Fluxos

No Plano Loja, a própria loja realiza a entrega e recebe o frete. No Plano Entrega ObraExpress, o pedido separado aparece para os entregadores da plataforma. Pedidos com retirada são concluídos pela loja usando o código mostrado pelo cliente.

## Segurança financeira

O navegador envia apenas os produtos e quantidades. O servidor consulta os preços atuais no PostgreSQL, verifica se todos pertencem à mesma loja e calcula novamente subtotal, comissão e total. A porcentagem e os valores ficam gravados no pedido.

O saldo mostrado neste momento é um cálculo interno para testes. Transferências bancárias reais só devem ser liberadas depois da integração com um provedor de pagamento e da validação comercial e jurídica.

## Exemplo

Venda de R$ 100,00 no Plano Entrega ObraExpress:

- Comissão promocional ObraExpress: R$ 5,00.
- Líquido calculado da loja: R$ 95,00.
- Frete: calculado e controlado separadamente.
