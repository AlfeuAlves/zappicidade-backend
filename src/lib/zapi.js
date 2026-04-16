// ============================================================
// Z-API — helper de envio WhatsApp
// ============================================================
const INSTANCE_ID   = process.env.ZAPI_INSTANCE_ID
const TOKEN         = process.env.ZAPI_TOKEN
const CLIENT_TOKEN  = process.env.ZAPI_CLIENT_TOKEN

const BASE = `https://api.z-api.io/instances/${INSTANCE_ID}/token/${TOKEN}`

function headers() {
  const h = { 'Content-Type': 'application/json' }
  if (CLIENT_TOKEN) h['Client-Token'] = CLIENT_TOKEN
  return h
}

/**
 * Envia mensagem de texto simples.
 * @param {string} phone  Número com DDI (ex: "5591983594825")
 * @param {string} message Texto da mensagem
 */
async function sendText(phone, message) {
  const res = await fetch(`${BASE}/send-text`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ phone, message }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`Z-API sendText erro ${res.status}: ${JSON.stringify(data)}`)
  return data
}

/**
 * Envia imagem com legenda opcional.
 * @param {string} phone
 * @param {string} imageUrl  URL pública OU base64 com prefixo "data:image/..."
 * @param {string} caption   Legenda (opcional)
 */
async function sendImage(phone, imageUrl, caption = '') {
  // Z-API aceita base64 direto no campo "image"
  const isBase64 = imageUrl.startsWith('data:')
  const body = isBase64
    ? { phone, image: imageUrl, caption }
    : { phone, image: imageUrl, caption }

  const res = await fetch(`${BASE}/send-image`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`Z-API sendImage erro ${res.status}: ${JSON.stringify(data)}`)
  return data
}

module.exports = { sendText, sendImage }
