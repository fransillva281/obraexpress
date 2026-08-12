function calcularJanelaOfertaEntrega(pedido, distanciaColetaKm, configuracao, agora = new Date()) {
  const raioInicial = Number(configuracao.raio_preferencial_coleta || 3);
  const raioIntermediario = Math.max(raioInicial, Number(configuracao.raio_maximo_coleta || 5));
  const raioFinal = Math.max(raioIntermediario, Number(configuracao.raio_expansao_coleta || 8));
  const tempoEtapa = Math.max(10, Number(configuracao.tempo_expansao_coleta_segundos || 30));
  const inicio = new Date(pedido.data_separado || pedido.data_pedido || agora).getTime();
  const inicioValido = Number.isFinite(inicio) ? inicio : agora.getTime();
  const segundosDecorridos = Math.max(0, Math.floor((agora.getTime() - inicioValido) / 1000));

  let etapa = 1;
  let raioAtual = raioInicial;
  let proximaExpansaoEmSegundos = Math.max(0, tempoEtapa - segundosDecorridos);
  if (segundosDecorridos >= tempoEtapa * 2) {
    etapa = 3;
    raioAtual = raioFinal;
    proximaExpansaoEmSegundos = null;
  } else if (segundosDecorridos >= tempoEtapa) {
    etapa = 2;
    raioAtual = raioIntermediario;
    proximaExpansaoEmSegundos = Math.max(0, tempoEtapa * 2 - segundosDecorridos);
  }

  const distancia = Number(distanciaColetaKm);
  let liberadaEmSegundos = null;
  if (distancia <= raioInicial) liberadaEmSegundos = 0;
  else if (distancia <= raioIntermediario) liberadaEmSegundos = Math.max(0, tempoEtapa - segundosDecorridos);
  else if (distancia <= raioFinal) liberadaEmSegundos = Math.max(0, tempoEtapa * 2 - segundosDecorridos);

  return {
    etapa,
    raioAtual,
    raioFinal,
    proximaExpansaoEmSegundos,
    liberadaEmSegundos,
    disponivelAgora: liberadaEmSegundos === 0
  };
}

module.exports = { calcularJanelaOfertaEntrega };
