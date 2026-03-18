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

// Normaliza o produto do Bling v3 para estrutura flat usada no app
export function normalizarProduto(raw) {
  const d = raw?.data || raw
  if (!d) return raw

  // Imagens: midia.imagens[].link
  const imagensRaw = d.midia?.imagens
  const imagens = Array.isArray(imagensRaw) ? imagensRaw.map(i => i.link || i.url).filter(Boolean) : []
  const imagemURL = imagens[0] || d.imagemURL || null

  // Dimensões
  const dimensoes = d.dimensoes || {}
  const largura      = dimensoes.largura      || d.largura      || null
  const altura       = dimensoes.altura       || d.altura       || null
  const profundidade = dimensoes.profundidade || d.profundidade || null

  // Peso (pode ser pesoLiquido ou peso)
  const peso = d.pesoLiquido || d.pesoBruto || d.peso || null

  return {
    ...d,
    imagemURL,
    imagens,
    largura,
    altura,
    profundidade,
    peso,
    // Garante campos de texto acessíveis no nível raiz
    descricaoCurta:        d.descricaoCurta        || '',
    descricaoComplementar: d.descricaoComplementar || '',
    gtin:                  d.gtin                  || '',
    codigo:                d.codigo                || '',
    nome:                  d.nome                  || '',
    preco:                 d.preco                 || 0,
    precoCusto:            d.precoCusto            || 0,
    variacoes:             d.variacoes             || [],
    categoria:             d.categoria             || null,
    estoque:               d.estoque               || { saldoVirtualTotal: 0 },
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
