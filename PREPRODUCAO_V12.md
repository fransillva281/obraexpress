# ObraExpress v12 — pré-produção segura

## Objetivo desta versão

Preservar o que já funciona e preparar o projeto para as próximas etapas sem ativar dinheiro real nem depender de serviços pagos agora.

## Entregue nesta versão

- bloqueio de inicialização quando alguém tenta usar modo de produção ou pagamento real;
- status de pré-produção visível no painel administrativo;
- autenticação completa da loja na rota sensível que altera pedidos;
- teste automático com PostgreSQL verdadeiro no GitHub Actions;
- verificação semanal de atualizações de dependências;
- arquivo de exemplo das variáveis, sem segredos;
- documentação principal, política de segurança e checklist de lançamento;
- cache do aplicativo atualizado para evitar painel antigo no celular.

## O que continua propositalmente desligado

- Pix real e repasses bancários;
- envio real de e-mail sem domínio verificado;
- coleta de documentos, selfie e biometria;
- operação com clientes reais;
- expansão nacional;
- publicação na Play Store.

Esses itens precisam de credenciais externas, infraestrutura permanente ou validação profissional e serão feitos nas etapas correspondentes do roteiro.
