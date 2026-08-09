# Preparação para publicação Android

O ObraExpress já funciona como PWA instalável. A geração do aplicativo da Play
Store deve acontecer somente depois da fase de produção, porque o pacote precisa
apontar para um domínio definitivo, usar ícones finais, ter política revisada e
ser assinado por uma conta responsável pela publicação.

## O que já está preparado no código

- Manifesto PWA.
- Service Worker com atualização de cache.
- Ícones SVG de 192 e 512 pixels.
- Layout responsivo.
- Uso de GPS e câmera mediante permissão.
- Rotas separadas para cliente, loja, entregador e administrador.

## O que será feito na etapa de publicação

1. Definir o domínio HTTPS definitivo.
2. Gerar ícones PNG finais e imagens exigidas pela loja.
3. Escolher empacotamento Android compatível com o PWA.
4. Configurar nome do pacote, versão e política de privacidade.
5. Criar a chave de assinatura e guardá-la fora do GitHub.
6. Gerar o arquivo AAB e testar em aparelhos diferentes.
7. Enviar para teste fechado antes de solicitar publicação pública.

Essas etapas dependem da conta de publicação, assinatura e revisão externa; por
isso não devem ser misturadas com o ZIP do servidor nem com o Pix de teste.
