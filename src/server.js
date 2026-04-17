// ============================================================
// SERVIDOR — Vitrine Local API
// ============================================================
require('dotenv').config()

const fastify = require('fastify')({
  bodyLimit: 50 * 1024 * 1024, // 50MB (para upload de imagens em base64)
  logger: {
    level: process.env.NODE_ENV === 'production' ? 'warn' : 'info',
    transport: process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } }
      : undefined
  }
})

// ── Plugins ──────────────────────────────────────────────────
fastify.register(require('@fastify/cors'), {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true) // curl / server-to-server
    const allowed = [
      /^http:\/\/localhost:\d+$/,               // qualquer porta localhost
      /\.vitrinelocal\.com\.br$/,
      /\.zappicidade\.com\.br$/,
      /^https?:\/\/(www\.)?zappicidadebarcarena\.com\.br$/, // domínio principal
      /\.zappicidadebarcarena\.com\.br$/,       // subdomínios (painel, api)
      /\.vercel\.app$/,                         // deploys do Vercel
      /\.railway\.app$/,                        // deploys do Railway
    ]
    cb(null, allowed.some(r => r.test(origin)))
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
})

fastify.register(require('@fastify/jwt'), {
  secret: process.env.JWT_SECRET,
  sign: { expiresIn: '30d' }
})

fastify.register(require('@fastify/rate-limit'), {
  max: 100,
  timeWindow: '1 minute',
  errorResponseBuilder: () => ({
    erro: 'Muitas requisições. Aguarde um momento.',
    statusCode: 429
  })
})

// ── Health check ─────────────────────────────────────────────
fastify.get('/health', async () => ({
  status: 'ok',
  timestamp: new Date().toISOString(),
  version: '1.0.0'
}))

// ── Rotas Públicas ────────────────────────────────────────────
fastify.register(require('./routes/cidades'),   { prefix: '/cidades' })
fastify.register(require('./routes/comercios'), { prefix: '/comercios' })
fastify.register(require('./routes/leads'),       { prefix: '/leads' })
fastify.register(require('./routes/comentarios'), { prefix: '/comentarios' })
fastify.register(require('./routes/qr'),          { prefix: '/qr' })

// ── Rotas do Bot WhatsApp ─────────────────────────────────────
fastify.register(require('./routes/webhook'),   { prefix: '/webhook' })

// ── Rotas do Comerciante (protegidas por JWT) ─────────────────
fastify.register(require('./routes/admin'),                 { prefix: '/admin' })
fastify.register(require('./routes/comerciante/auth'),      { prefix: '/auth' })
fastify.register(require('./routes/comerciante/dashboard'), { prefix: '/comerciante/dashboard' })
fastify.register(require('./routes/comerciante/perfil'),    { prefix: '/comerciante/perfil' })
fastify.register(require('./routes/comerciante/promocoes'), { prefix: '/comerciante/promocoes' })
fastify.register(require('./routes/comerciante/upload'),   { prefix: '/comerciante/upload' })
fastify.register(require('./routes/pagamento'),            { prefix: '/pagamento' })
fastify.register(require('./routes/fundador'),             { prefix: '/fundador' })

// ── Tratamento de erros globais ───────────────────────────────
fastify.setErrorHandler((error, req, reply) => {
  fastify.log.error(error)

  if (error.validation) {
    return reply.status(400).send({
      erro: 'Dados inválidos',
      detalhes: error.validation.map(e => ({
        campo: e.instancePath.replace('/', '') || e.params?.missingProperty,
        mensagem: e.message
      }))
    })
  }

  if (error.statusCode === 429) {
    return reply.status(429).send({ erro: 'Muitas requisições. Aguarde um momento.' })
  }

  reply.status(error.statusCode || 500).send({
    erro: process.env.NODE_ENV === 'production'
      ? 'Erro interno do servidor'
      : error.message
  })
})

fastify.setNotFoundHandler((req, reply) => {
  reply.status(404).send({ erro: `Rota ${req.method} ${req.url} não encontrada` })
})

// ── Inicialização ─────────────────────────────────────────────
const start = async () => {
  try {
    const port = parseInt(process.env.PORT || '3001')
    const host = process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1'

    await fastify.listen({ port, host })
    fastify.log.info(`🚀 Vitrine Local API rodando em http://${host}:${port}`)
    fastify.log.info(`📋 Ambiente: ${process.env.NODE_ENV || 'development'}`)
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

start()
