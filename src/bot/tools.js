// ============================================================
// TOOLS — Function calling do bot ZappiCidade
// ============================================================
// Define as funções que o Claude pode chamar para buscar
// dados reais do banco de dados.
// ============================================================

const { supabase } = require('../config/supabase')

// ── Definições (enviadas ao Claude) ─────────────────────────

const TOOLS = [
  {
    name: 'buscar_comercios',
    description:
      'Busca comércios em Barcarena por nome, categoria ou bairro. ' +
      'Use quando o usuário perguntar sobre lojas, serviços, restaurantes, ' +
      'farmácias, mercados ou qualquer negócio na cidade.',
    input_schema: {
      type: 'object',
      properties: {
        busca: {
          type: 'string',
          description: 'Texto livre para buscar no nome do comércio (ex: "farmácia", "pizza")'
        },
        categoria: {
          type: 'string',
          description: 'Slug da categoria. Categorias disponíveis: "acai" (pontos de açaí), "restaurantes", "farmacias", "supermercados", "padarias", "saloes-de-beleza", "barbearias", "clinicas", "dentistas", "academias", "pet-shops", "veterinarios", "mecanicas", "lava-rapidos", "lojas-de-roupa", "cafes", "bares", "escolas", "bancos", "floriculturas", "lavanderias", "hoteis", "autopecas", "acougues", "estetica", "medicina-trabalho", "calcados", "costura", "eletricistas", "cosmeticos", "consultoria", "contabilidade"'
        },
        bairro: {
          type: 'string',
          description: 'Nome do bairro (ex: "Centro", "Murucupi", "Vila dos Cabanos")'
        },
        limit: {
          type: 'integer',
          description: 'Máximo de resultados (padrão: 5, máximo: 10)',
          default: 5
        }
      }
    }
  },
  {
    name: 'get_detalhes_comercio',
    description:
      'Busca informações detalhadas de um comércio específico: endereço, ' +
      'telefone, horários de funcionamento, promoções ativas e link do WhatsApp.',
    input_schema: {
      type: 'object',
      properties: {
        slug: {
          type: 'string',
          description: 'Slug único do comércio (ex: "farmacia-popular2-barcarena")'
        }
      },
      required: ['slug']
    }
  },
  {
    name: 'buscar_promocoes',
    description:
      'Lista promoções e ofertas ativas em Barcarena. ' +
      'Use quando o usuário perguntar sobre ofertas, descontos ou promoções.',
    input_schema: {
      type: 'object',
      properties: {
        categoria: {
          type: 'string',
          description: 'Filtrar por categoria (opcional)'
        },
        limit: {
          type: 'integer',
          description: 'Máximo de resultados (padrão: 5)',
          default: 5
        }
      }
    }
  },
  {
    name: 'registrar_optin',
    description:
      'Registra que o usuário aceitou receber notificações de promoções ' +
      'pelo WhatsApp. Use somente após o usuário confirmar explicitamente.',
    input_schema: {
      type: 'object',
      properties: {
        telefone: {
          type: 'string',
          description: 'Número do WhatsApp do usuário (já disponível na sessão)'
        },
        nome: {
          type: 'string',
          description: 'Nome do usuário (se informado)'
        }
      },
      required: ['telefone']
    }
  }
]

// ── Implementações (executadas pelo backend) ─────────────────

// Remove acentos para busca tolerante (açaí → acai)
function semAcento(str) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

async function buscar_comercios({ busca, categoria, bairro, limit = 5 }) {
  limit = Math.min(limit, 10)

  let query = supabase
    .from('vw_comercios_publicos')
    .select('nome, slug, categoria_nome, bairro, telefone, whatsapp, aberto_agora, avaliacao')
    .eq('status_operacional', 'ativo')
    .order('destaque', { ascending: false })
    .order('avaliacao', { ascending: false })
    .limit(limit)

  if (busca) {
    // Busca com acento E sem acento para cobrir os dois casos
    const comAcento    = `%${busca}%`
    const semAcentoBusca = `%${semAcento(busca)}%`
    query = busca === semAcento(busca)
      ? query.ilike('nome', comAcento)
      : query.or(`nome.ilike.${comAcento},nome.ilike.${semAcentoBusca}`)
  }
  if (categoria) query = query.eq('categoria_slug', categoria)
  if (bairro)    query = query.ilike('bairro', `%${bairro}%`)

  const { data, error } = await query

  if (error) return { erro: error.message }
  if (!data || data.length === 0) return { resultado: 'nenhum_comercio_encontrado' }

  return {
    total: data.length,
    comercios: data.map(c => ({
      nome:       c.nome,
      slug:       c.slug,
      categoria:  c.categoria_nome,
      bairro:     c.bairro || 'não informado',
      telefone:   c.telefone || null,
      whatsapp:   c.whatsapp || null,
      aberto:     c.aberto_agora,
      avaliacao:  c.avaliacao,
      link_perfil: `https://zappicidade-site.vercel.app/c/${c.slug}`
    }))
  }
}

async function get_detalhes_comercio({ slug }) {
  const { data, error } = await supabase
    .from('vw_comercios_publicos')
    .select('*')
    .eq('slug', slug)
    .single()

  if (error || !data) return { erro: 'comercio_nao_encontrado' }

  // Busca promoções ativas
  const { data: promocoes } = await supabase
    .from('promocoes')
    .select('titulo, descricao, tipo, preco_de, preco_por, percentual_desconto, fim')
    .eq('comercio_id', data.id)
    .eq('status', 'ativa')
    .or('fim.is.null,fim.gt.' + new Date().toISOString())
    .limit(3)

  // Formata horários para texto
  const horarios = data.horarios
    ? Object.entries(data.horarios)
        .map(([dia, h]) => h ? `${dia}: ${h.aberto}–${h.fechado}` : `${dia}: fechado`)
        .join(', ')
    : 'não informado'

  return {
    nome:        data.nome,
    categoria:   data.categoria_nome,
    descricao:   data.descricao || null,
    endereco:    data.endereco  || 'não informado',
    bairro:      data.bairro    || 'não informado',
    telefone:    data.telefone  || null,
    whatsapp:    data.whatsapp  || null,
    horarios,
    aberto_agora: data.aberto_agora,
    avaliacao:   data.avaliacao,
    link_perfil: `https://zappicidade-site.vercel.app/c/${data.slug}`,
    link_whatsapp: data.whatsapp
      ? `https://wa.me/55${data.whatsapp.replace(/\D/g, '')}?text=Olá, vi vocês no ZappiCidade!`
      : null,
    promocoes: promocoes || []
  }
}

async function buscar_promocoes({ categoria, limit = 5 }) {
  limit = Math.min(limit, 10)

  let query = supabase
    .from('promocoes')
    .select(`
      titulo, descricao, tipo, preco_de, preco_por, percentual_desconto, fim,
      comercios!inner(nome, slug, bairro)
    `)
    .eq('status', 'ativa')
    .or('fim.is.null,fim.gt.' + new Date().toISOString())
    .order('criado_em', { ascending: false })
    .limit(limit)

  if (categoria) {
    query = query.eq('comercios.categoria_slug', categoria)
  }

  const { data, error } = await query

  if (error) return { erro: error.message }
  if (!data || data.length === 0) return { resultado: 'nenhuma_promocao_ativa' }

  return {
    total: data.length,
    promocoes: data.map(p => ({
      titulo:    p.titulo,
      descricao: p.descricao,
      comercio:  p.comercios?.nome,
      bairro:    p.comercios?.bairro || 'não informado',
      desconto:  p.percentual_desconto ? `${p.percentual_desconto}% off` : null,
      preco_de:  p.preco_de,
      preco_por: p.preco_por,
      validade:  p.fim ? new Date(p.fim).toLocaleDateString('pt-BR') : 'sem prazo',
      link:      p.comercios?.slug ? `https://zappicidade-site.vercel.app/c/${p.comercios.slug}` : null
    }))
  }
}

async function registrar_optin({ telefone, nome }) {
  const { error } = await supabase
    .from('leads')
    .upsert(
      {
        telefone: telefone.replace(/\D/g, ''),
        nome:     nome || null,
        origem:   'whatsapp_bot',
        optin_notificacoes: true,
        atualizado_em: new Date().toISOString()
      },
      { onConflict: 'telefone' }
    )

  if (error) return { sucesso: false, erro: error.message }
  return { sucesso: true }
}

// ── Dispatcher ───────────────────────────────────────────────

async function executarTool(nome, input) {
  const implementacoes = {
    buscar_comercios,
    get_detalhes_comercio,
    buscar_promocoes,
    registrar_optin
  }

  const fn = implementacoes[nome]
  if (!fn) return { erro: `tool_desconhecida: ${nome}` }

  try {
    return await fn(input)
  } catch (err) {
    return { erro: err.message }
  }
}

module.exports = { TOOLS, executarTool }
