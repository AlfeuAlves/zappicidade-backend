// ============================================================
// ROTAS ADMIN — Painel do fundador
// ============================================================
const { supabaseAdmin } = require('../config/supabase')
const { sendText }      = require('../bot/zapi')

// ── Middleware admin ──────────────────────────────────────────
async function autenticarAdmin(req, reply) {
  try {
    await req.jwtVerify()
    if (req.user.role !== 'admin') {
      return reply.status(403).send({ erro: 'Acesso negado' })
    }
  } catch {
    return reply.status(401).send({ erro: 'Token inválido' })
  }
}

async function adminRoutes(fastify) {

  // ── POST /admin/login ─────────────────────────────────────
  fastify.post('/login', async (req, reply) => {
    const { email, senha } = req.body || {}
    const adminEmail = process.env.ADMIN_EMAIL   || 'alfeu.alves@ipainel.net'
    const adminSenha = process.env.ADMIN_PASSWORD || 'admin2026'

    if (!email || !senha) {
      return reply.status(400).send({ erro: 'Email e senha obrigatórios' })
    }
    if (email.toLowerCase() !== adminEmail.toLowerCase() || senha !== adminSenha) {
      return reply.status(401).send({ erro: 'Credenciais inválidas' })
    }

    const token = fastify.jwt.sign(
      { sub: 'admin', role: 'admin', email: adminEmail },
      { expiresIn: '12h' }
    )
    return { ok: true, token, email: adminEmail }
  })

  // ── GET /admin/stats ──────────────────────────────────────
  fastify.get('/stats', { preHandler: autenticarAdmin }, async (req, reply) => {
    const hoje = new Date()
    hoje.setHours(0, 0, 0, 0)
    const mes30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

    const [
      { count: totalComercios },
      { count: totalComerciantes },
      { count: pendentes },
      { count: aprovados },
      { count: rejeitados },
      { count: leadsHoje },
      { count: leadsMes },
    ] = await Promise.all([
      supabaseAdmin.from('comercios').select('*', { count: 'exact', head: true }),
      supabaseAdmin.from('comerciantes').select('*', { count: 'exact', head: true }),
      supabaseAdmin.from('comerciantes').select('*', { count: 'exact', head: true }).eq('status_verificacao', 'pendente'),
      supabaseAdmin.from('comerciantes').select('*', { count: 'exact', head: true }).eq('status_verificacao', 'aprovado'),
      supabaseAdmin.from('comerciantes').select('*', { count: 'exact', head: true }).eq('status_verificacao', 'rejeitado'),
      supabaseAdmin.from('leads_comercio').select('*', { count: 'exact', head: true }).gte('criado_em', hoje.toISOString()),
      supabaseAdmin.from('leads_comercio').select('*', { count: 'exact', head: true }).gte('criado_em', mes30.toISOString()),
    ])

    return {
      total_comercios:    totalComercios    || 0,
      total_comerciantes: totalComerciantes || 0,
      pendentes:          pendentes         || 0,
      aprovados:          aprovados         || 0,
      rejeitados:         rejeitados        || 0,
      leads_hoje:         leadsHoje         || 0,
      leads_mes:          leadsMes          || 0,
    }
  })

  // ── GET /admin/comerciantes ───────────────────────────────
  fastify.get('/comerciantes', { preHandler: autenticarAdmin }, async (req, reply) => {
    const { status, busca, page = 1, limit = 30 } = req.query
    const offset = (parseInt(page) - 1) * parseInt(limit)

    let query = supabaseAdmin
      .from('comerciantes')
      .select(`
        id, nome_completo, email, whatsapp, ativo,
        status_verificacao, criado_em, ultimo_acesso, comercio_id,
        comercios ( id, nome, slug )
      `, { count: 'exact' })
      .order('criado_em', { ascending: false })
      .range(offset, offset + parseInt(limit) - 1)

    if (status && status !== 'todos') query = query.eq('status_verificacao', status)
    if (busca) query = query.or(`nome_completo.ilike.%${busca}%,email.ilike.%${busca}%`)

    const { data, count, error } = await query
    if (error) return reply.status(500).send({ erro: error.message })
    return { data: data || [], total: count || 0 }
  })

  // ── POST /admin/comerciantes/:id/aprovar ─────────────────
  fastify.post('/comerciantes/:id/aprovar', { preHandler: autenticarAdmin }, async (req, reply) => {
    const { id } = req.params
    const { data: c } = await supabaseAdmin
      .from('comerciantes').select('id, nome_completo, whatsapp, comercio_id').eq('id', id).single()
    if (!c) return reply.status(404).send({ erro: 'Não encontrado' })

    await supabaseAdmin.from('comerciantes').update({
      status_verificacao: 'aprovado', verificado_em: new Date().toISOString(),
      token_verificacao: null, ativo: true,
    }).eq('id', id)

    if (c.comercio_id) {
      await supabaseAdmin.from('comercios').update({ verificado: true }).eq('id', c.comercio_id)
    }

    if (c.whatsapp) {
      sendText(c.whatsapp,
        `Olá, ${c.nome_completo || 'comerciante'}! ✅ Sua conta no *ZappiCidade* foi *verificada com sucesso*!\n\nAcesse seu painel: ${process.env.FRONTEND_URL}/comerciante/dashboard`
      ).catch(() => {})
    }

    return { ok: true }
  })

  // ── POST /admin/comerciantes/:id/rejeitar ────────────────
  fastify.post('/comerciantes/:id/rejeitar', { preHandler: autenticarAdmin }, async (req, reply) => {
    const { id } = req.params
    const { motivo } = req.body || {}
    const { data: c } = await supabaseAdmin
      .from('comerciantes').select('id, nome_completo, whatsapp').eq('id', id).single()
    if (!c) return reply.status(404).send({ erro: 'Não encontrado' })

    await supabaseAdmin.from('comerciantes').update({
      status_verificacao: 'rejeitado', token_verificacao: null,
    }).eq('id', id)

    if (c.whatsapp) {
      sendText(c.whatsapp,
        `Olá, ${c.nome_completo || 'comerciante'}! ❌ Não conseguimos verificar sua conta no *ZappiCidade*.\n${motivo ? `Motivo: ${motivo}\n` : ''}\nEntre em contato conosco para mais informações.`
      ).catch(() => {})
    }

    return { ok: true }
  })

  // ── GET /admin/comercios ──────────────────────────────────
  fastify.get('/comercios', { preHandler: autenticarAdmin }, async (req, reply) => {
    const { busca, page = 1, limit = 30 } = req.query
    const offset = (parseInt(page) - 1) * parseInt(limit)

    let query = supabaseAdmin
      .from('comercios')
      .select(`id, nome, slug, verificado, destaque, status_operacional, avaliacao, total_avaliacoes, bairro, criado_em, categorias ( nome, icone )`, { count: 'exact' })
      .order('nome', { ascending: true })
      .range(offset, offset + parseInt(limit) - 1)

    if (busca) query = query.ilike('nome', `%${busca}%`)

    const { data, count, error } = await query
    if (error) return reply.status(500).send({ erro: error.message })
    return { data: data || [], total: count || 0 }
  })

  // ── GET /admin/leads ──────────────────────────────────────
  fastify.get('/leads', { preHandler: autenticarAdmin }, async (req, reply) => {
    const { page = 1, limit = 30 } = req.query
    const offset = (parseInt(page) - 1) * parseInt(limit)

    const { data, count, error } = await supabaseAdmin
      .from('leads_comercio')
      .select(`id, acao, criado_em, comercios ( nome, slug )`, { count: 'exact' })
      .order('criado_em', { ascending: false })
      .range(offset, offset + parseInt(limit) - 1)

    if (error) return reply.status(500).send({ erro: error.message })
    return { data: data || [], total: count || 0 }
  })

  // ── GET /admin/bairros/pendentes ─────────────────────────────
  fastify.get('/bairros/pendentes', { preHandler: autenticarAdmin }, async (req, reply) => {
    const { page = 1, limit = 1 } = req.query
    const offset = (parseInt(page) - 1) * parseInt(limit)

    const { data, count, error } = await supabaseAdmin
      .from('comercios')
      .select('id, nome, endereco, bairro', { count: 'exact' })
      .is('bairro', null)
      .eq('status_operacional', 'ativo')
      .order('nome', { ascending: true })
      .range(offset, offset + parseInt(limit) - 1)

    if (error) return reply.status(500).send({ erro: error.message })
    return { data: data || [], total: count || 0 }
  })

  // ── PUT /admin/bairros/:id ────────────────────────────────────
  fastify.put('/bairros/:id', { preHandler: autenticarAdmin }, async (req, reply) => {
    const { id } = req.params
    const { bairro } = req.body || {}

    const { error } = await supabaseAdmin
      .from('comercios')
      .update({ bairro: bairro || null })
      .eq('id', id)

    if (error) return reply.status(500).send({ erro: error.message })
    return { ok: true }
  })

  // ── GET /admin/verificar/:token (link via WhatsApp — legado) ──
  fastify.get('/verificar/:token', async (req, reply) => {
    const { token } = req.params
    const rejeitar  = req.query.rejeitar === 'true'

    const { data: comerciante, error } = await supabaseAdmin
      .from('comerciantes')
      .select('id, nome_completo, email, whatsapp, comercio_id, status_verificacao')
      .eq('token_verificacao', token).single()

    if (error || !comerciante) {
      return reply.status(404).type('text/html').send(`<html><body style="font-family:sans-serif;padding:40px;text-align:center"><h2>❌ Token inválido ou expirado.</h2></body></html>`)
    }
    if (comerciante.status_verificacao !== 'pendente') {
      return reply.type('text/html').send(`<html><body style="font-family:sans-serif;padding:40px;text-align:center"><h2>⚠️ Link já utilizado.</h2><p>Status: <strong>${comerciante.status_verificacao}</strong></p></body></html>`)
    }

    await supabaseAdmin.from('comerciantes').update({
      status_verificacao: rejeitar ? 'rejeitado' : 'aprovado',
      verificado_em: new Date().toISOString(),
      token_verificacao: null,
      ...(rejeitar ? {} : { ativo: true }),
    }).eq('id', comerciante.id)

    if (!rejeitar && comerciante.comercio_id) {
      await supabaseAdmin.from('comercios').update({ verificado: true }).eq('id', comerciante.comercio_id)
    }

    if (comerciante.whatsapp) {
      const msg = rejeitar
        ? `Olá, ${comerciante.nome_completo || 'comerciante'}! ❌ Não conseguimos verificar sua conta. Entre em contato.`
        : `Olá, ${comerciante.nome_completo || 'comerciante'}! ✅ Conta verificada! Acesse: ${process.env.FRONTEND_URL}/comerciante/dashboard`
      sendText(comerciante.whatsapp, msg).catch(() => {})
    }

    return reply.type('text/html').send(`
      <html><head><meta charset="utf-8"><title>ZappiCidade Admin</title></head>
      <body style="font-family:sans-serif;padding:60px;text-align:center;max-width:500px;margin:0 auto">
        <div style="font-size:64px;margin-bottom:16px">${rejeitar ? '❌' : '✅'}</div>
        <h2 style="color:${rejeitar ? '#DC2626' : '#16A34A'}">${rejeitar ? 'Rejeitado' : 'Aprovado!'}</h2>
        <p style="color:#6B7280"><strong>${comerciante.nome_completo || comerciante.email}</strong> foi ${rejeitar ? 'rejeitado' : 'verificado'}.</p>
        <br><a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/admin/dashboard" style="color:#16A34A;font-weight:600">← Ir para o painel admin</a>
      </body></html>
    `)
  })
}

module.exports = adminRoutes
