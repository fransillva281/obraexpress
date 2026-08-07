# GPS, frete e comissões — versão implementada

> **Documento histórico.** O modelo vigente está em
> `RELATORIO_FRETE_TERMOS.md`: faixas de frete para o cliente e ganho líquido
> do entregador pela rota completa.

## Regra recomendada

Separar a rota em duas distâncias:

1. **Coleta:** posição do entregador até a loja.
2. **Entrega:** loja até o endereço do cliente.

O painel do entregador abre duas rotas: da posição atual até a loja e, depois da coleta, da loja até o ponto GPS do cliente.

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
| Preço inicial por km de entrega | R$ 2,00 |
| Fator de aproximação da rota | 1,20 |
| Adicional de chuva | 15% |
| Adicional de horário de pico | 10% |
| Limite combinado dos adicionais | 25% |
| Comissão promocional da plataforma | 5%; depois 7% |

### Exemplo

- Produtos: R$ 100,00.
- Entregador até a loja: 2 km.
- Loja até o cliente: 5 km.
- Cliente paga a cotação mostrada antes da confirmação.
- Durante a promoção, o entregador recebe 95% do frete e a plataforma 5%.
- Comissão promocional da venda: 5% de R$ 100,00 = R$ 5,00.
- Loja recebe R$ 95,00 pelos produtos no plano Entrega ObraExpress.

Esses números são exemplos para testar a lógica, não uma decisão comercial definitiva.

## O que já foi criado

- Dois planos: Loja e Entrega ObraExpress.
- Comissão de 5% nos cinco primeiros meses e 7% depois.
- Início da promoção gravado na primeira venda ou entrega concluída.
- Cotação de frete protegida no servidor.
- GPS obrigatório para a loja e para a entrega do cliente.
- Adicionais de chuva e pico limitados a 25%.
- Painel administrativo para alterar base, valor por km, clima e situação das entregas.
- Preços e quantidades recalculados no servidor.
- Regra financeira congelada em cada pedido.
- Saldo e extrato calculado da loja.
- Separação entre comissão da venda e receita da entrega.
- Proteção transacional contra crédito duplicado na conclusão.

## O que ainda precisa ser criado

- Cálculo de rota por ruas usando um serviço de mapas. A fórmula atual mede linha reta e serve apenas como aproximação.
- Histórico das alterações da tabela de configurações.
- Distribuição automática de corridas por proximidade.
- Integração com pagamento e repasses bancários reais.

## Ordem segura de implementação

1. Publicar e testar GPS/frete com contas de teste.
2. Escolher e criar a conta no provedor Pix.
3. Integrar criação do QR Code Pix.
4. Liberar o pedido para a loja somente após a confirmação automática do pagamento.
5. Validar os repasses antes de operar com dinheiro real.

Antes de cobrar clientes ou repassar dinheiro de verdade, as porcentagens, contratos, impostos e regras de entregadores e lojas devem ser revisados com um adulto responsável e profissionais de contabilidade e direito.
