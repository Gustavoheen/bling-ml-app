// Gerencia múltiplos clientes no localStorage
const STORAGE_KEY = 'bml_clientes'
const CLIENTE_ATIVO_KEY = 'bml_cliente_ativo'

const CLIENTES_PADRAO = [
  { id: 'cliente_casa_comercio', nome: 'Casa e Comércio' },
]

function novoCliente(id, nome) {
  return {
    id, nome,
    criadoEm: new Date().toISOString(),
    bling: { accessToken: null, refreshToken: null, expiresAt: null },
    ml:    { accessToken: null, refreshToken: null, expiresAt: null },
  }
}

export function getClientes() {
  try {
    const lista = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    if (lista.length > 0) return lista
    // Seed clientes padrão na primeira vez
    const padrao = CLIENTES_PADRAO.map(c => novoCliente(c.id, c.nome))
    localStorage.setItem(STORAGE_KEY, JSON.stringify(padrao))
    return padrao
  }
  catch { return [] }
}

export function getClienteAtivo() {
  const id = localStorage.getItem(CLIENTE_ATIVO_KEY)
  if (!id) return null
  return getClientes().find(c => c.id === id) || null
}

export function setClienteAtivo(id) {
  localStorage.setItem(CLIENTE_ATIVO_KEY, id)
}

export function salvarCliente(cliente) {
  const clientes = getClientes()
  const idx = clientes.findIndex(c => c.id === cliente.id)
  if (idx >= 0) clientes[idx] = cliente
  else clientes.push(cliente)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(clientes))
}

export function criarCliente(nome) {
  const cliente = {
    id: `cliente_${Date.now()}`,
    nome,
    criadoEm: new Date().toISOString(),
    bling: { accessToken: null, refreshToken: null, expiresAt: null },
    ml: { accessToken: null, refreshToken: null, expiresAt: null },
  }
  salvarCliente(cliente)
  setClienteAtivo(cliente.id)
  return cliente
}

export function removerCliente(id) {
  const clientes = getClientes().filter(c => c.id !== id)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(clientes))
  const ativo = localStorage.getItem(CLIENTE_ATIVO_KEY)
  if (ativo === id) localStorage.removeItem(CLIENTE_ATIVO_KEY)
}

export function atualizarTokensBling(clienteId, tokens) {
  const clientes = getClientes()
  const c = clientes.find(c => c.id === clienteId)
  if (!c) return
  c.bling = { ...c.bling, ...tokens }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(clientes))
}

export function atualizarTokensML(clienteId, tokens) {
  const clientes = getClientes()
  const c = clientes.find(c => c.id === clienteId)
  if (!c) return
  c.ml = { ...c.ml, ...tokens }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(clientes))
}

// Produtos sincronizados por cliente
export function getProdutos(clienteId) {
  try { return JSON.parse(localStorage.getItem(`bml_produtos_${clienteId}`) || '[]') }
  catch { return [] }
}

export function salvarProdutos(clienteId, produtos) {
  localStorage.setItem(`bml_produtos_${clienteId}`, JSON.stringify(produtos))
}

export function getMapeamentos(clienteId) {
  try { return JSON.parse(localStorage.getItem(`bml_mapeamentos_${clienteId}`) || '[]') }
  catch { return [] }
}

export function salvarMapeamentos(clienteId, mapeamentos) {
  localStorage.setItem(`bml_mapeamentos_${clienteId}`, JSON.stringify(mapeamentos))
}

export function getHistorico(clienteId) {
  try { return JSON.parse(localStorage.getItem(`bml_historico_${clienteId}`) || '[]') }
  catch { return [] }
}

export function adicionarHistorico(clienteId, entrada) {
  const hist = getHistorico(clienteId)
  hist.unshift({ ...entrada, id: Date.now(), criadoEm: new Date().toISOString() })
  localStorage.setItem(`bml_historico_${clienteId}`, JSON.stringify(hist.slice(0, 100)))
}

// Vínculos Bling ID → ML Item ID (sincronização permanente)
export function getVinculos(clienteId) {
  try { return JSON.parse(localStorage.getItem(`bml_vinculos_${clienteId}`) || '{}') }
  catch { return {} }
}

export function salvarVinculo(clienteId, blingId, mlId) {
  const v = getVinculos(clienteId)
  v[blingId] = mlId
  localStorage.setItem(`bml_vinculos_${clienteId}`, JSON.stringify(v))
}

export function getVinculo(clienteId, blingId) {
  return getVinculos(clienteId)[blingId] || null
}
