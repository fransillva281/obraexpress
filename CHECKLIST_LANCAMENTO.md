# Checklist de lançamento

Marque um item somente depois de testar e guardar a comprovação.

## 1. Preservação e infraestrutura

- [x] Código salvo no GitHub.
- [x] PostgreSQL obrigatório, sem SQLite temporário.
- [x] Teste automático das migrações PostgreSQL.
- [ ] Exportar uma cópia do banco de testes antes de 29/08/2026.
- [ ] Contratar banco permanente antes do piloto real.
- [ ] Contratar serviço web sem suspensão antes do piloto real.
- [ ] Configurar backups automáticos e testar uma restauração.
- [ ] Configurar monitoramento e alertas.

## 2. Marca e domínio

- [ ] Escolher uma marca disponível.
- [ ] Pesquisar a marca no INPI com orientação adequada.
- [ ] Registrar domínio próprio.
- [ ] Configurar HTTPS e endereços oficiais.

## 3. Comunicação e contas

- [ ] Verificar o domínio na Resend.
- [ ] Configurar `RESEND_API_KEY` e `EMAIL_FROM` somente no Render.
- [ ] Testar recuperação de senha nos três tipos de conta.
- [ ] Criar canal oficial de suporte e procedimento de incidentes.

## 4. Pagamentos

- [ ] Aprovar a conta empresarial no Asaas.
- [ ] Criar credenciais exclusivas do Sandbox.
- [ ] Implementar cobrança Pix e webhook com idempotência.
- [ ] Testar pagamento, expiração, duplicidade, cancelamento e reembolso.
- [ ] Definir conciliação e repasses com contador.
- [ ] Ativar Pix real somente após aprovação final.

## 5. Operação e privacidade

- [ ] Migrar imagens para armazenamento privado de objetos.
- [ ] Definir retenção e exclusão de dados.
- [ ] Contratar provedor adequado antes de coletar documentos ou biometria.
- [ ] Fazer teste completo com poucas contas fictícias em Palmas.
- [ ] Revisar termos, privacidade, operação e tributos com profissionais.

## 6. Aplicativo e expansão

- [ ] Criar pacote Android assinado.
- [ ] Preparar política da Play Store, capturas e conta de desenvolvedor.
- [ ] Fazer teste fechado do Android.
- [ ] Publicar somente depois do piloto estável.
- [ ] Expandir cidade por cidade, com suporte e entregadores locais.
