import { useState, useMemo } from 'react'
import {
  getClienteAtivo, getProdutos, getMapeamentos,
  atualizarTokensML, adicionarHistorico
} from '../lib/storage'
import {
  publicarProduto, blingParaMLPayload, getProduto as getMLProduto,
  atualizarProduto, refreshToken as mlRefresh
} from '../lib/ml'
import { refreshToken as blingRefresh } from '../lib/bling'
import { getProdutoDetalhe } from '../lib/bling'
import { atualizarTokensBling } from '../lib/storage'
import { Upload, CheckCircle, XCircle, Clock, AlertCircle, Search } from 'lucide-react'

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

export default function Exportacao() {
  const cliente = getClienteAtivo()
  const produtos = getProdutos(cliente?.id || '')
  const mapeamentosArr = getMapeamentos(cliente?.id || '')

  // Constrói mapa de categoria Bling → dados ML
  const mapeamentos = useMemo(() => {
    const m = {}
    for (const item of (Array.isArray(mapeamentosArr) ? mapeamentosArr : [])) {
      m[item.categoriaBling] = item
    }
    return m
  }, [mapeamentosArr])

  // Produtos que têm categoria mapeada
  const produtosExportaveis = useMemo(() =>
    produtos.filter(p => {
      const cat = p.categoria?.nome || 'Sem categoria'
      return !!mapeamentos[cat]?.mlCategoryId
    }), [produtos, mapeamentos])

  const [selecionados, setSelecionados] = useState(new Set())
  const [resultados, setResultados] = useState({}) // { produtoId: { status: 'ok'|'erro'|'enviando', mlId?, msg? } }
  const [exportando, setExportando] = useState(false)
  const [busca, setBusca] = useState('')

  const filtrados = useMemo(() => {
    if (!busca.trim()) return produtosExportaveis
    const q = busca.toLowerCase()
    return produtosExportaveis.filter(p => p.nome?.toLowerCase().includes(q) || p.codigo?.toLowerCase().includes(q))
  }, [produtosExportaveis, busca])

  function toggleTodos() {
    if (selecionados.size === filtrados.length) {
      setSelecionados(new Set())
    } else {
      setSelecionados(new Set(filtrados.map(p => p.id)))
    }
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
    const token = await getMLToken(getClienteAtivo()).catch(e => { alert(e.message); setExportando(false); return null })
    if (!token) return

    const lista = filtrados.filter(p => selecionados.has(p.id))

    for (const produto of lista) {
      setResultados(r => ({ ...r, [produto.id]: { status: 'enviando' } }))
      try {
        const cat = produto.categoria?.nome || 'Sem categoria'
        const mapa = mapeamentos[cat]
        const payload = blingParaMLPayload(produto, mapa.mlCategoryId, mapa.atributos || [])
        const resp = await publicarProduto(token, payload)
        setResultados(r => ({ ...r, [produto.id]: { status: 'ok', mlId: resp.id } }))
        adicionarHistorico(cliente.id, {
          tipo: 'publicar',
          produtoId: produto.id,
          produtoNome: produto.nome,
          mlId: resp.id,
          status: 'ok',
        })
      } catch (e) {
        setResultados(r => ({ ...r, [produto.id]: { status: 'erro', msg: e.message } }))
        adicionarHistorico(cliente.id, {
          tipo: 'publicar',
          produtoId: produto.id,
          produtoNome: produto.nome,
          status: 'erro',
          erro: e.message,
        })
      }
      // Rate limit: 500ms entre cada
      await new Promise(r => setTimeout(r, 500))
    }
    setExportando(false)
  }

  const okCount = Object.values(resultados).filter(r => r.status === 'ok').length
  const erroCount = Object.values(resultados).filter(r => r.status === 'erro').length

  if (produtosExportaveis.length === 0) {
    return (
      <div>
        <h2 style={{ fontSize: 20, fontWeight: 800, color: '#1A202C', marginBottom: 24 }}>Exportação para ML</h2>
        <div style={{ background: '#fff', border: '1.5px dashed #CBD5E0', borderRadius: 14, padding: '48px 24px', textAlign: 'center' }}>
          <Upload size={40} color="#CBD5E0" style={{ marginBottom: 16 }} />
          <p style={{ fontWeight: 700, color: '#A0AEC0', fontSize: 16 }}>Nenhum produto pronto para exportar</p>
          <p style={{ fontSize: 13, color: '#CBD5E0', marginTop: 6 }}>
            {produtos.length === 0
              ? 'Sincronize produtos primeiro na aba "Produtos".'
              : 'Mapeie as categorias Bling → ML na aba "Mapeamento".'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: '#1A202C', marginBottom: 4 }}>Exportação para ML</h2>
          <p style={{ fontSize: 13, color: '#718096' }}>
            {produtosExportaveis.length} produto{produtosExportaveis.length > 1 ? 's' : ''} prontos para publicar
          </p>
        </div>
        <button
          onClick={exportar}
          disabled={selecionados.size === 0 || exportando}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: selecionados.size > 0 && !exportando ? '#1A202C' : '#CBD5E0',
            color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: 13, fontWeight: 700,
          }}>
          <Upload size={14} />
          {exportando ? 'Publicando...' : `Publicar ${selecionados.size > 0 ? `(${selecionados.size})` : ''}`}
        </button>
      </div>

      {/* Resumo resultados */}
      {(okCount > 0 || erroCount > 0) && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
          {okCount > 0 && (
            <div style={{ background: 'rgba(72,187,120,0.1)', border: '1px solid #48BB78', borderRadius: 10, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <CheckCircle size={16} color="#48BB78" />
              <span style={{ fontSize: 13, fontWeight: 700, color: '#48BB78' }}>{okCount} publicado{okCount > 1 ? 's' : ''}</span>
            </div>
          )}
          {erroCount > 0 && (
            <div style={{ background: 'rgba(252,129,74,0.1)', border: '1px solid #FC8181', borderRadius: 10, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <XCircle size={16} color="#FC8181" />
              <span style={{ fontSize: 13, fontWeight: 700, color: '#FC8181' }}>{erroCount} com erro{erroCount > 1 ? 's' : ''}</span>
            </div>
          )}
        </div>
      )}

      {/* Busca */}
      <div style={{ position: 'relative', marginBottom: 12 }}>
        <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#A0AEC0' }} />
        <input
          type="text"
          placeholder="Buscar produtos..."
          value={busca}
          onChange={e => setBusca(e.target.value)}
          style={{ width: '100%', padding: '9px 12px 9px 36px', border: '1.5px solid #E2E8F0', borderRadius: 8, fontSize: 14, outline: 'none', boxSizing: 'border-box', background: '#fff' }}
        />
      </div>

      {/* Tabela */}
      <div style={{ background: '#fff', border: '1.5px solid #E2E8F0', borderRadius: 12, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1.5px solid #E2E8F0', background: '#F7FAFC' }}>
              <th style={{ padding: '10px 16px', textAlign: 'left', width: 40 }}>
                <input type="checkbox"
                  checked={selecionados.size === filtrados.length && filtrados.length > 0}
                  onChange={toggleTodos} />
              </th>
              <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#718096', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Produto</th>
              <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#718096', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Categoria ML</th>
              <th style={{ padding: '10px 16px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: '#718096', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Preço</th>
              <th style={{ padding: '10px 16px', textAlign: 'center', fontSize: 11, fontWeight: 700, color: '#718096', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {filtrados.slice(0, 200).map((p, i) => {
              const cat = p.categoria?.nome || 'Sem categoria'
              const mapa = mapeamentos[cat]
              const res = resultados[p.id]
              return (
                <tr key={p.id} style={{ borderBottom: '1px solid #F7FAFC', background: i % 2 === 0 ? '#fff' : '#FAFBFC' }}>
                  <td style={{ padding: '10px 16px' }}>
                    <input type="checkbox" checked={selecionados.has(p.id)} onChange={() => toggleProduto(p.id)} />
                  </td>
                  <td style={{ padding: '10px 16px' }}>
                    <p style={{ fontSize: 13, fontWeight: 600, color: '#1A202C' }}>{p.nome}</p>
                    <p style={{ fontSize: 11, color: '#718096', marginTop: 2 }}>{cat}</p>
                  </td>
                  <td style={{ padding: '10px 16px' }}>
                    <span style={{ fontSize: 12, color: '#4A5568' }}>{mapa?.mlCategoryName || '—'}</span>
                  </td>
                  <td style={{ padding: '10px 16px', textAlign: 'right' }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#1A202C' }}>
                      {p.preco ? `R$ ${Number(p.preco).toFixed(2)}` : '—'}
                    </span>
                  </td>
                  <td style={{ padding: '10px 16px', textAlign: 'center' }}>
                    {!res && <span style={{ fontSize: 12, color: '#CBD5E0' }}>—</span>}
                    {res?.status === 'enviando' && <Clock size={15} color="#63B3ED" style={{ animation: 'spin 1s linear infinite' }} />}
                    {res?.status === 'ok' && (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <CheckCircle size={15} color="#48BB78" />
                        {res.mlId && <span style={{ fontSize: 10, color: '#718096', fontFamily: 'monospace', marginTop: 2 }}>{res.mlId}</span>}
                      </div>
                    )}
                    {res?.status === 'erro' && (
                      <div title={res.msg}>
                        <XCircle size={15} color="#FC8181" />
                        <span style={{ fontSize: 10, color: '#FC8181', display: 'block', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {res.msg}
                        </span>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
