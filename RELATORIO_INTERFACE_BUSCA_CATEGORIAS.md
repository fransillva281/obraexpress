# ObraExpress — categorias leves, nova interface e busca

## Alterações desta versão

- Catálogo oficial com 19 categorias voltadas a produtos leves.
- Categorias pesadas antigas desativadas, sem excluir os registros do banco.
- Cadastro de novos produtos limitado às categorias ativas.
- Tela inicial renovada com destaque visual e categorias em grade responsiva.
- Duas categorias por linha em celulares, três em telas médias e cinco em computadores.
- Busca unificada por nome do produto, marca, categoria, nome da loja e bairro.
- Resultados separados em categorias, lojas e produtos.
- Produtos organizados do menor preço para o maior.
- Cache do aplicativo atualizado para a versão 5.

## Segurança da migração

As categorias antigas permanecem no PostgreSQL com `ativa = 0`. Dessa forma,
elas poderão ser recuperadas no futuro para uma modalidade de entrega com
carro, utilitário ou caminhão. Produtos já cadastrados não são apagados.

## Validação

- 10 testes automatizados aprovados.
- JavaScript dos quatro painéis validado.
- Auditoria de dependências sem vulnerabilidades conhecidas.
