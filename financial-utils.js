const PLANOS_LOJA = new Set(['loja', 'entrega_obraexpress']);

function arredondarDinheiro(valor) {
  return Math.round((Number(valor) + Number.EPSILON) * 100) / 100;
}

function normalizarPlanoLoja(plano) {
  return PLANOS_LOJA.has(plano) ? plano : 'entrega_obraexpress';
}

function calcularPercentualPromocional(inicioPromocao, agora = new Date()) {
  if (!inicioPromocao) return 5;
  const inicio = new Date(inicioPromocao);
  if (Number.isNaN(inicio.getTime())) return 5;
  const fimPromocao = new Date(inicio);
  fimPromocao.setUTCMonth(fimPromocao.getUTCMonth() + 5);
  return agora < fimPromocao ? 5 : 7;
}

function calcularTaxaPedidoPequeno(totalProdutos, configuracao = {}) {
  const produtos = arredondarDinheiro(totalProdutos);
  const pedidoMinimo = arredondarDinheiro(configuracao.pedido_minimo ?? 15);
  const limitePedidoPequeno = arredondarDinheiro(configuracao.limite_pedido_pequeno ?? 25);
  const taxaConfigurada = arredondarDinheiro(configuracao.taxa_pedido_pequeno ?? 1.99);

  if (![produtos, pedidoMinimo, limitePedidoPequeno, taxaConfigurada].every(Number.isFinite)) {
    throw new Error('Configuração de pedido mínimo inválida');
  }
  if (pedidoMinimo < 0 || limitePedidoPequeno < pedidoMinimo || taxaConfigurada < 0) {
    throw new Error('Configuração de pedido mínimo inválida');
  }

  const permitido = produtos >= pedidoMinimo;
  return {
    permitido,
    pedidoMinimo,
    limitePedidoPequeno,
    valorFaltante: permitido ? 0 : arredondarDinheiro(pedidoMinimo - produtos),
    taxaAplicada: permitido && produtos < limitePedidoPequeno ? taxaConfigurada : 0
  };
}

function calcularFinanceiroPedido({
  totalProdutos,
  taxaEntrega,
  taxaPedidoPequeno = 0,
  tipoEntrega,
  planoLoja,
  comissaoPercentual = 5,
  percentualEntregador = 95
}) {
  const produtos = arredondarDinheiro(totalProdutos);
  const entrega = tipoEntrega === 'entrega' ? arredondarDinheiro(taxaEntrega) : 0;
  const pedidoPequeno = arredondarDinheiro(taxaPedidoPequeno);
  const plano = normalizarPlanoLoja(planoLoja);
  const percentual = Number(comissaoPercentual);
  const comissaoLoja = arredondarDinheiro(produtos * percentual / 100);
  const lojaRecebeFrete = plano === 'loja' && tipoEntrega === 'entrega' ? entrega : 0;
  const valorLiquidoLoja = arredondarDinheiro(produtos - comissaoLoja + lojaRecebeFrete);
  const valorMotoboy = plano === 'entrega_obraexpress' && tipoEntrega === 'entrega'
    ? arredondarDinheiro(entrega * Number(percentualEntregador) / 100)
    : 0;
  const valorPlataformaEntrega = arredondarDinheiro(entrega - valorMotoboy - lojaRecebeFrete);

  return {
    planoLoja: plano,
    comissaoPercentual: percentual,
    valorComissaoLoja: comissaoLoja,
    valorLiquidoLoja,
    valorMotoboy,
    valorPlataformaEntrega,
    valorPlataformaPedidoPequeno: pedidoPequeno,
    totalFinal: arredondarDinheiro(produtos + entrega + pedidoPequeno),
    taxaEntrega: entrega,
    taxaPedidoPequeno: pedidoPequeno
  };
}

module.exports = {
  arredondarDinheiro,
  calcularPercentualPromocional,
  calcularTaxaPedidoPequeno,
  calcularFinanceiroPedido,
  normalizarPlanoLoja
};
