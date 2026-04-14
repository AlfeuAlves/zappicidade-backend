// ============================================================
// ROTAS ADMIN — Painel do fundador
// ============================================================
const { supabaseAdmin } = require('../config/supabase')
const { sendText }      = require('../bot/zapi')
const https             = require('https')

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => { try { resolve(JSON.parse(data)) } catch(e) { reject(e) } })
    }).on('error', reject)
  })
}

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

  // ── GET /admin/comerciantes/:id ──────────────────────────
  fastify.get('/comerciantes/:id', { preHandler: autenticarAdmin }, async (req, reply) => {
    const { id } = req.params
    const { data, error } = await supabaseAdmin
      .from('comerciantes')
      .select('id, nome_completo, email, telefone, cpf, whatsapp, ativo, status_verificacao, comercio_id, criado_em, ultimo_acesso, comercios ( id, nome, slug )')
      .eq('id', id)
      .single()
    if (error || !data) return reply.status(404).send({ erro: 'Não encontrado' })
    return data
  })

  // ── POST /admin/comerciantes ──────────────────────────────
  fastify.post('/comerciantes', { preHandler: autenticarAdmin }, async (req, reply) => {
    const { nome_completo, email, telefone, cpf, whatsapp, senha, comercio_id } = req.body || {}
    if (!nome_completo || !email) return reply.status(400).send({ erro: 'Nome e email são obrigatórios' })

    const bcrypt = require('bcrypt')
    const senha_hash = senha ? await bcrypt.hash(senha, 10) : await bcrypt.hash('zappi2024', 10)

    const { data, error } = await supabaseAdmin
      .from('comerciantes')
      .insert({
        nome_completo, email, telefone: telefone || null, cpf: cpf || null,
        whatsapp: whatsapp || null, senha_hash,
        comercio_id: comercio_id || null,
        status_verificacao: 'aprovado', ativo: true, email_verificado: true
      })
      .select('id, nome_completo, email')
      .single()

    if (error) return reply.status(400).send({ erro: error.message })
    return { ok: true, data }
  })

  // ── PUT /admin/comerciantes/:id ───────────────────────────
  fastify.put('/comerciantes/:id', { preHandler: autenticarAdmin }, async (req, reply) => {
    const { id } = req.params
    const { nome_completo, email, telefone, cpf, whatsapp, senha, ativo, status_verificacao, comercio_id } = req.body || {}

    const updates = {}
    if (nome_completo    !== undefined) updates.nome_completo    = nome_completo
    if (email            !== undefined) updates.email            = email
    if (telefone         !== undefined) updates.telefone         = telefone || null
    if (cpf              !== undefined) updates.cpf              = cpf || null
    if (whatsapp         !== undefined) updates.whatsapp         = whatsapp || null
    if (ativo            !== undefined) updates.ativo            = ativo
    if (status_verificacao !== undefined) updates.status_verificacao = status_verificacao
    if (comercio_id      !== undefined) updates.comercio_id      = comercio_id || null

    if (senha) {
      const bcrypt = require('bcrypt')
      updates.senha_hash = await bcrypt.hash(senha, 10)
    }

    if (Object.keys(updates).length === 0) return reply.status(400).send({ erro: 'Nenhum campo para atualizar' })

    const { error } = await supabaseAdmin.from('comerciantes').update(updates).eq('id', id)
    if (error) return reply.status(500).send({ erro: error.message })
    return { ok: true }
  })

  // ── DELETE /admin/comerciantes/:id ────────────────────────
  fastify.delete('/comerciantes/:id', { preHandler: autenticarAdmin }, async (req, reply) => {
    const { id } = req.params
    const { error } = await supabaseAdmin.from('comerciantes').delete().eq('id', id)
    if (error) return reply.status(500).send({ erro: error.message })
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

  // ── GET /admin/usuarios ───────────────────────────────────
  fastify.get('/usuarios', { preHandler: autenticarAdmin }, async (req, reply) => {
    const { page = 1, limit = 50, busca } = req.query
    const offset = (parseInt(page) - 1) * parseInt(limit)

    let query = supabaseAdmin
      .from('usuarios_cidadaos')
      .select('id, whatsapp, nome, bairro, total_interacoes, primeira_interacao, ultima_interacao, ativo, bloqueado', { count: 'exact' })
      .order('ultima_interacao', { ascending: false })
      .range(offset, offset + parseInt(limit) - 1)

    if (busca) query = query.ilike('whatsapp', `%${busca}%`)

    const { data, count, error } = await query
    if (error) return reply.status(500).send({ erro: error.message })
    return { data: data || [], total: count || 0 }
  })

  // ── POST /admin/reengajamento ─────────────────────────────
  fastify.post('/reengajamento', { preHandler: autenticarAdmin }, async (req, reply) => {
    const { mensagem } = req.body || {}
    if (!mensagem || mensagem.trim().length < 10) {
      return reply.status(400).send({ erro: 'Mensagem muito curta' })
    }

    // Busca todos os usuários inativos (0 interações), ativos e não bloqueados
    const { data: usuarios, error } = await supabaseAdmin
      .from('usuarios_cidadaos')
      .select('whatsapp')
      .eq('total_interacoes', 0)
      .eq('ativo', true)
      .eq('bloqueado', false)

    if (error) return reply.status(500).send({ erro: error.message })
    if (!usuarios || usuarios.length === 0) {
      return { ok: true, total: 0, enviados: 0, falhas: 0 }
    }

    let enviados = 0
    let falhas   = 0

    for (const u of usuarios) {
      try {
        await sendText(u.whatsapp, mensagem.trim())
        enviados++
        // Pausa de 800ms entre envios para não ser bloqueado
        await new Promise(r => setTimeout(r, 800))
      } catch (e) {
        falhas++
      }
    }

    return { ok: true, total: usuarios.length, enviados, falhas }
  })

  // ── GET /admin/reengajamento/preview ─────────────────────────
  fastify.get('/reengajamento/preview', { preHandler: autenticarAdmin }, async (req, reply) => {
    const { count, error } = await supabaseAdmin
      .from('usuarios_cidadaos')
      .select('*', { count: 'exact', head: true })
      .eq('total_interacoes', 0)
      .eq('ativo', true)
      .eq('bloqueado', false)

    if (error) return reply.status(500).send({ erro: error.message })
    return { total_inativos: count || 0 }
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

  // ── GET /admin/comercios/:id ─────────────────────────────────
  fastify.get('/comercios/:id', { preHandler: autenticarAdmin }, async (req, reply) => {
    const { id } = req.params

    const { data, error } = await supabaseAdmin
      .from('comercios')
      .select('id, nome, slug, endereco, bairro, telefone, whatsapp, status_operacional, verificado, destaque, avaliacao, total_avaliacoes, categoria_id, maps_url, website, foto_capa_url, place_id, horarios')
      .eq('id', id)
      .single()

    if (error || !data) return reply.status(404).send({ erro: 'Comércio não encontrado' })
    return data
  })

  // ── PUT /admin/comercios/:id ──────────────────────────────────
  fastify.put('/comercios/:id', { preHandler: autenticarAdmin }, async (req, reply) => {
    const { id } = req.params
    const allowed = ['nome', 'endereco', 'bairro', 'telefone', 'whatsapp', 'status_operacional', 'verificado', 'destaque', 'maps_url', 'website', 'foto_capa_url', 'categoria_id', 'place_id', 'horarios']

    const updates = {}
    for (const key of allowed) {
      if (key in (req.body || {})) {
        updates[key] = req.body[key] === '' ? null : req.body[key]
      }
    }

    if (Object.keys(updates).length === 0) {
      return reply.status(400).send({ erro: 'Nenhum campo válido para atualizar' })
    }

    const { error } = await supabaseAdmin
      .from('comercios')
      .update(updates)
      .eq('id', id)

    if (error) return reply.status(500).send({ erro: error.message })
    return { ok: true }
  })

  // ── POST /admin/comercios/:id/enriquecer ─────────────────────
  fastify.post('/comercios/:id/enriquecer', { preHandler: autenticarAdmin }, async (req, reply) => {
    const { id } = req.params
    const GOOGLE_KEY = process.env.GOOGLE_PLACES_API_KEY
    if (!GOOGLE_KEY) return reply.status(500).send({ erro: 'GOOGLE_PLACES_API_KEY não configurada' })

    // Busca comércio
    const { data: comercio, error: errBusca } = await supabaseAdmin
      .from('comercios')
      .select('id, nome, place_id, horarios, endereco, telefone, foto_capa_url, website')
      .eq('id', id)
      .single()

    if (errBusca || !comercio) return reply.status(404).send({ erro: 'Comércio não encontrado' })
    if (!comercio.place_id) return reply.status(400).send({ erro: 'Este comércio não tem Place ID cadastrado' })

    // Chama Google Places Details API
    const fields = 'formatted_address,formatted_phone_number,opening_hours,photos,website'
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(comercio.place_id)}&fields=${fields}&language=pt-BR&key=${GOOGLE_KEY}`

    let detalhes
    try {
      const json = await httpsGet(url)
      if (json.status !== 'OK') return reply.status(400).send({ erro: `Google retornou: ${json.status}` })
      detalhes = json.result
    } catch (e) {
      return reply.status(500).send({ erro: 'Erro ao consultar Google Places: ' + e.message })
    }

    // Monta updates — só campos vazios
    const updates = {}

    if (!comercio.horarios || Object.keys(comercio.horarios).length === 0) {
      if (detalhes.opening_hours?.periods) {
        const DIAS = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado']
        const horarios = {}
        for (const period of detalhes.opening_hours.periods) {
          const dia = DIAS[period.open?.day]
          if (!dia) continue
          horarios[dia] = {
            aberto:  `${period.open.time.slice(0,2)}:${period.open.time.slice(2)}`,
            fechado: period.close ? `${period.close.time.slice(0,2)}:${period.close.time.slice(2)}` : '23:59'
          }
        }
        if (Object.keys(horarios).length > 0) updates.horarios = horarios
      }
    }

    if (!comercio.endereco && detalhes.formatted_address) {
      updates.endereco = detalhes.formatted_address.replace(/, Brasil$/, '').trim()
    }

    if (!comercio.telefone && detalhes.formatted_phone_number) {
      updates.telefone = detalhes.formatted_phone_number
    }

    if (!comercio.foto_capa_url && detalhes.photos?.[0]?.photo_reference) {
      updates.foto_capa_url = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${detalhes.photos[0].photo_reference}&key=${GOOGLE_KEY}`
    }

    if (!comercio.website && detalhes.website) {
      updates.website = detalhes.website
    }

    if (Object.keys(updates).length === 0) {
      return { ok: true, atualizados: [], mensagem: 'Nenhum campo novo encontrado no Google' }
    }

    const { error: errUpdate } = await supabaseAdmin
      .from('comercios')
      .update(updates)
      .eq('id', id)

    if (errUpdate) return reply.status(500).send({ erro: errUpdate.message })

    return { ok: true, atualizados: Object.keys(updates), dados: updates }
  })

  // ── GET /admin/categorias ─────────────────────────────────────
  fastify.get('/categorias', { preHandler: autenticarAdmin }, async (req, reply) => {
    const { data, error } = await supabaseAdmin
      .from('categorias')
      .select('id, nome, slug, icone')
      .eq('ativo', true)
      .order('nome')
    if (error) return reply.status(500).send({ erro: error.message })
    return data || []
  })

  // ── GET /admin/categorias/revisar ────────────────────────────
  // Retorna comércios de uma categoria para revisão, um por vez
  fastify.get('/categorias/revisar', { preHandler: autenticarAdmin }, async (req, reply) => {
    const { categoria_slug, page = 1, limit = 1 } = req.query
    if (!categoria_slug) return reply.status(400).send({ erro: 'categoria_slug obrigatório' })

    const offset = (parseInt(page) - 1) * parseInt(limit)

    // Busca o id da categoria
    const { data: cat } = await supabaseAdmin
      .from('categorias')
      .select('id, nome, icone')
      .eq('slug', categoria_slug)
      .single()

    if (!cat) return reply.status(404).send({ erro: 'Categoria não encontrada' })

    const { data, count, error } = await supabaseAdmin
      .from('comercios')
      .select('id, nome, endereco, bairro, telefone, maps_url', { count: 'exact' })
      .eq('categoria_id', cat.id)
      .eq('status_operacional', 'ativo')
      .order('nome', { ascending: true })
      .range(offset, offset + parseInt(limit) - 1)

    if (error) return reply.status(500).send({ erro: error.message })
    return { data: data || [], total: count || 0, categoria: cat }
  })

  // ── PUT /admin/categorias/revisar/:id ────────────────────────
  fastify.put('/categorias/revisar/:id', { preHandler: autenticarAdmin }, async (req, reply) => {
    const { id } = req.params
    const { categoria_id } = req.body || {}
    if (!categoria_id) return reply.status(400).send({ erro: 'categoria_id obrigatório' })

    const { error } = await supabaseAdmin
      .from('comercios')
      .update({ categoria_id })
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
