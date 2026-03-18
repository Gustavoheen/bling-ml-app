import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { getClienteAtivo, getProdutos, getMapeamentos, salvarMapeamentos, getCategoriasProdutos, salvarCategoriasProdutos, atualizarTokensBling, atualizarTokensML, adicionarHistorico } from '../lib/storage'
import { buscarCategorias, getAtributosCategoria, publicarProduto, blingParaMLPayload, refreshToken as mlRefresh } from '../lib/ml'
import { buscarOuCriarCategoria, atualizarProduto, getProdutoDetalhe, normalizarProduto, refreshToken as blingRefresh, listarCategorias, deletarCategoria } from '../lib/bling'
import { Search, CheckCircle, Circle, ChevronDown, ChevronUp, GitMerge, ArrowRight, Loader, Zap, RefreshCw, Wand2, Play } from 'lucide-react'

function extrairTipoProduto(nome) {
  const encerrar = new Set([
    'aço','ferro','madeira','tecido','couro','inox','mdf','vidro','plástico','plastico',
    'estrutura','base','suporte','estilo','luxo','premium','moderno','moderna',
    'clássico','classico','retrátil','retratil','reclinável','reclinavel',
    'marrom','preto','preta','branco','branca','cinza','bege','creme','dourado','prata','natural','grafite','caramelo','verde','azul','vermelho','rose','nude',
  ])
  const pularInicio = new Set(['kit','com','de','em','e','para','ao','da','do','das','dos','um','uma','por','sem','conjunto','novo','nova'])
  const conectivos = new Set(['de','da','do','das','dos'])
  // Lugares/cômodos que formam parte do tipo (ex: "de Jantar", "de Escritório")
  const comodos = new Set(['jantar','sala','escritório','escritorio','cozinha','quarto','banheiro','varanda','jardim','lavabo','corredor','entrada','centro','parede','teto','chão','chao'])

  const palavras = nome.toLowerCase().split(/\s+/)
  let resultado = []
  let i = 0

  // Pula ruído do início
  while (i < palavras.length) {
    const p = palavras[i].replace(/[^a-záéíóúâêîôûãõç]/gi, '')
    if (!p || /^\d+$/.test(p) || pularInicio.has(p) || encerrar.has(p)) { i++; continue }
    break
  }

  // Coleta tipo do produto (máximo 3 tokens significativos)
  let tokens = 0
  while (i < palavras.length && tokens < 3) {
    const p = palavras[i].replace(/[^a-záéíóúâêîôûãõç]/gi, '')
    if (!p) { i++; continue }
    if (/^\d+$/.test(p)) break
    if (encerrar.has(p)) break

    // Conectivo só é incluído se liga a cômodo/lugar
    if (conectivos.has(p)) {
      const prox = palavras[i + 1]?.replace(/[^a-záéíóúâêîôûãõç]/gi, '')
      if (!prox || !comodos.has(prox)) break
      resultado.push(p)
      i++; continue
    }

    resultado.push(p)
    tokens++
    i++
  }

  // Remove conectivos finais
  while (resultado.length && conectivos.has(resultado[resultado.length - 1])) resultado.pop()
  if (!resultado.length) return null

  return resultado.map((w, idx) => (!conectivos.has(w) || idx === 0) ? w.charAt(0).toUpperCase() + w.slice(1) : w).join(' ')
}

// Consolida nomes similares em categorias fixas para evitar fragmentação
function normalizarTipo(tipo) {
  if (!tipo) return 'Outros'
  const t = tipo.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove acentos para comparação
  if (t.includes('cadeira'))                                        return 'Cadeiras de Jantar'
  if (t.includes('sofa') || t.includes('sofa'))                    return 'Sofás'
  if (t.includes('poltrona'))                                       return 'Poltronas'
  if (t.includes('mesa') && (t.includes('jantar') || t.includes('sala') || t.includes('escritorio'))) return 'Mesas de Jantar'
  if (t.includes('mesa') && t.includes('centro'))                  return 'Mesas de Centro'
  if (t.includes('mesa') && t.includes('lateral'))                 return 'Mesas Laterais'
  if (t.includes('mesa'))                                          return 'Mesas'
  if (t.includes('bandeja'))                                        return 'Bandejas'
  if (t.includes('comoda') || t.includes('comô'))                  return 'Cômodas'
  if (t.includes('aparador'))                                       return 'Aparadores'
  if (t.includes('rack') || (t.includes('painel') && t.includes('tv'))) return 'Racks e Painéis TV'
  if (t.includes('estante'))                                        return 'Estantes'
  if (t.includes('armario'))                                        return 'Armários'
  if (t.includes('buffet'))                                         return 'Buffets'
  if (t.includes('criado') || t.includes('mudo'))                  return 'Criados-Mudo'
  if (t.includes('escrivaninha') || t.includes('escrivani'))       return 'Escrivaninhas'
  if (t.includes('banco') || t.includes('banqueta') || t.includes('banquetas')) return 'Bancos e Banquetas'
  // Se não bateu em nenhuma categoria fixa, usa o tipo extraído normalizado
  return tipo.charAt(0).toUpperCase() + tipo.slice(1)
}

function agruparPorCategoria(produtos) {
  const mapa = {}
  for (const p of produtos) {
    const cat = p.categoria?.nome || 'Sem categoria'
    if (!mapa[cat]) mapa[cat] = []
    mapa[cat].push(p)
  }
  return mapa
}

export default function Mapeamento() {
  const navigate = useNavigate()
  const cliente = getClienteAtivo()
  const produtos = getProdutos(cliente?.id || '')

  const [mapeamentos, setMapeamentos] = useState(() => {
    const m = getMapeamentos(cliente?.id || '')
    const obj = {}
    for (const item of (Array.isArray(m) ? m : [])) obj[item.categoriaBling] = item
    return obj
  })

  const grupos = useMemo(() => agruparPorCategoria(produtos), [produtos])
  const categoriasBling = Object.keys(grupos).sort()
  const totalMapeadas = categoriasBling.filter(c => mapeamentos[c]?.mlCategoryId).length
  const totalProdutos = categoriasBling.filter(c => mapeamentos[c]?.mlCategoryId)
    .reduce((acc, c) => acc + grupos[c].length, 0)

  const [expandido, setExpandido] = useState(null)
  const [buscaML, setBuscaML] = useState({})
  const [resultados, setResultados] = useState({})
  const [buscando, setBuscando] = useState({})
  const [carregandoAttrs, setCarregandoAttrs] = useState({})

  function salvar(novo) {
    setMapeamentos(novo)
    salvarMapeamentos(cliente.id, Object.values(novo))
  }

  async function buscar(catBling, query) {
    if (!query.trim()) return
    setBuscando(b => ({ ...b, [catBling]: true }))
    try {
      const res = await buscarCategorias(query)
      setResultados(r => ({ ...r, [catBling]: res }))
    } catch {
      setResultados(r => ({ ...r, [catBling]: [] }))
    } finally {
      setBuscando(b => ({ ...b, [catBling]: false }))
    }
  }

  function autoFillAtributo(attr, produto) {
    if (!produto) return ''
    const id = (attr.id || '').toLowerCase()
    const nm = (attr.name || '').toLowerCase()

    // 1. Verifica características já cadastradas no Bling
    if (Array.isArray(produto.caracteristicas)) {
      const carac = produto.caracteristicas.find(c => {
        const desc = (c.descricao || '').toLowerCase()
        return desc === nm || desc.includes(nm) || nm.includes(desc)
      })
      if (carac?.valor) return String(carac.valor)
    }

    // 2. Campos padrão do Bling
    if (id === 'brand' || nm.includes('marca'))                             return produto.marca || ''
    if (id === 'gtin' || nm === 'gtin' || nm === 'ean')                    return produto.gtin || ''
    if (id === 'sku' || nm === 'sku' || nm.includes('código'))             return produto.codigo || ''
    if (nm.includes('model') || nm.includes('modelo'))                     return produto.codigo || ''
    if (nm.includes('altura'))                                              return produto.altura ? String(produto.altura) : ''
    if (nm.includes('largura'))                                             return produto.largura ? String(produto.largura) : ''
    if (nm.includes('profundidade') || nm.includes('comprimento'))         return produto.profundidade ? String(produto.profundidade) : ''
    if (nm.includes('peso'))                                                return produto.pesoLiquido ? String(produto.pesoLiquido) : (produto.peso ? String(produto.peso) : '')
    return ''
  }

  async function selecionar(catBling, categoria) {
    setCarregandoAttrs(a => ({ ...a, [catBling]: true }))
    let attrs = []
    try { attrs = await getAtributosCategoria(categoria.category_id) } catch {}
    setCarregandoAttrs(a => ({ ...a, [catBling]: false }))

    const primeiroProduto = (grupos[catBling] || [])[0]

    const novo = {
      ...mapeamentos,
      [catBling]: {
        categoriaBling: catBling,
        mlCategoryId: categoria.category_id,
        mlCategoryName: categoria.domain_name || categoria.category_name,
        atributos: attrs.map(a => ({ id: a.id, name: a.name, valor: autoFillAtributo(a, primeiroProduto) })),
      },
    }
    salvar(novo)
    setResultados(r => ({ ...r, [catBling]: [] }))
    setBuscaML(b => ({ ...b, [catBling]: '' }))
    if (attrs.length > 0) setExpandido(catBling)
  }

  function atualizarAtributo(catBling, atributoId, valor) {
    const m = mapeamentos[catBling]
    if (!m) return
    const novosAtrs = m.atributos.map(a => a.id === atributoId ? { ...a, valor } : a)
    salvar({ ...mapeamentos, [catBling]: { ...m, atributos: novosAtrs } })
  }

  function remover(catBling) {
    const novo = { ...mapeamentos }
    delete novo[catBling]
    salvar(novo)
  }

  // ─── Auto-categorização por nome (para "Sem categoria") ──────
  const [autoNomeando, setAutoNomeando] = useState(false)
  const [autoNomeLog, setAutoNomeLog] = useState([])

  async function getBlingToken() {
    if (!cliente?.bling?.accessToken) return null
    const exp = cliente.bling.expiresAt && Date.now() > cliente.bling.expiresAt - 60000
    if (exp && cliente.bling.refreshToken) {
      try {
        const n = await blingRefresh(cliente.bling.refreshToken)
        atualizarTokensBling(cliente.id, n)
        return n.accessToken
      } catch { return null }
    }
    return cliente.bling.accessToken
  }

  async function autoCategorizarPorNome() {
    const prodsSemCat = grupos['Sem categoria'] || []
    if (!prodsSemCat.length) return
    setAutoNomeando(true)
    setAutoNomeLog([])

    // Agrupa por tipo detectado no nome
    const gruposTipo = {}
    for (const p of prodsSemCat) {
      const tipo = extrairTipoProduto(p.nome) || 'Outros'
      if (!gruposTipo[tipo]) gruposTipo[tipo] = []
      gruposTipo[tipo].push(p)
    }

    const catProdutos = getCategoriasProdutos(cliente.id)
    const blingToken = await getBlingToken()

    for (const [tipo, prods] of Object.entries(gruposTipo)) {
      setAutoNomeLog(l => [...l, { tipo, status: 'buscando', msg: `Buscando "${tipo}" no ML... (${prods.length} produtos)` }])
      try {
        const res = await buscarCategorias(tipo)
        if (!res || res.length === 0) {
          setAutoNomeLog(l => l.map(i => i.tipo === tipo ? { ...i, status: 'erro', msg: 'Não encontrado no ML' } : i))
          continue
        }
        const melhor = res[0]
        let attrs = []
        try { attrs = await getAtributosCategoria(melhor.category_id) } catch {}

        // Salva mapeamento por produto e atualiza características no Bling
        for (const prod of prods) {
          const atributosPreenchidos = attrs.map(a => ({ id: a.id, name: a.name, valor: autoFillAtributo(a, prod) }))
          catProdutos[prod.id] = {
            mlCategoryId: melhor.category_id,
            mlCategoryName: melhor.domain_name || melhor.category_name,
            atributos: atributosPreenchidos,
          }

          // Atualiza características no Bling com os atributos ML exigidos
          if (blingToken) {
            const caracteristicasNovas = atributosPreenchidos
              .filter(a => a.valor)
              .map(a => ({ descricao: a.name, valor: a.valor }))

            // Mescla com características já existentes (não sobrescreve o que já tem)
            const existentes = Array.isArray(prod.caracteristicas) ? prod.caracteristicas : []
            const existentesMap = {}
            for (const c of existentes) existentesMap[(c.descricao || '').toLowerCase()] = c
            for (const c of caracteristicasNovas) {
              const key = (c.descricao || '').toLowerCase()
              if (!existentesMap[key]) existentesMap[key] = c
            }
            const caracteristicasMerged = Object.values(existentesMap)

            if (caracteristicasMerged.length > existentes.length) {
              try { await atualizarProduto(blingToken, prod.id, { caracteristicas: caracteristicasMerged }) } catch {}
            }
          }
          await new Promise(r => setTimeout(r, 150))
        }
        salvarCategoriasProdutos(cliente.id, catProdutos)

        // Cria categoria no Bling com os campos personalizados do ML
        if (blingToken) {
          try { await buscarOuCriarCategoria(blingToken, tipo, attrs) } catch {}
        }

        setAutoNomeLog(l => l.map(i => i.tipo === tipo ? { ...i, status: 'ok', msg: `→ ${melhor.domain_name || melhor.category_name} (${prods.length} produtos)` } : i))
      } catch (err) {
        setAutoNomeLog(l => l.map(i => i.tipo === tipo ? { ...i, status: 'erro', msg: err.message || 'Erro' } : i))
      }
      await new Promise(r => setTimeout(r, 400))
    }
    setAutoNomeando(false)
  }

  // ─── Auto-mapeamento ML ───────────────────────────────────────
  const [autoMapeando, setAutoMapeando] = useState(false)
  const [autoLog, setAutoLog] = useState([])

  async function autoMapearTudo() {
    setAutoMapeando(true)
    setAutoLog([])
    const novoMapa = { ...mapeamentos }

    for (const cat of categoriasBling) {
      if (novoMapa[cat]?.mlCategoryId) {
        setAutoLog(l => [...l, { cat, status: 'pulado', msg: 'Já mapeada' }])
        continue
      }
      if (cat.toLowerCase() === 'sem categoria') {
        setAutoLog(l => [...l, { cat, status: 'erro', msg: 'Sem nome — abra o item e pesquise a categoria manualmente' }])
        continue
      }
      setAutoLog(l => [...l, { cat, status: 'buscando', msg: 'Buscando no ML...' }])
      try {
        const res = await buscarCategorias(cat)
        if (!res || res.length === 0) {
          setAutoLog(l => l.map(i => i.cat === cat ? { ...i, status: 'erro', msg: 'Nenhuma categoria encontrada' } : i))
          continue
        }
        const melhor = res[0]
        let attrs = []
        try { attrs = await getAtributosCategoria(melhor.category_id) } catch {}

        novoMapa[cat] = {
          categoriaBling: cat,
          mlCategoryId: melhor.category_id,
          mlCategoryName: melhor.domain_name || melhor.category_name,
          atributos: attrs.map(a => ({ id: a.id, name: a.name, valor: '' })),
        }
        setAutoLog(l => l.map(i => i.cat === cat
          ? { ...i, status: 'ok', msg: `→ ${melhor.domain_name || melhor.category_name}` }
          : i))
      } catch (err) {
        setAutoLog(l => l.map(i => i.cat === cat ? { ...i, status: 'erro', msg: err.message || 'Erro na busca' } : i))
      }
      await new Promise(r => setTimeout(r, 250))
    }

    salvar(novoMapa)
    setAutoMapeando(false)
  }

  // ─── Reorganizar Categorias ───────────────────────────────────
  const [reorganizando, setReorganizando] = useState(false)
  const [reorganizLog, setReorganizLog] = useState([])
  const [previewCategs, setPreviewCategs] = useState(null) // null = não calculado ainda

  // ─── Fluxo Completo (Reorganizar + Publicar teste) ────────────
  const [fazerTudoAtivo, setFazerTudoAtivo] = useState(false)
  const [fazerTudoLog, setFazerTudoLog] = useState([])
  const [testResultML, setTestResultML] = useState(null) // { ok, mlId, prodNome, erro }

  // ─── Sincronizar categorias no Bling ─────────────────────────
  const [sincBling, setSincBling] = useState(false)
  const [sincLog, setSincLog] = useState([])

  async function calcularPreviewCategs() {
    // Analisa todos os produtos e agrupa por tipo consolidado (com normalização)
    const todosProdutos = Object.values(grupos).flat()
    const agrupado = {}
    for (const p of todosProdutos) {
      const tipoRaw = extrairTipoProduto(p.nome) || 'Outros'
      const tipo = normalizarTipo(tipoRaw)
      if (!agrupado[tipo]) agrupado[tipo] = []
      agrupado[tipo].push(p)
    }
    // Ordena por quantidade de produtos
    const lista = Object.entries(agrupado)
      .sort((a, b) => b[1].length - a[1].length)
      .map(([tipo, prods]) => ({ tipo, qtd: prods.length, prods }))
    return lista
  }

  async function executarReorganizacao(listaPreview) {
    const lista = listaPreview || previewCategs
    if (!lista) return
    const blingToken = await getBlingToken()
    if (!blingToken) { alert('Bling não conectado.'); return }

    setReorganizando(true)
    setReorganizLog([])

    // 1. Deleta todas as categorias existentes no Bling
    setReorganizLog(l => [...l, { status: 'info', msg: 'Deletando categorias existentes...' }])
    try {
      const categsExistentes = await listarCategorias(blingToken)
      for (const cat of categsExistentes) {
        try { await deletarCategoria(blingToken, cat.id) } catch {}
        await new Promise(r => setTimeout(r, 80))
      }
      setReorganizLog(l => [...l, { status: 'ok', msg: `${categsExistentes.length} categorias antigas deletadas` }])
    } catch (e) {
      setReorganizLog(l => [...l, { status: 'erro', msg: 'Erro ao deletar: ' + e.message }])
    }

    // 2. Cria novas categorias consolidadas com campos ML
    const catProdutos = getCategoriasProdutos(cliente.id)
    const novoMapa = { ...mapeamentos }

    for (const { tipo, prods } of lista) {
      if (tipo === 'Outros') continue
      setReorganizLog(l => [...l, { status: 'buscando', msg: `Criando "${tipo}" no Bling + buscando no ML...` }])
      try {
        // Busca categoria no ML
        const res = await buscarCategorias(tipo)
        if (!res || res.length === 0) {
          setReorganizLog(l => l.map((i, idx) => idx === l.length - 1 ? { ...i, status: 'erro', msg: `"${tipo}" não encontrado no ML` } : i))
          continue
        }
        const melhor = res[0]
        let attrs = []
        try { attrs = await getAtributosCategoria(melhor.category_id) } catch {}

        // Cria categoria no Bling com campos personalizados ML
        const catId = await buscarOuCriarCategoria(blingToken, tipo, attrs)

        // Salva mapeamento por produto (no localStorage — não precisa chamar Bling por produto)
        for (const prod of prods) {
          catProdutos[prod.id] = {
            mlCategoryId: melhor.category_id,
            mlCategoryName: melhor.domain_name || melhor.category_name,
            atributos: attrs.map(a => ({ id: a.id, name: a.name, valor: autoFillAtributo(a, prod) })),
          }
        }
        salvarCategoriasProdutos(cliente.id, catProdutos)

        // Salva no mapeamento local (para Exportacao reconhecer)
        novoMapa[tipo] = {
          categoriaBling: tipo,
          mlCategoryId: melhor.category_id,
          mlCategoryName: melhor.domain_name || melhor.category_name,
          atributos: attrs.map(a => ({ id: a.id, name: a.name, valor: autoFillAtributo(a, prods[0]) })),
        }
        salvar(novoMapa)

        setReorganizLog(l => l.map((i, idx) => idx === l.length - 1 ? {
          ...i, status: 'ok',
          msg: `"${tipo}" → ${melhor.domain_name || melhor.category_name} (${prods.length} produtos, ${attrs.length} atributos ML)`
        } : i))
      } catch (err) {
        setReorganizLog(l => l.map((i, idx) => idx === l.length - 1 ? { ...i, status: 'erro', msg: err.message } : i))
      }
      await new Promise(r => setTimeout(r, 300))
    }

    setReorganizando(false)
    return catProdutos
  }

  // ─── Fluxo Completo: Reorganizar → Testar publicação ─────────
  async function fazerTudoAutomatico() {
    if (fazerTudoAtivo) return
    setFazerTudoAtivo(true)
    setFazerTudoLog([])
    setTestResultML(null)
    const log = (msg, tipo = 'info') => setFazerTudoLog(l => [...l, { msg, tipo, ts: new Date().toLocaleTimeString() }])

    try {
      // PASSO 1: Calcular categorias consolidadas
      log('Calculando categorias consolidadas...')
      const lista = await calcularPreviewCategs()
      setPreviewCategs(lista)
      log(`${lista.filter(c => c.tipo !== 'Outros').length} categorias detectadas: ${lista.filter(c => c.tipo !== 'Outros').map(c => `${c.tipo} (${c.qtd})`).join(', ')}`, 'ok')

      // PASSO 2: Reorganizar no Bling + mapear ML
      log('Reorganizando categorias no Bling e mapeando no ML...')
      const catProdutos = await executarReorganizacao(lista)
      log('Reorganização concluída!', 'ok')

      // PASSO 3: Encontrar produto mais completo para testar
      log('Buscando melhor produto para teste de publicação...')
      const todosProdutos = Object.values(grupos).flat()
      const candidatos = todosProdutos
        .filter(p => catProdutos?.[p.id])
        .sort((a, b) => {
          const aScore = (a.imagemURL ? 4 : 0) + (a.preco > 0 ? 2 : 0) + ((a.descricaoCurta || a.descricaoComplementar) ? 1 : 0)
          const bScore = (b.imagemURL ? 4 : 0) + (b.preco > 0 ? 2 : 0) + ((b.descricaoCurta || b.descricaoComplementar) ? 1 : 0)
          return bScore - aScore
        })

      if (!candidatos.length) { log('Nenhum produto com categoria mapeada. Execute a sincronização de produtos primeiro.', 'erro'); setFazerTudoAtivo(false); return }

      const prodTeste = candidatos[0]
      log(`Produto escolhido para teste: "${prodTeste.nome.slice(0, 60)}"`)
      log(`Categoria ML: ${catProdutos[prodTeste.id].mlCategoryName}`)

      // PASSO 4: Publicar no ML
      log('Conectando ao Mercado Livre...')
      if (!cliente?.ml?.accessToken) { log('Mercado Livre não conectado. Conecte na aba Configurações.', 'erro'); setFazerTudoAtivo(false); return }

      let mlToken = cliente.ml.accessToken
      if (cliente.ml.expiresAt && Date.now() > cliente.ml.expiresAt - 60000 && cliente.ml.refreshToken) {
        try { const n = await mlRefresh(cliente.ml.refreshToken); atualizarTokensML(cliente.id, n); mlToken = n.accessToken } catch {}
      }

      // Busca dados completos do Bling
      const blingToken = await getBlingToken()
      let prodCompleto = prodTeste
      if (blingToken) {
        try {
          const det = await getProdutoDetalhe(blingToken, prodTeste.id)
          prodCompleto = normalizarProduto(det)
          log(`Dados frescos do Bling carregados: ${prodCompleto.imagens?.length || 0} imagens`)
        } catch (e) { log(`Aviso: usando dados locais (${e.message})`, 'info') }
      }

      const mapa = catProdutos[prodTeste.id]
      const payload = blingParaMLPayload(prodCompleto, mapa.mlCategoryId, mapa.atributos || [], { listingType: 'gold_special', condition: 'new', catalogListing: false })
      log(`Payload montado. Título: "${payload.title.slice(0, 50)}", Preço: R$ ${payload.price}, Imagens: ${payload.pictures?.length || 0}`)
      log('Publicando no Mercado Livre...')

      try {
        const resp = await publicarProduto(mlToken, payload)
        setTestResultML({ ok: true, mlId: resp.id, prodNome: prodTeste.nome })
        adicionarHistorico(cliente.id, { tipo: 'publicar', produtoId: prodTeste.id, produtoNome: prodTeste.nome, mlId: resp.id, status: 'ok', via: 'ml-auto' })
        log(`✓ SUCESSO! Produto publicado no ML com ID: ${resp.id}`, 'ok')
        log(`URL: https://produto.mercadolivre.com.br/MLB-${resp.id?.replace('MLB', '')}`, 'ok')
      } catch (e) {
        setTestResultML({ ok: false, prodNome: prodTeste.nome, erro: e.message, payload })
        log(`✗ Erro ao publicar: ${e.message}`, 'erro')
        // Analisa o erro e sugere correção
        if (e.message.includes('picture') || e.message.includes('image')) log('→ Problema com imagens. Verifique se as URLs das fotos são acessíveis publicamente.', 'erro')
        else if (e.message.includes('price')) log('→ Preço inválido ou abaixo do mínimo permitido pelo ML.', 'erro')
        else if (e.message.includes('title')) log('→ Título inválido. O ML pode ter restrições específicas para este título.', 'erro')
        else if (e.message.includes('attribute')) log('→ Atributo obrigatório com valor inválido. Verifique os atributos da categoria.', 'erro')
        else if (e.message.includes('category')) log('→ Categoria não aceita. Pode ser necessário usar uma subcategoria mais específica.', 'erro')
      }
    } catch (e) {
      log(`Erro fatal: ${e.message}`, 'erro')
    }

    setFazerTudoAtivo(false)
  }

  async function sincronizarCategoriasNoBling() {
    if (!cliente?.bling?.accessToken) {
      alert('Conecte o Bling primeiro.')
      return
    }
    setSincBling(true)
    setSincLog([])
    for (const cat of categoriasBling) {
      if (cat === 'Sem categoria') continue
      setSincLog(l => [...l, { cat, status: 'buscando', msg: 'Verificando no Bling...' }])
      try {
        const atrsCateg = mapeamentos[cat]?.atributos || []
        const id = await buscarOuCriarCategoria(cliente.bling.accessToken, cat, atrsCateg)
        setSincLog(l => l.map(i => i.cat === cat ? { ...i, status: 'ok', msg: `ID ${id}` } : i))
      } catch (err) {
        setSincLog(l => l.map(i => i.cat === cat ? { ...i, status: 'erro', msg: err.message } : i))
      }
      await new Promise(r => setTimeout(r, 200))
    }
    setSincBling(false)
  }

  if (produtos.length === 0) {
    return (
      <div>
        <h2 style={{ fontSize: 20, fontWeight: 800, color: '#1A202C', marginBottom: 24 }}>Mapeamento de Categorias</h2>
        <div style={{ background: '#fff', border: '1.5px dashed #CBD5E0', borderRadius: 14, padding: '48px 24px', textAlign: 'center' }}>
          <GitMerge size={40} color="#CBD5E0" style={{ marginBottom: 16 }} />
          <p style={{ fontWeight: 700, color: '#A0AEC0' }}>Sincronize produtos primeiro na aba "Produtos".</p>
        </div>
      </div>
    )
  }

  const todasMapeadas = totalMapeadas === categoriasBling.length

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: '#1A202C', marginBottom: 4 }}>Mapeamento de Categorias</h2>
          <p style={{ fontSize: 13, color: '#718096' }}>
            {totalMapeadas} de {categoriasBling.length} categorias mapeadas · {totalProdutos} produtos prontos
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={sincronizarCategoriasNoBling} disabled={sincBling}
            style={{ display: 'flex', alignItems: 'center', gap: 7, background: sincBling ? '#CBD5E0' : '#EDF2F7', color: '#4A5568', border: '1.5px solid #E2E8F0', borderRadius: 8, padding: '9px 14px', fontSize: 13, fontWeight: 700, cursor: sincBling ? 'default' : 'pointer' }}>
            {sincBling ? <Loader size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={13} />}
            {sincBling ? 'Sincronizando...' : 'Sincronizar no Bling'}
          </button>
          <button onClick={autoMapearTudo} disabled={autoMapeando}
            style={{ display: 'flex', alignItems: 'center', gap: 7, background: autoMapeando ? '#CBD5E0' : '#3182CE', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 14px', fontSize: 13, fontWeight: 700, cursor: autoMapeando ? 'default' : 'pointer' }}>
            {autoMapeando ? <Loader size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Zap size={13} />}
            {autoMapeando ? 'Mapeando...' : 'Auto-mapear tudo'}
          </button>
          {totalMapeadas > 0 && (
            <button onClick={() => navigate('/app/exportacao')}
              style={{ display: 'flex', alignItems: 'center', gap: 7, background: '#1A202C', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              Exportar {totalProdutos} <ArrowRight size={13} />
            </button>
          )}
        </div>
      </div>

      {/* ── FAZER TUDO AUTOMATICAMENTE ── */}
      <div style={{ background: 'linear-gradient(135deg, #2D3748 0%, #553C9A 100%)', borderRadius: 14, padding: '20px 24px', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: fazerTudoLog.length > 0 ? 16 : 0 }}>
          <div>
            <p style={{ fontSize: 16, fontWeight: 900, color: '#fff', marginBottom: 4 }}>Fazer Tudo Automaticamente</p>
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>
              1. Exclui todas as categorias do Bling · 2. Cria categorias consolidadas com campos ML · 3. Publica produto teste no Mercado Livre
            </p>
          </div>
          <button onClick={fazerTudoAutomatico} disabled={fazerTudoAtivo || reorganizando}
            style={{ display: 'flex', alignItems: 'center', gap: 8, background: fazerTudoAtivo ? 'rgba(255,255,255,0.3)' : '#F6E05E', color: '#1A202C', border: 'none', borderRadius: 10, padding: '12px 28px', fontSize: 14, fontWeight: 900, whiteSpace: 'nowrap', cursor: fazerTudoAtivo ? 'default' : 'pointer' }}>
            {fazerTudoAtivo ? <Loader size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <Play size={15} />}
            {fazerTudoAtivo ? 'Executando...' : '▶ Fazer Tudo'}
          </button>
        </div>

        {fazerTudoLog.length > 0 && (
          <div style={{ background: 'rgba(0,0,0,0.4)', borderRadius: 10, padding: '12px 16px', maxHeight: 260, overflowY: 'auto' }}>
            {fazerTudoLog.map((l, i) => (
              <p key={i} style={{ fontSize: 12, fontFamily: 'monospace', color: l.tipo === 'ok' ? '#68D391' : l.tipo === 'erro' ? '#FC8181' : '#E2E8F0', marginBottom: 3, lineHeight: 1.5 }}>
                <span style={{ color: '#718096' }}>[{l.ts}]</span> {l.msg}
              </p>
            ))}
            {fazerTudoAtivo && <p style={{ fontSize: 11, color: '#63B3ED', fontFamily: 'monospace', animation: 'pulse 1.5s infinite' }}>■ processando...</p>}
          </div>
        )}

        {testResultML && (
          <div style={{ marginTop: 12, padding: '14px 16px', borderRadius: 10, background: testResultML.ok ? 'rgba(72,187,120,0.15)' : 'rgba(252,129,74,0.15)', border: `1px solid ${testResultML.ok ? '#48BB78' : '#FC8181'}` }}>
            {testResultML.ok
              ? <p style={{ fontSize: 14, fontWeight: 800, color: '#68D391' }}>✓ Produto publicado com sucesso no ML! ID: {testResultML.mlId}</p>
              : <>
                  <p style={{ fontSize: 14, fontWeight: 800, color: '#FC8181', marginBottom: 6 }}>✗ Erro ao publicar: {testResultML.erro}</p>
                  <button onClick={fazerTudoAutomatico} style={{ background: '#FC8181', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                    Tentar novamente
                  </button>
                </>
            }
          </div>
        )}
      </div>

      {/* Progresso geral */}
      <div style={{ background: '#fff', border: '1.5px solid #E2E8F0', borderRadius: 12, padding: '16px 20px', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#1A202C' }}>Progresso do mapeamento</span>
          <span style={{ fontSize: 13, fontWeight: 800, color: todasMapeadas ? '#48BB78' : '#718096' }}>
            {totalMapeadas}/{categoriasBling.length}
          </span>
        </div>
        <div style={{ height: 8, background: '#F7FAFC', borderRadius: 99, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${categoriasBling.length ? (totalMapeadas / categoriasBling.length) * 100 : 0}%`, background: '#48BB78', borderRadius: 99, transition: 'width 0.3s' }} />
        </div>
      </div>

      {/* Log do auto-mapeamento ML */}
      {autoLog.length > 0 && (
        <div style={{ background: '#1A202C', borderRadius: 12, padding: '16px 20px', marginBottom: 20, maxHeight: 200, overflow: 'auto' }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: '#63B3ED', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {autoMapeando ? '⚡ Mapeando automaticamente...' : '✓ Mapeamento concluído'}
          </p>
          {autoLog.map((l, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '3px 0' }}>
              <span style={{ fontSize: 12, color: l.status === 'ok' ? '#48BB78' : l.status === 'erro' ? '#FC8181' : l.status === 'pulado' ? '#718096' : '#63B3ED', flexShrink: 0 }}>
                {l.status === 'ok' ? '✓' : l.status === 'erro' ? '✗' : l.status === 'pulado' ? '–' : '…'}
              </span>
              <span style={{ fontSize: 12, color: '#E2E8F0', fontWeight: 600 }}>{l.cat}</span>
              <span style={{ fontSize: 12, color: '#718096' }}>{l.msg}</span>
            </div>
          ))}
        </div>
      )}

      {/* Log sincronização Bling */}
      {sincLog.length > 0 && (
        <div style={{ background: '#1A202C', borderRadius: 12, padding: '16px 20px', marginBottom: 20, maxHeight: 160, overflow: 'auto' }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: '#68D391', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {sincBling ? 'Sincronizando categorias no Bling...' : '✓ Sincronização Bling concluída'}
          </p>
          {sincLog.map((l, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '3px 0' }}>
              <span style={{ fontSize: 12, color: l.status === 'ok' ? '#48BB78' : l.status === 'erro' ? '#FC8181' : '#63B3ED', flexShrink: 0 }}>
                {l.status === 'ok' ? '✓' : l.status === 'erro' ? '✗' : '…'}
              </span>
              <span style={{ fontSize: 12, color: '#E2E8F0', fontWeight: 600 }}>{l.cat}</span>
              <span style={{ fontSize: 12, color: '#718096' }}>{l.msg}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Reorganizar Categorias ── */}
      <div style={{ background: '#fff', border: '1.5px solid #E2E8F0', borderRadius: 12, padding: '16px 20px', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: previewCategs ? 14 : 0 }}>
          <div>
            <p style={{ fontSize: 14, fontWeight: 800, color: '#1A202C' }}>Reorganizar Categorias</p>
            <p style={{ fontSize: 12, color: '#718096', marginTop: 2 }}>
              Agrupa todos os produtos em categorias consolidadas, cria no Bling com campos ML e vincula cada produto.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={async () => { const lista = await calcularPreviewCategs(); setPreviewCategs(lista) }}
              style={{ background: '#EDF2F7', color: '#4A5568', border: '1.5px solid #E2E8F0', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              Ver preview
            </button>
            {previewCategs && (
              <button onClick={() => executarReorganizacao()} disabled={reorganizando}
                style={{ display: 'flex', alignItems: 'center', gap: 7, background: reorganizando ? '#CBD5E0' : '#E53E3E', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: reorganizando ? 'default' : 'pointer' }}>
                {reorganizando ? <Loader size={13} style={{ animation: 'spin 1s linear infinite' }} /> : null}
                {reorganizando ? 'Reorganizando...' : '⚡ Executar reorganização'}
              </button>
            )}
          </div>
        </div>

        {previewCategs && !reorganizando && reorganizLog.length === 0 && (
          <div>
            <p style={{ fontSize: 12, fontWeight: 700, color: '#4A5568', marginBottom: 8 }}>
              {previewCategs.length} categorias consolidadas a criar:
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {previewCategs.map(({ tipo, qtd }) => (
                <span key={tipo} style={{ fontSize: 12, background: '#EBF8FF', border: '1px solid #BEE3F8', borderRadius: 20, padding: '3px 10px', color: '#2B6CB0', fontWeight: 600 }}>
                  {tipo} <span style={{ color: '#718096' }}>({qtd})</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {reorganizLog.length > 0 && (
          <div style={{ background: '#1A202C', borderRadius: 10, padding: '12px 16px', maxHeight: 220, overflow: 'auto', marginTop: 12 }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: '#63B3ED', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {reorganizando ? '⚡ Reorganizando...' : '✓ Reorganização concluída'}
            </p>
            {reorganizLog.map((l, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '3px 0' }}>
                <span style={{ fontSize: 12, color: l.status === 'ok' ? '#48BB78' : l.status === 'erro' ? '#FC8181' : l.status === 'info' ? '#F6E05E' : '#63B3ED', flexShrink: 0 }}>
                  {l.status === 'ok' ? '✓' : l.status === 'erro' ? '✗' : l.status === 'info' ? 'ℹ' : '…'}
                </span>
                <span style={{ fontSize: 12, color: '#E2E8F0' }}>{l.msg}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Lista de categorias */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {categoriasBling.map(cat => {
          const mapeada = mapeamentos[cat]
          const aberto = expandido === cat
          const qtd = grupos[cat].length
          const atrsObrigatorios = mapeada?.atributos?.filter(a => !a.valor?.trim()) || []
          const completa = mapeada?.mlCategoryId && atrsObrigatorios.length === 0

          return (
            <div key={cat} style={{
              background: '#fff',
              border: `1.5px solid ${completa ? '#48BB78' : mapeada ? '#FBD38D' : '#E2E8F0'}`,
              borderRadius: 12, overflow: 'hidden',
            }}>
              <button onClick={() => setExpandido(aberto ? null : cat)}
                style={{ width: '100%', padding: '14px 16px', background: 'none', border: 'none', textAlign: 'left', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  {completa
                    ? <CheckCircle size={18} color="#48BB78" />
                    : mapeada
                    ? <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#FBD38D', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: '#744210' }}>!</div>
                    : <Circle size={18} color="#CBD5E0" />}
                  <div>
                    <p style={{ fontSize: 14, fontWeight: 700, color: '#1A202C' }}>{cat}</p>
                    <p style={{ fontSize: 12, color: '#718096', marginTop: 2 }}>
                      {qtd} produto{qtd > 1 ? 's' : ''}
                      {mapeada ? ` → ${mapeada.mlCategoryName}` : ' — clique para mapear'}
                      {mapeada && atrsObrigatorios.length > 0 ? ` · ${atrsObrigatorios.length} atrib. pendente${atrsObrigatorios.length > 1 ? 's' : ''}` : ''}
                    </p>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {mapeada && (
                    <button onClick={e => { e.stopPropagation(); remover(cat) }}
                      style={{ fontSize: 11, color: '#CBD5E0', background: 'none', border: 'none', fontWeight: 600, cursor: 'pointer' }}
                      onMouseEnter={e => e.currentTarget.style.color = '#FC8181'}
                      onMouseLeave={e => e.currentTarget.style.color = '#CBD5E0'}>
                      Remover
                    </button>
                  )}
                  {aberto ? <ChevronUp size={16} color="#718096" /> : <ChevronDown size={16} color="#718096" />}
                </div>
              </button>

              {aberto && (
                <div style={{ borderTop: '1px solid #F7FAFC', padding: 16 }}>
                  {cat === 'Sem categoria' && (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ background: 'linear-gradient(135deg, #553C9A 0%, #3182CE 100%)', borderRadius: 10, padding: '14px 16px', marginBottom: 10 }}>
                        <p style={{ fontSize: 13, fontWeight: 800, color: '#fff', marginBottom: 4 }}>Auto-categorizar por nome do produto</p>
                        <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.75)', marginBottom: 10 }}>
                          Detecta o tipo de cada produto pelo nome (Cadeiras, Sofás, Mesas...), busca a categoria certa no ML, cria a categoria no Bling e preenche os atributos automaticamente.
                        </p>
                        <button onClick={autoCategorizarPorNome} disabled={autoNomeando}
                          style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fff', color: '#553C9A', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 800, cursor: autoNomeando ? 'default' : 'pointer', opacity: autoNomeando ? 0.7 : 1 }}>
                          {autoNomeando ? <Loader size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Wand2 size={13} />}
                          {autoNomeando ? 'Categorizando...' : `Auto-categorizar ${qtd} produtos`}
                        </button>
                      </div>
                      {autoNomeLog.length > 0 && (
                        <div style={{ background: '#1A202C', borderRadius: 10, padding: '12px 16px', maxHeight: 180, overflow: 'auto' }}>
                          <p style={{ fontSize: 11, fontWeight: 700, color: '#A78BFA', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                            {autoNomeando ? '⚡ Categorizando...' : '✓ Concluído'}
                          </p>
                          {autoNomeLog.map((l, i) => (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '3px 0' }}>
                              <span style={{ fontSize: 12, color: l.status === 'ok' ? '#48BB78' : l.status === 'erro' ? '#FC8181' : '#63B3ED', flexShrink: 0 }}>
                                {l.status === 'ok' ? '✓' : l.status === 'erro' ? '✗' : '…'}
                              </span>
                              <span style={{ fontSize: 12, color: '#E2E8F0', fontWeight: 600 }}>{l.tipo}</span>
                              <span style={{ fontSize: 12, color: '#718096' }}>{l.msg}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  <p style={{ fontSize: 12, fontWeight: 700, color: '#718096', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {cat === 'Sem categoria' ? 'Ou mapear todos para uma única categoria:' : 'Buscar categoria no Mercado Livre'}
                  </p>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                    <input
                      type="text"
                      placeholder={`Ex: ${cat}`}
                      value={buscaML[cat] || ''}
                      onChange={e => setBuscaML(b => ({ ...b, [cat]: e.target.value }))}
                      onKeyDown={e => e.key === 'Enter' && buscar(cat, buscaML[cat] || '')}
                      style={{ flex: 1, padding: '9px 12px', border: '1.5px solid #E2E8F0', borderRadius: 8, fontSize: 13, outline: 'none' }}
                    />
                    <button onClick={() => buscar(cat, buscaML[cat] || cat)} disabled={buscando[cat]}
                      style={{ background: '#1A202C', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                      {buscando[cat] ? <Loader size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Search size={13} />}
                      Buscar
                    </button>
                  </div>

                  {(resultados[cat] || []).length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                      {resultados[cat].map(r => (
                        <button key={r.category_id} onClick={() => selecionar(cat, r)}
                          style={{ padding: '10px 14px', background: '#F7FAFC', border: '1.5px solid #E2E8F0', borderRadius: 8, textAlign: 'left', fontSize: 13, cursor: 'pointer' }}
                          onMouseEnter={e => { e.currentTarget.style.borderColor = '#63B3ED'; e.currentTarget.style.background = 'rgba(99,179,237,0.05)' }}
                          onMouseLeave={e => { e.currentTarget.style.borderColor = '#E2E8F0'; e.currentTarget.style.background = '#F7FAFC' }}>
                          <span style={{ fontWeight: 700, color: '#1A202C' }}>{r.domain_name}</span>
                          <span style={{ color: '#718096', marginLeft: 8, fontSize: 11 }}>{r.category_id}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {carregandoAttrs[cat] && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0', color: '#718096', fontSize: 13 }}>
                      <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> Carregando atributos obrigatórios...
                    </div>
                  )}

                  {mapeada && (
                    <div style={{ background: completa ? 'rgba(72,187,120,0.06)' : 'rgba(252,193,7,0.06)', border: `1px solid ${completa ? 'rgba(72,187,120,0.2)' : 'rgba(252,193,7,0.3)'}`, borderRadius: 10, padding: '12px 14px', marginTop: 4 }}>
                      <p style={{ fontSize: 11, fontWeight: 700, color: completa ? '#48BB78' : '#D69E2E', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>
                        {completa ? '✓ Mapeado e completo' : '⚠ Mapeado — preencha os atributos'}
                      </p>
                      <p style={{ fontSize: 14, fontWeight: 700, color: '#1A202C' }}>{mapeada.mlCategoryName}</p>
                      <p style={{ fontSize: 11, color: '#718096', fontFamily: 'monospace' }}>{mapeada.mlCategoryId}</p>
                    </div>
                  )}

                  {mapeada?.atributos?.length > 0 && (
                    <div style={{ marginTop: 14 }}>
                      <p style={{ fontSize: 12, fontWeight: 700, color: '#4A5568', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                        Atributos obrigatórios — aplicados a todos os {qtd} produtos desta categoria
                      </p>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        {mapeada.atributos.map(a => (
                          <div key={a.id}>
                            <label style={{ fontSize: 12, fontWeight: 600, color: '#4A5568', display: 'block', marginBottom: 4 }}>
                              {a.name} <span style={{ color: '#FC8181' }}>*</span>
                            </label>
                            <input
                              type="text"
                              value={a.valor || ''}
                              onChange={e => atualizarAtributo(cat, a.id, e.target.value)}
                              placeholder={`Ex: ${a.name}`}
                              style={{ width: '100%', padding: '8px 10px', border: `1.5px solid ${a.valor ? '#48BB78' : '#FBD38D'}`, borderRadius: 6, fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* CTA final */}
      {totalMapeadas > 0 && (
        <div style={{ marginTop: 24, background: '#1A202C', borderRadius: 14, padding: '20px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <p style={{ fontSize: 15, fontWeight: 800, color: '#fff' }}>{totalProdutos} produtos prontos para publicar</p>
            <p style={{ fontSize: 13, color: '#718096', marginTop: 4 }}>
              {categoriasBling.length - totalMapeadas > 0
                ? `${categoriasBling.length - totalMapeadas} categoria${categoriasBling.length - totalMapeadas > 1 ? 's' : ''} ainda sem mapeamento`
                : 'Todas as categorias mapeadas ✓'}
            </p>
          </div>
          <button onClick={() => navigate('/app/exportacao')}
            style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#63B3ED', color: '#1A202C', border: 'none', borderRadius: 10, padding: '12px 24px', fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>
            Publicar no ML <ArrowRight size={16} />
          </button>
        </div>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
