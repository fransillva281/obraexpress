# ObraExpress v11.4 — Privacidade, segurança e identidade

## Resultado desta atualização

Esta versão fortalece a proteção de dados sem ativar uma coleta insegura de
documentos. Ela não promete conformidade jurídica absoluta: conformidade
depende também da operação diária, contratos, fornecedores, treinamento,
resposta a incidentes e revisão profissional.

### Implementado no sistema

- validação matemática completa dos dígitos de CPF e CNPJ;
- nova versão dos Termos e da Política de Privacidade, exigindo novo aceite;
- Central de Privacidade para cliente, loja e entregador;
- exportação autenticada dos dados do próprio titular, sem incluir senha;
- protocolo para acesso, correção, exclusão, revogação e revisão de decisão;
- acompanhamento da solicitação pelo titular;
- fila administrativa para analisar, responder e concluir protocolos;
- histórico da resposta e auditoria administrativa;
- tabelas preparadas para guardar somente o resultado de uma futura
  verificação de identidade;
- cabeçalhos HTTP reforçados, APIs sem cache e GPS permitido apenas ao próprio
  site;
- anonimização das solicitações quando a conta for excluída;
- coleta de CNH, selfie e biometria explicitamente bloqueada nesta versão.

## O que não está ativo

O ObraExpress ainda não recebe CNH, selfie, reconhecimento facial ou molde
biométrico. Não se deve pedir que uma pessoa envie esses arquivos por e-mail,
WhatsApp, formulário comum ou banco PostgreSQL.

## Requisitos antes de ativar verificação automática

1. Escolher fornecedor especializado em identidade e prova de vida.
2. Confirmar contrato de proteção de dados, subprocessadores, localização dos
   dados, prazo de retenção, eliminação e procedimento de incidente.
3. Usar armazenamento privado criptografado, com acesso mínimo e registros de
   auditoria. O PostgreSQL não deve receber a fotografia nem o molde facial.
4. Preparar avaliação de impacto e documentar finalidade, necessidade,
   proporcionalidade, base legal e riscos.
5. Oferecer revisão humana para divergência, baixa qualidade ou recusa.
6. Revisar o fluxo e a Política de Privacidade com profissional jurídico e de
   proteção de dados antes de documentos reais serem recebidos.
7. Fazer testes somente no ambiente de homologação e com documentos próprios
   para teste fornecidos pelo parceiro — nunca com CNH real de terceiros.

## Responsabilidades operacionais ainda necessárias

- definir perfis e pessoas autorizadas a acessar o painel administrativo;
- ativar autenticação em dois fatores quando a arquitetura permitir;
- manter inventário de dados e tabela formal de retenção;
- criar procedimento de incidentes e comunicação aos afetados/ANPD quando
  aplicável;
- registrar contratos com hospedagem, pagamento, mapas, comunicação e
  verificação de identidade;
- treinar atendimento para não solicitar senha, documento ou selfie por canais
  inadequados;
- revisar termos, relações de trabalho, proteção do consumidor, motofrete,
  tributação e documentos fiscais antes do lançamento comercial.

## Testes executados

- 30 testes automáticos aprovados;
- sintaxe do servidor e dos scripts dos seis painéis verificada;
- auditoria das dependências de produção: zero vulnerabilidades conhecidas no
  momento do teste.

