// ============================================================
// ROTAS PROTEGIDAS — Perfil e Comércio do Comerciante
// ============================================================
const { supabaseAdmin } = require('../../config/supabase')
const { autenticar } = require('../../middleware/auth')
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
      .select('id, nome_completo, email, whatsapp, ativo, criado_em, ultimo_acesso')
      .eq('id', id)
      .single()

    if (!comercio_id) {
      return { comerciante, comercio: null, assinatura: null }
    }

    // Busca dados do comércio e assinatura em paralelo
    const [comercioRes, assinaturaRes] = await Promise.all([
      supabaseAdmin
        .from('comercios')
        .select('id, nome, slug, descricao, categoria_id, categorias(nome, slug, icone), cidade_id, cidades(nome, estado), telefone, whatsapp, email, website, endereco, bairro, horarios, foto_capa_url, verificado, destaque, status_operacional, avaliacao, total_avaliacoes')
        .eq('id', comercio_id)
        .single(),

      supabaseAdmin
        .from('assinaturas')
        .select('id, status, plano_id, planos(nome, preco, recursos), inicio, fim, trial_fim')
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

    return { ok: true, mensagem: `Solicitação enviada! Aguarde a verificação — você será notificado pelo WhatsApp.` }
  })
}

module.exports = perfilRoutes
