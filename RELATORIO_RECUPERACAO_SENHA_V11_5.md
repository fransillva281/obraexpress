# ObraExpress v11.5 — recuperação segura de senha

## O que foi implementado

- Botão **Esqueci minha senha** nos painéis de cliente, loja e entregador.
- Envio de código numérico de seis dígitos por e-mail.
- Código válido por 10 minutos e utilizável uma única vez.
- Bloqueio depois de cinco tentativas incorretas.
- Resposta genérica ao solicitar o código, evitando revelar se um e-mail está cadastrado.
- Limite de solicitações para reduzir abuso e tentativas automatizadas.
- A senha nova é protegida com bcrypt.
- Todas as sessões antigas da conta são invalidadas depois da troca de senha.
- Códigos nunca ficam gravados em texto aberto no PostgreSQL; somente o hash HMAC é armazenado.
- Códigos são apagados junto com a conta e na limpeza administrativa de dados de teste.
- Indicador no painel **Administração → Operação → Saúde dos serviços**.

## Variáveis necessárias no Render

| Variável | Valor |
|---|---|
| `RESEND_API_KEY` | Chave secreta de envio criada no provedor de e-mail |
| `EMAIL_FROM` | Remetente de domínio verificado, como `ObraExpress <nao-responda@seudominio.com>` |

Esses valores pertencem somente às variáveis do Web Service no Render. Nunca devem
ser colocados no GitHub ou enviados em captura de tela.

## Comportamento enquanto o e-mail não estiver configurado

O sistema, os cadastros, os pedidos e os logins continuam funcionando normalmente.
Ao usar **Esqueci minha senha**, o usuário recebe a orientação para procurar o
suporte. O administrador verá o aviso de configuração pendente na Saúde dos serviços.

## O que ainda depende de serviço externo

Para entregar e-mails reais a qualquer cliente, loja ou entregador, será necessário:

1. possuir um domínio próprio;
2. verificar o domínio no provedor de e-mail;
3. criar uma chave com permissão apenas para envio;
4. adicionar as duas variáveis no Render;
5. testar primeiro com contas controladas pela equipe.

Documentação oficial do provedor:

- https://resend.com/docs/api-reference/emails/send-email
- https://resend.com/docs/knowledge-base/403-error-1010

## Teste recomendado depois da configuração

1. Cadastre um cliente de teste com um e-mail ao qual você tenha acesso.
2. Saia da conta e clique em **Esqueci minha senha**.
3. Informe o e-mail e solicite o código.
4. Confirme que a mensagem chegou e que o código contém seis números.
5. Cadastre uma senha nova.
6. Confirme que a senha antiga não entra e a nova entra.
7. Tente reutilizar o mesmo código e confirme que ele foi recusado.

Não use dados pessoais de terceiros nos testes.
