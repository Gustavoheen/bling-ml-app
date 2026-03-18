import { useState, useMemo } from 'react'
import { getClienteAtivo, getProdutos, getMapeamentos, getHistorico } from '../lib/storage'
import { getTodosProdutos, refreshToken as blingRefresh } from '../lib/bling'
import { salvarProdutos, atualizarTokensBling } from '../lib/storage'
import { RefreshCw, Package, TrendingUp, AlertCircle, CheckCircle, Upload, DollarSign, Archive, Image, FileText } from 'lucide-react'

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

function validarParaML(produto, mapeamentos) {
  const cat = produto.categoria?.nome || 'Sem categoria'
  const mapa = mapeamentos[cat]
  const erros = []
  if (!produto.nome?.trim()) erros.push('nome')
  if (!produto.preco || Number(produto.preco) <= 0) erros.push('preco')
  if (!produto.descricaoCurta?.trim()) erros.push('descricao')
  if (!produto.imagemURL) erros.push('imagem')
  if (!mapa) erros.push('categoria')
  return erros
}

function KPICard({ icon: Icon, label, value, sub, color = '#1A202C', bg = '#fff', border = '#E2E8F0' }) {
  return (
    <div style={{ background: bg, border: `1.5px solid ${border}`, borderRadius: 14, padding: '18px 20px', display: 'flex', alignItems: 'flex-start', gap: 14 }}>
      <div style={{ width: 40, height: 40, borderRadius: 10, background: `${color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon size={20} color={color} />
      </div>
      <div>
        <p style={{ fontSize: 11, fontWeight: 700, color: '#718096', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</p>
        <p style={{ fontSize: 26, fontWeight: 800, color, marginTop: 4, lineHeight: 1 }}>{value}</p>
        {sub && <p style={{ fontSize: 12, color: '#718096', marginTop: 4 }}>{sub}</p>}
      </div>
    </div>
  )
}

export default function Dashboard() {
  const cliente = getClienteAtivo()
  const [produtos, setProdutos] = useState(() => getProdutos(cliente?.id || ''))
  const [sincronizando, setSincronizando] = useState(false)
  const [erro, setErro] = useState('')
  const [ultimaSync, setUltimaSync] = useState(() => localStorage.getItem(`bml_ultima_sync_${cliente?.id}`) || null)

  const mapeamentosArr = getMapeamentos(cliente?.id || '')
  const mapeamentos = useMemo(() => {
    const m = {}
    for (const item of (Array.isArray(mapeamentosArr) ? mapeamentosArr : [])) m[item.categoriaBling] = item
    return m
  }, [mapeamentosArr])

  const historico = getHistorico(cliente?.id || '')

  const stats = useMemo(() => {
    const total = produtos.length
    const comEstoque = produtos.filter(p => (p.estoque?.saldoVirtualTotal || 0) > 0).length
    const semEstoque = total - comEstoque
    const valorEstoque = produtos.reduce((acc, p) => acc + (Number(p.preco) * (p.estoque?.saldoVirtualTotal || 0)), 0)
    const semImagem = produtos.filter(p => !p.imagemURL).length
    const semDescricao = produtos.filter(p => !p.descricaoCurta?.trim()).length
    const prontoML = produtos.filter(p => validarParaML(p, mapeamentos).length === 0).length
    const comProblema = total - prontoML

    // Por categoria
    const porCategoria = {}
    produtos.forEach(p => {
      const cat = p.categoria?.nome || 'Sem categoria'
      if (!porCategoria[cat]) porCategoria[cat] = { total: 0, comEstoque: 0, valor: 0 }
      porCategoria[cat].total++
      if ((p.estoque?.saldoVirtualTotal || 0) > 0) porCategoria[cat].comEstoque++
      porCategoria[cat].valor += Number(p.preco) * (p.estoque?.saldoVirtualTotal || 0)
    })
    const categorias = Object.entries(porCategoria)
      .map(([nome, v]) => ({ nome, ...v }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10)

    // Histórico
    const exportados = historico.filter(h => h.status === 'ok').length
    const erros = historico.filter(h => h.status === 'erro').length

    return { total, comEstoque, semEstoque, valorEstoque, semImagem, semDescricao, prontoML, comProblema, categorias, exportados, erros }
  }, [produtos, mapeamentos, historico])

  async function sincronizar() {
    if (!cliente) return
    setErro('')
    setSincronizando(true)
    try {
      const token = await getTokenValido(getClienteAtivo())
      const lista = await getTodosProdutos(token)
      salvarProdutos(cliente.id, lista)
      const agora = new Date().toLocaleString('pt-BR')
      localStorage.setItem(`bml_ultima_sync_${cliente.id}`, agora)
      setProdutos(lista)
      setUltimaSync(agora)
    } catch (e) {
      setErro(e.message)
    } finally {
      setSincronizando(false)
    }
  }

  const blingOk = !!cliente?.bling?.accessToken
  const mlOk = !!cliente?.ml?.accessToken

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: '#1A202C', marginBottom: 4 }}>Dashboard</h2>
          {ultimaSync && <p style={{ fontSize: 12, color: '#718096' }}>Dados do Bling — última sync: {ultimaSync}</p>}
        </div>
        <button onClick={sincronizar} disabled={sincronizando || !blingOk}
          style={{ display: 'flex', alignItems: 'center', gap: 8, background: blingOk && !sincronizando ? '#1A202C' : '#CBD5E0', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 700 }}>
          <RefreshCw size={14} style={sincronizando ? { animation: 'spin 1s linear infinite' } : {}} />
          {sincronizando ? 'Atualizando...' : 'Atualizar dados'}
        </button>
      </div>

      {/* Status conexões */}
      {(!blingOk || !mlOk) && (
        <div style={{ background: 'rgba(252,193,7,0.08)', border: '1px solid rgba(252,193,7,0.4)', borderRadius: 10, padding: '12px 16px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
          <AlertCircle size={16} color="#D69E2E" />
          <span style={{ fontSize: 13, color: '#D69E2E', fontWeight: 600 }}>
            {!blingOk && !mlOk ? 'Bling e ML desconectados. ' : !blingOk ? 'Bling desconectado. ' : 'ML desconectado. '}
            Clique em "Gerenciar conexões" no sidebar.
          </span>
        </div>
      )}

      {erro && (
        <div style={{ background: 'rgba(252,129,74,0.1)', border: '1px solid #FC8181', borderRadius: 10, padding: '12px 16px', marginBottom: 16, fontSize: 13, color: '#C53030', fontWeight: 600 }}>
          {erro}
        </div>
      )}

      {produtos.length === 0 ? (
        <div style={{ background: '#fff', border: '1.5px dashed #CBD5E0', borderRadius: 14, padding: '48px 24px', textAlign: 'center' }}>
          <Package size={40} color="#CBD5E0" style={{ marginBottom: 16 }} />
          <p style={{ fontWeight: 700, color: '#A0AEC0', fontSize: 16 }}>Nenhum dado ainda</p>
          <p style={{ fontSize: 13, color: '#CBD5E0', marginTop: 6 }}>Conecte o Bling e clique em "Atualizar dados"</p>
        </div>
      ) : (
        <>
          {/* KPIs principais */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 20 }}>
            <KPICard icon={Package} label="Total produtos" value={stats.total} color="#3182CE" />
            <KPICard icon={Archive} label="Com estoque" value={stats.comEstoque} sub={`${stats.semEstoque} sem estoque`} color="#48BB78" />
            <KPICard icon={DollarSign} label="Valor em estoque" value={`R$ ${stats.valorEstoque.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} color="#805AD5" />
            <KPICard icon={Upload} label="Exportados ML" value={stats.exportados} sub={`${stats.erros} com erro`} color="#ED8936" />
          </div>

          {/* Status ML */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 24 }}>
            <KPICard icon={CheckCircle} label="Prontos p/ ML" value={stats.prontoML} color="#48BB78" bg="rgba(72,187,120,0.04)" border="rgba(72,187,120,0.2)" />
            <KPICard icon={AlertCircle} label="Com problemas" value={stats.comProblema} sub="Ver em Exportação" color="#FC8181" bg="rgba(252,129,74,0.04)" border="rgba(252,129,74,0.2)" />
            <KPICard icon={Image} label="Sem imagem" value={stats.semImagem} sub="Necessário para ML" color="#D69E2E" bg="rgba(252,193,7,0.04)" border="rgba(252,193,7,0.2)" />
            <KPICard icon={FileText} label="Sem descrição" value={stats.semDescricao} sub="Necessário para ML" color="#D69E2E" bg="rgba(252,193,7,0.04)" border="rgba(252,193,7,0.2)" />
          </div>

          {/* Por categoria */}
          <div style={{ background: '#fff', border: '1.5px solid #E2E8F0', borderRadius: 14, overflow: 'hidden', marginBottom: 20 }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #F7FAFC' }}>
              <p style={{ fontSize: 14, fontWeight: 800, color: '#1A202C' }}>Produtos por categoria</p>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#F7FAFC', borderBottom: '1px solid #E2E8F0' }}>
                  <th style={TH}>Categoria</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Produtos</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Com estoque</th>
                  <th style={{ ...TH, textAlign: 'right' }}>Valor estoque</th>
                  <th style={{ ...TH, textAlign: 'center' }}>ML</th>
                </tr>
              </thead>
              <tbody>
                {stats.categorias.map((cat, i) => {
                  const mapeada = !!mapeamentos[cat.nome]
                  return (
                    <tr key={cat.nome} style={{ borderBottom: '1px solid #F7FAFC', background: i % 2 === 0 ? '#fff' : '#FAFBFC' }}>
                      <td style={{ padding: '10px 20px', fontSize: 13, fontWeight: 600, color: '#1A202C' }}>{cat.nome}</td>
                      <td style={{ padding: '10px 20px', textAlign: 'right', fontSize: 13, color: '#4A5568' }}>{cat.total}</td>
                      <td style={{ padding: '10px 20px', textAlign: 'right', fontSize: 13, color: '#48BB78', fontWeight: 700 }}>{cat.comEstoque}</td>
                      <td style={{ padding: '10px 20px', textAlign: 'right', fontSize: 13, color: '#1A202C', fontWeight: 600 }}>
                        R$ {cat.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td style={{ padding: '10px 20px', textAlign: 'center' }}>
                        {mapeada
                          ? <span style={{ fontSize: 11, fontWeight: 700, color: '#48BB78', background: 'rgba(72,187,120,0.1)', padding: '2px 8px', borderRadius: 20 }}>Mapeada</span>
                          : <span style={{ fontSize: 11, fontWeight: 700, color: '#FC8181', background: 'rgba(252,129,74,0.1)', padding: '2px 8px', borderRadius: 20 }}>Pendente</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Últimas exportações */}
          {historico.length > 0 && (
            <div style={{ background: '#fff', border: '1.5px solid #E2E8F0', borderRadius: 14, overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid #F7FAFC' }}>
                <p style={{ fontSize: 14, fontWeight: 800, color: '#1A202C' }}>Últimas exportações</p>
              </div>
              {historico.slice(0, 8).map(h => (
                <div key={h.id} style={{ padding: '11px 20px', borderBottom: '1px solid #F7FAFC', display: 'flex', alignItems: 'center', gap: 12 }}>
                  {h.status === 'ok'
                    ? <CheckCircle size={15} color="#48BB78" style={{ flexShrink: 0 }} />
                    : <XCircle size={15} color="#FC8181" style={{ flexShrink: 0 }} />}
                  <p style={{ flex: 1, fontSize: 13, color: '#1A202C', fontWeight: 600 }}>{h.produtoNome}</p>
                  {h.mlId && <span style={{ fontSize: 11, color: '#718096', fontFamily: 'monospace' }}>{h.mlId}</span>}
                  {h.erro && <span style={{ fontSize: 11, color: '#FC8181', maxWidth: 200, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{h.erro}</span>}
                  <span style={{ fontSize: 11, color: '#A0AEC0', flexShrink: 0 }}>{new Date(h.criadoEm).toLocaleString('pt-BR')}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

function XCircle({ size, color, style }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={style}><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
}

const TH = { padding: '10px 20px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#718096', textTransform: 'uppercase', letterSpacing: '0.06em' }
