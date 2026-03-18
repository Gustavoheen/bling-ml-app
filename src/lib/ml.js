const CLIENT_ID = import.meta.env.VITE_ML_CLIENT_ID
const CLIENT_SECRET = import.meta.env.VITE_ML_CLIENT_SECRET
const REDIRECT_URI = import.meta.env.VITE_ML_REDIRECT_URI
const BASE_URL = 'https://api.mercadolibre.com'

export function getAuthUrl() {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
  })
  return `https://auth.mercadolibre.com.br/authorization?${params.toString()}`
}

export async function trocarCodigoPorToken(code) {
  const res = await fetch(`${BASE_URL}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      redirect_uri: REDIRECT_URI,
    }),
  })
  if (!res.ok) throw new Error(`ML token error: ${res.status}`)
  const data = await res.json()
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in * 1000),
    userId: data.user_id,
  }
}

export async function refreshToken(refreshTk) {
  const res = await fetch(`${BASE_URL}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refreshTk,
    }),
  })
  if (!res.ok) throw new Error(`ML refresh error: ${res.status}`)
  const data = await res.json()
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in * 1000),
  }
}

async function mlFetch(endpoint, token, options = {}) {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  if (res.status === 429) throw new Error('Rate limit ML — aguarde alguns segundos')
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.message || `Erro ${res.status}`)
  }
  return res.json()
}

export async function getMe(token) {
  return mlFetch('/users/me', token)
}

// Buscar categorias por texto
export async function buscarCategorias(query, siteId = 'MLB') {
  const res = await fetch(`${BASE_URL}/sites/${siteId}/domain_discovery/search?q=${encodeURIComponent(query)}&limit=5`)
  if (!res.ok) return []
  return res.json()
}

// Buscar atributos obrigatórios de uma categoria
export async function getAtributosCategoria(categoryId) {
  const res = await fetch(`${BASE_URL}/categories/${categoryId}/attributes`)
  if (!res.ok) return []
  const data = await res.json()
  return data.filter(a => a.tags?.required)
}

// Buscar detalhes de categoria
export async function getCategoria(categoryId) {
  const res = await fetch(`${BASE_URL}/categories/${categoryId}`)
  if (!res.ok) return null
  return res.json()
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

  // Coleta imagens: campo imagemURL ou array imagens
  const fotos = []
  if (produto.imagemURL) fotos.push({ source: produto.imagemURL })
  if (Array.isArray(produto.imagens)) {
    produto.imagens.forEach(img => {
      const url = img?.link || img?.url || img
      if (url && !fotos.find(f => f.source === url)) fotos.push({ source: url })
    })
  }

  const payload = {
    title: produto.nome,
    category_id: categoryId,
    price: Number(produto.preco),
    currency_id: 'BRL',
    available_quantity: produto.estoque?.saldoVirtualTotal || 0,
    buying_mode: 'buy_it_now',
    listing_type_id: listingType,
    condition,
    description: { plain_text: produto.descricaoCurta || produto.nome },
    pictures: fotos,
    attributes: atributos.map(a => ({
      id: a.id,
      value_name: a.valor || '',
    })).filter(a => a.value_name),
  }

  // Não subir como catálogo
  if (!catalogListing) {
    payload.catalog_listing = false
  }

  return payload
}
