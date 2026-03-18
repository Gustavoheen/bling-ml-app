const CLIENT_ID = import.meta.env.VITE_BLING_CLIENT_ID
const CLIENT_SECRET = import.meta.env.VITE_BLING_CLIENT_SECRET
const REDIRECT_URI = import.meta.env.VITE_BLING_REDIRECT_URI
const BASE_URL = 'https://www.bling.com.br/Api/v3'
const AUTH_URL = 'https://www.bling.com.br/Api/v3/oauth/authorize'
const TOKEN_URL = 'https://www.bling.com.br/Api/v3/oauth/token'

export function getAuthUrl() {
  const state = Math.random().toString(36).substring(2)
  sessionStorage.setItem('bling_oauth_state', state)
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    state,
  })
  return `${AUTH_URL}?${params.toString()}`
}

async function blingOAuth(body) {
  const res = await fetch('/api/bling-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error?.description || err?.message || `Bling token error: ${res.status}`)
  }
  const data = await res.json()
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in * 1000),
  }
}

export async function trocarCodigoPorToken(code) {
  return blingOAuth({ grant_type: 'authorization_code', code })
}

export async function refreshToken(refreshTk) {
  return blingOAuth({ grant_type: 'refresh_token', refresh_token: refreshTk })
}

async function blingFetch(endpoint, token, options = {}) {
  const method = options.method || 'GET'
  const res = await fetch('/api/bling-proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      endpoint,
      method,
      body: options.body ? JSON.parse(options.body) : undefined,
      accessToken: token,
    }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error?.description || data?.error || `Erro ${res.status}`)
  return data
}

// Extrai string de um campo que pode ser string ou objeto {id, nome}
function strCampo(val) {
  if (!val) return ''
  if (typeof val === 'string') return val
  if (typeof val === 'object') return val.nome || val.descricao || val.name || ''
  return String(val)
}

// Normaliza o produto do Bling v3 — extrai TODOS os campos importantes
export function normalizarProduto(raw) {
  const d = raw?.data || raw
  if (!d || typeof d !== 'object') return raw

  // ── Imagens: todas de midia.imagens[] ──────────────────────────
  const imagensRaw = d.midia?.imagens
  const imagens = Array.isArray(imagensRaw)
    ? imagensRaw.map(i => i.link || i.url || i.linkMiniatura).filter(Boolean)
    : (d.imagemURL ? [d.imagemURL] : [])
  const imagemURL = imagens[0] || null

  // ── Dimensões ──────────────────────────────────────────────────
  const dimensoes    = d.dimensoes    || {}
  const largura      = dimensoes.largura      != null ? dimensoes.largura      : (d.largura      ?? null)
  const altura       = dimensoes.altura       != null ? dimensoes.altura       : (d.altura       ?? null)
  const profundidade = dimensoes.profundidade != null ? dimensoes.profundidade : (d.profundidade ?? null)
  const unidadeMedida = dimensoes.unidadeMedida || 'cm'

  // ── Peso ───────────────────────────────────────────────────────
  const pesoLiquido = d.pesoLiquido != null ? d.pesoLiquido : (d.peso ?? null)
  const pesoBruto   = d.pesoBruto   ?? null

  // ── Marca: pode ser string ou objeto {id, nome} ────────────────
  const marca = strCampo(d.marca)

  // ── Fiscal / Tributação ────────────────────────────────────────
  const trib = d.tributacao || {}
  const tributacao = {
    ncm:                    trib.ncm                    || d.ncm                    || '',
    cest:                   trib.cest                   || d.cest                   || '',
    origemProduto:          String(trib.origemProduto   ?? d.origemProduto          ?? '0'),
    percentualIpi:          trib.percentualIpi          ?? d.percentualIpi          ?? 0,
    codigoEnquadramentoIpi: trib.codigoEnquadramentoIpi || d.codigoEnquadramentoIpi || '',
    codigoBeneficioFiscal:  trib.codigoBeneficioFiscal  || '',
    pisConfins:             strCampo(trib.pisConfins),
  }

  // ── Características ────────────────────────────────────────────
  const caracteristicas = Array.isArray(d.caracteristicas) ? d.caracteristicas : []

  // ── Fornecedores ───────────────────────────────────────────────
  const fornecedores = Array.isArray(d.fornecedores) ? d.fornecedores : []

  // ── Depósitos / Estoque por local ──────────────────────────────
  const depositos = Array.isArray(d.depositos) ? d.depositos : []

  // ── Variações ──────────────────────────────────────────────────
  const variacoes = Array.isArray(d.variacoes) ? d.variacoes : []

  return {
    ...d,
    // Básico
    id:                    d.id,
    nome:                  d.nome                  || '',
    codigo:                d.codigo                || '',
    preco:                 d.preco                 ?? 0,
    precoCusto:            d.precoCusto            ?? 0,
    situacao:              d.situacao              || 'A',
    tipo:                  d.tipo                  || 'P',
    unidade:               strCampo(d.unidade)     || '',
    marca,
    observacoes:           d.observacoes           || '',
    gtin:                  d.gtin                  || '',
    // Descrições
    descricaoCurta:        d.descricaoCurta        || '',
    descricaoComplementar: d.descricaoComplementar || '',
    // Imagens
    imagemURL,
    imagens,
    // Dimensões
    largura,
    altura,
    profundidade,
    unidadeMedida,
    // Peso
    peso: pesoLiquido,
    pesoLiquido,
    pesoBruto,
    // Categoria
    categoria:  d.categoria  || null,
    // Estoque
    estoque:    d.estoque    || { saldoVirtualTotal: 0 },
    // Fiscal
    tributacao,
    // Complexos
    caracteristicas,
    fornecedores,
    depositos,
    variacoes,
  }
}

export async function getProdutos(token, pagina = 1) {
  return blingFetch(`/produtos?limit=100&pagina=${pagina}&situacao=A`, token)
}

export async function getTodosProdutos(token, onProgress) {
  // 1ª passagem: lista de resumos
  let pagina = 1
  let resumos = []
  while (true) {
    const data = await getProdutos(token, pagina)
    const itens = data?.data || []
    resumos = [...resumos, ...itens]
    if (onProgress) onProgress(resumos.length, 'listando')
    if (itens.length < 100) break
    pagina++
    await new Promise(r => setTimeout(r, 300))
  }

  // 2ª passagem: detalhe completo em lotes de 5
  const completos = []
  for (let i = 0; i < resumos.length; i += 5) {
    const lote = resumos.slice(i, i + 5)
    const detalhes = await Promise.allSettled(
      lote.map(p => getProdutoDetalhe(token, p.id))
    )
    detalhes.forEach((r, idx) => {
      if (r.status === 'fulfilled') {
        completos.push(normalizarProduto(r.value))
      } else {
        completos.push(normalizarProduto(lote[idx]))
      }
    })
    if (onProgress) onProgress(completos.length, 'detalhando')
    await new Promise(r => setTimeout(r, 200))
  }
  return completos
}

export async function getProdutoDetalhe(token, id) {
  return blingFetch(`/produtos/${id}`, token)
}

export async function getCategorias(token) {
  return blingFetch('/categorias/produtos?limit=100', token)
}

export async function getContatos(token, pagina = 1) {
  return blingFetch(`/contatos?limit=100&pagina=${pagina}`, token)
}

export async function atualizarProduto(token, id, dados) {
  return blingFetch(`/produtos/${id}`, token, {
    method: 'PUT',
    body: JSON.stringify(dados),
  })
}

export async function criarProduto(token, dados) {
  return blingFetch('/produtos', token, {
    method: 'POST',
    body: JSON.stringify(dados),
  })
}

// Busca categoria Bling por nome, cria se não existir
export async function buscarOuCriarCategoria(token, nome) {
  try {
    const data = await blingFetch('/categorias/produtos?limit=100', token)
    const lista = data?.data || []
    const existente = lista.find(c => c.descricao?.toLowerCase() === nome.toLowerCase())
    if (existente) return existente.id
  } catch {}
  // Cria nova categoria
  const resp = await blingFetch('/categorias/produtos', token, {
    method: 'POST',
    body: JSON.stringify({ descricao: nome }),
  })
  return resp?.data?.id || null
}
