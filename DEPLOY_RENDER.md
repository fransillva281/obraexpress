# Publicação segura no Render

Esta versão da ObraMobi usa **somente PostgreSQL**. Ela não cria um arquivo
SQLite local. Se `DATABASE_URL` estiver ausente ou inválida, o servidor encerra
com uma mensagem clara para impedir gravações temporárias.

## 1. Conferir o PostgreSQL

1. No painel do Render, abra o banco PostgreSQL usado pela ObraMobi.
2. Confirme que o banco e o Web Service estão na mesma região.
3. No menu **Connect**, copie a **Internal Database URL**.
4. Não publique nem envie essa URL para outras pessoas.

## 2. Configurar o Web Service

1. Abra o Web Service `obraexpress-1` no Render.
2. Entre em **Environment**.
3. Crie ou atualize a variável `DATABASE_URL` com a Internal Database URL.
4. Crie `JWT_SECRET` e use o botão **Generate** do Render para gerar o valor.
5. Crie `ADMIN_EMAIL` com o e-mail que poderá entrar no painel administrativo.
6. Crie `ADMIN_PASSWORD` com uma senha forte e exclusiva.
7. Preencha os dados públicos obrigatórios que aparecerão nos Termos:
   - `EMPRESA_NOME`: nome empresarial ou nome do responsável;
   - `EMPRESA_DOCUMENTO`: CNPJ ou documento aplicável;
   - `EMPRESA_ENDERECO`: endereço completo para atendimento;
   - `EMPRESA_EMAIL_SUPORTE`: contato do consumidor;
   - `EMPRESA_EMAIL_PRIVACIDADE`: contato para pedidos da LGPD.
8. Crie `PAYMENT_MODE` com o valor `mock`. Esse modo gera apenas uma simulação e não movimenta dinheiro.
9. Crie `PUBLIC_URL` com `https://obraexpress-1.onrender.com`.
10. Crie `CORS_ORIGINS` com `https://obraexpress-1.onrender.com`. Quando houver domínio próprio, acrescente-o separado por vírgula.
11. Crie `TRUST_PROXY` com o valor `1`.
12. Para ativar **Esqueci minha senha**, crie também:
   - `RESEND_API_KEY`: chave secreta de envio criada no painel da Resend;
   - `EMAIL_FROM`: remetente de um domínio verificado, por exemplo `ObraMobi <nao-responda@email.obramobi.com.br>`.
13. Use `npm ci` como **Build Command**.
14. Use `npm start` como **Start Command**.
15. Salve escolhendo a opção que também inicia um novo deploy.

Nunca coloque `RESEND_API_KEY` no GitHub, em arquivo `.env` enviado ao repositório
ou em captura de tela. Sem essas duas variáveis, o restante do sistema continua
funcionando e o painel administrativo mostra que a recuperação de senha aguarda
configuração.

## 3. Confirmar nos logs

Depois do deploy, os logs devem mostrar as duas mensagens:

```text
✅ PostgreSQL conectado; tabelas e migrações verificadas
🚀 ObraMobi rodando na porta 10000
```

Se aparecer uma mensagem informando que uma variável não está configurada, ela
não foi vinculada ao Web Service correto. Os valores precisam estar no serviço
do site, não apenas na página do banco.

## 4. Testar a persistência

1. Abra `https://obraexpress-1.onrender.com/api/health`.
2. Confirme que a resposta contém `"database":"postgresql"` e
   `"connected":true`.
3. Cadastre um cliente de teste e confirme que consegue entrar.
4. No Render, faça **Manual Deploy → Deploy latest commit**.
5. Depois do deploy, tente entrar novamente com o mesmo cliente.

Se o login continuar funcionando, o cadastro permaneceu no PostgreSQL.

## Observações importantes

- A inicialização cria tabelas e colunas ausentes sem apagar registros existentes.
- Dados de um arquivo SQLite perdido em deploys anteriores não podem ser
  recuperados sem uma cópia desse arquivo.
- Não coloque a URL real do banco em `.env`, documentação ou commits do GitHub.
- Não inicie pagamentos reais enquanto a identificação empresarial estiver
  incompleta e os Termos não tiverem sido revisados por profissional jurídico.
- Não coloque chave de provedor financeiro no GitHub. A versão atual usa apenas
  `PAYMENT_MODE=mock`; o QR Code gerado é uma demonstração que não pode receber dinheiro.
- O código de recuperação vale por 10 minutos, só funciona uma vez e é bloqueado
  depois de cinco tentativas incorretas. Trocar a senha encerra as sessões antigas.
- Mantenha `PAYMENT_MODE=mock` até a homologação empresarial, financeira e jurídica. Alterar essa variável sozinho não ativa Pix real.
- Para serviços no mesmo Render e na mesma região, prefira a Internal Database
  URL, conforme a documentação oficial do Render.

Documentação oficial:

- https://render.com/docs/postgresql-creating-connecting
- https://render.com/docs/multi-service-architecture
