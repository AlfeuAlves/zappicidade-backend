// ============================================================
// ROTAS PÚBLICAS — Comentários de comércios
// ============================================================
const { supabase, supabaseAdmin } = require('../config/supabase')
const crypto = require('crypto')

// Palavras que jogam comentário para moderação manual
const PALAVRAS_SENSIVEIS = [
  'lixo', 'merda', 'idiota', 'burro', 'idiota', 'horrível', 'péssimo',
  'roubaram', 'golpe', 'fraude', 'ladrão', 'ladrões', 'fake', 'mentira',
]

function hashWa(numero) {
  const limpo = numero.replace(/\D/g, '').replace(/^(?!55)/, '55')
  return crypto.createHash('sha256').update(limpo).digest('hex')
}

function detectarStatus(texto) {
  const lower = texto.toLowerCase()
  return PALAVRAS_SENSIVEIS.some(p => lower.includes(p)) ? 'pendente' : 'aprovado'
}

async function comentariosRoutes(fastify) {

  // GET /comentarios/:comercio_id — lista comentários aprovados
  fastify.get('/:comercio_id', {
    schema: {
      params: { type: 'object', properties: { comercio_id: { type: 'string' } } },
      querystring: { type: 'object', properties: { limit: { type: 'integer', default: 10, maximum: 50 } } }
    }
  }, async (req, reply) => {
    const { comercio_id } = req.params
    const { limit = 10 } = req.query

    const { data, error } = await supabase
      .from('comentarios')
      .select('id, nome, texto, estrelas, criado_em')
      .eq('comercio_id', comercio_id)
      .eq('status', 'aprovado')
      .eq('reportado', false)
      .order('criado_em', { ascending: false })
      .limit(limit)

    if (error) return reply.status(500).send({ erro: error.message })
    return { data: data || [] }
  })

  // POST /comentarios — cria comentário
  fastify.post('/', {
    config: { rateLimit: { max: 5, timeWindow: '10 minutes' } },
    schema: {
      body: {
        type: 'object',
        required: ['comercio_id', 'whatsapp', 'texto', 'estrelas'],
        properties: {
          comercio_id: { type: 'string' },
          whatsapp:    { type: 'string' },
          nome:        { type: 'string', maxLength: 50 },
          texto:       { type: 'string', minLength: 5, maxLength: 500 },
          estrelas:    { type: 'integer', minimum: 1, maximum: 5 },
        }
      }
    }
  }, async (req, reply) => {
    const { comercio_id, whatsapp, nome, texto, estrelas } = req.body
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown'

    const whatsapp_hash = hashWa(whatsapp)
    const ip_hash = crypto.createHash('sha256').update(ip).digest('hex')
    const status = detectarStatus(texto)
    const aprovado_em = status === 'aprovado' ? new Date().toISOString() : null

    const { data, error } = await supabaseAdmin
      .from('comentarios')
      .insert({ comercio_id, whatsapp_hash, nome: nome?.trim() || null, texto: texto.trim(), estrelas, status, ip_hash, aprovado_em })
      .select('id, status')
      .single()

    if (error) {
      // Violação do índice único = já comentou
      if (error.code === '23505') {
        return reply.status(409).send({ erro: 'Você já deixou um comentário neste comércio.' })
      }
      return reply.status(500).send({ erro: error.message })
    }

    const msg = status === 'pendente'
      ? 'Comentário recebido! Será publicado após revisão.'
      : 'Comentário publicado com sucesso!'

    return reply.status(201).send({ ok: true, id: data.id, status, mensagem: msg })
  })

  // POST /comentarios/:id/reportar — sinaliza comentário inapropriado
  fastify.post('/:id/reportar', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: { params: { type: 'object', properties: { id: { type: 'string' } } } }
  }, async (req, reply) => {
    const { id } = req.params

    const { error } = await supabaseAdmin
      .from('comentarios')
      .update({ reportado: true })
      .eq('id', id)
      .eq('status', 'aprovado') // só reporta aprovados

    if (error) return reply.status(500).send({ erro: error.message })
    return { ok: true, mensagem: 'Comentário reportado. Nossa equipe irá analisar.' }
  })
}

module.exports = comentariosRoutes
