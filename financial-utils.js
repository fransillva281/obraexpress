const PLANOS_LOJA = new Set(['loja', 'entrega_obraexpress']);

function arredondarDinheiro(valor) {
  return Math.round((Number(valor) + Number.EPSILON) * 100) / 100;
}

function normalizarPlanoLoja(plano) {
  return PLANOS_LOJA.has(plano) ? plano : 'entrega_obraexpress';
}

function calcularFinanceiroPedido({
  totalProdutos,
  taxaEntrega,
  tipoEntrega,
  planoLoja,
  comissaoPercentual = 10,
  percentualEntregador = 85
}) {
  const produtos = arredondarDinheiro(totalProdutos);
  const entrega = tipoEntrega === 'entrega' ? arredondarDinheiro(taxaEntrega) : 0;
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
    totalFinal: arredondarDinheiro(produtos + entrega),
    taxaEntrega: entrega
  };
}

module.exports = {
  arredondarDinheiro,
  calcularFinanceiroPedido,
  normalizarPlanoLoja
};
