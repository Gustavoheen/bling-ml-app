import { useState, useMemo, useCallback } from 'react'
import {
  getClienteAtivo, getProdutos, getMapeamentos, getCategoriasProdutos,
  atualizarTokensML, adicionarHistorico, salvarProdutos,
  salvarMapeamentos, atualizarTokensBling
} from '../lib/storage'
import { publicarProduto, blingParaMLPayload, refreshToken as mlRefresh } from '../lib/ml'
import { atualizarProduto, getProdutoDetalhe, normalizarProduto, refreshToken as blingRefresh } from '../lib/bling'
import {
  Upload, CheckCircle, XCircle, Clock, AlertCircle,
  Search, ChevronDown, ChevronUp, Save, Settings,
  Wrench, ArrowRight, Loader, Play
} from 'lucide-react'

// ─── tokens ──────────────────────────────────────────────
async function getMLToken(cliente) {
  if (!cliente.ml?.accessToken) throw new Error('Mercado Livre não conectado.')
  const exp = cliente.ml.expiresAt && Date.now() > cliente.ml.expiresAt - 60000
  if (exp && cliente.ml.refreshToken) {
    const n = await mlRefresh(cliente.ml.refreshToken)
    atualizarTokensML(cliente.id, n); return n.accessToken
  }
  return cliente.ml.accessToken
}
async function getBlingToken(cliente) {
  if (!cliente.bling?.accessToken) throw new Error('Bling não conectado.')
  const exp = cliente.bling.expiresAt && Date.now() > cliente.bling.expiresAt - 60000
  if (exp && cliente.bling.refreshToken) {
    const n = await blingRefresh(cliente.bling.refreshToken)
    atualizarTokensBling(cliente.id, n); return n.accessToken
  }
  return cliente.bling.accessToken
}

// ─── validação ───────────────────────────────────────────
const PROBLEMAS_DEF = [
  { id: 'preco',      label: 'Preço inválido',        check: p => !p.preco || Number(p.preco) <= 0 },
  { id: 'descricao',  label: 'Sem descrição',          check: p => !p.descricaoCurta?.trim() && !p.descricaoComplementar?.trim() && !p.nome?.trim() },
  { id: 'imagem',     label: 'Sem imagem',             check: p => !p.imagemURL && !(Array.isArray(p.imagens) && p.imagens.length > 0), aviso: true },
  { id: 'categoria',  label: 'Categoria não mapeada',  check: (p, m) => !m },
  { id: 'atributos',  label: 'Atributos incompletos',  check: (p, m) => m && (m.atributos||[]).some(a=>!a.valor?.trim()) },
]

function getProblemas(produto, mapa) {
  // problemas com aviso:true não bloqueiam exportação
  return PROBLEMAS_DEF.filter(d => !d.aviso && d.check(produto, mapa)).map(d => d.id)
}
function getAvisos(produto, mapa) {
  return PROBLEMAS_DEF.filter(d => d.aviso && d.check(produto, mapa)).map(d => d.id)
}

function parsearErroML(msg) {
  const s = []
  if (!msg) return s
  if (msg.includes('title'))       s.push({ campo: 'nome',         msg: 'Problema no título' })
  if (msg.includes('price'))       s.push({ campo: 'preco',        msg: 'Preço inválido ou abaixo do mínimo' })
  if (msg.includes('description')) s.push({ campo: 'descricao',    msg: 'Descrição inválida ou muito curta' })
  if (msg.includes('picture') || msg.includes('image')) s.push({ campo: 'imagem', msg: 'Imagem inválida ou inacessível' })
  if (msg.includes('attribute'))   s.push({ campo: 'atributos',    msg: 'Atributo obrigatório inválido' })
  if (msg.includes('category'))    s.push({ campo: 'categoria',    msg: 'Categoria não aceita pelo ML' })
  if (s.length === 0) s.push({ campo: 'geral', msg })
  return s
}

// ─── componente campo ─────────────────────────────────────
function CampoFix({ label, tipo = 'text', valor, onChange, destaque }) {
  return (
    <div>
      <label style={{ fontSize: 12, fontWeight: 700, color: '#4A5568', display: 'block', marginBottom: 4 }}>
        {label} <span style={{ color: '#FC8181' }}>*</span>
      </label>
      {tipo === 'textarea'
        ? <textarea rows={2} value={valor || ''} onChange={e => onChange(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', border: `1.5px solid ${destaque ? '#FC8181' : '#FBD38D'}`, borderRadius: 6, fontSize: 13, outline: 'none', resize: 'vertical', boxSizing: 'border-box' }} />
        : <input type={tipo} value={valor || ''} onChange={e => onChange(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', border: `1.5px solid ${destaque ? '#FC8181' : '#FBD38D'}`, borderRadius: 6, fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
      }
    </div>
  )
}

// ─── página principal ─────────────────────────────────────
export default function Exportacao() {
  const cliente = getClienteAtivo()
  const [produtos, setProdutos] = useState(() => getProdutos(cliente?.id || ''))
  const mapsArr = getMapeamentos(cliente?.id || '')
  const [mapeamentos, setMapeamentos] = useState(() => {
    const m = {}
    for (const i of (Array.isArray(mapsArr) ? mapsArr : [])) m[i.categoriaBling] = i
    return m
  })
  const categoriasProdutos = getCategoriasProdutos(cliente?.id || '')

  // config exportação
  const [config, setConfig] = useState(() => { try { return JSON.parse(localStorage.getItem('bml_export_config') || '{}') } catch { return {} } })
  const [mostrarConfig, setMostrarConfig] = useState(false)
  function salvarConfig(c) { setConfig(c); localStorage.setItem('bml_export_config', JSON.stringify(c)) }

  // enriquece produtos com análise
  const produtosAnalisados = useMemo(() => produtos.map(p => {
    const cat = p.categoria?.nome || 'Sem categoria'
    const mapa = categoriasProdutos[p.id] || mapeamentos[cat]
    const problemas = getProblemas(p, mapa)
    const avisos = getAvisos(p, mapa)
    return { ...p, _cat: cat, _mapa: mapa, _problemas: problemas, _avisos: avisos, _ok: problemas.length === 0 }
  }), [produtos, mapeamentos, categoriasProdutos])

  const prontos     = produtosAnalisados.filter(p => p._ok)
  const comProblema = produtosAnalisados.filter(p => !p._ok)

  // modo de exportação: 'bling' = atualiza produto no Bling (integração nativa), 'ml' = API ML direta
  const [modoExport, setModoExport] = useState('bling')

  // estado exportação
  const [resultados,   setResultados]   = useState({}) // id → {status,mlId,errosML}
  const [exportando,   setExportando]   = useState(false)
  const [selecionados, setSelecionados] = useState(new Set())
  const [logAuto,      setLogAuto]      = useState([])
  const [sucessosAuto, setSucessosAuto] = useState(0)

  // estado correção
  const [aba,        setAba]        = useState('prontos')
  const [busca,      setBusca]      = useState('')
  const [expandido,  setExpandido]  = useState(null)
  const [fixes,      setFixes]      = useState({})   // {prodId: {campo:valor}}
  const [salvando,   setSalvando]   = useState({})
  const [selProb,    setSelProb]    = useState(new Set()) // selecionados na aba problemas

  // filtra lista atual
  const listaAtual = aba === 'prontos' ? prontos : comProblema
  const filtrada = useMemo(() => {
    if (!busca.trim()) return listaAtual
    const q = busca.toLowerCase()
    return listaAtual.filter(p => p.nome?.toLowerCase().includes(q) || p.codigo?.toLowerCase().includes(q))
  }, [listaAtual, busca])

  // ── exportar via Bling ────────────────────────────────
  // Atualiza o produto no Bling com categoria + características ML.
  // A integração nativa Bling↔ML sincroniza automaticamente.
  async function exportarListaViaBling(lista, blingToken) {
    for (const produto of lista) {
      setResultados(r => ({ ...r, [produto.id]: { status: 'enviando' } }))
      try {
        const mapa = produto._mapa
        const fixProduto = fixes[produto.id] || {}

        // Monta características mesclando as existentes com os atributos ML
        const existentes = Array.isArray(produto.caracteristicas) ? produto.caracteristicas : []
        const existentesMap = {}
        for (const c of existentes) existentesMap[(c.descricao || '').toLowerCase()] = c
        for (const a of (mapa.atributos || [])) {
          const key = (a.name || '').toLowerCase()
          const valor = fixProduto[`attr_${a.id}`] ?? a.valor ?? ''
          if (valor) existentesMap[key] = { descricao: a.name, valor }
        }

        const dados = {
          preco: parseFloat(fixProduto.preco || produto.preco) || produto.preco,
          descricaoCurta: fixProduto.descricaoCurta || produto.descricaoCurta || undefined,
          caracteristicas: Object.values(existentesMap).filter(c => c.valor),
          ...(produto.categoria?.id ? { categoria: { id: produto.categoria.id } } : {}),
        }

        await atualizarProduto(blingToken, produto.id, dados)
        setResultados(r => ({ ...r, [produto.id]: { status: 'ok' } }))
        adicionarHistorico(cliente.id, { tipo: 'publicar', produtoId: produto.id, produtoNome: produto.nome, status: 'ok', via: 'bling' })
      } catch (e) {
        setResultados(r => ({ ...r, [produto.id]: { status: 'erro', msg: e.message, errosML: [] } }))
        adicionarHistorico(cliente.id, { tipo: 'publicar', produtoId: produto.id, produtoNome: produto.nome, status: 'erro', erro: e.message })
      }
      await new Promise(r => setTimeout(r, 400))
    }
  }

  // ── exportar via API ML direta ─────────────────────────
  async function exportarListaViaML(lista, mlToken, blingToken) {
    for (const produto of lista) {
      setResultados(r => ({ ...r, [produto.id]: { status: 'enviando' } }))
      try {
        // Busca dados completos do Bling (imagens, descrição, etc.)
        let produtoCompleto = produto
        if (blingToken) {
          try {
            const detalhe = await getProdutoDetalhe(blingToken, produto.id)
            produtoCompleto = { ...normalizarProduto(detalhe), _mapa: produto._mapa, _cat: produto._cat, _problemas: produto._problemas, _ok: produto._ok }
          } catch { /* usa dados locais se falhar */ }
        }

        const payload = blingParaMLPayload(produtoCompleto, produtoCompleto._mapa.mlCategoryId, produtoCompleto._mapa.atributos || [], config)
        const resp = await publicarProduto(mlToken, payload)
        setResultados(r => ({ ...r, [produto.id]: { status: 'ok', mlId: resp.id } }))
        adicionarHistorico(cliente.id, { tipo: 'publicar', produtoId: produto.id, produtoNome: produto.nome, mlId: resp.id, status: 'ok', via: 'ml' })
      } catch (e) {
        const errosML = parsearErroML(e.message)
        setResultados(r => ({ ...r, [produto.id]: { status: 'erro', msg: e.message, errosML } }))
        adicionarHistorico(cliente.id, { tipo: 'publicar', produtoId: produto.id, produtoNome: produto.nome, status: 'erro', erro: e.message })
        const fixErros = {}
        errosML.forEach(er => { fixErros[er.campo] = fixes[produto.id]?.[er.campo] || '' })
        setFixes(f => ({ ...f, [produto.id]: { ...(f[produto.id] || {}), ...fixErros } }))
      }
      await new Promise(r => setTimeout(r, 600))
    }
  }

  // ── testar publicação automática (tenta todos até 10 ok) ──
  async function testarPublicacaoAuto() {
    if (exportando) return
    setExportando(true)
    setLogAuto([])
    setSucessosAuto(0)

    const log = (msg, tipo = 'info') => setLogAuto(l => [...l, { msg, tipo, ts: new Date().toLocaleTimeString() }])

    try {
      const c = getClienteAtivo()
      const mlToken = await getMLToken(c)
      const blingToken = c?.bling?.accessToken ? await getBlingToken(c) : null

      // Ordena: com imagem primeiro, depois por preço > 0
      const candidatos = [...produtosAnalisados].filter(p => p._mapa).sort((a, b) => {
        const aScore = (a.imagemURL ? 2 : 0) + (a.preco > 0 ? 1 : 0)
        const bScore = (b.imagemURL ? 2 : 0) + (b.preco > 0 ? 1 : 0)
        return bScore - aScore
      })

      if (!candidatos.length) { log('Nenhum produto com categoria mapeada encontrado.', 'erro'); setExportando(false); return }

      log(`Iniciando teste com ${candidatos.length} produtos (meta: 10 publicações bem-sucedidas)`)
      let sucessos = 0

      for (const produto of candidatos) {
        if (sucessos >= 10) break
        log(`Tentando: ${produto.nome.slice(0, 60)}...`)
        setResultados(r => ({ ...r, [produto.id]: { status: 'enviando' } }))

        try {
          let produtoCompleto = produto
          if (blingToken) {
            try {
              const detalhe = await getProdutoDetalhe(blingToken, produto.id)
              produtoCompleto = { ...normalizarProduto(detalhe), _mapa: produto._mapa }
            } catch {}
          }

          const payload = blingParaMLPayload(produtoCompleto, produtoCompleto._mapa.mlCategoryId, produtoCompleto._mapa.atributos || [], config)
          const resp = await publicarProduto(mlToken, payload)
          sucessos++
          setSucessosAuto(sucessos)
          setResultados(r => ({ ...r, [produto.id]: { status: 'ok', mlId: resp.id } }))
          adicionarHistorico(c.id, { tipo: 'publicar', produtoId: produto.id, produtoNome: produto.nome, mlId: resp.id, status: 'ok', via: 'ml-auto' })
          log(`✓ Sucesso ${sucessos}/10 → ML ID: ${resp.id}`, 'ok')
        } catch (e) {
          const errosML = parsearErroML(e.message)
          setResultados(r => ({ ...r, [produto.id]: { status: 'erro', msg: e.message, errosML } }))
          log(`✗ Erro: ${e.message}`, 'erro')
        }

        await new Promise(r => setTimeout(r, 800))
      }

      if (sucessos >= 10) log(`Meta atingida! ${sucessos} produtos publicados com sucesso.`, 'ok')
      else log(`Concluído. ${sucessos} de ${candidatos.length} produtos publicados.`, sucessos > 0 ? 'ok' : 'erro')
    } catch (e) {
      log(`Erro fatal: ${e.message}`, 'erro')
    }

    setExportando(false)
  }

  // ── exportar (roteador) ────────────────────────────────
  async function exportarLista(lista) {
    if (!lista.length) return
    setExportando(true)

    try {
      const c = getClienteAtivo()
      if (modoExport === 'bling') {
        if (!c?.bling?.accessToken) throw new Error('Bling não conectado.')
        await exportarListaViaBling(lista, c.bling.accessToken)
      } else {
        const mlToken = await getMLToken(c)
        const blingToken = c?.bling?.accessToken ? await getBlingToken(c) : null
        await exportarListaViaML(lista, mlToken, blingToken)
      }
    } catch (e) {
      alert(e.message)
    }

    setExportando(false)
    const temErro = lista.some(p => resultados[p.id]?.status === 'erro')
    if (temErro) setAba('problemas')
  }

  function publicarTudo() { exportarLista(prontos) }
  function publicarSelecionados() { exportarLista(prontos.filter(p => selecionados.has(p.id))) }

  // ── salvar correção no Bling ──────────────────────────
  async function salvarFix(produto) {
    const dados = fixes[produto.id]
    if (!dados || !Object.keys(dados).length) return
    setSalvando(s => ({ ...s, [produto.id]: true }))
    try {
      // Separa dados do produto dos atributos
      const dadosProduto = {}
      const dadosAtributos = {}
      Object.entries(dados).forEach(([k, v]) => {
        if (k.startsWith('attr_')) dadosAtributos[k.replace('attr_','')] = v
        else dadosProduto[k] = v
      })

      // Salva dados do produto no Bling
      if (Object.keys(dadosProduto).length) {
        const blingToken = await getBlingToken(getClienteAtivo())
        await atualizarProduto(blingToken, produto.id, dadosProduto)
        // Atualiza lista local
        const atual = getProdutos(cliente.id)
        const nova = atual.map(p => p.id === produto.id ? { ...p, ...dadosProduto } : p)
        salvarProdutos(cliente.id, nova)
        setProdutos(nova)
      }

      // Salva atributos no mapeamento
      if (Object.keys(dadosAtributos).length) {
        const mapa = mapeamentos[produto._cat]
        if (mapa) {
          const novosAtrs = mapa.atributos.map(a => dadosAtributos[a.id] !== undefined ? { ...a, valor: dadosAtributos[a.id] } : a)
          const novoMapa = { ...mapeamentos, [produto._cat]: { ...mapa, atributos: novosAtrs } }
          setMapeamentos(novoMapa)
          salvarMapeamentos(cliente.id, Object.values(novoMapa))
        }
      }

      setFixes(f => { const n = { ...f }; delete n[produto.id]; return n })
      setExpandido(null)
    } catch (e) {
      alert('Erro ao salvar: ' + e.message)
    } finally {
      setSalvando(s => ({ ...s, [produto.id]: false }))
    }
  }

  // ── campos por problema ───────────────────────────────
  function renderCamposProblema(produto) {
    const problemas = [
      ...produto._problemas,
      ...(resultados[produto.id]?.errosML?.map(e => e.campo) || [])
    ]
    const uniqueProblemas = [...new Set(problemas)]
    const mapa = produto._mapa

    return (
      <div style={{ borderTop: '1px solid #F7FAFC', padding: '14px 16px', background: '#FAFBFC' }}>
        {/* Erros do ML se houver */}
        {resultados[produto.id]?.errosML?.length > 0 && (
          <div style={{ background: 'rgba(252,129,74,0.08)', border: '1px solid #FC8181', borderRadius: 8, padding: '10px 14px', marginBottom: 14 }}>
            <p style={{ fontSize: 12, fontWeight: 800, color: '#FC8181', marginBottom: 6 }}>Erro retornado pelo ML — corrija e reenvie:</p>
            {resultados[produto.id].errosML.map((e,i) => (
              <p key={i} style={{ fontSize: 12, color: '#C53030' }}>• {e.msg}</p>
            ))}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
          {uniqueProblemas.includes('preco') && (
            <CampoFix label="Preço (R$)" tipo="number"
              valor={fixes[produto.id]?.preco ?? produto.preco}
              onChange={v => setFixes(f => ({ ...f, [produto.id]: { ...f[produto.id], preco: v } }))}
              destaque={resultados[produto.id]?.errosML?.some(e => e.campo === 'preco')} />
          )}
          {uniqueProblemas.includes('descricao') && (
            <CampoFix label="Descrição" tipo="textarea"
              valor={fixes[produto.id]?.descricaoCurta ?? produto.descricaoCurta}
              onChange={v => setFixes(f => ({ ...f, [produto.id]: { ...f[produto.id], descricaoCurta: v } }))}
              destaque={resultados[produto.id]?.errosML?.some(e => e.campo === 'descricao')} />
          )}
        </div>

        {uniqueProblemas.includes('imagem') && (
          <div style={{ background: 'rgba(252,193,7,0.08)', border: '1px solid rgba(252,193,7,0.3)', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: '#D69E2E' }}>
            ⚠ Imagem ausente — adicione no Bling e sincronize novamente.
          </div>
        )}

        {uniqueProblemas.includes('categoria') && (
          <div style={{ background: 'rgba(99,179,237,0.08)', border: '1px solid rgba(99,179,237,0.3)', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: '#3182CE' }}>
            {produto._cat.toLowerCase() === 'sem categoria'
              ? <>ℹ Este produto não tem categoria no Bling. Vá em <strong>Mapeamento</strong>, clique em <strong>"Sem categoria"</strong> e pesquise o tipo do produto (ex: "Cadeiras", "Sofás").</>
              : <>ℹ Categoria "{produto._cat}" não mapeada — vá em <strong>Mapeamento</strong> e use "Auto-mapear tudo".</>
            }
          </div>
        )}

        {uniqueProblemas.includes('atributos') && mapa?.atributos?.filter(a => !a.valor?.trim()).length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: '#D69E2E', marginBottom: 8 }}>
              Atributos obrigatórios para "{mapa.mlCategoryName}" — aplicado a todos os produtos desta categoria:
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {mapa.atributos.filter(a => !a.valor?.trim()).map(a => (
                <CampoFix key={a.id} label={a.name}
                  valor={fixes[produto.id]?.[`attr_${a.id}`] ?? a.valor}
                  onChange={v => setFixes(f => ({ ...f, [produto.id]: { ...f[produto.id], [`attr_${a.id}`]: v } }))}
                  destaque={resultados[produto.id]?.errosML?.some(e => e.campo === 'atributos')} />
              ))}
            </div>
          </div>
        )}

        {(fixes[produto.id] && Object.keys(fixes[produto.id]).length > 0) && (
          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <button onClick={() => salvarFix(produto)} disabled={salvando[produto.id]}
              style={{ display: 'flex', alignItems: 'center', gap: 7, background: '#1A202C', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 700 }}>
              {salvando[produto.id] ? <Loader size={13} style={{ animation:'spin 1s linear infinite' }} /> : <Save size={13} />}
              {salvando[produto.id] ? 'Salvando...' : 'Salvar e corrigir'}
            </button>
            {resultados[produto.id]?.status === 'erro' && (
              <button onClick={() => exportarLista([produto])} disabled={exportando}
                style={{ display: 'flex', alignItems: 'center', gap: 7, background: '#3182CE', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 700 }}>
                <Upload size={13} /> Reenviar para ML
              </button>
            )}
          </div>
        )}
      </div>
    )
  }

  const okCount   = Object.values(resultados).filter(r => r.status === 'ok').length
  const errCount  = Object.values(resultados).filter(r => r.status === 'erro').length

  if (produtos.length === 0) {
    return (
      <div>
        <h2 style={{ fontSize: 20, fontWeight: 800, color: '#1A202C', marginBottom: 24 }}>Exportação para ML</h2>
        <div style={{ background: '#fff', border: '1.5px dashed #CBD5E0', borderRadius: 14, padding: '48px 24px', textAlign: 'center' }}>
          <Upload size={40} color="#CBD5E0" style={{ marginBottom: 16 }} />
          <p style={{ fontWeight: 700, color: '#A0AEC0' }}>Sincronize produtos primeiro na aba "Produtos".</p>
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: '#1A202C', marginBottom: 4 }}>Exportação para ML</h2>
          <p style={{ fontSize: 13, color: '#718096' }}>
            <span style={{ color: '#48BB78', fontWeight: 700 }}>{prontos.length} prontos</span>
            {' · '}
            <span style={{ color: comProblema.length > 0 ? '#FC8181' : '#718096', fontWeight: comProblema.length > 0 ? 700 : 400 }}>{comProblema.length} com problema</span>
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {/* Seletor de modo */}
          <div style={{ background: '#F7FAFC', border: '1.5px solid #E2E8F0', borderRadius: 8, padding: '4px', display: 'flex', gap: 2 }}>
            <button onClick={() => setModoExport('bling')}
              style={{ padding: '6px 12px', borderRadius: 6, border: 'none', fontSize: 12, fontWeight: 700, background: modoExport === 'bling' ? '#1A202C' : 'none', color: modoExport === 'bling' ? '#fff' : '#718096', cursor: 'pointer' }}>
              via Bling
            </button>
            <button onClick={() => setModoExport('ml')}
              style={{ padding: '6px 12px', borderRadius: 6, border: 'none', fontSize: 12, fontWeight: 700, background: modoExport === 'ml' ? '#1A202C' : 'none', color: modoExport === 'ml' ? '#fff' : '#718096', cursor: 'pointer' }}>
              via API ML
            </button>
          </div>
          <button onClick={testarPublicacaoAuto} disabled={exportando}
            style={{ display: 'flex', alignItems: 'center', gap: 7, background: exportando ? '#CBD5E0' : '#805AD5', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 16px', fontSize: 13, fontWeight: 800 }}>
            <Play size={13} />
            {exportando ? 'Testando...' : 'Auto-testar (meta: 10)'}
          </button>
          {prontos.length > 0 && (
            <button onClick={publicarTudo} disabled={exportando}
              style={{ display: 'flex', alignItems: 'center', gap: 8, background: exportando ? '#CBD5E0' : '#48BB78', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: 13, fontWeight: 800 }}>
              <Upload size={14} />
              {exportando ? 'Publicando...' : `Publicar tudo (${prontos.length})`}
            </button>
          )}
        </div>
      </div>

      {/* Log auto-teste */}
      {logAuto.length > 0 && (
        <div style={{ background: '#1A202C', borderRadius: 12, padding: 16, marginBottom: 16, maxHeight: 220, overflowY: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 800, color: '#A0AEC0' }}>LOG AUTO-TESTE</span>
            <span style={{ fontSize: 13, fontWeight: 800, color: sucessosAuto >= 10 ? '#48BB78' : '#63B3ED' }}>
              {sucessosAuto}/10 publicados
            </span>
          </div>
          {logAuto.map((l, i) => (
            <p key={i} style={{ fontSize: 11, fontFamily: 'monospace', color: l.tipo === 'ok' ? '#68D391' : l.tipo === 'erro' ? '#FC8181' : '#CBD5E0', marginBottom: 3 }}>
              [{l.ts}] {l.msg}
            </p>
          ))}
        </div>
      )}

      {/* Resultados */}
      {(okCount > 0 || errCount > 0) && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
          {okCount > 0 && (
            <div style={{ background: 'rgba(72,187,120,0.1)', border: '1px solid #48BB78', borderRadius: 10, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <CheckCircle size={15} color="#48BB78" />
              <span style={{ fontSize: 13, fontWeight: 700, color: '#48BB78' }}>{okCount} publicado{okCount > 1 ? 's' : ''}</span>
            </div>
          )}
          {errCount > 0 && (
            <div onClick={() => setAba('problemas')}
              style={{ background: 'rgba(252,129,74,0.1)', border: '1px solid #FC8181', borderRadius: 10, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <XCircle size={15} color="#FC8181" />
              <span style={{ fontSize: 13, fontWeight: 700, color: '#FC8181' }}>{errCount} com erro — clique para corrigir</span>
              <ArrowRight size={13} color="#FC8181" />
            </div>
          )}
        </div>
      )}

      {/* Config exportação */}
      <div style={{ background: '#fff', border: '1.5px solid #E2E8F0', borderRadius: 12, marginBottom: 16, overflow: 'hidden' }}>
        <button onClick={() => setMostrarConfig(!mostrarConfig)}
          style={{ width: '100%', padding: '11px 16px', background: 'none', border: 'none', textAlign: 'left', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#718096', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Settings size={13} /> Configurações padrão
          </span>
          <span style={{ fontSize: 12, color: '#A0AEC0' }}>
            {config.listingType || 'gold_special'} · {config.condition || 'novo'} · {config.catalogListing ? 'com catálogo' : 'sem catálogo'} {mostrarConfig ? '▲' : '▼'}
          </span>
        </button>
        {mostrarConfig && (
          <div style={{ borderTop: '1px solid #F7FAFC', padding: 16, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: '#4A5568', display: 'block', marginBottom: 6 }}>Tipo de anúncio</label>
              <select value={config.listingType || 'gold_special'} onChange={e => salvarConfig({ ...config, listingType: e.target.value })}
                style={{ width: '100%', padding: '8px 10px', border: '1.5px solid #E2E8F0', borderRadius: 6, fontSize: 13, background: '#fff' }}>
                <option value="gold_special">Clássico</option>
                <option value="gold_pro">Premium</option>
                <option value="gold_premium">Gold Premium</option>
                <option value="free">Grátis</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: '#4A5568', display: 'block', marginBottom: 6 }}>Condição</label>
              <select value={config.condition || 'new'} onChange={e => salvarConfig({ ...config, condition: e.target.value })}
                style={{ width: '100%', padding: '8px 10px', border: '1.5px solid #E2E8F0', borderRadius: 6, fontSize: 13, background: '#fff' }}>
                <option value="new">Novo</option>
                <option value="used">Usado</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: '#4A5568', display: 'block', marginBottom: 6 }}>Catálogo ML</label>
              <select value={config.catalogListing ? 'sim' : 'nao'} onChange={e => salvarConfig({ ...config, catalogListing: e.target.value === 'sim' })}
                style={{ width: '100%', padding: '8px 10px', border: '1.5px solid #E2E8F0', borderRadius: 6, fontSize: 13, background: '#fff' }}>
                <option value="nao">Não subir como catálogo</option>
                <option value="sim">Subir como catálogo</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Abas */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 14, background: '#F7FAFC', borderRadius: 10, padding: 4, width: 'fit-content' }}>
        {[
          { id: 'prontos',   label: `✓ Prontos (${prontos.length})` },
          { id: 'problemas', label: `⚠ Com problemas (${comProblema.length})` },
        ].map(a => (
          <button key={a.id} onClick={() => setAba(a.id)}
            style={{ padding: '7px 18px', borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 700, background: aba === a.id ? '#fff' : 'none', color: aba === a.id ? '#1A202C' : '#718096', boxShadow: aba === a.id ? '0 1px 4px rgba(0,0,0,0.08)' : 'none' }}>
            {a.label}
          </button>
        ))}
      </div>

      {/* Busca */}
      <div style={{ position: 'relative', marginBottom: 12 }}>
        <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#A0AEC0' }} />
        <input type="text" placeholder="Buscar produtos..." value={busca} onChange={e => setBusca(e.target.value)}
          style={{ width: '100%', padding: '9px 12px 9px 36px', border: '1.5px solid #E2E8F0', borderRadius: 8, fontSize: 14, outline: 'none', boxSizing: 'border-box', background: '#fff' }} />
      </div>

      {/* ── ABA PRONTOS ── */}
      {aba === 'prontos' && (
        <div style={{ background: '#fff', border: '1.5px solid #E2E8F0', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1.5px solid #E2E8F0', background: '#F7FAFC' }}>
                <th style={{ padding: '10px 16px', width: 40 }}>
                  <input type="checkbox"
                    checked={selecionados.size === prontos.length && prontos.length > 0}
                    onChange={() => setSelecionados(s => s.size === prontos.length ? new Set() : new Set(prontos.map(p => p.id)))} />
                </th>
                <th style={TH}>Produto</th>
                <th style={TH}>Categoria ML</th>
                <th style={{ ...TH, textAlign: 'right' }}>Preço</th>
                <th style={{ ...TH, textAlign: 'center' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtrada.slice(0, 300).map((p, i) => {
                const res = resultados[p.id]
                return (
                  <tr key={p.id} style={{ borderBottom: '1px solid #F7FAFC', background: i % 2 === 0 ? '#fff' : '#FAFBFC' }}>
                    <td style={{ padding: '10px 16px' }}>
                      <input type="checkbox" checked={selecionados.has(p.id)} onChange={() => setSelecionados(s => { const n = new Set(s); n.has(p.id) ? n.delete(p.id) : n.add(p.id); return n })} />
                    </td>
                    <td style={{ padding: '10px 16px' }}>
                      <p style={{ fontSize: 13, fontWeight: 600, color: '#1A202C' }}>{p.nome}</p>
                      <p style={{ fontSize: 11, color: '#718096', marginTop: 2 }}>{p._cat}</p>
                      {p._avisos?.includes('imagem') && <p style={{ fontSize: 10, color: '#D69E2E', marginTop: 2 }}>⚠ Sem imagem no Bling</p>}
                    </td>
                    <td style={{ padding: '10px 16px' }}><span style={{ fontSize: 12, color: '#4A5568' }}>{p._mapa?.mlCategoryName}</span></td>
                    <td style={{ padding: '10px 16px', textAlign: 'right' }}><span style={{ fontSize: 13, fontWeight: 700 }}>{p.preco ? `R$ ${Number(p.preco).toFixed(2)}` : '—'}</span></td>
                    <td style={{ padding: '10px 16px', textAlign: 'center' }}>
                      {!res && <CheckCircle size={14} color="#48BB78" />}
                      {res?.status === 'enviando' && <Clock size={14} color="#63B3ED" style={{ animation: 'spin 1s linear infinite' }} />}
                      {res?.status === 'ok' && <div><CheckCircle size={14} color="#48BB78" /><span style={{ fontSize: 10, color: '#718096', display: 'block', fontFamily: 'monospace' }}>{res.mlId}</span></div>}
                      {res?.status === 'erro' && <button onClick={() => { setAba('problemas'); setExpandido(p.id) }} style={{ background: 'none', border: 'none', color: '#FC8181', fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}><Wrench size={12} /> Corrigir</button>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {selecionados.size > 0 && (
            <div style={{ padding: '12px 16px', borderTop: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 13, color: '#718096' }}>{selecionados.size} selecionados</span>
              <button onClick={publicarSelecionados} disabled={exportando}
                style={{ background: '#1A202C', color: '#fff', border: 'none', borderRadius: 7, padding: '8px 18px', fontSize: 13, fontWeight: 700 }}>
                Publicar selecionados
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── ABA PROBLEMAS ── */}
      {aba === 'problemas' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtrada.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#718096' }}>
              <CheckCircle size={32} color="#48BB78" style={{ marginBottom: 12 }} />
              <p style={{ fontWeight: 700 }}>Nenhum problema encontrado!</p>
            </div>
          )}
          {filtrada.slice(0, 100).map(p => {
            const res = resultados[p.id]
            const aberto = expandido === p.id
            const temFix = fixes[p.id] && Object.keys(fixes[p.id]).length > 0

            return (
              <div key={p.id} style={{
                background: '#fff',
                border: `1.5px solid ${res?.status === 'erro' ? '#FC8181' : temFix ? '#FBD38D' : '#E2E8F0'}`,
                borderRadius: 12, overflow: 'hidden',
              }}>
                <button onClick={() => setExpandido(aberto ? null : p.id)}
                  style={{ width: '100%', padding: '13px 16px', background: 'none', border: 'none', textAlign: 'left', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <AlertCircle size={16} color={res?.status === 'erro' ? '#FC8181' : '#D69E2E'} style={{ flexShrink: 0 }} />
                    <div>
                      <p style={{ fontSize: 14, fontWeight: 700, color: '#1A202C' }}>{p.nome}</p>
                      <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                        {p._problemas.map(prob => (
                          <span key={prob} style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: 'rgba(252,193,7,0.12)', color: '#D69E2E' }}>
                            {PROBLEMAS_DEF.find(d => d.id === prob)?.label || prob}
                          </span>
                        ))}
                        {res?.status === 'erro' && res.errosML?.map((e, i) => (
                          <span key={i} style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: 'rgba(252,129,74,0.12)', color: '#C53030' }}>
                            ML: {e.msg}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                    {res?.status === 'enviando' && <Clock size={14} color="#63B3ED" style={{ animation: 'spin 1s linear infinite' }} />}
                    <span style={{ fontSize: 12, color: '#A0AEC0' }}>{aberto ? '▲' : '▼ Corrigir'}</span>
                  </div>
                </button>

                {aberto && renderCamposProblema(p)}
              </div>
            )
          })}
        </div>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

const TH = { padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#718096', textTransform: 'uppercase', letterSpacing: '0.06em' }
