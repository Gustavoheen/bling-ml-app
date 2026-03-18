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

export async function getProdutos(token, pagina = 1) {
  return blingFetch(`/produtos?limit=100&pagina=${pagina}&situacao=A`, token)
}

export async function getTodosProdutos(token, onProgress) {
  let pagina = 1
  let todos = []
  while (true) {
    const data = await getProdutos(token, pagina)
    const itens = data?.data || []
    todos = [...todos, ...itens]
    if (onProgress) onProgress(todos.length)
    if (itens.length < 100) break
    pagina++
    await new Promise(r => setTimeout(r, 300)) // rate limit
  }
  return todos
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
