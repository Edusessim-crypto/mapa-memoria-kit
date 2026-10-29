/* Base da interface: utilitários, servidor local, dados do vault, camadas (modais), avisos e Markdown.
   O motor 3D (módulo do template) conversa com esta camada por SC.registrarMapa() e SC.evento(). */
const SC = window.SC = window.SC || {};
const D = window.DADOS;
const CFG = window.SC_CONFIG || null;
const ESCRITA = !!(CFG && CFG.escrita);
const QS = new URLSearchParams(location.search);
const REDUZ = QS.has('estatico') || matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const desesc = s => String(s ?? '').replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => ({amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'"}[e]));
const sem = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const pad2 = n => String(n).padStart(2, '0');
function debounce(fn, ms){ let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function hojeISO(){ const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function agoraHM(){ const d = new Date(); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
function dataCurta(s){ const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? `${m[3]}/${m[2]}/${m[1]}` : (s || '—'); }
function dataRel(s){
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(s || '');
  if (!m) return s || '—';
  const d = new Date(+m[1], +m[2] - 1, +m[3]), h = new Date(); h.setHours(0, 0, 0, 0);
  const dias = Math.round((h - d) / 864e5), hora = m[4] ? ` ${m[4]}:${m[5]}` : '';
  if (dias === 0) return 'hoje' + hora;
  if (dias === 1) return 'ontem' + hora;
  if (dias > 1 && dias < 7) return `há ${dias} dias`;
  return `${m[3]}/${m[2]}/${m[1]}`;
}
const ler = (k, padrao) => { try { const v = localStorage.getItem(k); return v === null ? padrao : JSON.parse(v); } catch (e) { return padrao; } };
const gravar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

/* ---------------------------------------------------------------- eventos */
const ouvintes = {};
SC.on = (ev, fn) => { (ouvintes[ev] = ouvintes[ev] || []).push(fn); };
SC.emit = (ev, d) => (ouvintes[ev] || []).slice().forEach(fn => { try { fn(d); } catch (e) { console.error(e); } });
SC.evento = SC.emit;
// enquanto o motor 3D não se registra, as chamadas ao mapa não fazem nada
SC.mapa = new Proxy({}, {get: () => () => null});
// frase falada na voz do Jarvis (ElevenLabs) gerada na hora pelo servidor → URL do áudio (ou null)
SC.vozJarvis = async texto => {
  if (!CFG) return null;
  try {
    const r = await fetch(`${CFG.api}/falar`, {method: 'POST', cache: 'no-store',
      headers: {'X-SC-Token': CFG.token, 'Content-Type': 'application/json'}, body: JSON.stringify({texto})});
    return r.ok ? URL.createObjectURL(await r.blob()) : null;
  } catch (e) { return null; }
};
SC.registrarMapa = apiMapa => { SC.mapa = apiMapa; SC.mapaAtivo = true; SC.emit('mapa-pronto', apiMapa); };
// retomada depois de "Atualizar mapa" (recarrega a página preservando câmera, filtros e telas)
try {
  const r = JSON.parse(sessionStorage.getItem('sc-retomar') || 'null');
  sessionStorage.removeItem('sc-retomar');
  if (r && Date.now() - r.t < 60000) SC.retomar = r;
} catch (e) {}

/* ---------------------------------------------------------------- servidor local */
let assinatura = CFG ? CFG.assinatura : null;
const cacheApi = new Map();
class ErroApi extends Error {
  constructor(msg, codigo, status, dados){ super(msg); this.codigo = codigo; this.status = status; this.dados = dados || {}; }
}
SC.conexao = CFG ? 'ok' : 'leitura';
function conexao(estado){ if (SC.conexao !== estado){ SC.conexao = estado; SC.emit('conexao', estado); } }
async function api(rota, {metodo = 'GET', corpo, cache = false} = {}){
  if (!CFG) throw new ErroApi('Somente leitura: abra pelo app Segundo Cérebro para ver o conteúdo completo e editar.', 'somente_leitura', 0);
  if (cache && cacheApi.has(rota)) return cacheApi.get(rota);
  const tarefa = (async () => {
    let r;
    try {
      r = await fetch(`${CFG.api}/${rota}`, {method: metodo, cache: 'no-store',
        headers: {'X-SC-Token': CFG.token, ...(corpo !== undefined ? {'Content-Type': 'application/json'} : {})},
        body: corpo !== undefined ? JSON.stringify(corpo) : undefined});
    } catch (e) {
      conexao('offline');
      throw new ErroApi('Servidor local indisponível — o app Segundo Cérebro ainda está aberto?', 'offline', 0);
    }
    let dados = null;
    try { dados = await r.json(); } catch (e) {}
    conexao('ok');
    if (!r.ok) throw new ErroApi((dados && dados.erro) || `Erro ${r.status}`, (dados && dados.codigo) || 'erro', r.status, dados);
    if (metodo !== 'GET') aposEscrita(dados || {});
    return dados;
  })();
  if (cache){ cacheApi.set(rota, tarefa); tarefa.catch(() => cacheApi.delete(rota)); }
  return tarefa;
}
const enc = encodeURIComponent;
let alteracoesMapa = 0;
function aposEscrita(r){
  if (r.assinatura) assinatura = r.assinatura;
  cacheApi.clear();
  if (r.estrutura) alteracoesMapa++;
  SC.emit('dados-mudaram', r);
}
function podeEditar(){
  if (ESCRITA) return true;
  toast('Somente leitura — abra pelo app “Segundo Cérebro” (ou rode servidor.py) para criar e editar.', {tipo: 'aviso', duracao: 6500});
  return false;
}

/* ---------------------------------------------------------------- dados do vault */
const TIPO = {
  cliente:      {rot: 'Cliente',      cor: '--c-cliente',      cat: 'sistemas'},
  projeto:      {rot: 'Projeto',      cor: '--c-projeto',      cat: 'projetos'},
  decisao:      {rot: 'Decisão',      cor: '--c-decisao',      cat: 'decisoes'},
  marca:        {rot: 'Marca',        cor: '--c-conhecimento', cat: 'notas'},
  conhecimento: {rot: 'Conhecimento', cor: '--c-conhecimento', cat: 'notas'},
  stack:        {rot: 'Stack',        cor: '--c-conhecimento', cat: 'notas'},
  area:         {rot: 'Área',         cor: '--c-conhecimento', cat: 'notas'},
  processo:     {rot: 'Processo',     cor: '--c-processo',     cat: 'processos'},
  pessoa:       {rot: 'Pessoa',       cor: '--c-pessoa',       cat: 'pessoas'},
  prompt:       {rot: 'Prompt',       cor: '--c-prompt',       cat: 'prompts'},
  recurso:      {rot: 'Recurso',      cor: '--c-prompt',       cat: 'notas'},
  central:      {rot: 'Central',      cor: '--cyan',           cat: 'notas'},
  inbox:        {rot: 'Inbox',        cor: '--cyan',           cat: 'notas'},
};
const tipoDe = t => TIPO[t] || TIPO.conhecimento;
const STATUS_COR = {vigente: '--sc-ok', ativo: '--sc-ok', executado: '--sc-ok', 'em-validacao': '--sc-aviso', 'necessita-validacao': '--sc-aviso',
  parcial: '--sc-aviso', 'parcialmente-substituida': '--sc-aviso', aguardando: '--sc-aviso', planejamento: '--cyan', pausado: '--muted',
  desconhecido: '--muted', substituida: '--muted', rejeitada: '--sc-erro', arquivado: '--muted', concluido: '--muted'};
const ABERTAS = new Set(['em-validacao', 'necessita-validacao', 'parcial', 'proposta', 'pendente']);
// o modelo da interface é reindexado depois de cada escrita (o motor 3D mantém o dele até "Atualizar mapa")
let DM = D, nos, clusters, porId, porNome, porCl, viz, membros;
function indexar(dados){
  DM = dados; nos = dados.nos; clusters = dados.clusters;
  porId = new Map(nos.map(n => [n.id, n]));
  porNome = new Map(nos.map(n => [n.id.toLowerCase(), n]));
  porCl = new Map(clusters.map(c => [c.id, c]));
  viz = new Map(nos.map(n => [n.id, new Set()]));
  dados.links.forEach(([a, b]) => { viz.get(a) && viz.get(a).add(b); viz.get(b) && viz.get(b).add(a); });
  membros = new Map(clusters.map(c => [c.id, []]));
  nos.forEach(n => { const m = membros.get(n.cluster); if (m) m.push(n); });
}
indexar(D);
const nomesExtras = new Set();      // notas fora do mapa (00 - CENTRAL, Inbox…), conhecidas pelo índice completo
let indiceCompleto = false;
const curto = id => String(id || '').replace(/^(Decisão|SOP|Prompt) — /, '');
function existeNota(nome){ const k = String(nome || '').trim().toLowerCase(); return porNome.has(k) || nomesExtras.has(k) || !indiceCompleto; }
function notaPorNome(nome){ return porNome.get(String(nome || '').trim().toLowerCase()) || null; }
function sistemaDe(n){ return n ? porCl.get(n.cluster) || null : null; }
function nomeSistema(c){ return !c ? '—' : c.id === D.geral ? 'Núcleo' : c.nome; }
function tipoSistema(c){
  if (!c) return '';
  if (c.id === D.geral) return 'Núcleo de conhecimento';
  if (!c.hub) return 'Agrupamento';
  const hub = porId.get(c.hub);
  return hub && hub.tipo === 'pessoa' ? 'Pessoa' : 'Cliente';
}
function descSistema(c){
  if (!c) return '';
  if (c.id === D.geral) return 'Conhecimento geral do vault que não pertence a um único sistema.';
  const hub = c.hub && porId.get(c.hub);
  if (hub && hub.resumo) return hub.resumo + (hub.resumo.length >= 320 ? '…' : '');
  return c.hub ? '' : 'Projetos sem cliente definido no frontmatter.';
}
function processosLigados(sid){
  const ps = new Set();
  for (const n of membros.get(sid) || []){
    if (n.tipo === 'processo') ps.add(n.id);
    for (const v of viz.get(n.id) || []){ const x = porId.get(v); if (x && x.tipo === 'processo') ps.add(x.id); }
  }
  return ps.size;
}
function contagem(c){
  const m = membros.get(c.id) || [];
  return {notas: c.total, projetos: c.tipos.projeto || 0, decisoes: c.tipos.decisao || 0, processos: processosLigados(c.id),
    travadas: m.filter(n => n.tipo === 'decisao' && n.travado && !n.arquivo).length,
    abertas: m.filter(n => n.tipo === 'decisao' && ABERTAS.has(n.status)).length,
    pendencias: m.reduce((s, n) => s + (n.tipo === 'processo' ? 0 : (n.tarefas && n.tarefas[0]) || 0), 0)};
}
const ehData = d => /^\d{4}-\d{2}-\d{2}/.test(d || '');
function ultimaAtualizacao(lista){
  let max = '';
  for (const n of lista){ for (const d of [n.mtime, n.atualizado, n.data]) if (ehData(d) && d > max) max = d; }
  return max;
}
const ordenarPorNome = (a, b) => curto(a.id).localeCompare(curto(b.id), 'pt-BR');
const projetosDe = sid => (membros.get(sid) || []).filter(n => n.tipo === 'projeto').sort(ordenarPorNome);
const sistemasOrdenados = () => [...clusters].sort((a, b) => (a.id === D.geral ? -1 : b.id === D.geral ? 1 : nomeSistema(a).localeCompare(nomeSistema(b), 'pt-BR')));

/* ---------------------------------------------------------------- camadas: modais, foco e Esc */
const pilha = [];
const FOCAVEIS = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
function focaveis(el){ return $$(FOCAVEIS, el).filter(x => x.offsetParent !== null || x === document.activeElement); }
function empilhar(c){ c.anterior = document.activeElement; pilha.push(c); }
function desempilhar(c){
  const i = pilha.indexOf(c);
  if (i >= 0) pilha.splice(i, 1);
  try { if (c.anterior && c.anterior.isConnected) c.anterior.focus({preventScroll: true}); } catch (e) {}
}
document.addEventListener('keydown', e => {
  if (e.key !== 'Tab' || !pilha.length) return;
  const f = focaveis(pilha[pilha.length - 1].el);
  if (!f.length) return;
  const i = f.indexOf(document.activeElement);
  if (e.shiftKey && i <= 0){ e.preventDefault(); f[f.length - 1].focus(); }
  else if (!e.shiftKey && (i === f.length - 1 || i < 0)){ e.preventDefault(); f[0].focus(); }
}, true);
let contaModal = 0;
function modal({rotulo = '', titulo = '', corpo = '', rodape = '', classe = '', largura, cor, podeFechar, aoFechar, foco} = {}){
  const id = 'sc-modal-' + (++contaModal);
  const veu = document.createElement('div'); veu.className = 'sc-veu';
  const el = document.createElement('section');
  el.className = `sc-modal sc-raiz sc-cantos ${classe}`;
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', id + '-t');
  if (largura) el.style.setProperty('--w', largura);
  if (cor) el.style.setProperty('--acento', cor);   // cor da categoria (decisão, processo, projeto…)
  el.innerHTML = `<i class="cant a"></i><i class="cant b"></i><button type="button" class="sc-fechar" data-fechar aria-label="Fechar">✕</button>
    <header class="sc-modal-cab"><div class="sc-rotulo">${rotulo}</div><h2 id="${id}-t">${titulo}</h2></header>
    <div class="sc-modal-corpo">${corpo}</div>${rodape ? `<footer class="sc-modal-rodape">${rodape}</footer>` : ''}`;
  document.body.append(veu, el);
  const camada = {el, veu, tipo: 'modal', aberta: true,
    async fechar(forcar){
      if (!camada.aberta) return true;
      if (!forcar && podeFechar && !(await podeFechar())) return false;
      camada.aberta = false;
      el.classList.remove('on'); veu.classList.remove('on');
      setTimeout(() => { el.remove(); veu.remove(); }, REDUZ ? 0 : 230);
      desempilhar(camada);
      if (aoFechar) aoFechar();
      return true;
    }};
  veu.addEventListener('click', () => camada.fechar());
  $$('[data-fechar]', el).forEach(b => b.addEventListener('click', () => camada.fechar()));
  empilhar(camada);
  requestAnimationFrame(() => { veu.classList.add('on'); el.classList.add('on'); });
  setTimeout(() => { const alvo = (foco && $(foco, el)) || $('input:not([readonly]),textarea,select', $('.sc-modal-corpo', el)) || $('[data-fechar]', el); alvo && alvo.focus({preventScroll: true}); }, 30);
  return camada;
}
async function fecharTopo(){ const c = pilha[pilha.length - 1]; if (!c) return false; await c.fechar(); return true; }

function confirmar({rotulo = 'CONFIRMAÇÃO', titulo, texto = '', sim = 'Confirmar', nao = 'Cancelar', perigo = false, extra = ''}){
  return new Promise(resolver => {
    let ok = false;
    const m = modal({classe: 'pequeno', rotulo, titulo: esc(titulo),
      corpo: `<p style="font-size:13.5px;line-height:1.6;color:var(--sc-texto-2)">${texto}</p>${extra}`,
      rodape: `<span class="sc-status"></span><button type="button" class="sc-btn" data-fechar>${esc(nao)}</button><button type="button" class="sc-btn ${perigo ? 'perigo' : 'primario'}" data-sim>${esc(sim)}</button>`,
      aoFechar: () => resolver(ok), foco: perigo ? '[data-fechar]:not(.sc-fechar)' : '[data-sim]'});
    $('[data-sim]', m.el).addEventListener('click', () => { ok = true; m.fechar(true); });
  });
}

/* menu suspenso (ações extras) */
let menuAberto = null;
function menu(ancora, itens){
  fecharMenu();
  const el = document.createElement('div');
  el.className = 'sc-menu sc-raiz'; el.setAttribute('role', 'menu');
  el.innerHTML = itens.map((it, i) => it === '-' ? '<hr>' : `<button type="button" role="menuitem" data-i="${i}" class="${it.perigo ? 'perigo' : ''}"><i>${it.icone || '›'}</i>${esc(it.rotulo)}</button>`).join('');
  document.body.append(el);
  const r = ancora.getBoundingClientRect(), w = el.offsetWidth, hgt = el.offsetHeight;
  el.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.right - w)) + 'px';
  el.style.top = (r.bottom + hgt + 8 > innerHeight ? Math.max(8, r.top - hgt - 6) : r.bottom + 6) + 'px';
  $$('button', el).forEach(b => b.addEventListener('click', () => { const it = itens[+b.dataset.i]; fecharMenu(); it.acao(); }));
  el.addEventListener('keydown', e => {
    const bs = $$('button', el), i = bs.indexOf(document.activeElement);
    if (e.key === 'ArrowDown'){ e.preventDefault(); bs[(i + 1) % bs.length].focus(); }
    if (e.key === 'ArrowUp'){ e.preventDefault(); bs[(i - 1 + bs.length) % bs.length].focus(); }
    if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); fecharMenu(); ancora.focus(); }
  });
  menuAberto = {el, ancora};
  setTimeout(() => { const b = $('button', el); b && b.focus(); }, 0);
}
function fecharMenu(){ if (menuAberto){ menuAberto.el.remove(); menuAberto = null; } }
document.addEventListener('pointerdown', e => { if (menuAberto && !menuAberto.el.contains(e.target) && !menuAberto.ancora.contains(e.target)) fecharMenu(); }, true);

/* ---------------------------------------------------------------- avisos (toasts) */
function toast(texto, {tipo = 'info', acao, duracao = 4200} = {}){
  let area = $('#sc-toasts');
  if (!area){ area = document.createElement('div'); area.id = 'sc-toasts'; area.className = 'sc-raiz'; area.setAttribute('role', 'status'); area.setAttribute('aria-live', 'polite'); document.body.append(area); }
  const el = document.createElement('div');
  el.className = `sc-toast ${tipo}`;
  el.innerHTML = `<span>${esc(texto)}</span>${acao ? `<button type="button" class="sc-btn mini">${esc(acao.rotulo)}</button>` : ''}`;
  if (acao) $('button', el).addEventListener('click', () => { acao.fn(); sair(); });
  area.append(el);
  requestAnimationFrame(() => el.classList.add('on'));
  const sair = () => { el.classList.remove('on'); setTimeout(() => el.remove(), 260); };
  setTimeout(sair, duracao);
  return sair;
}
function erroToast(e, prefixo = ''){ toast((prefixo ? prefixo + ': ' : '') + (e && e.message ? e.message : String(e)), {tipo: 'erro', duracao: 7000}); }

/* estados reutilizáveis */
const esqueleto = (n = 4) => `<div class="sc-esqueleto" aria-hidden="true">${'<i></i>'.repeat(n)}</div><span class="sc-sr">Carregando…</span>`;
const vazio = (titulo, texto = '', acao = '') => `<div class="sc-vazio"><b>${titulo}</b>${texto ? `<span>${texto}</span>` : ''}${acao}</div>`;
function caixaErro(e, tentar){
  const id = 'sc-tentar-' + Math.random().toString(36).slice(2, 8);
  if (tentar) setTimeout(() => { const b = document.getElementById(id); if (b) b.onclick = tentar; }, 0);
  const leitura = e && e.codigo === 'somente_leitura';
  return `<div class="${leitura ? 'sc-info-caixa' : 'sc-erro-caixa'}">${esc(e && e.message ? e.message : String(e))}${tentar && !leitura ? ` <button type="button" class="sc-link" id="${id}">Tentar de novo</button>` : ''}</div>`;
}

/* ---------------------------------------------------------------- diferenças entre versões (linhas) */
function diffLinhas(a, b){
  const A = String(a).split('\n'), B = String(b).split('\n'), n = A.length, m = B.length;
  if (n * m > 5e6) return null;
  const dp = Array.from({length: n + 1}, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ops = [];
  let i = 0, j = 0;
  while (i < n && j < m){
    if (A[i] === B[j]){ ops.push(['igual', A[i]]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) ops.push(['menos', A[i++]]);
    else ops.push(['mais', B[j++]]);
  }
  while (i < n) ops.push(['menos', A[i++]]);
  while (j < m) ops.push(['mais', B[j++]]);
  return ops;
}
function htmlDiff(a, b){
  const ops = diffLinhas(a, b);
  if (!ops) return '<div class="sc-info-caixa">As versões são grandes demais para comparar aqui.</div>';
  const muda = ops.map(o => o[0] !== 'igual');
  if (!muda.some(Boolean)) return '<div class="sc-info-caixa">As duas versões são iguais.</div>';
  const perto = i => muda.slice(Math.max(0, i - 2), i + 3).some(Boolean);
  let html = '', pulo = 0;
  ops.forEach(([t, l], i) => {
    if (t === 'igual' && !perto(i)){ pulo++; return; }
    if (pulo){ html += `<div class="igual">· · · ${pulo} linha${pulo > 1 ? 's' : ''} igua${pulo > 1 ? 'is' : 'l'}</div>`; pulo = 0; }
    html += `<div class="${t}">${t === 'mais' ? '+ ' : t === 'menos' ? '− ' : '  '}${esc(l) || ' '}</div>`;
  });
  if (pulo) html += `<div class="igual">· · · ${pulo} linha${pulo > 1 ? 's' : ''} igua${pulo > 1 ? 'is' : 'l'}</div>`;
  return `<div class="sc-dif">${html}</div>`;
}

/* ---------------------------------------------------------------- Markdown (sintaxe do Obsidian) */
const RE_TAREFA = /^(\s*)([-*]) \[([ xX])\] (.*)$/;
const RE_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const RE_TABELA = /^\s*\|?\s*:?-{2,}/;
const recuo = l => (l.match(/^\s*/)[0] || '').replace(/\t/g, '    ').length;
const COR_CALLOUT = {warning: '--sc-aviso', caution: '--sc-aviso', attention: '--sc-aviso', question: '--sc-aviso', help: '--sc-aviso', faq: '--sc-aviso',
  danger: '--sc-erro', error: '--sc-erro', bug: '--sc-erro', failure: '--sc-erro', success: '--sc-ok', check: '--sc-ok', done: '--sc-ok', tip: '--sc-ok', important: '--sc-ok', quote: '--muted', cite: '--muted'};
const ROT_CALLOUT = {summary: 'Resumo', abstract: 'Resumo', tldr: 'Resumo', info: 'Info', note: 'Nota', todo: 'A fazer', tip: 'Dica', hint: 'Dica', important: 'Importante',
  success: 'Feito', check: 'Feito', done: 'Feito', question: 'Pergunta', help: 'Pergunta', faq: 'Pergunta', warning: 'Atenção', caution: 'Atenção', attention: 'Atenção',
  failure: 'Falha', fail: 'Falha', missing: 'Falta', danger: 'Perigo', error: 'Erro', bug: 'Bug', example: 'Exemplo', quote: 'Citação', cite: 'Citação'};
function mdInline(texto){
  const codigos = [];
  let s = String(texto).replace(/`([^`]+)`/g, (_, c) => { codigos.push(c); return `\u0000${codigos.length - 1}\u0000`; });
  s = esc(s);
  s = s.replace(/!\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_, alvo, alias) => `<a class="sc-wl" data-nota="${alvo.trim()}" href="#">📎 ${alias || alvo}</a>`);
  s = s.replace(/\[\[([^\]|#]+)(#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_, alvo, ancora, alias) => {
    const nome = alvo.trim().split('/').pop();
    return `<a class="sc-wl${existeNota(desesc(nome)) ? '' : ' quebrado'}" data-nota="${nome}" href="#" title="${nome}">${alias || nome + (ancora ? ' › ' + ancora.slice(1) : '')}</a>`;
  });
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, t, u) => `<a href="${u}" target="_blank" rel="noopener">${t}</a>`);
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)"]+)/g, (_, p, u) => `${p}<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>').replace(/==([^=]+)==/g, '<mark>$1</mark>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codigos[+i])}</code>`);
}
function md(texto, op = {}){
  const L = String(texto || '').replace(/\r\n?/g, '\n').split('\n');
  const k = op._k || (op._k = {n: 0});
  let i = 0, html = '';
  const inicioBloco = (l, prox) => /^\s*(#{1,6}\s|>|`{3,}|~{3,})/.test(l) || RE_ITEM.test(l) || (/\|/.test(l) && prox !== undefined && RE_TABELA.test(prox));
  while (i < L.length){
    const l = L[i];
    if (!l.trim()){ i++; continue; }
    if (/^\s*<!--/.test(l)){ while (i < L.length && !/-->/.test(L[i])) i++; i++; continue; }
    const cerca = /^\s*(`{3,}|~{3,})\s*([\w-]*)/.exec(l);
    if (cerca){
      const buf = []; i++;
      while (i < L.length && !L[i].trim().startsWith(cerca[1])) buf.push(L[i++]);
      i++;
      html += `<pre><code${cerca[2] ? ` data-lang="${esc(cerca[2])}"` : ''}>${esc(buf.join('\n'))}</code></pre>`;
      continue;
    }
    const t = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l);
    if (t){
      const n = Math.min(4, t[1].length);
      if (op.semTitulo && n === 1 && !op._pulou) op._pulou = true;
      else html += `<h${n}>${mdInline(t[2])}</h${n}>`;
      i++; continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)){ html += '<hr>'; i++; continue; }
    if (/^\s*>/.test(l)){
      const buf = [];
      while (i < L.length && /^\s*>/.test(L[i])) buf.push(L[i++].replace(/^\s*>\s?/, ''));
      const c = /^\[!(\w+)\][+-]?\s*(.*)$/.exec(buf[0] || '');
      const dentro = {semTitulo: false, citacao: true, _k: k};
      if (c){
        const tipoC = c[1].toLowerCase();
        html += `<div class="sc-callout" style="--c:var(${COR_CALLOUT[tipoC] || '--cyan'})"><b>${ROT_CALLOUT[tipoC] || esc(c[1])}</b>${c[2] ? `<span class="sc-callout-t">${mdInline(c[2])}</span>` : ''}${md(buf.slice(1).join('\n'), dentro)}</div>`;
      }
      else html += `<blockquote>${md(buf.join('\n'), dentro)}</blockquote>`;
      continue;
    }
    if (/\|/.test(l) && i + 1 < L.length && RE_TABELA.test(L[i + 1])){
      const linha = s => s.replace(/\\\|/g, '\u0001').trim().replace(/^\||\|$/g, '').split('|').map(x => x.trim().replace(/\u0001/g, '|'));
      const cab = linha(L[i]); i += 2;
      const corpo = [];
      while (i < L.length && /\|/.test(L[i]) && L[i].trim()) corpo.push(linha(L[i++]));
      html += `<table><thead><tr>${cab.map(c => `<th>${mdInline(c)}</th>`).join('')}</tr></thead><tbody>${corpo.map(r => `<tr>${r.map(c => `<td>${mdInline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
      continue;
    }
    if (RE_ITEM.test(l)){ const r = mdLista(L, i, op, k); html += r.html; i = r.i; continue; }
    const buf = [];
    while (i < L.length && L[i].trim() && (!buf.length || !inicioBloco(L[i], L[i + 1]))) buf.push(L[i++]);
    html += `<p>${buf.map(mdInline).join('<br>')}</p>`;
  }
  return html;
}
function mdLista(L, i, op, k){
  const base = recuo(L[i]), ordenada = /\d/.test(RE_ITEM.exec(L[i])[2]);
  let html = '';
  while (i < L.length){
    const l = L[i];
    if (!l.trim()){
      if (i + 1 < L.length && RE_ITEM.test(L[i + 1]) && recuo(L[i + 1]) >= base){ i++; continue; }
      break;
    }
    const m = RE_ITEM.exec(l);
    if (!m){
      if (recuo(l) > base && html.endsWith('</li>')){ html = html.slice(0, -5) + '<br>' + mdInline(l.trim()) + '</li>'; i++; continue; }
      break;
    }
    const ind = recuo(l);
    if (ind < base) break;
    if (ind > base){ const r = mdLista(L, i, op, k); html = html.endsWith('</li>') ? html.slice(0, -5) + r.html + '</li>' : html + r.html; i = r.i; continue; }
    if (/\d/.test(m[2]) !== ordenada) break;
    const tf = RE_TAREFA.exec(l);
    if (tf){
      const feito = tf[3] !== ' ';
      let attrs = 'disabled';
      if (!op.citacao){ const idx = k.n++; attrs = op.interativo && ESCRITA ? `data-k="${idx}"` : `data-k="${idx}" disabled`; }
      html += `<li class="sc-md-tarefa${feito ? ' feita' : ''}"><input type="checkbox" class="sc-caixa" ${feito ? 'checked' : ''} ${attrs} aria-label="${esc(tf[4].slice(0, 90))}"><span>${mdInline(tf[4])}</span></li>`;
    } else {
      const caixa = /^\[([ xX])\]\s+(.*)$/.exec(m[3]);
      html += caixa ? `<li class="sc-md-tarefa${caixa[1] !== ' ' ? ' feita' : ''}"><input type="checkbox" class="sc-caixa" disabled ${caixa[1] !== ' ' ? 'checked' : ''}><span>${mdInline(caixa[2])}</span></li>` : `<li>${mdInline(m[3])}</li>`;
    }
    i++;
  }
  return {html: `<${ordenada ? 'ol' : 'ul'}>${html}</${ordenada ? 'ol' : 'ul'}>`, i};
}
// texto puro para trechos e resumos
const textoPuro = s => String(s || '').replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_, a, b) => b || a).replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*_`~#>]+/g, '').replace(/\s+/g, ' ').trim();

/* links internos clicados em qualquer lugar da interface */
document.addEventListener('click', e => {
  const a = e.target.closest && e.target.closest('a.sc-wl');
  if (!a) return;
  e.preventDefault();
  SC.abrirNota(a.dataset.nota, {de: a});
});
