// ============================================================
// ROTAS PROTEGIDAS — Dashboard do Comerciante
// ============================================================
const { supabaseAdmin } = require('../../config/supabase')
const { autenticar } = require('../../middleware/auth')

async function dashboardRoutes(fastify) {

  // GET /comerciante/dashboard — métricas principais
  fastify.get('/', { preHandler: autenticar }, async (req, reply) => {
    const { comercio_id } = req.comerciante

    if (!comercio_id) {
      return reply.status(400).send({ erro: 'Nenhum comércio vinculado à sua conta' })
    }

    const hoje = new Date()
    const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString()
    const inicioMesAnterior = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1).toISOString()
    const fimMesAnterior = new Date(hoje.getFullYear(), hoje.getMonth(), 0).toISOString()
    const ultimos30dias = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

    // Executa todas as consultas em paralelo
    const [
      visualizacoesResult,
      visualizacoesAnteriorResult,
      leadsResult,
      leadsAnteriorResult,
      optinsResult,
      promocoesResult,
      dashboardResult
    ] = await Promise.all([
      // Visualizações do mês atual
      supabaseAdmin
        .from('analytics_visualizacoes')
        .select('id', { count: 'exact', head: true })
        .eq('comercio_id', comercio_id)
        .gte('criado_em', inicioMes),

      // Visualizações do mês anterior (para comparação)
      supabaseAdmin
        .from('analytics_visualizacoes')
        .select('id', { count: 'exact', head: true })
        .eq('comercio_id', comercio_id)
        .gte('criado_em', inicioMesAnterior)
        .lte('criado_em', fimMesAnterior),

      // Leads dos últimos 30 dias
      supabaseAdmin
        .from('leads')
        .select('id, acao, criado_em', { count: 'exact' })
        .eq('comercio_id', comercio_id)
        .gte('criado_em', ultimos30dias)
        .order('criado_em', { ascending: false })
        .limit(10),

      // Leads do mês anterior
      supabaseAdmin
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .eq('comercio_id', comercio_id)
        .gte('criado_em', inicioMesAnterior)
        .lte('criado_em', fimMesAnterior),

      // Total de opt-ins ativos
      supabaseAdmin
        .from('optins')
        .select('id', { count: 'exact', head: true })
        .eq('comercio_id', comercio_id)
        .eq('status', 'ativo'),

      // Promoções ativas
      supabaseAdmin
        .from('promocoes')
        .select('id, titulo, tipo, preco_por, percentual_desconto, quantidade_limite, quantidade_usada, fim')
        .eq('comercio_id', comercio_id)
        .eq('status', 'ativa')
        .order('criado_em', { ascending: false }),

      // Dados do painel (view)
      supabaseAdmin
        .from('vw_dashboard_comerciante')
        .select('*')
        .eq('comercio_id', comercio_id)
        .single()
    ])

    // Visualizações por dia (últimos 30 dias) — para o gráfico
    const { data: vizPorDia } = await supabaseAdmin
      .from('analytics_visualizacoes')
      .select('criado_em')
      .eq('comercio_id', comercio_id)
      .gte('criado_em', ultimos30dias)
      .order('criado_em', { ascending: true })

    // Agrupa por dia
    const graficoDias = {}
    vizPorDia?.forEach(v => {
      const dia = v.criado_em.split('T')[0]
      graficoDias[dia] = (graficoDias[dia] || 0) + 1
    })

    const vizMesAtual = visualizacoesResult.count || 0
    const vizMesAnterior = visualizacoesAnteriorResult.count || 0
    const variacao_viz = vizMesAnterior > 0
      ? Math.round(((vizMesAtual - vizMesAnterior) / vizMesAnterior) * 100)
      : 100

    const leadsMes = leadsResult.count || 0
    const leadsMesAnterior = leadsAnteriorResult.count || 0
    const variacao_leads = leadsMesAnterior > 0
      ? Math.round(((leadsMes - leadsMesAnterior) / leadsMesAnterior) * 100)
      : 100

    return {
      metricas: {
        visualizacoes_mes: vizMesAtual,
        visualizacoes_variacao: variacao_viz,
        leads_30dias: leadsMes,
        leads_variacao: variacao_leads,
        optins_ativos: optinsResult.count || 0,
        promocoes_ativas: promocoesResult.data?.length || 0
      },
      grafico_visualizacoes: Object.entries(graficoDias).map(([dia, total]) => ({ dia, total })),
      ultimos_leads: leadsResult.data || [],
      promocoes_ativas: promocoesResult.data || [],
      resumo: dashboardResult.data || null
    }
  })

  // GET /comerciante/dashboard/leads — histórico completo de leads
  fastify.get('/leads', { preHandler: autenticar }, async (req, reply) => {
    const { comercio_id } = req.comerciante
    const { page = 1, limit = 20, acao, de, ate } = req.query
    const offset = (page - 1) * limit

    let query = supabaseAdmin
      .from('leads')
      .select('id, acao, origem, utm_source, utm_campaign, criado_em, usuarios_cidadaos(whatsapp, nome)', { count: 'exact' })
      .eq('comercio_id', comercio_id)
      .range(offset, offset + limit - 1)
      .order('criado_em', { ascending: false })

    if (acao) query = query.eq('acao', acao)
    if (de)   query = query.gte('criado_em', de)
    if (ate)  query = query.lte('criado_em', ate)

    const { data, error, count } = await query

    if (error) return reply.status(500).send({ erro: error.message })

    return {
      data,
      meta: { total: count, page, limit, paginas: Math.ceil(count / limit) }
    }
  })

  // GET /comerciante/dashboard/optins — lista de opt-ins
  fastify.get('/optins', { preHandler: autenticar }, async (req, reply) => {
    const { comercio_id } = req.comerciante
    const { page = 1, limit = 50, status = 'ativo' } = req.query
    const offset = (page - 1) * limit

    const { data, error, count } = await supabaseAdmin
      .from('optins')
      .select('id, status, origem, consentido_em, usuarios_cidadaos(whatsapp, nome)', { count: 'exact' })
      .eq('comercio_id', comercio_id)
      .eq('status', status)
      .range(offset, offset + limit - 1)
      .order('consentido_em', { ascending: false })

    if (error) return reply.status(500).send({ erro: error.message })

    return {
      data,
      meta: { total: count, page, limit, paginas: Math.ceil(count / limit) }
    }
  })
}

module.exports = dashboardRoutes
