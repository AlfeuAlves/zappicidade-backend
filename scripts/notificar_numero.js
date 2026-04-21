require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') })
if (!process.env.ZAPI_CLIENT_TOKEN) process.env.ZAPI_CLIENT_TOKEN = '8525D783CCB95566A41BF1C3'

const { sendText } = require('../src/bot/zapi')

;(async () => {
  const numero = '5591985976958'

  await sendText(
    numero,
    `Olá! ❌ Sua conta no *ZappiCidade* foi *cancelada*.\n\nSe acredita que isso foi um engano, entre em contato com o suporte.`
  )

  console.log('Mensagem enviada com sucesso!')
  process.exit(0)
})()
