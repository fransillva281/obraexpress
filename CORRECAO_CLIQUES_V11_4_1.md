# Correção dos cliques — v11.4.1

## Problema encontrado

A política de segurança enviada pelo servidor acrescentava automaticamente
`script-src-attr 'none'`. Os painéis atuais ainda usam atributos `onclick`, por
isso as telas apareciam normalmente, mas categorias, menus e botões não
respondiam.

## Correção aplicada

- Permitidos temporariamente os eventos `onclick` usados pela interface atual.
- Mantidas as demais proteções do Helmet e da política de conteúdo.
- Atualizada a versão do cache do aplicativo para forçar a renovação dos
  arquivos nos celulares e computadores.
- Adicionado teste automático para impedir que o problema volte.

## Publicação

Envie todo o conteúdo desta pasta para a raiz do repositório e use o commit:

`Corrige cliques dos painéis após atualização de segurança`

Depois do Render concluir o deploy, atualize a página. No celular, feche e abra
novamente o navegador caso ainda apareça a versão anterior.

## Próxima melhoria de segurança

Em uma versão futura, os eventos `onclick` devem ser migrados para
`addEventListener`. Depois dessa migração, a permissão temporária poderá ser
retirada novamente.
