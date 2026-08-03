# ObraExpress — comissão inicial das lojas

## Regra aprovada

- Plano Loja: 10% sobre o valor dos produtos.
- Plano Entrega ObraExpress: 10% sobre o valor dos produtos.
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

- Comissão ObraExpress: R$ 10,00.
- Líquido calculado da loja: R$ 90,00.
- Frete: calculado e controlado separadamente.

