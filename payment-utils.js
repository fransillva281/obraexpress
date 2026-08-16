const crypto = require('crypto');

const STATUS_PAGAMENTO = Object.freeze({
  AGUARDANDO: 'aguardando',
  RECEBIDO: 'recebido',
  CANCELADO: 'cancelado',
  EXPIRADO: 'expirado'
});

function criarReferenciaPagamentoTeste({ pedidoId, valor, agora = new Date(), nonce }) {
  const identificador = nonce || crypto.randomBytes(8).toString('hex').toUpperCase();
  const valorNormalizado = Number(valor);
  if (!Number.isInteger(Number(pedidoId)) || Number(pedidoId) <= 0) {
    throw new Error('Pedido inválido para pagamento');
  }
  if (!Number.isFinite(valorNormalizado) || valorNormalizado <= 0) {
    throw new Error('Valor inválido para pagamento');
  }

  const expiraEm = new Date(agora.getTime() + 30 * 60 * 1000);
  return {
    provedor: 'mock',
    provedorPagamentoId: `mock_${pedidoId}_${identificador.toLowerCase()}`,
    idempotencyKey: `pedido_${pedidoId}_pix`,
    // Este texto não segue o padrão EMV do Pix e não pode gerar transferência real.
    pixCopiaCola: `OBRAMOBI.TESTE|PEDIDO=${pedidoId}|VALOR=${valorNormalizado.toFixed(2)}|ID=${identificador}`,
    expiraEm
  };
}

function pagamentoExpirado(pagamento, agora = new Date()) {
  return pagamento?.status === STATUS_PAGAMENTO.AGUARDANDO
    && pagamento?.expira_em
    && new Date(pagamento.expira_em).getTime() <= agora.getTime();
}

module.exports = {
  STATUS_PAGAMENTO,
  criarReferenciaPagamentoTeste,
  pagamentoExpirado
};
