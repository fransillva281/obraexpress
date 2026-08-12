'use strict';

function apenasDigitos(valor) {
  return String(valor || '').replace(/\D/g, '');
}

function todosIguais(documento) {
  return /^(\d)\1+$/.test(documento);
}

function validarCPF(valor) {
  const cpf = apenasDigitos(valor);
  if (cpf.length !== 11 || todosIguais(cpf)) return false;

  const calcularDigito = tamanho => {
    let soma = 0;
    for (let indice = 0; indice < tamanho; indice += 1) {
      soma += Number(cpf[indice]) * (tamanho + 1 - indice);
    }
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };

  return calcularDigito(9) === Number(cpf[9])
    && calcularDigito(10) === Number(cpf[10]);
}

function validarCNPJ(valor) {
  const cnpj = apenasDigitos(valor);
  if (cnpj.length !== 14 || todosIguais(cnpj)) return false;

  const calcularDigito = pesos => {
    const soma = pesos.reduce((total, peso, indice) => total + Number(cnpj[indice]) * peso, 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  const primeiro = calcularDigito([5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  if (primeiro !== Number(cnpj[12])) return false;
  const segundo = calcularDigito([6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return segundo === Number(cnpj[13]);
}

module.exports = { apenasDigitos, validarCPF, validarCNPJ };
