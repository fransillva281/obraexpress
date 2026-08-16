# ObraMobi v13 — marca e compatibilidade segura

## Objetivo

Adotar a marca pública ObraMobi sem perder dados, sessões, pedidos ou compatibilidade com a versão anterior.

## Alterações

- nome público atualizado nos quatro painéis, PWA, e-mails, termos e mensagens;
- ícones temporários atualizados de `OE` para `OM`;
- domínio `obramobi.com.br` documentado, mas ainda não ativado no DNS;
- versões dos Termos e da Política de Privacidade atualizadas para solicitar novo aceite;
- Pix continua sendo apenas uma simulação e agora exibe o identificador `OBRAMOBI.TESTE`;
- cache do PWA renovado para remover telas antigas dos celulares.

## Compatibilidade preservada

Os valores internos `entrega_obraexpress`, `obraexpress_cliente` e `obraexpress_admin_token` permanecem temporariamente iguais. Eles não aparecem como marca para o público e não devem ser alterados sem uma migração específica, pois podem existir em bancos e navegadores antigos.

## Segurança

- `PAYMENT_MODE=mock` continua obrigatório;
- `APP_STAGE` continua limitado a `test` ou `sandbox`;
- nenhuma chave real deve ser enviada ao GitHub;
- o domínio só será apontado para o Render depois dos testes desta versão.
