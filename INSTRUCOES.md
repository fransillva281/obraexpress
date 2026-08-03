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

### 🅱️ Google Play Store (Próximo passo)
- **Custo:** Taxa única de US$ 25 (~R$ 140)
- Depois de publicado, entra no Google Play
- Aparece nas buscas
- Pessoas baixam como qualquer app

### 🅲️ Apple App Store (Depois)
- **Custo:** US$ 99/ano (~R$ 550/ano)
- Para usuários de iPhone

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

## 🛒 COMO PUBLICAR NA GOOGLE PLAY

1. Crie conta em play.google.com/console (US$ 25)
2. Use PWABuilder.com (ferramenta grátis) pra gerar o APK
3. Envie o arquivo .aab
4. Preencha descrição, fotos, categoria (Compras)
5. Publica! Em 1-2 dias está no ar

**Eu ajudo em cada etapa.**

---

## 🔧 PRÓXIMOS PASSOS

1. ✅ **Manter online no Render com PostgreSQL**
2. ✅ **PWA instalável** (já incluso)
3. 🔜 **Tráfego pago** (Google Ads, Facebook)
4. 🔜 **Parceria com lojas** de material
5. 🔜 **Google Play Store** (US$ 25)
6. 🔜 **Sistema de avaliação**
7. 🔜 **Notificação WhatsApp** dos pedidos

---

## 📞 SUPORTE
Se travar, me chama que eu ajudo!
