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

  // POST /comerciante/upload/galeria — envia foto da galeria (índice 0-3, somente PRO)
  fastify.post('/galeria', {
    preHandler: autenticar,
    config: { rawBody: false },
  }, async (req, reply) => {
    const { base64, extensao, indice } = req.body
    const { id: comerciante_id, comercio_id } = req.comerciante

    if (!comercio_id) {
      return reply.status(400).send({ erro: 'Nenhum comércio vinculado à sua conta' })
    }
    if (!base64) {
      return reply.status(400).send({ erro: 'Imagem não enviada' })
    }
    const idx = Number(indice ?? 0)
    if (idx < 0 || idx > 3) {
      return reply.status(400).send({ erro: 'Índice inválido (0-3)' })
    }

    // Verifica plano PRO ativo
    const { data: assinatura } = await supabaseAdmin
      .from('assinaturas')
      .select('id, status')
      .eq('comerciante_id', comerciante_id)
      .eq('status', 'ativa')
      .single()

    if (!assinatura) {
      return reply.status(403).send({ erro: 'Recurso exclusivo para plano PRO' })
    }

    const ext = (extensao || 'jpg').toLowerCase().replace('jpeg', 'jpg')
    const dados = base64.replace(/^data:image\/\w+;base64,/, '')
    const buffer = Buffer.from(dados, 'base64')
    const path = `galeria/${comercio_id}_${idx}.${ext}`

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

    // Atualiza o array de fotos no índice correto
    const { data: comercio } = await supabaseAdmin
      .from('comercios')
      .select('fotos_galeria')
      .eq('id', comercio_id)
      .single()

    const galeria = Array.isArray(comercio?.fotos_galeria) ? [...comercio.fotos_galeria] : ['', '', '', '']
    while (galeria.length < 4) galeria.push('')
    galeria[idx] = publicUrl

    await supabaseAdmin
      .from('comercios')
      .update({ fotos_galeria: galeria })
      .eq('id', comercio_id)

    return { ok: true, url: publicUrl, galeria }
  })

  // POST /comerciante/upload/promocao — envia imagem de promoção
  fastify.post('/promocao', {
    preHandler: autenticar,
    config: { rawBody: false },
  }, async (req, reply) => {
    const { base64, extensao } = req.body
    const { comercio_id } = req.comerciante

    if (!comercio_id) return reply.status(400).send({ erro: 'Nenhum comércio vinculado à sua conta' })
    if (!base64) return reply.status(400).send({ erro: 'Imagem não enviada' })

    const ext = (extensao || 'jpg').toLowerCase().replace('jpeg', 'jpg')
    const dados = base64.replace(/^data:image\/\w+;base64,/, '')
    const buffer = Buffer.from(dados, 'base64')
    const path = `promocoes/${comercio_id}_${Date.now()}.${ext}`

    const { error: uploadError } = await supabaseAdmin.storage
      .from('comercios')
      .upload(path, buffer, {
        contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}`,
        upsert: false,
      })

    if (uploadError) return reply.status(500).send({ erro: uploadError.message })

    const { data: { publicUrl } } = supabaseAdmin.storage
      .from('comercios')
      .getPublicUrl(path)

    return { ok: true, url: publicUrl }
  })

  // DELETE /comerciante/upload/galeria/:indice — remove foto da galeria
  fastify.delete('/galeria/:indice', {
    preHandler: autenticar,
  }, async (req, reply) => {
    const { comercio_id } = req.comerciante
    const idx = Number(req.params.indice)

    if (!comercio_id) return reply.status(400).send({ erro: 'Nenhum comércio vinculado' })
    if (idx < 0 || idx > 3) return reply.status(400).send({ erro: 'Índice inválido (0-3)' })

    const { data: comercio } = await supabaseAdmin
      .from('comercios')
      .select('fotos_galeria')
      .eq('id', comercio_id)
      .single()

    const galeria = Array.isArray(comercio?.fotos_galeria) ? [...comercio.fotos_galeria] : ['', '', '', '']
    while (galeria.length < 4) galeria.push('')
    galeria[idx] = ''

    await supabaseAdmin
      .from('comercios')
      .update({ fotos_galeria: galeria })
      .eq('id', comercio_id)

    return { ok: true, galeria }
  })
}

module.exports = uploadRoutes
