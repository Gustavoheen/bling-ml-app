import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { getClienteAtivo, getProdutos, getMapeamentos, salvarMapeamentos } from '../lib/storage'
import { buscarCategorias, getAtributosCategoria } from '../lib/ml'
import { buscarOuCriarCategoria } from '../lib/bling'
import { Search, CheckCircle, Circle, ChevronDown, ChevronUp, GitMerge, ArrowRight, Loader, Zap, RefreshCw } from 'lucide-react'

function agruparPorCategoria(produtos) {
  const mapa = {}
  for (const p of produtos) {
    const cat = p.categoria?.nome || 'Sem categoria'
    if (!mapa[cat]) mapa[cat] = []
    mapa[cat].push(p)
  }
  return mapa
}

export default function Mapeamento() {
  const navigate = useNavigate()
  const cliente = getClienteAtivo()
  const produtos = getProdutos(cliente?.id || '')

  const [mapeamentos, setMapeamentos] = useState(() => {
    const m = getMapeamentos(cliente?.id || '')
    const obj = {}
    for (const item of (Array.isArray(m) ? m : [])) obj[item.categoriaBling] = item
    return obj
  })

  const grupos = useMemo(() => agruparPorCategoria(produtos), [produtos])
  const categoriasBling = Object.keys(grupos).sort()
  const totalMapeadas = categoriasBling.filter(c => mapeamentos[c]?.mlCategoryId).length
  const totalProdutos = categoriasBling.filter(c => mapeamentos[c]?.mlCategoryId)
    .reduce((acc, c) => acc + grupos[c].length, 0)

  const [expandido, setExpandido] = useState(null)
  const [buscaML, setBuscaML] = useState({})
  const [resultados, setResultados] = useState({})
  const [buscando, setBuscando] = useState({})
  const [carregandoAttrs, setCarregandoAttrs] = useState({})

  function salvar(novo) {
    setMapeamentos(novo)
    salvarMapeamentos(cliente.id, Object.values(novo))
  }

  async function buscar(catBling, query) {
    if (!query.trim()) return
    setBuscando(b => ({ ...b, [catBling]: true }))
    try {
      const res = await buscarCategorias(query)
      setResultados(r => ({ ...r, [catBling]: res }))
    } catch {
      setResultados(r => ({ ...r, [catBling]: [] }))
    } finally {
      setBuscando(b => ({ ...b, [catBling]: false }))
    }
  }

  async function selecionar(catBling, categoria) {
    setCarregandoAttrs(a => ({ ...a, [catBling]: true }))
    let attrs = []
    try { attrs = await getAtributosCategoria(categoria.category_id) } catch {}
    setCarregandoAttrs(a => ({ ...a, [catBling]: false }))

    const novo = {
      ...mapeamentos,
      [catBling]: {
        categoriaBling: catBling,
        mlCategoryId: categoria.category_id,
        mlCategoryName: categoria.domain_name || categoria.category_name,
        atributos: attrs.map(a => ({ id: a.id, name: a.name, valor: '' })),
      },
    }
    salvar(novo)
    setResultados(r => ({ ...r, [catBling]: [] }))
    setBuscaML(b => ({ ...b, [catBling]: '' }))
    if (attrs.length > 0) setExpandido(catBling)
  }

  function atualizarAtributo(catBling, atributoId, valor) {
    const m = mapeamentos[catBling]
    if (!m) return
    const novosAtrs = m.atributos.map(a => a.id === atributoId ? { ...a, valor } : a)
    salvar({ ...mapeamentos, [catBling]: { ...m, atributos: novosAtrs } })
  }

  function remover(catBling) {
    const novo = { ...mapeamentos }
    delete novo[catBling]
    salvar(novo)
  }

  // ─── Auto-mapeamento ML ───────────────────────────────────────
  const [autoMapeando, setAutoMapeando] = useState(false)
  const [autoLog, setAutoLog] = useState([])

  async function autoMapearTudo() {
    setAutoMapeando(true)
    setAutoLog([])
    const novoMapa = { ...mapeamentos }

    for (const cat of categoriasBling) {
      if (novoMapa[cat]?.mlCategoryId) {
        setAutoLog(l => [...l, { cat, status: 'pulado', msg: 'Já mapeada' }])
        continue
      }
      setAutoLog(l => [...l, { cat, status: 'buscando', msg: 'Buscando no ML...' }])
      try {
        const res = await buscarCategorias(cat)
        if (!res || res.length === 0) {
          setAutoLog(l => l.map(i => i.cat === cat ? { ...i, status: 'erro', msg: 'Nenhuma categoria encontrada' } : i))
          continue
        }
        const melhor = res[0]
        let attrs = []
        try { attrs = await getAtributosCategoria(melhor.category_id) } catch {}

        novoMapa[cat] = {
          categoriaBling: cat,
          mlCategoryId: melhor.category_id,
          mlCategoryName: melhor.domain_name || melhor.category_name,
          atributos: attrs.map(a => ({ id: a.id, name: a.name, valor: '' })),
        }
        setAutoLog(l => l.map(i => i.cat === cat
          ? { ...i, status: 'ok', msg: `→ ${melhor.domain_name || melhor.category_name}` }
          : i))
      } catch (err) {
        setAutoLog(l => l.map(i => i.cat === cat ? { ...i, status: 'erro', msg: err.message || 'Erro na busca' } : i))
      }
      await new Promise(r => setTimeout(r, 250))
    }

    salvar(novoMapa)
    setAutoMapeando(false)
  }

  // ─── Sincronizar categorias no Bling ─────────────────────────
  const [sincBling, setSincBling] = useState(false)
  const [sincLog, setSincLog] = useState([])

  async function sincronizarCategoriasNoBling() {
    if (!cliente?.bling?.accessToken) {
      alert('Conecte o Bling primeiro.')
      return
    }
    setSincBling(true)
    setSincLog([])
    for (const cat of categoriasBling) {
      if (cat === 'Sem categoria') continue
      setSincLog(l => [...l, { cat, status: 'buscando', msg: 'Verificando no Bling...' }])
      try {
        const id = await buscarOuCriarCategoria(cliente.bling.accessToken, cat)
        setSincLog(l => l.map(i => i.cat === cat ? { ...i, status: 'ok', msg: `ID ${id}` } : i))
      } catch (err) {
        setSincLog(l => l.map(i => i.cat === cat ? { ...i, status: 'erro', msg: err.message } : i))
      }
      await new Promise(r => setTimeout(r, 200))
    }
    setSincBling(false)
  }

  if (produtos.length === 0) {
    return (
      <div>
        <h2 style={{ fontSize: 20, fontWeight: 800, color: '#1A202C', marginBottom: 24 }}>Mapeamento de Categorias</h2>
        <div style={{ background: '#fff', border: '1.5px dashed #CBD5E0', borderRadius: 14, padding: '48px 24px', textAlign: 'center' }}>
          <GitMerge size={40} color="#CBD5E0" style={{ marginBottom: 16 }} />
          <p style={{ fontWeight: 700, color: '#A0AEC0' }}>Sincronize produtos primeiro na aba "Produtos".</p>
        </div>
      </div>
    )
  }

  const todasMapeadas = totalMapeadas === categoriasBling.length

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: '#1A202C', marginBottom: 4 }}>Mapeamento de Categorias</h2>
          <p style={{ fontSize: 13, color: '#718096' }}>
            {totalMapeadas} de {categoriasBling.length} categorias mapeadas · {totalProdutos} produtos prontos
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={sincronizarCategoriasNoBling} disabled={sincBling}
            style={{ display: 'flex', alignItems: 'center', gap: 7, background: sincBling ? '#CBD5E0' : '#EDF2F7', color: '#4A5568', border: '1.5px solid #E2E8F0', borderRadius: 8, padding: '9px 14px', fontSize: 13, fontWeight: 700, cursor: sincBling ? 'default' : 'pointer' }}>
            {sincBling ? <Loader size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={13} />}
            {sincBling ? 'Sincronizando...' : 'Sincronizar no Bling'}
          </button>
          <button onClick={autoMapearTudo} disabled={autoMapeando}
            style={{ display: 'flex', alignItems: 'center', gap: 7, background: autoMapeando ? '#CBD5E0' : '#3182CE', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 14px', fontSize: 13, fontWeight: 700, cursor: autoMapeando ? 'default' : 'pointer' }}>
            {autoMapeando ? <Loader size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Zap size={13} />}
            {autoMapeando ? 'Mapeando...' : 'Auto-mapear tudo'}
          </button>
          {totalMapeadas > 0 && (
            <button onClick={() => navigate('/app/exportacao')}
              style={{ display: 'flex', alignItems: 'center', gap: 7, background: '#1A202C', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              Exportar {totalProdutos} <ArrowRight size={13} />
            </button>
          )}
        </div>
      </div>

      {/* CTA automação completa */}
      {!todasMapeadas && (
        <div style={{ background: 'linear-gradient(135deg, #1A202C 0%, #2D3748 100%)', borderRadius: 14, padding: '20px 24px', marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <p style={{ fontSize: 15, fontWeight: 800, color: '#fff', marginBottom: 4 }}>Automatizar tudo com 1 clique</p>
            <p style={{ fontSize: 13, color: '#A0AEC0' }}>
              Mapeia {categoriasBling.length - totalMapeadas} categorias no ML automaticamente. Depois publique na aba Exportação.
            </p>
          </div>
          <button onClick={autoMapearTudo} disabled={autoMapeando}
            style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#63B3ED', color: '#1A202C', border: 'none', borderRadius: 10, padding: '12px 24px', fontSize: 14, fontWeight: 800, whiteSpace: 'nowrap', cursor: autoMapeando ? 'default' : 'pointer', opacity: autoMapeando ? 0.7 : 1 }}>
            {autoMapeando ? <Loader size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <Zap size={15} />}
            {autoMapeando ? 'Mapeando...' : '⚡ Mapear tudo automaticamente'}
          </button>
        </div>
      )}

      {/* Progresso geral */}
      <div style={{ background: '#fff', border: '1.5px solid #E2E8F0', borderRadius: 12, padding: '16px 20px', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#1A202C' }}>Progresso do mapeamento</span>
          <span style={{ fontSize: 13, fontWeight: 800, color: todasMapeadas ? '#48BB78' : '#718096' }}>
            {totalMapeadas}/{categoriasBling.length}
          </span>
        </div>
        <div style={{ height: 8, background: '#F7FAFC', borderRadius: 99, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${categoriasBling.length ? (totalMapeadas / categoriasBling.length) * 100 : 0}%`, background: '#48BB78', borderRadius: 99, transition: 'width 0.3s' }} />
        </div>
      </div>

      {/* Log do auto-mapeamento ML */}
      {autoLog.length > 0 && (
        <div style={{ background: '#1A202C', borderRadius: 12, padding: '16px 20px', marginBottom: 20, maxHeight: 200, overflow: 'auto' }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: '#63B3ED', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {autoMapeando ? '⚡ Mapeando automaticamente...' : '✓ Mapeamento concluído'}
          </p>
          {autoLog.map((l, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '3px 0' }}>
              <span style={{ fontSize: 12, color: l.status === 'ok' ? '#48BB78' : l.status === 'erro' ? '#FC8181' : l.status === 'pulado' ? '#718096' : '#63B3ED', flexShrink: 0 }}>
                {l.status === 'ok' ? '✓' : l.status === 'erro' ? '✗' : l.status === 'pulado' ? '–' : '…'}
              </span>
              <span style={{ fontSize: 12, color: '#E2E8F0', fontWeight: 600 }}>{l.cat}</span>
              <span style={{ fontSize: 12, color: '#718096' }}>{l.msg}</span>
            </div>
          ))}
        </div>
      )}

      {/* Log sincronização Bling */}
      {sincLog.length > 0 && (
        <div style={{ background: '#1A202C', borderRadius: 12, padding: '16px 20px', marginBottom: 20, maxHeight: 160, overflow: 'auto' }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: '#68D391', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {sincBling ? 'Sincronizando categorias no Bling...' : '✓ Sincronização Bling concluída'}
          </p>
          {sincLog.map((l, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '3px 0' }}>
              <span style={{ fontSize: 12, color: l.status === 'ok' ? '#48BB78' : l.status === 'erro' ? '#FC8181' : '#63B3ED', flexShrink: 0 }}>
                {l.status === 'ok' ? '✓' : l.status === 'erro' ? '✗' : '…'}
              </span>
              <span style={{ fontSize: 12, color: '#E2E8F0', fontWeight: 600 }}>{l.cat}</span>
              <span style={{ fontSize: 12, color: '#718096' }}>{l.msg}</span>
            </div>
          ))}
        </div>
      )}

      {/* Lista de categorias */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {categoriasBling.map(cat => {
          const mapeada = mapeamentos[cat]
          const aberto = expandido === cat
          const qtd = grupos[cat].length
          const atrsObrigatorios = mapeada?.atributos?.filter(a => !a.valor?.trim()) || []
          const completa = mapeada?.mlCategoryId && atrsObrigatorios.length === 0

          return (
            <div key={cat} style={{
              background: '#fff',
              border: `1.5px solid ${completa ? '#48BB78' : mapeada ? '#FBD38D' : '#E2E8F0'}`,
              borderRadius: 12, overflow: 'hidden',
            }}>
              <button onClick={() => setExpandido(aberto ? null : cat)}
                style={{ width: '100%', padding: '14px 16px', background: 'none', border: 'none', textAlign: 'left', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  {completa
                    ? <CheckCircle size={18} color="#48BB78" />
                    : mapeada
                    ? <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#FBD38D', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: '#744210' }}>!</div>
                    : <Circle size={18} color="#CBD5E0" />}
                  <div>
                    <p style={{ fontSize: 14, fontWeight: 700, color: '#1A202C' }}>{cat}</p>
                    <p style={{ fontSize: 12, color: '#718096', marginTop: 2 }}>
                      {qtd} produto{qtd > 1 ? 's' : ''}
                      {mapeada ? ` → ${mapeada.mlCategoryName}` : ' — clique para mapear'}
                      {mapeada && atrsObrigatorios.length > 0 ? ` · ${atrsObrigatorios.length} atrib. pendente${atrsObrigatorios.length > 1 ? 's' : ''}` : ''}
                    </p>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {mapeada && (
                    <button onClick={e => { e.stopPropagation(); remover(cat) }}
                      style={{ fontSize: 11, color: '#CBD5E0', background: 'none', border: 'none', fontWeight: 600, cursor: 'pointer' }}
                      onMouseEnter={e => e.currentTarget.style.color = '#FC8181'}
                      onMouseLeave={e => e.currentTarget.style.color = '#CBD5E0'}>
                      Remover
                    </button>
                  )}
                  {aberto ? <ChevronUp size={16} color="#718096" /> : <ChevronDown size={16} color="#718096" />}
                </div>
              </button>

              {aberto && (
                <div style={{ borderTop: '1px solid #F7FAFC', padding: 16 }}>
                  <p style={{ fontSize: 12, fontWeight: 700, color: '#718096', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Buscar categoria no Mercado Livre
                  </p>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                    <input
                      type="text"
                      placeholder={`Ex: ${cat}`}
                      value={buscaML[cat] || ''}
                      onChange={e => setBuscaML(b => ({ ...b, [cat]: e.target.value }))}
                      onKeyDown={e => e.key === 'Enter' && buscar(cat, buscaML[cat] || '')}
                      style={{ flex: 1, padding: '9px 12px', border: '1.5px solid #E2E8F0', borderRadius: 8, fontSize: 13, outline: 'none' }}
                    />
                    <button onClick={() => buscar(cat, buscaML[cat] || cat)} disabled={buscando[cat]}
                      style={{ background: '#1A202C', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                      {buscando[cat] ? <Loader size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Search size={13} />}
                      Buscar
                    </button>
                  </div>

                  {(resultados[cat] || []).length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                      {resultados[cat].map(r => (
                        <button key={r.category_id} onClick={() => selecionar(cat, r)}
                          style={{ padding: '10px 14px', background: '#F7FAFC', border: '1.5px solid #E2E8F0', borderRadius: 8, textAlign: 'left', fontSize: 13, cursor: 'pointer' }}
                          onMouseEnter={e => { e.currentTarget.style.borderColor = '#63B3ED'; e.currentTarget.style.background = 'rgba(99,179,237,0.05)' }}
                          onMouseLeave={e => { e.currentTarget.style.borderColor = '#E2E8F0'; e.currentTarget.style.background = '#F7FAFC' }}>
                          <span style={{ fontWeight: 700, color: '#1A202C' }}>{r.domain_name}</span>
                          <span style={{ color: '#718096', marginLeft: 8, fontSize: 11 }}>{r.category_id}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {carregandoAttrs[cat] && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0', color: '#718096', fontSize: 13 }}>
                      <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> Carregando atributos obrigatórios...
                    </div>
                  )}

                  {mapeada && (
                    <div style={{ background: completa ? 'rgba(72,187,120,0.06)' : 'rgba(252,193,7,0.06)', border: `1px solid ${completa ? 'rgba(72,187,120,0.2)' : 'rgba(252,193,7,0.3)'}`, borderRadius: 10, padding: '12px 14px', marginTop: 4 }}>
                      <p style={{ fontSize: 11, fontWeight: 700, color: completa ? '#48BB78' : '#D69E2E', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>
                        {completa ? '✓ Mapeado e completo' : '⚠ Mapeado — preencha os atributos'}
                      </p>
                      <p style={{ fontSize: 14, fontWeight: 700, color: '#1A202C' }}>{mapeada.mlCategoryName}</p>
                      <p style={{ fontSize: 11, color: '#718096', fontFamily: 'monospace' }}>{mapeada.mlCategoryId}</p>
                    </div>
                  )}

                  {mapeada?.atributos?.length > 0 && (
                    <div style={{ marginTop: 14 }}>
                      <p style={{ fontSize: 12, fontWeight: 700, color: '#4A5568', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                        Atributos obrigatórios — aplicados a todos os {qtd} produtos desta categoria
                      </p>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        {mapeada.atributos.map(a => (
                          <div key={a.id}>
                            <label style={{ fontSize: 12, fontWeight: 600, color: '#4A5568', display: 'block', marginBottom: 4 }}>
                              {a.name} <span style={{ color: '#FC8181' }}>*</span>
                            </label>
                            <input
                              type="text"
                              value={a.valor || ''}
                              onChange={e => atualizarAtributo(cat, a.id, e.target.value)}
                              placeholder={`Ex: ${a.name}`}
                              style={{ width: '100%', padding: '8px 10px', border: `1.5px solid ${a.valor ? '#48BB78' : '#FBD38D'}`, borderRadius: 6, fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* CTA final */}
      {totalMapeadas > 0 && (
        <div style={{ marginTop: 24, background: '#1A202C', borderRadius: 14, padding: '20px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <p style={{ fontSize: 15, fontWeight: 800, color: '#fff' }}>{totalProdutos} produtos prontos para publicar</p>
            <p style={{ fontSize: 13, color: '#718096', marginTop: 4 }}>
              {categoriasBling.length - totalMapeadas > 0
                ? `${categoriasBling.length - totalMapeadas} categoria${categoriasBling.length - totalMapeadas > 1 ? 's' : ''} ainda sem mapeamento`
                : 'Todas as categorias mapeadas ✓'}
            </p>
          </div>
          <button onClick={() => navigate('/app/exportacao')}
            style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#63B3ED', color: '#1A202C', border: 'none', borderRadius: 10, padding: '12px 24px', fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>
            Publicar no ML <ArrowRight size={16} />
          </button>
        </div>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
