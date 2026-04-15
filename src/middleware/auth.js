// ============================================================
// MIDDLEWARE — Autenticação JWT
// ============================================================
const { supabaseAdmin } = require('../config/supabase')

async function autenticar(req, reply) {
  try {
    await req.jwtVerify()

    // Verifica se o comerciante ainda existe e está ativo
    const { data: comerciante, error } = await supabaseAdmin
      .from('comerciantes')
      .select('id, email, ativo, comercio_id, status_verificacao')
      .eq('id', req.user.sub)
      .single()

    if (error || !comerciante) {
      return reply.status(401).send({ erro: 'Usuário não encontrado' })
    }

    if (!comerciante.ativo) {
      return reply.status(403).send({ erro: 'Conta suspensa. Entre em contato com o suporte.' })
    }

    // Injeta dados do comerciante na requisição
    req.comerciante = comerciante

  } catch (err) {
    return reply.status(401).send({ erro: 'Token inválido ou expirado' })
  }
}

module.exports = { autenticar }
