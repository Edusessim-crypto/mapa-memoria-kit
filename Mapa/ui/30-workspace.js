/* Workspace: a área completa de um sistema — visão geral, notas (lista + leitura), decisões, processos e arquivos. */
const WS = {aberto: false, sid: null, aba: 'geral', nota: null, ag: null, erro: null, hist: [],
  filtro: {q: '', tipo: 'todos', ordem: 'recentes', tag: ''}, dec: 'todas', aberta: null, todasTarefas: false};
let wsEl = null, wsVeu = null, wsCamada = null, wsPedido = 0;
const ABAS_WS = [['geral', 'Visão geral'], ['notas', 'Notas'], ['decisoes', 'Decisões'], ['processos', 'Processos'], ['arquivos', 'Arquivos']];

function abrirWS(sid, {aba = 'geral', nota = null, historico = true} = {}){
  const c = porCl.get(sid);
  if (!c) return;
  fecharMenu();
  if (WS.aberto && historico && (WS.sid !== sid || WS.aba !== aba || WS.nota !== nota)) WS.hist.push({sid: WS.sid, aba: WS.aba, nota: WS.nota});
  const trocou = WS.sid !== sid;
  if (trocou){
    Object.assign(WS, {ag: null, erro: null, filtro: {q: '', tipo: 'todos', ordem: 'recentes', tag: ''}, dec: 'todas', todasTarefas: false});
  }
  Object.assign(WS, {sid, aba, nota, aberta: aba === 'decisoes' ? nota : WS.aberta});
  if (!WS.aberto) montarWS();
  else if (trocou) SC.mapa.entrarSistema(sid);
  pintarWS();
  carregarAgregadoWS();
  history.replaceState(null, '', `#/sistema/${enc(sid)}/${aba}${nota ? '/' + enc(nota) : ''}`);
  lembrarRecente({tipo: 'sistema', id: sid});
}
SC.abrirWS = abrirWS;
function montarWS(){
  WS.aberto = true;
  wsVeu = document.createElement('div'); wsVeu.className = 'sc-veu';
  wsEl = document.createElement('section');
  wsEl.id = 'sc-ws'; wsEl.className = 'sc-raiz sc-cantos';
  wsEl.setAttribute('role', 'dialog'); wsEl.setAttribute('aria-modal', 'true'); wsEl.setAttribute('aria-labelledby', 'sc-ws-titulo');
  document.body.append(wsVeu, wsEl);
  document.body.classList.add('sc-pagina-aberta');
  requestAnimationFrame(() => { wsVeu.classList.add('on'); wsEl.classList.add('on'); });
  wsCamada = {el: wsEl, tipo: 'pagina', fechar: () => fecharWS()};
  empilhar(wsCamada);
  wsEl.addEventListener('click', cliqueWS);
  wsEl.addEventListener('input', debounce(e => { if (e.target.id === 'sc-ws-busca'){ WS.filtro.q = e.target.value; pintarListaNotas(); } }, 120));
  wsEl.addEventListener('change', e => {
    if (e.target.id === 'sc-ws-ordem'){ WS.filtro.ordem = e.target.value; pintarListaNotas(); }
    if (e.target.id === 'sc-ws-tag'){ WS.filtro.tag = e.target.value; pintarListaNotas(); }
  });
  wsEl.addEventListener('keydown', e => {
    if (!e.target.matches('.sc-ws-abas .sc-aba') || !/Arrow(Left|Right)/.test(e.key)) return;
    const abas = $$('.sc-ws-abas .sc-aba', wsEl), i = abas.indexOf(e.target), j = (i + (e.key === 'ArrowRight' ? 1 : -1) + abas.length) % abas.length;
    abas[j].focus(); abas[j].click();
  });
  SC.mapa.entrarSistema(WS.sid);
}
function fecharWS(){
  if (!WS.aberto) return true;
  WS.aberto = false;
  wsEl.classList.remove('on'); wsVeu.classList.remove('on');
  const el = wsEl, veu = wsVeu;
  setTimeout(() => { el.remove(); veu.remove(); }, REDUZ ? 0 : 260);
  desempilhar(wsCamada);
  document.body.classList.remove('sc-pagina-aberta');
  WS.hist = [];
  history.replaceState(null, '', location.pathname + location.search);
  SC.mapa.sairSistema();
  if (alteracoesMapa) setTimeout(() => recarregarMapa('O mapa foi atualizado com as alterações.'), REDUZ ? 0 : 320);
  return true;
}
function voltarWS(){
  const ant = WS.hist.pop();
  if (ant) abrirWS(ant.sid, {aba: ant.aba, nota: ant.nota, historico: false});
}
async function carregarAgregadoWS(){
  if (!CFG || WS.ag) return;
  const pedido = ++wsPedido, sid = WS.sid;
  try {
    const ag = await agregado(sid);
    if (pedido !== wsPedido || WS.sid !== sid) return;
    WS.ag = ag; WS.erro = null;
  } catch (e) {
    if (pedido !== wsPedido) return;
    WS.erro = e;
  }
  if (WS.aberto) pintarWS({manterLeitor: true});
}
SC.on('dados-mudaram', () => { if (WS.aberto){ WS.ag = null; carregarAgregadoWS(); } });

/* ---------- moldura ---------- */
function pintarWS({manterLeitor = false} = {}){
  const c = porCl.get(WS.sid), ct = contagem(c), ag = WS.ag;
  const pend = ag ? ag.tarefas.filter(t => !t.feito).length : ct.pendencias;
  const n = {notas: c.total, decisoes: ct.decisoes, processos: ag ? ag.processos.length : ct.processos, arquivos: ag ? ag.arquivos.length : null};
  const leitorAtual = manterLeitor && WS.aba === 'notas' && $('#sc-leitor', wsEl);
  const rolagem = $('.sc-ws-corpo', wsEl) ? $('.sc-ws-corpo', wsEl).scrollTop : 0;
  const notaAtual = WS.nota && porId.get(WS.nota);
  wsEl.innerHTML = `<i class="cant a"></i><i class="cant b"></i>
    <header class="sc-ws-cab">
      <nav class="sc-migalhas" aria-label="Caminho">
        ${WS.hist.length ? '<button type="button" data-ws="voltar" title="Voltar">← Voltar</button><span>·</span>' : ''}
        <button type="button" data-ws="mapa">Segundo Cérebro</button><span>/</span>
        <button type="button" data-ws="aba-geral">${esc(nomeSistema(c))}</button>
        ${WS.aba !== 'geral' ? `<span>/</span><button type="button" data-ws="aba-${WS.aba}">${ABAS_WS.find(a => a[0] === WS.aba)[1]}</button>` : ''}
        ${notaAtual && WS.aba === 'notas' ? `<span>/</span><span aria-current="page">${esc(curto(notaAtual.id))}</span>` : ''}
      </nav>
      <div class="sc-ws-titulo"><h1 id="sc-ws-titulo">${esc(nomeSistema(c))}</h1>
        <span class="sc-estado" style="--c:var(--cyan)">${esc(tipoSistema(c))}</span>
        <span class="sc-estado" style="--c:var(${c.ativo ? '--sc-ok' : '--muted'})"><span class="sc-ponto ${c.ativo ? '' : 'vazio'}" style="--c:var(${c.ativo ? '--sc-ok' : '--faint'})"></span>${c.ativo ? 'Projeto ativo' : 'Sem projeto ativo'}</span></div>
      <p class="sc-ws-desc">${esc(descSistema(c))}</p>
      <div class="sc-ws-acoes">
        <button type="button" class="sc-btn primario" data-ws="nova-nota">+ Nota</button>
        <button type="button" class="sc-btn" data-ws="nova-decisao">◇ Decisão</button>
        <button type="button" class="sc-btn" data-ws="nova-tarefa">☑ Tarefa</button>
        <button type="button" class="sc-btn icone" data-ws="mais" aria-label="Mais ações" aria-haspopup="menu">⋯</button>
        <button type="button" class="sc-btn" data-ws="mapa" title="Esc">← Mapa</button>
      </div>
      <div class="sc-kpis sc-ws-kpis">
        <div class="sc-kpi"><b>${n.notas}</b><span>Notas</span></div>
        <div class="sc-kpi"><b>${ct.projetos}</b><span>Projetos</span></div>
        <div class="sc-kpi"><b>${n.decisoes}</b><span>Decisões</span>${ct.travadas ? `<small>🔒 ${ct.travadas}</small>` : ''}</div>
        <div class="sc-kpi ${n.processos === null ? 'carregando' : ''}"><b>${n.processos ?? '—'}</b><span>Processos</span></div>
        <div class="sc-kpi"><b>${pend}</b><span>Pendências</span></div>
        <div class="sc-kpi ${n.arquivos === null ? 'carregando' : ''}"><b>${n.arquivos ?? '—'}</b><span>Links e arquivos</span></div>
      </div>
    </header>
    <nav class="sc-abas sc-ws-abas" role="tablist" aria-label="Seções do sistema">
      ${ABAS_WS.map(([id, r]) => { const q = {notas: n.notas, decisoes: n.decisoes, processos: n.processos, arquivos: n.arquivos}[id];
        return `<button type="button" class="sc-aba" role="tab" id="sc-aba-${id}" aria-controls="sc-ws-corpo" aria-selected="${WS.aba === id}" tabindex="${WS.aba === id ? 0 : -1}" data-ws="aba-${id}">${r}${q !== undefined && q !== null ? ` <span class="sc-n">${q}</span>` : ''}</button>`; }).join('')}
    </nav>
    <div class="sc-ws-corpo ${WS.aba === 'notas' ? 'dividido' + (WS.nota ? ' lendo' : '') : ''}" id="sc-ws-corpo" role="tabpanel" aria-labelledby="sc-aba-${WS.aba}"></div>`;
  const corpo = $('#sc-ws-corpo', wsEl);
  ({geral: abaGeral, notas: abaNotas, decisoes: abaDecisoes, processos: abaProcessos, arquivos: abaArquivos})[WS.aba](corpo, c, leitorAtual);
  if (manterLeitor && WS.aba !== 'notas') corpo.scrollTop = rolagem;
}
function cliqueWS(e){
  const b = e.target.closest('[data-ws]');
  if (b){
    const a = b.dataset.ws;
    if (a === 'mapa') return fecharWS();
    if (a === 'voltar') return voltarWS();
    if (a.startsWith('aba-')) return abrirWS(WS.sid, {aba: a.slice(4)});
    const c = porCl.get(WS.sid);
    if (a === 'nova-nota') return Editor.novo({sistema: WS.sid});
    if (a === 'nova-decisao') return Decisao.nova({sistema: WS.sid});
    if (a === 'nova-tarefa') return Tarefa.nova({sistema: WS.sid});
    if (a === 'novo-processo') return Editor.novo({sistema: WS.sid, tipo: 'sop'});
    if (a === 'vincular') return Vinculo.novo({sistema: WS.sid});
    if (a === 'todas-tarefas'){ WS.todasTarefas = !WS.todasTarefas; return pintarWS({manterLeitor: true}); }
    if (a === 'mais') return menu(b, [
      {icone: '⛓', rotulo: 'Vincular arquivo ou link', acao: () => Vinculo.novo({sistema: WS.sid})},
      {icone: '◈', rotulo: 'Novo projeto neste sistema', acao: () => Projeto.novo({pai: c.hub})},
      {icone: '⚙', rotulo: 'Novo processo (SOP)', acao: () => Editor.novo({sistema: WS.sid, tipo: 'sop'})},
      {icone: '✎', rotulo: 'Captura rápida na Inbox', acao: () => Editor.novo({sistema: WS.sid, tipo: 'captura'})},
      '-',
      {icone: '◎', rotulo: 'Mostrar no mapa', acao: () => { fecharWS(); setTimeout(() => selecionarSistema(WS.sid || c.id, {voar: true}), 300); }},
      ...(c.hub ? [{icone: '↗', rotulo: 'Abrir nota principal no Obsidian', acao: () => abrirObsidian(porId.get(c.hub))}] : []),
    ]);
  }
  const nota = e.target.closest('[data-nota-ws]');
  if (nota) return abrirWS(WS.sid, {aba: 'notas', nota: nota.dataset.notaWs});
  const sis = e.target.closest('[data-sis-ws]');
  if (sis) return abrirWS(sis.dataset.sisWs);
  const dec = e.target.closest('[data-dec]');
  if (dec){ WS.aberta = WS.aberta === dec.dataset.dec ? null : dec.dataset.dec; return pintarDecisoes(); }
  const proc = e.target.closest('[data-proc]');
  if (proc) return Processo.abrir(proc.dataset.proc);
  const filtro = e.target.closest('[data-filtro-tipo]');
  if (filtro){ WS.filtro.tipo = filtro.dataset.filtroTipo; return pintarListaNotas(); }
  const fd = e.target.closest('[data-filtro-dec]');
  if (fd){ WS.dec = fd.dataset.filtroDec; return pintarDecisoes(); }
}

/* ---------- visão geral ---------- */
function abaGeral(corpo, c){
  const m = membros.get(c.id) || [], ag = WS.ag;
  const projetos = projetosDe(c.id);
  const decisoes = ag ? ag.decisoes.filter(d => !d.externa) : m.filter(n => n.tipo === 'decisao').map(n => ({id: n.id, status: n.status, data: n.data, travado: n.travado, arquivo: n.arquivo}));
  const abertas = decisoes.filter(d => ABERTAS.has(d.status));
  const recentes = decisoes.filter(d => !ABERTAS.has(d.status) && !d.arquivo).sort((a, b) => (b.data || '').localeCompare(a.data || '')).slice(0, 5);
  const tarefas = ag ? ag.tarefas.filter(t => !t.feito) : null;
  const hub = c.hub && porId.get(c.hub);
  corpo.innerHTML = `<div class="sc-grade-geral">
    <div class="sc-coluna">
      <section class="sc-bloco"><div class="sc-rotulo linha">Resumo</div>
        ${ag ? (ag.hub_md ? `<div class="sc-md">${md(ag.hub_md)}</div>` : `<p class="sc-insp-desc">${esc(descSistema(c)) || 'Sem resumo na nota principal.'}</p>`) : (CFG && !WS.erro ? esqueleto(3) : `<p class="sc-insp-desc">${esc(descSistema(c)) || '—'}</p>`)}
      </section>
      <section class="sc-bloco"><div class="sc-rotulo linha">Projetos <span class="sc-n">${projetos.length}</span></div>
        ${projetos.length ? `<div class="sc-cartoes">${projetos.map(cartaoProjeto).join('')}</div>` : vazio('Nenhum projeto neste sistema.', 'Projetos entram aqui pelo campo cliente/marca do frontmatter.', ESCRITA ? '<button type="button" class="sc-link" data-ws="mais">+ Novo projeto</button>' : '')}
      </section>
      <section class="sc-bloco"><div class="sc-rotulo linha">Pendências abertas <span class="sc-n">${tarefas ? tarefas.length : contagem(c).pendencias}</span></div>
        ${tarefas ? (tarefas.length ? htmlListaTarefas(WS.todasTarefas ? tarefas : tarefas.slice(0, 8)) + (tarefas.length > 8 ? `<button type="button" class="sc-link" data-ws="todas-tarefas">${WS.todasTarefas ? 'Mostrar menos' : `Ver todas (${tarefas.length})`}</button>` : '') : vazio('Nenhuma tarefa aberta nas notas deste sistema.', '', ESCRITA ? '<button type="button" class="sc-link" data-ws="nova-tarefa">+ Nova tarefa</button>' : ''))
          : (WS.erro ? caixaErro(WS.erro, () => { WS.ag = null; carregarAgregadoWS(); }) : CFG ? esqueleto(4) : vazio(`${contagem(c).pendencias} tarefas abertas.`, 'Abra pelo app para ver e marcar.'))}
      </section>
      <section class="sc-bloco"><div class="sc-rotulo linha">Decisões <span class="sc-n">${decisoes.length}</span></div>
        ${abertas.length ? `<div class="sc-aviso-caixa">${abertas.length} decisão${abertas.length > 1 ? 'ões' : ''} em aberto (validação pendente).</div>` : ''}
        ${[...abertas, ...recentes].length ? `<div class="sc-lista">${[...abertas, ...recentes].map(d => { const n = porId.get(d.id) || d; return `<button type="button" class="sc-item" data-ir-dec="${esc(d.id)}"><span class="sc-ponto" style="--c:var(${STATUS_COR[d.status] || '--c-decisao'})"></span><span style="min-width:0"><span class="sc-t" style="display:block">${esc(curto(d.id))}${d.travado ? ' <span style="color:var(--c-decisao)">🔒</span>' : ''}</span><span class="sc-s">${esc([dataCurta(d.data), d.status].filter(Boolean).join(' · '))}</span></span><span class="sc-d">→</span></button>`; }).join('')}</div>`
          : vazio('Nenhuma decisão registrada.', '', ESCRITA ? '<button type="button" class="sc-link" data-ws="nova-decisao">+ Registrar decisão</button>' : '')}
      </section>
      <section class="sc-bloco"><div class="sc-rotulo linha">Processos <span class="sc-n">${ag ? ag.processos.length : '—'}</span></div>
        ${ag ? (ag.processos.length ? `<div class="sc-lista">${ag.processos.map(p => `<button type="button" class="sc-item" data-proc="${esc(p.id)}"><span class="sc-ponto" style="--c:var(--c-processo)"></span><span style="min-width:0"><span class="sc-t" style="display:block">${esc(curto(p.id))}</span><span class="sc-s">${p.passos.length} etapas · ${p.checklist.length} itens de checklist${p.execucoes.length ? ' · última execução ' + esc(p.execucoes[0].split(' — ')[0]) : ''}${p.externo ? ' · vinculado' : ''}</span></span><span class="sc-d">→</span></button>`).join('')}</div>`
          : vazio('Nenhum processo (SOP) ligado a este sistema.', '', ESCRITA ? '<button type="button" class="sc-link" data-ws="novo-processo">+ Criar processo</button>' : '')) : (CFG && !WS.erro ? esqueleto(2) : vazio('Disponível no app.'))}
      </section>
    </div>
    <aside class="sc-lado">
      <section class="sc-bloco"><div class="sc-rotulo linha">Contexto</div>
        <dl class="sc-meta-lista">
          <dt>Tipo</dt><dd>${esc(tipoSistema(c))}</dd>
          ${hub ? `<dt>Nota</dt><dd><button type="button" class="sc-link" data-nota-ws="${esc(hub.id)}">${esc(hub.id)}</button></dd><dt>Pasta</dt><dd>${esc(hub.rel.split('/').slice(0, -1).join(' / '))}</dd>` : ''}
          <dt>Atualizado</dt><dd>${esc(dataRel(ultimaAtualizacao(membros.get(c.id) || [])))}</dd>
        </dl>
      </section>
      <section class="sc-bloco"><div class="sc-rotulo linha">Atalhos</div>
        <div class="sc-atalhos">
          <button type="button" class="sc-btn" data-ws="nova-nota">+ Capturar nota</button>
          <button type="button" class="sc-btn" data-ws="nova-decisao">◇ Registrar decisão</button>
          <button type="button" class="sc-btn" data-ws="nova-tarefa">☑ Nova tarefa</button>
          <button type="button" class="sc-btn" data-ws="vincular">⛓ Vincular arquivo ou link</button>
        </div>
      </section>
      <section class="sc-bloco"><div class="sc-rotulo linha">Atividade</div>
        ${ag ? htmlAtividade(ag, 6) : CFG && !WS.erro ? esqueleto(4) : vazio('Histórico disponível no app.')}
      </section>
      <section class="sc-bloco"><div class="sc-rotulo linha">Conexões</div>${htmlBarras(conexoesSistema(c.id)).replace(/data-sis="/g, 'data-sis-ws="')}</section>
    </aside>
  </div>`;
  $$('[data-ir-dec]', corpo).forEach(b => b.addEventListener('click', () => abrirWS(WS.sid, {aba: 'decisoes', nota: b.dataset.irDec})));
  ligarTarefas(corpo);
}
function cartaoProjeto(n){
  const tf = n.tarefas || [0, 0];
  return `<button type="button" class="sc-cartao" data-nota-ws="${esc(n.id)}">
    <span class="sc-estado" style="--c:var(${STATUS_COR[n.status] || '--muted'})"><span class="sc-ponto" style="--c:var(${STATUS_COR[n.status] || '--faint'})"></span>${esc(n.status || 'sem status')}</span>
    <h3>${esc(n.id)}</h3>${n.resumo ? `<p>${esc(n.resumo)}</p>` : ''}
    <span class="sc-rodape-cartao"><span>${tf[0]} pendência${tf[0] === 1 ? '' : 's'}</span>${ehData(n.atualizado) ? `<span>Atualizado ${esc(dataCurta(n.atualizado))}</span>` : ''}<span>${viz.get(n.id).size} conexões</span></span>
  </button>`;
}
function htmlListaTarefas(lista){
  return `<div class="sc-lista">${lista.map(t => `<div class="sc-tarefa ${t.feito ? 'feita' : ''}" style="padding-left:${2 + t.nivel * 16}px" data-tarefa-nota="${esc(t.nota)}" data-linha="${t.linha}">
    <input type="checkbox" class="sc-caixa" ${t.feito ? 'checked' : ''} ${ESCRITA ? '' : 'disabled'} aria-label="${esc(textoPuro(t.texto).slice(0, 90))}">
    <div><span class="sc-t">${mdInline(t.texto)}</span><span class="sc-s"><button type="button" class="sc-link" data-nota-ws="${esc(t.nota)}" style="font:inherit;letter-spacing:inherit">${esc(curto(t.nota))}</button>${t.secao ? ' · ' + esc(t.secao) : ''}</span></div></div>`).join('')}</div>`;
}
function ligarTarefas(raiz){
  $$('.sc-tarefa[data-tarefa-nota] input', raiz).forEach(cx => cx.addEventListener('change', () => {
    const linha = cx.closest('.sc-tarefa'), t = WS.ag && WS.ag.tarefas.find(x => x.nota === linha.dataset.tarefaNota && x.linha === +linha.dataset.linha);
    if (!t) return;
    alternarTarefa({id: t.nota, tarefas: [t], hash: null}, 0, cx.checked, cx);
  }));
}

/* ---------- notas: lista + leitor ---------- */
function abaNotas(corpo, c, leitorAtual){
  const m = membros.get(c.id) || [];
  const tipos = [...new Set(m.map(n => n.tipo))].sort((a, b) => tipoDe(a).rot.localeCompare(tipoDe(b).rot));
  const tags = [...new Set(m.flatMap(n => n.tags || []))].sort();
  corpo.innerHTML = `<div class="sc-painel-lista">
      <div class="sc-ferramentas">
        <label class="sc-busca-local"><span aria-hidden="true">›</span><input id="sc-ws-busca" type="search" placeholder="Filtrar notas deste sistema…" value="${esc(WS.filtro.q)}" aria-label="Filtrar notas"></label>
        <div class="sc-filtros" role="group" aria-label="Tipo">
          <button type="button" class="sc-chip" data-filtro-tipo="todos" aria-pressed="${WS.filtro.tipo === 'todos'}">Todas <span class="sc-n">${m.length}</span></button>
          ${tipos.map(t => `<button type="button" class="sc-chip" data-filtro-tipo="${t}" aria-pressed="${WS.filtro.tipo === t}"><span class="sc-ponto" style="--c:var(${tipoDe(t).cor})"></span>${tipoDe(t).rot} <span class="sc-n">${m.filter(n => n.tipo === t).length}</span></button>`).join('')}
        </div>
        <div style="display:flex;gap:8px">
          <select id="sc-ws-ordem" class="sc-select-mini" aria-label="Ordenar"><option value="recentes">Recentes</option><option value="az">A–Z</option><option value="conexoes">Mais conectadas</option><option value="pendencias">Com pendências</option></select>
          <select id="sc-ws-tag" class="sc-select-mini" aria-label="Tag" style="flex:1;min-width:0"><option value="">Todas as tags</option>${tags.map(t => `<option value="${esc(t)}">#${esc(t)}</option>`).join('')}</select>
        </div>
      </div>
      <div class="sc-lista" id="sc-ws-lista" role="list"></div>
      <div style="padding:12px 16px;border-top:1px solid var(--sc-linha)"><button type="button" class="sc-btn primario" style="width:100%" data-ws="nova-nota">+ Nova nota</button></div>
    </div>
    <div class="sc-painel-leitor" id="sc-leitor"></div>`;
  $('#sc-ws-ordem', corpo).value = WS.filtro.ordem;
  $('#sc-ws-tag', corpo).value = WS.filtro.tag;
  pintarListaNotas();
  const leitor = $('#sc-leitor', corpo);
  if (leitorAtual && WS.nota){ leitor.replaceWith(leitorAtual); return; }
  if (WS.nota) renderLeitor(leitor, WS.nota, {voltar: true});
  else leitor.innerHTML = `<div class="sc-vazio" style="max-width:520px"><b>Escolha uma nota à esquerda para ler.</b><span>As notas abrem aqui com links, tarefas e conexões. Para editar, use “Editar” no topo da nota.</span></div>`;
}
function pintarListaNotas(){
  const lista = $('#sc-ws-lista', wsEl);
  if (!lista) return;
  $$('[data-filtro-tipo]', wsEl).forEach(b => b.setAttribute('aria-pressed', b.dataset.filtroTipo === WS.filtro.tipo));
  const termos = sem(WS.filtro.q).split(/\s+/).filter(Boolean);
  const textos = Pal.docs ? new Map(Pal.docs.map(d => [d.id, d.ts])) : null;
  let m = (membros.get(WS.sid) || []).filter(n => (WS.filtro.tipo === 'todos' || n.tipo === WS.filtro.tipo) && (!WS.filtro.tag || (n.tags || []).includes(WS.filtro.tag)));
  if (termos.length) m = m.filter(n => { const alvo = sem(n.id + ' ' + (n.tags || []).join(' ') + ' ' + n.resumo) + ' ' + ((textos && textos.get(n.id)) || ''); return termos.every(t => alvo.includes(t)); });
  const ord = {recentes: (a, b) => (b.mtime || '').localeCompare(a.mtime || ''), az: ordenarPorNome, conexoes: (a, b) => b.grau - a.grau,
    pendencias: (a, b) => ((b.tarefas || [0])[0] - (a.tarefas || [0])[0]) || ordenarPorNome(a, b)}[WS.filtro.ordem];
  m.sort(ord);
  lista.innerHTML = m.length ? m.map(n => itemLista(n, {ativo: n.id === WS.nota, attr: `data-nota-ws="${esc(n.id)}" role="listitem"`,
    sub: [tipoDe(n.tipo).rot, n.status, WS.filtro.ordem === 'recentes' ? dataRel(n.mtime) : '', (n.tarefas || [0])[0] ? `${n.tarefas[0]} pend.` : ''].filter(Boolean).join(' · ')})).join('')
    : `<div style="padding:16px">${vazio('Nenhuma nota com esses filtros.', termos.length && !Pal.docs && CFG ? 'Dica: a busca no conteúdo completo usa o índice (⌘K).' : '')}</div>`;
}

async function renderLeitor(el, nome, op = {}){
  const n = notaPorNome(nome);
  el.innerHTML = `<div class="sc-leitor-cab">${n ? htmlTagsNota(n) : ''}<h2>${esc(n ? n.id : nome)}</h2></div>${esqueleto(8)}`;
  let nota;
  try { nota = await api('nota?id=' + enc(nome)); }
  catch (e) {
    if (e.codigo === 'somente_leitura' && n){
      el.innerHTML = leitorEstatico(n, op);
      el.addEventListener('click', ev => {
        const ler = ev.target.closest('[data-ler]');
        if (ler) SC.abrirNota(ler.dataset.ler);
        if (ev.target.closest('[data-leitor="fechar"]')){ WS.nota = null; pintarWS(); }
      });
      return;
    }
    el.innerHTML = `<div class="sc-leitor-cab"><h2>${esc(nome)}</h2></div>` + caixaErro(e, () => renderLeitor(el, nome, op));
    return;
  }
  const no = porId.get(nota.id);
  const tf = nota.tarefas.filter(t => !t.feito).length;
  el.innerHTML = `<article class="sc-leitor" data-tarefas-de="${esc(nota.id)}">
    <header class="sc-leitor-cab">
      ${op.voltar ? '<button type="button" class="sc-btn fantasma mini" data-leitor="fechar" style="justify-self:start">← Lista</button>' : ''}
      ${no ? htmlTagsNota(no) : `<div class="tags"><span class="tag">${esc(tipoDe(nota.tipo).rot)}</span></div>`}
      <h2>${esc(nota.id)}</h2>
      <dl class="sc-meta-lista">
        <dt>Pasta</dt><dd>${esc(nota.rel.split('/').slice(0, -1).join(' / '))}</dd>
        <dt>Alterada</dt><dd>${esc(dataRel(nota.mtime))}${nota.fm.ultima_atualizacao ? ` · última atualização registrada ${esc(dataCurta(nota.fm.ultima_atualizacao.replace(/"/g, '')))}` : ''}</dd>
        ${no ? `<dt>Sistema</dt><dd><button type="button" class="sc-link" data-sis-ws="${esc(no.cluster)}">${esc(nomeSistema(sistemaDe(no)))}</button></dd>` : ''}
        <dt>Conexões</dt><dd>${nota.links.length} links · ${nota.backlinks.length} menções${tf ? ` · ${tf} tarefa${tf > 1 ? 's' : ''} aberta${tf > 1 ? 's' : ''}` : ''}</dd>
      </dl>
      <div class="sc-leitor-acoes">
        <button type="button" class="sc-btn primario" data-leitor="editar" ${nota.editavel ? '' : 'disabled title="Arquivos de sistema não são editados aqui"'}>✎ Editar</button>
        <button type="button" class="sc-btn" data-leitor="obsidian">Obsidian ↗</button>
        <button type="button" class="sc-btn" data-leitor="copiar">⧉ Copiar link</button>
        <button type="button" class="sc-btn" data-leitor="versoes">⟲ Versões</button>
        <button type="button" class="sc-btn icone" data-leitor="mais" aria-label="Mais ações" aria-haspopup="menu">⋯</button>
      </div>
    </header>
    <div class="sc-md">${md(nota.corpo, {semTitulo: true, interativo: nota.editavel})}</div>
    <footer class="sc-leitor-rodape">
      <section><div class="sc-rotulo linha">Mencionada em <span class="sc-n">${nota.backlinks.length}</span></div>${nota.backlinks.length ? `<div class="sc-vinculos">${nota.backlinks.map(b => `<button type="button" data-ler="${esc(b)}">${esc(b)}</button>`).join('')}</div>` : vazio('Nenhuma nota aponta para esta.')}</section>
      <section><div class="sc-rotulo linha">Aponta para <span class="sc-n">${nota.links.length}</span></div>${nota.links.length ? `<div class="sc-vinculos">${nota.links.map(b => `<button type="button" data-ler="${esc(b)}">${esc(b)}</button>`).join('')}</div>` : vazio('Sem links internos.')}</section>
      ${nota.referencias.length ? `<section><div class="sc-rotulo linha">Links e arquivos <span class="sc-n">${nota.referencias.length}</span></div><div class="sc-vinculos">${nota.referencias.map(r => r.tipo === 'url' ? `<a href="${esc(r.alvo)}" target="_blank" rel="noopener" style="display:block;padding:5px 0 5px 14px;border-left:1px solid var(--faint);font-size:12.5px;color:var(--sc-texto-2);text-decoration:none;overflow-wrap:anywhere">${esc(r.rotulo || r.alvo)} ↗</a>` : `<button type="button" data-revelar="${esc(r.alvo)}">${esc(r.alvo)}</button>`).join('')}</div></section>` : ''}
    </footer>
  </article>`;
  const art = $('.sc-leitor', el);
  art._nota = nota;
  $$('input.sc-caixa[data-k]', art).forEach(cx => cx.addEventListener('change', () => alternarTarefa(nota, +cx.dataset.k, cx.checked, cx)));
  art.addEventListener('click', e => {
    const b = e.target.closest('[data-leitor]');
    const ler = e.target.closest('[data-ler]');
    const rev = e.target.closest('[data-revelar]');
    if (ler) return SC.abrirNota(ler.dataset.ler);
    if (rev) return revelarNoFinder(rev.dataset.revelar);
    if (!b) return;
    const a = b.dataset.leitor;
    if (a === 'fechar'){ WS.nota = null; return pintarWS(); }
    if (a === 'editar') return Editor.editar(nota.id, {aoSalvar: () => renderLeitor(el, nota.id, op)});
    if (a === 'obsidian') return abrirObsidian(no || {rel: nota.rel});
    if (a === 'copiar') return copiarLink(nota.id);
    if (a === 'versoes') return Versoes.abrir(nota.id);
    if (a === 'mais') return menu(b, [
      ...(no ? [{icone: '◎', rotulo: 'Mostrar no mapa', acao: () => { fecharWS(); setTimeout(() => selecionarNo(no.id, {voar: true}), 300); }}] : []),
      {icone: '⛓', rotulo: 'Vincular arquivo ou link', acao: () => Vinculo.novo({nota: nota.id})},
      {icone: '☑', rotulo: 'Nova tarefa nesta nota', acao: () => Tarefa.nova({alvo: nota.id})},
      '-',
      {icone: '▣', rotulo: 'Arquivar…', acao: () => Acoes.arquivar(nota.id)},
      {icone: '✕', rotulo: 'Excluir (vai para a Lixeira)…', perigo: true, acao: () => Acoes.excluir(nota.id)},
    ]);
  });
  lembrarRecente({tipo: 'nota', id: nota.id});
}
function leitorEstatico(n, op){
  return `<article class="sc-leitor"><header class="sc-leitor-cab">${op.voltar ? '<button type="button" class="sc-btn fantasma mini" data-leitor="fechar" style="justify-self:start">← Lista</button>' : ''}${htmlTagsNota(n)}<h2>${esc(n.id)}</h2>
    <div class="sc-leitor-acoes"><a class="sc-btn primario" href="${esc(n.uri)}">Abrir no Obsidian ↗</a></div></header>
    ${n.resumo ? `<p class="sc-insp-desc">${esc(n.resumo)}</p>` : ''}
    <div class="sc-info-caixa" style="margin-top:16px">Esta é a versão somente leitura do mapa: aqui aparece só o resumo. Abra pelo app “Segundo Cérebro” para ler a nota inteira, marcar tarefas e editar.</div>
    <div style="margin-top:22px">${htmlVinculos(n.id).replace(/data-no="/g, 'data-ler="')}</div></article>`;
}
async function revelarNoFinder(caminho){
  if (!CFG) return toast('Disponível no app.', {tipo: 'aviso'});
  try { await api('revelar', {metodo: 'POST', corpo: {caminho}}); }
  catch (e) { erroToast(e); }
}

/* ---------- decisões ---------- */
function abaDecisoes(corpo){
  corpo.innerHTML = '<div id="sc-ws-dec"></div>';
  pintarDecisoes();
}
function pintarDecisoes(){
  const alvo = $('#sc-ws-dec', wsEl);
  if (!alvo) return;
  const c = porCl.get(WS.sid);
  if (!WS.ag && CFG && !WS.erro){ alvo.innerHTML = esqueleto(8); return; }
  if (WS.erro){ alvo.innerHTML = caixaErro(WS.erro, () => { WS.ag = null; WS.erro = null; carregarAgregadoWS(); pintarDecisoes(); }); return; }
  const todas = WS.ag ? WS.ag.decisoes : (membros.get(c.id) || []).filter(n => n.tipo === 'decisao').map(n => ({id: n.id, status: n.status, data: n.data, travado: n.travado, arquivo: n.arquivo, secoes: null, projetos: [], substitui: [], substituida_por: []}));
  const grupos = {todas: d => !d.externa, abertas: d => !d.externa && ABERTAS.has(d.status), vigentes: d => !d.externa && d.status === 'vigente',
    travadas: d => !d.externa && d.travado && !d.arquivo, historico: d => !d.externa && (d.arquivo || ['substituida', 'rejeitada'].includes(d.status)), ligadas: d => d.externa};
  const rot = {todas: 'Do sistema', abertas: 'Em aberto', vigentes: 'Vigentes', travadas: '🔒 Travadas', historico: 'Substituídas e rejeitadas', ligadas: 'Ligadas de outros sistemas'};
  const lista = todas.filter(grupos[WS.dec]);
  alvo.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:10px;justify-content:space-between;align-items:center;margin-bottom:16px">
      <div class="sc-filtros" role="group" aria-label="Filtrar decisões">${Object.keys(grupos).filter(k => k !== 'ligadas' || todas.some(grupos.ligadas)).map(k => `<button type="button" class="sc-chip" data-filtro-dec="${k}" aria-pressed="${WS.dec === k}">${rot[k]} <span class="sc-n">${todas.filter(grupos[k]).length}</span></button>`).join('')}</div>
      <button type="button" class="sc-btn primario" data-ws="nova-decisao">◇ Registrar decisão</button></div>
    ${!CFG ? '<div class="sc-info-caixa" style="margin-bottom:12px">Somente leitura: contexto, justificativa e histórico completos aparecem no app.</div>' : ''}
    ${lista.length ? lista.map(htmlDecisao).join('') : vazio(WS.dec === 'todas' ? 'Nenhuma decisão registrada neste sistema.' : 'Nenhuma decisão neste filtro.', 'Decisões ficam em 70 - DECISÕES e entram aqui pelo projeto/cliente do frontmatter.', ESCRITA ? '<button type="button" class="sc-link" data-ws="nova-decisao">+ Registrar decisão</button>' : '')}`;
  $$('[data-dec-acao]', alvo).forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    const id = b.closest('[data-decisao]').dataset.decisao, a = b.dataset.decAcao;
    if (a === 'editar') return Editor.editar(id);
    if (a === 'substituir') return Decisao.nova({sistema: WS.sid, substitui: id});
    if (a === 'obsidian') return abrirObsidian(porId.get(id));
    if (a === 'versoes') return Versoes.abrir(id);
    if (a === 'arquivar') return Acoes.arquivar(id, {decisao: true});
  }));
  ligarTarefasDecisao(alvo);
  const aberta = WS.aberta && $(`[data-decisao="${CSS.escape(WS.aberta)}"]`, alvo);
  if (aberta) aberta.scrollIntoView({block: 'nearest', behavior: REDUZ ? 'auto' : 'smooth'});
}
function htmlDecisao(d){
  const s = d.secoes || {}, aberta = WS.aberta === d.id;
  const sec = (rot, txt) => txt ? `<section class="sc-sec"><h4>${rot}</h4><div class="sc-md">${md(txt)}</div></section>` : '';
  return `<article class="sc-decisao" data-decisao="${esc(d.id)}" aria-expanded="${aberta}">
    <button type="button" data-dec="${esc(d.id)}" aria-expanded="${aberta}"><span class="sc-ponto" style="--c:var(${STATUS_COR[d.status] || '--c-decisao'})"></span>
      <span style="min-width:0"><h3>${esc(curto(d.id))}${d.travado ? ' <span style="color:var(--c-decisao)">🔒</span>' : ''}</h3>
      <span class="sc-s">${esc([ehData(d.data) ? dataCurta(d.data) : '', d.status, (/^(FATO|CONCLUS|INCERTO)/.exec(d.evidencia || '') || [''])[0].replace('CONCLUS', 'CONCLUSÃO'), d.externa ? 'de ' + nomeSistema(porCl.get(d.cluster)) : ''].filter(Boolean).join(' · '))}</span></span>
      <span class="sc-seta" aria-hidden="true">›</span></button>
    <div class="sc-detalhe">
      ${d.secoes ? `${sec('Decisão', s.decisao)}${sec('Contexto', s.contexto)}${sec('Porquê', s.porque)}${sec('Evidência', s.evidencia)}${sec('Alternativas consideradas', s.alternativas)}${sec('Impactos', s.impactos)}${s.proximos ? `<section class="sc-sec"><h4>Próximos passos</h4><div class="sc-md" data-dec-tarefas>${md(s.proximos)}</div></section>` : ''}${sec('Como aplicar', s.como_aplicar)}${sec('Não fazer', s.nao_fazer)}`
        : `<p class="sc-insp-desc">${esc((porId.get(d.id) || {}).resumo || '')}</p>`}
      ${(d.substitui && d.substitui.length) || (d.substituida_por && d.substituida_por.length) || (d.projetos && d.projetos.length) ? `<section class="sc-sec"><h4>Histórico e vínculos</h4><dl class="sc-meta-lista">
        ${d.projetos && d.projetos.length ? `<dt>Projetos</dt><dd>${d.projetos.map(p => `<a class="sc-wl" data-nota="${esc(p)}" href="#">${esc(p)}</a>`).join(', ')}</dd>` : ''}
        ${d.substitui && d.substitui.length ? `<dt>Substitui</dt><dd>${d.substitui.map(p => `<a class="sc-wl" data-nota="${esc(p)}" href="#">${esc(curto(p))}</a>`).join(', ')}</dd>` : ''}
        ${d.substituida_por && d.substituida_por.length ? `<dt>Substituída por</dt><dd>${d.substituida_por.map(p => `<a class="sc-wl" data-nota="${esc(p)}" href="#">${esc(curto(p))}</a>`).join(', ')}</dd>` : ''}
        ${d.fonte ? `<dt>Fonte</dt><dd>${esc(d.fonte)}</dd>` : ''}${d.evidencia ? `<dt>Evidência</dt><dd>${esc(d.evidencia)}</dd>` : ''}</dl></section>` : ''}
      <div class="sc-leitor-acoes">
        <button type="button" class="sc-btn mini" data-dec-acao="editar">✎ Editar</button>
        ${!d.arquivo ? '<button type="button" class="sc-btn mini" data-dec-acao="substituir">⇄ Substituir por nova</button>' : ''}
        ${CFG ? '<button type="button" class="sc-btn mini" data-dec-acao="versoes">⟲ Versões</button>' : ''}
        <button type="button" class="sc-btn mini" data-dec-acao="obsidian">Obsidian ↗</button>
        ${!d.arquivo ? '<button type="button" class="sc-btn mini fantasma" data-dec-acao="arquivar">▣ Arquivar</button>' : ''}
      </div>
    </div>
  </article>`;
}
function ligarTarefasDecisao(raiz){
  $$('[data-dec-tarefas]', raiz).forEach(bloco => {
    const id = bloco.closest('[data-decisao]').dataset.decisao;
    $$('input.sc-caixa[data-k]', bloco).forEach(cx => cx.addEventListener('change', async () => {
      try {
        const nota = await api('nota?id=' + enc(id));
        const passos = nota.tarefas.filter(t => /pr[oó]ximos passos/i.test(t.secao));
        const t = passos[+cx.dataset.k];
        if (!t) throw new Error('Tarefa não encontrada — recarregue.');
        await alternarTarefa({id, tarefas: [t], hash: nota.hash}, 0, cx.checked, cx);
      } catch (e) { cx.checked = !cx.checked; erroToast(e); }
    }));
  });
}

/* ---------- processos ---------- */
function abaProcessos(corpo){
  if (!WS.ag && CFG && !WS.erro){ corpo.innerHTML = esqueleto(6); return; }
  if (WS.erro){ corpo.innerHTML = caixaErro(WS.erro, () => { WS.ag = null; WS.erro = null; carregarAgregadoWS(); }); return; }
  const lista = WS.ag ? WS.ag.processos : (membros.get(WS.sid) || []).filter(n => n.tipo === 'processo').map(n => ({id: n.id, status: n.status, passos: [], checklist: [], execucoes: [], externo: false}));
  const andamento = ler('sc-execucoes', {});
  corpo.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:16px">
      <p class="sc-insp-desc" style="max-width:760px">Processos (SOPs) deste sistema e os ligados às notas dele. Clique para executar o checklist e registrar a execução na própria nota.</p>
      <button type="button" class="sc-btn primario" data-ws="novo-processo">+ Novo processo</button></div>
    ${lista.length ? `<div class="sc-cartoes">${lista.map(p => { const run = andamento[p.id]; const total = p.passos.length + p.checklist.length; const feitos = run ? Object.values(run.feitos || {}).filter(Boolean).length : 0;
      return `<button type="button" class="sc-cartao" data-proc="${esc(p.id)}">
        <span class="sc-estado" style="--c:var(--c-processo)"><span class="sc-ponto" style="--c:var(--c-processo)"></span>${esc(p.status || 'processo')}${p.externo ? ' · vinculado' : ''}</span>
        <h3>${esc(curto(p.id))}</h3>
        ${run && total ? `<div class="sc-progresso" title="Execução em andamento neste dispositivo"><b style="transform:scaleX(${feitos / total})"></b></div>` : ''}
        <span class="sc-rodape-cartao"><span>${p.passos.length} etapas</span><span>${p.checklist.length} itens</span>${p.execucoes.length ? `<span>${p.execucoes.length} execução${p.execucoes.length > 1 ? 'ões' : ''}</span>` : '<span>sem execuções registradas</span>'}${run && total ? `<span style="color:var(--sc-ok)">em andamento ${feitos}/${total}</span>` : ''}</span>
      </button>`; }).join('')}</div>`
      : vazio('Nenhum processo ligado a este sistema.', 'Crie um SOP a partir do modelo oficial — ele passa a aparecer aqui.', ESCRITA ? '<button type="button" class="sc-link" data-ws="novo-processo">+ Criar processo</button>' : '')}`;
}

/* ---------- arquivos e links ---------- */
function tipoArquivo(r){
  const a = r.alvo.toLowerCase();
  if (r.tipo === 'caminho') return ['locais', 'Pastas e arquivos locais'];
  if (/github\.com|gitlab\.com|bitbucket\.org/.test(a)) return ['repos', 'Repositórios'];
  if (/vercel\.app|netlify|\.web\.app|pages\.dev/.test(a) || r.rotulo === 'deploy') return ['sites', 'Sites e deploys'];
  if (/docs\.google|drive\.google|canva\.com|figma\.com|notion\.so|dropbox|onedrive|sheets/.test(a)) return ['docs', 'Documentos e design'];
  return ['links', 'Outros links'];
}
function abaArquivos(corpo){
  if (!CFG){ corpo.innerHTML = vazio('Disponível no app.', 'Os links e caminhos citados nas notas são lidos pelo servidor local.'); return; }
  if (!WS.ag && !WS.erro){ corpo.innerHTML = esqueleto(6); return; }
  if (WS.erro){ corpo.innerHTML = caixaErro(WS.erro, () => { WS.ag = null; WS.erro = null; carregarAgregadoWS(); }); return; }
  const grupos = new Map();
  WS.ag.arquivos.forEach(r => { const [k, rot] = tipoArquivo(r); if (!grupos.has(k)) grupos.set(k, {rot, itens: []}); grupos.get(k).itens.push(r); });
  const ordem = ['repos', 'sites', 'docs', 'locais', 'links'];
  corpo.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:16px">
      <p class="sc-insp-desc" style="max-width:760px">Links, repositórios e caminhos citados nas notas deste sistema — com a nota e a seção de onde vieram. O vault não guarda anexos binários; vincule o link ou o caminho do arquivo.</p>
      <button type="button" class="sc-btn primario" data-ws="vincular">⛓ Vincular arquivo ou link</button></div>
    ${WS.ag.arquivos.length ? ordem.filter(k => grupos.has(k)).map(k => `<section class="sc-bloco" style="margin-bottom:22px"><div class="sc-rotulo linha">${grupos.get(k).rot} <span class="sc-n">${grupos.get(k).itens.length}</span></div>
      <div class="sc-lista">${grupos.get(k).itens.map(r => `<div class="sc-item" style="cursor:default">
        <span class="sc-ponto" style="--c:var(${r.tipo === 'caminho' ? '--c-processo' : '--cyan'})"></span>
        <span style="min-width:0"><span class="sc-t" style="display:block">${esc(r.rotulo && !['repositorio', 'pasta_local', 'deploy', 'url'].includes(r.rotulo) ? r.rotulo : rotuloAlvo(r.alvo))}</span>
          <span class="sc-s" style="text-transform:none;letter-spacing:.04em">${esc(r.alvo)}</span>
          <span class="sc-s">em <button type="button" class="sc-link" data-nota-ws="${esc(r.nota)}" style="font:inherit;letter-spacing:inherit;text-transform:none">${esc(curto(r.nota))}</button>${r.secao ? ' · ' + esc(r.secao) : ''}</span></span>
        <span style="display:flex;gap:6px">${r.tipo === 'url' ? `<a class="sc-btn mini" href="${esc(r.alvo)}" target="_blank" rel="noopener">Abrir ↗</a>` : `<button type="button" class="sc-btn mini" data-revelar="${esc(r.alvo)}">Finder</button>`}<button type="button" class="sc-btn mini fantasma" data-copiar="${esc(r.alvo)}">Copiar</button></span>
      </div>`).join('')}</div></section>`).join('')
      : vazio('Nenhum link ou arquivo citado nas notas deste sistema.', '', ESCRITA ? '<button type="button" class="sc-link" data-ws="vincular">+ Vincular arquivo ou link</button>' : '')}`;
  $$('[data-revelar]', corpo).forEach(b => b.addEventListener('click', () => revelarNoFinder(b.dataset.revelar)));
  $$('[data-copiar]', corpo).forEach(b => b.addEventListener('click', async () => { try { await navigator.clipboard.writeText(b.dataset.copiar); toast('Copiado.', {tipo: 'ok', duracao: 1800}); } catch (e) { toast('Não consegui copiar.', {tipo: 'erro'}); } }));
}
function rotuloAlvo(alvo){
  try { const u = new URL(alvo); return u.hostname.replace(/^www\./, '') + (u.pathname.length > 1 ? u.pathname.replace(/\/$/, '') : ''); }
  catch (e) { return alvo.split('/').filter(Boolean).slice(-2).join('/'); }
}
