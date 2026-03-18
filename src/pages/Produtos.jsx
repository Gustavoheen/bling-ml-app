import { useState, useMemo } from 'react'
import { getClienteAtivo, getProdutos, salvarProdutos, atualizarTokensBling, atualizarTokensML, getMapeamentos, salvarMapeamentos, salvarVinculo, getVinculo, adicionarHistorico } from '../lib/storage'
import { getTodosProdutos, atualizarProduto, criarProduto, buscarOuCriarCategoria, refreshToken as blingRefresh } from '../lib/bling'
import { buscarCategorias, getAtributosCategoria, publicarProduto, atualizarProduto as atualizarProdutoML, blingParaMLPayload, refreshToken as mlRefresh } from '../lib/ml'
import { RefreshCw, Search, Package, Plus, Edit2, X, Save, AlertCircle, CheckCircle, Loader, Upload } from 'lucide-react'

async function getTokenValido(cliente) {
  if (!cliente?.bling?.accessToken) throw new Error('Bling não conectado.')
  const expiring = cliente.bling.expiresAt && Date.now() > cliente.bling.expiresAt - 60000
  if (expiring && cliente.bling.refreshToken) {
    const novos = await blingRefresh(cliente.bling.refreshToken)
    atualizarTokensBling(cliente.id, novos)
    return novos.accessToken
  }
  return cliente.bling.accessToken
}

const CAMPOS = [
  { key: 'nome',          label: 'Nome',         type: 'text',   required: true },
  { key: 'codigo',        label: 'SKU / Código',  type: 'text' },
  { key: 'preco',         label: 'Preço (R$)',    type: 'number', required: true },
  { key: 'precoCusto',    label: 'Custo (R$)',    type: 'number' },
  { key: 'descricaoCurta',label: 'Descrição',     type: 'textarea' },
  { key: 'peso',          label: 'Peso (kg)',     type: 'number' },
  { key: 'altura',        label: 'Altura (cm)',   type: 'number' },
  { key: 'largura',       label: 'Largura (cm)',  type: 'number' },
  { key: 'profundidade',  label: 'Profundidade',  type: 'number' },
  { key: 'gtin',          label: 'EAN / GTIN',    type: 'text' },
]

function validarParaML(produto) {
  const erros = []
  if (!produto.nome) erros.push('Nome obrigatório')
  if (!produto.preco || produto.preco <= 0) erros.push('Preço deve ser maior que zero')
  if (!produto.descricaoCurta) erros.push('Descrição obrigatória para ML')
  if (!produto.imagemURL) erros.push('Imagem obrigatória para ML')
  if (!produto.gtin && !produto.codigo) erros.push('EAN ou SKU recomendado para ML')
  return erros
}

export default function Produtos() {
  const cliente = getClienteAtivo()
  const [produtos, setProdutos] = useState(() => getProdutos(cliente?.id || ''))
  const [sincronizando, setSincronizando] = useState(false)
  const [progresso, setProgresso] = useState(0)
  const [erro, setErro] = useState('')
  const [busca, setBusca] = useState('')
  const [ultimaSync, setUltimaSync] = useState(() => localStorage.getItem(`bml_ultima_sync_${cliente?.id}`) || null)

  // Modal edição/criação
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState({})
  const [salvando, setSalvando] = useState(false)
  const [erroModal, setErroModal] = useState('')
  const [sucessoModal, setSucessoModal] = useState(false)
  const [etapaSalvo, setEtapaSalvo] = useState('') // 'bling' | 'ml' | 'ok'

  // Seletor de categoria ML no modal
  const [buscaCategML, setBuscaCategML] = useState('')
  const [resultsCatML, setResultsCatML] = useState([])
  const [buscandoCateg, setBuscandoCateg] = useState(false)
  const [categMLSelecionada, setCategMLSelecionada] = useState(null)
  const [atributosML, setAtributosML] = useState([])
  const [valoresAtributos, setValoresAtributos] = useState({})

  async function buscarCategML(query) {
    if (!query.trim()) return
    setBuscandoCateg(true)
    try { setResultsCatML(await buscarCategorias(query)) }
    catch { setResultsCatML([]) }
    finally { setBuscandoCateg(false) }
  }

  async function selecionarCategML(cat) {
    setCategMLSelecionada(cat)
    setResultsCatML([])
    setBuscaCategML(cat.domain_name || cat.category_name)
    try {
      const attrs = await getAtributosCategoria(cat.category_id)
      setAtributosML(attrs)
    } catch { setAtributosML([]) }
  }

  const produtosFiltrados = useMemo(() => {
    if (!busca.trim()) return produtos
    const q = busca.toLowerCase()
    return produtos.filter(p =>
      p.nome?.toLowerCase().includes(q) ||
      p.codigo?.toLowerCase().includes(q) ||
      String(p.id).includes(q)
    )
  }, [produtos, busca])

  async function sincronizar() {
    if (!cliente) return
    setErro('')
    setSincronizando(true)
    setProgresso(0)
    try {
      const token = await getTokenValido(getClienteAtivo())
      const lista = await getTodosProdutos(token, (n) => setProgresso(n))
      salvarProdutos(cliente.id, lista)
      const agora = new Date().toLocaleString('pt-BR')
      localStorage.setItem(`bml_ultima_sync_${cliente.id}`, agora)
      setProdutos(lista)
      setUltimaSync(agora)
    } catch (e) {
      setErro(e.message)
    } finally {
      setSincronizando(false)
    }
  }

  function abrirEditar(produto) {
    setForm({
      nome: produto.nome || '',
      codigo: produto.codigo || '',
      preco: produto.preco || '',
      precoCusto: produto.precoCusto || '',
      descricaoCurta: produto.descricaoCurta || '',
      peso: produto.peso || '',
      altura: produto.altura || '',
      largura: produto.largura || '',
      profundidade: produto.profundidade || '',
      gtin: produto.gtin || '',
    })
    setModal({ produto, isNovo: false })
    setErroModal('')
    setSucessoModal(false)
    // Pré-carrega mapeamento existente da categoria do produto
    const cat = produto.categoria?.nome || 'Sem categoria'
    const mapArr = getMapeamentos(cliente?.id || '')
    const mapObj = {}
    for (const i of (Array.isArray(mapArr) ? mapArr : [])) mapObj[i.categoriaBling] = i
    const mapaAtual = mapObj[cat]
    if (mapaAtual?.mlCategoryId) {
      setCategMLSelecionada({ category_id: mapaAtual.mlCategoryId, domain_name: mapaAtual.mlCategoryName })
      setBuscaCategML(mapaAtual.mlCategoryName)
      setAtributosML(mapaAtual.atributos?.map(a => ({ id: a.id, name: a.name })) || [])
      setValoresAtributos(Object.fromEntries((mapaAtual.atributos || []).map(a => [a.id, a.valor || ''])))
    } else {
      setBuscaCategML('')
      setResultsCatML([])
      setCategMLSelecionada(null)
      setAtributosML([])
      setValoresAtributos({})
    }
  }

  function abrirNovo() {
    setForm({ nome: '', codigo: '', preco: '', descricaoCurta: '', peso: '', gtin: '' })
    setModal({ produto: null, isNovo: true })
    setErroModal('')
    setSucessoModal(false)
    setBuscaCategML('')
    setResultsCatML([])
    setCategMLSelecionada(null)
    setAtributosML([])
    setValoresAtributos({})
  }

  async function getMLToken() {
    const c = getClienteAtivo()
    if (!c?.ml?.accessToken) return null
    const exp = c.ml.expiresAt && Date.now() > c.ml.expiresAt - 60000
    if (exp && c.ml.refreshToken) {
      const n = await mlRefresh(c.ml.refreshToken)
      atualizarTokensML(c.id, n)
      return n.accessToken
    }
    return c.ml.accessToken
  }

  async function salvar() {
    if (!form.nome?.trim() || !form.preco) { setErroModal('Nome e preço são obrigatórios.'); return }
    setSalvando(true)
    setErroModal('')
    setEtapaSalvo('')
    try {
      const blingToken = await getTokenValido(getClienteAtivo())
      const catNome = modal.isNovo ? form.categoria : (modal.produto?.categoria?.nome || 'Sem categoria')

      // 1. Cria/garante categoria no Bling se foi selecionada categoria ML
      let categoriaId = modal.produto?.categoria?.id
      if (categMLSelecionada && catNome) {
        try { categoriaId = await buscarOuCriarCategoria(blingToken, catNome) } catch {}
      }

      const dados = {
        nome: form.nome,
        codigo: form.codigo || undefined,
        preco: parseFloat(form.preco) || 0,
        precoCusto: parseFloat(form.precoCusto) || undefined,
        descricaoCurta: form.descricaoCurta || undefined,
        peso: parseFloat(form.peso) || undefined,
        altura: parseFloat(form.altura) || undefined,
        largura: parseFloat(form.largura) || undefined,
        profundidade: parseFloat(form.profundidade) || undefined,
        gtin: form.gtin || undefined,
        ...(categoriaId ? { categoria: { id: categoriaId } } : {}),
      }

      // 2. Salva no Bling
      setEtapaSalvo('bling')
      let blingId = modal.produto?.id
      if (modal.isNovo) {
        const resp = await criarProduto(blingToken, dados)
        blingId = resp?.data?.id
      } else {
        await atualizarProduto(blingToken, modal.produto.id, dados)
      }

      // 3. Salva mapeamento ML
      if (categMLSelecionada && catNome) {
        const mapArr = getMapeamentos(cliente.id)
        const mapObj = {}
        for (const i of (Array.isArray(mapArr) ? mapArr : [])) mapObj[i.categoriaBling] = i
        mapObj[catNome] = {
          categoriaBling: catNome,
          mlCategoryId: categMLSelecionada.category_id,
          mlCategoryName: categMLSelecionada.domain_name || categMLSelecionada.category_name,
          atributos: atributosML.map(a => ({ id: a.id, name: a.name, valor: valoresAtributos[a.id] || '' })),
        }
        salvarMapeamentos(cliente.id, Object.values(mapObj))

        // 4. Exporta para ML automaticamente
        setEtapaSalvo('ml')
        try {
          const mlToken = await getMLToken()
          if (mlToken && blingId) {
            const mapa = mapObj[catNome]
            const produtoCompleto = { ...dados, id: blingId, categoria: { nome: catNome }, estoque: modal.produto?.estoque || { saldoVirtualTotal: 0 } }
            const config = (() => { try { return JSON.parse(localStorage.getItem('bml_export_config') || '{}') } catch { return {} } })()
            const mlIdExistente = getVinculo(cliente.id, String(blingId))

            if (mlIdExistente) {
              // Já publicado antes — atualiza
              await atualizarProdutoML(mlToken, mlIdExistente, {
                price: parseFloat(form.preco),
                available_quantity: produtoCompleto.estoque?.saldoVirtualTotal || 0,
              })
              adicionarHistorico(cliente.id, { tipo: 'atualizar', produtoId: blingId, produtoNome: form.nome, mlId: mlIdExistente, status: 'ok' })
            } else {
              // Primeira vez — publica
              const payload = blingParaMLPayload(produtoCompleto, mapa.mlCategoryId, mapa.atributos, config)
              const resp = await publicarProduto(mlToken, payload)
              salvarVinculo(cliente.id, String(blingId), resp.id)
              adicionarHistorico(cliente.id, { tipo: 'publicar', produtoId: blingId, produtoNome: form.nome, mlId: resp.id, status: 'ok' })
            }
          }
        } catch (mlErr) {
          // Erro no ML não impede o fluxo — reporta mas continua
          setErroModal(`Salvo no Bling ✓, mas erro no ML: ${mlErr.message}`)
        }
      }

      setEtapaSalvo('ok')
      setSucessoModal(true)
      await sincronizar()
      setTimeout(() => { setModal(null); setSucessoModal(false); setEtapaSalvo('') }, 1500)
    } catch (e) {
      setErroModal(e.message)
    } finally {
      setSalvando(false)
    }
  }

  const errosML = modal?.produto ? validarParaML({ ...modal.produto, ...form }) : []

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: '#1A202C', marginBottom: 4 }}>Produtos do Bling</h2>
          {ultimaSync && <p style={{ fontSize: 12, color: '#718096' }}>Última sync: {ultimaSync}</p>}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={abrirNovo}
            style={{ display: 'flex', alignItems: 'center', gap: 7, background: '#fff', border: '1.5px solid #E2E8F0', color: '#1A202C', borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 700 }}>
            <Plus size={14} /> Novo produto
          </button>
          <button onClick={sincronizar} disabled={sincronizando}
            style={{ display: 'flex', alignItems: 'center', gap: 8, background: sincronizando ? '#CBD5E0' : '#1A202C', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 700 }}>
            <RefreshCw size={14} style={sincronizando ? { animation: 'spin 1s linear infinite' } : {}} />
            {sincronizando ? `Buscando... ${progresso}` : 'Sincronizar'}
          </button>
        </div>
      </div>

      {erro && (
        <div style={{ background: 'rgba(252,129,74,0.1)', border: '1px solid #FC8181', borderRadius: 10, padding: '12px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
          <AlertCircle size={16} color="#FC8181" />
          <span style={{ fontSize: 13, color: '#C53030', fontWeight: 600 }}>{erro}</span>
        </div>
      )}

      {/* Stats */}
      {produtos.length > 0 && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
          {[
            { label: 'Total', value: produtos.length, color: '#1A202C' },
            { label: 'Com estoque', value: produtos.filter(p => (p.estoque?.saldoVirtualTotal || 0) > 0).length, color: '#48BB78' },
            { label: 'Sem estoque', value: produtos.filter(p => (p.estoque?.saldoVirtualTotal || 0) === 0).length, color: '#FC8181' },
          ].map(s => (
            <div key={s.label} style={{ background: '#fff', border: '1.5px solid #E2E8F0', borderRadius: 10, padding: '12px 20px' }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: '#718096', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{s.label}</p>
              <p style={{ fontSize: 24, fontWeight: 800, color: s.color, marginTop: 4 }}>{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Busca */}
      {produtos.length > 0 && (
        <div style={{ position: 'relative', marginBottom: 14 }}>
          <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#A0AEC0' }} />
          <input type="text" placeholder="Buscar por nome, código ou ID..." value={busca} onChange={e => setBusca(e.target.value)}
            style={{ width: '100%', padding: '10px 12px 10px 36px', border: '1.5px solid #E2E8F0', borderRadius: 8, fontSize: 14, outline: 'none', boxSizing: 'border-box', background: '#fff' }} />
        </div>
      )}

      {/* Lista */}
      {produtos.length === 0 && !sincronizando ? (
        <div style={{ background: '#fff', border: '1.5px dashed #CBD5E0', borderRadius: 14, padding: '48px 24px', textAlign: 'center' }}>
          <Package size={40} color="#CBD5E0" style={{ marginBottom: 16 }} />
          <p style={{ fontWeight: 700, color: '#A0AEC0', fontSize: 16 }}>Nenhum produto sincronizado</p>
          <p style={{ fontSize: 13, color: '#CBD5E0', marginTop: 6 }}>Clique em "Sincronizar" para buscar seus produtos do Bling</p>
        </div>
      ) : (
        <div style={{ background: '#fff', border: '1.5px solid #E2E8F0', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1.5px solid #E2E8F0', background: '#F7FAFC' }}>
                <th style={TH}>Produto</th>
                <th style={TH}>SKU</th>
                <th style={{ ...TH, textAlign: 'right' }}>Preço</th>
                <th style={{ ...TH, textAlign: 'right' }}>Estoque</th>
                <th style={{ ...TH, textAlign: 'center' }}>ML</th>
                <th style={{ ...TH, textAlign: 'center' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {produtosFiltrados.slice(0, 300).map((p, i) => {
                const erros = validarParaML(p)
                return (
                  <tr key={p.id} style={{ borderBottom: '1px solid #F7FAFC', background: i % 2 === 0 ? '#fff' : '#FAFBFC' }}>
                    <td style={{ padding: '10px 16px' }}>
                      <p style={{ fontSize: 13, fontWeight: 600, color: '#1A202C' }}>{p.nome}</p>
                      {p.categoria?.nome && <p style={{ fontSize: 11, color: '#A0AEC0', marginTop: 2 }}>{p.categoria.nome}</p>}
                    </td>
                    <td style={{ padding: '10px 16px' }}>
                      <span style={{ fontSize: 12, color: '#718096', fontFamily: 'monospace' }}>{p.codigo || '—'}</span>
                    </td>
                    <td style={{ padding: '10px 16px', textAlign: 'right' }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#1A202C' }}>
                        {p.preco ? `R$ ${Number(p.preco).toFixed(2)}` : '—'}
                      </span>
                    </td>
                    <td style={{ padding: '10px 16px', textAlign: 'right' }}>
                      <span style={{ fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: (p.estoque?.saldoVirtualTotal || 0) > 0 ? 'rgba(72,187,120,0.1)' : 'rgba(252,129,74,0.1)', color: (p.estoque?.saldoVirtualTotal || 0) > 0 ? '#48BB78' : '#FC8181' }}>
                        {p.estoque?.saldoVirtualTotal ?? 0}
                      </span>
                    </td>
                    <td style={{ padding: '10px 16px', textAlign: 'center' }}>
                      {erros.length === 0
                        ? <CheckCircle size={15} color="#48BB78" title="Pronto para ML" />
                        : <span title={erros.join(', ')} style={{ fontSize: 11, fontWeight: 700, color: '#FC8181', cursor: 'help' }}>⚠ {erros.length}</span>}
                    </td>
                    <td style={{ padding: '10px 16px', textAlign: 'center' }}>
                      <button onClick={() => abrirEditar(p)}
                        style={{ background: 'none', border: 'none', color: '#718096', padding: 4, borderRadius: 6, display: 'inline-flex' }}
                        onMouseEnter={e => e.currentTarget.style.color = '#3182CE'}
                        onMouseLeave={e => e.currentTarget.style.color = '#718096'}>
                        <Edit2 size={14} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {produtosFiltrados.length > 300 && (
            <p style={{ textAlign: 'center', padding: 12, fontSize: 12, color: '#718096' }}>Exibindo 300 de {produtosFiltrados.length}. Use a busca para filtrar.</p>
          )}
        </div>
      )}

      {/* Modal edição/criação */}
      {modal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 580, maxHeight: '90vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            {/* Header modal */}
            <div style={{ padding: '20px 24px', borderBottom: '1.5px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 style={{ fontSize: 16, fontWeight: 800, color: '#1A202C' }}>
                {modal.isNovo ? 'Novo produto no Bling' : `Editar: ${modal.produto.nome}`}
              </h3>
              <button onClick={() => setModal(null)} style={{ background: 'none', border: 'none', color: '#718096', display: 'flex' }}>
                <X size={20} />
              </button>
            </div>

            <div style={{ padding: '20px 24px' }}>
              {/* Campos */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
                {CAMPOS.map(c => (
                  <div key={c.key} style={{ gridColumn: c.type === 'textarea' ? '1 / -1' : 'auto' }}>
                    <label style={{ fontSize: 12, fontWeight: 700, color: '#4A5568', display: 'block', marginBottom: 4 }}>
                      {c.label} {c.required && <span style={{ color: '#FC8181' }}>*</span>}
                    </label>
                    {c.type === 'textarea'
                      ? <textarea value={form[c.key] || ''} onChange={e => setForm(f => ({ ...f, [c.key]: e.target.value }))}
                          rows={3} style={{ width: '100%', padding: '8px 10px', border: '1.5px solid #E2E8F0', borderRadius: 6, fontSize: 13, outline: 'none', resize: 'vertical', boxSizing: 'border-box' }} />
                      : <input type={c.type} value={form[c.key] || ''} onChange={e => setForm(f => ({ ...f, [c.key]: e.target.value }))}
                          style={{ width: '100%', padding: '8px 10px', border: '1.5px solid #E2E8F0', borderRadius: 6, fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
                    }
                  </div>
                ))}
              </div>

              {/* Categoria ML — cadastro novo e edição */}
              {(modal.isNovo || !modal.isNovo) && (
                <div style={{ gridColumn: '1 / -1', borderTop: '1.5px solid #F7FAFC', paddingTop: 16, marginTop: 4 }}>
                  <p style={{ fontSize: 12, fontWeight: 700, color: '#3182CE', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                    Categoria no Mercado Livre (opcional — vincula já na criação)
                  </p>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                    <input type="text" placeholder="Buscar categoria ML..." value={buscaCategML}
                      onChange={e => setBuscaCategML(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && buscarCategML(buscaCategML)}
                      style={{ flex: 1, padding: '8px 12px', border: '1.5px solid #E2E8F0', borderRadius: 6, fontSize: 13, outline: 'none' }} />
                    <button type="button" onClick={() => buscarCategML(buscaCategML)} disabled={buscandoCateg}
                      style={{ background: '#3182CE', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 14px', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                      {buscandoCateg ? <Loader size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Search size={13} />}
                    </button>
                  </div>
                  {resultsCatML.length > 0 && (
                    <div style={{ border: '1.5px solid #E2E8F0', borderRadius: 8, overflow: 'hidden', marginBottom: 10 }}>
                      {resultsCatML.map(r => (
                        <button key={r.category_id} type="button" onClick={() => selecionarCategML(r)}
                          style={{ width: '100%', padding: '9px 14px', background: '#F7FAFC', border: 'none', borderBottom: '1px solid #E2E8F0', textAlign: 'left', fontSize: 13 }}
                          onMouseEnter={e => e.currentTarget.style.background = 'rgba(99,179,237,0.08)'}
                          onMouseLeave={e => e.currentTarget.style.background = '#F7FAFC'}>
                          <span style={{ fontWeight: 700, color: '#1A202C' }}>{r.domain_name}</span>
                          <span style={{ color: '#A0AEC0', marginLeft: 8, fontSize: 11 }}>{r.category_id}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {categMLSelecionada && (
                    <div style={{ background: 'rgba(72,187,120,0.06)', border: '1px solid rgba(72,187,120,0.2)', borderRadius: 8, padding: '10px 14px', marginBottom: atributosML.length ? 12 : 0 }}>
                      <p style={{ fontSize: 11, fontWeight: 700, color: '#48BB78' }}>✓ Categoria selecionada</p>
                      <p style={{ fontSize: 13, fontWeight: 700, color: '#1A202C', marginTop: 2 }}>{categMLSelecionada.domain_name}</p>
                      <p style={{ fontSize: 11, color: '#718096', fontFamily: 'monospace' }}>{categMLSelecionada.category_id}</p>
                    </div>
                  )}
                  {atributosML.length > 0 && (
                    <div style={{ marginTop: 12 }}>
                      <p style={{ fontSize: 12, fontWeight: 700, color: '#4A5568', marginBottom: 8 }}>Atributos obrigatórios desta categoria:</p>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        {atributosML.map(a => (
                          <div key={a.id}>
                            <label style={{ fontSize: 11, fontWeight: 600, color: '#4A5568', display: 'block', marginBottom: 3 }}>{a.name} *</label>
                            <input type="text" value={valoresAtributos[a.id] || ''}
                              onChange={e => setValoresAtributos(v => ({ ...v, [a.id]: e.target.value }))}
                              placeholder={a.name}
                              style={{ width: '100%', padding: '7px 10px', border: '1.5px solid #E2E8F0', borderRadius: 6, fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Validação ML */}
              {!modal.isNovo && errosML.length > 0 && (
                <div style={{ background: 'rgba(252,193,7,0.08)', border: '1px solid rgba(252,193,7,0.4)', borderRadius: 10, padding: '12px 14px', marginBottom: 16 }}>
                  <p style={{ fontSize: 12, fontWeight: 700, color: '#D69E2E', marginBottom: 6 }}>⚠ Campos faltando para exportar ao ML:</p>
                  {errosML.map(e => <p key={e} style={{ fontSize: 12, color: '#B7791F', marginTop: 2 }}>• {e}</p>)}
                </div>
              )}
              {!modal.isNovo && errosML.length === 0 && (
                <div style={{ background: 'rgba(72,187,120,0.08)', border: '1px solid rgba(72,187,120,0.3)', borderRadius: 10, padding: '10px 14px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <CheckCircle size={14} color="#48BB78" />
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#48BB78' }}>Produto pronto para exportar ao Mercado Livre</span>
                </div>
              )}

              {erroModal && (
                <div style={{ background: 'rgba(252,129,74,0.1)', border: '1px solid #FC8181', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: '#C53030', fontWeight: 600 }}>
                  {erroModal}
                </div>
              )}
              {sucessoModal && (
                <div style={{ background: 'rgba(72,187,120,0.1)', border: '1px solid #48BB78', borderRadius: 8, padding: '10px 14px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <CheckCircle size={14} color="#48BB78" />
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#48BB78' }}>Salvo no Bling!</span>
                </div>
              )}

              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={salvar} disabled={salvando}
                  style={{ flex: 1, background: salvando ? '#CBD5E0' : '#1A202C', color: '#fff', border: 'none', borderRadius: 8, padding: '12px 0', fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  <Save size={14} />
                  {salvando
                    ? etapaSalvo === 'bling' ? '1/3 Salvando no Bling...'
                    : etapaSalvo === 'ml'    ? '2/3 Publicando no ML...'
                    : '3/3 Finalizando...'
                    : modal.isNovo
                    ? categMLSelecionada ? 'Criar no Bling + Publicar no ML' : 'Criar no Bling'
                    : categMLSelecionada ? 'Salvar no Bling + Sincronizar ML' : 'Salvar no Bling'
                  }
                </button>
                <button onClick={() => setModal(null)}
                  style={{ background: '#F7FAFC', border: '1.5px solid #E2E8F0', color: '#718096', borderRadius: 8, padding: '12px 20px', fontSize: 14, fontWeight: 600 }}>
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

const TH = {
  padding: '10px 16px', textAlign: 'left',
  fontSize: 11, fontWeight: 700, color: '#718096',
  textTransform: 'uppercase', letterSpacing: '0.06em',
}
