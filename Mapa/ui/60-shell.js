/* Integração com o HUD do mapa, apresentação, celular, atalhos, sincronização com o vault e inicialização. */

/* ---------- depois de escrever: listas atualizadas na hora; o 3D atualiza quando o usuário pedir ---------- */
SC.on('dados-mudaram', r => {
  pintarSincronia();
  if (!r.estrutura || !CFG) return;
  api('dados').then(x => { indexar(x.dados); SC.emit('modelo-atualizado'); }).catch(() => {});
});
SC.on('modelo-atualizado', () => {
  if (WS.aberto) pintarWS({manterLeitor: true});
  if (Insp.sel){
    const ainda = Insp.sel.tipo === 'sistema' ? porCl.has(Insp.sel.id) : porId.has(Insp.sel.id);
    if (ainda) abrirInspector(Insp.sel); else fecharInspector(false);
  }
  pintarListaMobile();
});

/* ---------- aviso de mapa desatualizado (estado real) ---------- */
let mudancaExterna = false;
function montarSincronia(){
  const b = document.createElement('button');
  b.type = 'button'; b.id = 'sc-sincronia'; b.className = 'sc-raiz';
  b.addEventListener('click', () => recarregarMapa('Mapa atualizado com o vault.'));
  document.body.append(b);
}
function pintarSincronia(){
  const b = $('#sc-sincronia');
  if (!b) return;
  const on = alteracoesMapa > 0 || mudancaExterna;
  b.classList.toggle('on', on);
  b.innerHTML = mudancaExterna && !alteracoesMapa ? '◌ Vault alterado fora daqui · atualizar mapa' : `◌ ${alteracoesMapa} alteraç${alteracoesMapa === 1 ? 'ão' : 'ões'} · atualizar mapa`;
  b.title = 'Recarrega o mapa 3D com as notas atuais (mantém câmera, filtros e o que estiver aberto)';
}
function recarregarMapa(msg){
  const estado = {t: Date.now(), msg: msg || 'Mapa atualizado com o vault.', cam: SC.mapa.camera(), filtros: SC.mapa.filtros(),
    sel: Insp.sel, ws: WS.aberto ? {sid: WS.sid, aba: WS.aba, nota: WS.nota} : null};
  try { sessionStorage.setItem('sc-retomar', JSON.stringify(estado)); } catch (e) {}
  document.body.style.transition = 'opacity .18s'; document.body.style.opacity = '0';
  setTimeout(() => location.reload(), REDUZ ? 0 : 180);
}
SC.recarregarMapa = recarregarMapa;

/* vigia o vault: se algo mudou no Obsidian (ou pelo Claude), avisa e atualiza as listas */
function vigiarVault(){
  if (!CFG) return;
  setInterval(async () => {
    if (document.hidden) return;
    try {
      const s = await api('saude');
      if (s.assinatura !== assinatura){
        assinatura = s.assinatura;
        cacheApi.clear(); agregados.clear(); Pal.docs = null;
        mudancaExterna = true; pintarSincronia();
        const x = await api('dados');
        indexar(x.dados); SC.emit('modelo-atualizado');
        if (WS.aberto){ WS.ag = null; carregarAgregadoWS(); }
      }
    } catch (e) { /* estado offline já registrado pelo api() */ }
  }, 12000);
}
SC.on('conexao', estado => {
  if (estado === 'offline') toast('Servidor local indisponível — a leitura continua, mas nada pode ser salvo até ele voltar.', {tipo: 'erro', duracao: 7000});
  else if (estado === 'ok') toast('Servidor local de volta.', {tipo: 'ok', duracao: 2500});
});
SC.telemetria = () => `<span>VAULT <b style="color:${SC.conexao === 'offline' ? 'var(--sc-erro)' : 'var(--text)'}">${SC.conexao === 'offline' ? 'SERVIDOR OFFLINE' : CFG ? 'LEITURA · EDIÇÃO' : 'SOMENTE LEITURA'}</b></span>`;

/* ---------- HUD original: busca, filtros, índice ---------- */
const GRUPO_FILTRO = {clientes: 'sistemas', projetos: 'projetos', decisoes: 'decisoes', conhecimento: 'notas', processos: 'processos', pessoas: 'pessoas'};
function ligarHUD(){
  const q = $('#q');
  if (q){
    q.setAttribute('readonly', ''); q.setAttribute('aria-haspopup', 'dialog');
    q.placeholder = 'buscar nota, projeto, decisão…';
    const abrir = e => { e.preventDefault(); q.blur(); abrirPal({texto: q.value}); };
    q.addEventListener('focus', abrir);
    q.addEventListener('mousedown', abrir);
    const kbd = $('.search kbd');
    if (kbd) kbd.textContent = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K';
  }
  const filtros = $('#filters');
  if (filtros){
    const dica = () => $$('.chip', filtros).forEach(b => { b.title = 'Clique: mostrar/ocultar no mapa · ⇧ clique ou duplo clique: abrir a lista'; });
    dica(); setTimeout(dica, 1500);
    filtros.addEventListener('click', e => {
      const b = e.target.closest('.chip');
      if (b && e.shiftKey){ e.preventDefault(); e.stopImmediatePropagation(); abrirColecao(b.dataset.f); }
    }, true);
    filtros.addEventListener('dblclick', e => { const b = e.target.closest('.chip'); if (b) abrirColecao(b.dataset.f); });
  }
}
function abrirColecao(grupo){
  if (grupo === 'prompts') return Biblioteca.abrir();
  if (GRUPO_FILTRO[grupo]) return abrirPal({filtro: GRUPO_FILTRO[grupo]});
  // arquivo: notas arquivadas (estado arquivo, substituídas, 90 - ARQUIVO)
  const lista = nos.filter(n => n.arquivo).sort(ordenarPorNome);
  const m = modal({largura: '720px', rotulo: 'COLEÇÃO', titulo: `Arquivo <span style="color:var(--muted);font-size:14px">· ${lista.length} notas</span>`,
    corpo: `<p class="sc-insp-desc">Notas com estado “arquivo”, decisões substituídas ou rejeitadas e o que está em 90 - ARQUIVO. Continuam no vault como histórico.</p>
      <div class="sc-lista">${lista.map(n => itemLista(n, {attr: `data-col="${esc(n.id)}"`, sub: [nomeSistema(sistemaDe(n)), tipoDe(n.tipo).rot, n.status].filter(Boolean).join(' · ')})).join('') || vazio('Nada arquivado.')}</div>`});
  $('.sc-lista', m.el).addEventListener('click', e => { const b = e.target.closest('[data-col]'); if (b){ m.fechar(true); SC.abrirNota(b.dataset.col); } });
}

/* ---------- modo apresentação ---------- */
const Apresentacao = {
  ativo: false,
  cfg: Object.assign({velocidade: 'normal', avancar: true, rotulos: true}, ler('sc-apres', {})),
  alternar(){ this.ativo ? this.parar() : this.iniciar(); },
  async iniciar(){
    if (WS.aberto) fecharWS();
    fecharPal(); fecharInspector(false);
    SC.mapa.apresentacao('config', this.cfg);
    // falas escritas pelo Claude para cada sistema (roteiro.py); sem elas, a apresentação usa as frases padrão
    if (CFG){
      try {
        const r = await Promise.race([api('roteiro'), new Promise((_, nao) => setTimeout(() => nao(new Error('demorou')), 1500))]);
        SC.mapa.apresentacao('roteiro', r.itens || {});
      } catch (e) { /* segue com as frases padrão */ }
    }
    SC.mapa.apresentacao('iniciar');
  },
  parar(){ SC.mapa.apresentacao('parar'); },
};
SC.apresentacao = Apresentacao;
function montarApresentacao(){
  const barra = document.createElement('div');
  barra.id = 'sc-apres'; barra.className = 'sc-raiz'; barra.setAttribute('role', 'toolbar'); barra.setAttribute('aria-label', 'Controles da apresentação');
  barra.innerHTML = `<button type="button" class="sc-btn icone" data-ap="anterior" aria-label="Sistema anterior">◀</button>
    <button type="button" class="sc-btn icone" data-ap="pausa" aria-label="Pausar">❚❚</button>
    <button type="button" class="sc-btn icone" data-ap="proximo" aria-label="Próximo sistema">▶</button>
    <span class="sc-pos" aria-live="polite">—</span>
    <button type="button" class="sc-btn icone" data-ap="config" aria-label="Configurações da apresentação" aria-expanded="false">⚙</button>
    <button type="button" class="sc-btn sair" data-ap="sair">✕ Sair <span class="sc-kbd" style="margin-left:4px">ESC</span></button>`;
  document.body.append(barra);
  const cfg = document.createElement('div');
  cfg.id = 'sc-apres-cfg'; cfg.className = 'sc-raiz sc-oculto'; cfg.setAttribute('role', 'dialog'); cfg.setAttribute('aria-label', 'Configurações da apresentação');
  cfg.innerHTML = `<div class="sc-rotulo linha">Apresentação</div>
    <div class="sc-campo"><span class="sc-rot">Velocidade da câmera</span><div class="sc-segmentos" data-cfg="velocidade"><button type="button" data-v="lenta">Lenta</button><button type="button" data-v="normal">Normal</button><button type="button" data-v="rapida">Rápida</button></div></div>
    <label class="sc-check"><input type="checkbox" data-cfg-b="avancar"> Avançar sozinho entre os sistemas</label>
    <label class="sc-check"><input type="checkbox" data-cfg-b="rotulos"> Mostrar nomes das notas</label>
    <label class="sc-check"><input type="checkbox" data-cfg-b="narracao"> Narração e som</label>
    <button type="button" class="sc-btn" data-ap="centro">◎ Recentralizar</button>`;
  document.body.append(cfg);
  const pintarCfg = () => {
    $$('[data-cfg="velocidade"] button', cfg).forEach(b => b.setAttribute('aria-pressed', b.dataset.v === Apresentacao.cfg.velocidade));
    $$('[data-cfg-b]', cfg).forEach(x => { x.checked = x.dataset.cfgB === 'narracao' ? !!SC.mapa.som() : !!Apresentacao.cfg[x.dataset.cfgB]; });
    document.body.classList.toggle('sc-sem-rotulos', !Apresentacao.cfg.rotulos);
  };
  cfg.addEventListener('click', e => { const b = e.target.closest('[data-cfg="velocidade"] button'); if (b){ Apresentacao.cfg.velocidade = b.dataset.v; salvarCfg(); } });
  cfg.addEventListener('change', e => {
    const x = e.target.closest('[data-cfg-b]');
    if (!x) return;
    if (x.dataset.cfgB === 'narracao') SC.mapa.som(x.checked);
    else Apresentacao.cfg[x.dataset.cfgB] = x.checked;
    salvarCfg();
  });
  function salvarCfg(){ gravar('sc-apres', Apresentacao.cfg); SC.mapa.apresentacao('config', Apresentacao.cfg); pintarCfg(); }
  const clique = e => {
    const b = e.target.closest('[data-ap]');
    if (!b) return;
    const a = b.dataset.ap;
    if (a === 'sair') return Apresentacao.parar();
    if (a === 'config'){ const abrir = cfg.classList.contains('sc-oculto'); cfg.classList.toggle('sc-oculto', !abrir); b.setAttribute('aria-expanded', abrir); pintarCfg(); return; }
    if (a === 'centro') return SC.mapa.visaoGeral();
    if (a === 'pausa') return SC.mapa.apresentacao(Apresentacao.pausado ? 'retomar' : 'pausar');
    SC.mapa.apresentacao(a);
  };
  barra.addEventListener('click', clique);
  cfg.addEventListener('click', clique);
  SC.on('apresentacao', s => {
    Apresentacao.ativo = !!s.ativo; Apresentacao.pausado = !!s.pausado;
    if (!s.ativo){ cfg.classList.add('sc-oculto'); document.body.classList.remove('sc-sem-rotulos'); return; }
    pintarCfg();
    $('.sc-pos', barra).textContent = s.total ? `${pad2(s.i + 1)} / ${pad2(s.total)}` : '—';
    const p = $('[data-ap="pausa"]', barra);
    p.textContent = s.pausado ? '▶' : '❚❚'; p.setAttribute('aria-label', s.pausado ? 'Continuar' : 'Pausar');
  });
}

/* ---------- celular: lista de sistemas como entrada principal ---------- */
function montarMobile(){
  const b = document.createElement('button');
  b.type = 'button'; b.id = 'sc-mobile-btn'; b.className = 'sc-btn primario sc-raiz'; b.textContent = '☰ Sistemas';
  b.setAttribute('aria-controls', 'sc-lista-mobile'); b.setAttribute('aria-expanded', 'false');
  const folha = document.createElement('section');
  folha.id = 'sc-lista-mobile'; folha.className = 'sc-raiz'; folha.setAttribute('aria-label', 'Sistemas'); folha.inert = true;
  folha.innerHTML = `<header><div class="sc-rotulo">Sistemas · <span data-total></span></div><div style="display:flex;gap:6px"><button type="button" class="sc-btn icone" data-m="busca" aria-label="Buscar">⌕</button><button type="button" class="sc-btn icone" data-m="fechar" aria-label="Fechar">✕</button></div></header><div class="sc-lista" data-ml></div>`;
  document.body.append(b, folha);
  const alternar = abrir => { folha.classList.toggle('on', abrir); folha.inert = !abrir; b.setAttribute('aria-expanded', abrir); };
  b.addEventListener('click', () => alternar(!folha.classList.contains('on')));
  folha.addEventListener('click', e => {
    const x = e.target.closest('[data-m]');
    if (x){ alternar(false); if (x.dataset.m === 'busca') abrirPal(); return; }
    const s = e.target.closest('[data-ms]');
    if (s){ alternar(false); abrirWS(s.dataset.ms); }
  });
  pintarListaMobile();
}
function pintarListaMobile(){
  const l = $('[data-ml]');
  if (!l) return;
  $('#sc-lista-mobile [data-total]').textContent = clusters.length;
  l.innerHTML = [...clusters].sort((a, b) => b.total - a.total).map(c => { const ct = contagem(c); return `<button type="button" class="sc-item" data-ms="${esc(c.id)}"><span class="sc-ponto ${c.ativo || c.id === D.geral ? '' : 'vazio'}" style="--c:var(--cyan)"></span><span style="min-width:0"><span class="sc-t" style="display:block">${esc(nomeSistema(c))}</span><span class="sc-s">${ct.notas} notas · ${ct.projetos} proj · ${ct.decisoes} dec${ct.pendencias ? ` · ${ct.pendencias} pend.` : ''}</span></span><span class="sc-d">→</span></button>`; }).join('');
}

/* ---------- motor 3D indisponível: a interface continua funcionando ---------- */
SC.falha3d = msg => {
  if ($('#sc-aviso3d')) return;
  const boot = $('#boot'); if (boot) boot.remove();
  document.body.classList.remove('booting');
  const fb = $('#fallback'); if (fb) fb.hidden = true;
  const el = document.createElement('div');
  el.id = 'sc-aviso3d'; el.className = 'sc-raiz';
  el.innerHTML = `<div class="sc-aviso-caixa" role="alert">${esc(msg || 'O motor 3D não carregou.')} A busca (⌘K), a lista de sistemas e os workspaces continuam funcionando. <a class="sc-link" href="Mapa do Segundo Cérebro (2D).html">Abrir a versão 2D</a></div>`;
  document.body.append(el);
  const b = $('#sc-mobile-btn'); if (b){ b.style.display = 'inline-flex'; b.click(); }
  restaurar();
};

/* ---------- atalhos de teclado ---------- */
addEventListener('keydown', e => {
  const k = e.key, topo = pilha[pilha.length - 1];
  if ((e.metaKey || e.ctrlKey) && k.toLowerCase() === 'k'){ e.preventDefault(); e.stopImmediatePropagation(); abrirPal(); return; }
  if (k === 'Escape'){
    if (menuAberto){ fecharMenu(); e.stopImmediatePropagation(); return; }
    if ($('#vozes.on') && !pilha.length) return;          // o painel de voz é do mapa
    const cfg = $('#sc-apres-cfg:not(.sc-oculto)');
    if (cfg){ cfg.classList.add('sc-oculto'); e.stopImmediatePropagation(); return; }
    e.preventDefault(); e.stopImmediatePropagation();
    if (pilha.length) return void fecharTopo();
    if (Apresentacao.ativo) return Apresentacao.parar();
    if (Insp.sel) return fecharInspector(false);
    SC.mapa.limpar();
    return;
  }
  const emCampo = e.target.closest && e.target.closest('input,textarea,select,[contenteditable="true"]');
  if (emCampo || e.metaKey || e.ctrlKey || e.altKey) return;
  if (k === '/'){ e.preventDefault(); e.stopImmediatePropagation(); abrirPal(); return; }
  if (topo && topo.tipo !== 'pagina') return;
  const atalhos = {n: () => Editor.novo({sistema: contextoSistema()}), d: () => Decisao.nova({sistema: contextoSistema()}),
    t: () => Tarefa.nova({sistema: contextoSistema()}), p: () => Apresentacao.alternar()};
  const fn = atalhos[k.toLowerCase()];
  if (fn && !(k.toLowerCase() === 'p' && WS.aberto)){ e.preventDefault(); e.stopImmediatePropagation(); fn(); }
});

/* ---------- rotas (#/sistema/Nome/aba/nota) e retomada depois de "Atualizar mapa" ---------- */
function rota(){
  const m = /^#\/sistema\/([^/]+)(?:\/([^/]+))?(?:\/(.+))?$/.exec(location.hash);
  if (!m) return false;
  const sid = decodeURIComponent(m[1]);
  if (!porCl.has(sid)) return false;
  abrirWS(sid, {aba: ABAS_WS.some(a => a[0] === m[2]) ? m[2] : 'geral', nota: m[3] ? decodeURIComponent(m[3]) : null});
  return true;
}
addEventListener('hashchange', () => { if (location.hash.startsWith('#/')) rota(); });
let restaurado = false;
function restaurar(){
  if (restaurado) return;
  restaurado = true;
  const r = SC.retomar;
  if (r){
    if (r.ws && porCl.has(r.ws.sid)) abrirWS(r.ws.sid, {aba: r.ws.aba, nota: r.ws.nota});
    else if (r.sel && r.sel.tipo === 'sistema' && porCl.has(r.sel.id)) selecionarSistema(r.sel.id);
    else if (r.sel && porId.has(r.sel.id)) selecionarNo(r.sel.id);
    if (r.msg) toast(r.msg, {tipo: 'ok', duracao: 3500});
    return;
  }
  rota();
}
SC.on('mapa-pronto', () => setTimeout(restaurar, SC.retomar ? 0 : (REDUZ ? 0 : 900)));

/* ---------- inicialização ---------- */
function iniciarUI(){
  montarInspector(); montarDica(); montarPaleta(); montarApresentacao(); montarMobile(); montarSincronia();
  ligarHUD();
  pintarSincronia();
  vigiarVault();
  if (CFG) setTimeout(carregarIndice, 2500);
  // sem o motor 3D (arquivo aberto sem internet, WebGL desligado), a interface segue sozinha
  setTimeout(() => { if (!SC.mapaAtivo && !$('#sc-aviso3d')) restaurar(); }, 9500);
  document.documentElement.classList.add(CFG ? 'sc-servidor' : 'sc-estatico');
}
iniciarUI();


/* ---------- dieta de chrome (2026-10-28): menos coisa permanente na tela, nada removido ----------
   • os chips de categoria viram um botão "CAMADAS" com popover (os chips continuam os mesmos, só ficam guardados);
   • o painel "SISTEMAS" fica recolhido só com o cabeçalho e abre ao passar o mouse, ao clicar ou com ⌘1;
   • a telemetria (DIST/AZ/FPS…) fica oculta e aparece segurando ⌥ ou fixa com ⌥T. */
function montarChromeExtra(){
  const filtros = $('#filters');
  if (filtros && !$('#sc-camadas')){
    const b = document.createElement('button');
    b.type = 'button'; b.id = 'sc-camadas'; b.className = 'hud'; b.setAttribute('aria-expanded', 'false'); b.setAttribute('aria-controls', 'filters');
    const pintar = () => {
      const chips = $$('.chip', filtros), on = chips.filter(c => c.getAttribute('aria-pressed') === 'true').length;
      b.innerHTML = `<span class="sc-cam-pontos" aria-hidden="true">${chips.filter(c => c.getAttribute('aria-pressed') === 'true').map(c => `<i style="--c:${c.style.getPropertyValue('--c')}"></i>`).join('')}</span>CAMADAS <b>${on}/${chips.length}</b>`;
    };
    const alternar = abrir => { filtros.classList.toggle('on', abrir); b.setAttribute('aria-expanded', abrir); b.classList.toggle('on', abrir); };
    b.addEventListener('click', () => alternar(!filtros.classList.contains('on')));
    filtros.addEventListener('click', () => setTimeout(pintar, 0));
    addEventListener('mousedown', e => { if (filtros.classList.contains('on') && !e.target.closest('#filters,#sc-camadas')) alternar(false); }, true);
    addEventListener('keydown', e => { if (e.key === 'Escape' && filtros.classList.contains('on')){ alternar(false); } });
    document.body.append(b);
    pintar();
    new MutationObserver(pintar).observe(filtros, {attributes: true, subtree: true, attributeFilter: ['aria-pressed']});
  }
  const indice = $('.index');
  if (indice && !indice.dataset.recolhivel){
    indice.dataset.recolhivel = '1';
    const h2 = $('h2', indice), total = $$('#index li').length;
    h2.innerHTML = `<span>SISTEMAS</span><span class="sc-idx-n">${total}</span><span class="sc-idx-seta" aria-hidden="true">›</span>`;
    h2.tabIndex = 0; h2.setAttribute('role', 'button');
    const aberto = ler('sc-sistemas-aberto', false);
    indice.classList.toggle('on', !!aberto); h2.setAttribute('aria-expanded', !!aberto);
    const alternar = v => { const on = v === undefined ? !indice.classList.contains('on') : v; indice.classList.toggle('on', on); h2.setAttribute('aria-expanded', on); gravar('sc-sistemas-aberto', on); };
    h2.addEventListener('click', () => alternar());
    h2.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); alternar(); } });
    SC.alternarSistemas = alternar;
  }
  document.body.classList.toggle('sc-telemetria', !!ler('sc-telemetria', false));
}
addEventListener('keydown', e => {
  const emCampo = e.target.closest && e.target.closest('input,textarea,select,[contenteditable="true"]');
  if (e.key === 'Alt' && !e.repeat) document.body.classList.add('sc-alt');
  if (emCampo) return;
  if (e.altKey && !e.metaKey && !e.ctrlKey && (e.code === 'KeyT')){ e.preventDefault(); const v = !document.body.classList.contains('sc-telemetria'); document.body.classList.toggle('sc-telemetria', v); gravar('sc-telemetria', v); }
  if ((e.metaKey || e.ctrlKey) && !e.altKey && e.code === 'Digit1' && SC.alternarSistemas){ e.preventDefault(); SC.alternarSistemas(); }
}, true);
addEventListener('keyup', e => { if (e.key === 'Alt') document.body.classList.remove('sc-alt'); }, true);
addEventListener('blur', () => document.body.classList.remove('sc-alt'));
SC.on('mapa-pronto', montarChromeExtra);
