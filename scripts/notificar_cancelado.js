// Script one-time: envia mensagem de cancelamento ao último comerciante desativado
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') })

const { supabaseAdmin } = require('../src/config/supabase')
const { sendText }      = require('../src/bot/zapi')

;(async () => {
  const { data, error } = await supabaseAdmin
    .from('comerciantes')
    .select('id, nome_completo, whatsapp, ativo')
    .eq('ativo', false)
    .order('criado_em', { ascending: false })
    .limit(1)

  if (error) {
    console.error('Erro ao buscar:', error.message)
    process.exit(1)
  }

  if (!data || data.length === 0) {
    console.error('Nenhum comerciante cancelado encontrado.')
    process.exit(1)
  }

  const comerciante = data[0]

  console.log(`Enviando para: ${comerciante.nome_completo} (${comerciante.whatsapp})`)

  if (!comerciante.whatsapp) {
    console.error('Comerciante não tem WhatsApp cadastrado.')
    process.exit(1)
  }

  await sendText(
    comerciante.whatsapp,
    `Olá, ${comerciante.nome_completo || 'comerciante'}! ❌ Sua conta no *ZappiCidade* foi *cancelada*.\n\nSe acredita que isso foi um engano, entre em contato com o suporte.`
  )

  console.log('Mensagem enviada com sucesso!')
  process.exit(0)
})()
