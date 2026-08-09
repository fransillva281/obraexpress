# 🏗️ ObraExpress - Manual Completo

## 📋 O QUE É
ObraExpress é um marketplace de materiais de construção (tipo iFood, mas pra obra). Cliente compra, loja prepara, entregador leva.

---

## 🎯 OS 3 APPS EM 1 SISTEMA:

| App | Pra quem | O que faz |
|-----|----------|-----------|
| 🛒 **App Cliente** | Quem compra | Ver lojas, produtos, pedir, escolher entrega ou retirada |
| 🏪 **Painel Loja** | Donos de loja | Cadastrar produtos, ver pedidos, confirmar, liberar entrega |
| 🛵 **App Entregador** | Motoboys | Ver pedidos disponíveis, pegar entrega, finalizar |

---

## 📱 COMO AS PESSOAS VÃO USAR?

### 🅰️ PWA - Instala direto do navegador
O sistema já vem com **PWA (Progressive Web App)**. Isso significa que:
- A pessoa acessa o link pelo celular
- Aparece a opção "Instalar aplicativo" 
- O app fica na tela inicial **igual um app baixado da loja**
- Funciona offline, rápido, usa câmera, GPS

### 🅱️ Lojas de aplicativos (etapa futura)

A publicação poderá ser estudada depois. Ela exige contas próprias, verificação e atendimento às regras atuais de cada loja de aplicativos.

---

## 🚀 PUBLICAÇÃO NO RENDER

O projeto usa um Web Service Node.js e um banco PostgreSQL persistente. Consulte
o arquivo `DEPLOY_RENDER.md` antes de publicar uma atualização. A variável
`DATABASE_URL` é obrigatória e deve usar, de preferência, a Internal Database
URL do PostgreSQL no Render.

Para instalar no celular:
- Cliente: acessa o link → abre no Chrome → "Adicionar à tela inicial"
- Loja: acessa o link + /loja → instala
- Entregador: acessa o link + /entregador → instala

---

## 📍 COMO ATIVAR O GPS

1. A loja entra em **Perfil** e clica em **Cadastrar localização da loja**.
2. O cliente abre o carrinho, continua para o checkout e clica em **Usar minha localização**.
3. O entregador permite o GPS ao abrir o painel.
4. Após aceitar a corrida, usa **Rota 1** para a loja e **Rota 2** para o cliente.
5. O administrador controla o valor do frete em **Entregas**.

---

## 🔧 PRÓXIMOS PASSOS

1. ✅ **Manter online no Render com PostgreSQL**
2. ✅ **PWA instalável** (já incluso)
3. ✅ **GPS e frete dinâmico**
4. ✅ **Pedido mínimo e taxa de pedido pequeno configuráveis**
5. ✅ **Pix de teste** com QR Code, bloqueio do pedido e confirmação pelo administrador
6. ✅ **Aprovação de lojas e entregadores** antes de operar
7. ✅ **Estoque reservado**, cancelamento, reembolso de teste e auditoria
8. ✅ **Avisos nos painéis**, rastreamento protegido e operação por cidade
9. 🔜 **Pix real** com provedor autorizado, conta empresarial e webhooks — somente na última fase
10. 🔜 **Validação empresarial, contábil e jurídica** por responsáveis e profissionais habilitados
11. 🔜 **Publicação em lojas de aplicativos**, depois de domínio próprio, ícones finais, política revisada e testes de produção
12. 🔜 **Mensagens externas** por WhatsApp/push, caso seja contratado um provedor

Consulte `RELATORIO_OPERACAO_SEGURA_V11.md` para ver exatamente o que já foi
implementado e o que depende de serviços ou validações externas.

---

## 📞 SUPORTE
Se algo travar, consulte também `DEPLOY_RENDER.md` e o relatório da atualização.
