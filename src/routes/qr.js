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

    try {
      // Busca o QR pelo código
      const { data: qr, error } = await supabaseAdmin
        .from('qrcodes')
        .select('id, total_scans, comercio_id')
        .eq('codigo', codigo)
        .maybeSingle()

      if (error || !qr) {
        return reply.status(302).header('Location', SITE_HOME).send()
      }

      // Busca o nome do comércio separadamente
      let nomeComercio = 'o estabelecimento'
      if (qr.comercio_id) {
        const { data: comercio } = await supabaseAdmin
          .from('comercios')
          .select('nome')
          .eq('id', qr.comercio_id)
          .maybeSingle()
        if (comercio?.nome) nomeComercio = comercio.nome
      }

      // Incrementa scan_count (fire-and-forget)
      supabaseAdmin
        .from('qrcodes')
        .update({
          total_scans: (qr.total_scans || 0) + 1,
          ultima_vez:  new Date().toISOString(),
        })
        .eq('id', qr.id)
        .then(() => {})
        .catch(() => {})

      // Redireciona para WhatsApp com contexto
      const texto = `Oi Zappi! Quero saber sobre ${nomeComercio}`
      const waUrl = `https://wa.me/${WHATSAPP_BOT}?text=${encodeURIComponent(texto)}`

      return reply.status(302).header('Location', waUrl).send()

    } catch (e) {
      fastify.log.error('QR redirect error:', e.message)
      return reply.status(302).header('Location', SITE_HOME).send()
    }
  })
}

module.exports = qrRoutes
