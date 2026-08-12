# Segurança

## Ambiente atual

O repositório está em pré-produção. Não envie dados pessoais, documentos, chaves Pix reais, senhas, tokens ou URLs privadas do banco para issues, commits ou capturas de tela.

## Como comunicar uma falha

Não publique detalhes da falha em uma issue pública. Envie uma descrição sem dados de clientes para `obraexpress.privacidade@gmail.com`.

Inclua somente:

- qual painel apresentou o problema;
- os passos para reproduzir usando dados fictícios;
- o resultado esperado e o resultado observado;
- navegador, aparelho e horário aproximado.

Nunca envie senha, código de recuperação, documento, selfie, chave de API ou conteúdo completo do banco.

## Práticas do projeto

- segredos ficam somente nas variáveis do Render;
- pagamentos reais permanecem bloqueados nesta versão;
- dependências e testes são conferidos pelo GitHub Actions;
- documentos e biometria não são coletados sem provedor especializado;
- o PostgreSQL é obrigatório e não existe fallback para arquivo local.
