// ============================================================
// LOGGER — Registro centralizado de eventos do sistema
// ============================================================
const { supabaseAdmin } = require('../config/supabase')

async function log(nivel, categoria, mensagem, detalhe = null, usuario_id = null, usuario_tipo = 'sistema') {
  try {
    await supabaseAdmin.from('logs_sistema').insert({
      nivel,
      categoria,
      mensagem,
      detalhe: detalhe ?? null,
      usuario_id: usuario_id ?? null,
      usuario_tipo,
    })
  } catch (e) {
    // Nunca deixar o logger quebrar a aplicação
    console.error('[logger] Falha ao salvar log:', e.message)
  }
}

module.exports = {
  info:    (cat, msg, det, uid, utipo) => log('info',    cat, msg, det, uid, utipo),
  aviso:   (cat, msg, det, uid, utipo) => log('aviso',   cat, msg, det, uid, utipo),
  erro:    (cat, msg, det, uid, utipo) => log('erro',    cat, msg, det, uid, utipo),
  critico: (cat, msg, det, uid, utipo) => log('critico', cat, msg, det, uid, utipo),
}
