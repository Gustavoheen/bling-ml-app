import { useState, useMemo } from 'react'
import { getClienteAtivo, getHistorico } from '../lib/storage'
import { CheckCircle, XCircle, History, Trash2 } from 'lucide-react'

export default function Historico() {
  const cliente = getClienteAtivo()
  const [historico, setHistorico] = useState(() => getHistorico(cliente?.id || ''))
  const [filtro, setFiltro] = useState('todos') // todos | ok | erro

  const filtrado = useMemo(() => {
    if (filtro === 'ok') return historico.filter(h => h.status === 'ok')
    if (filtro === 'erro') return historico.filter(h => h.status === 'erro')
    return historico
  }, [historico, filtro])

  function limpar() {
    if (!confirm('Limpar todo o histórico?')) return
    localStorage.removeItem(`bml_historico_${cliente?.id}`)
    setHistorico([])
  }

  const okCount = historico.filter(h => h.status === 'ok').length
  const erroCount = historico.filter(h => h.status === 'erro').length

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: '#1A202C', marginBottom: 4 }}>Histórico de Exportações</h2>
          <p style={{ fontSize: 13, color: '#718096' }}>{historico.length} registro{historico.length !== 1 ? 's' : ''}</p>
        </div>
        {historico.length > 0 && (
          <button onClick={limpar}
            style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: '1.5px solid #E2E8F0', borderRadius: 8, padding: '8px 14px', fontSize: 13, color: '#718096', fontWeight: 600 }}>
            <Trash2 size={13} /> Limpar
          </button>
        )}
      </div>

      {/* Stats */}
      {historico.length > 0 && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
          <div style={{ background: 'rgba(72,187,120,0.08)', border: '1.5px solid rgba(72,187,120,0.3)', borderRadius: 10, padding: '12px 20px' }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: '#48BB78', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Publicados</p>
            <p style={{ fontSize: 28, fontWeight: 800, color: '#48BB78', marginTop: 4 }}>{okCount}</p>
          </div>
          <div style={{ background: 'rgba(252,129,74,0.08)', border: '1.5px solid rgba(252,129,74,0.3)', borderRadius: 10, padding: '12px 20px' }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: '#FC8181', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Com erro</p>
            <p style={{ fontSize: 28, fontWeight: 800, color: '#FC8181', marginTop: 4 }}>{erroCount}</p>
          </div>
        </div>
      )}

      {/* Filtros */}
      {historico.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {['todos', 'ok', 'erro'].map(f => (
            <button key={f} onClick={() => setFiltro(f)}
              style={{
                padding: '6px 16px', borderRadius: 20, fontSize: 13, fontWeight: 600,
                border: `1.5px solid ${filtro === f ? '#1A202C' : '#E2E8F0'}`,
                background: filtro === f ? '#1A202C' : '#fff',
                color: filtro === f ? '#fff' : '#718096',
              }}>
              {f === 'todos' ? 'Todos' : f === 'ok' ? 'Publicados' : 'Com erro'}
            </button>
          ))}
        </div>
      )}

      {historico.length === 0 ? (
        <div style={{ background: '#fff', border: '1.5px dashed #CBD5E0', borderRadius: 14, padding: '48px 24px', textAlign: 'center' }}>
          <History size={40} color="#CBD5E0" style={{ marginBottom: 16 }} />
          <p style={{ fontWeight: 700, color: '#A0AEC0', fontSize: 16 }}>Nenhuma exportação realizada</p>
          <p style={{ fontSize: 13, color: '#CBD5E0', marginTop: 6 }}>O histórico aparece depois que você publicar produtos.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtrado.map(h => (
            <div key={h.id} style={{
              background: '#fff', borderRadius: 10,
              border: `1.5px solid ${h.status === 'ok' ? 'rgba(72,187,120,0.2)' : 'rgba(252,129,74,0.2)'}`,
              padding: '12px 16px', display: 'flex', alignItems: 'flex-start', gap: 12,
            }}>
              {h.status === 'ok'
                ? <CheckCircle size={18} color="#48BB78" style={{ flexShrink: 0, marginTop: 2 }} />
                : <XCircle size={18} color="#FC8181" style={{ flexShrink: 0, marginTop: 2 }} />}
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <p style={{ fontSize: 14, fontWeight: 700, color: '#1A202C' }}>{h.produtoNome}</p>
                  <span style={{ fontSize: 11, color: '#A0AEC0' }}>
                    {new Date(h.criadoEm).toLocaleString('pt-BR')}
                  </span>
                </div>
                {h.mlId && (
                  <p style={{ fontSize: 12, color: '#718096', marginTop: 3 }}>
                    ID ML: <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{h.mlId}</span>
                  </p>
                )}
                {h.erro && (
                  <p style={{ fontSize: 12, color: '#FC8181', marginTop: 3 }}>{h.erro}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
