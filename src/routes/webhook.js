// ============================================================
// WEBHOOK — Recebe mensagens da Z-API e aciona o agente IA
// ============================================================
// Endpoint: POST /webhook/zapi
//
// Fluxo:
//   1. Z-API envia mensagem recebida
//   2. Filtra: ignora mensagens próprias, grupos, não-texto
//   3. Chama agente.processar(telefone, texto)
//   4. Envia resposta via zapi.sendText()
// ============================================================

const agente = require('../bot/agente')
const zapi   = require('../bot/zapi')
const sessoes = require('../bot/sessoes')
const { supabaseAdmin } = require('../config/supabase')

// Registra/atualiza usuário no banco (fire-and-forget — não bloqueia o bot)
function registrarUsuario(telefone) {
  supabaseAdmin
    .from('usuarios_cidadaos')
    .upsert(
      { whatsapp: telefone, ultima_interacao: new Date().toISOString() },
      { onConflict: 'whatsapp', ignoreDuplicates: false }
    )
    .then(({ error }) => {
      if (!error) {
        // Incrementa contador de interações
        supabaseAdmin.rpc('incrementar_interacoes', { p_whatsapp: telefone }).catch(() => {})
      }
    })
    .catch(() => {}) // nunca deixa falhar o fluxo principal
}

async function webhookRoutes(fastify) {

  // POST /webhook/zapi — mensagens recebidas da Z-API
  fastify.post('/zapi', async (req, reply) => {
    const payload = req.body

    // ── Validações de segurança básica ─────────────────────
    // Ignora mensagens enviadas pelo próprio bot
    if (payload.fromMe === true) {
      return reply.status(200).send({ ok: true, ignorado: 'fromMe' })
    }

    // Ignora mensagens de grupos
    if (payload.isGroup === true || payload.participantPhone) {
      return reply.status(200).send({ ok: true, ignorado: 'grupo' })
    }

    // Só processa tipo de callback de mensagem recebida
    if (payload.type !== 'ReceivedCallback') {
      return reply.status(200).send({ ok: true, ignorado: `tipo:${payload.type}` })
    }

    const telefone = payload.phone
    if (!telefone) {
      return reply.status(200).send({ ok: true, ignorado: 'sem_telefone' })
    }

    // ── Registra usuário no banco (toda mensagem válida) ──────
    registrarUsuario(telefone)

    // ── Localização compartilhada pelo usuário (📎 → Localização) ──
    const loc = payload.location
    if (loc && loc.latitude && loc.longitude) {
      sessoes.salvarLocalizacao(telefone, {
        lat:    parseFloat(loc.latitude),
        lng:    parseFloat(loc.longitude),
        bairro: null,
        origem: 'gps'
      })
      fastify.log.info({ telefone, lat: loc.latitude, lng: loc.longitude }, '📍 Localização recebida')

      try {
        await zapi.sendText(
          telefone,
          '📍 Localização recebida! Agora vou priorizar estabelecimentos perto de você. O que você está procurando? 😊'
        )
      } catch (_) {}

      return reply.status(200).send({ ok: true, localização: 'salva' })
    }

    // Só processa texto
    const texto = payload.text?.message
    if (!texto || typeof texto !== 'string' || texto.trim() === '') {
      return reply.status(200).send({ ok: true, ignorado: 'sem_texto' })
    }

    // ── Mensagem de boas-vindas (primeiro contato via link) ──
    const textoNorm = texto.trim().toLowerCase().replace(/[^a-záéíóúãõâêîôûç ]/gi, '').trim()
    const eBemVindo = ['oi zappi', 'oi  zappi', 'olá zappi', 'ola zappi', 'oi!', 'oi'].includes(textoNorm)
      || textoNorm === 'oi zappi'

    if (eBemVindo && !sessoes.getOuCriar(telefone).mensagens?.length) {
      const boasVindas = `Olá! 👋 Eu sou o *Zappi*, seu guia de comércios em Barcarena! 🐊

Aqui você encontra farmácias, restaurantes, açaí, mercados, salões, barbearias e muito mais — tudo da nossa cidade.

Para te mostrar os estabelecimentos *mais perto de você*, compartilhe sua localização agora 👇
📎 Clique no clipe → *Localização* → *Enviar localização atual*

Ou se preferir, é só me dizer o que está procurando! 😊
_Ex: "farmácia aberta agora", "ponto de açaí no Centro", "restaurante"_`

      try { await zapi.sendText(telefone, boasVindas) } catch (_) {}
      sessoes.addMensagem(telefone, 'assistant', boasVindas)
      return reply.status(200).send({ ok: true, boasvindas: true })
    }

    // ── Processa com o agente ──────────────────────────────
    fastify.log.info({ telefone, texto }, '📨 Mensagem recebida')

    try {
      const resposta = await agente.processar(telefone, texto.trim())

      await zapi.sendText(telefone, resposta)

      fastify.log.info({ telefone, chars: resposta.length }, '✅ Resposta enviada')

      return reply.status(200).send({ ok: true })

    } catch (err) {
      fastify.log.error({ err: err.message, telefone }, '❌ Erro ao processar mensagem')

      // Tenta enviar mensagem de erro para o usuário
      try {
        await zapi.sendText(
          telefone,
          'Opa, tive um problema técnico aqui 😅 Tenta de novo em instantes!'
        )
      } catch (_) { /* silencia erro no fallback */ }

      return reply.status(200).send({ ok: false, erro: err.message })
    }
  })

  // GET /webhook/status — diagnóstico rápido
  fastify.get('/status', async (req, reply) => {
    const sessoes_ativas = sessoes.totalAtivas()

    let whatsapp_status = 'não configurado'
    if (process.env.ZAPI_INSTANCE_ID && process.env.ZAPI_TOKEN) {
      try {
        const st = await zapi.getStatus()
        whatsapp_status = st.connected ? 'conectado' : `desconectado (${st.status || 'unknown'})`
      } catch (err) {
        whatsapp_status = `erro: ${err.message}`
      }
    }

    return {
      bot:             'ZappiCidade Bot',
      sessoes_ativas,
      whatsapp_status,
      ia_configurada:  !!process.env.ANTHROPIC_API_KEY,
      timestamp:       new Date().toISOString()
    }
  })
}

module.exports = webhookRoutes
