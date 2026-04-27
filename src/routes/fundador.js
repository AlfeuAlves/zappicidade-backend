// ============================================================
// ROTAS — Selo Fundador
// ============================================================
const { supabaseAdmin } = require('../config/supabase')
const { autenticar }    = require('../middleware/auth')

const ASAAS_KEY      = process.env.ASAAS_API_KEY
const ASAAS_URL      = process.env.ASAAS_BASE_URL || 'https://sandbox.asaas.com/api/v3'
const FRONTEND_URL   = process.env.FRONTEND_URL   || 'https://painel.zappicidadebarcarena.com.br'
const PRAZO_FIM      = new Date('2026-06-16T23:59:59-03:00')
const VALOR_FUNDADOR = 197.00

async function asaas(method, path, body) {
  const res = await fetch(`${ASAAS_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'access_token': ASAAS_KEY },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.errors?.[0]?.description || data?.message || `Asaas ${res.status}`)
  return data
}

async function buscarOuCriarCustomer(comerciante) {
  const lista = await asaas('GET', `/customers?externalReference=${comerciante.id}&limit=1`)
  if (lista?.data?.length > 0) return lista.data[0].id
  const customer = await asaas('POST', '/customers', {
    name:  comerciante.nome_completo || comerciante.email,
    email: comerciante.email,
    mobilePhone: comerciante.whatsapp?.replace(/\D/g, '') || undefined,
    externalReference: comerciante.id,
  })
  return customer.id
}

async function fundadorRoutes(fastify) {

  // GET /fundador/vagas — lista vagas disponíveis por categoria
  fastify.get('/vagas', async (req, reply) => {
    const prazoEncerrado = new Date() > PRAZO_FIM

    const { data: vagas, error } = await supabaseAdmin
      .from('fundador_vagas')
      .select('categoria_id, maximo_vagas, vagas_tomadas, categorias(nome, slug, icone)')
      .order('categorias(nome)')

    if (error) return reply.status(500).send({ erro: error.message })

    const lista = (vagas || []).map(v => ({
      categoria_id:   v.categoria_id,
      categoria_nome: v.categorias?.nome,
      categoria_slug: v.categorias?.slug,
      categoria_icone: v.categorias?.icone,
      maximo:         v.maximo_vagas,
      tomadas:        v.vagas_tomadas,
      disponiveis:    v.maximo_vagas - v.vagas_tomadas,
      esgotado:       v.vagas_tomadas >= v.maximo_vagas,
    }))

    return {
      prazo_fim:        PRAZO_FIM.toISOString(),
      prazo_encerrado:  prazoEncerrado,
      valor:            VALOR_FUNDADOR,
      vagas:            lista,
    }
  })

  // GET /fundador/status — verifica se o comerciante tem selo ativo
  fastify.get('/status', { preHandler: autenticar }, async (req, reply) => {
    const { id: comerciante_id } = req.comerciante

    const { data: selo } = await supabaseAdmin
      .from('selos_fundador')
      .select('id, status, categoria_id, beneficio_inicio, beneficio_fim, asaas_payment_id, categorias(nome, slug, icone)')
      .eq('comerciante_id', comerciante_id)
      .order('criado_em', { ascending: false })
      .limit(1)
      .maybeSingle()

    const prazoEncerrado = new Date() > PRAZO_FIM

    return {
      tem_selo:         !!selo,
      prazo_encerrado:  prazoEncerrado,
      prazo_fim:        PRAZO_FIM.toISOString(),
      valor:            VALOR_FUNDADOR,
      selo:             selo || null,
    }
  })

  // POST /fundador/checkout — cria cobrança Asaas e reserva a vaga
  fastify.post('/checkout', { preHandler: autenticar }, async (req, reply) => {
    const { categoria_id } = req.body
    const { id: comerciante_id } = req.comerciante

    if (!categoria_id) return reply.status(400).send({ erro: 'categoria_id obrigatório' })

    // Verifica prazo
    if (new Date() > PRAZO_FIM) {
      return reply.status(400).send({ erro: 'Prazo para Fundador encerrado', codigo: 'prazo_encerrado' })
    }

    // Busca dados do comerciante e comercio
    const { data: com } = await supabaseAdmin
      .from('comerciantes')
      .select('id, nome_completo, email, whatsapp, comercio_id, status_verificacao')
      .eq('id', comerciante_id)
      .single()

    if (!com) return reply.status(404).send({ erro: 'Comerciante não encontrado' })
    if (com.status_verificacao !== 'aprovado') {
      return reply.status(403).send({ erro: 'Conta ainda não aprovada pelo administrador', codigo: 'nao_aprovado' })
    }

    const comercio_id = com.comercio_id
    if (!comercio_id) return reply.status(400).send({ erro: 'Comerciante sem comércio vinculado' })

    // Reserva vaga atomicamente via stored procedure
    const { data: resultado, error: errRpc } = await supabaseAdmin
      .rpc('fn_reservar_vaga_fundador', {
        p_comerciante_id: comerciante_id,
        p_comercio_id:    comercio_id,
        p_categoria_id:   categoria_id,
      })

    if (errRpc) {
      fastify.log.error(`[fundador/checkout] rpc error: ${errRpc.message}`)
      return reply.status(500).send({ erro: 'Erro ao reservar vaga' })
    }

    if (resultado !== 'ok') {
      const msgs = {
        prazo_encerrado: 'Prazo para Fundador encerrado',
        sem_vagas:       'Não há vagas disponíveis nessa categoria',
        ja_fundador:     'Você já possui o Selo Fundador nessa categoria',
      }
      return reply.status(400).send({ erro: msgs[resultado] || resultado, codigo: resultado })
    }

    // Cria customer e cobrança no Asaas
    try {
      const customerId = await buscarOuCriarCustomer(com)
      const vencimento = new Date()
      vencimento.setDate(vencimento.getDate() + 1)
      const dueDate = vencimento.toISOString().split('T')[0]

      const pag = await asaas('POST', '/payments', {
        customer:     customerId,
        billingType:  'UNDEFINED',
        value:        VALOR_FUNDADOR,
        dueDate,
        description:  'ZappiCidade — Selo Fundador',
        externalReference: `fundador|${comerciante_id}|${categoria_id}`,
      })

      // Salva asaas_payment_id no selo recém-criado (status ainda 'pendente')
      await supabaseAdmin
        .from('selos_fundador')
        .update({ asaas_payment_id: pag.id })
        .eq('comerciante_id', comerciante_id)
        .eq('categoria_id', categoria_id)
        .eq('status', 'pendente')

      const paymentUrl = pag.invoiceUrl || pag.bankSlipUrl || `https://sandbox.asaas.com/c/${pag.id}`

      return { ok: true, url: paymentUrl }
    } catch (err) {
      // Desfaz a reserva — decrementa vaga e remove o selo pendente
      await supabaseAdmin
        .from('selos_fundador')
        .delete()
        .eq('comerciante_id', comerciante_id)
        .eq('categoria_id', categoria_id)
        .eq('status', 'pendente')

      await supabaseAdmin.rpc('fn_decrementar_vaga_fundador', { p_categoria_id: categoria_id }).catch(() => {})

      fastify.log.error(`[fundador/checkout] asaas error: ${err.message}`)
      return reply.status(500).send({ erro: err.message })
    }
  })

  // GET /fundador/verificar — consulta Asaas e ativa se pago
  fastify.get('/verificar', { preHandler: autenticar }, async (req, reply) => {
    const { id: comerciante_id } = req.comerciante

    const { data: selo } = await supabaseAdmin
      .from('selos_fundador')
      .select('id, status, asaas_payment_id, categoria_id')
      .eq('comerciante_id', comerciante_id)
      .eq('status', 'pendente')
      .order('criado_em', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!selo) return { ativo: false, status: 'sem_pendente' }
    if (!selo.asaas_payment_id) return { ativo: false, status: 'sem_payment_id' }

    try {
      const pag = await asaas('GET', `/payments/${selo.asaas_payment_id}`)
      const confirmado = pag.status === 'CONFIRMED' || pag.status === 'RECEIVED'

      if (confirmado) {
        const inicio = new Date()
        const fim    = new Date(inicio)
        fim.setMonth(fim.getMonth() + 6)

        await supabaseAdmin
          .from('selos_fundador')
          .update({
            status:           'ativo',
            beneficio_inicio: inicio.toISOString(),
            beneficio_fim:    fim.toISOString(),
          })
          .eq('id', selo.id)

        return { ativo: true, status: 'ativado_agora', beneficio_fim: fim.toISOString() }
      }

      return { ativo: false, status: pag.status }
    } catch (err) {
      return reply.status(500).send({ erro: err.message })
    }
  })
}

module.exports = fundadorRoutes
