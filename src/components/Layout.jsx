import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { getClienteAtivo, getClientes, setClienteAtivo } from '../lib/storage'
import { Package, GitMerge, Upload, History, ChevronDown, LogOut } from 'lucide-react'

const NAV = [
  { to: '/app/produtos',    icon: Package,    label: 'Produtos'    },
  { to: '/app/mapeamento',  icon: GitMerge,   label: 'Mapeamento'  },
  { to: '/app/exportacao',  icon: Upload,     label: 'Exportação'  },
  { to: '/app/historico',   icon: History,    label: 'Histórico'   },
]

export default function Layout() {
  const navigate = useNavigate()
  const [menuAberto, setMenuAberto] = useState(false)
  const cliente = getClienteAtivo()
  const clientes = getClientes()

  function trocarCliente(id) {
    setClienteAtivo(id)
    setMenuAberto(false)
    window.location.reload()
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {/* Sidebar */}
      <aside style={{
        width: 220, background: '#1A202C', display: 'flex',
        flexDirection: 'column', padding: '24px 0', flexShrink: 0,
      }}>
        {/* Logo */}
        <div style={{ padding: '0 20px 24px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <p style={{ fontSize: 13, fontWeight: 800, color: '#fff', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Bling → ML
          </p>
          <p style={{ fontSize: 11, color: '#718096', marginTop: 2 }}>Automação de Produtos</p>
        </div>

        {/* Seletor de cliente */}
        <div style={{ padding: '16px 16px 0', position: 'relative' }}>
          <button onClick={() => setMenuAberto(!menuAberto)}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 8, padding: '8px 12px', color: '#fff', fontSize: 13, fontWeight: 600,
            }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {cliente?.nome || 'Selecionar cliente'}
            </span>
            <ChevronDown size={14} style={{ flexShrink: 0, marginLeft: 6 }} />
          </button>
          {menuAberto && (
            <div style={{
              position: 'absolute', top: '100%', left: 16, right: 16, zIndex: 100,
              background: '#2D3748', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 8, overflow: 'hidden', boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            }}>
              {clientes.map(c => (
                <button key={c.id} onClick={() => trocarCliente(c.id)}
                  style={{
                    width: '100%', padding: '10px 14px', textAlign: 'left',
                    background: c.id === cliente?.id ? 'rgba(99,179,237,0.15)' : 'none',
                    border: 'none', color: c.id === cliente?.id ? '#63B3ED' : '#E2E8F0',
                    fontSize: 13, fontWeight: c.id === cliente?.id ? 700 : 400,
                  }}>
                  {c.nome}
                </button>
              ))}
              <button onClick={() => { setMenuAberto(false); navigate('/') }}
                style={{
                  width: '100%', padding: '10px 14px', textAlign: 'left',
                  background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,0.08)',
                  color: '#FC8181', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6,
                }}>
                <LogOut size={13} /> Gerenciar clientes
              </button>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav style={{ marginTop: 20, flex: 1 }}>
          {NAV.map(({ to, icon: Icon, label }) => (
            <NavLink key={to} to={to}
              style={({ isActive }) => ({
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '11px 20px', fontSize: 13, fontWeight: 600,
                color: isActive ? '#fff' : '#718096',
                background: isActive ? 'rgba(255,255,255,0.08)' : 'none',
                borderRight: isActive ? '3px solid #63B3ED' : '3px solid transparent',
                textDecoration: 'none', transition: 'all 0.15s',
              })}>
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Status conexões */}
        <div style={{ padding: '16px 20px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <p style={{ fontSize: 10, fontWeight: 700, color: '#4A5568', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Conexões</p>
          <div style={{ display: 'flex', gap: 6 }}>
            <span style={{
              fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 20,
              background: cliente?.bling?.accessToken ? 'rgba(72,187,120,0.15)' : 'rgba(252,129,74,0.15)',
              color: cliente?.bling?.accessToken ? '#48BB78' : '#FC8181',
            }}>
              {cliente?.bling?.accessToken ? '● Bling' : '○ Bling'}
            </span>
            <span style={{
              fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 20,
              background: cliente?.ml?.accessToken ? 'rgba(72,187,120,0.15)' : 'rgba(252,129,74,0.15)',
              color: cliente?.ml?.accessToken ? '#48BB78' : '#FC8181',
            }}>
              {cliente?.ml?.accessToken ? '● ML' : '○ ML'}
            </span>
          </div>
        </div>
      </aside>

      {/* Conteúdo */}
      <main style={{ flex: 1, padding: 28, overflow: 'auto' }}>
        <Outlet />
      </main>
    </div>
  )
}
