/* Busca global (⌘K / Ctrl+K / "/"): conteúdo real de todas as notas, agrupado por categoria. */
const Pal = {el: null, veu: null, camada: null, aberta: false, filtro: 'tudo', q: '', itens: [], sel: 0, docs: null, carregando: null, erro: null};
const FILTROS_PAL = [['tudo', 'Tudo'], ['sistemas', 'Sistemas'], ['projetos', 'Projetos'], ['notas', 'Notas'], ['decisoes', 'Decisões'], ['processos', 'Processos'], ['pessoas', 'Pessoas'], ['prompts', 'Prompts'], ['arquivos', 'Arquivos']];
const GRUPOS_PAL = [['acoes', 'Ações'], ['recentes', 'Recentes'], ['sistemas', 'Sistemas'], ['projetos', 'Projetos'], ['decisoes', 'Decisões'], ['notas', 'Notas'], ['processos', 'Processos'], ['pessoas', 'Pessoas'], ['prompts', 'Prompts'], ['arquivos', 'Arquivos']];
const PESO_CAT = {sistemas: 30, projetos: 22, decisoes: 14, processos: 12, notas: 8, pessoas: 10, prompts: 4, arquivos: 0};
const contextoSistema = () => (WS.aberto && WS.sid) || (Insp.sel && (Insp.sel.tipo === 'sistema' ? Insp.sel.id : (porId.get(Insp.sel.id) || {}).cluster)) || null;
const ACOES = [
  {id: 'nova-nota', rot: 'Nova nota', dica: 'N', palavras: 'nova nota criar capturar conhecimento escrever', escrita: true, fn: () => Editor.novo({sistema: contextoSistema()})},
  {id: 'decisao', rot: 'Registrar decisão', dica: 'D', palavras: 'registrar decisao nova decisao travar', escrita: true, fn: () => Decisao.nova({sistema: contextoSistema()})},
  {id: 'tarefa', rot: 'Nova tarefa', dica: 'T', palavras: 'nova tarefa pendencia fazer checklist', escrita: true, fn: () => Tarefa.nova({sistema: contextoSistema()})},
  {id: 'projeto', rot: 'Novo sistema ou projeto', palavras: 'novo projeto sistema cliente criar', escrita: true, fn: () => Projeto.novo({pai: (porCl.get(contextoSistema()) || {}).hub})},
  {id: 'inbox', rot: 'Captura rápida na Inbox', palavras: 'inbox captura rapida ideia anotar', escrita: true, fn: () => Editor.novo({tipo: 'captura', sistema: contextoSistema()})},
  {id: 'link', rot: 'Vincular arquivo ou link', palavras: 'vincular link arquivo url caminho', escrita: true, fn: () => Vinculo.novo({sistema: contextoSistema()})},
  {id: 'prompts', rot: 'Biblioteca de prompts', palavras: 'biblioteca prompts copiar', fn: () => Biblioteca.abrir()},
  {id: 'apresentacao', rot: 'Modo apresentação', dica: 'P', palavras: 'modo apresentacao tour narracao', fn: () => Apresentacao.alternar()},
  {id: 'visao', rot: 'Visão geral do mapa', palavras: 'visao geral mapa recentralizar inicio', fn: () => { if (WS.aberto) fecharWS(); SC.fecharInspector(); SC.mapa.visaoGeral(); }},
  {id: 'atualizar', rot: 'Atualizar mapa com o vault', palavras: 'atualizar recarregar sincronizar mapa', fn: () => recarregarMapa()},
];

function docsDoMapa(){ return nos.map(n => ({id: n.id, tipo: n.tipo, cluster: n.cluster, tags: n.tags || [], t: n.resumo || '', refs: []})); }
function prepararDocs(lista){ return lista.map(d => Object.assign(d, {ns: sem(d.id), nt: sem((d.tags || []).join(' ')), ts: sem(d.t || '')})); }
function carregarIndice(){
  if (Pal.docs) return Promise.resolve(Pal.docs);
  if (!CFG){ Pal.docs = prepararDocs(docsDoMapa()); return Promise.resolve(Pal.docs); }
  if (!Pal.carregando){
    Pal.carregando = api('indice').then(r => {
      r.notas.forEach(d => { if (!porId.has(d.id)) nomesExtras.add(d.id.toLowerCase()); });
      indiceCompleto = true; Pal.erro = null;
      return (Pal.docs = prepararDocs(r.notas));
    }).catch(e => { Pal.erro = e; return (Pal.docs = prepararDocs(docsDoMapa())); })
      .finally(() => { Pal.carregando = null; if (Pal.aberta) buscar(); });
  }
  return Pal.carregando;
}
SC.on('dados-mudaram', () => { Pal.docs = null; if (CFG) setTimeout(carregarIndice, 500); });

function categoria(doc){
  const n = porId.get(doc.id);
  if (n && n.hub) return 'sistemas';
  return tipoDe(doc.tipo).cat === 'sistemas' ? 'notas' : tipoDe(doc.tipo).cat;
}
function pontos(doc, termos){
  let total = 0;
  for (const t of termos){
    let s = 0;
    const i = doc.ns.indexOf(t);
    if (i === 0) s = 120;
    else if (i > 0) s = /[\s\-—·(/]/.test(doc.ns[i - 1]) ? 90 : 55;
    else if (doc.nt.includes(t)) s = 35;
    else {
      let j = doc.ts.indexOf(t), vezes = 0;
      while (j >= 0 && vezes < 6){ vezes++; j = doc.ts.indexOf(t, j + t.length); }
      if (vezes) s = 10 + vezes * 2;
    }
    if (!s) return 0;
    total += s;
  }
  return total;
}
function marcar(texto, termos){
  const ns = sem(texto), faixas = [];
  termos.forEach(t => { let i = ns.indexOf(t); while (i >= 0 && t){ faixas.push([i, i + t.length]); i = ns.indexOf(t, i + t.length); } });
  if (!faixas.length || ns.length !== texto.length) return esc(texto);
  faixas.sort((a, b) => a[0] - b[0]);
  let html = '', pos = 0;
  for (const [a, b] of faixas){ if (a < pos) continue; html += esc(texto.slice(pos, a)) + '<mark>' + esc(texto.slice(a, b)) + '</mark>'; pos = b; }
  return html + esc(texto.slice(pos));
}
function trecho(doc, termos){
  if (!doc.t) return '';
  for (const t of termos){
    const i = doc.ts.indexOf(t);
    if (i >= 0 && doc.ns.indexOf(t) < 0){
      const ini = Math.max(0, i - 48), fim = Math.min(doc.t.length, i + t.length + 110);
      return (ini ? '…' : '') + marcar(doc.t.slice(ini, fim), termos) + (fim < doc.t.length ? '…' : '');
    }
  }
  return esc(doc.t.slice(0, 150)) + (doc.t.length > 150 ? '…' : '');
}
function subtitulo(doc){
  const n = porId.get(doc.id), c = n ? sistemaDe(n) : null;
  const partes = [c ? nomeSistema(c) : (doc.tipo === 'inbox' ? 'Inbox' : 'Central'), tipoDe(doc.tipo).rot];
  if (n && n.status) partes.push(n.status);
  if (n && n.travado) partes.push('🔒');
  return partes.join(' › ');
}

function buscar(){
  const q = Pal.q.trim(), termos = sem(q).split(/\s+/).filter(Boolean);
  const itens = [];
  if (!termos.length){
    ler('sc-recentes', []).slice(0, 6).forEach(r => {
      if (r.tipo === 'sistema' && porCl.has(r.id)){ const c = porCl.get(r.id); itens.push({grupo: 'recentes', tipo: 'sistema', id: c.id, titulo: esc(nomeSistema(c)), sub: tipoSistema(c), cor: '--cyan'}); }
      else if (r.tipo === 'nota'){ const n = notaPorNome(r.id); itens.push({grupo: 'recentes', tipo: 'nota', id: r.id, titulo: esc(curto(r.id)), sub: n ? subtitulo(n) : 'Nota', cor: n ? tipoDe(n.tipo).cor : '--cyan'}); }
    });
    ACOES.forEach(a => itens.push({grupo: 'acoes', tipo: 'acao', acao: a, titulo: esc(a.rot), sub: a.escrita && !ESCRITA ? 'Disponível no app' : '', dica: a.dica, desligado: a.escrita && !ESCRITA}));
    return finalizar(itens, termos);
  }
  ACOES.forEach(a => { if (termos.every(t => sem(a.rot + ' ' + a.palavras).includes(t))) itens.push({grupo: 'acoes', tipo: 'acao', acao: a, titulo: marcar(a.rot, termos), dica: a.dica, desligado: a.escrita && !ESCRITA, pts: 200}); });
  clusters.forEach(c => {
    const nome = nomeSistema(c), s = pontos({ns: sem(nome + ' ' + c.id), nt: '', ts: ''}, termos);
    if (s) itens.push({grupo: 'sistemas', tipo: 'sistema', id: c.id, titulo: marcar(nome, termos), sub: `${tipoSistema(c)} · ${c.total} notas · ${c.tipos.projeto || 0} projetos`, cor: '--cyan', pts: s + 40 + Math.min(20, c.total / 3)});
  });
  for (const doc of Pal.docs || []){
    const n = porId.get(doc.id);
    if (n && n.hub) continue;
    const s = pontos(doc, termos);
    if (s){
      const cat = categoria(doc);
      itens.push({grupo: cat, tipo: 'nota', id: doc.id, titulo: marcar(curto(doc.id), termos), sub: subtitulo(doc), trecho: trecho(doc, termos),
        cor: n && n.arquivo ? '--c-arquivo' : tipoDe(doc.tipo).cor, pts: s + (PESO_CAT[cat] || 0) + (n ? Math.min(12, n.grau / 2) : 0) - (n && n.arquivo ? 25 : 0)});
    }
    for (const r of doc.refs || []){
      const alvo = sem(r.alvo + ' ' + (r.rotulo || '') + ' ' + (r.secao || ''));
      if (termos.every(t => alvo.includes(t)))
        itens.push({grupo: 'arquivos', tipo: 'arquivo', ref: r, id: doc.id, titulo: marcar(r.rotulo && !['repositorio', 'pasta_local', 'deploy', 'url'].includes(r.rotulo) ? r.rotulo : rotuloAlvo(r.alvo), termos),
          sub: `${r.tipo === 'url' ? 'Link' : 'Caminho local'} › em ${curto(doc.id)}${r.secao && r.secao !== 'frontmatter' ? ' · ' + r.secao : ''}`, trecho: esc(r.alvo), cor: r.tipo === 'url' ? '--cyan' : '--c-processo', pts: 20});
    }
  }
  return finalizar(itens, termos);
}
function finalizar(itens, termos){
  const contas = {tudo: 0};
  itens.forEach(it => { if (it.grupo !== 'acoes' && it.grupo !== 'recentes'){ contas[it.grupo] = (contas[it.grupo] || 0) + 1; contas.tudo++; } });
  let visiveis = itens.filter(it => Pal.filtro === 'tudo' || it.grupo === Pal.filtro || (!termos.length && it.grupo === 'acoes'));
  const saida = [];
  GRUPOS_PAL.forEach(([g]) => {
    const doGrupo = visiveis.filter(it => it.grupo === g).sort((a, b) => (b.pts || 0) - (a.pts || 0));
    saida.push(...doGrupo.slice(0, Pal.filtro === 'tudo' ? (g === 'acoes' && termos.length ? 3 : g === 'acoes' ? 10 : 6) : 60));
  });
  if (termos.length && ESCRITA && !saida.some(it => it.tipo === 'nota' && sem(it.id) === sem(Pal.q.trim())))
    saida.push({grupo: 'acoes', tipo: 'criar', titulo: `Criar nota “${esc(Pal.q.trim())}”`, sub: 'Nova nota com este título', cor: '--cyan'});
  Pal.itens = saida; Pal.contas = contas;
  Pal.sel = Math.min(Pal.sel, Math.max(0, saida.length - 1));
  pintarPal(termos);
}
function pintarPal(termos){
  const lista = $('#sc-pal-lista', Pal.el), filtros = $('.sc-pal-filtros', Pal.el);
  filtros.innerHTML = FILTROS_PAL.map(([id, r]) => `<button type="button" class="sc-chip" role="tab" data-pal-filtro="${id}" aria-selected="${Pal.filtro === id}" tabindex="-1">${r}${termos.length && Pal.contas[id] ? ` <span class="sc-n">${Pal.contas[id]}</span>` : ''}</button>`).join('');
  if (!Pal.itens.length){
    lista.innerHTML = `<div class="sc-pal-vazio">${Pal.carregando ? 'Indexando o conteúdo do vault…' : `Nada encontrado para “${esc(Pal.q)}”${Pal.filtro !== 'tudo' ? ' nesta categoria' : ''}.`}<br><span style="font-size:12px">${Pal.filtro !== 'tudo' ? 'Tente “Tudo” ou ' : ''}outras palavras — a busca ignora acentos.</span></div>`;
  } else {
    let html = '', grupo = '';
    Pal.itens.forEach((it, i) => {
      if (it.grupo !== grupo){ grupo = it.grupo; html += `<div class="sc-pal-grupo" role="presentation">${GRUPOS_PAL.find(g => g[0] === grupo)[1]}</div>`; }
      html += `<button type="button" class="sc-pal-item" role="option" id="sc-pal-o-${i}" data-i="${i}" aria-selected="${i === Pal.sel}" ${it.desligado ? 'aria-disabled="true"' : ''} tabindex="-1">
        <span class="sc-ponto ${it.tipo === 'acao' || it.tipo === 'criar' ? 'vazio' : ''}" style="--c:var(${it.cor || '--cyan'})"></span>
        <span style="min-width:0"><span class="sc-t" style="display:block">${it.titulo}</span>${it.sub ? `<span class="sc-s">${esc(it.sub)}</span>` : ''}${it.trecho ? `<span class="sc-trecho">${it.trecho}</span>` : ''}</span>
        <span class="sc-dica">${it.dica ? `<span class="sc-kbd">${it.dica}</span>` : i === Pal.sel ? '↵ abrir' : ''}</span></button>`;
    });
    lista.innerHTML = html;
  }
  const input = $('input', Pal.el);
  input.setAttribute('aria-activedescendant', Pal.itens.length ? `sc-pal-o-${Pal.sel}` : '');
  const ativo = $(`#sc-pal-o-${Pal.sel}`, Pal.el);
  if (ativo) ativo.scrollIntoView({block: 'nearest'});
  $('.sc-fonte', Pal.el).textContent = Pal.carregando ? 'indexando…' : Pal.erro ? 'só títulos e resumos (servidor indisponível)' : CFG ? `conteúdo completo · ${(Pal.docs || []).length} notas` : 'somente leitura: títulos e resumos';
}

function montarPaleta(){
  const el = document.createElement('div');
  el.id = 'sc-paleta'; el.className = 'sc-raiz sc-oculto';
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Busca global');
  el.innerHTML = `<div class="sc-pal-campo"><span aria-hidden="true">›</span>
      <input type="text" role="combobox" aria-expanded="true" aria-controls="sc-pal-lista" aria-autocomplete="list" autocomplete="off" spellcheck="false" placeholder="Buscar notas, projetos, decisões, pessoas…" aria-label="Buscar no Segundo Cérebro">
      <span class="sc-kbd">ESC</span></div>
    <div class="sc-pal-filtros" role="tablist" aria-label="Categoria"></div>
    <div class="sc-pal-lista" id="sc-pal-lista" role="listbox" aria-label="Resultados"></div>
    <footer class="sc-pal-rodape"><span>↑↓ navegar</span><span>↵ abrir</span><span>⌘↵ Obsidian</span><span>⇥ categoria</span><span>esc fechar</span><span class="sc-fonte"></span></footer>`;
  document.body.append(el);
  Pal.el = el;
  const input = $('input', el);
  input.addEventListener('input', () => { Pal.q = input.value; Pal.sel = 0; buscar(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp'){
      e.preventDefault();
      if (Pal.itens.length){ Pal.sel = (Pal.sel + (e.key === 'ArrowDown' ? 1 : -1) + Pal.itens.length) % Pal.itens.length; pintarPal(sem(Pal.q).split(/\s+/).filter(Boolean)); }
    } else if (e.key === 'Enter'){
      e.preventDefault(); executarPal(Pal.itens[Pal.sel], {obsidian: e.metaKey || e.ctrlKey});
    } else if (e.key === 'Tab'){
      e.preventDefault(); e.stopPropagation();
      const i = FILTROS_PAL.findIndex(f => f[0] === Pal.filtro);
      Pal.filtro = FILTROS_PAL[(i + (e.shiftKey ? -1 : 1) + FILTROS_PAL.length) % FILTROS_PAL.length][0];
      Pal.sel = 0; buscar();
    }
  });
  el.addEventListener('click', e => {
    const f = e.target.closest('[data-pal-filtro]');
    if (f){ Pal.filtro = f.dataset.palFiltro; Pal.sel = 0; buscar(); input.focus(); return; }
    const it = e.target.closest('.sc-pal-item');
    if (it) executarPal(Pal.itens[+it.dataset.i], {obsidian: e.metaKey || e.ctrlKey});
  });
  el.addEventListener('mousemove', e => {
    const it = e.target.closest('.sc-pal-item');
    if (it && +it.dataset.i !== Pal.sel){ Pal.sel = +it.dataset.i; $$('.sc-pal-item', el).forEach(b => b.setAttribute('aria-selected', +b.dataset.i === Pal.sel)); input.setAttribute('aria-activedescendant', it.id); }
  });
}
function abrirPal({texto = '', filtro = 'tudo'} = {}){
  fecharMenu();
  if (Pal.aberta){ const inp = $('input', Pal.el); inp.focus(); inp.select(); return; }
  Pal.aberta = true; Pal.filtro = filtro; Pal.q = texto; Pal.sel = 0;
  const el = Pal.el, input = $('input', el);
  input.value = texto;
  Pal.veu = document.createElement('div'); Pal.veu.className = 'sc-veu sc-veu-instantaneo';
  Pal.veu.addEventListener('click', fecharPal);
  document.body.insertBefore(Pal.veu, el);
  el.classList.remove('sc-oculto');
  requestAnimationFrame(() => { Pal.veu.classList.add('on'); el.classList.add('on'); });
  Pal.camada = {el, tipo: 'paleta', fechar: () => { fecharPal(); return true; }};
  empilhar(Pal.camada);
  input.focus();
  if (!Pal.docs) carregarIndice();
  buscar();
}
function fecharPal(){
  if (!Pal.aberta) return;
  Pal.aberta = false;
  Pal.el.classList.remove('on');
  const veu = Pal.veu;
  veu && veu.classList.remove('on');
  setTimeout(() => { if (!Pal.aberta) Pal.el.classList.add('sc-oculto'); veu && veu.remove(); }, 0);
  desempilhar(Pal.camada);
  const q = $('#q');
  if (q) q.value = '';
}
SC.abrirBusca = abrirPal;
function executarPal(it, {obsidian = false} = {}){
  if (!it) return;
  if (it.desligado){ podeEditar(); return; }
  if (it.tipo === 'acao'){ fecharPal(); it.acao.fn(); return; }
  if (it.tipo === 'criar'){ const t = Pal.q.trim(); fecharPal(); Editor.novo({titulo: t, sistema: contextoSistema()}); return; }
  fecharPal();
  if (it.tipo === 'sistema'){
    lembrarRecente({tipo: 'sistema', id: it.id});
    if (WS.aberto) abrirWS(it.id);
    else selecionarSistema(it.id, {voar: true});
    return;
  }
  if (it.tipo === 'arquivo' && !obsidian){
    if (it.ref.tipo === 'url') window.open(it.ref.alvo, '_blank', 'noopener');
    else revelarNoFinder(it.ref.alvo);
    return;
  }
  const n = notaPorNome(it.id);
  if (obsidian && n) return abrirObsidian(n);
  SC.abrirNota(it.id);
}
function lembrarRecente(r){
  const lista = ler('sc-recentes', []).filter(x => !(x.tipo === r.tipo && x.id === r.id));
  lista.unshift(r);
  gravar('sc-recentes', lista.slice(0, 10));
}

/* ---------- abrir qualquer nota pelo nome (links, busca, conexões) ---------- */
SC.abrirNota = (nome, {de} = {}) => {
  const topo = pilha[pilha.length - 1];
  if (de && topo && topo.tipo === 'modal' && topo.el.contains(de)) topo.fechar(true);   // sem cadeia de modais
  const n = notaPorNome(nome);
  if (!n) return Leitor.abrir(nome);
  if (n.tipo === 'prompt') return Biblioteca.abrir(n.id);
  if (n.tipo === 'pessoa' && !porCl.has(n.id)) return Pessoa.abrir(n.id);
  if (n.tipo === 'processo') return Processo.abrir(n.id);
  abrirWS(n.cluster, {aba: n.tipo === 'decisao' ? 'decisoes' : 'notas', nota: n.id});
};
/* leitura de notas que ficam fora do mapa (00 - CENTRAL, Inbox, modelos) */
const Leitor = {
  abrir(nome){
    const m = modal({classe: 'largo', rotulo: 'LEITURA', titulo: esc(nome), corpo: '<div class="sc-painel-leitor" style="padding:0"></div>'});
    renderLeitor($('.sc-painel-leitor', m.el), nome);
  },
};
