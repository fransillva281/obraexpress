function escaparHtml(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, caractere => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[caractere]));
}

function emailRecuperacaoConfigurado() {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

async function enviarCodigoRecuperacao({ email, nome, codigo, validadeMinutos, idempotencyKey }) {
  if (!emailRecuperacaoConfigurado()) {
    return { enviado: false, motivo: 'provedor_nao_configurado' };
  }

  const remetente = process.env.EMAIL_FROM;
  const resposta = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      'User-Agent': 'ObraMobi/1.0',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {})
    },
    body: JSON.stringify({
      from: remetente,
      to: [email],
      subject: 'Código para redefinir sua senha — ObraMobi',
      html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#17202a">
        <h1 style="color:#d94f00">ObraMobi</h1>
        <p>Olá, ${escaparHtml(nome || 'usuário')}.</p>
        <p>Use o código abaixo para redefinir sua senha:</p>
        <div style="font-size:32px;font-weight:800;letter-spacing:8px;background:#fff3eb;padding:18px;text-align:center;border-radius:12px">${escaparHtml(codigo)}</div>
        <p>O código vale por <strong>${Number(validadeMinutos)} minutos</strong> e só pode ser usado uma vez.</p>
        <p>Se você não pediu essa alteração, ignore esta mensagem. Sua senha continua igual.</p>
        <p style="font-size:12px;color:#667085">A ObraMobi nunca pede sua senha nem este código por WhatsApp.</p>
      </div>`
    })
  });

  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    const erro = new Error('O provedor de e-mail recusou o envio');
    erro.status = resposta.status;
    erro.codigo = dados.name || dados.code || 'email_provider_error';
    throw erro;
  }
  return { enviado: true, id: dados.id || null };
}

module.exports = { escaparHtml, emailRecuperacaoConfigurado, enviarCodigoRecuperacao };
