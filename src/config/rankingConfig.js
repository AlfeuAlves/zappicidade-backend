// Configuração de ranking do bot — persiste no Supabase Storage
// Compartilhado entre admin.js (salvar/ler) e tools.js (aplicar)

const { supabaseAdmin } = require('./supabase')

const BUCKET = 'admin-data'
const FILE   = 'ranking_config.json'

const DEFAULT = {
  plano_pago:         true,
  aberto_agora:       true,
  proximidade_bairro: true,
  tem_whatsapp:       true,
  verificado:         true,
  avaliacoes:         true,
}

let _cache = null

async function lerConfig() {
  try {
    const { data, error } = await supabaseAdmin.storage.from(BUCKET).download(FILE)
    if (error || !data) { _cache = { ...DEFAULT }; return _cache }
    const text = typeof data.text === 'function'
      ? await data.text()
      : Buffer.from(await data.arrayBuffer()).toString('utf8')
    _cache = { ...DEFAULT, ...JSON.parse(text) }
  } catch {
    _cache = { ...DEFAULT }
  }
  return _cache
}

async function salvarConfig(config) {
  _cache = { ...DEFAULT, ...config }
  const buf = Buffer.from(JSON.stringify(_cache, null, 2), 'utf8')
  await supabaseAdmin.storage.from(BUCKET).upload(FILE, buf, {
    contentType: 'application/json', upsert: true,
  })
  return _cache
}

function getConfig() {
  return _cache || { ...DEFAULT }
}

// Carrega ao iniciar o processo
lerConfig().catch(() => {})

module.exports = { lerConfig, salvarConfig, getConfig }
