import { useNavigate } from 'react-router-dom'
import { getClienteAtivo } from '../lib/storage'
import { getAuthUrl as getBlingAuthUrl } from '../lib/bling'
import { getAuthUrl as getMLAuthUrl } from '../lib/ml'
import { CheckCircle, Circle, ArrowRight, Zap } from 'lucide-react'

export default function Auth() {
  const navigate = useNavigate()
  const cliente = getClienteAtivo()

  if (!cliente) {
    navigate('/')
    return null
  }

  const blingOk = !!cliente.bling?.accessToken
  const mlOk = !!cliente.ml?.accessToken

  function conectarBling() {
    window.location.href = getBlingAuthUrl()
  }

  function conectarML() {
    window.location.href = getMLAuthUrl()
  }

  function continuar() {
    navigate('/app/produtos')
  }

  return (
    <div style={{ minHeight: '100vh', background: '#F4F6F9', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 480 }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 56, height: 56, background: '#1A202C', borderRadius: 16, marginBottom: 16 }}>
            <Zap size={28} color="#63B3ED" />
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1A202C', marginBottom: 6 }}>Conectar APIs</h1>
          <p style={{ fontSize: 14, color: '#718096' }}>
            Conta: <strong style={{ color: '#1A202C' }}>{cliente.nome}</strong>
          </p>
        </div>

        {/* Cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 24 }}>
          {/* Bling */}
          <div style={{
            background: '#fff', border: `1.5px solid ${blingOk ? '#48BB78' : '#E2E8F0'}`,
            borderRadius: 14, padding: 20,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 10,
                  background: blingOk ? 'rgba(72,187,120,0.1)' : '#F7FAFC',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 20,
                }}>
                  🔷
                </div>
                <div>
                  <p style={{ fontWeight: 700, color: '#1A202C', fontSize: 15 }}>Bling ERP</p>
                  <p style={{ fontSize: 12, color: blingOk ? '#48BB78' : '#718096', fontWeight: 600, marginTop: 2 }}>
                    {blingOk ? '● Conectado' : '○ Não conectado'}
                  </p>
                </div>
              </div>
              <button
                onClick={conectarBling}
                style={{
                  background: blingOk ? '#F7FAFC' : '#1A202C',
                  color: blingOk ? '#718096' : '#fff',
                  border: blingOk ? '1.5px solid #E2E8F0' : 'none',
                  borderRadius: 8, padding: '9px 18px',
                  fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6,
                }}>
                {blingOk ? (
                  <><CheckCircle size={14} color="#48BB78" /> Reconectar</>
                ) : (
                  <>Conectar <ArrowRight size={13} /></>
                )}
              </button>
            </div>
          </div>

          {/* Mercado Livre */}
          <div style={{
            background: '#fff', border: `1.5px solid ${mlOk ? '#48BB78' : '#E2E8F0'}`,
            borderRadius: 14, padding: 20,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 10,
                  background: mlOk ? 'rgba(72,187,120,0.1)' : '#F7FAFC',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 20,
                }}>
                  🟡
                </div>
                <div>
                  <p style={{ fontWeight: 700, color: '#1A202C', fontSize: 15 }}>Mercado Livre</p>
                  <p style={{ fontSize: 12, color: mlOk ? '#48BB78' : '#718096', fontWeight: 600, marginTop: 2 }}>
                    {mlOk ? '● Conectado' : '○ Não conectado'}
                  </p>
                </div>
              </div>
              <button
                onClick={conectarML}
                style={{
                  background: mlOk ? '#F7FAFC' : '#1A202C',
                  color: mlOk ? '#718096' : '#fff',
                  border: mlOk ? '1.5px solid #E2E8F0' : 'none',
                  borderRadius: 8, padding: '9px 18px',
                  fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6,
                }}>
                {mlOk ? (
                  <><CheckCircle size={14} color="#48BB78" /> Reconectar</>
                ) : (
                  <>Conectar <ArrowRight size={13} /></>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Continuar */}
        <button
          onClick={continuar}
          disabled={!blingOk || !mlOk}
          style={{
            width: '100%', padding: '14px 0', borderRadius: 10, border: 'none',
            background: blingOk && mlOk ? '#1A202C' : '#CBD5E0',
            color: '#fff', fontSize: 15, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}>
          Ir para Produtos <ArrowRight size={16} />
        </button>

        {(blingOk || mlOk) && !(blingOk && mlOk) && (
          <p style={{ textAlign: 'center', fontSize: 12, color: '#FC8181', marginTop: 12, fontWeight: 600 }}>
            Conecte as duas plataformas para continuar
          </p>
        )}

        <p style={{ textAlign: 'center', marginTop: 16 }}>
          <button onClick={() => navigate('/')}
            style={{ background: 'none', border: 'none', color: '#718096', fontSize: 13, cursor: 'pointer' }}>
            ← Voltar para seleção de contas
          </button>
        </p>
      </div>
    </div>
  )
}
