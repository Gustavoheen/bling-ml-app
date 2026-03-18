const CLIENT_ID = import.meta.env.VITE_ML_CLIENT_ID
const REDIRECT_URI = import.meta.env.VITE_ML_REDIRECT_URI

export function getAuthUrl() {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
  })
  return `https://auth.mercadolibre.com.br/authorization?${params.toString()}`
}

// Token exchange via proxy (evita CORS e mantém secret no servidor)
async function mlOAuth(body) {
  const res = await fetch('/api/ml-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.message || err?.error || `ML token error: ${res.status}`)
  }
  const data = await res.json()
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in * 1000),
    userId: data.user_id,
  }
}

export async function trocarCodigoPorToken(code) {
  return mlOAuth({ grant_type: 'authorization_code', code })
}

export async function refreshToken(refreshTk) {
  return mlOAuth({ grant_type: 'refresh_token', refresh_token: refreshTk })
}

// Todas as chamadas ML passam pelo proxy (resolve CORS)
async function mlFetch(endpoint, token, options = {}) {
  const method = options.method || 'GET'
  const res = await fetch('/api/ml-proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      endpoint,
      method,
      body: options.body ? JSON.parse(options.body) : undefined,
      accessToken: token || undefined,
    }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.message || data?.error || `Erro ${res.status}`)
  return data
}

export async function getMe(token) {
  return mlFetch('/users/me', token)
}

// Buscar categorias por texto (público, sem auth)
export async function buscarCategorias(query, siteId = 'MLB') {
  return mlFetch(`/sites/${siteId}/domain_discovery/search?q=${encodeURIComponent(query)}&limit=8`, null)
}

// Buscar atributos obrigatórios de uma categoria (público)
export async function getAtributosCategoria(categoryId) {
  const data = await mlFetch(`/categories/${categoryId}/attributes`, null)
  return Array.isArray(data) ? data.filter(a => a.tags?.required) : []
}

// Buscar detalhes de categoria (público)
export async function getCategoria(categoryId) {
  return mlFetch(`/categories/${categoryId}`, null)
}

// Publicar produto
export async function publicarProduto(token, payload) {
  return mlFetch('/items', token, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

// Atualizar produto
export async function atualizarProduto(token, itemId, payload) {
  return mlFetch(`/items/${itemId}`, token, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

// Buscar produto do ML por ID
export async function getProduto(token, itemId) {
  return mlFetch(`/items/${itemId}`, token)
}

// Converter produto Bling para payload ML
// config: { listingType, condition, catalogListing }
export function blingParaMLPayload(produto, categoryId, atributos = [], config = {}) {
  const {
    listingType = 'gold_special',
    condition = 'new',
    catalogListing = false,
  } = config

  // Coleta imagens: imagemURL ou array imagens (suporta string e objeto {link, url})
  const fotosSet = new Set()
  const fotos = []
  const addFoto = url => { if (url && !fotosSet.has(url)) { fotosSet.add(url); fotos.push({ source: url }) } }
  if (produto.imagemURL) addFoto(produto.imagemURL)
  if (Array.isArray(produto.imagens)) {
    produto.imagens.forEach(img => {
      addFoto(img?.link || img?.url || img?.linkMiniatura || (typeof img === 'string' ? img : null))
    })
  }

  const payload = {
    title: produto.nome,
    category_id: categoryId,
    price: Number(produto.preco),
    currency_id: 'BRL',
    available_quantity: Number(produto.estoque?.saldoVirtualTotal || 0),
    buying_mode: 'buy_it_now',
    listing_type_id: listingType,
    condition,
    description: { plain_text: produto.descricaoCurta || produto.descricaoComplementar || produto.nome },
    pictures: fotos,
    attributes: atributos
      .map(a => ({ id: a.id, value_name: a.valor || '' }))
      .filter(a => a.value_name),
  }

  if (!catalogListing) {
    payload.catalog_listing = false
  }

  return payload
}
