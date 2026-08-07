# ObraExpress — frete transparente, termos e privacidade

Versão: 2026-08-04

## O que foi implementado

- Frete do cliente por faixas simples, calculado pelo GPS:
  - até 2 km: R$ 5,99;
  - até 4 km: R$ 7,99;
  - até 6 km: R$ 10,99;
  - até 8 km: R$ 13,99;
  - acima de 8 km: entrega de moto indisponível.
- Adicional ao cliente limitado a 10%, com motivo visível para chuva e pico.
- Ganho líquido do entregador calculado pela rota completa:
  entregador → loja → cliente.
- Ganho mínimo padrão de R$ 7,50 ou R$ 1,50 por quilômetro da rota,
  valendo o maior, com bônus operacional limitado a 15%.
- Entregas aparecem primeiro para quem está perto da loja; raio padrão de
  coleta de 3 km, com limite de 5 km.
- O financeiro do administrador passou a mostrar créditos e débitos. Quando o
  frete do cliente é menor que o ganho mínimo do entregador, o complemento é
  mostrado como débito da plataforma.
- Texto “Frete calculado pelo GPS” nas lojas do painel do cliente.

## Termos e privacidade

- Página pública legível em `/termos.html`.
- Seções próprias para cliente, loja e entregador.
- Política de Privacidade com GPS, fotos, compartilhamentos, retenção,
  segurança e direitos dos titulares.
- Dois aceites separados: Termos/Regras e Política de Privacidade.
- Registro no PostgreSQL com versão, data, tipo de conta, navegador e hash
  protegido do IP; o endereço IP original não é armazenado.
- Usuários antigos precisam aceitar a versão atual no próximo acesso.
- Quando a versão mudar no código, o sistema pede novo aceite.
- Novos cadastros são bloqueados se as confirmações não estiverem marcadas.
- O entregador também confirma requisitos profissionais e de segurança.

## Configuração obrigatória no Render

Criar no Web Service:

- `EMPRESA_NOME`
- `EMPRESA_DOCUMENTO`
- `EMPRESA_ENDERECO`
- `EMPRESA_EMAIL_SUPORTE`
- `EMPRESA_EMAIL_PRIVACIDADE`

A página mostra um aviso de identificação incompleta enquanto faltar qualquer
valor. Não iniciar pagamentos nem operação comercial nesse estado.

## Antes do lançamento real

1. Pedir revisão dos Termos e da Política de Privacidade a um advogado
   brasileiro, considerando a cidade e o estado da operação.
2. Definir o responsável legal, a estrutura empresarial e os documentos fiscais.
3. Contratar um provedor de Pix com confirmação por webhook e regras de repasse.
4. Publicar contatos reais de suporte e privacidade.
5. Testar os três perfis em celulares diferentes e acompanhar margem positiva
   ou negativa de cada pedido no painel administrativo.

O texto entregue é uma base técnica e operacional. Ele não garante, sozinho,
conformidade jurídica e deve ser adaptado por profissional habilitado.
