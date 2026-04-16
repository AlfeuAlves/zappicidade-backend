// ============================================================
// ROTAS — Pagamentos via Asaas
// ============================================================
const { supabaseAdmin } = require('../config/supabase')
const { autenticar } = require('../middleware/auth')

const ASAAS_KEY = process.env.ASAAS_API_KEY
const ASAAS_URL = process.env.ASAAS_BASE_URL || 'https://sandbox.asaas.com/api/v3'
const WEBHOOK_TOKEN = process.env.ASAAS_WEBHOOK_TOKEN
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://painel.zappicidadebarcarena.com.br'

// ID do plano PRO no banco
const PRO_PLANO_ID = 'fe42be0d-d264-4d48-933b-f1fe13cce1ec'

const PLANOS = {
  basico:      { valor: 0,      label: 'Básico',         dias: null,  ciclo: null },
  pro_mensal:  { valor: 59.90,  label: 'PRO Mensal',     dias: null,  ciclo: 'MONTHLY' },
  pro_3meses:  { valor: 149.90, label: 'PRO 3 Meses',    dias: 90,   ciclo: null },
  pro_6meses:  { valor: 269.90, label: 'PRO 6 Meses',    dias: 180,  ciclo: null },
  pro_12meses: { valor: 479.90, label: 'PRO 12 Meses',   dias: 365,  ciclo: null },
}

async function asaas(method, path, body) {
  const res = await fetch(`${ASAAS_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'access_token': ASAAS_KEY,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.errors?.[0]?.description || data?.message || `Asaas ${res.status}`)
  return data
}

async function buscarOuCriarCustomer(comerciante, cpf) {
  // Procura pelo externalReference (nosso ID)
  const lista = await asaas('GET', `/customers?externalReference=${comerciante.id}&limit=1`)
  if (lista?.data?.length > 0) {
    // Atualiza CPF se ainda não tinha
    const c = lista.data[0]
    if (cpf && !c.cpfCnpj) {
      await asaas('PUT', `/customers/${c.id}`, { cpfCnpj: cpf }).catch(() => {})
    }
    return c.id
  }

  // Cria novo customer
  const customer = await asaas('POST', '/customers', {
    name: comerciante.nome_completo || comerciante.email,
    email: comerciante.email,
    mobilePhone: comerciante.whatsapp?.replace(/\D/g, '') || undefined,
    cpfCnpj: cpf || undefined,
    externalReference: comerciante.id,
  })
  return customer.id
}

async function pagamentoRoutes(fastify) {

  // POST /pagamento/checkout — cria cobrança e retorna URL de pagamento
  fastify.post('/checkout', { preHandler: autenticar }, async (req, reply) => {
    const { plano_id, cpf } = req.body
    const { id: comerciante_id } = req.comerciante

    fastify.log.info(`[checkout] plano_id=${plano_id} comerciante_id=${comerciante_id} ASAAS_KEY=${ASAAS_KEY ? 'ok' : 'MISSING'}`)

    const plano = PLANOS[plano_id]
    if (!plano) return reply.status(400).send({ erro: 'Plano inválido' })

    try {

    // Plano básico — sem pagamento
    if (plano_id === 'basico') {
      return { ok: true, url: `${FRONTEND_URL}/comerciante/dashboard?setup=1`, gratuito: true }
    }

    // Busca dados do comerciante
    const { data: com } = await supabaseAdmin
      .from('comerciantes')
      .select('id, nome_completo, email, whatsapp')
      .eq('id', comerciante_id)
      .single()

    if (!com) return reply.status(404).send({ erro: 'Comerciante não encontrado' })

    // Salva CPF no banco se informado
    if (cpf) {
      await supabaseAdmin.from('comerciantes').update({ cpf }).eq('id', comerciante_id)
    }

    // Busca ou cria customer no Asaas
    const customerId = await buscarOuCriarCustomer(com, cpf)

    const callbackSuccess = `${FRONTEND_URL}/comerciante/pagamento/sucesso`
    const vencimento = new Date()
    vencimento.setDate(vencimento.getDate() + 1) // vence amanhã
    const dueDate = vencimento.toISOString().split('T')[0]

    let asaasId, paymentUrl

    if (plano.ciclo === 'MONTHLY') {
      // Assinatura recorrente mensal
      const sub = await asaas('POST', '/subscriptions', {
        customer: customerId,
        billingType: 'UNDEFINED', // cliente escolhe na hora (PIX, cartão, boleto)
        value: plano.valor,
        nextDueDate: dueDate,
        cycle: 'MONTHLY',
        description: `ZappiCidade ${plano.label}`,
        externalReference: `${comerciante_id}|${plano_id}`,
      })
      asaasId = sub.id
      // Busca a primeira cobrança gerada para pegar a URL
      const pagamentos = await asaas('GET', `/payments?subscription=${sub.id}&limit=1`)
      paymentUrl = pagamentos?.data?.[0]?.invoiceUrl || pagamentos?.data?.[0]?.bankSlipUrl
      if (!paymentUrl) {
        // Busca link de pagamento da subscription
        paymentUrl = `https://sandbox.asaas.com/c/${pagamentos?.data?.[0]?.id}`
      }

      // Salva referência pendente no banco
      await supabaseAdmin.from('assinaturas').insert({
        comerciante_id,
        plano_id: PRO_PLANO_ID,
        plano_slug: plano_id,
        status: 'pendente',
        inicio: new Date().toISOString(),
        valor: plano.valor,
        asaas_customer_id: customerId,
        asaas_subscription_id: asaasId,
        criado_em: new Date().toISOString(),
      })
    } else {
      // Cobrança única (3, 6 ou 12 meses)
      const pag = await asaas('POST', '/payments', {
        customer: customerId,
        billingType: 'UNDEFINED',
        value: plano.valor,
        dueDate,
        description: `ZappiCidade ${plano.label}`,
        externalReference: `${comerciante_id}|${plano_id}`,
      })
      asaasId = pag.id
      paymentUrl = pag.invoiceUrl || pag.bankSlipUrl || `https://sandbox.asaas.com/c/${pag.id}`

      // Salva referência pendente no banco
      const fim = new Date()
      fim.setDate(fim.getDate() + plano.dias)
      await supabaseAdmin.from('assinaturas').insert({
        comerciante_id,
        plano_id: PRO_PLANO_ID,
        plano_slug: plano_id,
        status: 'pendente',
        inicio: new Date().toISOString(),
        fim: fim.toISOString(),
        valor: plano.valor,
        asaas_customer_id: customerId,
        asaas_payment_id: asaasId,
        criado_em: new Date().toISOString(),
      })
    }

    return { ok: true, url: paymentUrl }
    } catch (err) {
      fastify.log.error(`[checkout] ERRO: ${err.message}`)
      return reply.status(500).send({ erro: err.message })
    }
  })

  // POST /webhook/asaas — recebe eventos do Asaas (sem autenticação)
  fastify.post('/webhook', async (req, reply) => {
    // Log completo para diagnóstico
    fastify.log.info(`[webhook] headers: ${JSON.stringify(req.headers)}`)
    fastify.log.info(`[webhook] body: ${JSON.stringify(req.body)}`)
    const token = req.headers['asaas-webhook-token'] || req.headers['access_token']
    fastify.log.info(`[webhook] token recebido: "${token}" esperado: "${WEBHOOK_TOKEN}"`)

    const { event, payment, subscription } = req.body
    fastify.log.info(`Asaas webhook: ${event}`)

    // Pagamento confirmado (PIX ou cartão)
    if (event === 'PAYMENT_CONFIRMED' || event === 'PAYMENT_RECEIVED') {
      const externalRef = payment?.externalReference // "comerciante_id|plano_slug"
      if (!externalRef) return { ok: true }

      const [comerciante_id, plano_slug] = externalRef.split('|')
      const plano = PLANOS[plano_slug]
      if (!plano || !comerciante_id) return { ok: true }

      // Ativa a assinatura pendente
      const { error } = await supabaseAdmin
        .from('assinaturas')
        .update({ status: 'ativa' })
        .eq('comerciante_id', comerciante_id)
        .eq('plano_slug', plano_slug)
        .eq('status', 'pendente')

      if (error) fastify.log.error(`Erro ao ativar assinatura: ${error.message}`)
      else fastify.log.info(`Assinatura ativada: ${comerciante_id} → ${plano_slug}`)
    }

    // Assinatura cancelada ou expirada
    if (event === 'SUBSCRIPTION_DELETED' || event === 'PAYMENT_OVERDUE') {
      const externalRef = payment?.externalReference || subscription?.externalReference
      if (!externalRef) return { ok: true }
      const [comerciante_id] = externalRef.split('|')

      await supabaseAdmin
        .from('assinaturas')
        .update({ status: 'cancelada' })
        .eq('comerciante_id', comerciante_id)
        .eq('status', 'ativa')

      fastify.log.info(`Assinatura cancelada: ${comerciante_id}`)
    }

    return { ok: true }
  })

  // GET /pagamento/status — verifica status da assinatura atual
  fastify.get('/status', { preHandler: autenticar }, async (req, reply) => {
    const { id: comerciante_id } = req.comerciante
    const { data } = await supabaseAdmin
      .from('assinaturas')
      .select('id, status, plano_slug, inicio, fim, valor')
      .eq('comerciante_id', comerciante_id)
      .order('criado_em', { ascending: false })
      .limit(1)
      .single()

    return { assinatura: data || null }
  })

  // GET /pagamento/verificar — consulta o Asaas e ativa se pagamento confirmado
  fastify.get('/verificar', { preHandler: autenticar }, async (req, reply) => {
    const { id: comerciante_id } = req.comerciante

    // Busca a assinatura mais recente (pendente ou ativa)
    const { data: ass } = await supabaseAdmin
      .from('assinaturas')
      .select('id, status, plano_slug, asaas_payment_id, asaas_subscription_id')
      .eq('comerciante_id', comerciante_id)
      .order('criado_em', { ascending: false })
      .limit(1)
      .single()

    if (!ass) return { ativa: false, status: 'sem_assinatura' }
    if (ass.status === 'ativa') return { ativa: true, status: 'ativa' }

    // Consulta o Asaas para saber se o pagamento foi confirmado
    let confirmado = false
    try {
      if (ass.asaas_payment_id) {
        const pag = await asaas('GET', `/payments/${ass.asaas_payment_id}`)
        confirmado = pag.status === 'CONFIRMED' || pag.status === 'RECEIVED'
        fastify.log.info(`[verificar] payment ${ass.asaas_payment_id} status=${pag.status}`)
      } else if (ass.asaas_subscription_id) {
        const pagamentos = await asaas('GET', `/payments?subscription=${ass.asaas_subscription_id}&limit=1`)
        const ultimo = pagamentos?.data?.[0]
        confirmado = ultimo?.status === 'CONFIRMED' || ultimo?.status === 'RECEIVED'
        fastify.log.info(`[verificar] subscription ${ass.asaas_subscription_id} ultimo_pagamento status=${ultimo?.status}`)
      }
    } catch (err) {
      fastify.log.error(`[verificar] erro ao consultar Asaas: ${err.message}`)
      return { ativa: false, status: 'erro_asaas', erro: err.message }
    }

    if (confirmado) {
      await supabaseAdmin
        .from('assinaturas')
        .update({ status: 'ativa' })
        .eq('id', ass.id)

      fastify.log.info(`[verificar] assinatura ${ass.id} ativada para ${comerciante_id}`)
      return { ativa: true, status: 'ativada_agora' }
    }

    return { ativa: false, status: ass.status }
  })
}

module.exports = pagamentoRoutes
