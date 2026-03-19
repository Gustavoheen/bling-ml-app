const CLIENT_ID = import.meta.env.VITE_ML_CLIENT_ID
const REDIRECT_URI = import.meta.env.VITE_ML_REDIRECT_URI

export function getAuthUrl() {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
  })
  return `https://auth.mercadolivre.com.br/authorization?${params.toString()}`
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
  if (!res.ok) {
    const cause = Array.isArray(data?.cause) && data.cause.length > 0
      ? ' | ' + data.cause.map(c => c.message || c.code).join(', ')
      : ''
    const err = new Error((data?.message || data?.error || `Erro ${res.status}`) + cause)
    err.mlData = data
    throw err
  }
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

// Fechar (excluir) anúncio do ML
export async function fecharItem(token, itemId) {
  return mlFetch(`/items/${itemId}`, token, {
    method: 'PUT',
    body: JSON.stringify({ status: 'closed' }),
  })
}

// Buscar todos os itens do vendedor no ML
export async function getMeusItens(token, userId, offset = 0) {
  return mlFetch(`/users/${userId}/items/search?limit=100&offset=${offset}`, token)
}

// Atualizar/criar descrição do anúncio (endpoint separado no ML)
export async function atualizarDescricao(token, itemId, texto) {
  return mlFetch(`/items/${itemId}/description`, token, {
    method: 'PUT',
    body: JSON.stringify({ plain_text: texto }),
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

// Auto-preenche atributos usando características do Bling + fallbacks
function autoAtributos(produto, atributos) {
  const lista = atributos.map(a => ({ ...a }))
  const tem = id => lista.some(a => a.id === id && a.valor?.trim())
  const add = (id, valor) => { if (!tem(id) && valor) lista.push({ id, valor }) }

  // Helper: busca valor em características do Bling por palavras-chave
  const carac = (palavras) => {
    const re = new RegExp(palavras, 'i')
    return produto.caracteristicas?.find(c => re.test(c.descricao))?.valor || null
  }

  // Marca — características Bling > campo marca > "Sem Marca"
  if (!tem('BRAND')) {
    add('BRAND', carac('marca|brand') || produto.marca || 'Sem Marca')
  }

  // Modelo — código do produto ou nome
  add('MODEL', produto.codigo || produto.nome?.slice(0, 50) || '')

  // Material — características Bling > extrai do nome
  if (!tem('MATERIAL')) {
    let material = carac('material')
    if (!material) {
      const nome = (produto.nome || '').toLowerCase()
      if (nome.includes('aço')) material = 'Aço'
      else if (nome.includes('mdf')) material = 'MDF'
      else if (nome.includes('madeira')) material = 'Madeira'
      else if (nome.includes('vidro')) material = 'Vidro'
      else if (nome.includes('tecido') || nome.includes('veludo')) material = 'Tecido'
      else material = 'Outros materiais'
    }
    add('MATERIAL', material)
  }

  // Montagem
  add('REQUIRES_ASSEMBLY', carac('montagem|assembly') || 'Sim')
  add('INCLUDES_ASSEMBLY_MANUAL', carac('manual') || 'Sim')

  // Dobrável — padrão Não
  add('IS_FOLDABLE', carac('dobrável|foldable') || 'Não')

  // Quantidade de caixas
  add('PACKAGING_BOXES_NUMBER', carac('caixas|boxes') || '1')

  // Quantidade do kit — características Bling > extrai do nome
  if (!tem('CHAIRS_NUMBER_BY_SET') && !tem('TABLES_NUMBER_BY_SET') && !tem('QUANTITY_BY_SET')) {
    const qtdCarac = carac('quantidade|qtd|peças|cadeiras|poltronas')
    const qtdNome = produto.nome?.match(/Kit\s+(\d+)/i)?.[1]
    const qtd = qtdCarac || qtdNome
    if (qtd) {
      add('CHAIRS_NUMBER_BY_SET', qtd)
      add('TABLES_NUMBER_BY_SET', qtd)
      add('QUANTITY_BY_SET', qtd)
    }
  }

  // Dimensões — ML exige unidade (ex: "75 cm")
  const alt = produto.altura ?? produto.dimensoes?.altura
  const prof = produto.profundidade ?? produto.dimensoes?.profundidade
  const larg = produto.largura ?? produto.dimensoes?.largura
  if (alt)  { add('CHAIR_HEIGHT', `${Math.round(alt)} cm`);  add('HEIGHT', `${Math.round(alt)} cm`) }
  if (prof) { add('SEAT_DEPTH',   `${Math.round(prof)} cm`); add('DEPTH',  `${Math.round(prof)} cm`) }
  if (larg) { add('SEAT_WIDTH',   `${Math.round(larg)} cm`); add('WIDTH',  `${Math.round(larg)} cm`) }

  return lista
}

// Remove tags HTML da descrição (Bling usa editor rico)
function stripHtml(html) {
  if (!html) return ''
  return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
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
  const addFoto = url => {
    if (url && typeof url === 'string' && url.startsWith('http') && !fotosSet.has(url)) {
      fotosSet.add(url)
      fotos.push({ source: url })
    }
  }
  if (produto.imagemURL) addFoto(produto.imagemURL)
  if (Array.isArray(produto.imagens)) {
    produto.imagens.forEach(img => {
      if (typeof img === 'string') { addFoto(img); return }
      addFoto(img?.link || img?.url || img?.linkMiniatura || null)
    })
  }

  const estoque = Number(produto.estoque?.saldoVirtualTotal || 0)
  // free listing permite máx 1 unidade; outros tipos precisam de estoque > 0
  const quantidade = listingType === 'free' ? 1 : Math.max(estoque, 1)

  const payload = {
    title: produto.nome,
    category_id: categoryId,
    price: Number(produto.preco),
    currency_id: 'BRL',
    available_quantity: quantidade,
    buying_mode: 'buy_it_now',
    listing_type_id: listingType,
    condition,
    description: { plain_text: stripHtml(produto.descricaoComplementar) || stripHtml(produto.descricaoCurta) || produto.nome },
    seller_custom_field: produto.codigo || undefined,
    pictures: fotos,
    attributes: autoAtributos(produto, atributos)
      .map(a => ({ id: a.id, value_name: a.valor || '' }))
      .filter(a => a.value_name),
    shipping: {
      mode: 'me2',
      free_shipping: false,
      local_pick_up: false,
    },
  }

  if (!catalogListing) {
    payload.catalog_listing = false
  }

  return payload
}
