const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { assertSafeRuntime, getProductionReadiness } = require('../production-readiness');

test('pré-produção permanece sem dinheiro real', () => {
  const status = assertSafeRuntime({ APP_STAGE: 'test', PAYMENT_MODE: 'mock' });
  assert.equal(status.test_environment, true);
  assert.equal(status.moves_real_money, false);
  assert.equal(status.production_ready, false);
});

test('bloqueia ativação acidental de pagamento real', () => {
  assert.throws(
    () => assertSafeRuntime({ APP_STAGE: 'production', PAYMENT_MODE: 'real' }),
    /APP_STAGE inválido/
  );
  assert.throws(
    () => assertSafeRuntime({ APP_STAGE: 'sandbox', PAYMENT_MODE: 'real' }),
    /PAYMENT_MODE bloqueado/
  );
});

test('status reconhece somente configurações completas', () => {
  const incompleto = getProductionReadiness({ PUBLIC_URL: 'https://obraexpress-1.onrender.com' });
  assert.equal(incompleto.email_configured, false);
  assert.equal(incompleto.custom_domain_configured, false);
  assert.equal(incompleto.asaas_sandbox_configured, false);

  const completo = getProductionReadiness({
    OFFICIAL_DOMAIN: 'obramobi.com.br',
    PUBLIC_URL: 'https://app.obramobi.com.br',
    RESEND_API_KEY: 'teste',
    EMAIL_FROM: 'App <nao-responda@app.exemplo.com.br>',
    ASAAS_ENV: 'sandbox',
    ASAAS_API_KEY: 'teste',
    ASAAS_WEBHOOK_TOKEN: 'teste'
  });
  assert.equal(completo.email_configured, true);
  assert.equal(completo.custom_domain_configured, true);
  assert.equal(completo.asaas_sandbox_configured, true);
});

test('não aceita domínio alheio como domínio oficial da ObraMobi', () => {
  const status = getProductionReadiness({
    OFFICIAL_DOMAIN: 'obramobi.com.br',
    PUBLIC_URL: 'https://site-nao-oficial.example'
  });
  assert.equal(status.custom_domain_configured, false);
  assert.equal(status.official_domain, 'obramobi.com.br');
});

test('rota sensível de pedido usa middleware compartilhado', () => {
  const servidor = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(servidor, /app\.put\('\/api\/pedidos\/:id\/status', authLojaOuAdmin/);
  assert.match(servidor, /sessao_versao/);
  assert.match(servidor, /possuiAceiteAtual\('loja'/);
});
