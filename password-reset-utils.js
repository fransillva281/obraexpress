const crypto = require('crypto');

const TIPOS_CONTA = new Set(['cliente', 'loja', 'entregador']);
const VALIDADE_CODIGO_MINUTOS = 10;
const MAX_TENTATIVAS_CODIGO = 5;

function normalizarTipoConta(tipo) {
  const normalizado = String(tipo || '').trim().toLowerCase();
  return TIPOS_CONTA.has(normalizado) ? normalizado : null;
}

function normalizarEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function gerarCodigoRecuperacao() {
  return String(crypto.randomInt(100000, 1000000));
}

function criarHashCodigo({ tipo, usuarioId, codigo, segredo }) {
  return crypto.createHmac('sha256', String(segredo))
    .update(`${tipo}|${usuarioId}|${codigo}`)
    .digest('hex');
}

function codigoFormatoValido(codigo) {
  return /^\d{6}$/.test(String(codigo || '').trim());
}

module.exports = {
  TIPOS_CONTA,
  VALIDADE_CODIGO_MINUTOS,
  MAX_TENTATIVAS_CODIGO,
  normalizarTipoConta,
  normalizarEmail,
  gerarCodigoRecuperacao,
  criarHashCodigo,
  codigoFormatoValido
};
