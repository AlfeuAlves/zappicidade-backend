// ============================================================
// ROTAS — Leads e Analytics
// ============================================================
const { supabaseAdmin } = require('../config/supabase')
const { sendText } = require('../bot/zapi')
const crypto = require('crypto')

const MENSAGEM_PITCH = (nome) => `👋 Olá, *${nome}*!

Alguém acabou de clicar no seu WhatsApp através do *ZappiCidade* — a plataforma que conecta cidadãos de Barcarena aos comércios locais.

Isso significa que sua vitrine já está funcionando! 🎉

Com o plano *Pro* do ZappiCidade, você teria:
✅ Destaque nos resultados de busca
✅ Promoções com badge especial
✅ Analytics: veja quantas pessoas visitaram seu perfil
✅ Broadcasts diretos para seus clientes via WhatsApp

👉 Quer saber mais? Responda essa mensagem ou acesse zappicidade.com.br`

async function leadsRoutes(fastify) {

  // POST /leads/whatsapp-click — registra clique no WhatsApp e avisa comerciante não-premium
  fastify.post('/whatsapp-click', {
    schema: {
      body: {
        type: 'object',
        required: ['comercio_id'],
        properties: {
          comercio_id: { type: 'string' },
          origem:      { type: 'string' }
        }
      }
    }
  }, async (req, reply) => {
    const { comercio_id, origem = 'landing_page' } = req.body

    // Registra o lead
    await supabaseAdmin
      .from('leads')
      .insert({ comercio_id, acao: 'whatsapp_click', origem })

    // Busca dados do comércio para checar plano e telefone
    const { data: comercio } = await supabaseAdmin
      .from('vw_comercios_publicos')
      .select('nome, plano, comerciante_ativo, whatsapp, telefone')
      .eq('id', comercio_id)
      .single()

    if (!comercio) return reply.status(201).send({ ok: true })

    // Só envia pitch se NÃO for premium e tiver número
    const isPremium = comercio.plano && comercio.plano !== 'basico_publico'
    const numero = comercio.whatsapp || comercio.telefone

    if (!isPremium && numero) {
      // Fire-and-forget: não bloqueia a resposta
      sendText(numero, MENSAGEM_PITCH(comercio.nome)).catch(err => {
        fastify.log.warn(`Pitch Z-API falhou para ${comercio.nome}: ${err.message}`)
      })
    }

    return reply.status(201).send({ ok: true })
  })

  // POST /leads — registra um lead
  fastify.post('/', {
    schema: {
      body: {
        type: 'object',
        required: ['comercio_id', 'acao'],
        properties: {
          comercio_id:  { type: 'string' },
          usuario_id:   { type: 'string' },
          origem:       { type: 'string' },
          utm_source:   { type: 'string' },
          utm_medium:   { type: 'string' },
          utm_campaign: { type: 'string' },
          interesse:    { type: 'string' },
          promocao_id:  { type: 'string' },
          acao:         { type: 'string' }
        }
      }
    }
  }, async (req, reply) => {
    const { data, error } = await supabaseAdmin
      .from('leads')
      .insert(req.body)
      .select()
      .single()

    if (error) return reply.status(500).send({ erro: error.message })
    return reply.status(201).send({ ok: true, id: data.id })
  })

  // POST /analytics/visualizacao — registra visualização de página
  fastify.post('/visualizacao', {
    schema: {
      body: {
        type: 'object',
        required: ['comercio_id'],
        properties: {
          comercio_id:  { type: 'string' },
          usuario_id:   { type: 'string' },
          origem:       { type: 'string' },
          utm_source:   { type: 'string' },
          utm_campaign: { type: 'string' }
        }
      }
    }
  }, async (req, reply) => {
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown'
    const ip_hash = crypto.createHash('sha256').update(ip).digest('hex')

    const { error } = await supabaseAdmin
      .from('analytics_visualizacoes')
      .insert({ ...req.body, ip_hash })

    if (error) return reply.status(500).send({ erro: error.message })
    return reply.status(201).send({ ok: true })
  })

  // POST /optins — registra opt-in do cidadão
  fastify.post('/optin', {
    schema: {
      body: {
        type: 'object',
        required: ['comercio_id', 'whatsapp'],
        properties: {
          comercio_id:         { type: 'string' },
          whatsapp:            { type: 'string' },
          nome:                { type: 'string' },
          origem:              { type: 'string' },
          texto_consentimento: { type: 'string' }
        }
      }
    }
  }, async (req, reply) => {
    const { comercio_id, whatsapp, nome, origem, texto_consentimento } = req.body

    // Garante que o cidadão existe
    const { data: usuario, error: errUser } = await supabaseAdmin
      .from('usuarios_cidadaos')
      .upsert({ whatsapp, nome }, { onConflict: 'whatsapp' })
      .select()
      .single()

    if (errUser) return reply.status(500).send({ erro: errUser.message })

    // Registra opt-in
    const { error: errOptin } = await supabaseAdmin
      .from('optins')
      .upsert({
        usuario_id: usuario.id,
        comercio_id,
        status: 'ativo',
        origem: origem || 'pagina_publica',
        texto_consentimento: texto_consentimento || 'Usuário autorizou receber promoções via WhatsApp',
        ip_origem: req.ip,
        consentido_em: new Date().toISOString()
      }, { onConflict: 'usuario_id,comercio_id' })

    if (errOptin) return reply.status(500).send({ erro: errOptin.message })

    return reply.status(201).send({ ok: true, usuario_id: usuario.id })
  })

  // DELETE /optins/:comercio_id — cancela opt-in
  fastify.delete('/optin/:comercio_id', async (req, reply) => {
    const { comercio_id } = req.params
    const { whatsapp } = req.query

    if (!whatsapp) {
      return reply.status(400).send({ erro: 'WhatsApp obrigatório' })
    }

    const { data: usuario } = await supabaseAdmin
      .from('usuarios_cidadaos')
      .select('id')
      .eq('whatsapp', whatsapp)
      .single()

    if (!usuario) return reply.status(404).send({ erro: 'Usuário não encontrado' })

    await supabaseAdmin
      .from('optins')
      .update({ status: 'cancelado', cancelado_em: new Date().toISOString() })
      .eq('usuario_id', usuario.id)
      .eq('comercio_id', comercio_id)

    return { ok: true, mensagem: 'Opt-out realizado com sucesso' }
  })
}

module.exports = leadsRoutes
