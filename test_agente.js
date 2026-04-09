// ============================================================
// TESTE DO AGENTE — Roda no terminal sem Z-API
// ============================================================
// Uso: node test_agente.js
// Requer: ANTHROPIC_API_KEY real no .env
// ============================================================

require('dotenv').config({ override: true })

const readline = require('readline')
const agente   = require('./src/bot/agente')
const sessoes  = require('./src/bot/sessoes')

const TELEFONE_TESTE = '5591999999999'

// ── Cores no terminal ────────────────────────────────────────
const c = {
  reset:  '\x1b[0m',
  verde:  '\x1b[32m',
  azul:   '\x1b[34m',
  cinza:  '\x1b[90m',
  amarelo:'\x1b[33m',
  negrito:'\x1b[1m',
}

function log(quem, texto) {
  if (quem === 'você') {
    console.log(`\n${c.azul}${c.negrito}Você:${c.reset} ${texto}`)
  } else {
    console.log(`\n${c.verde}${c.negrito}Zappi:${c.reset} ${texto}`)
  }
}

async function testarMensagens(mensagens) {
  console.log(`\n${c.amarelo}${'─'.repeat(60)}${c.reset}`)
  console.log(`${c.amarelo}🤖 Teste automático com ${mensagens.length} mensagens${c.reset}`)
  console.log(`${c.amarelo}${'─'.repeat(60)}${c.reset}`)

  for (const msg of mensagens) {
    log('você', msg)
    try {
      const resposta = await agente.processar(TELEFONE_TESTE, msg)
      log('Zappi', resposta)
      await new Promise(r => setTimeout(r, 500)) // pequena pausa entre msgs
    } catch (err) {
      console.error(`\n${c.cinza}[ERRO] ${err.message}${c.reset}`)
      if (err.message.includes('API key')) {
        console.error(`\n❌ Chave inválida. Edite o .env e coloque sua ANTHROPIC_API_KEY real.`)
        console.error(`   Obtenha em: https://console.anthropic.com/\n`)
        process.exit(1)
      }
    }
  }
}

async function modoInterativo() {
  const rl = readline.createInterface({
    input:  process.stdin,
    output: process.stdout,
  })

  console.log(`\n${c.verde}${'═'.repeat(60)}${c.reset}`)
  console.log(`${c.verde}  ZappiCidade — Teste do Agente IA (modo interativo)${c.reset}`)
  console.log(`${c.verde}${'═'.repeat(60)}${c.reset}`)
  console.log(`${c.cinza}  Telefone simulado: ${TELEFONE_TESTE}${c.reset}`)
  console.log(`${c.cinza}  Digite "sair" para encerrar${c.reset}`)
  console.log(`${c.cinza}  Digite "reset" para limpar histórico${c.reset}`)
  console.log(`${c.cinza}  Digite "historico" para ver o contexto atual${c.reset}`)
  console.log(`${c.verde}${'═'.repeat(60)}${c.reset}\n`)

  const pergunta = () => {
    rl.question(`${c.azul}Você: ${c.reset}`, async (input) => {
      const texto = input.trim()

      if (!texto) return pergunta()

      if (texto.toLowerCase() === 'sair') {
        console.log(`\n${c.cinza}Encerrando... tchau! 👋${c.reset}\n`)
        rl.close()
        process.exit(0)
      }

      if (texto.toLowerCase() === 'reset') {
        sessoes.resetar(TELEFONE_TESTE)
        console.log(`${c.cinza}[histórico limpo]${c.reset}`)
        return pergunta()
      }

      if (texto.toLowerCase() === 'historico') {
        const s = sessoes.getOuCriar(TELEFONE_TESTE)
        console.log(`${c.cinza}[${s.historico.length} mensagens no histórico]${c.reset}`)
        s.historico.forEach((m, i) => {
          const role = m.role === 'user' ? 'você' : 'Zappi'
          const content = Array.isArray(m.content)
            ? m.content.map(b => b.type === 'text' ? b.text : `[${b.type}]`).join(' ')
            : m.content
          console.log(`${c.cinza}  ${i + 1}. ${role}: ${String(content).slice(0, 80)}...${c.reset}`)
        })
        return pergunta()
      }

      process.stdout.write(`${c.cinza}[pensando...]${c.reset}`)

      try {
        const inicio = Date.now()
        const resposta = await agente.processar(TELEFONE_TESTE, texto)
        const tempo = Date.now() - inicio

        // Apaga o "[pensando...]"
        process.stdout.write('\r' + ' '.repeat(15) + '\r')

        log('Zappi', resposta)
        console.log(`${c.cinza}  [${tempo}ms]${c.reset}`)

      } catch (err) {
        process.stdout.write('\r' + ' '.repeat(15) + '\r')
        console.error(`\n${c.cinza}[ERRO] ${err.message}${c.reset}`)

        if (err.message.includes('API key') || err.status === 401) {
          console.error(`\n❌ Chave inválida. Edite o .env e coloque sua ANTHROPIC_API_KEY real.`)
          console.error(`   Obtenha em: https://console.anthropic.com/\n`)
          rl.close()
          process.exit(1)
        }
      }

      pergunta()
    })
  }

  pergunta()
}

// ── Entry point ──────────────────────────────────────────────

async function main() {
  // Verifica chave antes de começar
  if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY.includes('COLOQUE')) {
    console.error(`\n❌ ANTHROPIC_API_KEY não configurada.`)
    console.error(`   Edite: D:/Whatsapp Cidade/backend/.env`)
    console.error(`   Chave em: https://console.anthropic.com/\n`)
    process.exit(1)
  }

  const args = process.argv.slice(2)

  // Modo automático: node test_agente.js auto
  if (args[0] === 'auto') {
    await testarMensagens([
      'Oi',
      'Tem farmácia aberta agora em Barcarena?',
      'E no Centro?',
      'Qual o endereço da primeira que você me mostrou?',
      'Tem promoção em algum restaurante?',
    ])
    console.log(`\n${c.amarelo}✅ Teste automático concluído!${c.reset}\n`)
    process.exit(0)
  }

  // Modo interativo (padrão)
  await modoInterativo()
}

main().catch(err => {
  console.error('Erro fatal:', err.message)
  process.exit(1)
})
