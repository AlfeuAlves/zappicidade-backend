// ============================================================
// ROTAS — Autenticação do Comerciante
// ============================================================
const { supabaseAdmin } = require('../../config/supabase')
const bcrypt = require('bcrypt')
const { sendText } = require('../../bot/zapi')
const logger = require('../../lib/logger')

async function authRoutes(fastify) {

  // POST /auth/registro — cria conta de comerciante
  fastify.post('/registro', {
    schema: {
      body: {
        type: 'object',
        required: ['nome', 'email', 'senha', 'whatsapp'],
        properties: {
          nome:       { type: 'string', minLength: 2 },
          email:      { type: 'string', format: 'email' },
          senha:      { type: 'string', minLength: 6 },
          whatsapp:   { type: 'string' },
          comercio_id:{ type: 'string' }
        }
      }
    }
  }, async (req, reply) => {
    const { nome, email, senha, whatsapp, comercio_id } = req.body

    // Verifica e-mail duplicado
    const { data: existe } = await supabaseAdmin
      .from('comerciantes')
      .select('id')
      .eq('email', email.toLowerCase())
      .single()

    if (existe) {
      logger.aviso('auth', `Tentativa de registro com e-mail já cadastrado: ${email}`)
      return reply.status(409).send({ erro: 'E-mail já cadastrado' })
    }

    // Hash da senha
    const senha_hash = await bcrypt.hash(senha, 10)

    // Cria o comerciante
    const { data: comerciante, error } = await supabaseAdmin
      .from('comerciantes')
      .insert({
        nome_completo: nome,
        email: email.toLowerCase(),
        senha_hash,
        whatsapp,
        comercio_id: comercio_id || null,
        ativo: true,
      })
      .select('id, nome_completo, email, whatsapp, comercio_id, status_verificacao')
      .single()

    if (error) return reply.status(500).send({ erro: error.message })

    // Gera JWT
    const token = fastify.jwt.sign(
      { sub: comerciante.id, email: comerciante.email },
      { expiresIn: '30d' }
    )

    logger.info('auth', `Novo comerciante registrado: ${comerciante.email}`, { nome: comerciante.nome_completo }, comerciante.id, 'comerciante')
    return reply.status(201).send({ ok: true, token, comerciante })
  })

  // POST /auth/login — autenticação
  fastify.post('/login', {
    schema: {
      body: {
        type: 'object',
        required: ['email', 'senha'],
        properties: {
          email: { type: 'string', format: 'email' },
          senha: { type: 'string' }
        }
      }
    }
  }, async (req, reply) => {
    const { email, senha } = req.body

    const { data: comerciante, error } = await supabaseAdmin
      .from('comerciantes')
      .select('id, nome_completo, email, senha_hash, whatsapp, comercio_id, ativo, status_verificacao')
      .eq('email', email.toLowerCase())
      .single()

    if (error || !comerciante) {
      logger.aviso('auth', `Falha de login — e-mail não encontrado: ${email}`)
      return reply.status(401).send({ erro: 'E-mail ou senha incorretos' })
    }

    if (!comerciante.ativo) {
      logger.aviso('auth', `Login bloqueado — conta suspensa: ${email}`, null, comerciante.id, 'comerciante')
      return reply.status(403).send({ erro: 'Conta suspensa. Entre em contato com o suporte.' })
    }

    const senhaCorreta = await bcrypt.compare(senha, comerciante.senha_hash)
    if (!senhaCorreta) {
      logger.aviso('auth', `Falha de login — senha incorreta: ${email}`, null, comerciante.id, 'comerciante')
      return reply.status(401).send({ erro: 'E-mail ou senha incorretos' })
    }

    // Atualiza último acesso
    await supabaseAdmin
      .from('comerciantes')
      .update({ ultimo_acesso: new Date().toISOString() })
      .eq('id', comerciante.id)

    const token = fastify.jwt.sign(
      { sub: comerciante.id, email: comerciante.email },
      { expiresIn: '30d' }
    )

    const { senha_hash, ...dadosPublicos } = comerciante

    logger.info('auth', `Login bem-sucedido: ${comerciante.email}`, null, comerciante.id, 'comerciante')
    return { ok: true, token, comerciante: dadosPublicos }
  })

  // POST /auth/esqueci-senha — envia link de redefinição
  fastify.post('/esqueci-senha', {
    schema: {
      body: {
        type: 'object',
        required: ['email'],
        properties: {
          email: { type: 'string', format: 'email' }
        }
      }
    }
  }, async (req, reply) => {
    const { email } = req.body

    const { data: comerciante } = await supabaseAdmin
      .from('comerciantes')
      .select('id, nome, email')
      .eq('email', email.toLowerCase())
      .single()

    // Sempre retorna sucesso por segurança (não revela se e-mail existe)
    if (!comerciante) {
      return { ok: true, mensagem: 'Se o e-mail existir, você receberá um link em breve.' }
    }

    // Gera token temporário (válido 1 hora)
    const token = fastify.jwt.sign(
      { sub: comerciante.id, tipo: 'reset_senha' },
      { expiresIn: '1h' }
    )

    // Salva token no banco
    await supabaseAdmin
      .from('comerciantes')
      .update({ reset_token: token, reset_token_expira: new Date(Date.now() + 3600000).toISOString() })
      .eq('id', comerciante.id)

    // Envia link de redefinição via WhatsApp
    const FRONTEND_URL = process.env.FRONTEND_URL || 'https://painel.zappicidadebarcarena.com.br'
    const linkReset = `${FRONTEND_URL}/comerciante/redefinir-senha?token=${token}`

    if (comerciante.whatsapp) {
      const tel = comerciante.whatsapp.replace(/\D/g, '')
      const msg = `Olá, ${comerciante.nome || 'comerciante'}! 👋\n\nRecebemos uma solicitação para redefinir a senha da sua conta no *ZappiCidade*.\n\nClique no link abaixo para criar uma nova senha (válido por 1 hora):\n${linkReset}\n\nSe não foi você quem solicitou, ignore esta mensagem. Sua senha permanece a mesma.`
      await sendText(tel, msg).catch(e => fastify.log.warn('Falha ao enviar WhatsApp reset senha:', e))
    }

    logger.info('auth', `Reset de senha solicitado: ${comerciante.email}`, { tem_whatsapp: !!comerciante.whatsapp }, comerciante.id, 'comerciante')

    return { ok: true, mensagem: 'Se o cadastro existir, você receberá o link pelo WhatsApp em instantes.' }
  })

  // POST /auth/redefinir-senha — redefine a senha com token
  fastify.post('/redefinir-senha', {
    schema: {
      body: {
        type: 'object',
        required: ['token', 'nova_senha'],
        properties: {
          token:      { type: 'string' },
          nova_senha: { type: 'string', minLength: 6 }
        }
      }
    }
  }, async (req, reply) => {
    const { token, nova_senha } = req.body

    let payload
    try {
      payload = fastify.jwt.verify(token)
    } catch {
      return reply.status(400).send({ erro: 'Token inválido ou expirado' })
    }

    if (payload.tipo !== 'reset_senha') {
      return reply.status(400).send({ erro: 'Token inválido' })
    }

    const senha_hash = await bcrypt.hash(nova_senha, 10)

    const { error } = await supabaseAdmin
      .from('comerciantes')
      .update({ senha_hash, reset_token: null, reset_token_expira: null })
      .eq('id', payload.sub)

    if (error) return reply.status(500).send({ erro: error.message })

    logger.info('auth', `Senha redefinida com sucesso para comerciante: ${payload.sub}`, null, payload.sub, 'comerciante')
    return { ok: true, mensagem: 'Senha redefinida com sucesso' }
  })
}

module.exports = authRoutes
