# Plano da próxima etapa — GPS, ganhos e comissões

## Regra recomendada

Separar a rota em duas distâncias:

1. **Coleta:** posição do entregador até a loja.
2. **Entrega:** loja até o endereço do cliente.

O sistema deve guardar as duas distâncias no pedido. Isso deixa claro quanto o entregador percorreu e evita misturar quilômetros.

## Modelo financeiro recomendado para começar

Todos os valores devem ficar configuráveis no painel administrativo, nunca escondidos ou fixos somente no código.

- Taxa que o cliente paga pela entrega: valor base + quilômetros da loja até o cliente.
- Ganho do entregador: valor mínimo ou quilômetros de coleta + entrega multiplicados pelo valor por km.
- Comissão da plataforma sobre produtos: porcentagem do valor dos produtos, descontada do repasse da loja.
- Resultado da plataforma na entrega: taxa paga pelo cliente menos o ganho do entregador.
- Limite de coleta: oferecer a corrida primeiro a entregadores próximos da loja para a conta não ficar negativa.

Valores iniciais apenas para simulação, antes de validação comercial:

| Configuração | Exemplo inicial |
|---|---:|
| Taxa base de entrega | R$ 5,00 |
| Preço ao cliente por km de entrega | R$ 2,50 |
| Ganho do entregador por km total | R$ 2,00 |
| Ganho mínimo do entregador | R$ 8,00 |
| Comissão da plataforma sobre produtos | 10% nos dois planos |
| Raio inicial para chamar entregadores | 5 km |

### Exemplo

- Produtos: R$ 100,00.
- Entregador até a loja: 2 km.
- Loja até o cliente: 5 km.
- Cliente paga pela entrega: R$ 5,00 + 5 × R$ 2,50 = R$ 17,50.
- Entregador percorre 7 km e recebe 7 × R$ 2,00 = R$ 14,00.
- Plataforma fica com R$ 3,50 da entrega.
- Comissão da venda: 10% de R$ 100,00 = R$ 10,00.
- Loja recebe R$ 90,00 pelos produtos no plano Entrega ObraExpress.
- Receita bruta da plataforma nesse exemplo: R$ 13,50.

Esses números são exemplos para testar a lógica, não uma decisão comercial definitiva.

## O que já foi criado

- Dois planos: Loja e Entrega ObraExpress.
- Comissão inicial de 10% sobre os produtos nos dois planos.
- Preços e quantidades recalculados no servidor.
- Regra financeira congelada em cada pedido.
- Saldo e extrato calculado da loja.
- Separação entre comissão da venda e receita da entrega.
- Proteção transacional contra crédito duplicado na conclusão.

## O que ainda precisa ser criado

- Campos no banco para distância de coleta, distância de entrega e distância total.
- Tabela de configurações financeiras com histórico de alterações.
- Cálculo de rota por ruas usando um serviço de mapas. A fórmula atual mede linha reta e serve apenas como aproximação.
- Atualização periódica da posição do entregador durante a corrida.
- Tela do administrador com venda, repasse da loja, ganho do entregador e receita da plataforma separados.
- Integração com pagamento e repasses bancários reais.

## Ordem segura de implementação

1. Configurações e novos campos no banco.
2. Cálculo de rota e preço antes da confirmação do pedido.
3. Escolha de entregadores próximos e cálculo da coleta.
4. Congelamento dos valores no pedido aceito.
5. Extratos e painel administrativo.
6. Integração de pagamento e repasses.

Antes de cobrar clientes ou repassar dinheiro de verdade, as porcentagens, contratos, impostos e regras de entregadores e lojas devem ser revisados com um adulto responsável e profissionais de contabilidade e direito.
