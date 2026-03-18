import { useState, useMemo } from 'react'
import { getClienteAtivo, getProdutos, salvarProdutos, atualizarTokensBling } from '../lib/storage'
import { getTodosProdutos, getProdutoDetalhe, refreshToken as blingRefresh } from '../lib/bling'
import { RefreshCw, Search, Package, AlertCircle } from 'lucide-react'

function ensureToken(cliente) {
  if (!cliente.bling?.accessToken) throw new Error('Bling não conectado.')
  return cliente.bling.accessToken
}

async function getTokenValido(cliente) {
  if (!cliente.bling?.accessToken) throw new Error('Bling não conectado. Vá em Configurações → Auth.')
  const expiring = cliente.bling.expiresAt && Date.now() > cliente.bling.expiresAt - 60000
  if (expiring && cliente.bling.refreshToken) {
    const novos = await blingRefresh(cliente.bling.refreshToken)
    atualizarTokensBling(cliente.id, novos)
    return novos.accessToken
  }
  return cliente.bling.accessToken
}

export default function Produtos() {
  const cliente = getClienteAtivo()
  const [produtos, setProdutos] = useState(() => getProdutos(cliente?.id || ''))
  const [sincronizando, setSincronizando] = useState(false)
  const [progresso, setProgresso] = useState(0)
  const [erro, setErro] = useState('')
  const [busca, setBusca] = useState('')
  const [ultimaSync, setUltimaSync] = useState(() => {
    const p = getProdutos(cliente?.id || '')
    return p.length > 0 ? localStorage.getItem(`bml_ultima_sync_${cliente?.id}`) : null
  })

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
      localStorage.setItem(`bml_ultima_sync_${cliente.id}`, new Date().toLocaleString('pt-BR'))
      setProdutos(lista)
      setUltimaSync(new Date().toLocaleString('pt-BR'))
    } catch (e) {
      setErro(e.message || 'Erro ao sincronizar.')
    } finally {
      setSincronizando(false)
    }
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: '#1A202C', marginBottom: 4 }}>Produtos do Bling</h2>
          {ultimaSync && (
            <p style={{ fontSize: 12, color: '#718096' }}>Última sync: {ultimaSync}</p>
          )}
        </div>
        <button
          onClick={sincronizar}
          disabled={sincronizando}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: sincronizando ? '#CBD5E0' : '#1A202C', color: '#fff', border: 'none',
            borderRadius: 8, padding: '10px 20px', fontSize: 13, fontWeight: 700,
          }}>
          <RefreshCw size={14} style={sincronizando ? { animation: 'spin 1s linear infinite' } : {}} />
          {sincronizando ? `Sincronizando... ${progresso}` : 'Sincronizar Bling'}
        </button>
      </div>

      {erro && (
        <div style={{
          background: 'rgba(252,129,74,0.1)', border: '1px solid #FC8181', borderRadius: 10,
          padding: '12px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <AlertCircle size={16} color="#FC8181" />
          <span style={{ fontSize: 13, color: '#C53030', fontWeight: 600 }}>{erro}</span>
        </div>
      )}

      {/* Stats */}
      {produtos.length > 0 && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
          <div style={{ background: '#fff', border: '1.5px solid #E2E8F0', borderRadius: 10, padding: '12px 20px' }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: '#718096', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Total</p>
            <p style={{ fontSize: 24, fontWeight: 800, color: '#1A202C', marginTop: 4 }}>{produtos.length}</p>
          </div>
          <div style={{ background: '#fff', border: '1.5px solid #E2E8F0', borderRadius: 10, padding: '12px 20px' }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: '#718096', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Com estoque</p>
            <p style={{ fontSize: 24, fontWeight: 800, color: '#1A202C', marginTop: 4 }}>
              {produtos.filter(p => (p.estoque?.saldoVirtualTotal || 0) > 0).length}
            </p>
          </div>
          <div style={{ background: '#fff', border: '1.5px solid #E2E8F0', borderRadius: 10, padding: '12px 20px' }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: '#718096', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Filtrados</p>
            <p style={{ fontSize: 24, fontWeight: 800, color: '#1A202C', marginTop: 4 }}>{produtosFiltrados.length}</p>
          </div>
        </div>
      )}

      {/* Busca */}
      {produtos.length > 0 && (
        <div style={{ position: 'relative', marginBottom: 16 }}>
          <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#A0AEC0' }} />
          <input
            type="text"
            placeholder="Buscar por nome, código ou ID..."
            value={busca}
            onChange={e => setBusca(e.target.value)}
            style={{
              width: '100%', padding: '10px 12px 10px 36px',
              border: '1.5px solid #E2E8F0', borderRadius: 8,
              fontSize: 14, outline: 'none', boxSizing: 'border-box', background: '#fff',
            }}
          />
        </div>
      )}

      {/* Lista */}
      {produtos.length === 0 && !sincronizando ? (
        <div style={{
          background: '#fff', border: '1.5px dashed #CBD5E0', borderRadius: 14,
          padding: '48px 24px', textAlign: 'center',
        }}>
          <Package size={40} color="#CBD5E0" style={{ marginBottom: 16 }} />
          <p style={{ fontWeight: 700, color: '#A0AEC0', fontSize: 16 }}>Nenhum produto sincronizado</p>
          <p style={{ fontSize: 13, color: '#CBD5E0', marginTop: 6 }}>Clique em "Sincronizar Bling" para buscar seus produtos</p>
        </div>
      ) : (
        <div style={{ background: '#fff', border: '1.5px solid #E2E8F0', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1.5px solid #E2E8F0', background: '#F7FAFC' }}>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#718096', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Produto</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#718096', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Código</th>
                <th style={{ padding: '10px 16px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: '#718096', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Preço</th>
                <th style={{ padding: '10px 16px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: '#718096', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Estoque</th>
              </tr>
            </thead>
            <tbody>
              {produtosFiltrados.slice(0, 200).map((p, i) => (
                <tr key={p.id} style={{ borderBottom: '1px solid #F7FAFC', background: i % 2 === 0 ? '#fff' : '#FAFBFC' }}>
                  <td style={{ padding: '10px 16px' }}>
                    <p style={{ fontSize: 13, fontWeight: 600, color: '#1A202C' }}>{p.nome}</p>
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
                    <span style={{
                      fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                      background: (p.estoque?.saldoVirtualTotal || 0) > 0 ? 'rgba(72,187,120,0.1)' : 'rgba(252,129,74,0.1)',
                      color: (p.estoque?.saldoVirtualTotal || 0) > 0 ? '#48BB78' : '#FC8181',
                    }}>
                      {p.estoque?.saldoVirtualTotal ?? 0}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {produtosFiltrados.length > 200 && (
            <p style={{ textAlign: 'center', padding: 12, fontSize: 12, color: '#718096' }}>
              Exibindo 200 de {produtosFiltrados.length} produtos. Use a busca para filtrar.
            </p>
          )}
        </div>
      )}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
