// ============================================================
// ROTAS PROTEGIDAS — Perfil e Comércio do Comerciante
// ============================================================
const { supabaseAdmin } = require('../../config/supabase')
const { autenticar } = require('../../middleware/auth')
const logger = require('../../lib/logger')
const { sendText } = require('../../bot/zapi')
const bcrypt = require('bcrypt')
const crypto = require('crypto')

async function perfilRoutes(fastify) {

  // GET /comerciante/perfil — dados do comerciante + comércio
  fastify.get('/', { preHandler: autenticar }, async (req, reply) => {
    const { id, comercio_id } = req.comerciante

    // Busca dados do comerciante
    const { data: comerciante } = await supabaseAdmin
      .from('comerciantes')
      .select('id, nome_completo, email, whatsapp, ativo, status_verificacao, criado_em, ultimo_acesso')
      .eq('id', id)
      .single()

    if (!comercio_id) {
      return { comerciante, comercio: null, assinatura: null }
    }

    // Busca dados do comércio e assinatura em paralelo
    const [comercioRes, assinaturaRes] = await Promise.all([
      supabaseAdmin
        .from('comercios')
        .select('id, nome, slug, descricao, categoria_id, categorias(nome, slug, icone), cidade_id, cidades(nome, estado), telefone, whatsapp, email, website, endereco, bairro, horarios, foto_capa_url, fotos_galeria, verificado, destaque, status_operacional, avaliacao, total_avaliacoes')
        .eq('id', comercio_id)
        .single(),

      supabaseAdmin
        .from('assinaturas')
        .select('id, status, plano_id, planos(nome, preco_mensal), inicio, fim, plano_slug, valor')
        .eq('comerciante_id', id)
        .eq('status', 'ativa')
        .single()
    ])

    return {
      comerciante,
      comercio: comercioRes.data || null,
      assinatura: assinaturaRes.data || null
    }
  })

  // PUT /comerciante/perfil — atualiza dados do comerciante
  fastify.put('/', { preHandler: autenticar }, async (req, reply) => {
    const { id } = req.comerciante
    const { nome, whatsapp } = req.body

    const { data, error } = await supabaseAdmin
      .from('comerciantes')
      .update({ nome_completo: nome, whatsapp, atualizado_em: new Date().toISOString() })
      .eq('id', id)
      .select('id, nome_completo, email, whatsapp')
      .single()

    if (error) return reply.status(500).send({ erro: error.message })
    return { ok: true, comerciante: data }
  })

  // PUT /comerciante/perfil/senha — altera senha
  fastify.put('/senha', {
    preHandler: autenticar,
    schema: {
      body: {
        type: 'object',
        required: ['senha_atual', 'nova_senha'],
        properties: {
          senha_atual: { type: 'string' },
          nova_senha:  { type: 'string', minLength: 6 }
        }
      }
    }
  }, async (req, reply) => {
    const { id } = req.comerciante
    const { senha_atual, nova_senha } = req.body

    const { data: comerciante } = await supabaseAdmin
      .from('comerciantes')
      .select('senha_hash')
      .eq('id', id)
      .single()

    const senhaCorreta = await bcrypt.compare(senha_atual, comerciante.senha_hash)
    if (!senhaCorreta) {
      return reply.status(400).send({ erro: 'Senha atual incorreta' })
    }

    const senha_hash = await bcrypt.hash(nova_senha, 10)

    await supabaseAdmin
      .from('comerciantes')
      .update({ senha_hash })
      .eq('id', id)

    return { ok: true, mensagem: 'Senha alterada com sucesso' }
  })

  // PUT /comerciante/comercio — atualiza dados do comércio
  fastify.put('/comercio', {
    preHandler: autenticar,
    schema: {
      body: {
        type: 'object',
        properties: {
          nome:               { type: 'string' },
          descricao:          { type: 'string' },
          telefone:           { type: 'string' },
          whatsapp:           { type: 'string' },
          email:              { type: 'string' },
          website:            { type: 'string' },
          endereco:           { type: 'string' },
          bairro:             { type: 'string' },
          horarios:           { type: 'object' },
          foto_capa_url:      { type: 'string' },
          categoria_id:       { type: 'string' }
        }
      }
    }
  }, async (req, reply) => {
    const { comercio_id } = req.comerciante

    if (!comercio_id) {
      return reply.status(400).send({ erro: 'Nenhum comércio vinculado à sua conta' })
    }

    // Remove campos undefined
    const campos = Object.fromEntries(
      Object.entries(req.body).filter(([, v]) => v !== undefined)
    )

    if (Object.keys(campos).length === 0) {
      return reply.status(400).send({ erro: 'Nenhum campo para atualizar' })
    }

    campos.atualizado_em = new Date().toISOString()

    const { data, error } = await supabaseAdmin
      .from('comercios')
      .update(campos)
      .eq('id', comercio_id)
      .select('id, nome, slug, descricao, telefone, whatsapp, website, endereco, bairro, horarios, foto_capa_url')
      .single()

    if (error) return reply.status(500).send({ erro: error.message })
    return { ok: true, comercio: data }
  })

  // POST /comerciante/perfil/vincular — vincula conta a um comércio existente
  fastify.post('/vincular', {
    preHandler: autenticar,
    schema: {
      body: {
        type: 'object',
        required: ['comercio_id'],
        properties: {
          comercio_id: { type: 'string' }
        }
      }
    }
  }, async (req, reply) => {
    const { id, comercio_id: jaVinculado } = req.comerciante

    if (jaVinculado) {
      return reply.status(400).send({ erro: 'Sua conta já está vinculada a um comércio' })
    }

    const { comercio_id } = req.body

    // Verifica se o comércio existe e não está vinculado a outro comerciante
    const { data: comercio } = await supabaseAdmin
      .from('comercios')
      .select('id, nome')
      .eq('id', comercio_id)
      .single()

    if (!comercio) {
      return reply.status(404).send({ erro: 'Comércio não encontrado' })
    }

    const { data: jaVinc } = await supabaseAdmin
      .from('comerciantes')
      .select('id')
      .eq('comercio_id', comercio_id)
      .single()

    if (jaVinc) {
      return reply.status(409).send({ erro: 'Este comércio já está vinculado a outro comerciante' })
    }

    // Gera token único de verificação
    const token = crypto.randomBytes(32).toString('hex')

    // Busca dados do comerciante para a notificação
    const { data: comerciante } = await supabaseAdmin
      .from('comerciantes')
      .select('nome_completo, email, whatsapp')
      .eq('id', id)
      .single()

    // Vincula e salva token
    await supabaseAdmin
      .from('comerciantes')
      .update({ comercio_id, token_verificacao: token, status_verificacao: 'pendente' })
      .eq('id', id)

    // Notifica o fundador via WhatsApp
    const founderWa = process.env.FOUNDER_WHATSAPP
    const apiUrl = process.env.API_URL || 'http://localhost:3001'
    if (founderWa) {
      const nomeComercio = comercio.nome
      const nomeComerciate = comerciante?.nome_completo || comerciante?.email || 'Sem nome'
      const msg =
        `🔔 *Nova solicitação de verificação!*\n\n` +
        `👤 *${nomeComerciate}* quer reivindicar:\n` +
        `🏪 *${nomeComercio}*\n\n` +
        `✅ *APROVAR:*\n${apiUrl}/admin/verificar/${token}\n\n` +
        `❌ *REJEITAR:*\n${apiUrl}/admin/verificar/${token}?rejeitar=true`

      sendText(founderWa, msg).catch(err =>
        fastify.log.warn(`Falha ao notificar fundador: ${err.message}`)
      )
    }

    logger.info('aprovacao', `Solicitação de vínculo: ${comerciante?.nome_completo || id} → ${comercio.nome}`, { comercio_id, comercio_nome: comercio.nome }, id, 'comerciante')
    return { ok: true, mensagem: `Solicitação enviada! Aguarde a verificação — você será notificado pelo WhatsApp.` }
  })

  // POST /comerciante/perfil/criar-comercio — cria novo comércio e vincula ao comerciante
  fastify.post('/criar-comercio', {
    preHandler: autenticar,
    schema: {
      body: {
        type: 'object',
        required: ['nome'],
        properties: {
          nome:         { type: 'string', minLength: 2 },
          categoria_id: { type: 'string' },
          bairro:       { type: 'string' },
          endereco:     { type: 'string' },
          telefone:     { type: 'string' },
          whatsapp:     { type: 'string' },
        }
      }
    }
  }, async (req, reply) => {
    const { id, comercio_id: jaVinculado } = req.comerciante

    if (jaVinculado) {
      return reply.status(400).send({ erro: 'Sua conta já está vinculada a um comércio' })
    }

    const { nome, categoria_id, bairro, endereco, telefone, whatsapp } = req.body

    // Gera slug único
    const slugBase = nome.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

    const { data: existing } = await supabaseAdmin
      .from('comercios').select('id').ilike('slug', `${slugBase}%`)
    const slug = existing?.length ? `${slugBase}-${existing.length + 1}` : slugBase

    // Busca cidade padrão
    const { data: cidade } = await supabaseAdmin
      .from('cidades').select('id').limit(1).single()

    // Cria o comércio
    const { data: comercio, error } = await supabaseAdmin
      .from('comercios')
      .insert({
        nome, slug,
        categoria_id: categoria_id || null,
        bairro: bairro || null,
        endereco: endereco || null,
        telefone: telefone || null,
        whatsapp: whatsapp || null,
        cidade_id: cidade?.id || null,
        status_operacional: 'ativo',
        verificado: false,
        destaque: false,
      })
      .select('id, nome, slug, categoria_nome:categorias(nome), bairro, endereco, telefone')
      .single()

    if (error) return reply.status(500).send({ erro: error.message })

    // Gera token e vincula ao comerciante
    const token = crypto.randomBytes(32).toString('hex')
    await supabaseAdmin
      .from('comerciantes')
      .update({ comercio_id: comercio.id, token_verificacao: token, status_verificacao: 'pendente' })
      .eq('id', id)

    // Notifica o fundador
    const { data: comerciante } = await supabaseAdmin
      .from('comerciantes').select('nome_completo, email').eq('id', id).single()
    const founderWa = process.env.FOUNDER_WHATSAPP
    const apiUrl = process.env.API_URL || 'http://localhost:3001'
    if (founderWa) {
      const msg =
        `🔔 *Novo estabelecimento cadastrado!*\n\n` +
        `👤 *${comerciante?.nome_completo || comerciante?.email}* cadastrou:\n` +
        `🏪 *${nome}*\n\n` +
        `✅ *APROVAR:*\n${apiUrl}/admin/verificar/${token}\n\n` +
        `❌ *REJEITAR:*\n${apiUrl}/admin/verificar/${token}?rejeitar=true`
      sendText(founderWa, msg).catch(e => logger.aviso('aprovacao', `Falha ao notificar fundador via WhatsApp: ${e.message}`))
    }

    return { ok: true, comercio }
  })
  // ── GET /comerciante/analytics — stats de visibilidade ──────
  fastify.get('/analytics', { preHandler: autenticar }, async (req, reply) => {
    const { comercio_id } = req.comerciante
    if (!comercio_id) return reply.status(400).send({ erro: 'Sem comércio vinculado' })

    const { periodo = '30d' } = req.query
    const diasMap = { '7d': 7, '30d': 30, '90d': 90 }
    const dias = diasMap[periodo] || 30
    const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString()
    const desdeAnterior = new Date(Date.now() - dias * 2 * 24 * 60 * 60 * 1000).toISOString()

    const [atual, anterior, termos] = await Promise.all([
      // Período atual — contagem por tipo
      supabaseAdmin.from('eventos_comercio')
        .select('tipo')
        .eq('comercio_id', comercio_id)
        .gte('criado_em', desde),

      // Período anterior — para comparativo
      supabaseAdmin.from('eventos_comercio')
        .select('tipo')
        .eq('comercio_id', comercio_id)
        .gte('criado_em', desdeAnterior)
        .lt('criado_em', desde),

      // Termos de busca mais comuns
      supabaseAdmin.from('eventos_comercio')
        .select('termo_busca')
        .eq('comercio_id', comercio_id)
        .eq('tipo', 'impressao')
        .not('termo_busca', 'is', null)
        .gte('criado_em', desde)
        .order('criado_em', { ascending: false })
        .limit(500),
    ])

    const contar = (rows, tipo) => (rows || []).filter(r => r.tipo === tipo).length

    const atual_impressoes   = contar(atual.data, 'impressao')
    const atual_whatsapp     = contar(atual.data, 'clique_whatsapp')
    const atual_perfil       = contar(atual.data, 'clique_perfil')
    const ant_impressoes     = contar(anterior.data, 'impressao')
    const ant_whatsapp       = contar(anterior.data, 'clique_whatsapp')
    const ant_perfil         = contar(anterior.data, 'clique_perfil')

    const variacao = (atual, ant) => ant === 0 ? null : Math.round(((atual - ant) / ant) * 100)

    // Top termos de busca
    const freq = {}
    ;(termos.data || []).forEach(r => {
      if (r.termo_busca) freq[r.termo_busca] = (freq[r.termo_busca] || 0) + 1
    })
    const top_termos = Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([termo, count]) => ({ termo, count }))

    return {
      periodo,
      impressoes:   { total: atual_impressoes,  variacao: variacao(atual_impressoes, ant_impressoes) },
      whatsapp:     { total: atual_whatsapp,     variacao: variacao(atual_whatsapp, ant_whatsapp) },
      perfil:       { total: atual_perfil,       variacao: variacao(atual_perfil, ant_perfil) },
      top_termos,
    }
  })
}

module.exports = perfilRoutes
