import { useState, useMemo, useCallback } from 'react'
import {
  getClienteAtivo, getProdutos, getMapeamentos, getCategoriasProdutos, salvarCategoriasProdutos,
  atualizarTokensML, adicionarHistorico, salvarProdutos,
  salvarMapeamentos, atualizarTokensBling, getVinculos, salvarVinculo, limparVinculos
} from '../lib/storage'
import { publicarProduto, atualizarDescricao, fecharItem, getMeusItens, getMe, blingParaMLPayload, buscarCategorias, getAtributosCategoria, refreshToken as mlRefresh } from '../lib/ml'
import { atualizarProduto, getProdutoDetalhe, normalizarProduto, refreshToken as blingRefresh } from '../lib/bling'
import {
  Upload, CheckCircle, XCircle, Clock, AlertCircle,
  Search, ChevronDown, ChevronUp, Save, Settings,
  Wrench, ArrowRight, Loader, Play, RefreshCw, ClipboardList, Trash2
} from 'lucide-react'

// ─── helpers mapeamento ──────────────────────────────────
function extrairTipoProduto(nome) {
  const encerrar = new Set(['aço','ferro','madeira','tecido','couro','inox','mdf','vidro','plástico','plastico','estrutura','base','suporte','estilo','luxo','premium','moderno','moderna','clássico','classico','retrátil','retratil','reclinável','reclinavel','marrom','preto','preta','branco','branca','cinza','bege','creme','dourado','prata','natural','grafite','caramelo','verde','azul','vermelho','rose','nude'])
  const pularInicio = new Set(['kit','com','de','em','e','para','ao','da','do','das','dos','um','uma','por','sem','conjunto','novo','nova'])
  const conectivos = new Set(['de','da','do','das','dos'])
  const comodos = new Set(['jantar','sala','escritório','escritorio','cozinha','quarto','banheiro','varanda','jardim','lavabo','corredor','entrada','centro','parede','teto','chão','chao'])
  const palavras = nome.toLowerCase().split(/\s+/)
  let i = 0
  while (i < palavras.length) {
    const p = palavras[i].replace(/[^a-záéíóúâêîôûãõç]/gi, '')
    if (!p || /^\d+$/.test(p) || pularInicio.has(p) || encerrar.has(p)) { i++; continue }
    break
  }
  let resultado = [], tokens = 0
  while (i < palavras.length && tokens < 3) {
    const p = palavras[i].replace(/[^a-záéíóúâêîôûãõç]/gi, '')
    if (!p) { i++; continue }
    if (/^\d+$/.test(p) || encerrar.has(p)) break
    if (conectivos.has(p)) {
      const prox = palavras[i + 1]?.replace(/[^a-záéíóúâêîôûãõç]/gi, '')
      if (!prox || !comodos.has(prox)) break
      resultado.push(p); i++; continue
    }
    resultado.push(p); tokens++; i++
  }
  while (resultado.length && conectivos.has(resultado[resultado.length - 1])) resultado.pop()
  if (!resultado.length) return null
  return resultado.map((w, idx) => (!conectivos.has(w) || idx === 0) ? w.charAt(0).toUpperCase() + w.slice(1) : w).join(' ')
}
function normalizarTipo(tipo) {
  if (!tipo) return 'Outros'
  const t = tipo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  if (t.includes('cadeira')) return 'Cadeiras de Jantar'
  if (t.includes('sofa')) return 'Sofás'
  if (t.includes('poltrona')) return 'Poltronas'
  if (t.includes('mesa') && (t.includes('jantar') || t.includes('sala') || t.includes('escritorio'))) return 'Mesas de Jantar'
  if (t.includes('mesa') && t.includes('centro')) return 'Mesas de Centro'
  if (t.includes('mesa') && t.includes('lateral')) return 'Mesas Laterais'
  if (t.includes('mesa')) return 'Mesas'
  if (t.includes('bandeja')) return 'Bandejas'
  if (t.includes('comoda') || t.includes('como')) return 'Cômodas'
  if (t.includes('aparador')) return 'Aparadores'
  if (t.includes('rack') || (t.includes('painel') && t.includes('tv'))) return 'Racks e Painéis TV'
  if (t.includes('estante')) return 'Estantes'
  if (t.includes('armario')) return 'Armários'
  if (t.includes('buffet')) return 'Buffets'
  if (t.includes('criado') || t.includes('mudo')) return 'Criados-Mudo'
  if (t.includes('escrivaninha')) return 'Escrivaninhas'
  if (t.includes('banco') || t.includes('banqueta')) return 'Bancos e Banquetas'
  return tipo.charAt(0).toUpperCase() + tipo.slice(1)
}

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
  { id: 'categoria',  label: 'Categoria não mapeada',  check: (p, m) => !m },
  // Avisos — não bloqueiam publicação (autoAtributos e fallbacks resolvem na hora de publicar)
  { id: 'imagem',     label: 'Sem imagem',             check: p => !p.imagemURL && !(Array.isArray(p.imagens) && p.imagens.length > 0), aviso: true },
  { id: 'descricao',  label: 'Sem descrição',          check: p => !p.descricaoCurta?.trim() && !p.descricaoComplementar?.trim(), aviso: true },
  { id: 'atributos',  label: 'Atributos incompletos',  check: (p, m) => m && (m.atributos||[]).some(a=>!a.valor?.trim()), aviso: true },
  { id: 'estoque',    label: 'Sem estoque',             check: p => Number(p.estoque?.saldoVirtualTotal) <= 0, aviso: true },
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
  const [categoriasProdutos, setCategoriasProdutos] = useState(() => getCategoriasProdutos(cliente?.id || ''))

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
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // diagnóstico
  const [diagAberto,      setDiagAberto]      = useState(true)
  const [autopreenchendo, setAutopreenchendo] = useState(false)
  const [logDiag,         setLogDiag]         = useState([])
  const [excluindo,       setExcluindo]       = useState(false)
  const [autoMapeando,    setAutoMapeando]    = useState(false)
  const [logMapa,         setLogMapa]         = useState([])

  const criterios = useMemo(() => {
    const total = produtosAnalisados.length
    return {
      total,
      prontos:      prontos.length,
      semPreco:     produtosAnalisados.filter(p => !p.preco || Number(p.preco) <= 0).length,
      semImagem:    produtosAnalisados.filter(p => !p.imagemURL && !(Array.isArray(p.imagens) && p.imagens.length > 0)).length,
      semDescricao: produtosAnalisados.filter(p => !p.descricaoCurta?.trim() && !p.descricaoComplementar?.trim()).length, // aviso, nome é usado como fallback
      semCategoria: produtosAnalisados.filter(p => !p._mapa).length,
      semEstoque:   produtosAnalisados.filter(p => Number(p.estoque?.saldoVirtualTotal) <= 0).length,
      semCodigo:    produtosAnalisados.filter(p => !p.codigo?.trim()).length,
    }
  }, [produtosAnalisados, prontos])

  async function autoPreencher() {
    if (autopreenchendo) return
    setAutopreenchendo(true)
    setLogDiag([])
    const log = (msg, tipo = 'info') => setLogDiag(l => [...l, { msg, tipo, ts: new Date().toLocaleTimeString() }])

    try {
      const c = getClienteAtivo()
      const blingToken = await getBlingToken(c)
      const produtosAtuais = [...getProdutos(c.id)]

      log(`Buscando dados completos de ${produtosAtuais.length} produtos no Bling...`)
      let atualizados = 0

      for (let i = 0; i < produtosAtuais.length; i += 5) {
        const lote = produtosAtuais.slice(i, i + 5)
        const detalhes = await Promise.allSettled(lote.map(p => getProdutoDetalhe(blingToken, p.id)))
        detalhes.forEach((r, idx) => {
          if (r.status === 'fulfilled') {
            const novo = normalizarProduto(r.value)
            const i2 = produtosAtuais.findIndex(p => p.id === novo.id)
            if (i2 >= 0) { produtosAtuais[i2] = { ...produtosAtuais[i2], ...novo }; atualizados++ }
          }
        })
        log(`Progresso: ${Math.min(i + 5, produtosAtuais.length)}/${produtosAtuais.length}`)
        await new Promise(r => setTimeout(r, 300))
      }

      salvarProdutos(c.id, produtosAtuais)
      setProdutos(produtosAtuais)
      log(`✓ ${atualizados} produtos atualizados com dados completos do Bling.`, 'ok')
    } catch (e) {
      setLogDiag(l => [...l, { msg: `✗ Erro: ${e.message}`, tipo: 'erro', ts: new Date().toLocaleTimeString() }])
    }
    setAutopreenchendo(false)
  }

  // ── auto-mapear todas as categorias ──────────────────────
  async function autoMapearTudo() {
    if (autoMapeando) return
    setAutoMapeando(true)
    setLogMapa([])
    const log = (msg, tipo = 'info') => setLogMapa(l => [...l, { msg, tipo, ts: new Date().toLocaleTimeString() }])

    try {
      const c = getClienteAtivo()
      const produtosAtuais = getProdutos(c.id)
      const novoMapa = { ...mapeamentos }

      // 1. Categorias nomeadas
      const categoriasBling = [...new Set(produtosAtuais.map(p => p.categoria?.nome || 'Sem categoria'))]
        .filter(cat => cat.toLowerCase() !== 'sem categoria')

      for (const cat of categoriasBling) {
        if (novoMapa[cat]?.mlCategoryId) { log(`"${cat}" já mapeada`, 'ok'); continue }
        log(`Mapeando "${cat}"...`)
        try {
          const res = await buscarCategorias(cat)
          if (!res || res.length === 0) { log(`"${cat}" — nenhuma categoria ML encontrada`, 'erro'); continue }
          const melhor = res[0]
          let attrs = []
          try { attrs = await getAtributosCategoria(melhor.category_id) } catch {}
          novoMapa[cat] = {
            categoriaBling: cat,
            mlCategoryId: melhor.category_id,
            mlCategoryName: melhor.domain_name || melhor.category_name,
            atributos: attrs.map(a => ({ id: a.id, name: a.name, valor: '' })),
          }
          log(`✓ "${cat}" → ${melhor.domain_name || melhor.category_name}`, 'ok')
        } catch (e) { log(`✗ "${cat}": ${e.message}`, 'erro') }
        await new Promise(r => setTimeout(r, 300))
      }
      setMapeamentos(novoMapa)
      salvarMapeamentos(c.id, Object.values(novoMapa))

      // 2. Produtos "Sem categoria" — mapeia por tipo do nome
      const prodsSemCat = produtosAtuais.filter(p => (p.categoria?.nome || 'Sem categoria').toLowerCase() === 'sem categoria')
      if (prodsSemCat.length > 0) {
        log(`\nMapeando ${prodsSemCat.length} produtos sem categoria por nome...`)
        const gruposTipo = {}
        for (const p of prodsSemCat) {
          const tipo = normalizarTipo(extrairTipoProduto(p.nome) || 'Outros')
          if (!gruposTipo[tipo]) gruposTipo[tipo] = []
          gruposTipo[tipo].push(p)
        }
        const novaCatProdutos = { ...getCategoriasProdutos(c.id) }
        for (const [tipo, prods] of Object.entries(gruposTipo)) {
          // Pula se todos já mapeados
          if (prods.every(p => novaCatProdutos[p.id]?.mlCategoryId)) {
            log(`"${tipo}" (${prods.length}) — já mapeados`, 'ok'); continue
          }
          log(`Buscando "${tipo}" no ML (${prods.length} produtos)...`)
          try {
            const res = await buscarCategorias(tipo)
            if (!res || res.length === 0) { log(`"${tipo}" — não encontrado no ML`, 'erro'); continue }
            const melhor = res[0]
            let attrs = []
            try { attrs = await getAtributosCategoria(melhor.category_id) } catch {}
            for (const p of prods) {
              novaCatProdutos[p.id] = {
                mlCategoryId: melhor.category_id,
                mlCategoryName: melhor.domain_name || melhor.category_name,
                atributos: attrs.map(a => ({ id: a.id, name: a.name, valor: '' })),
              }
            }
            salvarCategoriasProdutos(c.id, novaCatProdutos)
            setCategoriasProdutos({ ...novaCatProdutos })
            log(`✓ "${tipo}" → ${melhor.domain_name || melhor.category_name} (${prods.length} produtos)`, 'ok')
          } catch (e) { log(`✗ "${tipo}": ${e.message}`, 'erro') }
          await new Promise(r => setTimeout(r, 400))
        }
        salvarCategoriasProdutos(c.id, novaCatProdutos)
        setCategoriasProdutos({ ...novaCatProdutos })
      }

      log('\n✓ Mapeamento concluído!', 'ok')
    } catch (e) {
      log(`✗ Erro fatal: ${e.message}`, 'erro')
    }
    setAutoMapeando(false)
  }

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

  // ── helper: publica um produto com retry automático ──────────
  async function publicarComRetry(produto, mlToken, blingToken, log) {
    let produtoCompleto = produto
    if (blingToken) {
      try {
        const detalhe = await getProdutoDetalhe(blingToken, produto.id)
        produtoCompleto = { ...normalizarProduto(detalhe), _mapa: produto._mapa }
      } catch {}
    }

    const payload = blingParaMLPayload(produtoCompleto, produtoCompleto._mapa.mlCategoryId, produtoCompleto._mapa.atributos || [], config)

    let resp
    try {
      resp = await publicarProduto(mlToken, payload)
    } catch (e1) {
      if (e1.message?.includes('temporarily unavailable')) {
        if (log) log('  ↳ ML temporariamente indisponível, aguardando 15s...', 'info')
        await new Promise(r => setTimeout(r, 15000))
        resp = await publicarProduto(mlToken, payload)
      } else {
        // Para qualquer outro erro (me1, required_fields, etc.) tenta sem shipping
        if (log) log(`  ↳ Erro: ${e1.message?.slice(0, 80)} — tentando sem shipping...`, 'info')
        const { shipping: _, ...payloadSemShipping } = payload
        resp = await publicarProduto(mlToken, payloadSemShipping)
      }
    }

    // Envia descrição separadamente (endpoint dedicado do ML)
    if (resp?.id) {
      const descricao = (produtoCompleto.descricaoComplementar || produtoCompleto.descricaoCurta || '').trim()
      if (descricao) {
        try { await atualizarDescricao(mlToken, resp.id, descricao) } catch {}
      }
    }

    return resp
  }

  // ── fluxo genérico de publicação em massa ─────────────────────
  async function executarPublicacaoEmMassa(meta = 10) {
    if (exportando) return
    setExportando(true)
    setLogAuto([])
    setSucessosAuto(0)

    const log = (msg, tipo = 'info') => setLogAuto(l => [...l, { msg, tipo, ts: new Date().toLocaleTimeString() }])

    try {
      const c = getClienteAtivo()
      const mlToken = await getMLToken(c)
      const blingToken = c?.bling?.accessToken ? await getBlingToken(c) : null

      // Vínculos já publicados (Bling ID → ML ID)
      const vinculos = getVinculos(c.id)

      // Ordena: com imagem + estoque + preço primeiro; exclui já publicados
      const candidatos = [...produtosAnalisados]
        .filter(p => p._mapa && Number(p.preco) > 0 && !vinculos[p.id])
        .sort((a, b) => {
          const aScore = (a.imagemURL ? 4 : 0) + (Number(a.estoque?.saldoVirtualTotal) > 0 ? 2 : 0) + 1
          const bScore = (b.imagemURL ? 4 : 0) + (Number(b.estoque?.saldoVirtualTotal) > 0 ? 2 : 0) + 1
          return bScore - aScore
        })

      if (!candidatos.length) { log('Nenhum produto novo com categoria mapeada encontrado.', 'erro'); setExportando(false); return }

      const label = meta === Infinity ? `${candidatos.length} produtos` : `meta: ${meta}`
      log(`Iniciando publicação com ${candidatos.length} produtos (${label})`)
      let sucessos = 0

      for (const produto of candidatos) {
        if (sucessos >= meta) break
        log(`Tentando: ${produto.nome.slice(0, 60)}...`)
        setResultados(r => ({ ...r, [produto.id]: { status: 'enviando' } }))

        try {
          const resp = await publicarComRetry(produto, mlToken, blingToken, log)
          sucessos++
          setSucessosAuto(sucessos)
          setResultados(r => ({ ...r, [produto.id]: { status: 'ok', mlId: resp.id } }))
          salvarVinculo(c.id, produto.id, resp.id)
          adicionarHistorico(c.id, { tipo: 'publicar', produtoId: produto.id, produtoNome: produto.nome, mlId: resp.id, status: 'ok', via: 'ml-auto' })
          const progressLabel = meta === Infinity ? sucessos : `${sucessos}/${meta}`
          log(`✓ Sucesso ${progressLabel} → ML ID: ${resp.id}`, 'ok')
        } catch (e) {
          const errosML = parsearErroML(e.message)
          setResultados(r => ({ ...r, [produto.id]: { status: 'erro', msg: e.message, errosML } }))
          log(`✗ Erro: ${e.message}`, 'erro')
        }

        await new Promise(r => setTimeout(r, 2000))
      }

      if (meta !== Infinity && sucessos >= meta) log(`Meta atingida! ${sucessos} produtos publicados com sucesso.`, 'ok')
      else log(`Concluído. ${sucessos} de ${candidatos.length} produtos publicados.`, sucessos > 0 ? 'ok' : 'erro')
    } catch (e) {
      log(`Erro fatal: ${e.message}`, 'erro')
    }

    setExportando(false)
  }

  const testarPublicacaoAuto  = () => executarPublicacaoEmMassa(10)
  const publicarTodosComRetry = () => executarPublicacaoEmMassa(Infinity)

  // ── excluir todos os anúncios do ML ──────────────────────────
  async function excluirTodosDoML() {
    if (excluindo) return
    if (!window.confirm('Isso vai fechar TODOS os anúncios publicados no ML. Confirmar?')) return
    setExcluindo(true)
    setLogAuto([])
    const log = (msg, tipo = 'info') => setLogAuto(l => [...l, { msg, tipo, ts: new Date().toLocaleTimeString() }])

    try {
      const c = getClienteAtivo()
      const mlToken = await getMLToken(c)

      // 1. Pega itens dos vínculos salvos
      const vinculos = getVinculos(c.id)
      const mlIds = Object.values(vinculos).filter(Boolean)

      // 2. Busca também todos os itens do usuário no ML
      const me = await getMe(mlToken)
      const userId = me.id
      let todosIds = [...mlIds]
      let offset = 0
      while (true) {
        const res = await getMeusItens(mlToken, userId, offset)
        const ids = res?.results || []
        todosIds = [...new Set([...todosIds, ...ids])]
        if (ids.length < 100) break
        offset += 100
        await new Promise(r => setTimeout(r, 300))
      }

      if (!todosIds.length) { log('Nenhum anúncio encontrado no ML.', 'info'); setExcluindo(false); return }

      log(`Fechando ${todosIds.length} anúncios no ML...`)
      let fechados = 0

      for (const mlId of todosIds) {
        try {
          await fecharItem(mlToken, mlId)
          fechados++
          log(`✓ Fechado: ${mlId}`, 'ok')
        } catch (e) {
          log(`✗ Erro ao fechar ${mlId}: ${e.message}`, 'erro')
        }
        await new Promise(r => setTimeout(r, 500))
      }

      // 3. Limpa vínculos salvos
      limparVinculos(c.id)
      setResultados({})
      log(`Concluído. ${fechados}/${todosIds.length} anúncios fechados. Vínculos limpos.`, 'ok')
    } catch (e) {
      log(`Erro fatal: ${e.message}`, 'erro')
    }
    setExcluindo(false)
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
            {exportando ? 'Publicando...' : 'Auto-testar (meta: 10)'}
          </button>
          <button onClick={publicarTodosComRetry} disabled={exportando || excluindo}
            style={{ display: 'flex', alignItems: 'center', gap: 7, background: exportando ? '#CBD5E0' : '#2D3748', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 16px', fontSize: 13, fontWeight: 800 }}>
            <Upload size={13} />
            {exportando ? 'Publicando...' : 'Publicar Todos (sem repetir)'}
          </button>
          <button onClick={excluirTodosDoML} disabled={exportando || excluindo}
            style={{ display: 'flex', alignItems: 'center', gap: 7, background: excluindo ? '#CBD5E0' : '#FC8181', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 16px', fontSize: 13, fontWeight: 800 }}>
            <Trash2 size={13} />
            {excluindo ? 'Excluindo...' : 'Excluir todos do ML'}
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

      {/* Painel de Diagnóstico ML */}
      <div style={{ background: '#fff', border: '1.5px solid #E2E8F0', borderRadius: 12, marginBottom: 16, overflow: 'hidden' }}>
        <button onClick={() => setDiagAberto(!diagAberto)}
          style={{ width: '100%', padding: '12px 16px', background: 'none', border: 'none', textAlign: 'left', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#1A202C', display: 'flex', alignItems: 'center', gap: 8 }}>
            <ClipboardList size={14} color="#805AD5" /> Diagnóstico ML — {criterios.prontos}/{criterios.total} prontos para publicar
          </span>
          <span style={{ fontSize: 12, color: '#A0AEC0' }}>{diagAberto ? '▲' : '▼'}</span>
        </button>

        {diagAberto && (
          <div style={{ borderTop: '1px solid #F7FAFC', padding: 16 }}>
            {/* Critérios */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
              {[
                { label: 'Prontos para ML',   val: criterios.prontos,      total: criterios.total, ok: true },
                { label: 'Sem preço',          val: criterios.semPreco,     total: criterios.total, ok: false },
                { label: 'Sem imagem',         val: criterios.semImagem,    total: criterios.total, ok: false },
                { label: 'Sem descrição',      val: criterios.semDescricao, total: criterios.total, ok: false },
                { label: 'Sem categoria ML',   val: criterios.semCategoria, total: criterios.total, ok: false },
                { label: 'Sem estoque',        val: criterios.semEstoque,   total: criterios.total, ok: false },
              ].map(c => (
                <div key={c.label} style={{
                  background: c.ok ? 'rgba(72,187,120,0.08)' : c.val === 0 ? 'rgba(72,187,120,0.05)' : 'rgba(252,129,74,0.08)',
                  border: `1px solid ${c.ok ? '#48BB78' : c.val === 0 ? '#C6F6D5' : '#FC8181'}`,
                  borderRadius: 8, padding: '10px 14px',
                }}>
                  <div style={{ fontSize: 20, fontWeight: 800, color: c.ok ? '#38A169' : c.val === 0 ? '#38A169' : '#E53E3E' }}>
                    {c.val}
                  </div>
                  <div style={{ fontSize: 11, color: '#718096', fontWeight: 600, marginTop: 2 }}>{c.label}</div>
                </div>
              ))}
            </div>

            {/* Botões de ação */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
              <button onClick={autoMapearTudo} disabled={autoMapeando || autopreenchendo}
                style={{ display: 'flex', alignItems: 'center', gap: 8, background: autoMapeando ? '#CBD5E0' : '#3182CE', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 18px', fontSize: 13, fontWeight: 700, cursor: autoMapeando ? 'default' : 'pointer' }}>
                {autoMapeando ? <Loader size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Wrench size={13} />}
                {autoMapeando ? 'Mapeando categorias...' : 'Auto-mapear tudo'}
              </button>
              <button onClick={autoPreencher} disabled={autopreenchendo || autoMapeando}
                style={{ display: 'flex', alignItems: 'center', gap: 8, background: autopreenchendo ? '#CBD5E0' : '#805AD5', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 18px', fontSize: 13, fontWeight: 700, cursor: autopreenchendo ? 'default' : 'pointer' }}>
                {autopreenchendo ? <Loader size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={13} />}
                {autopreenchendo ? 'Buscando dados do Bling...' : 'Autopreencher dados do Bling'}
              </button>
              <span style={{ fontSize: 12, color: '#718096', alignSelf: 'center' }}>
                1) Mapeie categorias ML → 2) Autopreencha dados → 3) Publique tudo
              </span>
            </div>

            {/* Log auto-mapear */}
            {logMapa.length > 0 && (
              <div style={{ background: '#1A202C', borderRadius: 8, padding: 12, marginBottom: 10, maxHeight: 160, overflowY: 'auto' }}>
                {logMapa.map((l, i) => (
                  <p key={i} style={{ fontSize: 11, fontFamily: 'monospace', color: l.tipo === 'ok' ? '#68D391' : l.tipo === 'erro' ? '#FC8181' : '#CBD5E0', marginBottom: 2 }}>
                    [{l.ts}] {l.msg}
                  </p>
                ))}
              </div>
            )}

            {/* Log autopreencher */}
            {logDiag.length > 0 && (
              <div style={{ background: '#1A202C', borderRadius: 8, padding: 12, marginTop: 12, maxHeight: 160, overflowY: 'auto' }}>
                {logDiag.map((l, i) => (
                  <p key={i} style={{ fontSize: 11, fontFamily: 'monospace', color: l.tipo === 'ok' ? '#68D391' : l.tipo === 'erro' ? '#FC8181' : '#CBD5E0', marginBottom: 2 }}>
                    [{l.ts}] {l.msg}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}
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
