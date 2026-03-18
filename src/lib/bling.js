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

export async function trocarCodigoPorToken(code) {
  const credentials = btoa(`${CLIENT_ID}:${CLIENT_SECRET}`)
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
    }),
  })
  if (!res.ok) throw new Error(`Bling token error: ${res.status}`)
  const data = await res.json()
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in * 1000),
  }
}

export async function refreshToken(refreshTk) {
  const credentials = btoa(`${CLIENT_ID}:${CLIENT_SECRET}`)
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshTk,
    }),
  })
  if (!res.ok) throw new Error(`Bling refresh error: ${res.status}`)
  const data = await res.json()
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in * 1000),
  }
}

async function blingFetch(endpoint, token, options = {}) {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error?.description || `Erro ${res.status}`)
  }
  return res.json()
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
