import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getClientes, criarCliente, removerCliente, setClienteAtivo } from '../lib/storage'
import { Plus, Trash2, ArrowRight, Zap } from 'lucide-react'

export default function Home() {
  const navigate = useNavigate()
  const [clientes, setClientes] = useState(getClientes)
  const [novoNome, setNovoNome] = useState('')
  const [criando, setCriando] = useState(false)

  function entrar(id) {
    setClienteAtivo(id)
    navigate('/app/produtos')
  }

  function criar() {
    if (!novoNome.trim()) return
    const c = criarCliente(novoNome.trim())
    setClientes(getClientes())
    setNovoNome('')
    setCriando(false)
    navigate('/auth')
  }

  function remover(id) {
    if (!confirm('Remover este cliente? Todos os dados serão apagados.')) return
    removerCliente(id)
    setClientes(getClientes())
  }

  return (
    <div style={{ minHeight: '100vh', background: '#F4F6F9', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 520 }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 56, height: 56, background: '#1A202C', borderRadius: 16, marginBottom: 16 }}>
            <Zap size={28} color="#63B3ED" />
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: '#1A202C', marginBottom: 8 }}>Bling → ML Automation</h1>
          <p style={{ fontSize: 14, color: '#718096' }}>Publique produtos do Bling no Mercado Livre em segundos</p>
        </div>

        {/* Lista de clientes */}
        {clientes.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: '#718096', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
              Selecionar conta
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {clientes.map(c => (
                <div key={c.id} style={{
                  background: '#fff', border: '1.5px solid #E2E8F0',
                  borderRadius: 12, padding: '14px 16px',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                }}>
                  <div>
                    <p style={{ fontWeight: 700, color: '#1A202C', fontSize: 15 }}>{c.nome}</p>
                    <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: c.bling?.accessToken ? '#48BB78' : '#FC8181' }}>
                        {c.bling?.accessToken ? '● Bling conectado' : '○ Bling desconectado'}
                      </span>
                      <span style={{ fontSize: 11, fontWeight: 600, color: c.ml?.accessToken ? '#48BB78' : '#FC8181' }}>
                        {c.ml?.accessToken ? '● ML conectado' : '○ ML desconectado'}
                      </span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => remover(c.id)}
                      style={{ background: 'none', border: 'none', color: '#CBD5E0', padding: 6, borderRadius: 6, display: 'flex' }}
                      onMouseEnter={e => e.currentTarget.style.color = '#FC8181'}
                      onMouseLeave={e => e.currentTarget.style.color = '#CBD5E0'}>
                      <Trash2 size={15} />
                    </button>
                    <button onClick={() => entrar(c.id)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        background: '#1A202C', color: '#fff', border: 'none',
                        borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 700,
                      }}>
                      Entrar <ArrowRight size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Adicionar cliente */}
        {criando ? (
          <div style={{ background: '#fff', border: '1.5px solid #63B3ED', borderRadius: 12, padding: 20 }}>
            <p style={{ fontSize: 14, fontWeight: 700, color: '#1A202C', marginBottom: 12 }}>Nome do cliente / conta</p>
            <input
              autoFocus
              type="text"
              value={novoNome}
              onChange={e => setNovoNome(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && criar()}
              placeholder="Ex: Loja do João, Cliente ABC..."
              style={{
                width: '100%', padding: '12px 14px', borderRadius: 8,
                border: '1.5px solid #E2E8F0', fontSize: 15, outline: 'none',
                marginBottom: 12, boxSizing: 'border-box',
              }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={criar} disabled={!novoNome.trim()}
                style={{
                  flex: 1, background: novoNome.trim() ? '#1A202C' : '#CBD5E0',
                  color: '#fff', border: 'none', borderRadius: 8,
                  padding: '11px 0', fontSize: 14, fontWeight: 700,
                }}>
                Criar e conectar
              </button>
              <button onClick={() => { setCriando(false); setNovoNome('') }}
                style={{ background: '#F7FAFC', border: '1.5px solid #E2E8F0', borderRadius: 8, padding: '11px 16px', fontSize: 14, color: '#718096' }}>
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setCriando(true)}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              background: '#fff', border: '1.5px dashed #CBD5E0', borderRadius: 12,
              padding: '14px 0', fontSize: 14, fontWeight: 600, color: '#718096',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = '#63B3ED'; e.currentTarget.style.color = '#3182CE' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = '#CBD5E0'; e.currentTarget.style.color = '#718096' }}>
            <Plus size={16} /> Adicionar novo cliente
          </button>
        )}
      </div>
    </div>
  )
}
