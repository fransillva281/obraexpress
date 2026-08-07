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

function calcularFretePorFaixa(distanciaKm, configuracao = {}) {
  const distancia = Number(distanciaKm);
  const distanciaMaxima = Number(configuracao.distancia_maxima_entrega ?? 8);
  if (!Number.isFinite(distancia) || distancia < 0 || !Number.isFinite(distanciaMaxima) || distanciaMaxima <= 0) {
    throw new Error('Distância de entrega inválida');
  }
  if (distancia > distanciaMaxima) {
    return { disponivel: false, distanciaMaxima, valor: 0, faixa: `acima de ${distanciaMaxima} km` };
  }
  const faixas = [
    [2, Number(configuracao.frete_faixa_ate_2 ?? 5.99), 'até 2 km'],
    [4, Number(configuracao.frete_faixa_ate_4 ?? 7.99), 'de 2,1 a 4 km'],
    [6, Number(configuracao.frete_faixa_ate_6 ?? 10.99), 'de 4,1 a 6 km'],
    [distanciaMaxima, Number(configuracao.frete_faixa_ate_8 ?? 13.99), `de 6,1 a ${distanciaMaxima} km`]
  ];
  const faixa = faixas.find(([limite]) => distancia <= limite) || faixas[faixas.length - 1];
  if (!Number.isFinite(faixa[1]) || faixa[1] < 0) throw new Error('Configuração das faixas de frete inválida');
  return { disponivel: true, distanciaMaxima, valor: arredondarDinheiro(faixa[1]), faixa: faixa[2] };
}

function calcularGanhoLiquidoEntregador({ distanciaColetaKm = 0, distanciaEntregaKm = 0, adicionalPercentual = 0, configuracao = {} }) {
  const coleta = Math.max(0, Number(distanciaColetaKm) || 0);
  const entrega = Math.max(0, Number(distanciaEntregaKm) || 0);
  const totalRota = coleta + entrega;
  const minimo = Number(configuracao.ganho_minimo_entregador ?? 7.5);
  const valorKm = Number(configuracao.ganho_km_entregador ?? 1.5);
  const limiteBonus = Number(configuracao.limite_bonus_entregador_percentual ?? 15);
  if (![minimo, valorKm, limiteBonus].every(Number.isFinite) || minimo < 0 || valorKm < 0 || limiteBonus < 0) {
    throw new Error('Configuração de ganho do entregador inválida');
  }
  const bonus = Math.max(0, Math.min(Number(adicionalPercentual) || 0, limiteBonus));
  const valorBase = Math.max(minimo, valorKm * totalRota);
  return {
    distanciaColetaKm: Math.round(coleta * 10) / 10,
    distanciaEntregaKm: Math.round(entrega * 10) / 10,
    distanciaTotalKm: Math.round(totalRota * 10) / 10,
    valorBase: arredondarDinheiro(valorBase),
    bonusPercentual: bonus,
    valorLiquido: arredondarDinheiro(valorBase * (1 + bonus / 100))
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
  calcularFretePorFaixa,
  calcularGanhoLiquidoEntregador,
  calcularPercentualPromocional,
  calcularTaxaPedidoPequeno,
  calcularFinanceiroPedido,
  normalizarPlanoLoja
};
