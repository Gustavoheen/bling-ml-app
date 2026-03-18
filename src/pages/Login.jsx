import { useState } from 'react'
import { Zap, Lock } from 'lucide-react'

const SENHA_CORRETA = import.meta.env.VITE_APP_PASSWORD || 'bling2025'

export default function Login({ onLogin }) {
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState(false)
  const [loading, setLoading] = useState(false)

  function entrar(e) {
    e.preventDefault()
    setLoading(true)
    setTimeout(() => {
      if (senha === SENHA_CORRETA) {
        sessionStorage.setItem('bml_auth', '1')
        onLogin()
      } else {
        setErro(true)
        setSenha('')
      }
      setLoading(false)
    }, 400)
  }

  return (
    <div style={{ minHeight: '100vh', background: '#1A202C', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 60, height: 60, background: 'rgba(99,179,237,0.1)', border: '1.5px solid rgba(99,179,237,0.3)', borderRadius: 18, marginBottom: 20 }}>
            <Zap size={28} color="#63B3ED" />
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff', marginBottom: 6 }}>Bling → ML Automation</h1>
          <p style={{ fontSize: 13, color: '#4A5568' }}>Sistema privado — acesso restrito</p>
        </div>

        <form onSubmit={entrar}>
          <div style={{ background: 'rgba(255,255,255,0.04)', border: `1.5px solid ${erro ? '#FC8181' : 'rgba(255,255,255,0.1)'}`, borderRadius: 14, padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <Lock size={14} color="#4A5568" />
              <span style={{ fontSize: 12, fontWeight: 700, color: '#4A5568', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Senha de acesso</span>
            </div>
            <input
              autoFocus
              type="password"
              value={senha}
              onChange={e => { setSenha(e.target.value); setErro(false) }}
              placeholder="Digite a senha..."
              style={{
                width: '100%', padding: '12px 14px', borderRadius: 8,
                border: `1.5px solid ${erro ? '#FC8181' : 'rgba(255,255,255,0.1)'}`,
                background: 'rgba(255,255,255,0.06)', color: '#fff',
                fontSize: 15, outline: 'none', marginBottom: 12, boxSizing: 'border-box',
              }}
            />
            {erro && (
              <p style={{ fontSize: 13, color: '#FC8181', fontWeight: 600, marginBottom: 12 }}>
                Senha incorreta. Tente novamente.
              </p>
            )}
            <button type="submit" disabled={!senha || loading}
              style={{
                width: '100%', padding: '13px 0', borderRadius: 8, border: 'none',
                background: senha && !loading ? '#63B3ED' : 'rgba(99,179,237,0.2)',
                color: senha && !loading ? '#1A202C' : '#4A5568',
                fontSize: 14, fontWeight: 800, transition: 'all 0.15s',
              }}>
              {loading ? 'Verificando...' : 'Entrar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
