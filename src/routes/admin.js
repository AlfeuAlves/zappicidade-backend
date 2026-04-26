// ============================================================
// ROTAS ADMIN — Painel do fundador
// ============================================================
const { supabaseAdmin } = require('../config/supabase')
const { sendText }      = require('../bot/zapi')
const https             = require('https')
const crypto            = require('crypto')

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

  // ── GET /admin/stats/top-comercios ────────────────────────
  fastify.get('/stats/top-comercios', { preHandler: autenticarAdmin }, async (req, reply) => {
    const { data } = await supabaseAdmin
      .from('comercios')
      .select('id, nome, total_interacoes, plano, categorias ( nome, icone )')
      .order('total_interacoes', { ascending: false })
      .limit(5)
    return data || []
  })

  // ── GET /admin/stats/atividade ────────────────────────────
  fastify.get('/stats/atividade', { preHandler: autenticarAdmin }, async (req, reply) => {
    const { data } = await supabaseAdmin
      .from('comerciantes')
      .select('id, nome_completo, criado_em, status_verificacao, comercios ( nome )')
      .order('criado_em', { ascending: false })
      .limit(8)
    return data || []
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

    const { data: comerciante, error: fetchError } = await supabaseAdmin
      .from('comerciantes')
      .select('nome_completo, whatsapp')
      .eq('id', id)
      .single()

    const { error } = await supabaseAdmin.from('comerciantes').update(updates).eq('id', id)
    if (error) return reply.status(500).send({ erro: error.message })

    if (ativo === false && !fetchError && comerciante?.whatsapp) {
      sendText(
        comerciante.whatsapp,
        `Olá, ${comerciante.nome_completo || 'comerciante'}! ❌ Sua conta no *ZappiCidade* foi *cancelada*.\n\nSe acredita que isso foi um engano, entre em contato com o suporte.`
      ).catch(() => {})
    }

    return { ok: true }
  })

  // ── DELETE /admin/comerciantes/:id ────────────────────────
  fastify.delete('/comerciantes/:id', { preHandler: autenticarAdmin }, async (req, reply) => {
    const { id } = req.params
    try {
      const { data: comerciante } = await supabaseAdmin
        .from('comerciantes').select('nome_completo, whatsapp').eq('id', id).single()

      await supabaseAdmin.from('assinaturas').delete().eq('comerciante_id', id)
      const { error } = await supabaseAdmin.from('comerciantes').delete().eq('id', id)
      if (error) return reply.status(500).send({ erro: error.message })

      if (comerciante?.whatsapp) {
        sendText(
          comerciante.whatsapp,
          `Olá, ${comerciante.nome_completo || 'comerciante'}! ❌ Sua conta no *ZappiCidade* foi *cancelada*.\n\nSe acredita que isso foi um engano, entre em contato com o suporte.`
        ).catch(() => {})
      }

      return { ok: true }
    } catch (ex) {
      return reply.status(500).send({ erro: ex.message || 'Exceção desconhecida' })
    }
  })

  // ── POST /admin/comerciantes/:id/excluir ──────────────────
  fastify.post('/comerciantes/:id/excluir', { preHandler: autenticarAdmin }, async (req, reply) => {
    const { id } = req.params
    try {
      const { data: comerciante } = await supabaseAdmin
        .from('comerciantes').select('nome_completo, whatsapp').eq('id', id).single()

      await supabaseAdmin.from('assinaturas').delete().eq('comerciante_id', id)
      const { error } = await supabaseAdmin.from('comerciantes').delete().eq('id', id)
      if (error) return reply.status(500).send({ erro: error.message })

      if (comerciante?.whatsapp) {
        sendText(
          comerciante.whatsapp,
          `Olá, ${comerciante.nome_completo || 'comerciante'}! ❌ Sua conta no *ZappiCidade* foi *cancelada*.\n\nSe acredita que isso foi um engano, entre em contato com o suporte.`
        ).catch(() => {})
      }

      return { ok: true }
    } catch (ex) {
      return reply.status(500).send({ erro: ex.message || 'Erro desconhecido' })
    }
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
    const allowed = ['nome', 'endereco', 'bairro', 'telefone', 'whatsapp', 'status_operacional', 'verificado', 'destaque', 'maps_url', 'website', 'foto_capa_url', 'categoria_id', 'place_id', 'horarios', 'funciona_24h']

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

  // ── POST /admin/comercios ─────────────────────────────────────
  fastify.post('/comercios', { preHandler: autenticarAdmin }, async (req, reply) => {
    const { nome, bairro, endereco, telefone, whatsapp, categoria_id, maps_url, website, foto_capa_url, place_id } = req.body || {}
    if (!nome) return reply.status(400).send({ erro: 'Nome é obrigatório' })

    // Gera slug a partir do nome
    const slug = nome
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80)

    // Busca cidade de Barcarena
    const { data: cidade } = await supabaseAdmin.from('cidades').select('id').eq('nome', 'Barcarena').single()

    const { data, error } = await supabaseAdmin
      .from('comercios')
      .insert({
        nome, slug, bairro: bairro || null, endereco: endereco || null,
        telefone: telefone || null, whatsapp: whatsapp || null,
        categoria_id: categoria_id || null, maps_url: maps_url || null,
        website: website || null, foto_capa_url: foto_capa_url || null,
        place_id: place_id || null,
        cidade_id: cidade?.id || null,
        status_operacional: 'ativo', verificado: false, destaque: false
      })
      .select('id, nome, slug')
      .single()

    if (error) return reply.status(400).send({ erro: error.message })
    return { ok: true, data }
  })

  // ── DELETE /admin/comercios/:id ───────────────────────────────
  fastify.delete('/comercios/:id', { preHandler: autenticarAdmin }, async (req, reply) => {
    const { id } = req.params
    const { error } = await supabaseAdmin.from('comercios').delete().eq('id', id)
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
    const { todas } = req.query
    let query = supabaseAdmin
      .from('categorias')
      .select('id, nome, slug, icone, ordem, ativo, tipo_google')
      .order('ordem', { ascending: true })
    if (!todas) query = query.eq('ativo', true)
    const { data, error } = await query
    if (error) return reply.status(500).send({ erro: error.message })
    return data || []
  })

  // ── POST /admin/categorias ────────────────────────────────────
  fastify.post('/categorias', { preHandler: autenticarAdmin }, async (req, reply) => {
    const { nome, icone, tipo_google, ordem } = req.body || {}
    if (!nome) return reply.status(400).send({ erro: 'Nome é obrigatório' })

    const slug = nome
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')

    // Pega a maior ordem atual
    const { data: maxOrdem } = await supabaseAdmin
      .from('categorias').select('ordem').order('ordem', { ascending: false }).limit(1).single()

    const { data, error } = await supabaseAdmin
      .from('categorias')
      .insert({ nome, slug, icone: icone || '🏪', tipo_google: tipo_google || null, ordem: ordem ?? ((maxOrdem?.ordem || 0) + 1), ativo: true })
      .select('id, nome, slug, icone, ordem, ativo')
      .single()

    if (error) return reply.status(400).send({ erro: error.message })
    return { ok: true, data }
  })

  // ── PUT /admin/categorias/:id ─────────────────────────────────
  fastify.put('/categorias/:id', { preHandler: autenticarAdmin }, async (req, reply) => {
    const { id } = req.params
    const { nome, icone, tipo_google, ordem, ativo } = req.body || {}
    const updates = {}
    if (nome        !== undefined) updates.nome        = nome
    if (icone       !== undefined) updates.icone       = icone
    if (tipo_google !== undefined) updates.tipo_google = tipo_google || null
    if (ordem       !== undefined) updates.ordem       = parseInt(ordem)
    if (ativo       !== undefined) updates.ativo       = ativo

    if (Object.keys(updates).length === 0) return reply.status(400).send({ erro: 'Nenhum campo para atualizar' })

    const { error } = await supabaseAdmin.from('categorias').update(updates).eq('id', id)
    if (error) return reply.status(500).send({ erro: error.message })
    return { ok: true }
  })

  // ── DELETE /admin/categorias/:id ──────────────────────────────
  fastify.delete('/categorias/:id', { preHandler: autenticarAdmin }, async (req, reply) => {
    const { id } = req.params
    // Verifica se há comércios nessa categoria
    const { count } = await supabaseAdmin
      .from('comercios').select('*', { count: 'exact', head: true }).eq('categoria_id', id)
    if (count && count > 0)
      return reply.status(400).send({ erro: `Não é possível excluir: ${count} comércio(s) nessa categoria. Mova-os primeiro.` })

    const { error } = await supabaseAdmin.from('categorias').delete().eq('id', id)
    if (error) return reply.status(500).send({ erro: error.message })
    return { ok: true }
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

  // ── GET /admin/comercios/:id/qrcode ─────────────────────────
  fastify.get('/comercios/:id/qrcode', { preHandler: autenticarAdmin }, async (req, reply) => {
    const { id } = req.params

    const { data: qr } = await supabaseAdmin
      .from('qrcodes')
      .select('*')
      .eq('comercio_id', id)
      .maybeSingle()

    if (!qr) return reply.send({ qrcode: null })

    const url        = `https://www.zappicidadebarcarena.com.br/qr/${qr.codigo}`
    const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&margin=10&data=${encodeURIComponent(url)}`
    return reply.send({ qrcode: { ...qr, url, qr_image_url: qrImageUrl } })
  })

  // ── POST /admin/comercios/:id/qrcode ────────────────────────
  fastify.post('/comercios/:id/qrcode', { preHandler: autenticarAdmin }, async (req, reply) => {
    const { id } = req.params

    try {
      // Garante que não existe outro QR para este comércio
      const { data: existente, error: errExist } = await supabaseAdmin
        .from('qrcodes')
        .select('id, codigo, total_scans')
        .eq('comercio_id', id)
        .maybeSingle()

      if (errExist) return reply.status(500).send({ erro: 'Erro ao buscar QR: ' + errExist.message })

      if (existente) {
        const url        = `https://www.zappicidadebarcarena.com.br/qr/${existente.codigo}`
        const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&margin=10&data=${encodeURIComponent(url)}`
        return reply.send({ qrcode: { ...existente, url, qr_image_url: qrImageUrl } })
      }

      // Gera código único de 8 caracteres (hex maiúsculo)
      const codigo = crypto.randomBytes(4).toString('hex').toUpperCase()
      const url    = `https://www.zappicidadebarcarena.com.br/qr/${codigo}`

      const { data: qr, error } = await supabaseAdmin
        .from('qrcodes')
        .insert({ comercio_id: id, codigo, url_destino: url, total_scans: 0 })
        .select()
        .single()

      if (error) return reply.status(500).send({ erro: 'Erro ao criar QR: ' + error.message })

      const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&margin=10&data=${encodeURIComponent(url)}`
      return reply.status(201).send({ qrcode: { ...qr, url, qr_image_url: qrImageUrl } })

    } catch (e) {
      fastify.log.error('POST qrcode error:', e)
      return reply.status(500).send({ erro: 'Exceção: ' + e.message })
    }
  })

  // ── GET /admin/prospeccao/preview ───────────────────────────
  fastify.get('/prospeccao/preview', { preHandler: autenticarAdmin }, async (req, reply) => {
    const fs   = require('fs')
    const path = require('path')
    const LOG  = path.join(__dirname, '../../data/prospeccao_admin.json')

    const log         = fs.existsSync(LOG) ? JSON.parse(fs.readFileSync(LOG, 'utf8')) : { enviados: [] }
    const jaContatados = new Set(log.enviados.map(e => e.id))

    const { count: totalComWhatsapp } = await supabaseAdmin
      .from('comercios')
      .select('*', { count: 'exact', head: true })
      .not('whatsapp', 'is', null)
      .neq('whatsapp', '')
      .eq('status_operacional', 'ativo')

    const total    = totalComWhatsapp || 0
    const enviados = jaContatados.size
    const pendentes = Math.max(0, total - enviados)

    return { total_com_whatsapp: total, ja_contatados: enviados, pendentes, ultimo_envio: log.ultimo_envio || null }
  })

  // ── POST /admin/prospeccao/iniciar ───────────────────────────
  fastify.post('/prospeccao/iniciar', { preHandler: autenticarAdmin }, async (req, reply) => {
    const fs   = require('fs')
    const path = require('path')
    const LOG  = path.join(__dirname, '../../data/prospeccao_admin.json')
    const DATA_DIR = path.join(__dirname, '../../data')

    const { limite = 10, delay_ms = 8000 } = req.body || {}
    const limiteNum = Math.min(Math.max(parseInt(limite) || 10, 1), 50)
    const delayMs   = Math.min(Math.max(parseInt(delay_ms) || 8000, 3000), 60000)

    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
    const log          = fs.existsSync(LOG) ? JSON.parse(fs.readFileSync(LOG, 'utf8')) : { enviados: [] }
    const jaContatados = new Set(log.enviados.map(e => e.id))

    const PAINEL_URL = 'https://painel.zappicidadebarcarena.com.br/comerciante/login'
    const SITE_BASE  = 'https://www.zappicidadebarcarena.com.br/c'

    const { data: comercios, error } = await supabaseAdmin
      .from('comercios')
      .select('id, nome, slug, whatsapp, bairro, categorias(nome)')
      .not('whatsapp', 'is', null)
      .neq('whatsapp', '')
      .eq('status_operacional', 'ativo')
      .order('avaliacao', { ascending: false })
      .limit(limiteNum + jaContatados.size + 100)

    if (error) return reply.status(500).send({ erro: error.message })

    const candidatos = (comercios || [])
      .filter(c => !jaContatados.has(c.id))
      .slice(0, limiteNum)

    if (candidatos.length === 0) {
      return { ok: true, enviados: 0, falhas: 0, total_candidatos: 0, mensagem: 'Todos os estabelecimentos já foram contatados.' }
    }

    let enviados = 0
    let falhas   = 0

    for (let i = 0; i < candidatos.length; i++) {
      const c   = candidatos[i]
      const tel = (c.whatsapp || '').replace(/\D/g, '')
      if (!tel || tel.length < 10) { falhas++; continue }

      const categoria = c.categorias?.nome || 'estabelecimento'
      const linkPerfil = `${SITE_BASE}/${c.slug}`

      const mensagem = `Olá! 👋

Somos o *ZappiCidade* — o assistente digital de Barcarena pelo WhatsApp.

Antes de tudo, *experimente agora mesmo* como os moradores nos usam:
👉 https://zappicidadebarcarena.com.br/zappi

Manda uma mensagem lá e veja como funciona! É bem simples 😊

━━━━━━━━━━━━━━━━━
🏪 *Sobre o ${c.nome}*

Boa notícia: *${c.nome}* já está cadastrado e aparece nas buscas dos moradores de Barcarena! 🎉

Os moradores perguntam ao nosso assistente coisas como:
• _"${categoria === 'Farmácias' ? 'Farmácia aberta agora perto de mim?' : categoria === 'Restaurantes' ? 'Restaurante que serve marmita hoje?' : `Onde tem ${categoria.toLowerCase()} em Barcarena?`}"_

E a IA indica os melhores — incluindo o seu estabelecimento! 🤖

📍 Veja seu perfil:
${linkPerfil}

━━━━━━━━━━━━━━━━━

Quer aparecer ainda mais? Com uma conta gratuita você pode:
✅ Editar horários de funcionamento
✅ Adicionar foto e descrição
✅ Receber contatos de clientes direto

👉 Cadastre-se grátis:
${PAINEL_URL}

Qualquer dúvida, é só responder aqui. 😊
— Equipe ZappiCidade`

      try {
        await sendText(tel, mensagem)
        log.enviados.push({ id: c.id, nome: c.nome, telefone: tel, enviado_em: new Date().toISOString() })
        fs.writeFileSync(LOG, JSON.stringify(log, null, 2))
        enviados++
      } catch {
        falhas++
      }

      if (i < candidatos.length - 1) {
        await new Promise(r => setTimeout(r, delayMs))
      }
    }

    log.ultimo_envio = new Date().toISOString()
    fs.writeFileSync(LOG, JSON.stringify(log, null, 2))

    return { ok: true, enviados, falhas, total_candidatos: candidatos.length }
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
