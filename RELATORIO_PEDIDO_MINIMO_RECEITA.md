# ObraExpress — pedido mínimo, receita e proteção dos participantes

## Regra inicial

| Produtos no carrinho | Resultado |
|---|---|
| Menos de R$ 15,00 | Pedido bloqueado; o cliente vê quanto falta |
| De R$ 15,00 a R$ 24,99 | Taxa de pedido pequeno de R$ 1,99 |
| R$ 25,00 ou mais | Sem taxa de pedido pequeno |

O frete não conta para atingir o pedido mínimo. Isso evita que uma entrega distante faça um carrinho muito pequeno parecer suficiente.

## Destino de cada valor

- A loja recebe o subtotal dos produtos menos sua comissão de 5% durante a promoção.
- O entregador recebe 95% do frete durante a promoção.
- A ObraExpress recebe as duas comissões de 5% e, quando houver, a taxa de pedido pequeno de R$ 1,99.
- Nenhum saldo é liberado no momento em que o carrinho é criado. O repasse é registrado somente na conclusão do pedido.

Depois de cinco meses, as comissões promocionais passam de 5% para 7%. A taxa de pedido pequeno não é descontada da loja nem do entregador.

## Proteções implementadas

- O servidor consulta novamente os preços e o estoque no PostgreSQL.
- Produtos de lojas diferentes não podem entrar no mesmo pedido.
- Pedidos abaixo do mínimo são recusados pelo servidor, mesmo que alguém altere a tela do navegador.
- Os valores usados ficam gravados no pedido para preservar o histórico.
- O administrador pode ajustar frete, pedido mínimo, limite e taxa sem editar o código.
- A receita da taxa é registrada separadamente no histórico financeiro da plataforma.

## Valores iniciais do frete

- Base: R$ 4,00.
- Por quilômetro estimado: R$ 1,50.
- Chuva: adicional de 10%.
- Pico: adicional de 5%.
- Limite combinado: 15%.

Esses valores reduzem o frete inicial, mas preservam o ganho do entregador por distância. Antes de atender clientes reais, faça testes em diferentes bairros e ajuste pelo painel administrativo.

## Pix

O sistema ainda usa Pix apenas como demonstração do fluxo. Não existe cobrança automática, QR Code confirmado pelo banco nem divisão real do dinheiro. Isso deve ser conectado a um provedor de pagamento em uma etapa separada, com credenciais guardadas somente nas variáveis secretas do Render.
