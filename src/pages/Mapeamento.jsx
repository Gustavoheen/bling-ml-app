import { useState, useEffect } from 'react'
import { getClienteAtivo, getProdutos, getMapeamentos, salvarMapeamentos } from '../lib/storage'
import { buscarCategorias, getAtributosCategoria } from '../lib/ml'
import { Search, CheckCircle, Circle, ChevronDown, ChevronUp, AlertCircle, GitMerge } from 'lucide-react'

// Agrupa produtos por categoria Bling
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
  const cliente = getClienteAtivo()
  const produtos = getProdutos(cliente?.id || '')
  const [mapeamentos, setMapeamentos] = useState(() => {
    const m = getMapeamentos(cliente?.id || '')
    // Converte array para mapa { categoriaBling: { mlCategoryId, mlCategoryName, atributos } }
    if (Array.isArray(m)) {
      const obj = {}
      for (const item of m) obj[item.categoriaBling] = item
      return obj
    }
    return m || {}
  })

  const grupos = agruparPorCategoria(produtos)
  const categoriasBling = Object.keys(grupos).sort()

  const [expandido, setExpandido] = useState(null)
  const [buscaML, setBuscaML] = useState({})
  const [resultados, setResultados] = useState({})
  const [buscando, setBuscando] = useState({})
  const [atributos, setAtributos] = useState({})

  function salvar(novo) {
    setMapeamentos(novo)
    const arr = Object.values(novo)
    salvarMapeamentos(cliente.id, arr)
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
    // Busca atributos obrigatórios
    let attrs = []
    try {
      attrs = await getAtributosCategoria(categoria.category_id)
    } catch { }
    setAtributos(a => ({ ...a, [catBling]: attrs }))

    const novo = {
      ...mapeamentos,
      [catBling]: {
        categoriaBling: catBling,
        mlCategoryId: categoria.category_id,
        mlCategoryName: categoria.category_name || categoria.domain_name,
        atributos: attrs.map(a => ({ id: a.id, name: a.name, valor: '' })),
      },
    }
    salvar(novo)
    setResultados(r => ({ ...r, [catBling]: [] }))
    setBuscaML(b => ({ ...b, [catBling]: '' }))
  }

  function atualizarAtributo(catBling, atributoId, valor) {
    const m = mapeamentos[catBling]
    if (!m) return
    const novosAtrs = m.atributos.map(a => a.id === atributoId ? { ...a, valor } : a)
    const novo = { ...mapeamentos, [catBling]: { ...m, atributos: novosAtrs } }
    salvar(novo)
  }

  function removerMapeamento(catBling) {
    const novo = { ...mapeamentos }
    delete novo[catBling]
    salvar(novo)
  }

  const totalMapeadas = categoriasBling.filter(c => mapeamentos[c]?.mlCategoryId).length

  if (produtos.length === 0) {
    return (
      <div>
        <h2 style={{ fontSize: 20, fontWeight: 800, color: '#1A202C', marginBottom: 24 }}>Mapeamento de Categorias</h2>
        <div style={{ background: '#fff', border: '1.5px dashed #CBD5E0', borderRadius: 14, padding: '48px 24px', textAlign: 'center' }}>
          <GitMerge size={40} color="#CBD5E0" style={{ marginBottom: 16 }} />
          <p style={{ fontWeight: 700, color: '#A0AEC0', fontSize: 16 }}>Sem produtos para mapear</p>
          <p style={{ fontSize: 13, color: '#CBD5E0', marginTop: 6 }}>Sincronize produtos na aba "Produtos" primeiro.</p>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: '#1A202C', marginBottom: 4 }}>Mapeamento de Categorias</h2>
          <p style={{ fontSize: 13, color: '#718096' }}>
            {totalMapeadas}/{categoriasBling.length} categorias mapeadas
          </p>
        </div>
        <div style={{
          background: totalMapeadas === categoriasBling.length ? 'rgba(72,187,120,0.1)' : 'rgba(252,193,7,0.1)',
          color: totalMapeadas === categoriasBling.length ? '#48BB78' : '#D69E2E',
          borderRadius: 20, padding: '6px 14px', fontSize: 12, fontWeight: 700,
        }}>
          {totalMapeadas === categoriasBling.length ? '✓ Todas mapeadas' : `${categoriasBling.length - totalMapeadas} pendentes`}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {categoriasBling.map(cat => {
          const mapeada = mapeamentos[cat]
          const aberto = expandido === cat

          return (
            <div key={cat} style={{
              background: '#fff', border: `1.5px solid ${mapeada ? '#48BB78' : '#E2E8F0'}`,
              borderRadius: 12, overflow: 'hidden',
            }}>
              {/* Cabeçalho */}
              <button
                onClick={() => setExpandido(aberto ? null : cat)}
                style={{
                  width: '100%', padding: '14px 16px',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  background: 'none', border: 'none', textAlign: 'left',
                }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {mapeada
                    ? <CheckCircle size={16} color="#48BB78" />
                    : <Circle size={16} color="#CBD5E0" />}
                  <div>
                    <p style={{ fontSize: 14, fontWeight: 700, color: '#1A202C' }}>{cat}</p>
                    <p style={{ fontSize: 12, color: '#718096', marginTop: 2 }}>
                      {grupos[cat].length} produto{grupos[cat].length > 1 ? 's' : ''}
                      {mapeada ? ` → ${mapeada.mlCategoryName}` : ' — sem mapeamento'}
                    </p>
                  </div>
                </div>
                {aberto ? <ChevronUp size={16} color="#718096" /> : <ChevronDown size={16} color="#718096" />}
              </button>

              {/* Conteúdo expandido */}
              {aberto && (
                <div style={{ borderTop: '1px solid #F7FAFC', padding: '16px' }}>
                  {/* Busca ML */}
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
                      style={{
                        flex: 1, padding: '9px 12px', border: '1.5px solid #E2E8F0',
                        borderRadius: 8, fontSize: 13, outline: 'none',
                      }}
                    />
                    <button
                      onClick={() => buscar(cat, buscaML[cat] || cat)}
                      disabled={buscando[cat]}
                      style={{
                        background: '#1A202C', color: '#fff', border: 'none',
                        borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 700,
                        display: 'flex', alignItems: 'center', gap: 6,
                      }}>
                      <Search size={13} />
                      {buscando[cat] ? '...' : 'Buscar'}
                    </button>
                  </div>

                  {/* Resultados */}
                  {(resultados[cat] || []).length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                      {resultados[cat].map(r => (
                        <button
                          key={r.category_id}
                          onClick={() => selecionar(cat, r)}
                          style={{
                            padding: '10px 14px', background: '#F7FAFC',
                            border: '1.5px solid #E2E8F0', borderRadius: 8,
                            textAlign: 'left', fontSize: 13,
                          }}
                          onMouseEnter={e => { e.currentTarget.style.borderColor = '#63B3ED'; e.currentTarget.style.background = 'rgba(99,179,237,0.05)' }}
                          onMouseLeave={e => { e.currentTarget.style.borderColor = '#E2E8F0'; e.currentTarget.style.background = '#F7FAFC' }}>
                          <span style={{ fontWeight: 700, color: '#1A202C' }}>{r.domain_name}</span>
                          <span style={{ color: '#718096', marginLeft: 8, fontSize: 11 }}>{r.category_id}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Mapeamento atual */}
                  {mapeada && (
                    <div style={{ background: 'rgba(72,187,120,0.06)', border: '1px solid rgba(72,187,120,0.2)', borderRadius: 10, padding: '12px 14px', marginBottom: mapeada.atributos?.length ? 14 : 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div>
                          <p style={{ fontSize: 12, fontWeight: 700, color: '#48BB78', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Mapeado para</p>
                          <p style={{ fontSize: 14, fontWeight: 700, color: '#1A202C', marginTop: 2 }}>{mapeada.mlCategoryName}</p>
                          <p style={{ fontSize: 11, color: '#718096', fontFamily: 'monospace' }}>{mapeada.mlCategoryId}</p>
                        </div>
                        <button onClick={() => removerMapeamento(cat)}
                          style={{ background: 'none', border: 'none', color: '#FC8181', fontSize: 12, fontWeight: 600 }}>
                          Remover
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Atributos obrigatórios */}
                  {mapeada?.atributos?.length > 0 && (
                    <div style={{ marginTop: 14 }}>
                      <p style={{ fontSize: 12, fontWeight: 700, color: '#718096', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                        Atributos obrigatórios
                      </p>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {mapeada.atributos.map(a => (
                          <div key={a.id}>
                            <label style={{ fontSize: 12, fontWeight: 600, color: '#4A5568', display: 'block', marginBottom: 4 }}>
                              {a.name} <span style={{ color: '#FC8181' }}>*</span>
                            </label>
                            <input
                              type="text"
                              value={a.valor || ''}
                              onChange={e => atualizarAtributo(cat, a.id, e.target.value)}
                              placeholder={`Valor para ${a.name}`}
                              style={{
                                width: '100%', padding: '8px 10px',
                                border: `1.5px solid ${a.valor ? '#48BB78' : '#E2E8F0'}`,
                                borderRadius: 6, fontSize: 13, outline: 'none', boxSizing: 'border-box',
                              }}
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
    </div>
  )
}
