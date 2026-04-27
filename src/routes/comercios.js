// ============================================================
// ROTAS PÚBLICAS — Comércios
// ============================================================
const { supabase } = require('../config/supabase')

async function comerciosRoutes(fastify) {

  // GET /comercios — lista com filtros
  fastify.get('/', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          cidade:     { type: 'string' },
          categoria:  { type: 'string' },
          bairro:     { type: 'string' },
          aberto:        { type: 'boolean' },
          tem_whatsapp:  { type: 'boolean' },
          plano_pago:    { type: 'boolean' },
          busca:         { type: 'string' },
          lat:        { type: 'number' },
          lng:        { type: 'number' },
          raio_km:    { type: 'number' },
          page:       { type: 'integer', default: 1 },
          limit:      { type: 'integer', default: 20, maximum: 100 }
        }
      }
    }
  }, async (req, reply) => {
    const {
      cidade, categoria, bairro, aberto,
      tem_whatsapp, plano_pago,
      busca, page = 1, limit = 20
    } = req.query

    const { data, error } = await supabase.rpc('buscar_comercios', {
      p_termo:         busca        || null,
      p_categoria:     categoria    || null,
      p_bairro:        bairro       || null,
      p_cidade:        cidade       || null,
      p_aberto:        aberto       ?? null,
      p_tem_whatsapp:  tem_whatsapp ?? null,
      p_plano_pago:    plano_pago   ?? null,
      p_page:          Number(page),
      p_limit:         Number(limit)
    })

    if (error) {
      return reply.status(500).send({ erro: 'Erro ao buscar comércios', detalhe: error.message })
    }

    const total = data?.[0]?.total_count ?? 0

    return {
      data,
      meta: {
        total,
        page: Number(page),
        limit: Number(limit),
        paginas: Math.ceil(total / limit)
      }
    }
  })

  // GET /comercios/:slug — detalhe de um comércio
  fastify.get('/:slug', async (req, reply) => {
    const { slug } = req.params

    const { data, error } = await supabase
      .from('vw_comercios_publicos')
      .select('*, tem_pro_ativo, tem_fundador_ativo, tem_selo_fundador')
      .eq('slug', slug)
      .single()

    if (error || !data) {
      return reply.status(404).send({ erro: 'Comércio não encontrado' })
    }

    // Busca fotos da galeria PRO (coluna fotos_galeria, separada do campo fotos da view)
    const { data: comercioDb } = await supabase
      .from('comercios')
      .select('fotos_galeria')
      .eq('id', data.id)
      .single()

    const fotosGaleria = (comercioDb?.fotos_galeria || []).filter(Boolean)

    // Busca promoções ativas
    const { data: promocoes } = await supabase
      .from('promocoes')
      .select('id, titulo, descricao, tipo, preco_de, preco_por, percentual_desconto, imagem_url, fim, quantidade_limite, quantidade_usada')
      .eq('comercio_id', data.id)
      .eq('status', 'ativa')
      .or('fim.is.null,fim.gt.' + new Date().toISOString())
      .order('criado_em', { ascending: false })

    return { ...data, fotos: fotosGaleria, promocoes: promocoes || [] }
  })

  // GET /comercios/categorias — lista todas as categorias ativas
  fastify.get('/categorias', async (req, reply) => {
    const { data, error } = await supabase
      .from('categorias')
      .select('id, nome, slug, icone')
      .eq('ativo', true)
      .order('ordem')

    if (error) return reply.status(500).send({ erro: error.message })
    return data
  })

  // GET /comercios/categoria/:slug — comércios por categoria
  fastify.get('/categoria/:slug', async (req, reply) => {
    const { slug } = req.params
    const { cidade, page = 1, limit = 20 } = req.query
    const offset = (page - 1) * limit

    let query = supabase
      .from('vw_comercios_publicos')
      .select('*', { count: 'exact' })
      .eq('categoria_slug', slug)
      .eq('status_operacional', 'ativo')
      .range(offset, offset + limit - 1)
      .order('destaque', { ascending: false })
      .order('avaliacao', { ascending: false })

    if (cidade) query = query.ilike('cidade_nome', `%${cidade}%`)

    const { data, error, count } = await query

    if (error) {
      return reply.status(500).send({ erro: error.message })
    }

    return {
      data,
      meta: { total: count, page, limit, paginas: Math.ceil(count / limit) }
    }
  })
}

module.exports = comerciosRoutes
