/* Inspector: gaveta à direita com o sistema ou a nota selecionada — o mapa continua visível e navegável. */
const Insp = {el: null, sel: null, aba: 'resumo', jaAbriu: false};
const agregados = new Map();     // sistema → Promise do /api/sistema (limpo a cada escrita)
SC.on('dados-mudaram', () => agregados.clear());
function agregado(sid){
  if (!agregados.has(sid)){
    const p = api('sistema?id=' + enc(sid));
    agregados.set(sid, p);
    p.catch(() => agregados.delete(sid));
  }
  return agregados.get(sid);
}

function montarInspector(){
  const el = document.createElement('aside');
  el.id = 'sc-inspector'; el.className = 'sc-raiz sc-cantos';
  el.setAttribute('aria-label', 'Detalhes da seleção'); el.setAttribute('aria-hidden', 'true'); el.inert = true;
  document.body.append(el);
  Insp.el = el;
  el.addEventListener('click', e => {
    const b = e.target.closest('[data-acao]');
    if (b) acaoInspector(b.dataset.acao, b, e);
    const aba = e.target.closest('[data-aba-insp]');
    if (aba){ Insp.aba = aba.dataset.abaInsp; pintarAbaInsp(); }
    const sis = e.target.closest('[data-sis]');
    if (sis) selecionarSistema(sis.dataset.sis, {voar: true});
    const nota = e.target.closest('[data-no]');
    if (nota) selecionarNo(nota.dataset.no, {voar: true});
  });
  el.addEventListener('keydown', e => {
    if (!e.target.matches('[data-aba-insp]') || !/Arrow(Left|Right)/.test(e.key)) return;
    const abas = $$('[data-aba-insp]', el), i = abas.indexOf(e.target), j = (i + (e.key === 'ArrowRight' ? 1 : -1) + abas.length) % abas.length;
    abas[j].focus(); abas[j].click();
  });
}

/* seleção: o mapa avisa (clique no 3D, no índice) e a interface pede (busca, links) */
function selecionarSistema(sid, op = {}){
  if (SC.mapaAtivo) SC.mapa.selecionarSistema(sid, op);
  else abrirInspector({tipo: 'sistema', id: sid});
}
function selecionarNo(id, op = {}){
  const n = porId.get(id);
  if (!n) return;
  if (n.hub) return selecionarSistema(n.cluster, op);
  if (SC.mapaAtivo) SC.mapa.selecionarNo(id, op);
  else abrirInspector({tipo: 'no', id});
}
SC.on('selecao', s => { if (s && s.id) abrirInspector(s); else fecharInspector(true); });

function abrirInspector(sel){
  const mesmo = Insp.sel && Insp.sel.tipo === sel.tipo && Insp.sel.id === sel.id;
  if (!mesmo) Insp.aba = sel.tipo === 'sistema' ? 'resumo' : 'conexoes';
  Insp.sel = sel;
  const el = Insp.el;
  // cor da categoria no painel (sistema = ciano; nota = cor do tipo)
  el.style.setProperty('--acento', sel.tipo === 'sistema' ? 'var(--cyan)' : `var(${tipoDe((porId.get(sel.id) || {}).tipo || 'conhecimento').cor})`);
  if (sel.tipo === 'sistema'){
    const c = porCl.get(sel.id);
    if (!c) return;
    el.innerHTML = htmlInspSistema(c);
    if (CFG) agregado(c.id).then(ag => { if (Insp.sel === sel){ $('#sc-insp-kpis').innerHTML = kpisSistema(c, ag); if (Insp.aba === 'atividade') pintarAbaInsp(); } }).catch(() => {});
  } else {
    const n = porId.get(sel.id);
    if (!n) return;
    el.innerHTML = htmlInspNota(n);
  }
  pintarAbaInsp();
  el.setAttribute('aria-hidden', 'false'); el.inert = false;
  if (!Insp.jaAbriu){ Insp.jaAbriu = true; el.classList.add('sc-primeira'); }
  el.classList.add('on');
  document.body.classList.add('sc-com-gaveta');
  marcarIndice(sel.tipo === 'sistema' ? sel.id : (porId.get(sel.id) || {}).cluster);
  SC.mapa.gaveta(el.offsetWidth + 24);
}
function fecharInspector(vemDoMapa){
  if (!Insp.sel) return;
  Insp.sel = null;
  const el = Insp.el;
  el.classList.remove('on', 'sc-primeira'); el.setAttribute('aria-hidden', 'true'); el.inert = true;
  document.body.classList.remove('sc-com-gaveta');
  marcarIndice(null);
  SC.mapa.gaveta(0);
  if (!vemDoMapa) SC.mapa.limpar();
}
SC.fecharInspector = () => fecharInspector(false);
function marcarIndice(sid){
  $$('#index li button').forEach(b => b.setAttribute('aria-current', b.dataset.sis === sid ? 'true' : 'false'));
}

/* ---------- sistema ---------- */
function glifoOrbita(c){
  const m = (membros.get(c.id) || []).filter(n => !n.hub);
  const anel = n => n.arquivo || n.tipo === 'prompt' || n.tipo === 'recurso' ? 2 : (['projeto', 'cliente', 'stack', 'area', 'pessoa'].includes(n.tipo) ? 0 : 1);
  const grupos = [[], [], []];
  m.forEach(n => grupos[anel(n)].push(n));
  const R = [58, 104, 150], cx = 200, cy = 60, k = .27;
  let s = `<svg viewBox="0 0 400 118" preserveAspectRatio="xMidYMid meet"><defs><radialGradient id="sc-glifo-g"><stop offset="0" stop-color="#ffffff" stop-opacity=".95"/><stop offset=".22" stop-color="#9feaff" stop-opacity=".5"/><stop offset="1" stop-color="#5fe1ff" stop-opacity="0"/></radialGradient></defs>`;
  R.forEach((r, i) => { if (grupos[i].length || i < 2) s += `<ellipse cx="${cx}" cy="${cy}" rx="${r}" ry="${r * k}" fill="none" stroke="rgba(95,225,255,${[.34, .2, .12][i]})" ${i === 1 ? 'stroke-dasharray="2 3"' : ''}/>`; });
  const pontos = [];
  grupos.forEach((g, i) => g.forEach((n, j) => {
    const a = j / g.length * Math.PI * 2 + i * .7 + .3, x = cx + R[i] * Math.cos(a), y = cy + R[i] * k * Math.sin(a), frente = Math.sin(a) > 0;
    pontos.push({y, html: `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${frente ? 2.6 : 1.7}" style="fill:var(${n.arquivo ? '--c-arquivo' : tipoDe(n.tipo).cor});opacity:${frente ? 1 : .5}"/>`});
  }));
  pontos.filter(p => p.y < cy).forEach(p => { s += p.html; });
  s += `<circle cx="${cx}" cy="${cy}" r="30" fill="url(#sc-glifo-g)"/><circle cx="${cx}" cy="${cy}" r="3.2" fill="#fff"/>`;
  pontos.filter(p => p.y >= cy).forEach(p => { s += p.html; });
  return s + '</svg>';
}
function kpisSistema(c, ag){
  const ct = contagem(c);
  const carregando = CFG && !ag;
  const proc = ag ? ag.processos.length : ct.processos;
  const arq = ag ? ag.arquivos.length : '—';
  return `<div class="sc-kpi"><b>${ct.notas}</b><span>Notas</span></div>
    <div class="sc-kpi"><b>${ct.decisoes}</b><span>Decisões</span>${ct.travadas ? `<small title="${ct.travadas} travada${ct.travadas > 1 ? 's' : ''}">🔒 ${ct.travadas}</small>` : ''}</div>
    <div class="sc-kpi" title="SOPs do sistema e SOPs ligados às notas dele"><b>${proc}</b><span>Processos</span></div>
    <div class="sc-kpi ${carregando || !ag ? 'carregando' : ''}" title="${ag ? 'Links e caminhos citados nas notas do sistema' : 'Disponível no app'}"><b>${arq}</b><span>Arquivos</span></div>`;
}
function htmlInspSistema(c){
  const m = membros.get(c.id) || [], desc = descSistema(c), atual = ultimaAtualizacao(m);
  return `<i class="cant a"></i><i class="cant b"></i>
    <button type="button" class="sc-fechar" data-acao="fechar" aria-label="Fechar painel">✕</button>
    <header class="sc-insp-cab">
      <div class="sc-rotulo">◈ ${c.id === D.geral ? 'Núcleo selecionado' : 'Sistema selecionado'}</div>
      <h2>${esc(nomeSistema(c))}</h2>
      <div class="sc-insp-meta"><span class="sc-estado" style="--c:var(--cyan)">${esc(tipoSistema(c))}</span>
        <span class="sc-estado" style="--c:var(${c.ativo ? '--sc-ok' : '--muted'})"><span class="sc-ponto ${c.ativo ? '' : 'vazio'}" style="--c:var(${c.ativo ? '--sc-ok' : '--faint'})"></span>${c.ativo ? 'Projeto ativo' : 'Sem projeto ativo'}</span>
        ${atual ? `<span class="sc-estado">Atualizado ${esc(dataRel(atual))}</span>` : ''}</div>
    </header>
    <div class="sc-insp-corpo">
      <figure class="sc-orbita" aria-hidden="true">${glifoOrbita(c)}</figure>
      ${desc ? `<p class="sc-insp-desc">${esc(desc)}</p>` : ''}
      <div class="sc-kpis" id="sc-insp-kpis">${kpisSistema(c, null)}</div>
      <div class="sc-abas" role="tablist" aria-label="Seções do sistema">
        ${[['resumo', 'Resumo'], ['notas', 'Notas'], ['conexoes', 'Conexões'], ['atividade', 'Atividade']].map(([id, r]) => `<button type="button" class="sc-aba" role="tab" data-aba-insp="${id}">${r}</button>`).join('')}
      </div>
      <div id="sc-insp-painel" role="tabpanel"></div>
    </div>
    <footer class="sc-insp-rodape">
      <button type="button" class="sc-btn primario" data-acao="abrir-sistema">Abrir sistema →</button>
      <button type="button" class="sc-btn" data-acao="nova-nota">+ Nota</button>
      <button type="button" class="sc-btn icone" data-acao="mais-sistema" aria-label="Mais ações" aria-haspopup="menu">⋯</button>
    </footer>`;
}
function conexoesSistema(sid){
  const cont = new Map();
  for (const [a, b] of DM.links){
    const ca = porId.get(a).cluster, cb = porId.get(b).cluster;
    if (ca === sid && cb !== sid) cont.set(cb, (cont.get(cb) || 0) + 1);
    else if (cb === sid && ca !== sid) cont.set(ca, (cont.get(ca) || 0) + 1);
  }
  return [...cont.entries()].sort((a, b) => b[1] - a[1]);
}
function htmlBarras(lista){
  if (!lista.length) return vazio('Sem conexões com outros sistemas.');
  const max = lista[0][1];
  return `<div class="sc-barras">${lista.map(([id, n]) => `<button type="button" data-sis="${esc(id)}"><span>${esc(nomeSistema(porCl.get(id)).toUpperCase())}</span><span>${n}</span><span class="sc-barra"><b style="width:${n / max * 100}%"></b></span></button>`).join('')}</div>`;
}
function painelInspSistema(c){
  const m = membros.get(c.id) || [];
  if (Insp.aba === 'resumo'){
    const projetos = projetosDe(c.id);
    const decisoes = m.filter(n => n.tipo === 'decisao' && !n.arquivo).sort((a, b) => (b.data || '').localeCompare(a.data || '')).slice(0, 4);
    const ct = contagem(c), comTarefas = m.filter(n => n.tarefas && n.tarefas[0]).length;
    return `<div class="sc-bloco"><div class="sc-rotulo linha">Projetos <span class="sc-n">${projetos.length}</span></div>
        ${projetos.length ? `<div class="sc-lista">${projetos.map(n => itemLista(n, {sub: [n.status || '—', ehData(n.atualizado) ? 'atualizado ' + dataCurta(n.atualizado) : ''].filter(Boolean).join(' · '), attr: `data-no="${esc(n.id)}"`})).join('')}</div>` : vazio('Nenhum projeto neste sistema.', '', ESCRITA ? '<button type="button" class="sc-link" data-acao="novo-projeto">+ Criar projeto</button>' : '')}</div>
      <div class="sc-bloco"><div class="sc-rotulo linha">Decisões recentes <span class="sc-n">${ct.decisoes}</span></div>
        ${decisoes.length ? `<div class="sc-lista">${decisoes.map(n => itemLista(n, {sub: [ehData(n.data) ? dataCurta(n.data) : '', n.status, n.travado ? '🔒 travada' : ''].filter(Boolean).join(' · '), attr: `data-no="${esc(n.id)}"`})).join('')}</div>` : vazio('Nenhuma decisão registrada neste sistema.')}</div>
      <div class="sc-bloco"><div class="sc-rotulo linha">Pendências</div>
        <p class="sc-insp-desc">${ct.pendencias ? `<b style="color:#fff">${ct.pendencias}</b> tarefa${ct.pendencias > 1 ? 's' : ''} aberta${ct.pendencias > 1 ? 's' : ''} em ${comTarefas} nota${comTarefas > 1 ? 's' : ''}.` : 'Nenhuma tarefa aberta nas notas deste sistema.'}
        ${ct.pendencias ? ' <button type="button" class="sc-link" data-acao="abrir-sistema">Ver no sistema</button>' : ''}</p></div>`;
  }
  if (Insp.aba === 'notas'){
    const grupos = new Map();
    m.filter(n => !n.hub).sort(ordenarPorNome).forEach(n => { const t = tipoDe(n.tipo).rot; if (!grupos.has(t)) grupos.set(t, {cor: tipoDe(n.tipo).cor, itens: []}); grupos.get(t).itens.push(n); });
    if (!grupos.size) return vazio('Este sistema ainda não tem notas além da principal.');
    return `<div class="sc-vinculos">${[...grupos.entries()].map(([t, g]) => `<h4><span class="sc-ponto" style="--c:var(${g.cor})"></span>${t} · ${g.itens.length}</h4>${g.itens.slice(0, 8).map(n => `<button type="button" data-abrir-nota="${esc(n.id)}">${esc(curto(n.id))}</button>`).join('')}${g.itens.length > 8 ? `<button type="button" data-acao="abrir-sistema">+ ${g.itens.length - 8} no sistema…</button>` : ''}`).join('')}</div>`;
  }
  if (Insp.aba === 'conexoes') return `<div class="sc-rotulo linha">Conexões com outros sistemas</div>${htmlBarras(conexoesSistema(c.id))}`;
  // atividade
  if (!CFG){
    const recentes = [...m].sort((a, b) => (b.mtime || '').localeCompare(a.mtime || '')).slice(0, 6);
    return `<div class="sc-rotulo linha">Últimas notas alteradas</div><ol class="sc-linha-tempo">${recentes.map(n => `<li><time>${esc(dataRel(n.mtime))}</time><p>${esc(curto(n.id))}</p></li>`).join('')}</ol>`;
  }
  return esqueleto(5);
}
function htmlAtividade(ag, limite = 8){
  if (!ag.atividade.length && !ag.pendentes_git.length) return vazio('Sem histórico registrado para este sistema.', 'O histórico vem dos commits do vault (git).');
  return `${ag.pendentes_git.length ? `<div class="sc-aviso-caixa">${ag.pendentes_git.length} nota${ag.pendentes_git.length > 1 ? 's' : ''} alterada${ag.pendentes_git.length > 1 ? 's' : ''} ainda não registrada${ag.pendentes_git.length > 1 ? 's' : ''} no git (rode /finalizar-sessao para registrar).</div>` : ''}
    <ol class="sc-linha-tempo">${ag.atividade.slice(0, limite).map(a => `<li><time>${esc(dataRel(a.data))}</time><p>${esc(a.msg)}</p><small>${a.notas.length} nota${a.notas.length > 1 ? 's' : ''} deste sistema: ${a.notas.slice(0, 3).map(n => esc(curto(n))).join(', ')}${a.notas.length > 3 ? '…' : ''}</small></li>`).join('')}</ol>`;
}

/* ---------- nota ---------- */
function htmlTagsNota(n){
  return `<div class="tags"><span class="tag" style="--c:var(${tipoDe(n.tipo).cor})">${esc(tipoDe(n.tipo).rot)}</span>
    ${n.status ? `<span class="tag" style="--c:var(${STATUS_COR[n.status] || '--faint'})">${esc(n.status)}</span>` : ''}
    ${n.travado ? '<span class="tag" style="--c:var(--c-decisao)">🔒 travado</span>' : ''}
    ${n.arquivo ? '<span class="tag">arquivo</span>' : ''}</div>`;
}
function htmlInspNota(n){
  const c = sistemaDe(n), tf = n.tarefas || [0, 0];
  return `<i class="cant a"></i><i class="cant b"></i>
    <button type="button" class="sc-fechar" data-acao="fechar" aria-label="Fechar painel">✕</button>
    <header class="sc-insp-cab">${htmlTagsNota(n)}<h2>${esc(n.id)}</h2></header>
    <div class="sc-insp-corpo">
      <div class="meta">
        <div><span>SISTEMA</span><b><button type="button" class="sc-link" data-sis="${esc(n.cluster)}">${esc(nomeSistema(c))}</button></b></div>
        <div><span>ESTADO</span><b>${esc(n.arquivo ? 'arquivo' : (n.estado || '—'))}</b></div>
        <div><span>DATA</span><b>${esc(n.data ? dataCurta(n.data) : '—')}</b></div>
        <div><span>CONEXÕES</span><b>${viz.get(n.id).size}</b></div>
      </div>
      ${n.resumo ? `<p class="resumo" style="font-size:13.5px;line-height:1.65;color:#b9d3de">${esc(n.resumo)}${n.resumo.length >= 320 ? '…' : ''}</p>` : ''}
      <div class="sc-abas" role="tablist" aria-label="Seções da nota">
        <button type="button" class="sc-aba" role="tab" data-aba-insp="conexoes">Conexões <span class="sc-n">${viz.get(n.id).size}</span></button>
        ${tf[0] + tf[1] ? `<button type="button" class="sc-aba" role="tab" data-aba-insp="tarefas">Tarefas <span class="sc-n">${tf[0]}</span></button>` : ''}
        ${CFG ? '<button type="button" class="sc-aba" role="tab" data-aba-insp="historico">Histórico</button>' : ''}
      </div>
      <div id="sc-insp-painel" role="tabpanel"></div>
    </div>
    <footer class="sc-insp-rodape">
      <button type="button" class="sc-btn primario" data-acao="abrir-nota">Abrir nota →</button>
      <button type="button" class="sc-btn" data-acao="editar-nota">Editar</button>
      <button type="button" class="sc-btn icone" data-acao="mais-nota" aria-label="Mais ações" aria-haspopup="menu">⋯</button>
    </footer>`;
}
function htmlVinculos(id){
  const grupos = new Map();
  [...(viz.get(id) || [])].map(x => porId.get(x)).filter(Boolean).sort(ordenarPorNome).forEach(n => {
    const t = tipoDe(n.tipo).rot; if (!grupos.has(t)) grupos.set(t, {cor: tipoDe(n.tipo).cor, itens: []}); grupos.get(t).itens.push(n);
  });
  const ordem = ['Cliente', 'Projeto', 'Decisão', 'Conhecimento', 'Marca', 'Stack', 'Área', 'Processo', 'Pessoa', 'Prompt', 'Recurso'];
  if (!grupos.size) return vazio('Esta nota não tem conexões no mapa.');
  return `<div class="sc-vinculos">${[...grupos.entries()].sort((a, b) => ordem.indexOf(a[0]) - ordem.indexOf(b[0])).map(([t, g]) =>
    `<h4><span class="sc-ponto" style="--c:var(${g.cor})"></span>${t} · ${g.itens.length}</h4>${g.itens.map(n => `<button type="button" data-no="${esc(n.id)}">${esc(curto(n.id))}</button>`).join('')}`).join('')}</div>`;
}
async function painelInspNota(n, alvo){
  if (Insp.aba === 'conexoes') return htmlVinculos(n.id);
  if (Insp.aba === 'tarefas'){
    if (!CFG) return vazio(`${n.tarefas[0]} aberta(s) · ${n.tarefas[1]} concluída(s)`, 'Marque e desmarque pelo app.');
    alvo.innerHTML = esqueleto(4);
    try {
      const nota = await api('nota?id=' + enc(n.id));
      return htmlTarefasNota(nota);
    } catch (e) { return caixaErro(e); }
  }
  alvo.innerHTML = esqueleto(4);
  try {
    const r = await api('historico?id=' + enc(n.id), {cache: true});
    if (!r.versoes.length) return vazio('Sem versões registradas no git.', 'A nota ainda não entrou em nenhum commit do vault.');
    return `<ol class="sc-linha-tempo">${r.versoes.slice(0, 10).map(v => `<li><time>${esc(dataRel(v.data))} · ${esc(v.hash)}</time><p>${esc(v.msg)}</p></li>`).join('')}</ol>
      <button type="button" class="sc-link" data-acao="versoes">Comparar versões…</button>`;
  } catch (e) { return caixaErro(e); }
}
function htmlTarefasNota(nota){
  if (!nota.tarefas.length) return vazio('Sem tarefas nesta nota.');
  return `<div data-tarefas-de="${esc(nota.id)}">${nota.tarefas.map((t, k) => `<div class="sc-tarefa ${t.feito ? 'feita' : ''}" style="padding-left:${t.nivel * 16}px">
    <input type="checkbox" class="sc-caixa" data-tk="${k}" ${t.feito ? 'checked' : ''} ${ESCRITA ? '' : 'disabled'} aria-label="${esc(textoPuro(t.texto).slice(0, 90))}">
    <div><span class="sc-t">${mdInline(t.texto)}</span>${t.secao ? `<span class="sc-s">${esc(t.secao)}</span>` : ''}</div></div>`).join('')}</div>`;
}
/* marcar/desmarcar uma tarefa: grava a mesma linha que o Obsidian mostra */
async function alternarTarefa(nota, k, feito, caixa){
  const t = nota.tarefas[k];
  if (!t || !podeEditar()){ if (caixa) caixa.checked = !feito; return; }
  caixa && (caixa.disabled = true);
  try {
    const r = await api('tarefa/alternar', {metodo: 'POST', corpo: {id: nota.id, linha: t.linha, bruto: t.bruto, feito}});
    Object.assign(t, {feito, linha: r.linha, bruto: r.bruto});
    nota.hash = r.hash;
    const no = porId.get(nota.id);
    if (no && no.tarefas){ no.tarefas[0] += feito ? -1 : 1; no.tarefas[1] += feito ? 1 : -1; }
    const linha = caixa && caixa.closest('.sc-tarefa,.sc-md-tarefa');
    linha && linha.classList.toggle('feita', feito);
    toast(feito ? 'Tarefa concluída — salva na nota.' : 'Tarefa reaberta.', {tipo: 'ok', duracao: 2400});
  } catch (e) {
    if (caixa) caixa.checked = !feito;
    erroToast(e, 'Não salvei');
  } finally { if (caixa) caixa.disabled = !ESCRITA; }
}
document.addEventListener('change', e => {
  const cx = e.target.closest && e.target.closest('input.sc-caixa[data-tk]');
  if (!cx) return;
  const caixa = cx.closest('[data-tarefas-de]'), nota = caixa && caixa._nota;
  if (nota) alternarTarefa(nota, +cx.dataset.tk, cx.checked, cx);
});

async function pintarAbaInsp(){
  const sel = Insp.sel, el = Insp.el;
  if (!sel) return;
  $$('[data-aba-insp]', el).forEach(b => { const on = b.dataset.abaInsp === Insp.aba; b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1; });
  const alvo = $('#sc-insp-painel', el);
  if (!alvo) return;
  if (sel.tipo === 'sistema'){
    const c = porCl.get(sel.id);
    alvo.innerHTML = painelInspSistema(c);
    if (Insp.aba === 'atividade' && CFG){
      try {
        const ag = await agregado(c.id);
        if (Insp.sel === sel && Insp.aba === 'atividade') alvo.innerHTML = `<div class="sc-rotulo linha">Atividade recente (git)</div>${htmlAtividade(ag)}`;
      } catch (e) { if (Insp.sel === sel) alvo.innerHTML = caixaErro(e, pintarAbaInsp); }
    }
  } else {
    const n = porId.get(sel.id);
    const html = await painelInspNota(n, alvo);
    if (Insp.sel !== sel) return;
    alvo.innerHTML = html;
    const caixa = $('[data-tarefas-de]', alvo);
    if (caixa) caixa._nota = await api('nota?id=' + enc(n.id)).catch(() => null);
  }
  $$('[data-abrir-nota]', alvo).forEach(b => b.addEventListener('click', () => SC.abrirNota(b.dataset.abrirNota)));
}

function acaoInspector(acao, botao){
  const sel = Insp.sel;
  if (!sel) return;
  const c = sel.tipo === 'sistema' ? porCl.get(sel.id) : sistemaDe(porId.get(sel.id));
  const n = sel.tipo === 'no' ? porId.get(sel.id) : null;
  const acoes = {
    'fechar': () => fecharInspector(false),
    'abrir-sistema': () => abrirWS(c.id),
    'nova-nota': () => Editor.novo({sistema: c.id}),
    'novo-projeto': () => Projeto.novo({pai: c.hub}),
    'abrir-nota': () => SC.abrirNota(n.id),
    'editar-nota': () => Editor.editar(n.id),
    'versoes': () => Versoes.abrir(n.id),
    'mais-sistema': () => menu(botao, [
      {icone: '◇', rotulo: 'Registrar decisão', acao: () => Decisao.nova({sistema: c.id})},
      {icone: '☑', rotulo: 'Nova tarefa', acao: () => Tarefa.nova({sistema: c.id})},
      {icone: '⛓', rotulo: 'Vincular arquivo ou link', acao: () => Vinculo.novo({sistema: c.id})},
      {icone: '◈', rotulo: 'Novo projeto neste sistema', acao: () => Projeto.novo({pai: c.hub})},
      '-',
      ...(c.hub ? [{icone: '↗', rotulo: 'Abrir nota principal no Obsidian', acao: () => abrirObsidian(porId.get(c.hub))}] : []),
      {icone: '◎', rotulo: 'Centralizar no mapa', acao: () => SC.mapa.selecionarSistema(c.id, {voar: true})},
    ]),
    'mais-nota': () => menu(botao, [
      {icone: '↗', rotulo: 'Abrir no Obsidian', acao: () => abrirObsidian(n)},
      {icone: '⧉', rotulo: 'Copiar link [[…]]', acao: () => copiarLink(n.id)},
      {icone: '◎', rotulo: 'Centralizar no mapa', acao: () => SC.mapa.selecionarNo(n.id, {voar: true})},
      ...(CFG ? [{icone: '⟲', rotulo: 'Versões (git)', acao: () => Versoes.abrir(n.id)}] : []),
      '-',
      {icone: '▣', rotulo: 'Arquivar…', acao: () => Acoes.arquivar(n.id)},
      {icone: '✕', rotulo: 'Excluir (vai para a Lixeira)…', perigo: true, acao: () => Acoes.excluir(n.id)},
    ]),
  };
  if (acoes[acao]) acoes[acao]();
}
function itemLista(n, {sub = '', attr = '', ativo = false} = {}){
  return `<button type="button" class="sc-item ${ativo ? 'ativo' : ''}" ${attr}><span class="sc-ponto ${n.arquivo ? 'vazio' : ''}" style="--c:var(${n.arquivo ? '--c-arquivo' : tipoDe(n.tipo).cor})"></span>
    <span style="min-width:0"><span class="sc-t" style="display:block">${esc(curto(n.id))}${n.travado ? ' <span style="color:var(--c-decisao)">🔒</span>' : ''}</span>${sub ? `<span class="sc-s">${esc(sub)}</span>` : ''}</span>
    <span class="sc-d"></span></button>`;
}
function abrirObsidian(n){
  if (!n) return;
  if (n.uri) { location.href = n.uri; return; }
  if (CFG && CFG.vault && n.rel) location.href = 'obsidian://open?path=' + encodeURIComponent(CFG.vault + '/' + n.rel);
}
async function copiarLink(nome){
  try { await navigator.clipboard.writeText(`[[${nome}]]`); toast(`Copiado: [[${nome}]]`, {tipo: 'ok', duracao: 2400}); }
  catch (e) { toast('Não consegui copiar (o navegador bloqueou a área de transferência).', {tipo: 'erro'}); }
}

/* dica ao passar o cursor sobre um sistema no mapa */
function montarDica(){
  const el = document.createElement('div');
  el.id = 'sc-dica'; el.setAttribute('aria-hidden', 'true');
  document.body.append(el);
  SC.on('hover', h => {
    if (!h || h.tipo !== 'sistema' || document.body.classList.contains('sc-pagina-aberta')){ el.classList.remove('on'); return; }
    const c = porCl.get(h.id);
    if (!c) return;
    const ct = contagem(c);
    el.innerHTML = `<b>${esc(nomeSistema(c).toUpperCase())}</b>${ct.notas} notas · ${ct.projetos} proj · ${ct.decisoes} dec${ct.pendencias ? ` · ${ct.pendencias} pendências` : ''}`;
    const x = Math.min(innerWidth - el.offsetWidth - 12, h.x + 16), y = Math.max(8, h.y - el.offsetHeight - 14);
    el.style.transform = `translate(${x}px,${y}px)`;
    el.classList.add('on');
  });
}
