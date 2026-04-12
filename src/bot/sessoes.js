// ============================================================
// SESSÕES — Contexto de conversa por telefone
// ============================================================
// Armazena histórico de mensagens em memória por sessão.
// Cada sessão expira após TIMEOUT_MS de inatividade.
// Em produção, substituir por Redis para escalabilidade.
// ============================================================

const TIMEOUT_MS     = 30 * 60 * 1000  // 30 minutos
const MAX_HISTORICO  = 12              // máximo de mensagens por sessão (~3 trocas completas)

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
      localizacao:      null,  // { lat, lng, bairro, origem } — definido quando usuário compartilha
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

  // Mantém apenas as últimas MAX_HISTORICO mensagens,
  // garantindo que nunca fique um tool_use sem seu tool_result
  if (sessao.historico.length > MAX_HISTORICO) {
    let cortado = sessao.historico.slice(-MAX_HISTORICO)
    // Se a primeira mensagem do histórico cortado é um tool_result (role=user com array),
    // remove ela também pois ficou sem o tool_use correspondente
    while (
      cortado.length > 0 &&
      cortado[0].role === 'user' &&
      Array.isArray(cortado[0].content) &&
      cortado[0].content.some(b => b.type === 'tool_result')
    ) {
      cortado = cortado.slice(1)
    }
    sessao.historico = cortado
  }

  return sessao
}

/**
 * Salva a localização do usuário na sessão.
 * origem: 'gps' | 'bairro' (informado manualmente)
 */
function salvarLocalizacao(telefone, localizacao) {
  const sessao = getOuCriar(telefone)
  sessao.localizacao      = localizacao
  sessao.ultima_atividade = Date.now()
}

/**
 * Retorna a localização salva na sessão (ou null).
 */
function getLocalizacao(telefone) {
  return sessoes.get(telefone)?.localizacao || null
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

module.exports = { getOuCriar, addMensagem, resetar, totalAtivas, salvarLocalizacao, getLocalizacao }
