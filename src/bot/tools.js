// ============================================================
// TOOLS — Function calling do bot ZappiCidade
// ============================================================
// Define as funções que o Claude pode chamar para buscar
// dados reais do banco de dados.
// ============================================================

const { supabase } = require('../config/supabase')

// ── Haversine — distância em km entre dois pontos GPS ────────
function distanciaKm(lat1, lng1, lat2, lng2) {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ── Definições (enviadas ao Claude) ─────────────────────────

const TOOLS = [
  {
    name: 'buscar_comercios',
    description:
      'Busca comércios em Barcarena. ' +
      'REGRA: sempre que o usuário mencionar um TIPO de negócio (restaurante, farmácia, salão, etc.), ' +
      'use o parâmetro "categoria" — NUNCA use "busca" para tipo de negócio. ' +
      'Use "busca" SOMENTE quando o usuário mencionar o NOME ESPECÍFICO do comércio (ex: "Farmácia Popular"). ' +
      'Exemplos: "almoçar" → categoria:"restaurantes" | "cabeleireiro" → categoria:"saloes-de-beleza" | ' +
      '"Drogaria São Paulo" → busca:"Drogaria São Paulo".',
    input_schema: {
      type: 'object',
      properties: {
        busca: {
          type: 'string',
          description: 'Use SOMENTE para buscar pelo NOME do comércio (ex: "Açaí do João", "Farmácia Popular"). NUNCA use para tipos de negócio — use "categoria" para isso.'
        },
        categoria: {
          type: 'string',
          description: 'SEMPRE use quando o usuário pedir um TIPO de negócio. Mapeamento obrigatório: almoçar/comer/restaurante/marmita → "restaurantes" | açaí/acai → "acai" | farmácia/remédio/drogaria → "farmacias" | mercado/supermercado → "supermercados" | padaria/pão → "padarias" | salão/cabelo/cabeleireiro/escova → "saloes-de-beleza" | barbearia/barba → "barbearias" | dentista/dente → "dentistas" | clínica/médico → "clinicas" | academia/musculação → "academias" | mecânica/oficina/carro → "mecanicas" | pet/ração/petshop → "pet-shops" | lava jato/lavagem → "lava-rapidos" | roupa/moda/vestuário → "lojas-de-roupa" | café/cafeteria → "cafes" | bar/boteco/happy hour → "bares" | internet/fibra/banda larga/provedor → "internet" | gás/botijão/GLP/gás de cozinha → "gas" | açougue/carne/frango → "acougues" | estética/depilação/unhas → "estetica" | contabilidade/contador → "contabilidade" | advogado → "advocacia" | imobiliária/imóvel → "imobiliarias" | eletrônico/celular → "eletronicos" | ótica/óculos → "oticas" | móveis/decoração → "moveis" | fisioterapia → "fisioterapia" | psicólogo/terapia → "psicologia" | hotel/pousada → "hoteis" | eletricista → "eletricistas" | encanador → "encanadores" | pintor → "pintores"'
        },
        bairro: {
          type: 'string',
          description: 'Bairro mencionado pelo usuário (ex: "Centro", "Vila dos Cabanos"). Extraia da mensagem se mencionado. Se o usuário já compartilhou localização GPS, não precisa preencher este campo.'
        },
        aberto: {
          type: 'boolean',
          description: 'true quando usuário disser "aberto agora", "aberto hoje", "funcionando agora", "que esteja aberto".'
        },
        tem_whatsapp: {
          type: 'boolean',
          description: 'true quando usuário pedir "que tenha WhatsApp", "para contato via WhatsApp", "que eu possa chamar no zap".'
        },
        plano_pago: {
          type: 'boolean',
          description: 'true quando usuário pedir recomendações de qualidade, "melhores", "mais confiáveis", "parceiros do ZappiCidade". Comerciantes com plano pago têm perfil completo e verificado.'
        },
        limit: {
          type: 'integer',
          description: 'Máximo de resultados. Padrão: 5.',
          default: 5
        },
        offset: {
          type: 'integer',
          description: 'Para paginação: 0 = primeiros 5, 5 = próximos 5, 10 = próximos 10.',
          default: 0
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

async function buscar_comercios({ busca, categoria, bairro, aberto, tem_whatsapp, plano_pago, limit = 5, offset = 0 }, localizacao = null) {
  limit = Math.min(limit, 10)

  // Se tiver GPS e não tiver bairro, busca mais resultados para reordenar por proximidade
  const temGPS   = localizacao?.lat && localizacao?.lng
  const limitRPC = temGPS ? Math.min(limit * 4, 40) : limit
  const page     = Math.floor(offset / limitRPC) + 1

  const { data, error } = await supabase.rpc('buscar_comercios', {
    p_termo:        busca        || null,
    p_categoria:    categoria    || null,
    p_bairro:       bairro       || (localizacao?.bairro) || null,
    p_cidade:       null,
    p_aberto:       aberto       ?? null,
    p_tem_whatsapp: tem_whatsapp ?? null,
    p_plano_pago:   plano_pago   ?? null,
    p_page:         page,
    p_limit:        limitRPC
  })

  if (error) return { erro: error.message }
  if (!data || data.length === 0) return { resultado: 'nenhum_comercio_encontrado' }

  let resultados = data

  // ── Reordenar por proximidade se tiver GPS ───────────────
  if (temGPS) {
    resultados = data
      .map(c => ({
        ...c,
        distancia_km: (c.lat && c.lng)
          ? distanciaKm(localizacao.lat, localizacao.lng, parseFloat(c.lat), parseFloat(c.lng))
          : 999
      }))
      .sort((a, b) => {
        // 1º plano pago, 2º aberto agora, 3º distância, 4º avaliação
        if (b.plano_pago !== a.plano_pago) return (b.plano_pago ? 1 : 0) - (a.plano_pago ? 1 : 0)
        if (b.aberto_agora !== a.aberto_agora) return (b.aberto_agora ? 1 : 0) - (a.aberto_agora ? 1 : 0)
        return a.distancia_km - b.distancia_km
      })
      .slice(offset % limitRPC, (offset % limitRPC) + limit)
  }

  const total   = data[0]?.total_count ?? data.length
  const temMais = offset + limit < total

  return {
    total,
    exibindo: resultados.length,
    tem_mais: temMais,
    proximo_offset: temMais ? offset + limit : null,
    localizacao_usada: temGPS ? 'gps' : (localizacao?.bairro ? 'bairro' : null),
    comercios: resultados.slice(0, limit).map(c => ({
      nome:         c.nome,
      slug:         c.slug,
      categoria:    c.categoria_nome,
      bairro:       c.bairro || 'não informado',
      telefone:     c.telefone || null,
      whatsapp:     c.whatsapp || null,
      aberto:       c.aberto_agora,
      avaliacao:    c.avaliacao,
      distancia_km: c.distancia_km && c.distancia_km < 999
        ? parseFloat(c.distancia_km.toFixed(1))
        : null,
      link_perfil:  `https://www.zappicidadebarcarena.com.br/c/${c.slug}`
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

async function executarTool(nome, input, localizacao = null) {
  try {
    if (nome === 'buscar_comercios')   return await buscar_comercios(input, localizacao)
    if (nome === 'get_detalhes_comercio') return await get_detalhes_comercio(input)
    if (nome === 'buscar_promocoes')   return await buscar_promocoes(input)
    if (nome === 'registrar_optin')    return await registrar_optin(input)
    return { erro: `tool_desconhecida: ${nome}` }
  } catch (err) {
    return { erro: err.message }
  }
}

module.exports = { TOOLS, executarTool }
