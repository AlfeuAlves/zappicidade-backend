// ============================================================
// ROTAS PÚBLICAS — Cidades e Categorias
// ============================================================
const { supabase } = require('../config/supabase')

async function cidadesRoutes(fastify) {

  // GET /cidades — lista cidades ativas
  fastify.get('/', async (req, reply) => {
    const { data, error } = await supabase
      .from('cidades')
      .select('id, nome, estado, lat, lng')
      .eq('ativa', true)
      .order('nome')

    if (error) return reply.status(500).send({ erro: error.message })
    return data
  })

  // GET /cidades/:nome/resumo — resumo da cidade
  fastify.get('/:nome/resumo', async (req, reply) => {
    const { nome } = req.params

    const { data: cidade, error } = await supabase
      .from('cidades')
      .select('id, nome, estado, lat, lng')
      .ilike('nome', nome)
      .single()

    if (error || !cidade) {
      return reply.status(404).send({ erro: 'Cidade não encontrada' })
    }

    // Total de comércios
    const { count: totalComercios } = await supabase
      .from('comercios')
      .select('id', { count: 'exact' })
      .eq('cidade_id', cidade.id)
      .eq('status_operacional', 'ativo')

    // Total verificados
    const { count: verificados } = await supabase
      .from('comercios')
      .select('id', { count: 'exact' })
      .eq('cidade_id', cidade.id)
      .eq('verificado', true)

    // Comércios por categoria
    const { data: porCategoria } = await supabase
      .from('comercios')
      .select('categoria_id, categorias(nome, slug, icone)')
      .eq('cidade_id', cidade.id)
      .eq('status_operacional', 'ativo')
      .not('categoria_id', 'is', null)

    // Agrupa por categoria
    const categorias = {}
    porCategoria?.forEach(c => {
      if (c.categorias) {
        const key = c.categorias.slug
        if (!categorias[key]) {
          categorias[key] = { ...c.categorias, total: 0 }
        }
        categorias[key].total++
      }
    })

    return {
      cidade,
      stats: {
        total_comercios: totalComercios,
        verificados,
        categorias: Object.values(categorias).sort((a, b) => b.total - a.total)
      }
    }
  })
  // GET /cidades/:nome/bairros — lista bairros únicos da cidade
  fastify.get('/:nome/bairros', async (req, reply) => {
    const { nome } = req.params

    const { data: cidade, error: errCidade } = await supabase
      .from('cidades')
      .select('id')
      .ilike('nome', nome)
      .single()

    if (errCidade || !cidade) {
      return reply.status(404).send({ erro: 'Cidade não encontrada' })
    }

    const { data, error } = await supabase
      .from('comercios')
      .select('bairro')
      .eq('cidade_id', cidade.id)
      .eq('status_operacional', 'ativo')
      .not('bairro', 'is', null)
      .neq('bairro', '')

    if (error) return reply.status(500).send({ erro: error.message })

    const bairros = [...new Set(data.map(r => r.bairro).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'pt'))

    return bairros
  })
}

module.exports = cidadesRoutes
