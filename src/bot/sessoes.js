// ============================================================
// SESSÕES — Contexto de conversa por telefone
// ============================================================
// Armazena histórico de mensagens em memória por sessão.
// Cada sessão expira após TIMEOUT_MS de inatividade.
// Em produção, substituir por Redis para escalabilidade.
// ============================================================

const TIMEOUT_MS     = 30 * 60 * 1000  // 30 minutos
const MAX_HISTORICO  = 20               // máximo de mensagens por sessão

const sessoes = new Map()

// ── Limpeza automática a cada 5 minutos ──────────────────────
setInterval(() => {
  const agora = Date.now()
  for (const [telefone, sessao] of sessoes) {
    if (agora - sessao.ultima_atividade > TIMEOUT_MS) {
      sessoes.delete(telefone)
    }
  }
}, 5 * 60 * 1000)

// ── API Pública ──────────────────────────────────────────────

/**
 * Retorna sessão existente ou cria uma nova.
 */
function getOuCriar(telefone) {
  if (!sessoes.has(telefone)) {
    sessoes.set(telefone, {
      telefone,
      historico:        [],    // array de { role, content }
      ultima_atividade: Date.now(),
      nome_usuario:     null,  // preenchido quando o usuário se identificar
    })
  }
  return sessoes.get(telefone)
}

/**
 * Adiciona uma mensagem ao histórico e atualiza timestamp.
 */
function addMensagem(telefone, role, content) {
  const sessao = getOuCriar(telefone)
  sessao.historico.push({ role, content })
  sessao.ultima_atividade = Date.now()

  // Mantém apenas as últimas MAX_HISTORICO mensagens
  if (sessao.historico.length > MAX_HISTORICO) {
    sessao.historico = sessao.historico.slice(-MAX_HISTORICO)
  }

  return sessao
}

/**
 * Reseta o histórico de uma sessão (novo assunto).
 */
function resetar(telefone) {
  const sessao = sessoes.get(telefone)
  if (sessao) {
    sessao.historico        = []
    sessao.ultima_atividade = Date.now()
  }
}

/**
 * Total de sessões ativas (para monitoramento).
 */
function totalAtivas() {
  return sessoes.size
}

module.exports = { getOuCriar, addMensagem, resetar, totalAtivas }
