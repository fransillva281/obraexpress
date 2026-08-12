# Passo a passo simples — atualização v11.4

## Enviar ao GitHub

1. Extraia o ZIP no computador.
2. Abra a pasta extraída.
3. No GitHub, entre no repositório `fransillva281/obraexpress`.
4. Clique em **Adicionar arquivo → Fazer upload de arquivos**.
5. Arraste todos os arquivos e pastas que estão dentro da pasta extraída.
6. Confirme que aparecem também `document-validator.js`,
   `frontend/privacidade.html` e `RELATORIO_PRIVACIDADE_SEGURANCA_V11_4.md`.
7. Na primeira linha do commit, escreva:

   `Implementa central de privacidade e proteção de dados`

8. Mantenha a opção de enviar diretamente para o ramo principal e confirme.

## Aguardar o Render

O Render deve iniciar sozinho. Espere aparecer nos logs:

- `PostgreSQL conectado; tabelas e migrações verificadas`
- `ObraExpress rodando na porta 10000`
- `Your service is live`

Não é necessário criar uma variável nova nesta atualização. Não altere
`PAYMENT_MODE=mock`.

## Teste simples

1. Entre como cliente e abra **Pedidos**.
2. Clique em **Central de Privacidade e meus dados**.
3. Clique em **Baixar meus dados**. Deve baixar um arquivo `.json`.
4. Abra uma solicitação do tipo **Corrigir informação** usando apenas texto de
   teste; não envie documento verdadeiro.
5. Entre no administrador e abra a nova aba **Privacidade**.
6. Localize o protocolo, marque **Em análise** e depois responda/conclua.
7. Volte à Central de Privacidade do cliente e confirme que a resposta aparece.
8. Repita o acesso pela aba **Termos** da loja e do entregador.

## Comportamento esperado

- CPF e CNPJ inventados ou com dígito incorreto serão recusados.
- Loja e entregador continuam dependendo de aprovação administrativa.
- Nenhum campo de CNH, selfie ou biometria aparecerá.
- Documentos reais continuam proibidos até a integração segura ser contratada.

