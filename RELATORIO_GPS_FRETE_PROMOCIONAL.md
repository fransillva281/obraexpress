# ObraExpress — GPS, frete e porcentagens promocionais

## O que esta versão faz

- A loja grava sua localização GPS no cadastro ou no Perfil.
- O cliente grava o ponto exato da entrega e recebe a cotação antes de confirmar.
- O servidor calcula novamente o frete para impedir alteração pelo navegador.
- O entregador abre duas rotas no Google Maps: posição atual até a loja e posição atual até o cliente.
- O painel administrativo permite controlar valor inicial, preço por km, chuva, pico e pausa de segurança.
- A porcentagem da loja e da entrega começa em 5% e passa para 7% cinco meses após a primeira conclusão.

## Valores iniciais configurados

- Valor inicial do frete: R$ 5,00.
- Valor por km: R$ 2,00.
- Fator para aproximar a distância por ruas: 1,20.
- Chuva: 15%.
- Horário de pico: 10%, das 11h às 14h e das 17h às 20h.
- Limite combinado de chuva e pico: 25%.

Esses valores podem ser alterados em **Administração → Entregas**.

## Regra dos ganhos

- Loja, meses 1 a 5: recebe 95% dos produtos; ObraExpress recebe 5%.
- Loja, a partir do mês 6: recebe 93%; ObraExpress recebe 7%.
- Entregador, meses 1 a 5: recebe 95% do frete; ObraExpress recebe 5%.
- Entregador, a partir do mês 6: recebe 93% do frete; ObraExpress recebe 7%.

O prazo individual começa na primeira venda ou entrega concluída, e a porcentagem usada fica registrada no pedido.

## Limite atual do GPS

O cálculo do preço usa a distância em linha reta multiplicada por um fator configurável. O botão do entregador abre a rota real por ruas no Google Maps. Uma API própria de rotas pode ser integrada depois para cobrar usando a distância exata das ruas.

## Próxima etapa: Pix

O Pix ainda não movimenta dinheiro real. A próxima versão deverá criar a cobrança no provedor, mostrar QR Code e Pix Copia e Cola, receber a confirmação automática e somente então liberar o pedido para a loja.
