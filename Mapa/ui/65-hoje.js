/* Painel "Hoje": saudação com a data, pendências abertas de 00 - CENTRAL/Pendências.md (urgentes e segurança
   primeiro), últimas notas tocadas pelo git e atalhos de captura. Tudo vem do servidor (/api/hoje) — nada
   inventado. Abre pelo botão HOJE no topo; não é barra lateral permanente (decisão de 15/10). */
const Hoje = {dados: null, btn: null, carregando: null};

function saudacaoHoje(){
  const h = new Date().getHours();
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}
function dataLongaHoje(){
  try { return new Date().toLocaleDateString('pt-BR', {weekday: 'long', day: 'numeric', month: 'long'}); } catch (e) { return hojeISO(); }
}
async function carregarHoje(forcar){
  if (!CFG) return null;
  if (Hoje.dados && !forcar) return Hoje.dados;
  if (!Hoje.carregando) Hoje.carregando = api('hoje').then(d => { Hoje.dados = d; pintarBotaoHoje(); return d; }).finally(() => { Hoje.carregando = null; });
  return Hoje.carregando;
}
function pintarBotaoHoje(){
  if (!Hoje.btn) return;
  const d = Hoje.dados, urg = d ? d.pendencias.filter(p => pesoPend(p) === 0).length : 0;
  $('.sc-hoje-n', Hoje.btn).textContent = urg ? String(urg) : '';
  Hoje.btn.title = d ? `${d.total_pendencias} pendências abertas · ${urg} urgentes` : 'Painel de hoje';
}
function pesoPend(p){ const s = sem(p.secao || ''); return /urgente|🔴/.test(p.secao || '') || s.includes('urgente') ? 0 : (s.includes('seguran') || /🔐/.test(p.secao || '')) ? 1 : 2; }
function htmlPendencias(lista){
  if (!lista.length) return vazio('Nenhuma pendência aberta.', 'A lista vem de 00 - CENTRAL/Pendências.md.');
  return `<ul class="sc-hoje-pend">${lista.map(p => { const w = pesoPend(p); return `<li class="${w === 0 ? 'urgente' : w === 1 ? 'seguranca' : ''}"><i aria-hidden="true"></i><div>${md ? mdInline(p.texto) : esc(p.texto)}<small>${esc(p.secao || 'Pendências')}</small></div></li>`; }).join('')}</ul>`;
}
function mdInline(t){
  // só negrito, código e links internos — sem blocos
  return esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_, a, r) => `<button type="button" class="sc-link" data-hoje-nota="${esc(a.trim())}">${esc((r || a).trim())}</button>`);
}
function abrirHoje(){
  const d = Hoje.dados;
  const m = modal({largura: '940px', cor: 'var(--sc-ouro)', rotulo: `HOJE · ${esc(dataLongaHoje().toUpperCase())}`, titulo: `${saudacaoHoje()}, ${esc((D && D.dono) || 'senhor')}.`,
    corpo: `<p class="sc-hoje-saud">${d ? `<b>${d.total_pendencias}</b> pendência${d.total_pendencias === 1 ? '' : 's'} aberta${d.total_pendencias === 1 ? '' : 's'} · <b>${d.projetos_ativos.length}</b> projetos ativos · mapa gerado ${esc(dataRel(d.gerado))}` : 'Carregando o estado do vault…'}</p>
      <div class="sc-hoje">
        <div class="sc-coluna">
          <section class="sc-bloco"><div class="sc-rotulo linha">Pendências <span class="sc-n">${d ? d.total_pendencias : ''}</span></div>
            <div data-hoje-pend>${d ? htmlPendencias(d.pendencias.slice(0, 10)) : esqueleto(5)}</div>
            ${d && d.pendencias.length > 10 ? `<button type="button" class="sc-link" data-hoje-todas>Mostrar todas (${d.pendencias.length})</button>` : ''}
            <div><button type="button" class="sc-link" data-hoje-nota="Pendências">Abrir a nota Pendências →</button></div>
          </section>
        </div>
        <aside class="sc-coluna">
          <section class="sc-bloco"><div class="sc-rotulo linha">Capturar</div>
            <div class="sc-hoje-acoes">
              ${ESCRITA ? `<button type="button" class="sc-btn" data-hoje-acao="nota">+ Nota</button><button type="button" class="sc-btn" data-hoje-acao="decisao">◇ Decisão</button><button type="button" class="sc-btn" data-hoje-acao="tarefa">☐ Tarefa</button>` : '<span class="sc-info-caixa">Abra pelo app para capturar.</span>'}
            </div>
          </section>
          <section class="sc-bloco"><div class="sc-rotulo linha">Últimas notas <span class="sc-n">${d ? d.recentes.length : ''}</span></div>
            ${d ? (d.recentes.length ? `<div class="sc-lista">${d.recentes.map(n => `<button type="button" class="sc-item" data-hoje-nota="${esc(n.id)}"><span class="sc-ponto" style="--c:var(${tipoDe(n.tipo).cor})"></span><span style="min-width:0"><span class="sc-t" style="display:block">${esc(n.id)}</span><span class="sc-s">${esc(tipoDe(n.tipo).rot)}${n.cluster && porCl.get(n.cluster) ? ' · ' + esc(nomeSistema(porCl.get(n.cluster))) : ''}</span></span><span class="sc-d">${esc(dataRel(n.data))}</span></button>`).join('')}</div>` : vazio('Sem registros no git ainda.')) : esqueleto(4)}
          </section>
          <section class="sc-bloco"><div class="sc-rotulo linha">Sessões recentes</div>
            ${d ? (d.atividade.length ? `<ul class="sc-linha-tempo">${d.atividade.slice(0, 5).map(a => `<li><time>${esc(dataRel(a.data))}</time><p>${esc(a.msg)}</p><small>${a.total} nota${a.total === 1 ? '' : 's'}</small></li>`).join('')}</ul>` : vazio('Nada registrado.')) : esqueleto(3)}
          </section>
        </aside>
      </div>`});
  m.el.addEventListener('click', e => {
    const n = e.target.closest('[data-hoje-nota]');
    if (n){ m.fechar(true); SC.abrirNota(n.dataset.hojeNota); return; }
    const a = e.target.closest('[data-hoje-acao]');
    if (a){ m.fechar(true); const t = a.dataset.hojeAcao; if (t === 'nota' && typeof Editor !== 'undefined') Editor.nova(); else if (t === 'decisao') Decisao.nova(); else if (t === 'tarefa') Tarefa.nova(); return; }
    if (e.target.closest('[data-hoje-todas]') && d){ $('[data-hoje-pend]', m.el).innerHTML = htmlPendencias(d.pendencias); e.target.closest('[data-hoje-todas]').remove(); }
  });
  if (!d) carregarHoje().then(() => { if (m.aberta){ m.fechar(true); abrirHoje(); } }).catch(() => {});
}
function montarHoje(){
  if (!CFG || Hoje.btn) return;
  const b = document.createElement('button');
  b.type = 'button'; b.id = 'sc-hoje-btn'; b.innerHTML = '☼ HOJE <span class="sc-hoje-n"></span>';
  b.setAttribute('aria-label', 'Painel de hoje: pendências e últimas notas');
  b.addEventListener('click', abrirHoje);
  document.body.append(b); Hoje.btn = b;
  carregarHoje().catch(() => {});
  SC.on('dados-mudaram', () => { Hoje.dados = null; carregarHoje(true).catch(() => {}); });
  SC.on('modelo-atualizado', () => { Hoje.dados = null; carregarHoje(true).catch(() => {}); });
}
SC.hoje = {abrir: abrirHoje};
SC.on('mapa-pronto', montarHoje);
