/* Campos próprios (ui/45-campos.css): trocam, só no visual, o <select> e o <input type="date"> nativos por componentes do app.
   O elemento nativo continua no DOM (name, id, value, eventos, .focus()) escondido; um botão .sc-sel / .sc-data entra logo depois dele
   e abre uma lista (select) ou um calendário (data) em position:fixed. Os formulários seguem lendo .value e escutando "change"/"input".
   Um MutationObserver no <body> veste qualquer campo novo dentro de .sc-raiz (modais, workspace, inspector); campos com [data-sc-nativo] ficam como estão.
   Tudo vive num IIFE: a única coisa exposta é SC.campos.vestir(raiz), para vestir um container manualmente. */
;(() => {
  'use strict';

  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const SEL_NATIVO = 'select:not([data-sc-nativo])';
  const DATA_NATIVA = 'input[type="date"]:not([data-sc-nativo])';
  const LIMITE_BUSCA = 8;      // acima disto a lista ganha o campo de busca
  const MARGEM = 8;            // distância mínima da borda da janela
  const FOLGA = 4;             // espaço entre o botão e a lista
  const SETA = '<svg class="sc-sel-seta" viewBox="0 0 10 6" width="10" height="6" aria-hidden="true" focusable="false"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>';
  const ICONE_CAL = '<svg class="sc-data-ico" viewBox="0 0 14 14" width="14" height="14" aria-hidden="true" focusable="false"><path d="M1.5 3h11v9.5h-11zM1.5 6h11M4.5 1.5v3M9.5 1.5v3" fill="none" stroke="currentColor" stroke-width="1"/></svg>';

  let seq = 0;                 // gerador de ids
  let aberto = null;           // popup atual: {botao, el, tecla(e), posicionar()} — só existe um por vez
  let espacoEm = -1e9;         // quando o Espaço escolheu algo (o keyup dele cairia no botão e reabriria a lista)
  let ligado = false;
  let rafPos = 0;
  let ponteiro = {x: -1, y: -1};

  /* ---------------------------------------------------------------- utilidades */
  const agora = () => performance.now();
  const parar = e => { e.preventDefault(); e.stopImmediatePropagation(); };
  const limitar = (n, a, b) => Math.max(a, Math.min(b, n));

  // nome acessível do campo: aria-label do nativo ou o texto do <label for>
  function nomeDe(el){
    let t = el.getAttribute('aria-label') || '';
    if (!t){
      const rot = el.labels && el.labels[0];
      if (rot && !rot.contains(el)) t = rot.textContent;
    }
    return t.replace(/\s*\*\s*$/, '').replace(/\s+/g, ' ').trim();
  }

  // datas sempre em horário local (ao meio-dia, para não cair em saltos de horário de verão)
  const mk = (a, m, d) => { const x = new Date(2000, 0, 1, 12); x.setFullYear(a, m, d); return x; };
  const isoDe = x => `${String(x.getFullYear()).padStart(4, '0')}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}`;
  const partes = x => ({a: x.getFullYear(), m: x.getMonth(), d: x.getDate()});
  const isoPartes = p => isoDe(mk(p.a, p.m, p.d));
  const normalizar = p => partes(mk(p.a, p.m, p.d));
  function analisar(s){
    const mt = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    if (!mt) return null;
    const a = +mt[1], m = +mt[2] - 1, d = +mt[3], x = mk(a, m, d);
    return x.getFullYear() === a && x.getMonth() === m && x.getDate() === d ? {a, m, d} : null;
  }

  /* ---------------------------------------------------------------- escuta global enquanto há popup aberto */
  function ligar(){
    if (ligado) return;
    ligado = true;
    addEventListener('keydown', aoTecla, true);                 // antes do trap de foco dos modais e do Esc do shell
    document.addEventListener('pointerdown', aoPonteiro, true);
    document.addEventListener('focusin', aoFoco, true);
    document.addEventListener('scroll', aoRolar, true);
    addEventListener('resize', reposicionar);
  }
  function desligar(){
    if (!ligado) return;
    ligado = false;
    removeEventListener('keydown', aoTecla, true);
    document.removeEventListener('pointerdown', aoPonteiro, true);
    document.removeEventListener('focusin', aoFoco, true);
    document.removeEventListener('scroll', aoRolar, true);
    removeEventListener('resize', reposicionar);
    if (rafPos){ cancelAnimationFrame(rafPos); rafPos = 0; }
  }
  function aoTecla(e){
    if (!aberto || e.isComposing) return;
    aberto.tecla(e);
  }
  function aoPonteiro(e){
    if (!aberto) return;
    const t = e.target;
    if (aberto.el.contains(t) || aberto.botao.contains(t)) return;
    const veu = t.closest && t.closest('.sc-veu');
    fechar(false);
    if (veu){
      // clicar fora só dispensa a lista; não deixa o clique fechar o modal junto
      const engolir = ev => { ev.stopPropagation(); ev.preventDefault(); };
      addEventListener('click', engolir, {capture: true, once: true});
      setTimeout(() => removeEventListener('click', engolir, true), 600);
    }
  }
  function aoFoco(e){
    if (!aberto) return;
    const t = e.target;
    if (aberto.el.contains(t) || aberto.botao === t) return;
    fechar(false);
  }
  function aoRolar(e){
    if (aberto && !aberto.el.contains(e.target)) reposicionar();
  }
  function reposicionar(){
    if (rafPos || !aberto) return;
    rafPos = requestAnimationFrame(() => {
      rafPos = 0;
      if (!aberto) return;
      const r = aberto.botao.getBoundingClientRect();
      if (!aberto.botao.isConnected || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return fechar(false);
      aberto.posicionar();
    });
  }

  function fechar(devolverFoco){
    const a = aberto;
    if (!a) return;
    aberto = null;
    desligar();
    a.botao.setAttribute('aria-expanded', 'false');
    a.el.remove();
    if (devolverFoco && a.botao.isConnected && !a.botao.disabled) a.botao.focus({preventScroll: true});
  }

  // posiciona o popup abaixo do botão (ou acima, se não couber); modo: 'igual' (mesma largura), 'min' (largura mínima) ou 'livre'
  function posicionar(pop, ancora, modo){
    const r = ancora.getBoundingClientRect();
    pop.style.top = pop.style.bottom = pop.style.maxHeight = '';
    pop.style.left = '0px'; pop.style.top = '0px';
    pop.style.width = modo === 'igual' ? r.width + 'px' : '';
    pop.style.minWidth = modo === 'min' ? r.width + 'px' : '';
    const w = pop.offsetWidth, h = pop.offsetHeight;
    const abaixo = innerHeight - r.bottom - FOLGA - MARGEM, acima = r.top - FOLGA - MARGEM;
    const sobe = h > abaixo && acima > abaixo;
    pop.style.maxHeight = Math.max(120, sobe ? acima : abaixo) + 'px';
    pop.style.left = Math.max(MARGEM, Math.min(r.left, innerWidth - w - MARGEM)) + 'px';
    if (sobe){ pop.style.top = ''; pop.style.bottom = (innerHeight - r.top + FOLGA) + 'px'; }
    else pop.style.top = (r.bottom + FOLGA) + 'px';
    pop.classList.toggle('acima', sobe);
  }

  /* ---------------------------------------------------------------- base comum: esconder o nativo e inserir o botão */
  function esconder(nativo, classe, botao){
    nativo.classList.add(classe);
    nativo.tabIndex = -1;
    nativo.setAttribute('aria-hidden', 'true');
    nativo.after(botao);
    const pai = nativo.parentElement;
    if (pai && getComputedStyle(pai).position === 'static') pai.classList.add('sc-ancora-nativo');
    // o código chama nativo.focus() na validação: o foco vai para o botão
    nativo.addEventListener('focus', () => { if (!botao.disabled) botao.focus(); });
  }
  // value/selectedIndex atribuídos por código não disparam evento: o setter da instância também atualiza o botão
  function acompanhar(nativo, proto, props, sinc){
    props.forEach(nome => {
      const d = Object.getOwnPropertyDescriptor(proto, nome);
      if (!d || !d.get || !d.set) return;
      Object.defineProperty(nativo, nome, {
        configurable: true, enumerable: d.enumerable,
        get(){ return d.get.call(this); },
        set(v){ d.set.call(this, v); sinc(); }
      });
    });
  }
  function espelharEstado(nativo, botao){
    if (nativo.getAttribute('aria-invalid') === 'true') botao.setAttribute('aria-invalid', 'true');
    else botao.removeAttribute('aria-invalid');
    botao.disabled = nativo.matches(':disabled');
    if (botao.disabled && aberto && aberto.botao === botao) fechar(false);
  }
  function observar(nativo, sinc, opcoes){
    new MutationObserver(sinc).observe(nativo, {attributes: true, attributeFilter: ['disabled', 'hidden', 'aria-invalid', 'aria-label', 'required', 'readonly', 'min', 'max', 'value', 'label', 'selected'], ...opcoes});
    if (nativo.form) nativo.form.addEventListener('reset', () => setTimeout(sinc, 0));
  }

  /* ---------------------------------------------------------------- SELECT */
  function vestirSelect(sel){
    if (sel.classList.contains('sc-sel-nativo') || sel.hasAttribute('data-sc-nativo')) return;
    if (sel.multiple || sel.size > 1 || !sel.parentNode) return;
    const mini = sel.classList.contains('sc-select-mini');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sc-sel' + (mini ? ' mini' : '');
    btn.id = 'sc-sel-' + (++seq);
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = '<span class="sc-sel-txt"></span>' + SETA;
    const rot = btn.firstChild;
    const st = sel.style;
    if (st.flex){ btn.style.flex = st.flex; btn.style.minWidth = st.minWidth || '0'; btn.dataset.fixo = '1'; }
    if (st.width) btn.style.width = st.width;
    if (st.maxWidth) btn.style.maxWidth = st.maxWidth;

    const sinc = () => {
      const op = sel.selectedIndex >= 0 ? sel.options[sel.selectedIndex] : null;
      const txt = op ? (op.text || '').trim() : '';
      if (rot.textContent !== (txt || '—')) rot.textContent = txt || '—';
      btn.classList.toggle('vazio', !op || op.value === '');
      const nome = nomeDe(sel);
      btn.setAttribute('aria-label', nome ? `${nome}: ${txt || 'nenhum'}` : (txt || 'Selecionar'));
      espelharEstado(sel, btn);
      if (mini && !btn.dataset.fixo){
        // largura estável: a do maior rótulo (a fonte é mono, então ch é exato)
        const n = Math.min(26, Math.max(4, ...Array.from(sel.options, o => (o.text || '').trim().length)));
        btn.style.minWidth = `calc(${n}ch + ${(n * 0.08).toFixed(2)}em + 38px)`;
      }
    };

    sinc();                         // estado inicial antes de entrar no DOM (sem transição de opacity no primeiro desenho)
    esconder(sel, 'sc-sel-nativo', btn);
    acompanhar(sel, HTMLSelectElement.prototype, ['value', 'selectedIndex'], sinc);
    observar(sel, sinc, {childList: true, subtree: true, characterData: true});
    sel.addEventListener('change', sinc);
    btn.addEventListener('click', e => {
      if (e.detail === 0 && agora() - espacoEm < 350) return;   // keyup do Espaço logo depois de escolher
      abrirSelect(sel, btn, sinc, true);
    });
    btn.addEventListener('keydown', e => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp'){ e.preventDefault(); abrirSelect(sel, btn, sinc, false); }
    });
    sinc();
    requestAnimationFrame(sinc);   // primeira pintura (modal acabou de abrir)
  }

  // lê select.options na hora de abrir (o código repovoa o select), com optgroup e opções desabilitadas
  function coletar(sel){
    const lista = [];
    const add = (op, grupo, grupoOff) => {
      if (op.hidden) return;
      lista.push({op, texto: (op.text || '').trim() || op.value, grupo, desab: op.disabled || grupoOff, sel: op.selected});
    };
    Array.from(sel.children).forEach(c => {
      if (c.tagName === 'OPTION') add(c, '', false);
      else if (c.tagName === 'OPTGROUP') Array.from(c.children).forEach(o => { if (o.tagName === 'OPTION') add(o, c.label || '', c.disabled); });
    });
    return lista;
  }

  function abrirSelect(sel, btn, sinc, alternar){
    if (aberto && aberto.botao === btn){ if (alternar) fechar(true); return; }
    fechar(false);
    sinc();
    if (btn.disabled) return;
    const dados = coletar(sel);
    const id = 'sc-lst-' + (++seq);
    const mini = btn.classList.contains('mini');
    const comBusca = dados.length > LIMITE_BUSCA;
    const nome = nomeDe(sel);

    const pop = document.createElement('div');
    pop.className = 'sc-lst sc-raiz' + (mini ? ' mini' : '') + (REDUZ ? ' sem-mov' : '');
    pop.id = id;
    pop.innerHTML = (comBusca
      ? `<div class="sc-lst-busca"><span aria-hidden="true">›</span><input type="text" role="combobox" aria-expanded="true" aria-controls="${id}-rol" aria-autocomplete="list" aria-label="Filtrar opções" placeholder="Filtrar…" autocomplete="off" spellcheck="false"></div>`
      : '') + `<div class="sc-lst-rol" id="${id}-rol" role="listbox" tabindex="-1" aria-label="${esc(nome || 'Opções')}"></div>`;
    const rol = pop.querySelector('.sc-lst-rol'), busca = pop.querySelector('input'), alvoFoco = busca || rol;

    let q = '', cursor = -1, buffer = '', tBuffer = 0;
    const visiveis = () => {
      const t = sem(q.trim());
      return dados.map((d, k) => ({d, k})).filter(x => !t || sem(x.d.texto).includes(t));
    };
    const habilitados = () => visiveis().filter(x => !x.d.desab).map(x => x.k);
    const elDe = k => rol.querySelector(`[data-k="${k}"]`);

    function pintar(){
      const vis = visiveis();
      if (!vis.length){ rol.innerHTML = '<div class="sc-lst-vazio" role="presentation">Nada encontrado</div>'; return; }
      let html = '', grupo = '';
      vis.forEach(({d, k}) => {
        if (d.grupo !== grupo){
          if (grupo) html += '</div>';
          grupo = d.grupo;
          if (grupo) html += `<div role="group" aria-label="${esc(grupo)}"><div class="sc-op-grupo" aria-hidden="true">${esc(grupo)}</div>`;
        }
        html += `<div class="sc-op${k === cursor ? ' ativo' : ''}" role="option" id="${id}-o${k}" data-k="${k}" aria-selected="${d.sel}"${d.desab ? ' aria-disabled="true"' : ''}>${esc(d.texto)}</div>`;
      });
      if (grupo) html += '</div>';
      rol.innerHTML = html;
    }
    function revelar(el){
      if (!el) return;
      const topo = el.offsetTop, base = topo + el.offsetHeight;
      if (topo < rol.scrollTop) rol.scrollTop = Math.max(0, topo - 4);
      else if (base > rol.scrollTop + rol.clientHeight) rol.scrollTop = base - rol.clientHeight + 4;
    }
    function marcar(k, rolar = true){
      const antigo = elDe(cursor);
      if (antigo) antigo.classList.remove('ativo');
      cursor = k;
      const el = k >= 0 ? elDe(k) : null;
      if (el){ el.classList.add('ativo'); alvoFoco.setAttribute('aria-activedescendant', el.id); if (rolar) revelar(el); }
      else alvoFoco.removeAttribute('aria-activedescendant');
    }
    function mover(delta){
      const hab = habilitados();
      if (!hab.length) return;
      const i = hab.indexOf(cursor);
      marcar(hab[limitar(i < 0 ? (delta > 0 ? 0 : hab.length - 1) : i + delta, 0, hab.length - 1)]);
    }
    function digitar(c){
      clearTimeout(tBuffer);
      buffer += c;
      tBuffer = setTimeout(() => { buffer = ''; }, 650);
      const hab = habilitados();
      if (!hab.length) return;
      const repetida = buffer.split('').every(x => x === buffer[0]);   // "aaa" circula entre as opções que começam com "a"
      const alvo = sem(repetida ? buffer[0] : buffer);
      const i = Math.max(0, hab.indexOf(cursor));
      const ordem = repetida ? [...hab.slice(i + 1), ...hab.slice(0, i + 1)] : [...hab.slice(i), ...hab.slice(0, i)];
      const achou = ordem.find(k => sem(dados[k].texto).startsWith(alvo));
      if (achou !== undefined) marcar(achou);
    }
    function escolher(k){
      const d = dados[k];
      if (!d || d.desab) return;
      const antes = sel.selectedIndex;
      sel.value = d.op.value;
      if (sel.selectedIndex !== d.op.index) sel.selectedIndex = d.op.index;
      const mudou = sel.selectedIndex !== antes;
      fechar(true);
      sinc();
      if (mudou){
        sel.dispatchEvent(new Event('input', {bubbles: true}));
        sel.dispatchEvent(new Event('change', {bubbles: true}));
      }
    }
    function tecla(e){
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      switch (e.key){
        case 'Escape': parar(e); fechar(true); return;
        case 'Tab': fechar(true); return;                       // deixa o Tab seguir a partir do botão
        case 'ArrowDown': parar(e); mover(1); return;
        case 'ArrowUp': parar(e); mover(-1); return;
        case 'PageDown': parar(e); mover(8); return;
        case 'PageUp': parar(e); mover(-8); return;
        case 'Home': case 'End': {
          if (busca && busca.value) return;                     // com texto digitado, Home/End movem o cursor do campo
          parar(e);
          const hab = habilitados();
          if (hab.length) marcar(e.key === 'Home' ? hab[0] : hab[hab.length - 1]);
          return;
        }
        case 'Enter':
          parar(e);
          if (e.repeat) return;
          if (cursor >= 0) escolher(cursor); else fechar(true);
          return;
        case ' ':
          if (busca){ e.stopImmediatePropagation(); return; }
          parar(e);
          if (buffer) digitar(' ');
          else if (!e.repeat && cursor >= 0){ espacoEm = agora(); escolher(cursor); }
          return;
        default:
          if (e.key.length !== 1) return;
          if (busca){ e.stopImmediatePropagation(); return; }   // o campo de busca recebe a letra
          parar(e);
          digitar(e.key);
      }
    }

    rol.addEventListener('mousedown', e => { if (e.target.closest('.sc-op')) e.preventDefault(); });
    rol.addEventListener('click', e => { const o = e.target.closest('.sc-op'); if (o) escolher(+o.dataset.k); });
    rol.addEventListener('pointermove', e => {
      if (e.clientX === ponteiro.x && e.clientY === ponteiro.y) return;   // rolagem por teclado não rouba o cursor
      ponteiro = {x: e.clientX, y: e.clientY};
      const o = e.target.closest('.sc-op');
      if (o && o.getAttribute('aria-disabled') !== 'true' && +o.dataset.k !== cursor) marcar(+o.dataset.k, false);
    });
    if (busca) busca.addEventListener('input', () => {
      q = busca.value;
      cursor = -1;
      pintar();
      const hab = habilitados();
      marcar(hab.length ? hab[0] : -1);
    });

    document.body.append(pop);
    aberto = {botao: btn, el: pop, tecla, posicionar: () => posicionar(pop, btn, mini ? 'min' : 'igual')};
    btn.setAttribute('aria-expanded', 'true');
    ligar();
    const atual = dados.findIndex(d => d.sel && !d.desab);
    cursor = atual >= 0 ? atual : dados.findIndex(d => !d.desab);
    pintar();
    aberto.posicionar();
    marcar(cursor);
    alvoFoco.focus({preventScroll: true});
  }

  /* ---------------------------------------------------------------- DATA */
  function vestirData(inp){
    if (inp.classList.contains('sc-data-nativo') || inp.hasAttribute('data-sc-nativo') || !inp.parentNode) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sc-data';
    btn.id = 'sc-data-' + (++seq);
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = '<span class="sc-data-txt"></span>' + ICONE_CAL;
    const rot = btn.firstChild;

    const sinc = () => {
      const ok = !!analisar(inp.value);
      const txt = ok ? dataCurta(inp.value) : '— sem data —';
      if (rot.textContent !== txt) rot.textContent = txt;
      btn.classList.toggle('vazio', !ok);
      const nome = nomeDe(inp);
      btn.setAttribute('aria-label', (nome ? nome + ': ' : '') + (ok ? txt : 'sem data'));
      espelharEstado(inp, btn);
      if (inp.readOnly) btn.disabled = true;
    };

    sinc();
    esconder(inp, 'sc-data-nativo', btn);
    acompanhar(inp, HTMLInputElement.prototype, ['value'], sinc);
    observar(inp, sinc, {});
    inp.addEventListener('change', sinc);
    inp.addEventListener('input', sinc);
    btn.addEventListener('click', e => {
      if (e.detail === 0 && agora() - espacoEm < 350) return;
      abrirData(inp, btn, sinc, true);
    });
    btn.addEventListener('keydown', e => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp'){ e.preventDefault(); abrirData(inp, btn, sinc, false); }
    });
    sinc();
    requestAnimationFrame(sinc);
  }

  function abrirData(inp, btn, sinc, alternar){
    if (aberto && aberto.botao === btn){ if (alternar) fechar(true); return; }
    fechar(false);
    sinc();
    if (btn.disabled) return;
    const id = 'sc-cal-' + (++seq);
    const nome = nomeDe(inp);
    const min = analisar(inp.min) ? inp.min : '', max = analisar(inp.max) ? inp.max : '';
    const obrigatorio = inp.required;
    const fora = iso => (min && iso < min) || (max && iso > max);
    let foco = analisar(inp.value) || analisar(hojeISO());

    const pop = document.createElement('div');
    pop.className = 'sc-cal sc-raiz' + (REDUZ ? ' sem-mov' : '');
    pop.id = id;
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', nome ? `${nome}: escolher data` : 'Escolher data');
    pop.innerHTML = `<div class="sc-cal-cab">
        <button type="button" class="sc-cal-nav" data-nav="-1" tabindex="-1" aria-label="Mês anterior">‹</button>
        <div class="sc-cal-titulo" id="${id}-t" aria-live="polite"></div>
        <button type="button" class="sc-cal-nav" data-nav="1" tabindex="-1" aria-label="Próximo mês">›</button>
      </div>
      <div class="sc-cal-sem" aria-hidden="true">${['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map(x => `<span>${x}</span>`).join('')}</div>
      <div class="sc-cal-grade" role="grid" tabindex="-1" aria-labelledby="${id}-t"></div>
      <div class="sc-cal-rodape">
        <button type="button" class="sc-cal-atalho" data-atalho="hoje" tabindex="-1" aria-keyshortcuts="H">Hoje</button>
        <button type="button" class="sc-cal-atalho" data-atalho="ontem" tabindex="-1" aria-keyshortcuts="O">Ontem</button>
        ${obrigatorio ? '' : '<button type="button" class="sc-cal-atalho limpar" data-atalho="limpar" tabindex="-1" aria-keyshortcuts="Delete">Limpar</button>'}
      </div>`;
    const titulo = pop.querySelector('.sc-cal-titulo'), grade = pop.querySelector('.sc-cal-grade');
    const bHoje = pop.querySelector('[data-atalho="hoje"]'), bOntem = pop.querySelector('[data-atalho="ontem"]'), bLimpar = pop.querySelector('[data-atalho="limpar"]');

    const isoHoje = () => hojeISO();
    const isoOntem = () => { const h = analisar(hojeISO()); return isoDe(mk(h.a, h.m, h.d - 1)); };

    function pintar(){
      const valor = inp.value, hoje = isoHoje(), cursor = isoPartes(foco);
      titulo.textContent = `${MESES[foco.m]} ${foco.a}`;
      const deslocamento = -mk(foco.a, foco.m, 1).getDay();       // a semana começa no domingo
      let linhas = '';
      for (let l = 0; l < 6; l++){
        let celulas = '';
        for (let c = 0; c < 7; c++){
          const x = mk(foco.a, foco.m, 1 + deslocamento + l * 7 + c), iso = isoDe(x);
          const cls = ['sc-cal-dia'];
          if (x.getMonth() !== foco.m) cls.push('fora');
          if (iso === hoje) cls.push('hoje');
          if (iso === valor) cls.push('sel');
          if (iso === cursor) cls.push('foco');
          celulas += `<button type="button" role="gridcell" tabindex="-1" class="${cls.join(' ')}" id="${id}-d${iso}" data-iso="${iso}" aria-label="${x.getDate()} de ${MESES[x.getMonth()]} de ${x.getFullYear()}"${iso === valor ? ' aria-selected="true"' : ''}${iso === hoje ? ' aria-current="date"' : ''}${fora(iso) ? ' aria-disabled="true"' : ''}>${x.getDate()}</button>`;
        }
        linhas += `<div class="sc-cal-linha" role="row">${celulas}</div>`;
      }
      grade.innerHTML = linhas;
      grade.setAttribute('aria-activedescendant', `${id}-d${cursor}`);
      bHoje.disabled = !!fora(hoje);
      bOntem.disabled = !!fora(isoOntem());
      if (bLimpar) bLimpar.disabled = !analisar(valor);
    }
    function mudarMes(n){
      const alvo = mk(foco.a, foco.m + n, 1), dias = mk(alvo.getFullYear(), alvo.getMonth() + 1, 0).getDate();
      foco = {a: alvo.getFullYear(), m: alvo.getMonth(), d: Math.min(foco.d, dias)};
    }
    function escolher(iso){
      if (iso && fora(iso)) return;
      const antes = inp.value;
      inp.value = iso;
      const mudou = inp.value !== antes;
      sinc();
      if (mudou){
        inp.dispatchEvent(new Event('input', {bubbles: true}));
        inp.dispatchEvent(new Event('change', {bubbles: true}));
      }
      fechar(true);
    }
    function tecla(e){
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const passo = {ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7}[e.key];
      if (passo){
        parar(e); pop.classList.add('teclado');
        foco = normalizar({a: foco.a, m: foco.m, d: foco.d + passo});
        pintar();
        return;
      }
      switch (e.key){
        case 'PageUp': case 'PageDown':
          parar(e); pop.classList.add('teclado');
          mudarMes((e.key === 'PageDown' ? 1 : -1) * (e.shiftKey ? 12 : 1));
          pintar();
          return;
        case 'Home': case 'End': {
          parar(e); pop.classList.add('teclado');
          const dow = mk(foco.a, foco.m, foco.d).getDay();
          foco = normalizar({a: foco.a, m: foco.m, d: foco.d + (e.key === 'Home' ? -dow : 6 - dow)});
          pintar();
          return;
        }
        case 'Enter': case ' ':
          parar(e);
          if (!e.repeat){ espacoEm = agora(); escolher(isoPartes(foco)); }
          return;
        case 'Escape': parar(e); fechar(true); return;
        case 'Tab': fechar(true); return;
        case 'Delete': case 'Backspace':
          parar(e);
          if (!obrigatorio) escolher('');
          return;
        default:
          if (e.key.length !== 1) return;
          parar(e);                                              // letras não podem disparar os atalhos do app
          if (e.key.toLowerCase() === 'h') escolher(isoHoje());
          else if (e.key.toLowerCase() === 'o') escolher(isoOntem());
      }
    }

    pop.addEventListener('mousedown', e => e.preventDefault());   // o foco fica na grade
    pop.addEventListener('click', e => {
      const dia = e.target.closest('[data-iso]');
      if (dia){ if (dia.getAttribute('aria-disabled') !== 'true') escolher(dia.dataset.iso); return; }
      const nav = e.target.closest('[data-nav]');
      if (nav){ mudarMes(+nav.dataset.nav); pintar(); return; }
      const at = e.target.closest('[data-atalho]');
      if (!at || at.disabled) return;
      if (at.dataset.atalho === 'hoje') escolher(isoHoje());
      else if (at.dataset.atalho === 'ontem') escolher(isoOntem());
      else escolher('');
    });

    document.body.append(pop);
    aberto = {botao: btn, el: pop, tecla, posicionar: () => posicionar(pop, btn, 'livre')};
    btn.setAttribute('aria-expanded', 'true');
    ligar();
    pintar();
    aberto.posicionar();
    grade.focus({preventScroll: true});
  }

  /* ---------------------------------------------------------------- vestir o que existe e o que chegar */
  function varrer(no, forcar){
    if (!no || no.nodeType !== 1 || !no.isConnected) return;
    const achar = seletor => {
      const lista = no.matches(seletor) ? [no] : [];
      no.querySelectorAll(seletor).forEach(x => lista.push(x));
      return lista;
    };
    const vale = el => forcar || !!el.closest('.sc-raiz');
    achar(SEL_NATIVO).forEach(s => { if (vale(s)) vestirSelect(s); });
    achar(DATA_NATIVA).forEach(i => { if (vale(i)) vestirData(i); });
  }

  const observador = new MutationObserver(registros => {
    if (aberto && !aberto.botao.isConnected) fechar(false);     // o modal fechou com a lista aberta
    for (const r of registros) r.addedNodes.forEach(n => varrer(n, false));
  });
  function iniciar(){
    varrer(document.body, false);
    observador.observe(document.body, {childList: true, subtree: true});
  }
  if (document.body) iniciar();
  else document.addEventListener('DOMContentLoaded', iniciar, {once: true});

  SC.campos = {vestir: raiz => varrer(raiz || document.body, true)};
})();
