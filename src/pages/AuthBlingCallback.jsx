import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { trocarCodigoPorToken } from '../lib/bling'
import { atualizarTokensBling, getClienteAtivo } from '../lib/storage'
import { CheckCircle, XCircle, Loader } from 'lucide-react'

export default function AuthBlingCallback() {
  const navigate = useNavigate()
  const [status, setStatus] = useState('loading') // loading | ok | erro
  const [erro, setErro] = useState('')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const errorParam = params.get('error')

    if (errorParam) {
      setErro(`Autorização negada: ${errorParam}`)
      setStatus('erro')
      return
    }

    if (!code) {
      setErro('Código de autorização não encontrado.')
      setStatus('erro')
      return
    }

    const cliente = getClienteAtivo()
    if (!cliente) {
      setErro('Nenhum cliente ativo. Volte e selecione uma conta.')
      setStatus('erro')
      return
    }

    trocarCodigoPorToken(code)
      .then(tokens => {
        atualizarTokensBling(cliente.id, tokens)
        setStatus('ok')
        setTimeout(() => navigate('/auth'), 1800)
      })
      .catch(err => {
        setErro(err.message || 'Erro ao trocar código por token.')
        setStatus('erro')
      })
  }, [])

  return (
    <div style={{ minHeight: '100vh', background: '#F4F6F9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center', background: '#fff', borderRadius: 16, padding: '40px 48px', boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>
        {status === 'loading' && (
          <>
            <Loader size={40} color="#3182CE" style={{ animation: 'spin 1s linear infinite', marginBottom: 16 }} />
            <p style={{ fontWeight: 700, color: '#1A202C', fontSize: 16 }}>Conectando Bling...</p>
            <p style={{ fontSize: 13, color: '#718096', marginTop: 6 }}>Aguarde enquanto trocamos o código por token.</p>
          </>
        )}
        {status === 'ok' && (
          <>
            <CheckCircle size={48} color="#48BB78" style={{ marginBottom: 16 }} />
            <p style={{ fontWeight: 800, color: '#1A202C', fontSize: 18 }}>Bling conectado!</p>
            <p style={{ fontSize: 13, color: '#718096', marginTop: 6 }}>Redirecionando...</p>
          </>
        )}
        {status === 'erro' && (
          <>
            <XCircle size={48} color="#FC8181" style={{ marginBottom: 16 }} />
            <p style={{ fontWeight: 800, color: '#1A202C', fontSize: 18 }}>Erro na conexão</p>
            <p style={{ fontSize: 13, color: '#718096', marginTop: 6, maxWidth: 300 }}>{erro}</p>
            <button
              onClick={() => navigate('/auth')}
              style={{
                marginTop: 20, background: '#1A202C', color: '#fff', border: 'none',
                borderRadius: 8, padding: '10px 24px', fontSize: 14, fontWeight: 700,
              }}>
              Tentar novamente
            </button>
          </>
        )}
      </div>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
