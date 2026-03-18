import { useState, useMemo } from 'react'
import {
  getClienteAtivo, getProdutos, getMapeamentos,
  atualizarTokensML, adicionarHistorico, salvarProdutos
} from '../lib/storage'
import {
  publicarProduto, blingParaMLPayload,
  refreshToken as mlRefresh
} from '../lib/ml'
import { atualizarProduto, refreshToken as blingRefresh } from '../lib/bling'
import { atualizarTokensBling } from '../lib/storage'
import {
  Upload, CheckCircle, XCircle, Clock, AlertCircle,
  Search, ChevronDown, ChevronUp, Edit2, Save, X
} from 'lucide-react'

async function getMLToken(cliente) {
  if (!cliente.ml?.accessToken) throw new Error('Mercado Livre não conectado.')
  const expiring = cliente.ml.expiresAt && Date.now() > cliente.ml.expiresAt - 60000
  if (expiring && cliente.ml.refreshToken) {
    const novos = await mlRefresh(cliente.ml.refreshToken)
    atualizarTokensML(cliente.id, novos)
    return novos.accessToken
  }
  return cliente.ml.accessToken
}

async function getBlingToken(cliente) {
  if (!cliente.bling?.accessToken) throw new Error('Bling não conectado.')
  const expiring = cliente.bling.expiresAt && Date.now() > cliente.bling.expiresAt - 60000
  if (expiring && cliente.bling.refreshToken) {
    const novos = await blingRefresh(cliente.bling.refreshToken)
    atualizarTokensBling(cliente.id, novos)
    return novos.accessToken
  }
  return cliente.bling.accessToken
}

// Validação completa para ML
function validarML(produto, mapa) {
  const problemas = []
  if (!produto.nome?.trim()) problemas.push({ campo: 'nome', msg: 'Nome obrigatório' })
  if (!produto.preco || Number(produto.preco) <= 0) problemas.push({ campo: 'preco', msg: 'Preço deve ser maior que R$ 0,00' })
  if (!produto.descricaoCurta?.trim()) problemas.push({ campo: 'descricaoCurta', msg: 'Descrição obrigatória para ML' })
  if (!produto.imagemURL && (!produto.imagens || produto.imagens.length === 0)) problemas.push({ campo: 'imagem', msg: 'Imagem obrigatória para ML' })
  if (!mapa) problemas.push({ campo: 'categoria', msg: 'Categoria não mapeada (vá em Mapeamento)' })
  else {
    const atrsObrigatorios = (mapa.atributos || []).filter(a => !a.valor?.trim())
    if (atrsObrigatorios.length > 0) {
      atrsObrigatorios.forEach(a => problemas.push({ campo: `attr_${a.id}`, msg: `Atributo obrigatório: ${a.name}` }))
    }
  }
  return problemas
}

function parsearErroML(err) {
  const msg = err?.message || err || ''
  const sugestoes = []
  if (msg.includes('title')) sugestoes.push('Problema no título/nome do produto')
  if (msg.includes('price')) sugestoes.push('Preço inválido ou abaixo do mínimo permitido pelo ML')
  if (msg.includes('category')) sugestoes.push('Categoria inválida ou não permitida')
  if (msg.includes('description')) sugestoes.push('Descrição inválida ou muito curta')
  if (msg.includes('picture') || msg.includes('image')) sugestoes.push('Imagem inválida, inacessível ou muito pequena')
  if (msg.includes('attribute')) sugestoes.push('Atributo obrigatório ausente ou inválido')
  if (msg.includes('condition')) sugestoes.push('Condição do produto inválida (new/used)')
  if (msg.includes('listing_type')) sugestoes.push('Tipo de anúncio inválido')
  return sugestoes.length > 0 ? sugestoes : [msg]
}

export default function Exportacao() {
  const cliente = getClienteAtivo()
  const produtos = getProdutos(cliente?.id || '')
  const mapeamentosArr = getMapeamentos(cliente?.id || '')

  const mapeamentos = useMemo(() => {
    const m = {}
    for (const item of (Array.isArray(mapeamentosArr) ? mapeamentosArr : [])) m[item.categoriaBling] = item
    return m
  }, [mapeamentosArr])

  // Produtos com sua validação
  const produtosComStatus = useMemo(() =>
    produtos.map(p => {
      const cat = p.categoria?.nome || 'Sem categoria'
      const mapa = mapeamentos[cat]
      const problemas = validarML(p, mapa)
      return { ...p, _cat: cat, _mapa: mapa, _problemas: problemas, _ok: problemas.length === 0 }
    }), [produtos, mapeamentos])

  const prontos = produtosComStatus.filter(p => p._ok)
  const comProblema = produtosComStatus.filter(p => !p._ok)

  const [config, setConfig] = useState(() => {
    try { return JSON.parse(localStorage.getItem('bml_export_config') || '{}') }
    catch { return {} }
  })
  const [selecionados, setSelecionados] = useState(new Set())
  const [resultados, setResultados] = useState({})
  const [exportando, setExportando] = useState(false)
  const [busca, setBusca] = useState('')
  const [aba, setAba] = useState('prontos') // prontos | problemas
  const [expandido, setExpandido] = useState(null)
  const [editando, setEditando] = useState({}) // { produtoId: { campo: valor } }
  const [salvando, setSalvando] = useState({})
  const [mostrarConfig, setMostrarConfig] = useState(false)

  function salvarConfig(novaConfig) {
    setConfig(novaConfig)
    localStorage.setItem('bml_export_config', JSON.stringify(novaConfig))
  }

  const lista = aba === 'prontos' ? prontos : comProblema
  const filtrada = useMemo(() => {
    if (!busca.trim()) return lista
    const q = busca.toLowerCase()
    return lista.filter(p => p.nome?.toLowerCase().includes(q) || p.codigo?.toLowerCase().includes(q))
  }, [lista, busca])

  function toggleTodos() {
    if (aba !== 'prontos') return
    if (selecionados.size === prontos.length) setSelecionados(new Set())
    else setSelecionados(new Set(prontos.map(p => p.id)))
  }

  function toggleProduto(id) {
    const novo = new Set(selecionados)
    if (novo.has(id)) novo.delete(id)
    else novo.add(id)
    setSelecionados(novo)
  }

  async function exportar() {
    if (selecionados.size === 0) return
    setExportando(true)
    let token
    try { token = await getMLToken(getClienteAtivo()) }
    catch (e) { alert(e.message); setExportando(false); return }

    const lista = prontos.filter(p => selecionados.has(p.id))
    for (const produto of lista) {
      setResultados(r => ({ ...r, [produto.id]: { status: 'enviando' } }))
      try {
        const payload = blingParaMLPayload(produto, produto._mapa.mlCategoryId, produto._mapa.atributos || [], config)
        const resp = await publicarProduto(token, payload)
        setResultados(r => ({ ...r, [produto.id]: { status: 'ok', mlId: resp.id } }))
        adicionarHistorico(cliente.id, { tipo: 'publicar', produtoId: produto.id, produtoNome: produto.nome, mlId: resp.id, status: 'ok' })
      } catch (e) {
        const sugestoes = parsearErroML(e)
        setResultados(r => ({ ...r, [produto.id]: { status: 'erro', msg: e.message, sugestoes } }))
        adicionarHistorico(cliente.id, { tipo: 'publicar', produtoId: produto.id, produtoNome: produto.nome, status: 'erro', erro: e.message })
      }
      await new Promise(r => setTimeout(r, 500))
    }
    setExportando(false)
  }

  async function salvarCampo(produto) {
    const campos = editando[produto.id]
    if (!campos) return
    setSalvando(s => ({ ...s, [produto.id]: true }))
    try {
      const token = await getBlingToken(getClienteAtivo())
      await atualizarProduto(token, produto.id, campos)
      // Atualiza localmente
      const atual = getProdutos(cliente.id)
      const novo = atual.map(p => p.id === produto.id ? { ...p, ...campos } : p)
      salvarProdutos(cliente.id, novo)
      setEditando(e => { const n = { ...e }; delete n[produto.id]; return n })
    } catch (e) {
      alert('Erro ao salvar: ' + e.message)
    } finally {
      setSalvando(s => ({ ...s, [produto.id]: false }))
    }
  }

  const okCount = Object.values(resultados).filter(r => r.status === 'ok').length
  const erroCount = Object.values(resultados).filter(r => r.status === 'erro').length

  if (produtos.length === 0) {
    return (
      <div>
        <h2 style={{ fontSize: 20, fontWeight: 800, color: '#1A202C', marginBottom: 24 }}>Exportação para ML</h2>
        <div style={{ background: '#fff', border: '1.5px dashed #CBD5E0', borderRadius: 14, padding: '48px 24px', textAlign: 'center' }}>
          <Upload size={40} color="#CBD5E0" style={{ marginBottom: 16 }} />
          <p style={{ fontWeight: 700, color: '#A0AEC0' }}>Sincronize produtos primeiro na aba "Produtos".</p>
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: '#1A202C', marginBottom: 4 }}>Exportação para ML</h2>
          <p style={{ fontSize: 13, color: '#718096' }}>{prontos.length} prontos · {comProblema.length} com problemas</p>
        </div>
        <button onClick={exportar} disabled={selecionados.size === 0 || exportando}
          style={{ display: 'flex', alignItems: 'center', gap: 8, background: selecionados.size > 0 && !exportando ? '#1A202C' : '#CBD5E0', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: 13, fontWeight: 700 }}>
          <Upload size={14} />
          {exportando ? 'Publicando...' : `Publicar ${selecionados.size > 0 ? `(${selecionados.size})` : ''}`}
        </button>
      </div>

      {/* Resultados */}
      {(okCount > 0 || erroCount > 0) && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
          {okCount > 0 && <div style={{ background: 'rgba(72,187,120,0.1)', border: '1px solid #48BB78', borderRadius: 10, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <CheckCircle size={16} color="#48BB78" /><span style={{ fontSize: 13, fontWeight: 700, color: '#48BB78' }}>{okCount} publicado{okCount > 1 ? 's' : ''}</span>
          </div>}
          {erroCount > 0 && <div style={{ background: 'rgba(252,129,74,0.1)', border: '1px solid #FC8181', borderRadius: 10, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <XCircle size={16} color="#FC8181" /><span style={{ fontSize: 13, fontWeight: 700, color: '#FC8181' }}>{erroCount} com erro — veja abaixo o que corrigir</span>
          </div>}
        </div>
      )}

      {/* Configurações padrão de exportação */}
      <div style={{ background: '#fff', border: '1.5px solid #E2E8F0', borderRadius: 12, marginBottom: 16, overflow: 'hidden' }}>
        <button onClick={() => setMostrarConfig(!mostrarConfig)}
          style={{ width: '100%', padding: '12px 16px', background: 'none', border: 'none', textAlign: 'left', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#1A202C' }}>⚙ Configurações padrão de exportação</span>
          <span style={{ fontSize: 12, color: '#718096' }}>
            {config.listingType || 'gold_special'} · {config.condition || 'new'} · {config.catalogListing ? 'com catálogo' : 'sem catálogo'}
            {mostrarConfig ? ' ▲' : ' ▼'}
          </span>
        </button>
        {mostrarConfig && (
          <div style={{ borderTop: '1px solid #F7FAFC', padding: '16px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: '#4A5568', display: 'block', marginBottom: 6 }}>Tipo de anúncio</label>
              <select value={config.listingType || 'gold_special'} onChange={e => salvarConfig({ ...config, listingType: e.target.value })}
                style={{ width: '100%', padding: '8px 10px', border: '1.5px solid #E2E8F0', borderRadius: 6, fontSize: 13, background: '#fff' }}>
                <option value="gold_special">Clássico (gold_special)</option>
                <option value="gold_pro">Premium (gold_pro)</option>
                <option value="gold_premium">Gold Premium</option>
                <option value="free">Grátis</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: '#4A5568', display: 'block', marginBottom: 6 }}>Condição</label>
              <select value={config.condition || 'new'} onChange={e => salvarConfig({ ...config, condition: e.target.value })}
                style={{ width: '100%', padding: '8px 10px', border: '1.5px solid #E2E8F0', borderRadius: 6, fontSize: 13, background: '#fff' }}>
                <option value="new">Novo</option>
                <option value="used">Usado</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: '#4A5568', display: 'block', marginBottom: 6 }}>Catálogo ML</label>
              <select value={config.catalogListing ? 'sim' : 'nao'} onChange={e => salvarConfig({ ...config, catalogListing: e.target.value === 'sim' })}
                style={{ width: '100%', padding: '8px 10px', border: '1.5px solid #E2E8F0', borderRadius: 6, fontSize: 13, background: '#fff' }}>
                <option value="nao">Não subir como catálogo</option>
                <option value="sim">Subir como catálogo</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Abas */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 16, background: '#F7FAFC', borderRadius: 10, padding: 4, width: 'fit-content' }}>
        {[
          { id: 'prontos', label: `✓ Prontos (${prontos.length})` },
          { id: 'problemas', label: `⚠ Com problemas (${comProblema.length})` },
        ].map(a => (
          <button key={a.id} onClick={() => setAba(a.id)}
            style={{ padding: '7px 18px', borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 700, background: aba === a.id ? '#fff' : 'none', color: aba === a.id ? '#1A202C' : '#718096', boxShadow: aba === a.id ? '0 1px 4px rgba(0,0,0,0.08)' : 'none' }}>
            {a.label}
          </button>
        ))}
      </div>

      {/* Busca */}
      <div style={{ position: 'relative', marginBottom: 12 }}>
        <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#A0AEC0' }} />
        <input type="text" placeholder="Buscar produtos..." value={busca} onChange={e => setBusca(e.target.value)}
          style={{ width: '100%', padding: '9px 12px 9px 36px', border: '1.5px solid #E2E8F0', borderRadius: 8, fontSize: 14, outline: 'none', boxSizing: 'border-box', background: '#fff' }} />
      </div>

      {/* Lista prontos */}
      {aba === 'prontos' && (
        <div style={{ background: '#fff', border: '1.5px solid #E2E8F0', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1.5px solid #E2E8F0', background: '#F7FAFC' }}>
                <th style={{ padding: '10px 16px', width: 40 }}>
                  <input type="checkbox" checked={selecionados.size === prontos.length && prontos.length > 0} onChange={toggleTodos} />
                </th>
                <th style={TH}>Produto</th>
                <th style={TH}>Categoria ML</th>
                <th style={{ ...TH, textAlign: 'right' }}>Preço</th>
                <th style={{ ...TH, textAlign: 'center' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtrada.slice(0, 300).map((p, i) => {
                const res = resultados[p.id]
                return (
                  <tr key={p.id} style={{ borderBottom: '1px solid #F7FAFC', background: i % 2 === 0 ? '#fff' : '#FAFBFC' }}>
                    <td style={{ padding: '10px 16px' }}><input type="checkbox" checked={selecionados.has(p.id)} onChange={() => toggleProduto(p.id)} /></td>
                    <td style={{ padding: '10px 16px' }}>
                      <p style={{ fontSize: 13, fontWeight: 600, color: '#1A202C' }}>{p.nome}</p>
                      <p style={{ fontSize: 11, color: '#718096', marginTop: 2 }}>{p._cat}</p>
                    </td>
                    <td style={{ padding: '10px 16px' }}><span style={{ fontSize: 12, color: '#4A5568' }}>{p._mapa?.mlCategoryName}</span></td>
                    <td style={{ padding: '10px 16px', textAlign: 'right' }}><span style={{ fontSize: 13, fontWeight: 700 }}>{p.preco ? `R$ ${Number(p.preco).toFixed(2)}` : '—'}</span></td>
                    <td style={{ padding: '10px 16px', textAlign: 'center' }}>
                      {!res && <CheckCircle size={14} color="#48BB78" />}
                      {res?.status === 'enviando' && <Clock size={14} color="#63B3ED" style={{ animation: 'spin 1s linear infinite' }} />}
                      {res?.status === 'ok' && <div><CheckCircle size={14} color="#48BB78" /><span style={{ fontSize: 10, color: '#718096', display: 'block', fontFamily: 'monospace' }}>{res.mlId}</span></div>}
                      {res?.status === 'erro' && (
                        <div style={{ textAlign: 'left', maxWidth: 200 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: '#FC8181', display: 'block' }}>Erro:</span>
                          {res.sugestoes?.map((s, i) => <span key={i} style={{ fontSize: 11, color: '#C53030', display: 'block' }}>• {s}</span>)}
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Lista com problemas — correção rápida */}
      {aba === 'problemas' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtrada.length === 0 && <p style={{ textAlign: 'center', color: '#718096', padding: 40 }}>Nenhum produto com problemas!</p>}
          {filtrada.slice(0, 100).map(p => (
            <div key={p.id} style={{ background: '#fff', border: '1.5px solid #E2E8F0', borderRadius: 12, overflow: 'hidden' }}>
              <button onClick={() => setExpandido(expandido === p.id ? null : p.id)}
                style={{ width: '100%', padding: '14px 16px', background: 'none', border: 'none', textAlign: 'left', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <p style={{ fontSize: 14, fontWeight: 700, color: '#1A202C' }}>{p.nome}</p>
                  <p style={{ fontSize: 12, color: '#FC8181', marginTop: 3 }}>
                    {p._problemas.length} problema{p._problemas.length > 1 ? 's' : ''}: {p._problemas.map(pr => pr.msg).join(' · ')}
                  </p>
                </div>
                {expandido === p.id ? <ChevronUp size={16} color="#718096" /> : <ChevronDown size={16} color="#718096" />}
              </button>

              {expandido === p.id && (
                <div style={{ borderTop: '1px solid #F7FAFC', padding: '14px 16px' }}>
                  <p style={{ fontSize: 12, fontWeight: 700, color: '#D69E2E', marginBottom: 10 }}>Corrija os campos abaixo e salve no Bling:</p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                    {p._problemas.filter(pr => !pr.campo.startsWith('attr_') && pr.campo !== 'categoria' && pr.campo !== 'imagem').map(pr => (
                      <div key={pr.campo}>
                        <label style={{ fontSize: 12, fontWeight: 700, color: '#4A5568', display: 'block', marginBottom: 4 }}>
                          {pr.msg} <span style={{ color: '#FC8181' }}>*</span>
                        </label>
                        {pr.campo === 'descricaoCurta'
                          ? <textarea rows={2} value={editando[p.id]?.[pr.campo] ?? p[pr.campo] ?? ''}
                              onChange={e => setEditando(ed => ({ ...ed, [p.id]: { ...ed[p.id], [pr.campo]: e.target.value } }))}
                              style={{ width: '100%', padding: '7px 10px', border: '1.5px solid #FBD38D', borderRadius: 6, fontSize: 13, outline: 'none', resize: 'vertical', boxSizing: 'border-box' }} />
                          : <input type={pr.campo === 'preco' ? 'number' : 'text'}
                              value={editando[p.id]?.[pr.campo] ?? p[pr.campo] ?? ''}
                              onChange={e => setEditando(ed => ({ ...ed, [p.id]: { ...ed[p.id], [pr.campo]: e.target.value } }))}
                              style={{ width: '100%', padding: '7px 10px', border: '1.5px solid #FBD38D', borderRadius: 6, fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
                        }
                      </div>
                    ))}
                  </div>
                  {p._problemas.some(pr => pr.campo === 'categoria') && (
                    <div style={{ background: 'rgba(99,179,237,0.08)', border: '1px solid rgba(99,179,237,0.3)', borderRadius: 8, padding: '10px 12px', marginBottom: 10, fontSize: 13, color: '#3182CE' }}>
                      ℹ Vá em <strong>Mapeamento</strong> para mapear a categoria "{p._cat}" ao Mercado Livre.
                    </div>
                  )}
                  {p._problemas.some(pr => pr.campo === 'imagem') && (
                    <div style={{ background: 'rgba(252,193,7,0.08)', border: '1px solid rgba(252,193,7,0.3)', borderRadius: 8, padding: '10px 12px', marginBottom: 10, fontSize: 13, color: '#D69E2E' }}>
                      ⚠ Adicione uma imagem ao produto diretamente no Bling e sincronize novamente.
                    </div>
                  )}
                  {editando[p.id] && Object.keys(editando[p.id]).length > 0 && (
                    <button onClick={() => salvarCampo(p)} disabled={salvando[p.id]}
                      style={{ display: 'flex', alignItems: 'center', gap: 7, background: '#1A202C', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 700 }}>
                      <Save size={13} />
                      {salvando[p.id] ? 'Salvando...' : 'Salvar no Bling'}
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

const TH = { padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#718096', textTransform: 'uppercase', letterSpacing: '0.06em' }
