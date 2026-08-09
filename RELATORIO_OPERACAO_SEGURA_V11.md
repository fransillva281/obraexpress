# ObraExpress v11 — operação segura antes do Pix real

## O que esta versão implementa

- PostgreSQL obrigatório e migrações sem apagar os registros existentes.
- Segurança HTTP com Helmet, limite de requisições e limite de tentativas de login.
- CORS restrito ao endereço oficial configurado no Render.
- Validação de e-mail, senha, CEP, UF, documentos, coordenadas e imagens.
- Cadastro nacional com CEP, cidade e estado.
- Aprovação administrativa de lojas e entregadores antes de receber pedidos.
- Suspensão e recusa de cadastros com motivo visível para o usuário.
- Cidades atendidas ativadas quando uma loja local é aprovada.
- Limite de distância e fuso horário configuráveis por cidade.
- Lojas e produtos filtrados pela localização do cliente.
- Estoque real informado pela loja e produtos sem estoque ocultados do cliente.
- Reserva atômica do estoque antes da confirmação do Pix de teste.
- Liberação do estoque se o pagamento expirar ou o pedido for cancelado.
- Alertas de estoque baixo para loja e administrador.
- Cancelamento com motivo, bloqueio após a preparação e fila de reembolso.
- Rastreamento protegido: somente o cliente do pedido vê a posição durante a entrega.
- Avisos internos para cliente, loja e entregador.
- Solicitações de retirada e reembolso em modo de teste, sem movimentar dinheiro.
- Auditoria das ações administrativas importantes.
- Exclusão segura de conta com anonimização do histórico transacional.
- PWA atualizado com cache v11 e ícones existentes.
- Painel administrativo com cadastros, reembolsos, retiradas, estoque, cidades e auditoria.

## O que permanece obrigatoriamente em modo de teste

- QR Code e Pix Copia e Cola são demonstrações e não são bancários.
- Confirmação de pagamento é feita manualmente pelo administrador de teste.
- Retiradas e reembolsos apenas atualizam o saldo interno de teste.
- Nenhuma chave secreta de banco ou de provedor de pagamento foi adicionada.

## O que depende de terceiros e fica para a última fase

1. Responsável empresarial concluir e validar a identificação da empresa.
2. Contador confirmar enquadramento, emissão fiscal, limites e conciliação.
3. Profissional jurídico revisar Termos, Política de Privacidade, cancelamentos, entregas e LGPD.
4. Provedor de pagamento aprovar a conta empresarial e fornecer ambiente de homologação.
5. Implementar API real, webhook assinado, idempotência do provedor, split/repasse e reembolso real.
6. Contratar domínio próprio e e-mail de suporte profissional.
7. Fazer teste fechado com valores controlados e conferência de extrato.
8. Criar e assinar o pacote Android e cumprir a revisão da loja de aplicativos.

## Regra de segurança para a próxima publicação

Use `PAYMENT_MODE=mock`. Não adicione credenciais financeiras no GitHub. O Pix
real só deve ser ligado quando o webhook do provedor for a única fonte capaz de
confirmar um pagamento e todas as validações externas acima estiverem concluídas.
