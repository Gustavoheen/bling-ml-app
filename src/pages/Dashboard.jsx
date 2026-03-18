import { useState, useMemo, useCallback } from 'react'
import { getClienteAtivo } from '../lib/storage'
import { refreshToken as blingRefresh, getTodosPedidos } from '../lib/bling'
import { atualizarTokensBling } from '../lib/storage'
import { RefreshCw } from 'lucide-react'

// ── helpers ────────────────────────────────────────────────────

async function getTokenValido(cliente) {
  if (!cliente?.bling?.accessToken) throw new Error('Bling não conectado.')
  const expiring = cliente.bling.expiresAt && Date.now() > cliente.bling.expiresAt - 60000
  if (expiring && cliente.bling.refreshToken) {
    const novos = await blingRefresh(cliente.bling.refreshToken)
    atualizarTokensBling(cliente.id, novos)
    return novos.accessToken
  }
  return cliente.bling.accessToken
}

function isoHoje() {
  return new Date().toISOString().slice(0, 10)
}
function iso30DiasAtras() {
  const d = new Date()
  d.setDate(d.getDate() - 30)
  return d.toISOString().slice(0, 10)
}

function categorizarSituacao(situacao) {
  if (!situacao) return 'Pendente'
  const id = situacao?.id ?? situacao
  const nome = String(situacao?.nome?.valor || situacao?.nome || situacao?.valor || '').toLowerCase()
  if (id === 9 || nome.includes('atendido')) return 'Entregue'
  if (id === 12 || nome.includes('cancel')) return 'Cancelado'
  if (id === 15 || nome.includes('andamento')) return 'Processando'
  if (id === 18 || nome.includes('verificado')) return 'Enviado'
  if (nome.includes('confirmado') || nome.includes('pago')) return 'Entregue'
  if (nome.includes('enviado') || nome.includes('saiu')) return 'Enviado'
  return 'Pendente'
}

function extrairTotal(p) {
  // Bling v3 pode retornar o valor em diferentes campos dependendo do endpoint
  const v = p.total?.totalVenda ?? p.totalVenda ?? p.valor ?? p.valorTotal ?? p.total ?? 0
  const n = Number(v)
  return isNaN(n) ? 0 : n
}

function calcularMetricas(pedidosRaw) {
  const pedidos = Array.isArray(pedidosRaw) ? pedidosRaw : []
  if (pedidos.length > 0) {
    console.log('[Dashboard] estrutura pedido[0]:', JSON.stringify(pedidos[0], null, 2))
  }
  let receita = 0
  let custo = 0
  const statusCount = { Pendente: 0, Processando: 0, Enviado: 0, Entregue: 0, Cancelado: 0, Devolvido: 0 }
  const porRegiao = {}
  const porDia = {}

  for (const p of pedidos) {
    const total = extrairTotal(p)
    const status = categorizarSituacao(p.situacao)
    if (statusCount[status] !== undefined) statusCount[status]++

    if (status !== 'Cancelado') {
      receita += total
      custo += total * 0.3
    }

    const uf = p.transporte?.enderecoEntrega?.uf || p.contato?.uf || '?'
    if (!porRegiao[uf]) porRegiao[uf] = { pedidos: 0, valor: 0 }
    porRegiao[uf].pedidos++
    if (status !== 'Cancelado') porRegiao[uf].valor += total

    const data = (p.data || '').slice(0, 10)
    if (data) {
      if (!porDia[data]) porDia[data] = { pedidos: 0, valor: 0 }
      porDia[data].pedidos++
      if (status !== 'Cancelado') porDia[data].valor += total
    }
  }

  const lucro = receita - custo
  const topRegioes = Object.entries(porRegiao)
    .map(([uf, v]) => ({ uf, ...v }))
    .sort((a, b) => b.pedidos - a.pedidos)
    .slice(0, 5)

  const diasSerie = []
  for (let i = 29; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    diasSerie.push({ data: key, pedidos: porDia[key]?.pedidos || 0, valor: porDia[key]?.valor || 0 })
  }

  return { totalPedidos: pedidos.length, receita, custo, lucro, statusCount, topRegioes, diasSerie }
}

// ── Gráficos SVG simples ───────────────────────────────────────

function LineChart({ data, colorA = '#00d4ff', colorB = '#48BB78', height = 180 }) {
  if (!data.length) return null
  const maxVal = Math.max(...data.map(d => Math.max(d.valor, d.pedidos * 1000)), 1)
  const w = 100 / (data.length - 1 || 1)
  const toY = val => height - 8 - ((val / maxVal) * (height - 16))
  const ptA = data.map((d, i) => `${i * w},${toY(d.valor)}`).join(' ')
  const ptB = data.map((d, i) => `${i * w},${toY(d.pedidos * 1000)}`).join(' ')
  return (
    <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" style={{ width: '100%', height }}>
      <polyline points={ptA} fill="none" stroke={colorA} strokeWidth="0.8" vectorEffect="non-scaling-stroke" />
      <polyline points={ptB} fill="none" stroke={colorB} strokeWidth="0.8" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function BarChart({ data, height = 180 }) {
  const max = Math.max(...data.map(d => d.pedidos), 1)
  const bw = 100 / data.length
  return (
    <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" style={{ width: '100%', height }}>
      {data.map((d, i) => {
        const barH = ((d.pedidos / max) * (height - 8))
        return <rect key={i} x={i * bw + 0.3} y={height - barH} width={bw - 0.6} height={barH} fill="#00d4ff" fillOpacity={0.65} rx="0.4" />
      })}
    </svg>
  )
}

// ── Estilos ────────────────────────────────────────────────────

function fmt(val) {
  return `R$ ${Number(val).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const BADGE_MAP = {
  Pendente:    { bg: 'rgba(255,193,7,0.2)',   color: '#ffc107' },
  Processando: { bg: 'rgba(0,212,255,0.2)',   color: '#00d4ff' },
  Enviado:     { bg: 'rgba(76,175,80,0.2)',   color: '#4caf50' },
  Entregue:    { bg: 'rgba(76,175,80,0.2)',   color: '#4caf50' },
  Cancelado:   { bg: 'rgba(244,67,54,0.2)',   color: '#f44336' },
  Devolvido:   { bg: 'rgba(158,158,158,0.2)', color: '#9e9e9e' },
}

// ── Componente principal ───────────────────────────────────────

export default function Dashboard() {
  const cliente = getClienteAtivo()
  const [pedidos, setPedidos] = useState(() => {
    try { return JSON.parse(localStorage.getItem(`bml_dash_pedidos_${cliente?.id}`) || '[]') } catch { return [] }
  })
  const [carregando, setCarregando] = useState(false)
  const [progresso, setProgresso] = useState(0)
  const [erro, setErro] = useState('')
  const [ultimaSync, setUltimaSync] = useState(() =>
    localStorage.getItem(`bml_dash_sync_${cliente?.id}`) || null
  )

  const blingOk = !!cliente?.bling?.accessToken

  const sincronizar = useCallback(async () => {
    if (!cliente || !blingOk) return
    setErro('')
    setCarregando(true)
    setProgresso(0)
    try {
      const token = await getTokenValido(getClienteAtivo())
      const lista = await getTodosPedidos(token, iso30DiasAtras(), isoHoje(), (n) => setProgresso(n))
      setPedidos(lista)
      const agora = new Date().toLocaleString('pt-BR')
      setUltimaSync(agora)
      localStorage.setItem(`bml_dash_sync_${cliente.id}`, agora)
      localStorage.setItem(`bml_dash_pedidos_${cliente.id}`, JSON.stringify(lista))
    } catch (e) {
      setErro(e.message)
    } finally {
      setCarregando(false)
    }
  }, [cliente, blingOk])

  const m = useMemo(() => calcularMetricas(pedidos), [pedidos])

  const pedidosRecentes = useMemo(() =>
    [...pedidos].sort((a, b) => new Date(b.data || 0) - new Date(a.data || 0)).slice(0, 10),
    [pedidos]
  )

  const agora = new Date().toLocaleString('pt-BR', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })

  const temDados = pedidos.length > 0
  const temGrafico = m.diasSerie.some(d => d.pedidos > 0)

  return (
    <div style={{
      margin: '-28px', minHeight: '100vh',
      background: 'linear-gradient(135deg,#0a0e27 0%,#0f1429 100%)',
      color: '#e0e0e0', fontFamily: 'system-ui,sans-serif', padding: 28,
    }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, paddingBottom: 20, borderBottom: '1px solid #1a1f3a' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#fff', marginBottom: 4 }}>Visão Geral</h1>
          <p style={{ fontSize: 12, color: '#8b92b0' }}>
            {ultimaSync ? `Dados do Bling · última sync: ${ultimaSync}` : 'Painel de controle operacional · últimos 30 dias'}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 12, color: '#8b92b0' }}>
            {agora.charAt(0).toUpperCase() + agora.slice(1)}
          </span>
          <button
            onClick={sincronizar}
            disabled={carregando || !blingOk}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: carregando || !blingOk ? '#2a2f4a' : 'rgba(0,212,255,0.15)',
              color: carregando || !blingOk ? '#8b92b0' : '#00d4ff',
              border: `1px solid ${carregando || !blingOk ? '#2a2f4a' : 'rgba(0,212,255,0.4)'}`,
              borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 700,
              cursor: carregando || !blingOk ? 'default' : 'pointer',
            }}>
            <RefreshCw size={14} style={carregando ? { animation: 'spin 1s linear infinite' } : {}} />
            {carregando ? `Buscando... (${progresso})` : 'Atualizar dados'}
          </button>
        </div>
      </div>

      {/* Alertas */}
      {!blingOk && (
        <div style={{ background: 'rgba(244,67,54,0.1)', border: '1px solid rgba(244,67,54,0.3)', borderRadius: 8, padding: '12px 16px', marginBottom: 20, fontSize: 13, color: '#f44336', fontWeight: 600 }}>
          Bling desconectado — clique em "Gerenciar conexões" no sidebar.
        </div>
      )}
      {erro && (
        <div style={{ background: 'rgba(244,67,54,0.1)', border: '1px solid rgba(244,67,54,0.3)', borderRadius: 8, padding: '12px 16px', marginBottom: 20, fontSize: 13, color: '#f44336' }}>
          {erro}
        </div>
      )}

      {/* Hero */}
      <div style={{ background: 'linear-gradient(135deg,rgba(0,212,255,0.1) 0%,rgba(0,153,255,0.05) 100%)', border: '1px solid #1a3a4a', borderRadius: 12, padding: '24px 28px', marginBottom: 24, position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: '-50%', right: '-10%', width: 350, height: 350, background: 'radial-gradient(circle,rgba(0,212,255,0.08) 0%,transparent 70%)', borderRadius: '50%', pointerEvents: 'none' }} />
        <h2 style={{ fontSize: 26, fontWeight: 800, color: '#fff', marginBottom: 8, position: 'relative', zIndex: 1 }}>Centro de Comando</h2>
        <p style={{ fontSize: 13, color: '#8b92b0', position: 'relative', zIndex: 1 }}>
          {temDados
            ? `${m.totalPedidos} pedidos carregados · faturamento de ${fmt(m.receita)} nos últimos 30 dias`
            : 'Clique em "Atualizar dados" para carregar os pedidos do Bling ERP.'}
        </p>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 24 }}>
        {[
          { label: 'Total de Pedidos', value: m.totalPedidos, icon: '🛒', iconBg: 'rgba(255,193,7,0.15)', sub: 'últimos 30 dias' },
          { label: 'Faturamento',       value: fmt(m.receita),  icon: '💵', iconBg: 'rgba(76,175,80,0.15)',  sub: 'pedidos não cancelados' },
          { label: 'Lucro Estimado',   value: fmt(m.lucro),    icon: '📈', iconBg: 'rgba(255,152,0,0.15)', sub: '70% da receita' },
          { label: 'Custo Estimado',   value: fmt(m.custo),    icon: '⚙️', iconBg: 'rgba(244,67,54,0.15)', sub: '30% da receita' },
        ].map(card => (
          <div key={card.label} style={{ background: 'rgba(26,31,58,0.5)', border: '1px solid #2a2f4a', borderRadius: 12, padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 11, color: '#8b92b0', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{card.label}</div>
                <div style={{ fontSize: 10, color: '#4a5568', marginTop: 3 }}>{card.sub}</div>
              </div>
              <div style={{ width: 38, height: 38, borderRadius: 8, background: card.iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>{card.icon}</div>
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#fff', lineHeight: 1 }}>{card.value}</div>
          </div>
        ))}
      </div>

      {/* Status dos pedidos */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 12, marginBottom: 24 }}>
        {[
          { icon: '⏳', label: 'Pendentes',   key: 'Pendente' },
          { icon: '⚙️', label: 'Processando', key: 'Processando' },
          { icon: '📦', label: 'Enviados',     key: 'Enviado' },
          { icon: '✅', label: 'Entregues',    key: 'Entregue' },
          { icon: '❌', label: 'Cancelados',   key: 'Cancelado' },
          { icon: '↩️', label: 'Devolvidos',   key: 'Devolvido' },
        ].map(item => (
          <div key={item.label} style={{ background: 'rgba(26,31,58,0.5)', border: '1px solid #2a2f4a', borderRadius: 12, padding: 16, textAlign: 'center' }}>
            <div style={{ fontSize: 22, marginBottom: 8 }}>{item.icon}</div>
            <div style={{ fontSize: 11, color: '#8b92b0', marginBottom: 6 }}>{item.label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#fff' }}>{m.statusCount[item.key]}</div>
          </div>
        ))}
      </div>

      {/* Gráficos */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
        <div style={{ background: 'rgba(26,31,58,0.5)', border: '1px solid #2a2f4a', borderRadius: 12, padding: 20 }}>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>Faturamento vs Pedidos (30 dias)</div>
            <div style={{ fontSize: 11, color: '#8b92b0', marginTop: 4 }}>
              <span style={{ color: '#00d4ff' }}>— Faturamento</span>
              <span style={{ color: '#48BB78', marginLeft: 12 }}>— Volume</span>
            </div>
          </div>
          {temGrafico ? <LineChart data={m.diasSerie} /> : <EmptyChart />}
        </div>
        <div style={{ background: 'rgba(26,31,58,0.5)', border: '1px solid #2a2f4a', borderRadius: 12, padding: 20 }}>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>Pedidos por Dia (30 dias)</div>
            <div style={{ fontSize: 11, color: '#8b92b0', marginTop: 4 }}>⟳ Atualiza ao sincronizar</div>
          </div>
          {temGrafico ? <BarChart data={m.diasSerie} /> : <EmptyChart />}
        </div>
      </div>

      {/* Top Regiões */}
      <div style={{ background: 'rgba(26,31,58,0.5)', border: '1px solid #2a2f4a', borderRadius: 12, padding: 20, marginBottom: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 16 }}>Top Regiões por Pedidos</div>
        {m.topRegioes.length === 0
          ? <EmptyChart />
          : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {m.topRegioes.map(r => (
                <div key={r.uf} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: 'rgba(0,212,255,0.05)', borderRadius: 8, border: '1px solid #1a3a4a' }}>
                  <div style={{ fontWeight: 700, color: '#fff' }}>{r.uf}</div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 700, color: '#fff', fontSize: 13 }}>{r.pedidos} pedidos</div>
                    <div style={{ fontSize: 12, color: '#8b92b0' }}>{fmt(r.valor)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
      </div>

      {/* Tabela pedidos recentes */}
      <div style={{ background: 'rgba(26,31,58,0.5)', border: '1px solid #2a2f4a', borderRadius: 12, padding: 20, marginBottom: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 4 }}>Pedidos Recentes</div>
        <div style={{ fontSize: 11, color: '#8b92b0', marginBottom: 16 }}>últimos 30 dias · ordenado por data</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Nº Pedido', 'Contato', 'Total', 'Status', 'Data'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 700, color: '#8b92b0', borderBottom: '1px solid #2a2f4a', background: 'rgba(0,0,0,0.2)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pedidosRecentes.length === 0
                ? (
                  <tr>
                    <td colSpan={5} style={{ padding: 32, textAlign: 'center', color: '#4a5568', fontSize: 13 }}>
                      Nenhum pedido carregado — clique em "Atualizar dados"
                    </td>
                  </tr>
                )
                : pedidosRecentes.map((p, i) => {
                  const status = categorizarSituacao(p.situacao)
                  const total = Number(p.total?.totalVenda ?? p.totalVenda ?? 0)
                  const { bg, color } = BADGE_MAP[status] || BADGE_MAP.Pendente
                  return (
                    <tr key={p.id || i}>
                      <td style={{ padding: '10px 14px', fontSize: 13, borderBottom: '1px solid #1a1f3a', color: '#00d4ff', fontWeight: 600 }}>#{p.numero || p.id}</td>
                      <td style={{ padding: '10px 14px', fontSize: 13, borderBottom: '1px solid #1a1f3a', color: '#e0e0e0' }}>{p.contato?.nome || '—'}</td>
                      <td style={{ padding: '10px 14px', fontSize: 13, borderBottom: '1px solid #1a1f3a', color: '#fff', fontWeight: 700 }}>{fmt(total)}</td>
                      <td style={{ padding: '10px 14px', fontSize: 13, borderBottom: '1px solid #1a1f3a' }}>
                        <span style={{ background: bg, color, padding: '3px 9px', borderRadius: 4, fontSize: 11, fontWeight: 700 }}>{status}</span>
                      </td>
                      <td style={{ padding: '10px 14px', fontSize: 13, borderBottom: '1px solid #1a1f3a', color: '#8b92b0' }}>{(p.data || '').slice(0, 10)}</td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Footer */}
      <div style={{ textAlign: 'center', paddingTop: 16, borderTop: '1px solid #1a1f3a', fontSize: 12, color: '#4a5568' }}>
        Bling → ML · Dashboard integrado com Bling ERP v3
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

function EmptyChart() {
  return (
    <div style={{ height: 180, background: 'rgba(0,212,255,0.03)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4a5568', fontSize: 13, border: '1px dashed #1a3a4a' }}>
      Sem dados — sincronize para visualizar
    </div>
  )
}
