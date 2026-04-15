// ============================================================
// ROTA PÚBLICA — QR Code redirect
// GET /qr/:codigo
// Registra o scan e redireciona para o WhatsApp do bot
// ============================================================
const { supabaseAdmin } = require('../config/supabase')

const WHATSAPP_BOT = '5591993870599'
const SITE_HOME    = 'https://www.zappicidadebarcarena.com.br'

async function qrRoutes(fastify) {

  fastify.get('/:codigo', async (req, reply) => {
    const { codigo } = req.params

    const { data: qr, error } = await supabaseAdmin
      .from('qrcodes')
      .select('id, total_scans, comercio_id, comercios(nome)')
      .eq('codigo', codigo)
      .maybeSingle()

    if (error || !qr) {
      return reply.redirect(302, SITE_HOME)
    }

    // Incrementa scan_count e registra última vez (fire-and-forget)
    supabaseAdmin
      .from('qrcodes')
      .update({
        total_scans: (qr.total_scans || 0) + 1,
        ultima_vez:  new Date().toISOString(),
      })
      .eq('id', qr.id)
      .then(() => {})
      .catch(() => {})

    // Monta URL do WhatsApp com contexto do comércio
    const nomeComercio = qr.comercios?.nome || 'o estabelecimento'
    const texto = `Oi Zappi! Quero saber sobre ${nomeComercio}`
    const waUrl = `https://wa.me/${WHATSAPP_BOT}?text=${encodeURIComponent(texto)}`

    return reply.redirect(302, waUrl)
  })
}

module.exports = qrRoutes
