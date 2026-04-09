// ============================================================
// Z-API — Cliente para envio de mensagens WhatsApp
// ============================================================
// Documentação: https://developer.z-api.io/
// Variáveis necessárias no .env:
//   ZAPI_INSTANCE_ID  — ID da instância Z-API
//   ZAPI_TOKEN        — Token da instância
//   ZAPI_CLIENT_TOKEN — Client-Token (segurança extra, opcional)
// ============================================================

const ZAPI_BASE = 'https://api.z-api.io/instances'

function getHeaders() {
  const headers = { 'Content-Type': 'application/json' }
  if (process.env.ZAPI_CLIENT_TOKEN) {
    headers['Client-Token'] = process.env.ZAPI_CLIENT_TOKEN
  }
  return headers
}

function getUrl(endpoint) {
  const id    = process.env.ZAPI_INSTANCE_ID
  const token = process.env.ZAPI_TOKEN

  if (!id || !token) {
    throw new Error('ZAPI_INSTANCE_ID e ZAPI_TOKEN não configurados no .env')
  }

  return `${ZAPI_BASE}/${id}/token/${token}/${endpoint}`
}

// ── Enviar mensagem de texto ──────────────────────────────────

async function sendText(telefone, mensagem) {
  // Normaliza o número: remove não-dígitos, garante prefixo 55
  const numero = telefone.replace(/\D/g, '').replace(/^(?!55)/, '55')

  const url  = getUrl('send-text')
  const body = JSON.stringify({ phone: numero, message: mensagem })

  const res = await fetch(url, {
    method:  'POST',
    headers: getHeaders(),
    body
  })

  if (!res.ok) {
    const erro = await res.text()
    throw new Error(`Z-API sendText falhou [${res.status}]: ${erro}`)
  }

  return await res.json()
}

// ── Status da conexão WhatsApp ────────────────────────────────

async function getStatus() {
  const url = getUrl('status')
  const res = await fetch(url, { headers: getHeaders() })
  if (!res.ok) throw new Error(`Z-API status falhou [${res.status}]`)
  return await res.json()
}

module.exports = { sendText, getStatus }
