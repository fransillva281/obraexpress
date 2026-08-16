'use strict';

const APP_STAGES = new Set(['test', 'sandbox']);

function hasValue(value) {
  return Boolean(String(value || '').trim());
}

function getProductionReadiness(env = process.env) {
  const stage = String(env.APP_STAGE || 'test').trim().toLowerCase();
  const paymentMode = String(env.PAYMENT_MODE || 'mock').trim().toLowerCase();
  const publicUrl = String(env.PUBLIC_URL || '').trim();
  const officialDomain = String(env.OFFICIAL_DOMAIN || 'obramobi.com.br').trim().toLowerCase();
  let publicHostname = '';
  try {
    publicHostname = new URL(publicUrl).hostname.toLowerCase();
  } catch {
    publicHostname = '';
  }
  const customDomain = hasValue(officialDomain)
    && (publicHostname === officialDomain || publicHostname.endsWith(`.${officialDomain}`));
  const emailConfigured = hasValue(env.RESEND_API_KEY) && hasValue(env.EMAIL_FROM);
  const asaasSandboxConfigured = String(env.ASAAS_ENV || '').toLowerCase() === 'sandbox'
    && hasValue(env.ASAAS_API_KEY)
    && hasValue(env.ASAAS_WEBHOOK_TOKEN);

  const pending = [];
  if (!emailConfigured) pending.push('Configurar domínio e envio de e-mail');
  if (!customDomain) pending.push('Configurar domínio próprio');
  if (!asaasSandboxConfigured) pending.push('Homologar Asaas no Sandbox');
  pending.push('Migrar banco e hospedagem para planos permanentes antes do piloto real');
  pending.push('Concluir revisão contábil, jurídica e de privacidade');

  return {
    stage,
    payment_mode: paymentMode,
    test_environment: true,
    moves_real_money: false,
    production_ready: false,
    email_configured: emailConfigured,
    official_domain: officialDomain,
    custom_domain_configured: customDomain,
    asaas_sandbox_configured: asaasSandboxConfigured,
    pending
  };
}

function assertSafeRuntime(env = process.env) {
  const status = getProductionReadiness(env);
  if (!APP_STAGES.has(status.stage)) {
    throw new Error('APP_STAGE inválido. Esta versão aceita somente test ou sandbox.');
  }
  if (status.payment_mode !== 'mock') {
    throw new Error('PAYMENT_MODE bloqueado. Esta versão aceita somente mock e não movimenta dinheiro real.');
  }
  return status;
}

module.exports = { assertSafeRuntime, getProductionReadiness };
