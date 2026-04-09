// ============================================================
// ROTAS PROTEGIDAS — Promoções do Comerciante
// ============================================================
const { supabaseAdmin } = require('../../config/supabase')
const { autenticar } = require('../../middleware/auth')

async function promocoesRoutes(fastify) {

  // GET /comerciante/promocoes — lista promoções do comércio
  fastify.get('/', { preHandler: autenticar }, async (req, reply) => {
    const { comercio_id } = req.comerciante
    const { status, page = 1, limit = 20 } = req.query
    const offset = (page - 1) * limit

    if (!comercio_id) {
      return reply.status(400).send({ erro: 'Nenhum comércio vinculado à sua conta' })
    }

    let query = supabaseAdmin
      .from('promocoes')
      .select('*', { count: 'exact' })
      .eq('comercio_id', comercio_id)
      .range(offset, offset + limit - 1)
      .order('criado_em', { ascending: false })

    if (status) query = query.eq('status', status)

    const { data, error, count } = await query

    if (error) return reply.status(500).send({ erro: error.message })

    return {
      data,
      meta: { total: count, page, limit, paginas: Math.ceil(count / limit) }
    }
  })

  // GET /comerciante/promocoes/:id — detalhe de uma promoção
  fastify.get('/:id', { preHandler: autenticar }, async (req, reply) => {
    const { comercio_id } = req.comerciante
    const { id } = req.params

    const { data, error } = await supabaseAdmin
      .from('promocoes')
      .select('*')
      .eq('id', id)
      .eq('comercio_id', comercio_id)
      .single()

    if (error || !data) {
      return reply.status(404).send({ erro: 'Promoção não encontrada' })
    }

    return data
  })

  // POST /comerciante/promocoes — cria nova promoção
  fastify.post('/', {
    preHandler: autenticar,
    schema: {
      body: {
        type: 'object',
        required: ['titulo', 'tipo'],
        properties: {
          titulo:               { type: 'string', minLength: 3 },
          descricao:            { type: 'string' },
          tipo:                 { type: 'string', enum: ['desconto', 'frete_gratis', 'brinde', 'combo', 'outro'] },
          preco_de:             { type: 'number' },
          preco_por:            { type: 'number' },
          percentual_desconto:  { type: 'number', minimum: 1, maximum: 100 },
          imagem_url:           { type: 'string' },
          inicio:               { type: 'string' },
          fim:                  { type: 'string' },
          quantidade_limite:    { type: 'integer' }
        }
      }
    }
  }, async (req, reply) => {
    const { comercio_id, id: comerciante_id } = req.comerciante

    if (!comercio_id) {
      return reply.status(400).send({ erro: 'Nenhum comércio vinculado à sua conta' })
    }

    // Verifica plano — Pro ou superior para criar promoções
    const { data: assinatura } = await supabaseAdmin
      .from('assinaturas')
      .select('planos(nome)')
      .eq('comerciante_id', comerciante_id)
      .eq('status', 'ativa')
      .single()

    const planoNome = assinatura?.planos?.nome?.toLowerCase() || ''
    if (!['pro', 'agência', 'agencia'].includes(planoNome)) {
      return reply.status(403).send({
        erro: 'Promoções disponíveis a partir do plano Pro',
        upgrade: true
      })
    }

    const { data, error } = await supabaseAdmin
      .from('promocoes')
      .insert({
        ...req.body,
        comercio_id,
        status: 'ativa',
        quantidade_usada: 0
      })
      .select()
      .single()

    if (error) return reply.status(500).send({ erro: error.message })
    return reply.status(201).send({ ok: true, promocao: data })
  })

  // PUT /comerciante/promocoes/:id — atualiza promoção
  fastify.put('/:id', {
    preHandler: autenticar,
    schema: {
      body: {
        type: 'object',
        properties: {
          titulo:               { type: 'string' },
          descricao:            { type: 'string' },
          preco_de:             { type: 'number' },
          preco_por:            { type: 'number' },
          percentual_desconto:  { type: 'number' },
          imagem_url:           { type: 'string' },
          fim:                  { type: 'string' },
          quantidade_limite:    { type: 'integer' },
          status:               { type: 'string', enum: ['ativa', 'pausada', 'encerrada'] }
        }
      }
    }
  }, async (req, reply) => {
    const { comercio_id } = req.comerciante
    const { id } = req.params

    // Garante que a promoção pertence ao comerciante
    const { data: existente } = await supabaseAdmin
      .from('promocoes')
      .select('id')
      .eq('id', id)
      .eq('comercio_id', comercio_id)
      .single()

    if (!existente) {
      return reply.status(404).send({ erro: 'Promoção não encontrada' })
    }

    const campos = Object.fromEntries(
      Object.entries(req.body).filter(([, v]) => v !== undefined)
    )
    campos.atualizado_em = new Date().toISOString()

    const { data, error } = await supabaseAdmin
      .from('promocoes')
      .update(campos)
      .eq('id', id)
      .select()
      .single()

    if (error) return reply.status(500).send({ erro: error.message })
    return { ok: true, promocao: data }
  })

  // DELETE /comerciante/promocoes/:id — encerra promoção
  fastify.delete('/:id', { preHandler: autenticar }, async (req, reply) => {
    const { comercio_id } = req.comerciante
    const { id } = req.params

    const { data: existente } = await supabaseAdmin
      .from('promocoes')
      .select('id')
      .eq('id', id)
      .eq('comercio_id', comercio_id)
      .single()

    if (!existente) {
      return reply.status(404).send({ erro: 'Promoção não encontrada' })
    }

    // Soft delete — marca como encerrada
    await supabaseAdmin
      .from('promocoes')
      .update({ status: 'encerrada', atualizado_em: new Date().toISOString() })
      .eq('id', id)

    return { ok: true, mensagem: 'Promoção encerrada' }
  })

  // POST /comerciante/promocoes/:id/broadcast — dispara promoção via WhatsApp
  fastify.post('/:id/broadcast', { preHandler: autenticar }, async (req, reply) => {
    const { comercio_id, id: comerciante_id } = req.comerciante
    const { id: promocao_id } = req.params

    // Verifica plano Pro
    const { data: assinatura } = await supabaseAdmin
      .from('assinaturas')
      .select('planos(nome)')
      .eq('comerciante_id', comerciante_id)
      .eq('status', 'ativa')
      .single()

    const planoNome = assinatura?.planos?.nome?.toLowerCase() || ''
    if (!['pro', 'agência', 'agencia'].includes(planoNome)) {
      return reply.status(403).send({
        erro: 'Broadcast disponível apenas no plano Pro',
        upgrade: true
      })
    }

    // Busca promoção
    const { data: promocao } = await supabaseAdmin
      .from('promocoes')
      .select('*')
      .eq('id', promocao_id)
      .eq('comercio_id', comercio_id)
      .single()

    if (!promocao) {
      return reply.status(404).send({ erro: 'Promoção não encontrada' })
    }

    // Busca opt-ins ativos do comércio
    const { data: optins, count } = await supabaseAdmin
      .from('optins')
      .select('usuario_id, usuarios_cidadaos(whatsapp, nome)', { count: 'exact' })
      .eq('comercio_id', comercio_id)
      .eq('status', 'ativo')

    if (!count || count === 0) {
      return reply.status(400).send({ erro: 'Nenhum contato com opt-in ativo para envio' })
    }

    // Registra o broadcast
    const { data: broadcast, error } = await supabaseAdmin
      .from('mensagens_broadcast')
      .insert({
        comercio_id,
        promocao_id,
        tipo: 'promocao',
        titulo: promocao.titulo,
        mensagem: promocao.descricao,
        total_destinatarios: count,
        status: 'pendente'
      })
      .select()
      .single()

    if (error) return reply.status(500).send({ erro: error.message })

    // TODO: Colocar na fila de envio WhatsApp (Evolution API / Z-API)
    // await filaEnvio.add({ broadcast_id: broadcast.id, optins })

    return reply.status(202).send({
      ok: true,
      mensagem: `Broadcast agendado para ${count} contatos`,
      broadcast_id: broadcast.id,
      total: count
    })
  })
}

module.exports = promocoesRoutes
