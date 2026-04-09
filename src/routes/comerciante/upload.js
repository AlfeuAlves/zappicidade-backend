// ============================================================
// ROTAS — Upload de mídias do comerciante
// ============================================================
const { supabaseAdmin } = require('../../config/supabase')
const { autenticar } = require('../../middleware/auth')

async function uploadRoutes(fastify) {

  // POST /comerciante/upload/capa — envia foto de capa do comércio
  fastify.post('/capa', {
    preHandler: autenticar,
    config: { rawBody: false },
  }, async (req, reply) => {
    const { base64, extensao } = req.body
    const { comercio_id } = req.comerciante

    if (!comercio_id) {
      return reply.status(400).send({ erro: 'Nenhum comércio vinculado à sua conta' })
    }
    if (!base64) {
      return reply.status(400).send({ erro: 'Imagem não enviada' })
    }

    const ext = (extensao || 'jpg').toLowerCase().replace('jpeg', 'jpg')
    const dados = base64.replace(/^data:image\/\w+;base64,/, '')
    const buffer = Buffer.from(dados, 'base64')
    const path = `capas/${comercio_id}.${ext}`

    const { error: uploadError } = await supabaseAdmin.storage
      .from('comercios')
      .upload(path, buffer, {
        contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}`,
        upsert: true,
      })

    if (uploadError) {
      return reply.status(500).send({ erro: uploadError.message })
    }

    const { data: { publicUrl } } = supabaseAdmin.storage
      .from('comercios')
      .getPublicUrl(path)

    await supabaseAdmin
      .from('comercios')
      .update({ foto_capa_url: publicUrl })
      .eq('id', comercio_id)

    return { ok: true, url: publicUrl }
  })
}

module.exports = uploadRoutes
