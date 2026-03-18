import { useState } from 'react'
import { getClienteAtivo, getCategoriasML, salvarCategoriasML, getMapeamentos, salvarMapeamentos } from '../lib/storage'
import { buscarCategorias, getAtributosCategoria } from '../lib/ml'
import { buscarOuCriarCategoria } from '../lib/bling'
import { Search, Plus, Trash2, CheckCircle, Loader, Tag, Zap, ShieldCheck } from 'lucide-react'

export default function Categorias() {
  const cliente = getClienteAtivo()

  const [lista, setLista] = useState(() => getCategoriasML(cliente?.id || ''))
  const [query, setQuery] = useState('')
  const [resultados, setResultados] = useState([])
  const [buscando, setBuscando] = useState(false)
  const [processando, setProcessando] = useState(false)
  const [log, setLog] = useState([])

  function salvarLista(nova) {
    setLista(nova)
    salvarCategoriasML(cliente.id, nova)
  }

  // Salva mapeamento no localStorage para uso no Mapeamento/Exportação
  function salvarNoMapeamento(cat, blingId, attrs) {
    const mapeamentosAtuais = getMapeamentos(cliente.id)
    const obj = {}
    for (const m of (Array.isArray(mapeamentosAtuais) ? mapeamentosAtuais : [])) obj[m.categoriaBling] = m
    obj[cat.mlNome] = {
      categoriaBling: cat.mlNome,
      mlCategoryId: cat.mlId,
      mlCategoryName: cat.mlNome,
      atributos: (attrs || []).map(a => ({ id: a.id, name: a.name, valor: '' })),
    }
    salvarMapeamentos(cliente.id, Object.values(obj))
  }

  async function buscar() {
    if (!query.trim()) return
    setBuscando(true)
    setResultados([])
    try {
      const res = await buscarCategorias(query)
      setResultados(res || [])
    } catch {
      setResultados([])
    } finally {
      setBuscando(false)
    }
  }

  function adicionar(cat) {
    if (lista.find(c => c.mlId === cat.category_id)) return
    const nova = [...lista, {
      mlId: cat.category_id,
      mlNome: cat.domain_name || cat.category_name,
      blingId: null,
      validada: null,
      atributos: [],
    }]
    salvarLista(nova)
    setResultados(r => r.filter(c => c.category_id !== cat.category_id))
  }

  function remover(mlId) {
    salvarLista(lista.filter(c => c.mlId !== mlId))
  }

  // Cria no Bling + valida no ML + salva mapeamento
  async function processarCategoria(cat, idx, atualizada, logIdx) {
    const nome = cat.mlNome

    // 1. Criar no Bling
    let blingId = cat.blingId
    if (!blingId) {
      setLog(l => l.map((x, i) => i === logIdx ? { ...x, status: 'criando', msg: 'Criando no Bling...' } : x))
      try {
        blingId = await buscarOuCriarCategoria(cliente.bling.accessToken, nome)
        atualizada[idx] = { ...atualizada[idx], blingId, criadaEm: new Date().toISOString() }
      } catch (err) {
        setLog(l => l.map((x, i) => i === logIdx ? { ...x, status: 'erro', msg: `Bling: ${err.message}` } : x))
        return
      }
    }

    // 2. Validar no ML (busca atributos)
    setLog(l => l.map((x, i) => i === logIdx ? { ...x, status: 'validando', msg: 'Validando no ML...' } : x))
    let attrs = []
    let validada = false
    try {
      attrs = await getAtributosCategoria(cat.mlId)
      validada = true
      atualizada[idx] = { ...atualizada[idx], blingId, validada: true, atributos: attrs.map(a => ({ id: a.id, name: a.name, valor: '' })) }
    } catch {
      atualizada[idx] = { ...atualizada[idx], blingId, validada: false }
    }

    // 3. Salvar no mapeamento
    salvarNoMapeamento(atualizada[idx], blingId, attrs)

    const msgFinal = validada
      ? `✓ Criada no Bling (ID ${blingId}) · Validada no ML${attrs.length ? ` · ${attrs.length} atrib.` : ''}`
      : `✓ Criada no Bling (ID ${blingId}) · ML sem retorno`
    setLog(l => l.map((x, i) => i === logIdx ? { ...x, status: 'ok', msg: msgFinal } : x))
  }

  async function processarTodas() {
    if (!cliente?.bling?.accessToken) {
      alert('Conecte o Bling primeiro em Gerenciar conexões.')
      return
    }
    setProcessando(true)
    setLog([])
    const atualizada = [...lista]

    for (let i = 0; i < atualizada.length; i++) {
      setLog(l => [...l, { nome: atualizada[i].mlNome, status: 'aguardando', msg: '...' }])
    }

    for (let i = 0; i < atualizada.length; i++) {
      await processarCategoria(atualizada[i], i, atualizada, i)
      salvarLista([...atualizada])
      await new Promise(r => setTimeout(r, 300))
    }

    salvarLista(atualizada)
    setProcessando(false)
  }

  async function processarUma(idx) {
    if (!cliente?.bling?.accessToken) {
      alert('Conecte o Bling primeiro.')
      return
    }
    setProcessando(true)
    setLog([{ nome: lista[idx].mlNome, status: 'aguardando', msg: '...' }])
    const atualizada = [...lista]
    await processarCategoria(atualizada[idx], idx, atualizada, 0)
    salvarLista(atualizada)
    setProcessando(false)
  }

  const totalCriadas = lista.filter(c => c.blingId).length
  const totalValidadas = lista.filter(c => c.validada).length

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: '#1A202C', marginBottom: 4 }}>Categorias</h2>
          <p style={{ fontSize: 13, color: '#718096' }}>
            Busque categorias do Mercado Livre → cria no Bling → valida automaticamente
          </p>
        </div>
        {lista.length > 0 && (
          <button onClick={processarTodas} disabled={processando}
            style={{ display: 'flex', alignItems: 'center', gap: 8, background: processando ? '#CBD5E0' : '#1A202C', color: '#fff', border: 'none', borderRadius: 9, padding: '10px 20px', fontSize: 13, fontWeight: 700, cursor: processando ? 'default' : 'pointer' }}>
            {processando ? <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Zap size={14} />}
            {processando ? 'Processando...' : `Criar + Validar tudo (${lista.length})`}
          </button>
        )}
      </div>

      {/* Busca */}
      <div style={{ background: '#fff', border: '1.5px solid #E2E8F0', borderRadius: 14, padding: 20, marginBottom: 20 }}>
        <p style={{ fontSize: 12, fontWeight: 700, color: '#718096', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
          Buscar categorias no Mercado Livre
        </p>
        <div style={{ display: 'flex', gap: 10 }}>
          <input
            type="text"
            placeholder="Ex: Móveis, Eletrônicos, Roupas, Ferramentas..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && buscar()}
            style={{ flex: 1, padding: '10px 14px', border: '1.5px solid #E2E8F0', borderRadius: 9, fontSize: 14, outline: 'none' }}
          />
          <button onClick={buscar} disabled={buscando}
            style={{ display: 'flex', alignItems: 'center', gap: 8, background: buscando ? '#CBD5E0' : '#3182CE', color: '#fff', border: 'none', borderRadius: 9, padding: '10px 20px', fontSize: 13, fontWeight: 700, cursor: buscando ? 'default' : 'pointer' }}>
            {buscando ? <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Search size={14} />}
            {buscando ? 'Buscando...' : 'Buscar'}
          </button>
        </div>

        {resultados.length > 0 && (
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: '#A0AEC0', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {resultados.length} resultado{resultados.length > 1 ? 's' : ''} — clique para adicionar
            </p>
            {resultados.map(r => {
              const jaAdicionada = lista.find(c => c.mlId === r.category_id)
              return (
                <button key={r.category_id}
                  onClick={() => !jaAdicionada && adicionar(r)}
                  disabled={!!jaAdicionada}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 14px', background: jaAdicionada ? '#F7FAFC' : '#fff', border: '1.5px solid #E2E8F0', borderRadius: 9, textAlign: 'left', cursor: jaAdicionada ? 'default' : 'pointer', opacity: jaAdicionada ? 0.6 : 1 }}
                  onMouseEnter={e => { if (!jaAdicionada) { e.currentTarget.style.borderColor = '#63B3ED'; e.currentTarget.style.background = 'rgba(99,179,237,0.04)' } }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = '#E2E8F0'; e.currentTarget.style.background = jaAdicionada ? '#F7FAFC' : '#fff' }}>
                  <div>
                    <p style={{ fontSize: 14, fontWeight: 700, color: '#1A202C' }}>{r.domain_name}</p>
                    <p style={{ fontSize: 11, color: '#A0AEC0', fontFamily: 'monospace', marginTop: 2 }}>{r.category_id}</p>
                  </div>
                  {jaAdicionada
                    ? <span style={{ fontSize: 11, color: '#48BB78', fontWeight: 700 }}>✓ Adicionada</span>
                    : <Plus size={16} color="#3182CE" />}
                </button>
              )
            })}
          </div>
        )}
        {resultados.length === 0 && !buscando && query && (
          <p style={{ marginTop: 12, fontSize: 13, color: '#A0AEC0' }}>Nenhum resultado. Tente outro termo.</p>
        )}
      </div>

      {/* Log */}
      {log.length > 0 && (
        <div style={{ background: '#1A202C', borderRadius: 12, padding: '16px 20px', marginBottom: 20, maxHeight: 220, overflow: 'auto' }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: '#68D391', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {processando ? 'Processando...' : '✓ Concluído — categorias criadas no Bling e validadas no ML'}
          </p>
          {log.map((l, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '4px 0' }}>
              <span style={{ fontSize: 12, flexShrink: 0, color: l.status === 'ok' ? '#48BB78' : l.status === 'erro' ? '#FC8181' : l.status === 'validando' ? '#F6E05E' : '#63B3ED' }}>
                {l.status === 'ok' ? '✓' : l.status === 'erro' ? '✗' : l.status === 'validando' ? '⚡' : '…'}
              </span>
              <div>
                <span style={{ fontSize: 12, color: '#E2E8F0', fontWeight: 600 }}>{l.nome}</span>
                <span style={{ fontSize: 12, color: '#718096', marginLeft: 8 }}>{l.msg}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Lista */}
      {lista.length === 0 ? (
        <div style={{ background: '#fff', border: '1.5px dashed #CBD5E0', borderRadius: 14, padding: '48px 24px', textAlign: 'center' }}>
          <Tag size={40} color="#CBD5E0" style={{ marginBottom: 16 }} />
          <p style={{ fontWeight: 700, color: '#A0AEC0', marginBottom: 8 }}>Nenhuma categoria adicionada</p>
          <p style={{ fontSize: 13, color: '#CBD5E0' }}>Busque categorias do ML acima e clique para adicionar</p>
        </div>
      ) : (
        <div>
          {/* Stats */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
            {[
              { label: 'Total', val: lista.length, cor: '#718096' },
              { label: 'No Bling', val: totalCriadas, cor: '#3182CE' },
              { label: 'Validadas ML', val: totalValidadas, cor: '#48BB78' },
            ].map(s => (
              <div key={s.label} style={{ background: '#fff', border: '1.5px solid #E2E8F0', borderRadius: 10, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 20, fontWeight: 800, color: s.cor }}>{s.val}</span>
                <span style={{ fontSize: 12, color: '#718096', fontWeight: 600 }}>{s.label}</span>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {lista.map((cat, idx) => (
              <div key={cat.mlId} style={{
                background: '#fff',
                border: `1.5px solid ${cat.validada ? '#48BB78' : cat.blingId ? '#63B3ED' : '#E2E8F0'}`,
                borderRadius: 11, padding: '13px 16px',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                  {cat.validada
                    ? <ShieldCheck size={17} color="#48BB78" style={{ flexShrink: 0 }} />
                    : cat.blingId
                    ? <CheckCircle size={17} color="#63B3ED" style={{ flexShrink: 0 }} />
                    : <div style={{ width: 17, height: 17, borderRadius: '50%', border: '2px solid #CBD5E0', flexShrink: 0 }} />}
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: 14, fontWeight: 700, color: '#1A202C' }}>{cat.mlNome}</p>
                    <div style={{ display: 'flex', gap: 8, marginTop: 3, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 11, color: '#A0AEC0', fontFamily: 'monospace' }}>{cat.mlId}</span>
                      {cat.blingId && <span style={{ fontSize: 11, color: '#3182CE', fontWeight: 600 }}>Bling #{cat.blingId}</span>}
                      {cat.validada && <span style={{ fontSize: 11, color: '#48BB78', fontWeight: 600 }}>✓ ML ok</span>}
                      {cat.atributos?.length > 0 && <span style={{ fontSize: 11, color: '#718096' }}>{cat.atributos.length} atrib.</span>}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  {!cat.blingId && (
                    <button onClick={() => processarUma(idx)} disabled={processando}
                      style={{ fontSize: 12, fontWeight: 700, color: '#3182CE', background: 'rgba(49,130,206,0.08)', border: '1px solid rgba(49,130,206,0.2)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}>
                      Criar + Validar
                    </button>
                  )}
                  {cat.blingId && !cat.validada && (
                    <button onClick={() => processarUma(idx)} disabled={processando}
                      style={{ fontSize: 12, fontWeight: 700, color: '#D69E2E', background: 'rgba(214,158,46,0.08)', border: '1px solid rgba(214,158,46,0.2)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}>
                      Revalidar
                    </button>
                  )}
                  <button onClick={() => remover(cat.mlId)}
                    style={{ background: 'none', border: 'none', padding: 4, cursor: 'pointer', color: '#CBD5E0' }}
                    onMouseEnter={e => e.currentTarget.style.color = '#FC8181'}
                    onMouseLeave={e => e.currentTarget.style.color = '#CBD5E0'}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {(totalCriadas < lista.length || totalValidadas < lista.length) && (
            <div style={{ marginTop: 16, background: '#EBF8FF', border: '1.5px solid #BEE3F8', borderRadius: 10, padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <p style={{ fontSize: 13, color: '#2B6CB0', fontWeight: 600 }}>
                {lista.length - totalValidadas} categorias pendentes de criação/validação
              </p>
              <button onClick={processarTodas} disabled={processando}
                style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#3182CE', color: '#fff', border: 'none', borderRadius: 7, padding: '7px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                <Zap size={12} /> Processar todas
              </button>
            </div>
          )}
        </div>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
