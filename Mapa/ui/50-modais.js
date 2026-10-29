/* Modais: nota, decisão, tarefa, projeto/sistema, processo, link, pessoa, prompts, versões e confirmações.
   Todos gravam pelos modelos oficiais do vault (99 - SISTEMA/Templates) através do servidor local. */

/* ---------- utilidades de formulário ---------- */
const hubDe = sid => { const c = porCl.get(sid); return c && c.hub ? c.hub : ''; };
function opcoesSistemas(sel, {vazio = false} = {}){
  return (vazio ? '<option value="">— nenhum —</option>' : '') + sistemasOrdenados().map(c => `<option value="${esc(c.id)}" ${c.id === sel ? 'selected' : ''}>${esc(nomeSistema(c))}</option>`).join('');
}
function opcoesProjetos(sid, sel, vazio = '— nenhum —'){
  return `<option value="">${vazio}</option>` + projetosDe(sid).map(n => `<option value="${esc(n.id)}" ${n.id === sel ? 'selected' : ''}>${esc(n.id)}</option>`).join('');
}
function campo(id, rotulo, html, {obrig = false, msg = ''} = {}){
  return `<div class="sc-campo" data-campo="${id}"><label for="${id}">${rotulo}${obrig ? ' <span class="sc-obrig">*</span>' : ''}</label>${html}<div class="sc-msg" id="${id}-msg">${msg}</div></div>`;
}
function marcarErro(m, campoId, msg){
  const caixa = $(`[data-campo="${campoId}"]`, m.el);
  if (!caixa){ statusRodape(m, msg, 'erro'); return; }
  const entrada = $('input,select,textarea', caixa), aviso = $('.sc-msg', caixa);
  entrada && entrada.setAttribute('aria-invalid', 'true');
  if (aviso){ aviso.dataset.original = aviso.dataset.original ?? aviso.innerHTML; aviso.innerHTML = msg; aviso.classList.add('erro'); }
  entrada && entrada.focus();
}
function limparErros(m){
  $$('[aria-invalid="true"]', m.el).forEach(x => x.removeAttribute('aria-invalid'));
  $$('.sc-msg.erro', m.el).forEach(x => { x.classList.remove('erro'); x.innerHTML = x.dataset.original || ''; });
  statusRodape(m, '');
}
function statusRodape(m, texto, tipo = ''){ const s = $('.sc-status', m.el); if (s){ s.textContent = texto; s.className = 'sc-status ' + tipo; } }
function ocupado(botao, sim, rotulo){
  if (!botao) return;
  if (sim){ botao.dataset.rotulo = botao.innerHTML; botao.disabled = true; botao.innerHTML = `<span class="sc-gira"></span>${rotulo || 'Salvando'}`; }
  else { botao.disabled = false; if (botao.dataset.rotulo) botao.innerHTML = botao.dataset.rotulo; }
}
function tratarErroForm(m, e, {campoPadrao} = {}){
  if (e.codigo === 'conflito') return false;
  const c = (e.dados && e.dados.campo) || campoPadrao;
  if (c && (e.codigo === 'validacao' || e.codigo === 'duplicado')) marcarErro(m, c, esc(e.message) + (e.dados && e.dados.existente ? ` <button type="button" class="sc-link" data-existente="${esc(e.dados.existente)}">Abrir a existente</button>` : ''));
  statusRodape(m, e.codigo === 'offline' ? 'Servidor indisponível — nada foi perdido, tente de novo.' : 'Não foi salvo: ' + e.message, 'erro');
  const ex = $('[data-existente]', m.el);
  if (ex) ex.addEventListener('click', () => { m.fechar(true); SC.abrirNota(ex.dataset.existente); });
  return true;
}
const valorForm = m => Object.fromEntries($$('[name]', m.el).map(x => [x.name, x.type === 'checkbox' ? x.checked : x.value]));
function sujo(m, base){ return JSON.stringify(valorForm(m)) !== base; }
const descartar = () => confirmar({rotulo: 'ALTERAÇÕES NÃO SALVAS', titulo: 'Descartar o que você escreveu?', texto: 'As alterações deste formulário ainda não foram salvas no vault.', sim: 'Descartar', nao: 'Continuar editando', perigo: true});
function sugestoesNotas(q, limite = 8){
  const t = sem(q);
  const lista = [...nos.map(n => ({id: n.id, tipo: n.tipo})), ...[...nomesExtras].map(x => ({id: x, tipo: 'central'}))];
  return lista.map(n => ({n, i: sem(n.id).indexOf(t)})).filter(x => !t || x.i >= 0).sort((a, b) => (a.i - b.i) || a.n.id.localeCompare(b.n.id)).slice(0, limite).map(x => x.n);
}
function inserir(ta, texto, {selecionar = 0} = {}){
  const a = ta.selectionStart, b = ta.selectionEnd;
  ta.setRangeText(texto, a, b, 'end');
  if (selecionar) ta.setSelectionRange(a + texto.length - selecionar, a + texto.length);
  ta.focus(); ta.dispatchEvent(new Event('input', {bubbles: true}));
}
function envolver(ta, antes, depois, padrao){
  const a = ta.selectionStart, b = ta.selectionEnd, sel = ta.value.slice(a, b) || padrao;
  ta.setRangeText(antes + sel + depois, a, b, 'select');
  ta.setSelectionRange(a + antes.length, a + antes.length + sel.length);
  ta.focus(); ta.dispatchEvent(new Event('input', {bubbles: true}));
}
function prefixar(ta, prefixo){
  const v = ta.value, a = v.lastIndexOf('\n', ta.selectionStart - 1) + 1, b = ta.selectionEnd;
  const bloco = v.slice(a, b).split('\n').map(l => prefixo + l).join('\n');
  ta.setRangeText(bloco, a, b, 'end'); ta.focus(); ta.dispatchEvent(new Event('input', {bubbles: true}));
}
/* autocompletar [[links]] e Markdown no textarea */
function ligarEditorMarkdown(m, ta, prev){
  const caixa = document.createElement('div');
  caixa.className = 'sc-sugestoes sc-oculto'; caixa.setAttribute('role', 'listbox');
  ta.parentElement.append(caixa);
  let sug = [], sel = 0, inicio = -1;
  const fechar = () => { caixa.classList.add('sc-oculto'); sug = []; inicio = -1; };
  const pintar = () => { caixa.innerHTML = sug.map((n, i) => `<button type="button" role="option" aria-selected="${i === sel}" data-i="${i}"><span>${esc(n.id)}</span><small>${esc(tipoDe(n.tipo).rot)}</small></button>`).join(''); };
  const escolher = i => {
    const n = sug[i]; if (!n) return;
    const fim = ta.selectionStart;
    ta.setRangeText(`[[${n.id}]]`, inicio, fim, 'end');
    fechar(); ta.focus(); ta.dispatchEvent(new Event('input', {bubbles: true}));
  };
  ta.addEventListener('input', () => {
    const antes = ta.value.slice(0, ta.selectionStart), mt = /\[\[([^\]\n|#]{0,60})$/.exec(antes);
    if (!mt){ fechar(); return; }
    inicio = ta.selectionStart - mt[0].length;
    sug = sugestoesNotas(mt[1]); sel = 0;
    if (!sug.length){ fechar(); return; }
    pintar(); caixa.classList.remove('sc-oculto');
  });
  ta.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && /^[bi]$/i.test(e.key)){ e.preventDefault(); envolver(ta, e.key.toLowerCase() === 'b' ? '**' : '*', e.key.toLowerCase() === 'b' ? '**' : '*', 'texto'); return; }
    if (caixa.classList.contains('sc-oculto')) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp'){ e.preventDefault(); sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + sug.length) % sug.length; pintar(); }
    else if (e.key === 'Enter' || e.key === 'Tab'){ e.preventDefault(); escolher(sel); }
    else if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); fechar(); }
  });
  caixa.addEventListener('mousedown', e => { const b = e.target.closest('[data-i]'); if (b){ e.preventDefault(); escolher(+b.dataset.i); } });
  ta.addEventListener('blur', () => setTimeout(fechar, 150));
  $$('[data-md]', m.el).forEach(b => b.addEventListener('click', () => {
    const a = b.dataset.md;
    if (a === 'negrito') envolver(ta, '**', '**', 'texto');
    if (a === 'italico') envolver(ta, '*', '*', 'texto');
    if (a === 'titulo') prefixar(ta, '## ');
    if (a === 'lista') prefixar(ta, '- ');
    if (a === 'tarefa') prefixar(ta, '- [ ] ');
    if (a === 'codigo') envolver(ta, '`', '`', 'código');
    if (a === 'wiki'){ inserir(ta, '[['); }
    if (a === 'link') envolver(ta, '[', '](https://)', 'texto');
  }));
  const seg = $$('[data-modo]', m.el);
  seg.forEach(b => b.addEventListener('click', () => {
    const ver = b.dataset.modo === 'ver';
    seg.forEach(x => x.setAttribute('aria-pressed', x === b));
    ta.classList.toggle('sc-oculto', ver); prev.classList.toggle('sc-oculto', !ver);
    if (ver) prev.innerHTML = md(ta.value) || '<p style="color:var(--muted)">Nada escrito ainda.</p>';
    $$('[data-md]', m.el).forEach(x => { x.disabled = ver; });
  }));
}
const BARRA_MD = `<div class="sc-editor-barra" role="toolbar" aria-label="Formatação">
  <button type="button" class="sc-btn" data-md="negrito" title="Negrito (⌘B)">** Negrito</button><button type="button" class="sc-btn" data-md="italico" title="Itálico (⌘I)">* Itálico</button>
  <button type="button" class="sc-btn" data-md="titulo"># Título</button><button type="button" class="sc-btn" data-md="lista">- Lista</button><button type="button" class="sc-btn" data-md="tarefa">☐ Tarefa</button>
  <button type="button" class="sc-btn" data-md="wiki" title="Digite [[ para buscar a nota">[[ Link interno ]]</button><button type="button" class="sc-btn" data-md="link">↗ Link</button><button type="button" class="sc-btn" data-md="codigo">\` Código</button>
  <span class="sc-sep"></span><div class="sc-segmentos" role="group" aria-label="Modo"><button type="button" data-modo="escrever" aria-pressed="true">Escrever</button><button type="button" data-modo="ver" aria-pressed="false">Visualizar</button></div></div>`;
const linksInternos = texto => [...new Set([...String(texto).matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]+)?\]\]/g)].map(x => x[1].trim().split('/').pop()))];

/* ---------- nova nota / editar nota ---------- */
const TIPOS_NOTA = [['conhecimento', 'Conhecimento'], ['sop', 'Processo (SOP)'], ['prompt', 'Prompt'], ['pessoa', 'Pessoa'], ['captura', 'Captura rápida (Inbox)'], ['decisao', 'Decisão →'], ['projeto', 'Projeto ou sistema →']];
const PASTA_TIPO = {conhecimento: '40 - CONHECIMENTO', sop: '50 - RECURSOS / SOPs', prompt: '50 - RECURSOS / Prompts', pessoa: '60 - PESSOAS', captura: '80 - INBOX / Inbox'};
const Editor = {
  novo({sistema = null, tipo = 'conhecimento', titulo = '', projeto = ''} = {}){
    if (!podeEditar()) return;
    if (tipo === 'decisao') return Decisao.nova({sistema, titulo});
    if (tipo === 'projeto') return Projeto.novo({pai: hubDe(sistema), nome: titulo});
    const sid = sistema && porCl.has(sistema) ? sistema : D.geral;
    let base = '', modeloAtual = '';
    const m = modal({classe: 'sc-editor', largura: '820px', cor: `var(${tipoDe(tipo).cor})`, rotulo: `CAPTURA / <span data-rot-tipo>${esc(TIPOS_NOTA.find(t => t[0] === tipo)[1].toUpperCase())}</span>`, titulo: 'Nova nota',
      corpo: `${campo('ed-titulo', 'Título', `<input type="text" id="ed-titulo" name="titulo" value="${esc(titulo)}" placeholder="O que vale a pena lembrar?" autocomplete="off">`, {obrig: true, msg: `Vira o nome do arquivo em <span data-pasta>${esc(PASTA_TIPO[tipo] || '')}</span>. Evite : | ? * " &lt; &gt; [ ] #`})}
        <div class="sc-grade-3">
          ${campo('ed-tipo', 'Tipo de nota', `<select id="ed-tipo" name="tipo">${TIPOS_NOTA.map(([v, r]) => `<option value="${v}" ${v === tipo ? 'selected' : ''}>${r}</option>`).join('')}</select>`)}
          ${campo('ed-sistema', 'Sistema', `<select id="ed-sistema" name="sistema">${opcoesSistemas(sid)}</select>`)}
          ${campo('ed-projeto', 'Projeto', `<select id="ed-projeto" name="projeto">${opcoesProjetos(sid, projeto)}</select>`)}
        </div>
        <div class="sc-campo" data-campo="ed-corpo" data-bloco-conteudo><span class="sc-rot">Conteúdo · Markdown</span>${BARRA_MD}
          <div class="sc-editor-area"><textarea id="ed-corpo" name="corpo" aria-label="Conteúdo em Markdown" placeholder="Escreva em Markdown. Digite [[ para ligar a outra nota."></textarea><div class="sc-editor-previa sc-md sc-oculto" aria-live="polite"></div></div>
          <div class="sc-msg">Começa com a estrutura do modelo oficial do tipo escolhido.</div></div>
        <div class="sc-grade-2" data-bloco-conteudo>
          ${campo('ed-tags', 'Tags', `<input type="text" id="ed-tags" name="tags" placeholder="#estratégia #conteúdo" autocomplete="off">`, {msg: 'Separe por espaço ou vírgula.'})}
          <div class="sc-campo"><span class="sc-rot">Links internos</span><div class="sc-fichas" data-wl></div><div class="sc-msg">Detectados no conteúdo — cada [[link]] vira uma conexão no mapa.</div></div>
        </div>
        <details class="sc-mais" data-bloco-conteudo><summary>Referências e anexos</summary><div>
          <div data-refs style="display:grid;gap:8px"></div>
          <button type="button" class="sc-btn mini" data-add-ref style="justify-self:start">+ Adicionar link ou caminho</button>
          <div class="sc-msg" style="font-size:11.5px;color:var(--muted)">Entram numa seção “## Referências”. O vault não guarda arquivos binários: use o link ou o caminho (~/…) do arquivo.</div></div></details>
        <div class="sc-info-caixa" data-captura-info hidden>A captura rápida vai para a Inbox (“Itens a classificar”), como manda o protocolo do vault — classifique depois.</div>`,
      rodape: `<span class="sc-status">⌘S salva</span><button type="button" class="sc-btn" data-fechar>Cancelar</button><button type="button" class="sc-btn primario" data-salvar>Salvar nota</button>`,
      podeFechar: async () => !sujo(m, base) || descartar()});
    const ta = $('#ed-corpo', m.el), prev = $('.sc-editor-previa', m.el), selTipo = $('#ed-tipo', m.el), selSis = $('#ed-sistema', m.el), selProj = $('#ed-projeto', m.el);
    ligarEditorMarkdown(m, ta, prev);
    const fichas = $('[data-wl]', m.el);
    const pintarLinks = () => { const l = linksInternos(ta.value); fichas.innerHTML = l.length ? l.map(x => `<span class="sc-ficha wl">[[${esc(x)}]]</span>`).join('') : '<span style="font-size:12px;color:var(--muted)">Nenhum ainda.</span>'; };
    ta.addEventListener('input', pintarLinks);
    const refs = $('[data-refs]', m.el);
    const novaRef = () => { const d = document.createElement('div'); d.className = 'sc-grade-2'; d.innerHTML = `<input type="text" class="sc-entrada" name="ref-t-${refs.children.length}" placeholder="Título (opcional)"><div style="display:flex;gap:6px"><input type="text" class="sc-entrada" name="ref-u-${refs.children.length}" placeholder="https://… ou ~/pasta/arquivo"><button type="button" class="sc-btn icone" aria-label="Remover">✕</button></div>`; $('button', d).onclick = () => d.remove(); refs.append(d); $('input', d).focus(); };
    $('[data-add-ref]', m.el).onclick = novaRef;
    const titulo0 = () => $('#ed-titulo', m.el).value.trim() || 'Título';
    async function carregarModelo(){
      const t = selTipo.value;
      if (t === 'captura') return;
      if (ta.value.trim() && ta.value !== modeloAtual) return;   // não apaga o que a pessoa escreveu
      try {
        const r = await api(`modelo?tipo=${t}&titulo=${enc(titulo0())}`);
        if (!ta.value.trim() || ta.value === modeloAtual){
          const hub = hubDe(selSis.value), proj = selProj.value;
          let corpo = r.corpo;
          const ligacoes = [proj, hub].filter(Boolean).map(x => `- [[${x}]]`).join('\n');
          if (ligacoes) corpo = corpo.replace(/(## (?:Origem \(projetos onde surgiu\)|Relacionado|Histórico de interações relevantes)\n)/, `$1${ligacoes}\n`);
          ta.value = modeloAtual = corpo; pintarLinks();
        }
      } catch (e) { statusRodape(m, e.message, 'erro'); }
    }
    function aplicarTipo(){
      const t = selTipo.value;
      if (t === 'decisao' || t === 'projeto'){
        const tit = $('#ed-titulo', m.el).value, sis = selSis.value;
        m.fechar(true);
        return t === 'decisao' ? Decisao.nova({sistema: sis, titulo: tit}) : Projeto.novo({pai: hubDe(sis), nome: tit});
      }
      const cap = t === 'captura';
      $$('[data-bloco-conteudo]', m.el).forEach(x => { x.hidden = cap; });
      $('[data-captura-info]', m.el).hidden = !cap;
      $('[data-campo="ed-projeto"]', m.el).hidden = cap || t === 'pessoa';
      $('[data-pasta]', m.el).textContent = PASTA_TIPO[t] || '';
      $('[data-rot-tipo]', m.el).textContent = TIPOS_NOTA.find(x => x[0] === t)[1].toUpperCase();
      $('#ed-titulo', m.el).placeholder = cap ? 'O que você quer guardar? (uma linha)' : 'O que vale a pena lembrar?';
      $('[data-salvar]', m.el).textContent = cap ? 'Capturar' : 'Salvar nota';
      return carregarModelo();
    }
    selTipo.addEventListener('change', aplicarTipo);
    selSis.addEventListener('change', () => { selProj.innerHTML = opcoesProjetos(selSis.value, ''); if (ta.value === modeloAtual){ ta.value = ''; carregarModelo(); } });
    selProj.addEventListener('change', () => { if (ta.value === modeloAtual){ ta.value = ''; carregarModelo(); } });
    base = JSON.stringify(valorForm(m));
    Promise.resolve(aplicarTipo()).finally(() => { base = JSON.stringify(valorForm(m)); });
    pintarLinks();
    async function salvar(){
      limparErros(m);
      const v = valorForm(m), t = v.tipo, botao = $('[data-salvar]', m.el);
      if (!v.titulo.trim()) return marcarErro(m, 'ed-titulo', t === 'captura' ? 'Escreva o que quer capturar.' : 'Dê um título à nota.');
      const linhasRef = $$('[data-refs] .sc-grade-2', m.el).map(d => { const [ti, u] = $$('input', d).map(x => x.value.trim()); return u ? (/^https?:\/\//.test(u) ? `- [${ti || u}](${u})` : `- ${ti || 'Arquivo'}: \`${u}\``) : ''; }).filter(Boolean);
      let corpo = ta.value;
      if (linhasRef.length) corpo = corpo.replace(/\s*$/, '') + `\n\n## Referências\n${linhasRef.join('\n')}\n`;
      ocupado(botao, true);
      statusRodape(m, 'Salvando no vault…');
      try {
        const r = t === 'captura'
          ? await api('inbox', {metodo: 'POST', corpo: {texto: v.titulo, cliente: hubDe(v.sistema)}})
          : await api('nota', {metodo: 'POST', corpo: {tipo: t, titulo: v.titulo, corpo, tags: v.tags, cliente: hubDe(v.sistema), projeto: v.projeto}});
        m.fechar(true);
        if (t === 'captura') toast(r.mensagem || 'Capturado na Inbox.', {tipo: 'ok'});
        else toast(`Nota criada: ${r.id}`, {tipo: 'ok', acao: {rotulo: 'Abrir', fn: () => SC.abrirNota(r.id)}, duracao: 6000});
      } catch (e) {
        ocupado(botao, false);
        tratarErroForm(m, e, {campoPadrao: 'ed-titulo'});
      }
    }
    $('[data-salvar]', m.el).addEventListener('click', salvar);
    m.el.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's'){ e.preventDefault(); salvar(); } });
  },

  async editar(id, {aoSalvar} = {}){
    if (!podeEditar()) return;
    let nota;
    try { nota = await api('nota?id=' + enc(id)); } catch (e) { return erroToast(e, 'Não abri a nota'); }
    if (!nota.editavel) return toast('Arquivos de sistema (99 - SISTEMA) não são editados pela interface.', {tipo: 'aviso'});
    const fm = k => (nota.fm[k] || '').replace(/^"|"$/g, '');
    const tags = (nota.fm.tags || '').replace(/^\[|\]$/g, '').split(',').map(x => x.trim()).filter(Boolean);
    const no = porId.get(nota.id);
    let base = '';
    const m = modal({largura: '880px', cor: `var(${tipoDe(nota.tipo || 'conhecimento').cor})`, rotulo: `EDIÇÃO / ${esc(nota.rel.split('/').slice(0, -1).join(' / '))}`, titulo: esc(nota.id),
      corpo: `<div class="sc-grade-3">
          ${campo('ed-titulo', 'Título (nome do arquivo)', `<input type="text" id="ed-titulo" value="${esc(nota.id)}" readonly>`, {msg: 'Renomeie pelo Obsidian — ele atualiza os [[links]] das outras notas.'})}
          ${campo('ed-status', 'Status', `<input type="text" id="ed-status" name="status" value="${esc(fm('status'))}" placeholder="—" autocomplete="off">`)}
          ${campo('ed-estado', 'Estado', `<select id="ed-estado" name="estado">${['', 'ativo', 'referencia', 'arquivo'].map(x => `<option value="${x}" ${fm('estado') === x ? 'selected' : ''}>${x || '—'}</option>`).join('')}</select>`)}
        </div>
        <div class="sc-campo" data-campo="ed-corpo"><span class="sc-rot">Conteúdo · Markdown${no ? ' · ' + esc(nomeSistema(sistemaDe(no))) : ''}</span>${BARRA_MD}
          <div class="sc-editor-area"><textarea id="ed-corpo" name="corpo" aria-label="Conteúdo em Markdown"></textarea><div class="sc-editor-previa sc-md sc-oculto" aria-live="polite"></div></div>
          <div class="sc-msg">O frontmatter fica preservado; só os campos acima mudam nele. Alterada ${esc(dataRel(nota.mtime))}.</div></div>
        <div class="sc-grade-2">
          ${campo('ed-tags', 'Tags', `<input type="text" id="ed-tags" name="tags" value="${esc(tags.join(' '))}" autocomplete="off">`)}
          <div class="sc-campo"><span class="sc-rot">Links internos</span><div class="sc-fichas" data-wl></div></div>
        </div>`,
      rodape: `<span class="sc-status">⌘S salva</span><button type="button" class="sc-btn" data-fechar>Cancelar</button><button type="button" class="sc-btn primario" data-salvar>Salvar alterações</button>`,
      podeFechar: async () => !sujo(m, base) || descartar(), foco: '#ed-corpo'});
    const ta = $('#ed-corpo', m.el), prev = $('.sc-editor-previa', m.el);
    ta.value = nota.corpo;
    ligarEditorMarkdown(m, ta, prev);
    const fichas = $('[data-wl]', m.el);
    const pintarLinks = () => { const l = linksInternos(ta.value); fichas.innerHTML = l.map(x => `<span class="sc-ficha wl">[[${esc(x)}]]</span>`).join('') || '<span style="font-size:12px;color:var(--muted)">Nenhum.</span>'; };
    ta.addEventListener('input', pintarLinks); pintarLinks();
    base = JSON.stringify(valorForm(m));
    let hashBase = nota.hash;
    async function salvar(forcarHash){
      limparErros(m);
      const v = valorForm(m), botao = $('[data-salvar]', m.el);
      const mud = {};
      if (v.status.trim() !== fm('status')) mud.status = v.status.trim() || null;
      if (v.estado !== fm('estado')) mud.estado = v.estado || null;
      if (v.tags.trim() !== tags.join(' ')) mud.tags = v.tags;
      ocupado(botao, true); statusRodape(m, 'Salvando no vault…');
      try {
        await api('nota', {metodo: 'PUT', corpo: {id: nota.id, base: forcarHash || hashBase, corpo: v.corpo !== nota.corpo ? v.corpo : undefined, fm: Object.keys(mud).length ? mud : undefined}});
        m.fechar(true);
        toast('Alterações salvas no vault.', {tipo: 'ok'});
        if (aoSalvar) aoSalvar();
        SC.emit('nota-salva', nota.id);
      } catch (e) {
        ocupado(botao, false);
        if (e.codigo === 'conflito'){
          statusRodape(m, 'Conflito: a nota mudou fora daqui.', 'aviso');
          const escolha = await Conflito.resolver({nome: nota.id, minha: v.corpo, disco: e.dados.atual || ''});
          if (escolha === 'sobrescrever') return salvar(e.dados.hash);
          if (escolha === 'recarregar'){ m.fechar(true); return Editor.editar(nota.id, {aoSalvar}); }
          return;
        }
        tratarErroForm(m, e);
      }
    }
    $('[data-salvar]', m.el).addEventListener('click', () => salvar());
    m.el.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's'){ e.preventDefault(); salvar(); } });
  },
};

/* ---------- conflito de edição ---------- */
const Conflito = {
  resolver({nome, minha, disco}){
    return new Promise(resolver => {
      let escolha = 'cancelar';
      const corpoDisco = disco.replace(/^---\n[\s\S]*?\n---\n?/, '');
      const m = modal({largura: '760px', rotulo: 'CONFLITO DE EDIÇÃO', titulo: 'Esta nota mudou fora daqui',
        corpo: `<p class="sc-insp-desc">“${esc(nome)}” foi alterada no Obsidian (ou pelo Claude) depois que você abriu o editor. Nada foi sobrescrito ainda.</p>
          <details class="sc-mais"><summary>Ver diferenças (disco → sua versão)</summary><div>${htmlDiff(corpoDisco, minha)}</div></details>`,
        rodape: `<span class="sc-status"></span><button type="button" class="sc-btn" data-c="copiar">⧉ Copiar a minha</button><button type="button" class="sc-btn" data-c="recarregar">Usar a versão do disco</button><button type="button" class="sc-btn perigo" data-c="sobrescrever">Sobrescrever com a minha</button>`,
        aoFechar: () => resolver(escolha)});
      $$('[data-c]', m.el).forEach(b => b.addEventListener('click', async () => {
        if (b.dataset.c === 'copiar'){ try { await navigator.clipboard.writeText(minha); statusRodape(m, 'Sua versão foi copiada.', 'ok'); } catch (e) { statusRodape(m, 'Não consegui copiar.', 'erro'); } return; }
        escolha = b.dataset.c; m.fechar(true);
      }));
    });
  },
};

/* ---------- decisão ---------- */
const STATUS_NOVA_DECISAO = [['vigente', '🟢 Vigente'], ['em-validacao', '🟡 Em validação'], ['necessita-validacao', '❓ Necessita validação'], ['parcial', '🟡 Parcial']];
const Decisao = {
  nova({sistema = null, titulo = '', substitui = ''} = {}){
    if (!podeEditar()) return;
    const sub = substitui && porId.get(substitui);
    const sid = (sub && sub.cluster) || (sistema && porCl.has(sistema) ? sistema : (contextoSistema() || D.geral));
    const projSub = sub && sub.refs && sub.refs.projeto ? sub.refs.projeto[0] : '';
    let base = '';
    const decisoesDe = s => (membros.get(s) || []).filter(n => n.tipo === 'decisao' && !n.arquivo).sort(ordenarPorNome);
    const m = modal({largura: '860px', cor: 'var(--c-decisao)', rotulo: 'DECISÕES · RASTREABILIDADE', titulo: substitui ? 'Substituir decisão' : 'Registrar decisão',
      corpo: `${sub ? `<div class="sc-aviso-caixa">Esta decisão substitui “${esc(curto(sub.id))}”. A antiga fica com status <b>substituida</b> e estado <b>arquivo</b> — nada é apagado.</div>` : ''}
        ${campo('dc-titulo', 'Qual foi a decisão?', `<input type="text" id="dc-titulo" name="titulo" value="${esc(titulo)}" placeholder="Frase curta e objetiva — vira o título" autocomplete="off">`, {obrig: true, msg: 'Arquivo: 70 - DECISÕES / Decisão — (título).md'})}
        <div class="sc-grade-3">
          ${campo('dc-sistema', 'Sistema', `<select id="dc-sistema" name="sistema">${opcoesSistemas(sid)}</select>`)}
          ${campo('dc-projeto', 'Projeto', `<select id="dc-projeto" name="projeto">${opcoesProjetos(sid, projSub)}</select>`)}
          ${campo('dc-data', 'Data', `<input type="date" id="dc-data" name="data" value="${hojeISO()}">`)}
        </div>
        <div class="sc-grade-3">
          ${campo('dc-status', 'Status', `<select id="dc-status" name="status">${STATUS_NOVA_DECISAO.map(([v, r]) => `<option value="${v}">${r}</option>`).join('')}</select>`)}
          ${campo('dc-evidencia', 'Evidência', `<select id="dc-evidencia" name="evidencia"><option>FATO</option><option>CONCLUSÃO</option><option>INCERTO</option></select>`)}
          <div class="sc-campo"><span class="sc-rot">Trava</span><label class="sc-check"><input type="checkbox" name="travado"> 🔒 Travar (não mudar sem pedido explícito)</label></div>
        </div>
        ${campo('dc-decisao', 'O que foi decidido', `<textarea id="dc-decisao" name="decisao" placeholder="A regra, a escolha, o padrão — com os detalhes que importam."></textarea>`, {obrig: true})}
        <div class="sc-grade-2">
          ${campo('dc-contexto', 'Contexto e motivo', `<textarea id="dc-contexto" name="contexto" placeholder="Qual problema precisava ser resolvido?"></textarea>`)}
          ${campo('dc-porque', 'Justificativa (porquê)', `<textarea id="dc-porque" name="porque" placeholder="Por que esta escolha e não outra?"></textarea>`)}
        </div>
        <div class="sc-grade-2">
          ${campo('dc-fonte', 'Fonte (onde foi dito)', `<input type="text" id="dc-fonte" name="fonte" placeholder="Ex.: pedido explícito em 14/10, sessão do cliente X" autocomplete="off">`)}
          ${campo('dc-proximos', 'Próximos passos', `<textarea id="dc-proximos" name="proximos" placeholder="Um por linha — viram tarefas (☐) na decisão" style="min-height:64px"></textarea>`)}
        </div>
        <details class="sc-mais"><summary>Mais detalhes</summary><div>
          <div class="sc-grade-2">
            ${campo('dc-alternativas', 'Alternativas consideradas', `<textarea id="dc-alternativas" name="alternativas"></textarea>`)}
            ${campo('dc-impactos', 'Impactos', `<textarea id="dc-impactos" name="impactos"></textarea>`)}
          </div>
          <div class="sc-grade-2">
            ${campo('dc-aplicar', 'Como aplicar', `<textarea id="dc-aplicar" name="como_aplicar"></textarea>`)}
            ${campo('dc-naofazer', 'Não fazer', `<textarea id="dc-naofazer" name="nao_fazer"></textarea>`)}
          </div>
          ${campo('dc-substitui', 'Substitui a decisão', `<select id="dc-substitui" name="substitui"><option value="">— nenhuma —</option>${decisoesDe(sid).map(n => `<option value="${esc(n.id)}" ${n.id === substitui ? 'selected' : ''}>${esc(curto(n.id))}</option>`).join('')}</select>`)}
        </div></details>
        <label class="sc-check"><input type="checkbox" name="hubs" checked> Registrar também na nota do projeto (Decisões importantes), em Decisões Recentes e — se travada — em Padrões Travados, como manda o protocolo do vault.</label>`,
      rodape: `<span class="sc-status">⌘S salva</span><button type="button" class="sc-btn" data-fechar>Cancelar</button><button type="button" class="sc-btn primario" data-salvar>Salvar decisão</button>`,
      podeFechar: async () => !sujo(m, base) || descartar()});
    const selSis = $('#dc-sistema', m.el);
    selSis.addEventListener('change', () => {
      $('#dc-projeto', m.el).innerHTML = opcoesProjetos(selSis.value, '');
      $('#dc-substitui', m.el).innerHTML = '<option value="">— nenhuma —</option>' + decisoesDe(selSis.value).map(n => `<option value="${esc(n.id)}">${esc(curto(n.id))}</option>`).join('');
    });
    base = JSON.stringify(valorForm(m));
    async function salvar(){
      limparErros(m);
      const v = valorForm(m), botao = $('[data-salvar]', m.el);
      if (!v.titulo.trim()) return marcarErro(m, 'dc-titulo', 'Escreva a decisão em uma frase.');
      if (!v.decisao.trim()) return marcarErro(m, 'dc-decisao', 'Descreva o que foi decidido.');
      const hub = hubDe(v.sistema);
      ocupado(botao, true); statusRodape(m, 'Registrando…');
      try {
        const r = await api('decisao', {metodo: 'POST', corpo: {...v, projetos: v.projeto ? [v.projeto] : [], clientes: hub ? [hub] : [], hubs: v.hubs}});
        m.fechar(true);
        toast(`Decisão registrada${r.hubs.length ? ' · também em: ' + r.hubs.join(', ') : ''}.`, {tipo: 'ok', duracao: 7000, acao: {rotulo: 'Abrir', fn: () => SC.abrirNota(r.id)}});
        r.avisos.forEach(a => toast(a, {tipo: 'aviso', duracao: 8000}));
      } catch (e) { ocupado(botao, false); tratarErroForm(m, e, {campoPadrao: 'dc-titulo'}); }
    }
    $('[data-salvar]', m.el).addEventListener('click', salvar);
    m.el.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's'){ e.preventDefault(); salvar(); } });
  },
};

/* ---------- tarefa ---------- */
const Tarefa = {
  nova({sistema = null, alvo = ''} = {}){
    if (!podeEditar()) return;
    const noAlvo = alvo && porId.get(alvo);
    const sid = (noAlvo && noAlvo.cluster) || (sistema && porCl.has(sistema) ? sistema : (contextoSistema() || D.geral));
    let base = '', secoesCentral = null;
    const destinos = s => { const hub = hubDe(s); const ps = projetosDe(s); return [...ps.map(n => [n.id, n.id]), ...(hub ? [[hub, `${hub} (nota principal)`]] : []), ['Pendências', 'Pendências (central)'], ['Inbox', 'Inbox']]; };
    const opcoesDestino = (s, sel) => destinos(s).map(([v, r]) => `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(r)}</option>`).join('');
    const m = modal({largura: '760px', cor: 'var(--c-processo)', rotulo: 'EXECUÇÃO · PRÓXIMOS PASSOS', titulo: 'Nova tarefa',
      corpo: `${campo('tf-titulo', 'Tarefa', `<input type="text" id="tf-titulo" name="titulo" placeholder="O que precisa ser feito?" autocomplete="off">`, {obrig: true})}
        <div class="sc-grade-2">
          ${campo('tf-sistema', 'Sistema', `<select id="tf-sistema" name="sistema">${opcoesSistemas(sid)}</select>`)}
          ${campo('tf-alvo', 'Nota de destino', `<select id="tf-alvo" name="alvo">${opcoesDestino(sid, alvo || (projetosDe(sid)[0] || {}).id || hubDe(sid) || 'Pendências')}</select>`, {msg: 'A tarefa vira um checkbox na seção “Pendências” da nota — o mesmo modelo que o Obsidian já usa.'})}
        </div>
        <div data-secao-central hidden>${campo('tf-secao', 'Seção em Pendências', `<select id="tf-secao" name="secao"></select>`)}</div>
        <div class="sc-grade-3">
          <div class="sc-campo"><span class="sc-rot">Prioridade</span><div class="sc-segmentos" role="group" aria-label="Prioridade" data-grupo="prioridade">
            <button type="button" data-v="baixa" aria-pressed="false">Baixa</button><button type="button" data-v="normal" aria-pressed="true">Normal</button><button type="button" data-v="alta" aria-pressed="false">🔴 Alta</button></div></div>
          ${campo('tf-prazo', 'Prazo', `<input type="date" id="tf-prazo" name="prazo">`)}
          <div class="sc-campo"><span class="sc-rot">Status</span><div class="sc-segmentos" role="group" aria-label="Status" data-grupo="status">
            <button type="button" data-v="fazer" aria-pressed="true">A fazer</button><button type="button" data-v="feita" aria-pressed="false">Concluída</button></div></div>
        </div>
        ${campo('tf-descricao', 'Descrição', `<textarea id="tf-descricao" name="descricao" style="min-height:64px" placeholder="Critério de conclusão, detalhe ou contexto (opcional)"></textarea>`)}
        <div class="sc-campo"><span class="sc-rot">Checklist</span><div data-check style="display:grid;gap:6px"></div><button type="button" class="sc-btn mini" data-add-check style="justify-self:start">+ Item</button></div>
        <div class="sc-campo"><span class="sc-rot">Notas relacionadas</span><div class="sc-fichas" data-rel></div>
          <div class="sc-editor-area"><input type="text" class="sc-entrada" data-busca-rel placeholder="Buscar nota para relacionar…" autocomplete="off"><div class="sc-sugestoes sc-oculto" data-sug-rel style="bottom:auto;top:40px"></div></div></div>
        <label class="sc-check"><input type="checkbox" name="central"> Listar também em Pendências (central), com link para esta nota.</label>
        <div class="sc-info-caixa" data-previa style="font-family:var(--mono);font-size:11.5px;overflow-wrap:anywhere"></div>`,
      rodape: `<span class="sc-status"></span><button type="button" class="sc-btn" data-fechar>Cancelar</button><button type="button" class="sc-btn primario" data-salvar>Criar tarefa</button>`,
      podeFechar: async () => !sujo(m, base) || descartar()});
    const estado = {prioridade: 'normal', status: 'fazer', rel: []};
    $$('[data-grupo]', m.el).forEach(g => $$('button', g).forEach(b => b.addEventListener('click', () => { estado[g.dataset.grupo] = b.dataset.v; $$('button', g).forEach(x => x.setAttribute('aria-pressed', x === b)); previa(); })));
    const check = $('[data-check]', m.el);
    $('[data-add-check]', m.el).onclick = () => { const d = document.createElement('div'); d.style.cssText = 'display:flex;gap:6px'; d.innerHTML = `<input type="text" class="sc-entrada" name="check-${check.children.length}" placeholder="Item do checklist"><button type="button" class="sc-btn icone" aria-label="Remover item">✕</button>`; $('button', d).onclick = () => { d.remove(); previa(); }; check.append(d); $('input', d).focus(); };
    const selSis = $('#tf-sistema', m.el), selAlvo = $('#tf-alvo', m.el);
    async function secoes(){
      const central = selAlvo.value === 'Pendências';
      $('[data-secao-central]', m.el).hidden = !central;
      $('[name="central"]', m.el).closest('label').hidden = central || selAlvo.value === 'Inbox';
      if (central && !secoesCentral){
        try { const n = await api('nota?id=Pendências'); secoesCentral = n.secoes.filter(s => s.nivel === 2).map(s => s.titulo); }
        catch (e) { secoesCentral = []; }
        const nomeSis = nomeSistema(porCl.get(selSis.value));
        const casa = secoesCentral.find(s => sem(s).includes(sem(nomeSis)));
        $('#tf-secao', m.el).innerHTML = `<option value="" ${casa ? '' : 'selected'}>— escolha a seção —</option>` + secoesCentral.map(s => `<option ${s === casa ? 'selected' : ''}>${esc(s)}</option>`).join('') + `<option value="${esc(nomeSis)}">+ Nova seção “${esc(nomeSis)}”</option>`;
      }
      previa();
    }
    selSis.addEventListener('change', () => { selAlvo.innerHTML = opcoesDestino(selSis.value, (projetosDe(selSis.value)[0] || {}).id || hubDe(selSis.value) || 'Pendências'); secoesCentral = null; secoes(); });
    selAlvo.addEventListener('change', secoes);
    const fichas = $('[data-rel]', m.el), busca = $('[data-busca-rel]', m.el), sug = $('[data-sug-rel]', m.el);
    const pintarRel = () => { fichas.innerHTML = estado.rel.map((r, i) => `<span class="sc-ficha wl">[[${esc(r)}]] <button type="button" data-tirar="${i}" aria-label="Remover ${esc(r)}">✕</button></span>`).join(''); $$('[data-tirar]', fichas).forEach(b => b.onclick = () => { estado.rel.splice(+b.dataset.tirar, 1); pintarRel(); previa(); }); };
    busca.addEventListener('input', () => {
      const lista = busca.value.trim() ? sugestoesNotas(busca.value, 6) : [];
      sug.innerHTML = lista.map(n => `<button type="button" data-n="${esc(n.id)}"><span>${esc(n.id)}</span><small>${esc(tipoDe(n.tipo).rot)}</small></button>`).join('');
      sug.classList.toggle('sc-oculto', !lista.length);
    });
    sug.addEventListener('mousedown', e => { const b = e.target.closest('[data-n]'); if (!b) return; e.preventDefault(); if (!estado.rel.includes(b.dataset.n)) estado.rel.push(b.dataset.n); busca.value = ''; sug.classList.add('sc-oculto'); pintarRel(); previa(); });
    busca.addEventListener('blur', () => setTimeout(() => sug.classList.add('sc-oculto'), 150));
    function linha(){
      const v = valorForm(m), marca = {alta: '🔴 ', baixa: '🔽 '}[estado.prioridade] || '';
      return `- [${estado.status === 'feita' ? 'x' : ' '}] ${marca}**${v.titulo.trim() || '…'}**${v.descricao.trim() ? ' — ' + v.descricao.trim().replace(/\s+/g, ' ') : ''}${v.prazo ? ' 📅 ' + v.prazo : ''}${estado.rel.length ? ' → ' + estado.rel.map(r => `[[${r}]]`).join(' · ') : ''}`;
    }
    function previa(){
      const v = valorForm(m), itens = $$('[data-check] input', m.el).map(x => x.value.trim()).filter(Boolean);
      const onde = v.alvo === 'Pendências' ? `Pendências › ${v.secao || '…'}` : v.alvo === 'Inbox' ? 'Inbox › Itens a classificar' : `${v.alvo} › Pendências`;
      $('[data-previa]', m.el).innerHTML = `<span style="color:var(--muted);letter-spacing:.14em">SERÁ GRAVADO EM ${esc(onde.toUpperCase())}</span><br>${esc(linha())}${itens.map(i => `<br>&nbsp;&nbsp;- [ ] ${esc(i)}`).join('')}`;
    }
    m.el.addEventListener('input', previa);
    secoes(); previa();
    base = JSON.stringify(valorForm(m));
    async function salvar(){
      limparErros(m);
      const v = valorForm(m), botao = $('[data-salvar]', m.el);
      if (!v.titulo.trim()) return marcarErro(m, 'tf-titulo', 'Diga o que precisa ser feito.');
      if (v.alvo === 'Pendências' && !v.secao) return marcarErro(m, 'tf-secao', 'Escolha em qual seção de Pendências a tarefa entra.');
      ocupado(botao, true); statusRodape(m, 'Gravando…');
      try {
        await api('tarefa', {metodo: 'POST', corpo: {alvo: v.alvo, secao: v.alvo === 'Pendências' ? v.secao : '', titulo: v.titulo, descricao: v.descricao, prioridade: estado.prioridade,
          prazo: v.prazo, feito: estado.status === 'feita', checklist: $$('[data-check] input', m.el).map(x => x.value).filter(x => x.trim()),
          relacionadas: estado.rel, central: v.central && v.alvo !== 'Pendências' && v.alvo !== 'Inbox', sistema: nomeSistema(porCl.get(v.sistema))}});
        m.fechar(true);
        toast(`Tarefa criada em ${v.alvo}.`, {tipo: 'ok'});
      } catch (e) { ocupado(botao, false); tratarErroForm(m, e, {campoPadrao: 'tf-titulo'}); }
    }
    $('[data-salvar]', m.el).addEventListener('click', salvar);
  },
};

/* ---------- projeto ou sistema ---------- */
const Projeto = {
  novo({pai = '', nome = '', tipo = 'projeto'} = {}){
    if (!podeEditar()) return;
    let base = '';
    const pais = sistemasOrdenados().filter(c => c.hub);
    const m = modal({largura: '720px', cor: 'var(--c-projeto)', rotulo: 'ESTRUTURA / SISTEMAS', titulo: 'Novo sistema ou projeto',
      corpo: `<div class="sc-campo"><span class="sc-rot">Tipo</span><div class="sc-segmentos" role="group" aria-label="Tipo" data-tipo>
          <button type="button" data-v="projeto" aria-pressed="${tipo === 'projeto'}">Projeto</button><button type="button" data-v="cliente" aria-pressed="${tipo !== 'projeto'}">Sistema (cliente ou marca)</button></div></div>
        ${campo('pj-nome', 'Nome', `<input type="text" id="pj-nome" name="nome" value="${esc(nome)}" placeholder="Nome do projeto ou do sistema" autocomplete="off">`, {obrig: true, msg: '&nbsp;'})}
        <div class="sc-grade-2" data-so="projeto">
          ${campo('pj-pai', 'Contexto pai (cliente)', `<select id="pj-pai" name="cliente"><option value="">— projeto avulso —</option>${pais.map(c => `<option value="${esc(c.hub)}" ${c.hub === pai ? 'selected' : ''}>${esc(nomeSistema(c))}</option>`).join('')}</select>`)}
          ${campo('pj-status', 'Status', `<select id="pj-status" name="status">${['planejamento', 'ativo', 'aguardando', 'pausado', 'ideia'].map(s => `<option>${s}</option>`).join('')}</select>`)}
        </div>
        <div class="sc-grade-2" data-so="cliente" hidden>
          ${campo('pj-relacao', 'Relação', `<input type="text" id="pj-relacao" name="relacao" placeholder="Ex.: cliente da agência, marca própria" autocomplete="off">`)}
          ${campo('pj-status-c', 'Status da relação', `<select id="pj-status-c" name="status_c"><option>ativo</option><option>inativo</option></select>`)}
        </div>
        ${campo('pj-categoria', 'Categoria / segmento', `<input type="text" id="pj-categoria" name="categoria" placeholder="Ex.: site / landing page, SaaS, marketing para agropecuárias" autocomplete="off">`)}
        ${campo('pj-objetivo', 'Objetivo', `<textarea id="pj-objetivo" name="objetivo" style="min-height:64px" placeholder="O que este projeto precisa entregar? Como saber se deu certo?"></textarea>`)}
        ${campo('pj-descricao', 'Descrição', `<textarea id="pj-descricao" name="descricao" style="min-height:64px" placeholder="Visão geral em poucas linhas"></textarea>`)}
        <div class="sc-info-caixa" data-info></div>`,
      rodape: `<span class="sc-status"></span><button type="button" class="sc-btn" data-fechar>Cancelar</button><button type="button" class="sc-btn primario" data-salvar>Criar</button>`,
      podeFechar: async () => !sujo(m, base) || descartar(), foco: '#pj-nome'});
    let t = tipo === 'projeto' ? 'projeto' : 'cliente';
    const info = () => { $('[data-info]', m.el).innerHTML = t === 'projeto'
      ? 'Cria <b>10 - PROJETOS / (nome).md</b> a partir do Modelo de Projeto e liga o projeto na nota do cliente. O INDEX e o Mapa de Projetos não mudam sozinhos — peça ao Claude para indexar (/criar-projeto).'
      : 'Cria <b>20 - CLIENTES E MARCAS / (nome).md</b> a partir do Modelo de Cliente — ele vira um novo sistema em órbita no mapa.'; };
    $$('[data-tipo] button', m.el).forEach(b => b.addEventListener('click', () => {
      t = b.dataset.v; $$('[data-tipo] button', m.el).forEach(x => x.setAttribute('aria-pressed', x === b));
      $$('[data-so]', m.el).forEach(x => { x.hidden = x.dataset.so !== t; }); info(); validar();
    }));
    $$('[data-so]', m.el).forEach(x => { x.hidden = x.dataset.so !== t; });
    info();
    const nomeEl = $('#pj-nome', m.el), msg = $('#pj-nome-msg', m.el);
    function validar(){
      const v = nomeEl.value.trim(), ruins = [...new Set([...v].filter(c => ':|?*"<>\\/[]#^'.includes(c)))];
      const dup = v && (porNome.has(v.toLowerCase()) || nomesExtras.has(v.toLowerCase()));
      msg.classList.toggle('erro', !!(ruins.length || dup));
      msg.innerHTML = ruins.length ? `Não use ${esc(ruins.join(' '))} — quebram o nome do arquivo ou os [[links]].` : dup ? 'Já existe uma nota com esse nome.' : v ? `Arquivo: ${t === 'projeto' ? '10 - PROJETOS' : '20 - CLIENTES E MARCAS'} / ${esc(v)}.md` : '&nbsp;';
      nomeEl.setAttribute('aria-invalid', ruins.length || dup ? 'true' : 'false');
      return v && !ruins.length && !dup;
    }
    nomeEl.addEventListener('input', validar);
    validar();
    base = JSON.stringify(valorForm(m));
    $('[data-salvar]', m.el).addEventListener('click', async () => {
      statusRodape(m, '');
      if (!validar()){ nomeEl.focus(); if (!nomeEl.value.trim()) marcarErro(m, 'pj-nome', 'Dê um nome.'); return; }
      const v = valorForm(m), botao = $('[data-salvar]', m.el);
      ocupado(botao, true, 'Criando');
      try {
        const r = await api('projeto', {metodo: 'POST', corpo: {tipo: t, nome: v.nome, cliente: v.cliente, status: t === 'projeto' ? v.status : v.status_c, categoria: v.categoria, objetivo: v.objetivo, descricao: v.descricao, relacao: v.relacao}});
        m.fechar(true);
        toast(`${t === 'projeto' ? 'Projeto' : 'Sistema'} criado: ${r.id}.`, {tipo: 'ok', duracao: 7000, acao: {rotulo: 'Abrir', fn: () => SC.abrirNota(r.id)}});
        if (r.mensagem && t === 'projeto') toast(r.mensagem, {tipo: 'info', duracao: 9000});
      } catch (e) { ocupado(botao, false); tratarErroForm(m, e, {campoPadrao: 'pj-nome'}); }
    });
  },
};

/* ---------- processo (SOP): etapas, checklist, execução ---------- */
const Processo = {
  async abrir(id){
    const n = porId.get(id);
    const m = modal({largura: '780px', cor: 'var(--c-processo)', rotulo: 'PROCESSO · EXECUÇÃO', titulo: esc(curto(id)), corpo: esqueleto(8),
      rodape: `<span class="sc-status"></span><button type="button" class="sc-btn" data-p="editar">✎ Editar SOP</button><button type="button" class="sc-btn" data-p="obsidian">Obsidian ↗</button><button type="button" class="sc-btn primario" data-p="registrar" ${ESCRITA ? '' : 'disabled'}>Registrar execução</button>`});
    const corpo = $('.sc-modal-corpo', m.el);
    let p;
    try { p = await api('processo?id=' + enc(id)); }
    catch (e) {
      corpo.innerHTML = e.codigo === 'somente_leitura' && n ? `<p class="sc-insp-desc">${esc(n.resumo)}</p>${caixaErro(e)}` : caixaErro(e, () => { m.fechar(true); Processo.abrir(id); });
      $('[data-p="registrar"]', m.el).disabled = true;
      return ligar();
    }
    const runs = ler('sc-execucoes', {}), run = runs[id] || {feitos: {}};
    const itens = [...p.passos.map(x => ({k: 'p' + x.linha, texto: x.texto, secao: x.secao, n: x.n})), ...p.checklist.map(x => ({k: 'c' + x.linha, texto: x.texto, secao: 'Checklist final', feito0: x.feito}))];
    function pintar(){
      const feitos = itens.filter(i => run.feitos[i.k]).length;
      let html = `<div class="sc-meta-lista" style="grid-template-columns:auto minmax(0,1fr) auto minmax(0,1fr)">
          <dt>Status</dt><dd>${esc(p.status || '—')}</dd><dt>Origem</dt><dd>${esc(p.origem || '—')}</dd>
          <dt>Etapas</dt><dd>${p.passos.length}</dd><dt>Checklist</dt><dd>${p.checklist.length} itens</dd></div>
        ${p.quando ? `<div><div class="sc-rotulo">Quando usar</div><p class="sc-insp-desc" style="margin-top:6px">${mdInline(p.quando)}</p></div>` : ''}
        ${p.requisitos ? `<div><div class="sc-rotulo">Pré-requisitos</div><p class="sc-insp-desc" style="margin-top:6px">${mdInline(p.requisitos)}</p></div>` : ''}
        <div style="display:grid;gap:8px"><div class="sc-rotulo linha">Execução <span class="sc-n" data-exec-n>${feitos}/${itens.length}</span></div>
          <div class="sc-progresso" role="progressbar" aria-valuemin="0" aria-valuemax="${itens.length}" aria-valuenow="${feitos}"><b style="transform:scaleX(${itens.length ? feitos / itens.length : 0})"></b></div>
          <span style="font-size:11.5px;color:var(--muted)" data-exec-txt>${run.inicio ? `Em andamento desde ${esc(run.inicio)} — salvo só neste dispositivo até você registrar.` : 'Marque as etapas conforme executa. O progresso fica salvo neste dispositivo até você registrar a execução.'}</span></div>`;
      if (!itens.length) html += vazio('Este SOP não tem etapas numeradas nem checklist.', 'Edite o SOP para listar as etapas (1. 2. 3.) e o checklist (- [ ]).');
      let secao = null;
      itens.forEach(i => {
        if (i.secao !== secao){ secao = i.secao; html += `<div class="sc-rotulo" style="margin-top:6px">${esc(secao || 'Etapas')}</div>`; }
        html += `<div class="sc-etapa ${run.feitos[i.k] ? 'feita' : ''}"><input type="checkbox" class="sc-caixa" id="et-${i.k}" data-et="${i.k}" ${run.feitos[i.k] ? 'checked' : ''}><label for="et-${i.k}">${i.n ? `<span class="sc-num">${pad2(i.n)} · </span>` : ''}${mdInline(i.texto)}</label></div>`;
      });
      html += `<div><div class="sc-rotulo linha">Histórico de execução <span class="sc-n">${p.execucoes.length}</span></div>
        ${p.execucoes.length ? `<ol class="sc-linha-tempo" style="margin-top:10px">${p.execucoes.slice(0, 12).map(x => { const [q, ...r] = x.split(' — '); return `<li><time>${esc(q)}</time><p>${esc(r.join(' — '))}</p></li>`; }).join('')}</ol>` : vazio('Nenhuma execução registrada ainda.', 'Ao registrar, uma linha com data e progresso entra na seção “## Execuções” do SOP.')}</div>
        ${CFG ? `<button type="button" class="sc-link" data-p="versoes" style="justify-self:start">⟲ Versões deste SOP (git)</button>` : ''}`;
      corpo.innerHTML = html;
      $$('[data-et]', corpo).forEach(cx => cx.addEventListener('change', () => {
        run.feitos[cx.dataset.et] = cx.checked;
        if (!run.inicio) run.inicio = `${dataCurta(hojeISO())} ${agoraHM()}`;
        runs[id] = run; gravar('sc-execucoes', runs);
        cx.closest('.sc-etapa').classList.toggle('feita', cx.checked);
        const feitosAgora = itens.filter(i => run.feitos[i.k]).length;
        const barra = $('.sc-progresso', corpo);
        barra.setAttribute('aria-valuenow', feitosAgora);
        $('b', barra).style.transform = `scaleX(${feitosAgora / itens.length})`;
        $('[data-exec-n]', corpo).textContent = `${feitosAgora}/${itens.length}`;
        $('[data-exec-txt]', corpo).textContent = `Em andamento desde ${run.inicio} — salvo só neste dispositivo até você registrar.`;
      }));
      const v = $('[data-p="versoes"]', corpo);
      v && v.addEventListener('click', () => Versoes.abrir(id));
    }
    pintar();
    ligar();
    function ligar(){
      $$('.sc-modal-rodape [data-p]', m.el).forEach(b => b.addEventListener('click', async () => {
        const a = b.dataset.p;
        if (a === 'editar'){ m.fechar(true); return Editor.editar(id); }
        if (a === 'obsidian') return abrirObsidian(n || {rel: p && p.rel});
        if (a === 'registrar'){
          const feitos = itens.filter(i => run.feitos[i.k]).length;
          if (!itens.length) return statusRodape(m, 'Sem etapas para registrar.', 'aviso');
          const obs = await perguntar({titulo: 'Registrar execução', texto: `${feitos} de ${itens.length} etapas marcadas. Uma linha com data e progresso entra em “## Execuções” do SOP.`, rotulo: 'Observação (opcional)', sim: 'Registrar'});
          if (obs === null) return;
          ocupado(b, true, 'Registrando');
          try {
            await api('processo/execucao', {metodo: 'POST', corpo: {id, feitos, total: itens.length, obs}});
            delete runs[id]; gravar('sc-execucoes', runs);
            m.fechar(true);
            toast('Execução registrada no SOP.', {tipo: 'ok'});
          } catch (e) { ocupado(b, false); statusRodape(m, e.message, 'erro'); }
        }
      }));
      const reiniciar = document.createElement('button');
      reiniciar.type = 'button'; reiniciar.className = 'sc-btn fantasma'; reiniciar.textContent = 'Reiniciar';
      reiniciar.addEventListener('click', () => { delete runs[id]; gravar('sc-execucoes', runs); run.feitos = {}; delete run.inicio; pintar(); });
      if (p) $('.sc-status', m.el).after(reiniciar);
    }
  },
};
function perguntar({titulo, texto = '', rotulo = 'Texto', sim = 'OK', valor = ''}){
  return new Promise(resolver => {
    let resposta = null;
    const m = modal({classe: 'pequeno', rotulo: 'CONFIRMAÇÃO', titulo: esc(titulo),
      corpo: `${texto ? `<p class="sc-insp-desc">${esc(texto)}</p>` : ''}${campo('pg-v', rotulo, `<input type="text" id="pg-v" value="${esc(valor)}" autocomplete="off">`)}`,
      rodape: `<span class="sc-status"></span><button type="button" class="sc-btn" data-fechar>Cancelar</button><button type="button" class="sc-btn primario" data-sim>${esc(sim)}</button>`,
      aoFechar: () => resolver(resposta), foco: '#pg-v'});
    const ok = () => { resposta = $('#pg-v', m.el).value.trim(); m.fechar(true); };
    $('[data-sim]', m.el).addEventListener('click', ok);
    $('#pg-v', m.el).addEventListener('keydown', e => { if (e.key === 'Enter'){ e.preventDefault(); ok(); } });
  });
}

/* ---------- vincular arquivo ou link ---------- */
const Vinculo = {
  novo({sistema = null, nota = ''} = {}){
    if (!podeEditar()) return;
    const noNota = nota && porId.get(nota);
    const sid = (noNota && noNota.cluster) || (sistema && porCl.has(sistema) ? sistema : (contextoSistema() || D.geral));
    const destinos = s => { const m2 = (membros.get(s) || []).slice().sort((a, b) => (b.tipo === 'projeto') - (a.tipo === 'projeto') || ordenarPorNome(a, b)); return m2; };
    const opcoes = (s, sel) => destinos(s).map(n => `<option value="${esc(n.id)}" ${n.id === sel ? 'selected' : ''}>${esc(tipoDe(n.tipo).rot)} · ${esc(curto(n.id))}</option>`).join('');
    let base = '', modo = 'url';
    const m = modal({largura: '700px', cor: 'var(--sc-ouro)', rotulo: 'ARQUIVOS E REFERÊNCIAS', titulo: 'Vincular arquivo ou link',
      corpo: `<div class="sc-campo"><span class="sc-rot">Tipo</span><div class="sc-segmentos" role="group" data-modo-link>
          <button type="button" data-v="url" aria-pressed="true">Link (URL)</button><button type="button" data-v="caminho" aria-pressed="false">Arquivo ou pasta do Mac</button></div></div>
        ${campo('vl-alvo', 'Endereço', `<input type="text" id="vl-alvo" name="alvo" placeholder="https://…" autocomplete="off">`, {obrig: true})}
        <div class="sc-grade-2">
          ${campo('vl-titulo', 'Título', `<input type="text" id="vl-titulo" name="titulo" placeholder="Como o link aparece na nota" autocomplete="off">`)}
          ${campo('vl-categoria', 'Categoria', `<select id="vl-categoria" name="categoria"><option value="">—</option>${['Documento', 'Referência', 'Repositório', 'Deploy', 'Design', 'Planilha', 'Apresentação', 'Outro'].map(x => `<option>${x}</option>`).join('')}</select>`)}
        </div>
        <div class="sc-grade-2">
          ${campo('vl-sistema', 'Sistema', `<select id="vl-sistema" name="sistema">${opcoesSistemas(sid)}</select>`)}
          ${campo('vl-nota', 'Nota de destino', `<select id="vl-nota" name="id">${opcoes(sid, nota || (projetosDe(sid)[0] || {}).id || hubDe(sid))}</select>`)}
        </div>
        ${campo('vl-descricao', 'Descrição', `<input type="text" id="vl-descricao" name="descricao" placeholder="Para que serve (opcional)" autocomplete="off">`)}
        <div class="sc-info-caixa" data-previa style="font-family:var(--mono);font-size:11.5px;overflow-wrap:anywhere"></div>`,
      rodape: `<span class="sc-status"></span><button type="button" class="sc-btn" data-fechar>Cancelar</button><button type="button" class="sc-btn primario" data-salvar>Vincular</button>`,
      podeFechar: async () => !sujo(m, base) || descartar(), foco: '#vl-alvo'});
    $$('[data-modo-link] button', m.el).forEach(b => b.addEventListener('click', () => { modo = b.dataset.v; $$('[data-modo-link] button', m.el).forEach(x => x.setAttribute('aria-pressed', x === b)); $('#vl-alvo', m.el).placeholder = modo === 'url' ? 'https://…' : '~/Projetos/… ou /Users/…'; previa(); }));
    $('#vl-sistema', m.el).addEventListener('change', e => { $('#vl-nota', m.el).innerHTML = opcoes(e.target.value, (projetosDe(e.target.value)[0] || {}).id || hubDe(e.target.value)); previa(); });
    function previa(){
      const v = valorForm(m), alvo = v.alvo.trim() || (modo === 'url' ? 'https://…' : '~/…'), t = v.titulo.trim() || alvo;
      let l = modo === 'url' ? `- [${t}](${alvo})` : `- ${t}: \`${alvo}\``;
      if (v.categoria) l += ' — ' + v.categoria;
      if (v.descricao.trim()) l += ' — ' + v.descricao.trim();
      const no = porId.get(v.id);
      $('[data-previa]', m.el).innerHTML = `<span style="color:var(--muted);letter-spacing:.14em">SERÁ ADICIONADO EM ${esc((v.id || '…').toUpperCase())} › ${no && no.tipo === 'projeto' ? 'ARQUIVOS RELACIONADOS' : 'REFERÊNCIAS'}</span><br>${esc(l)}`;
    }
    m.el.addEventListener('input', previa); m.el.addEventListener('change', previa);
    previa();
    base = JSON.stringify(valorForm(m));
    $('[data-salvar]', m.el).addEventListener('click', async () => {
      limparErros(m);
      const v = valorForm(m), alvo = v.alvo.trim(), botao = $('[data-salvar]', m.el);
      if (modo === 'url' && !/^https?:\/\/\S+$/.test(alvo)) return marcarErro(m, 'vl-alvo', 'Use um endereço completo, começando com https://');
      if (modo === 'caminho' && !/^(~|\/)\S/.test(alvo)) return marcarErro(m, 'vl-alvo', 'Use um caminho do Mac, começando com ~/ ou /');
      if (!v.id) return marcarErro(m, 'vl-nota', 'Escolha a nota.');
      ocupado(botao, true, 'Vinculando');
      try {
        const r = await api('vinculo', {metodo: 'POST', corpo: {id: v.id, titulo: v.titulo, alvo, categoria: v.categoria, descricao: v.descricao}});
        m.fechar(true);
        toast(`Vinculado em ${v.id} › ${r.secao}.`, {tipo: 'ok'});
      } catch (e) { ocupado(botao, false); tratarErroForm(m, e, {campoPadrao: 'vl-alvo'}); }
    });
  },
};

/* ---------- pessoa ---------- */
const Pessoa = {
  async abrir(id){
    const n = porId.get(id);
    const m = modal({largura: '760px', cor: 'var(--c-pessoa)', rotulo: 'PESSOA', titulo: esc(id), corpo: esqueleto(6),
      rodape: `<span class="sc-status"></span>${porCl.has(id) ? '<button type="button" class="sc-btn" data-ps="sistema">Abrir sistema</button>' : ''}<button type="button" class="sc-btn" data-ps="obsidian">Obsidian ↗</button><button type="button" class="sc-btn primario" data-ps="editar" ${ESCRITA ? '' : 'disabled'}>✎ Editar</button>`});
    const corpo = $('.sc-modal-corpo', m.el);
    $$('[data-ps]', m.el).forEach(b => b.addEventListener('click', () => {
      const a = b.dataset.ps;
      if (a === 'obsidian') return abrirObsidian(n);
      m.fechar(true);
      if (a === 'editar') Editor.editar(id);
      if (a === 'sistema') abrirWS(id);
    }));
    const grupos = new Map();
    const conexoes = [...(viz.get(id) || [])].map(x => porId.get(x)).filter(Boolean);
    conexoes.forEach(c => { const t = tipoDe(c.tipo).rot; if (!grupos.has(t)) grupos.set(t, []); grupos.get(t).push(c); });
    const htmlCon = grupos.size ? `<div class="sc-vinculos">${[...grupos.entries()].map(([t, l]) => `<h4>${t} · ${l.length}</h4>${l.map(c => `<button type="button" data-ler="${esc(c.id)}">${esc(curto(c.id))}</button>`).join('')}`).join('')}</div>` : vazio('Sem conexões registradas.');
    try {
      const nota = await api('nota?id=' + enc(id));
      const f = k => (nota.fm[k] || '').replace(/^"|"$/g, '');
      corpo.innerHTML = `<dl class="sc-meta-lista">${f('organizacao') ? `<dt>Organização</dt><dd>${mdInline(f('organizacao'))}</dd>` : ''}${f('relacao') ? `<dt>Relação</dt><dd>${esc(f('relacao'))}</dd>` : ''}<dt>Arquivo</dt><dd>${esc(nota.rel)}</dd><dt>Menções</dt><dd>${nota.backlinks.length} notas</dd></dl>
        <div class="sc-info-caixa">Só aparece o que está registrado no vault (dados públicos ou comerciais, como manda o Modelo de Pessoa).</div>
        <div class="sc-md">${md(nota.corpo, {semTitulo: true})}</div>
        <div><div class="sc-rotulo linha">Conexões no mapa</div>${htmlCon}</div>`;
    } catch (e) {
      corpo.innerHTML = `${n && n.resumo ? `<p class="sc-insp-desc">${esc(n.resumo)}</p>` : ''}${caixaErro(e)}<div style="margin-top:14px"><div class="sc-rotulo linha">Conexões no mapa</div>${htmlCon}</div>`;
    }
    corpo.addEventListener('click', e => { const b = e.target.closest('[data-ler]'); if (b){ m.fechar(true); SC.abrirNota(b.dataset.ler); } });
  },
};

/* ---------- biblioteca de prompts ---------- */
const Biblioteca = {
  abrir(id = null){
    const lista = () => nos.filter(n => n.tipo === 'prompt').sort((a, b) => (b.data || '').localeCompare(a.data || '') || ordenarPorNome(a, b));
    const sistemas = [...new Set(lista().map(n => n.cluster))].map(s => porCl.get(s)).filter(Boolean);
    const estado = {q: '', sis: '', status: '', sel: id};
    const m = modal({classe: 'largo', largura: '1200px', cor: 'var(--c-prompt)', rotulo: 'RECURSOS / PROMPTS', titulo: 'Biblioteca de prompts',
      corpo: `<div class="sc-biblioteca ${id ? 'lendo' : ''}" style="margin:-20px -24px -22px">
        <div class="sc-painel-lista">
          <div class="sc-ferramentas">
            <label class="sc-busca-local"><span aria-hidden="true">›</span><input type="search" data-bq placeholder="Buscar prompt…" aria-label="Buscar prompt"></label>
            <div style="display:flex;gap:8px"><select class="sc-select-mini" data-bs aria-label="Sistema" style="flex:1;min-width:0"><option value="">Todos os sistemas</option>${sistemas.map(c => `<option value="${esc(c.id)}">${esc(nomeSistema(c))}</option>`).join('')}</select>
              <select class="sc-select-mini" data-bst aria-label="Status"><option value="">Todos</option>${[...new Set(lista().map(n => n.status).filter(Boolean))].map(s => `<option>${esc(s)}</option>`).join('')}</select></div>
          </div>
          <div class="sc-lista" data-bl role="list"></div>
        </div>
        <div class="sc-painel-leitor" data-bd></div></div>`});
    const raiz = $('.sc-biblioteca', m.el), lis = $('[data-bl]', m.el), det = $('[data-bd]', m.el);
    function pintarLista(){
      const t = sem(estado.q).split(/\s+/).filter(Boolean);
      const itens = lista().filter(n => (!estado.sis || n.cluster === estado.sis) && (!estado.status || n.status === estado.status) && t.every(x => sem(n.id + ' ' + n.resumo).includes(x)));
      lis.innerHTML = itens.length ? itens.map(n => itemLista(n, {ativo: n.id === estado.sel, attr: `data-bp="${esc(n.id)}" role="listitem"`, sub: [nomeSistema(sistemaDe(n)), n.status, dataCurta(n.data)].filter(Boolean).join(' · ')})).join('') : `<div style="padding:16px">${vazio('Nenhum prompt com esses filtros.')}</div>`;
    }
    async function detalhe(pid){
      estado.sel = pid; pintarLista(); raiz.classList.add('lendo');
      const n = porId.get(pid);
      det.innerHTML = `<div class="sc-leitor-cab">${n ? htmlTagsNota(n) : ''}<h2>${esc(curto(pid))}</h2></div>${esqueleto(6)}`;
      let nota;
      try { nota = await api('nota?id=' + enc(pid)); }
      catch (e) { det.innerHTML = `<div class="sc-leitor-cab"><h2>${esc(curto(pid))}</h2></div>${n && n.resumo ? `<p class="sc-insp-desc">${esc(n.resumo)}</p>` : ''}${caixaErro(e)}`; return; }
      const f = k => (nota.fm[k] || '').replace(/^"|"$/g, '');
      const corpo = nota.corpo, ini = corpo.search(/^## Prompt completo/m);
      const secao = ini >= 0 ? corpo.slice(ini).replace(/^## Prompt completo\s*\n/, '') : '';
      const cerca = /^(~{3,}|`{3,})[^\n]*\n([\s\S]*?)\n\1\s*$/m.exec(secao);
      const prompt = cerca ? cerca[2] : secao.split(/\n## /)[0].trim();
      const vars = [...new Set([...prompt.matchAll(/\{\{\s*([^}]{1,40}?)\s*\}\}|\[([A-ZÀ-Ú][A-ZÀ-Ú0-9 _\-]{2,40})\]|<([A-ZÀ-Ú][A-ZÀ-Ú0-9 _\-]{2,40})>/g)].map(x => x[1] || x[2] || x[3]))];
      const resto = ini >= 0 ? corpo.slice(0, ini) : corpo;
      const projetos = (nota.fm.projeto || '').match(/\[\[([^\]]+)\]\]/g) || [];
      det.innerHTML = `<div class="sc-leitor-cab">
          <button type="button" class="sc-btn fantasma mini" data-bv style="justify-self:start">← Lista</button>
          ${n ? htmlTagsNota(n) : ''}<h2>${esc(nota.id)}</h2>
          <dl class="sc-meta-lista" style="grid-template-columns:auto minmax(0,1fr) auto minmax(0,1fr)">
            <dt>Ferramenta</dt><dd>${esc(f('ferramenta') || '—')}</dd><dt>Versão</dt><dd>${esc(f('versao') || '—')}</dd>
            <dt>Projeto</dt><dd>${projetos.length ? projetos.map(x => mdInline(x)).join(', ') : '—'}</dd><dt>Data</dt><dd>${esc(dataCurta(f('data')))}</dd></dl>
          <div class="sc-leitor-acoes">
            <button type="button" class="sc-btn primario" data-ba="copiar" ${prompt ? '' : 'disabled'}>⧉ Copiar prompt</button>
            <button type="button" class="sc-btn" data-ba="duplicar" ${ESCRITA ? '' : 'disabled'}>⊕ Duplicar (nova versão)</button>
            <button type="button" class="sc-btn" data-ba="editar" ${ESCRITA ? '' : 'disabled'}>✎ Editar</button>
            <button type="button" class="sc-btn" data-ba="relacionar" ${ESCRITA ? '' : 'disabled'}>⛓ Relacionar a projeto</button>
            <button type="button" class="sc-btn icone" data-ba="mais" aria-label="Mais ações">⋯</button></div></div>
        ${vars.length ? `<div style="margin-bottom:16px"><div class="sc-rotulo">Variáveis para preencher</div><div class="sc-fichas" style="margin-top:8px">${vars.map(v => `<span class="sc-ficha">${esc(v)}</span>`).join('')}</div></div>` : ''}
        <div class="sc-md">${md(resto, {semTitulo: true})}</div>
        ${prompt ? `<div class="sc-prompt-bloco" style="margin-top:22px"><div class="sc-rotulo linha">Prompt completo · ${prompt.length.toLocaleString('pt-BR')} caracteres</div><div class="sc-md" style="margin-top:10px"><pre><code>${esc(prompt)}</code></pre></div></div>` : vazio('Este prompt não tem a seção “Prompt completo”.')}`;
      $$('[data-ba]', det).forEach(b => b.addEventListener('click', async () => {
        const a = b.dataset.ba;
        if (a === 'copiar'){ try { await navigator.clipboard.writeText(prompt); toast('Prompt copiado — pronto para colar.', {tipo: 'ok'}); } catch (e) { toast('Não consegui copiar.', {tipo: 'erro'}); } }
        if (a === 'editar'){ m.fechar(true); Editor.editar(pid); }
        if (a === 'duplicar') duplicar(pid, f('versao'));
        if (a === 'relacionar') relacionar(pid, nota);
        if (a === 'mais') menu(b, [{icone: '↗', rotulo: 'Abrir no Obsidian', acao: () => abrirObsidian(n || {rel: nota.rel})}, {icone: '⟲', rotulo: 'Versões (git)', acao: () => Versoes.abrir(pid)}, {icone: '⧉', rotulo: 'Copiar link [[…]]', acao: () => copiarLink(pid)}]);
      }));
      $('[data-bv]', det).addEventListener('click', () => { raiz.classList.remove('lendo'); estado.sel = null; pintarLista(); });
    }
    async function duplicar(pid, versao){
      const prox = (/v(\d+)/.exec(versao || 'v1') || [0, 1])[1] * 1 + 1;
      const titulo = await perguntar({titulo: 'Duplicar como nova versão', texto: `Cria uma cópia com versão v${prox}, data de hoje e “duplicado de [[…]]” no histórico. A original não muda.`, rotulo: 'Título da nova versão', valor: `${curto(pid)} (v${prox})`, sim: 'Duplicar'});
      if (!titulo) return;
      try {
        const r = await api('prompt/duplicar', {metodo: 'POST', corpo: {id: pid, titulo, versao: 'v' + prox}});
        toast(`Nova versão criada: ${r.id}`, {tipo: 'ok'});
      } catch (e) { erroToast(e, 'Não dupliquei'); }
    }
    async function relacionar(pid, nota){
      const atuais = (nota.fm.projeto || '').match(/\[\[([^\]]+)\]\]/g) || [];
      const escolha = await escolherNota({titulo: 'Relacionar a um projeto', filtro: n => n.tipo === 'projeto'});
      if (!escolha) return;
      const lista = [...new Set([...atuais.map(x => x.slice(2, -2)), escolha])].map(x => `[[${x}]]`);
      try { await api('nota', {metodo: 'PUT', corpo: {id: pid, base: nota.hash, fm: {projeto: lista}}}); toast(`Relacionado a ${escolha}.`, {tipo: 'ok'}); detalhe(pid); }
      catch (e) { erroToast(e, 'Não relacionei'); }
    }
    $('[data-bq]', m.el).addEventListener('input', e => { estado.q = e.target.value; pintarLista(); });
    $('[data-bs]', m.el).addEventListener('change', e => { estado.sis = e.target.value; pintarLista(); });
    $('[data-bst]', m.el).addEventListener('change', e => { estado.status = e.target.value; pintarLista(); });
    lis.addEventListener('click', e => { const b = e.target.closest('[data-bp]'); if (b) detalhe(b.dataset.bp); });
    pintarLista();
    if (id) detalhe(id);
    else det.innerHTML = vazio(`${lista().length} prompts na biblioteca.`, 'Escolha um à esquerda para ver o prompt completo, copiar, duplicar ou relacionar a um projeto.');
  },
};
function escolherNota({titulo, filtro = () => true}){
  return new Promise(resolver => {
    let escolha = null;
    const m = modal({classe: 'pequeno', rotulo: 'VINCULAR', titulo: esc(titulo),
      corpo: `<label class="sc-busca-local"><span aria-hidden="true">›</span><input type="search" data-q placeholder="Buscar…" aria-label="Buscar"></label><div class="sc-lista" data-l style="max-height:46vh;overflow:auto"></div>`,
      aoFechar: () => resolver(escolha), foco: '[data-q]'});
    const pintar = q => { const t = sem(q); $('[data-l]', m.el).innerHTML = nos.filter(filtro).filter(n => sem(n.id).includes(t)).sort(ordenarPorNome).slice(0, 60).map(n => itemLista(n, {attr: `data-e="${esc(n.id)}"`, sub: nomeSistema(sistemaDe(n))})).join('') || vazio('Nada encontrado.'); };
    $('[data-q]', m.el).addEventListener('input', e => pintar(e.target.value));
    $('[data-l]', m.el).addEventListener('click', e => { const b = e.target.closest('[data-e]'); if (b){ escolha = b.dataset.e; m.fechar(true); } });
    pintar('');
  });
}

/* ---------- versões (git) ---------- */
const Versoes = {
  async abrir(id){
    const m = modal({largura: '900px', rotulo: 'HISTÓRICO · GIT', titulo: esc(curto(id)), corpo: esqueleto(6)});
    const corpo = $('.sc-modal-corpo', m.el);
    try {
      const [h, atual] = await Promise.all([api('historico?id=' + enc(id)), api('nota?id=' + enc(id))]);
      if (!h.versoes.length){ corpo.innerHTML = vazio('Sem versões registradas.', 'A nota ainda não entrou em nenhum commit do vault — o registro acontece no /finalizar-sessao.'); return; }
      corpo.innerHTML = `<p class="sc-insp-desc">Versões registradas nos commits do vault. Escolha uma para comparar com o texto atual.</p>
        <div style="display:grid;grid-template-columns:minmax(220px,300px) minmax(0,1fr);gap:18px;align-items:start">
          <div class="sc-lista" data-vl>${h.versoes.map((v, i) => `<button type="button" class="sc-item ${i === 0 ? 'ativo' : ''}" data-v="${esc(v.hash)}"><span class="sc-ponto"></span><span style="min-width:0"><span class="sc-t" style="display:block;white-space:normal">${esc(v.msg)}</span><span class="sc-s">${esc(v.data)} · ${esc(v.hash)}</span></span><span></span></button>`).join('')}</div>
          <div data-vd>${esqueleto(6)}</div></div>`;
      const mostrar = async hash => {
        $$('[data-v]', corpo).forEach(b => b.classList.toggle('ativo', b.dataset.v === hash));
        const alvo = $('[data-vd]', corpo);
        alvo.innerHTML = esqueleto(6);
        try {
          const r = await api(`versao?id=${enc(id)}&commit=${enc(hash)}`, {cache: true});
          alvo.innerHTML = `<div class="sc-rotulo linha">Desta versão → texto atual</div><div style="margin-top:10px">${htmlDiff(r.texto, atual.texto)}</div>`;
        } catch (e) { alvo.innerHTML = caixaErro(e); }
      };
      $('[data-vl]', corpo).addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (b) mostrar(b.dataset.v); });
      mostrar(h.versoes[0].hash);
    } catch (e) { corpo.innerHTML = caixaErro(e); }
  },
};

/* ---------- arquivar e excluir ---------- */
const Acoes = {
  async arquivar(id, {decisao = false} = {}){
    if (!podeEditar()) return;
    let nota;
    try { nota = await api('nota?id=' + enc(id)); } catch (e) { return erroToast(e); }
    const n = porId.get(id), tipo = n ? n.tipo : '';
    const opcoes = decisao || tipo === 'decisao' ? [['substituida', 'Substituída'], ['rejeitada', 'Rejeitada']] : tipo === 'projeto' ? [['concluido', 'Concluído'], ['arquivado', 'Arquivado']] : [['arquivado', 'Arquivado'], ['historico', 'Histórico']];
    let status = null;
    const m = modal({classe: 'pequeno', rotulo: 'ARQUIVAR', titulo: `Arquivar “${esc(curto(id))}”?`,
      corpo: `<p class="sc-insp-desc">A nota continua no vault, com <b>estado: arquivo</b> e o status escolhido. No mapa ela só aparece com o filtro <b>Arquivo</b> ligado. Dá para desfazer editando o frontmatter.</p>
        ${campo('ar-status', 'Novo status', `<select id="ar-status">${opcoes.map(([v, r]) => `<option value="${v}">${r}</option>`).join('')}</select>`)}`,
      rodape: `<span class="sc-status"></span><button type="button" class="sc-btn" data-fechar>Cancelar</button><button type="button" class="sc-btn primario" data-sim>Arquivar</button>`,
      aoFechar: async () => {
        if (!status) return;
        try { await api('nota/arquivar', {metodo: 'POST', corpo: {id, base: nota.hash, status}}); toast(`Arquivada: ${curto(id)}.`, {tipo: 'ok'}); }
        catch (e) { erroToast(e, 'Não arquivei'); }
      }});
    $('[data-sim]', m.el).addEventListener('click', () => { status = $('#ar-status', m.el).value; m.fechar(true); });
  },
  async excluir(id){
    if (!podeEditar()) return;
    let nota;
    try { nota = await api('nota?id=' + enc(id)); } catch (e) { return erroToast(e); }
    const n = nota.backlinks.length;
    const ok = await confirmar({rotulo: 'EXCLUSÃO', titulo: `Mover “${curto(id)}” para a Lixeira?`, perigo: true, sim: 'Mover para a Lixeira', nao: 'Cancelar',
      texto: `O arquivo <b>${esc(nota.rel)}</b> sai do vault e vai para a Lixeira do Mac — dá para recuperar de lá.${n ? ` <b>${n} nota${n > 1 ? 's' : ''}</b> aponta${n > 1 ? 'm' : ''} para ela; esses [[links]] vão ficar quebrados.` : ''}`,
      extra: n ? `<div class="sc-vinculos" style="max-height:160px;overflow:auto;margin-top:10px">${nota.backlinks.map(b => `<button type="button" disabled>${esc(b)}</button>`).join('')}</div>` : ''});
    if (!ok) return;
    try {
      await api('nota/excluir', {metodo: 'POST', corpo: {id, base: nota.hash}});
      toast(`“${curto(id)}” foi para a Lixeira.`, {tipo: 'ok', duracao: 6000});
      if (WS.aberto && WS.nota === id){ WS.nota = null; pintarWS(); }
      if (Insp.sel && Insp.sel.id === id) fecharInspector(false);
    } catch (e) { erroToast(e, 'Não exclui'); }
  },
};
