// ============================================================
// ROTAS — Informações da Cidade
// Público: GET /informacoes, POST /informacoes
// Admin:   GET/PUT/DELETE /admin/informacoes (em admin.js)
// ============================================================

const { supabase, supabaseAdmin } = require('../config/supabase')

async function informacoesRoutes(fastify) {

  // GET /informacoes — lista aprovadas (público)
  fastify.get('/', async (req, reply) => {
    const { categoria, busca, limit = 20, page = 1 } = req.query
    const offset = (parseInt(page) - 1) * parseInt(limit)

    let query = supabaseAdmin
      .from('informacoes_cidade')
      .select('id, titulo, conteudo, categoria, icone, fonte, valido_ate, criado_em', { count: 'exact' })
      .eq('status', 'aprovado')
      .order('criado_em', { ascending: false })
      .range(offset, offset + parseInt(limit) - 1)

    if (categoria) query = query.eq('categoria', categoria)
    if (busca)     query = query.or(`titulo.ilike.%${busca}%,conteudo.ilike.%${busca}%`)

    const { data, error, count } = await query
    if (error) return reply.status(500).send({ erro: error.message })
    return { data, meta: { total: count, page: parseInt(page), limit: parseInt(limit) } }
  })

  // POST /informacoes — envio público (entra como pendente)
  fastify.post('/', async (req, reply) => {
    const { titulo, conteudo, categoria, icone, fonte, valido_ate, whatsapp_colaborador } = req.body || {}

    if (!titulo?.trim())    return reply.status(400).send({ erro: 'Título obrigatório' })
    if (!conteudo?.trim())  return reply.status(400).send({ erro: 'Conteúdo obrigatório' })
    if (!categoria)         return reply.status(400).send({ erro: 'Categoria obrigatória' })

    const categorias = ['transporte', 'saude', 'documentos', 'eventos', 'servicos', 'outros']
    if (!categorias.includes(categoria)) return reply.status(400).send({ erro: 'Categoria inválida' })

    const { data, error } = await supabaseAdmin
      .from('informacoes_cidade')
      .insert({
        titulo:               titulo.trim(),
        conteudo:             conteudo.trim(),
        categoria,
        icone:                icone || null,
        fonte:                fonte?.trim() || null,
        valido_ate:           valido_ate || null,
        whatsapp_colaborador: whatsapp_colaborador?.replace(/\D/g, '') || null,
        status:               'pendente',
      })
      .select('id')
      .single()

    if (error) return reply.status(500).send({ erro: error.message })
    return reply.status(201).send({ ok: true, id: data.id })
  })
}

module.exports = informacoesRoutes
