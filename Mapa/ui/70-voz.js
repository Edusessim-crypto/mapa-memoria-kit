/* Comandos de voz: segure ⌘ Command (ou clique em MIC) e fale — "Jarvis, abre o Cliente X".
   No app, o reconhecimento é o nativo do Mac (Speech, pt-BR) — ver app/main.swift; no navegador, a Web Speech API.
   As respostas usam a narração gerada (voz do ElevenLabs, com o efeito Jarvis) — frases "__cmd_*" e "__abrir:*"
   em gerar_mapa.py.
   O que não é comando (perguntas, conversa) vai para /api/conversa: o Claude lê o vault e responde curto,
   e a resposta é falada pela /api/falar (ElevenLabs) — ver conversa.py. */
const Voz = {el: null, btn: null, ouvindo: false, segurando: false, texto: '', executado: false, rec: null,
  timerSilencio: 0, timerLimite: 0, timerFechar: 0, pedido: 0,
  emAndamento: 0, avisoFalado: false, respondeu: false, eventosOn: false};   // conversa com o servidor (SSE, interrupção)

function vozDisponivel(){
  if (window.__escutaNativa) return 'nativa';
  if (window.SpeechRecognition || window.webkitSpeechRecognition) return 'web';
  return null;
}

/* ---------- entendimento do comando ---------- */
const PARADAS = new Set(['o', 'a', 'os', 'as', 'de', 'da', 'do', 'das', 'dos', 'e', 'no', 'na', 'nos', 'nas', 'um', 'uma',
  'pra', 'para', 'por', 'favor', 'me', 'sistema', 'nota', 'cliente']);
const CATEGORIAS = [
  ['clientes', /\bclientes?\b/], ['projetos', /\bprojetos?\b/], ['decisoes', /\bdecis(ao|oes)\b/],
  ['conhecimento', /\bconhecimentos?\b/], ['processos', /\bprocessos?\b/], ['pessoas', /\bpessoas?\b/],
  ['prompts', /\bprompts?\b/], ['arquivo', /\barquiv(o|os|ado|ados|adas)\b/],
];
const normVoz = t => sem(t).replace(/[.,!?;:"“”'()]/g, ' ').replace(/\s+/g, ' ').trim();
const compacto = t => t.replace(/ /g, '');
function semChamado(t){ return t.replace(/^(ok |ei |hey |oi |e ai )?(jarvis|jarbas|javis|djarvis|garvis|jarviz)\b\s*/, ''); }
// pergunta ou conversa (vai para o Claude), não comando
const PERGUNTA = /^(o que|oque|qual|quais|quanto|quantos|quantas|como|quando|onde|aonde|por que|porque|pq|quem|que|sera|me (fala|fale|diz|diga|conta|conte|explica|explique|lembra|lembre|ajuda|ajude|resume|resuma|da|de|passa)|explica|explique|resume|resuma|fala sobre|conta|conte|existe|existem|tem|tenho|temos|preciso|precisamos|devo|posso|voce|vc|pode|consegue|lista|liste|listar|compara|compare|analisa|analise|sugere|sugira|e (a|o|os|as|sobre)|status|em que|bom dia|boa tarde|boa noite|obrigado|obrigada|valeu|tudo bem)\b/;
const ehPergunta = (t, bruto) => PERGUNTA.test(t) || /\?\s*$/.test(bruto) || t.split(' ').length >= 9;
function limparAlvo(t){
  let s = t, antes;
  do { antes = s; s = s.replace(/^(o|a|os|as|de|da|do|no|na|pra|para|sistema|nota|projeto|cliente|decisao|workspace|painel)\s+/, ''); } while (s !== antes);
  return s.trim();
}
function distancia(a, b){
  if (a === b) return 0;
  const m = a.length, n = b.length; if (!m || !n) return m || n;
  let ant = Array.from({length: n + 1}, (_, j) => j);
  for (let i = 1; i <= m; i++){
    const at = [i];
    for (let j = 1; j <= n; j++) at[j] = Math.min(ant[j] + 1, at[j - 1] + 1, ant[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    ant = at;
  }
  return ant[n];
}
function pontuar(alvo, nome){
  const a = normVoz(alvo), b = normVoz(nome);
  if (!a || !b) return 0;
  const ac = compacto(a), bc = compacto(b);
  if (ac === bc) return 100;
  if (ac.length >= 4 && bc.includes(ac)) return 72 + Math.min(18, ac.length) - Math.min(16, (bc.length - ac.length) / 3);
  if (bc.length >= 4 && ac.includes(bc)) return 66 + Math.min(18, bc.length);
  const ta = a.split(' ').filter(w => w.length > 2 && !PARADAS.has(w)), tb = new Set(b.split(' ').filter(w => w.length > 2 && !PARADAS.has(w)));
  const comum = ta.filter(w => tb.has(w)).length;
  const j = ta.length && tb.size ? comum / Math.min(ta.length, tb.size) : 0;
  const lev = 1 - distancia(ac, bc) / Math.max(ac.length, bc.length);
  return Math.max(j * 62, lev > .74 ? lev * 72 : 0);
}
function apelidosSistema(c){
  const nomes = new Set([c.id, c.nome, nomeSistema(c)]);
  String(c.nome).split(/ · |, /).forEach(p => nomes.add(p));
  if (c.id === D.geral){ ['núcleo', 'núcleo de memória', 'conhecimento geral', 'centro'].forEach(x => nomes.add(x)); }
  if (c.hub) nomes.add(c.hub);
  return [...nomes].filter(Boolean);
}
function resolverAlvo(texto){
  const alvo = limparAlvo(texto);
  if (!alvo) return null;
  let melhorSis = null, ps = 0;
  for (const c of clusters){
    const p = Math.max(...apelidosSistema(c).map(nm => pontuar(alvo, nm)));
    if (p > ps){ ps = p; melhorSis = c; }
  }
  let melhorNo = null, pn = 0;
  for (const n of nos){
    if (n.hub) continue;
    const p = Math.max(pontuar(alvo, n.id), pontuar(alvo, n.id.replace(/^(Decisão|SOP|Prompt) — /, '')));
    if (p > pn){ pn = p; melhorNo = n; }
  }
  if (melhorSis && ps >= 58 && ps >= pn - 4) return {tipo: 'sistema', c: melhorSis, pontos: ps};
  if (melhorNo && pn >= 56) return {tipo: 'no', n: melhorNo, pontos: pn};
  return null;
}
function narracaoDe(chave){ const it = window.DADOS && DADOS.narracao && DADOS.narracao[chave]; return it ? it.texto : ''; }
function responder(chave, reserva, tipo = 'ok'){
  const texto = narracaoDe(chave) || reserva || '';
  if (texto) SC.mapa.narrar(chave, texto); else SC.mapa.sinal(tipo);
  return texto;
}

function executarComando(bruto){
  // "pode abrir o Cliente X" é comando, não pergunta
  const t = semChamado(normVoz(bruto)).replace(/^(por favor |voce |vc )?(pode|poderia|consegue|quero que voce|quero)\s+(me\s+)?(?=(abr|mostr|exib|busc|procur|pesquis|fech|aproxim|afast|paus|continu|retom|escond|ocult|tir|vai|ir|lev|foc|selecion|entr|ver|lig|deslig|inici|modo|centraliz|volt)\w*\b)/, '');
  if (!t) return {ok: false, msg: 'Não ouvi nada.'};
  let m;
  // ajuda
  if (/\b(ajuda|comandos|o que (voce )?(sabe|pode|consegue) fazer)\b/.test(t)){
    abrirAjudaVoz();
    return {ok: true, msg: responder('__cmd_ajuda', 'Comandos de voz')};
  }
  if (CFG && ehPergunta(t, bruto)) return {conversa: true};
  // "apresenta o Cliente X", "me apresenta o projeto X" → o Claude explica; "apresenta" sozinho → modo apresentação
  const pedidoApres = t.match(/^(me |nos )?(apresenta|apresente|apresentar)\b\s*(pra mim |para mim |pra gente )?(.*)$/);
  if (CFG && pedidoApres && limparAlvo(pedidoApres[4]).length >= 3 && !/^(o mapa|o segundo cerebro|tudo|os sistemas)$/.test(pedidoApres[4].trim())) return {conversa: true};
  // apresentação
  if (/\b(para|parar|encerra|encerrar|sai|sair|termina|terminar)\b.*\b(apresentacao|tour)\b/.test(t)){
    Apresentacao.parar(); return {ok: true, msg: responder('__cmd_apres_fim', 'Apresentação encerrada.')};
  }
  if (Apresentacao.ativo && /^(proximo|avanca|avancar|seguinte)\b/.test(t)){ SC.mapa.apresentacao('proximo'); SC.mapa.sinal('ok'); return {ok: true, msg: 'Próximo sistema'}; }
  if (Apresentacao.ativo && /^(anterior|volta um|voltar um)\b/.test(t)){ SC.mapa.apresentacao('anterior'); SC.mapa.sinal('ok'); return {ok: true, msg: 'Sistema anterior'}; }
  if (/\b(modo apresentacao|apresentacao|apresenta|tour)\b/.test(t)){
    SC.mapa.sinal('ok'); Apresentacao.iniciar(); return {ok: true, msg: 'Iniciando a apresentação.'};
  }
  // conversa nova: o Claude esquece o assunto (Shift+J faz o mesmo)
  if (CFG && /\b(nova conversa|conversa nova|esquece (tudo|a conversa|isso tudo|o que (eu )?falei)|comeca (de novo|do zero)|zera a conversa|limpa a conversa)\b/.test(t)){
    novaConversa(); return {ok: true, msg: 'Conversa nova.'};
  }
  // fechar / limpar
  if (/^(fecha|fechar|cancela|cancelar|limpa|limpar|esquece)\b/.test(t)){
    fecharPal(); if (WS.aberto) fecharWS(); fecharInspector(false); SC.mapa.limpar();
    return {ok: true, msg: responder('__cmd_fechar', 'Pronto.')};
  }
  // tema do mapa: "muda o tema", "tema constelação", "tema holomapa"
  if (/\b(muda|mudar|troca|trocar|alterna|alternar|liga|ligar|ativa|ativar|usa|usar)\b.*\btema\b/.test(t) || /\btema (constelacao|holomapa|antigo|novo|classico)\b/.test(t)){
    const atual = SC.mapa.tema ? SC.mapa.tema() : 'holomapa';
    const alvo = /constelacao|novo/.test(t) ? 'constelacao' : /holomapa|antigo|classico/.test(t) ? 'holomapa' : (atual === 'constelacao' ? 'holomapa' : 'constelacao');
    if (alvo === atual) return {ok: true, msg: responder('__cmd_ok', 'Feito.')};
    try { localStorage.setItem('sc-tema', alvo); } catch (e) {}
    setTimeout(() => SC.recarregarMapa(alvo === 'constelacao' ? 'Tema Constelação.' : 'Tema Holomapa.'), 900);
    return {ok: true, msg: responder('__cmd_ok', 'Feito.')};
  }
  // visão geral
  if (/\b(visao geral|mostra tudo|centraliza|centralizar|recentraliza|recentralizar)\b/.test(t) || /^(volta|voltar)\b/.test(t)){
    if (WS.aberto) fecharWS(); fecharInspector(false); SC.mapa.visaoGeral();
    return {ok: true, msg: responder('__cmd_visao', 'Visão geral.')};
  }
  // decisões travadas
  if (/\btravad/.test(t)){
    const ids = nos.filter(n => n.travado && n.tipo === 'decisao' && !n.arquivo).map(n => n.id);
    if (WS.aberto) fecharWS(); fecharInspector(false);
    SC.mapa.destacar(ids);
    return {ok: true, msg: responder('__cmd_travadas', `Mostrando as ${ids.length} decisões travadas.`)};
  }
  // zoom
  if (/\b(aproxima|aproximar|chega mais perto|mais perto|zoom in|amplia|ampliar)\b/.test(t)){ SC.mapa.zoom(.6); return {ok: true, msg: responder('__cmd_zoom_in', 'Aproximando.')}; }
  if (/\b(afasta|afastar|mais longe|zoom out|reduz|reduzir)\b/.test(t)){ SC.mapa.zoom(1.6); return {ok: true, msg: responder('__cmd_zoom_out', 'Afastando.')}; }
  // som
  if (/\b(silencio|muta|mutar)\b/.test(t) || /\b(desliga|desligar|tira)\b.*\b(som|audio)\b/.test(t)){
    SC.mapa.sinal('fim'); setTimeout(() => SC.mapa.som(false), 250); return {ok: true, msg: 'Som desligado.'};
  }
  if (/\b(liga|ligar|ativa|ativar)\b.*\b(som|audio)\b/.test(t)){ SC.mapa.som(true); SC.mapa.sinal('ok'); return {ok: true, msg: 'Som ligado.'}; }
  // movimento
  if (/\b(pausa|pausar|congela|congelar)\b/.test(t) || /\bpara (o )?movimento\b/.test(t)){ SC.mapa.movimento(false); return {ok: true, msg: responder('__cmd_pausa', 'Movimento pausado.')}; }
  if (/\b(continua|continuar|retoma|retomar|movimenta|movimentar)\b/.test(t)){ SC.mapa.movimento(true); return {ok: true, msg: responder('__cmd_retoma', 'Movimento retomado.')}; }
  // filtros: "esconde os prompts", "mostra as decisões"
  if ((m = /^(esconde|esconder|oculta|ocultar|tira|tirar|remove|remover|mostra|mostrar|exibe|exibir)\b(.*)$/.exec(t))){
    const mostrarCat = /^(mostra|mostrar|exibe|exibir)/.test(m[1]);
    const cat = CATEGORIAS.find(([, re]) => re.test(m[2]));
    const resto = m[2].replace(/\b(os|as|o|a|todas?|todos?)\b/g, '').trim();
    const soCategoria = cat && resto.split(' ').filter(Boolean).length <= 2;
    if (soCategoria){ SC.mapa.filtro(cat[0], mostrarCat); return {ok: true, msg: responder('__cmd_ok', 'Feito.')}; }
  }
  // busca
  if ((m = /^(busca|buscar|procura|procurar|pesquisa|pesquisar|encontra|encontrar|acha|achar)\s+(?:por\s+)?(.+)$/.exec(t))){
    abrirPal({texto: m[2]}); return {ok: true, msg: responder('__cmd_busca', 'Buscando.')};
  }
  // painel (workspace) de um sistema
  if ((m = /\b(workspace|painel|detalhes|pagina)\b\s+(?:da|do|de)\s+(.+)$/.exec(t))){
    const r = resolverAlvo(m[2]);
    if (r && r.tipo === 'sistema'){ abrirWS(r.c.id); return {ok: true, msg: responder('__cmd_ws', 'Abrindo o painel do sistema.')}; }
  }
  // abrir sistema ou nota
  m = /^(abre|abrir|abra|mostra|mostrar|vai para|ir para|vai pra|leva para|me leva para|foca|focar|seleciona|selecionar|entra|entrar|ver|veja)\s+(.+)$/.exec(t);
  const alvo = m ? m[2] : t;
  const r = resolverAlvo(alvo);
  if (r && (m || (r.pontos >= 72 && t.split(' ').length <= 4))){
    if (WS.aberto) fecharWS();
    if (r.tipo === 'sistema'){
      selecionarSistema(r.c.id, {voar: true});
      return {ok: true, msg: responder(`__abrir:${r.c.id}`, `Abrindo ${nomeSistema(r.c)}.`)};
    }
    selecionarNo(r.n.id, {voar: true});
    responder('__cmd_nota', 'Abrindo a nota.');
    return {ok: true, msg: r.n.id};
  }
  if (CFG) return {conversa: true};
  responder('__cmd_nao_entendi', 'Não entendi.', 'erro');
  return {ok: false, msg: 'Não entendi. Diga "ajuda" para ver os comandos.'};
}

/* ---------- escuta (nativa no app, Web Speech no navegador) ---------- */
// nomes do vault que o reconhecedor deve preferir (sistemas, partes dos nomes e projetos)
let _termos = null;
function termosVoz(){
  if (_termos) return _termos;
  const t = new Set(['Jarvis', 'Segundo Cérebro']);
  for (const c of clusters) apelidosSistema(c).forEach(n => t.add(String(n)));
  for (const n of nos) if (n.tipo === 'projeto' || n.tipo === 'cliente') { t.add(n.id); t.add(n.id.split(' — ')[0]); }
  return (_termos = [...t].filter(x => x && x.length >= 3 && x.length <= 60));
}
function ouvir(){
  if (Voz.ouvindo) return;
  const tipo = vozDisponivel();
  if (!tipo){ toast('Comandos de voz não estão disponíveis neste navegador. Use o app Segundo Cérebro ou o Chrome.', {tipo: 'aviso'}); return; }
  interromperConversa();   // o Claude ainda estava trabalhando na pergunta anterior: para na hora
  Voz.ouvindo = true; Voz.texto = ''; Voz.executado = false; Voz.pedido++;
  SC.mapa.pararFala(); SC.mapa.sinal('ouvir');
  pintarVoz('ouvindo', Voz.segurando ? 'Solte o ⌘ para enviar' : 'Fale ou pergunte…');
  clearTimeout(Voz.timerLimite); Voz.timerLimite = setTimeout(() => parar(), 25000);
  if (tipo === 'nativa'){
    try { window.webkit.messageHandlers.escuta.postMessage({acao: 'iniciar', termos: termosVoz()}); }
    catch (e){ falhaVoz('Não consegui ligar o microfone.'); }
    return;
  }
  const R = window.SpeechRecognition || window.webkitSpeechRecognition;
  const rec = new R(); rec.lang = 'pt-BR'; rec.interimResults = true; rec.continuous = !!Voz.segurando; rec.maxAlternatives = 1;
  rec.onresult = e => {
    let txt = '', fim = false;
    for (let i = 0; i < e.results.length; i++){ txt += e.results[i][0].transcript; if (e.results[i].isFinal) fim = true; }
    aoTexto(txt, fim && !Voz.segurando);
  };
  rec.onerror = e => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') falhaVoz('Permita o uso do microfone para os comandos de voz.'); else if (e.error !== 'no-speech' && e.error !== 'aborted') falhaVoz('Não consegui ouvir (' + e.error + ').'); };
  rec.onend = () => aoFim();
  Voz.rec = rec;
  try { rec.start(); } catch (e){ falhaVoz('Não consegui ligar o microfone.'); }
}
function parar(){
  if (!Voz.ouvindo) return;
  clearTimeout(Voz.timerLimite); clearTimeout(Voz.timerSilencio);
  if (vozDisponivel() === 'nativa'){ try { window.webkit.messageHandlers.escuta.postMessage({acao: 'parar'}); } catch (e) {} }
  else if (Voz.rec){ try { Voz.rec.stop(); } catch (e) {} }
  pintarVoz('pensando', Voz.texto ? '› ' + Voz.texto : 'Processando…');
  // se o reconhecimento não devolver nada em 2,5 s, encerra
  setTimeout(() => { if (Voz.ouvindo && !Voz.executado) aoFim(); }, 2500);
}
function aoTexto(txt, fim){
  if (!Voz.ouvindo || Voz.executado) return;
  Voz.texto = String(txt || '').trim();
  pintarVoz('ouvindo', Voz.texto ? '› ' + Voz.texto : 'Fale ou pergunte…');
  clearTimeout(Voz.timerSilencio);
  if (fim) return finalizarVoz();
  // clicando no MIC (sem segurar o ⌘), uma pausa de 1,6 s depois de falar encerra sozinho
  if (!Voz.segurando && Voz.texto) Voz.timerSilencio = setTimeout(() => parar(), 1600);
}
function aoFim(){
  if (!Voz.ouvindo) return;
  if (!Voz.executado && Voz.texto) return finalizarVoz();
  Voz.ouvindo = false; Voz.rec = null;
  if (!Voz.executado){ SC.mapa.sinal('fim'); pintarVoz('vazio', 'Não ouvi nada. Segure ⌘ e fale.'); fecharVozDepois(2200); }
}
function finalizarVoz(){
  if (Voz.executado) return;
  Voz.executado = true; Voz.ouvindo = false;
  clearTimeout(Voz.timerLimite); clearTimeout(Voz.timerSilencio);
  if (vozDisponivel() === 'nativa'){ try { window.webkit.messageHandlers.escuta.postMessage({acao: 'parar'}); } catch (e) {} }
  else if (Voz.rec){ try { Voz.rec.abort(); } catch (e) {} Voz.rec = null; }
  despachar(Voz.texto);
}
// comando ou conversa, venha da voz ou do teclado (tecla J)
function despachar(texto){
  let r;
  try { r = executarComando(texto); } catch (e){ console.error(e); r = {ok: false, msg: 'Erro ao executar o comando.'}; }
  if (r.conversa) return conversar(texto);
  pintarVoz(r.ok ? 'ok' : 'erro', r.msg, texto);
  fecharVozDepois(r.ok ? 2600 : 4000);
}
function processarTexto(texto){
  texto = String(texto || '').trim();
  if (!texto) return;
  Voz.texto = texto; Voz.ouvindo = false; Voz.executado = true;
  interromperConversa(); Voz.pedido++;
  SC.mapa.pararFala();
  if (SC.jarvis && SC.jarvis.falando()) SC.jarvis.parar();
  despachar(texto);
}
// pergunta livre → Claude lendo o vault (servidor) → resposta na tela, falada, e as notas citadas destacadas no mapa
// falas enquanto o Claude pesquisa (gerar_mapa.py → FALAS_*): saudação na 1ª pergunta (ou após 1 h parado),
// depois o sistema citado ou uma variação que não repete a anterior; se demorar, uma frase de espera
const sorteio = {};
function sortear(prefixo){
  const chaves = Object.keys((window.DADOS && DADOS.narracao) || {}).filter(k => k.startsWith(prefixo));
  if (!chaves.length) return null;
  const livres = chaves.filter(k => k !== sorteio[prefixo]);
  return (sorteio[prefixo] = (livres.length ? livres : chaves)[Math.floor(Math.random() * (livres.length || chaves.length))]);
}
function falarChave(chave){ const t = chave && narracaoDe(chave); if (t) SC.mapa.narrar(chave, t); return t; }
function introducao(texto){
  const agora = Date.now(), primeira = !Voz.ultimaConversa || agora - Voz.ultimaConversa > 3600e3;
  Voz.ultimaConversa = agora;
  if (primeira){
    const h = new Date().getHours();
    return falarChave(sortear(`__saud_${h >= 5 && h < 12 ? 'manha' : h >= 12 && h < 18 ? 'tarde' : 'noite'}_`));
  }
  const r = resolverAlvo(semChamado(normVoz(texto)));
  const sis = r && r.tipo === 'sistema' && r.pontos >= 66 ? `__pesq:${r.c.id}` : null;
  if (sis && sis !== Voz.ultimaIntro && narracaoDe(sis)){ Voz.ultimaIntro = sis; return falarChave(sis); }
  Voz.ultimaIntro = null;
  return falarChave(sortear('__pensa_'));
}
const esperar = ms => new Promise(ok => setTimeout(ok, ms));
async function esperarSilencio(pedido, max = 9000){
  const fim = Date.now() + max;
  while (SC.mapa.falando() && Date.now() < fim && pedido === Voz.pedido) await esperar(120);
}
async function conversar(texto){
  const pedido = ++Voz.pedido;
  Voz.emAndamento = pedido; Voz.avisoFalado = false; Voz.respondeu = false;
  SC.mapa.sinal('ok');
  conectarEventos();
  // 1ª pergunta (ou mais de 1 h parado): a saudação gravada abre. Depois, quem avisa é o próprio Claude (evento 'aviso',
  // falado na voz dele em até ~2 s); as frases gravadas só entram se o aviso não vier (2,6 s) e nas esperas longas.
  const agora = Date.now(), primeira = !Voz.ultimaConversa || agora - Voz.ultimaConversa > 3600e3;
  Voz.ultimaConversa = agora;
  let intro = null;
  if (primeira){
    const h = new Date().getHours();
    intro = falarChave(sortear(`__saud_${h >= 5 && h < 12 ? 'manha' : h >= 12 && h < 18 ? 'tarde' : 'noite'}_`));
    if (intro) Voz.avisoFalado = true;
  }
  pintarVoz('pensando', intro || 'Consultando o Segundo Cérebro…', texto);
  const timers = [2600, 13000, 25000].map((ms, i) => setTimeout(() => {
    if (pedido !== Voz.pedido || Voz.respondeu || SC.mapa.falando()) return;
    if (i === 0 && Voz.avisoFalado) return;
    let t = null;
    if (i === 0){   // o sistema citado tem fala própria ("Acessando o sistema X…")? senão, uma frase de espera
      const r = resolverAlvo(semChamado(normVoz(texto)));
      const sis = r && r.tipo === 'sistema' && r.pontos >= 66 ? `__pesq:${r.c.id}` : null;
      t = (sis && sis !== Voz.ultimaIntro && narracaoDe(sis)) ? falarChave(Voz.ultimaIntro = sis) : falarChave(sortear('__pensa_'));
    } else t = falarChave(sortear('__espera_'));
    if (t){ Voz.avisoFalado = true; pintarVoz('pensando', t, texto); }
  }, ms));
  try { await conversarResposta(texto, pedido); } finally { timers.forEach(clearTimeout); if (Voz.emAndamento === pedido) Voz.emAndamento = 0; }
}
/* eventos do servidor durante a pergunta (SSE em /api/eventos): o aviso que o Claude escreveu antes de pesquisar
   (com áudio na voz do Jarvis, em cache) e cada nota que ele está lendo (pulsa no mapa) */
function aoEventoConversa(ev){
  if (!ev || ev.pedido !== Voz.pedido || Voz.respondeu) return;
  const ouvido = Voz.texto;
  if (ev.tipo === 'aviso' && ev.texto){
    if (Voz.avisoFalado && SC.mapa.falando()){ pintarVoz('pensando', ev.texto, ouvido); return; }   // já há fala no ar: só legenda
    Voz.avisoFalado = true;
    const audio = ev.audio || null;
    if (audio && SC.mapa.vozExterna() && SC.jarvis && SC.jarvis.ativo()){
      SC.jarvis.falar({texto: ev.texto, audio, frases: ev.frases || null, duracao: ev.duracao || null, centro: true, suave: true,
        manter: true, ouvido, depois: 'Consultando o Segundo Cérebro…'});
    } else if (audio && SC.mapa.vozExterna()){ pintarVoz('pensando', ev.texto, ouvido); SC.mapa.falar(ev.texto, audio); }
    else { pintarVoz('pensando', ev.texto, ouvido); if (!SC.mapa.falando()) falarChave(sortear('__pensa_')); }
  } else if (ev.tipo === 'lendo'){
    const ids = (ev.notas || []).filter(id => porId.has(id));
    if (ids.length && SC.mapa.lendo) SC.mapa.lendo(ids);
    if (!(SC.jarvis && SC.jarvis.falando())) pintarVoz('pensando', ev.rotulo || 'Lendo o vault…', ouvido);
  }
}
async function conectarEventos(){
  if (!CFG || Voz.eventosOn) return;
  Voz.eventosOn = true;
  let espera = 1000;
  for (;;){
    try {
      const r = await fetch(`${CFG.api}/eventos`, {headers: {'X-SC-Token': CFG.token}, cache: 'no-store'});
      if (!r.ok || !r.body) throw new Error('eventos ' + r.status);
      espera = 1000;
      const leitor = r.body.getReader(), dec = new TextDecoder();
      let buf = '';
      for (;;){
        const {value, done} = await leitor.read();
        if (done) break;
        buf += dec.decode(value, {stream: true});
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0){
          const bloco = buf.slice(0, i); buf = buf.slice(i + 2);
          const dados = bloco.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('\n');
          if (dados){ try { aoEventoConversa(JSON.parse(dados)); } catch (e) {} }
        }
      }
    } catch (e) {}
    await esperar(espera); espera = Math.min(15000, espera * 2);
  }
}
function postar(rota, corpo){
  return fetch(`${CFG.api}/${rota}`, {method: 'POST', cache: 'no-store',
    headers: {'X-SC-Token': CFG.token, 'Content-Type': 'application/json'}, body: JSON.stringify(corpo || {})});
}
// ele começou a falar (ou digitou) com uma pergunta ainda em andamento: o Claude para na hora
function interromperConversa(){
  if (!Voz.emAndamento || !CFG) return;
  Voz.emAndamento = 0; Voz.pedido++;
  postar('conversa/interromper').catch(() => {});
}
function novaConversa(){
  if (!CFG) return;
  interromperConversa(); SC.mapa.pararFala(); if (SC.jarvis) SC.jarvis.parar();
  postar('conversa/nova').catch(() => {});
  Voz.ultimaConversa = 0; Voz.ultimaIntro = null;
  SC.mapa.sinal('ok'); pintarVoz('ok', 'Conversa nova. O Jarvis esqueceu o assunto anterior.'); fecharVozDepois(2600);
}
/* digitar para o Jarvis (tecla J): mesmo caminho da voz */
function abrirDigitar(){
  if (!CFG){ toast('Digitar para o Jarvis precisa do app Segundo Cérebro (servidor local).', {tipo: 'aviso'}); return; }
  let el = $('#sc-digitar');
  if (!el){
    el = document.createElement('form'); el.id = 'sc-digitar'; el.className = 'sc-raiz';
    el.innerHTML = '<small>JARVIS · DIGITE</small><input type="text" placeholder="Pergunte ou peça algo… Enter envia, Esc fecha" autocomplete="off" spellcheck="false" aria-label="Pergunta para o Jarvis">';
    document.body.append(el);
    const inp = $('input', el);
    el.addEventListener('submit', e => { e.preventDefault(); const v = inp.value.trim(); inp.value = ''; fecharDigitar(); if (v) processarTexto(v); });
    inp.addEventListener('keydown', e => { if (e.key === 'Escape'){ e.preventDefault(); fecharDigitar(); } e.stopPropagation(); });
  }
  el.classList.add('on'); setTimeout(() => $('input', el).focus(), 20);
}
function fecharDigitar(){ const el = $('#sc-digitar'); if (el){ el.classList.remove('on'); $('input', el).blur(); } }
async function conversarResposta(texto, pedido){
  // fetch direto (não api()): a conversa só dispara 'dados-mudaram' quando uma ação por voz escreveu de fato
  let r;
  try {
    const resp = await postar('conversa', {texto, pedido});
    r = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(r.erro || `Erro ${resp.status}`);
  } catch (e){
    if (pedido !== Voz.pedido) return;
    Voz.respondeu = true;
    SC.mapa.sinal('erro');
    pintarVoz('erro', /fetch|load/i.test(e.message) ? 'Servidor local indisponível.' : e.message, texto); fecharVozDepois(6000);
    return;
  }
  if (pedido !== Voz.pedido) return;   // já começou outra fala
  Voz.respondeu = true;
  if (r.escrita){ aposEscrita(r.escrita); toast(r.escrita.mensagem || `Gravado: ${r.escrita.id || r.escrita.rel}`, {tipo: 'ok'}); }
  const resposta = r.resposta || '';
  let audio = null, frases = null, duracao = null;
  if (SC.mapa.vozExterna()){
    // com tempos por frase (legenda sincronizada do Jarvis); se o endpoint falhar, o mp3 simples
    try {
      const a = await postar('falar', {texto: resposta, tempos: true});
      if (a.ok){
        const j = await a.json();
        if (j.audio_base64){ audio = URL.createObjectURL(b64paraBlob(j.audio_base64, 'audio/mpeg')); frases = j.frases || null; duracao = j.duracao || null; }
      }
    } catch (e) {}
    if (!audio){ try { const a = await postar('falar', {texto: resposta}); if (a.ok) audio = URL.createObjectURL(await a.blob()); } catch (e) {} }
    if (pedido !== Voz.pedido){ if (audio) URL.revokeObjectURL(audio); return; }
  }
  await esperarSilencio(pedido);   // deixa a fala de abertura/espera terminar
  if (pedido !== Voz.pedido){ if (audio) URL.revokeObjectURL(audio); return; }
  const ids = (r.notas || []).filter(id => nos.some(n => n.id === id));
  const mostrarNotas = () => {
    if (pedido !== Voz.pedido || !ids.length) return;
    if (WS.aberto) fecharWS();
    if (ids.length === 1) selecionarNo(ids[0], {voar: true});
    else { fecharInspector(false); SC.mapa.destacar(ids); }
  };
  if (SC.jarvis && SC.jarvis.ativo()){
    // o Jarvis sempre fala do Núcleo, enquadrado; as notas citadas aparecem na legenda e a câmera vai até elas no fim da fala
    SC.jarvis.falar({texto: resposta, audio, frases, duracao, centro: true, ouvido: texto, notas: ids, aoFim: mostrarNotas});
  } else {
    mostrarNotas();
    pintarVoz('resposta', resposta, texto);
    SC.mapa.falar(resposta, audio);
  }
  if (audio) setTimeout(() => URL.revokeObjectURL(audio), 120000);
  fecharVozDepois(Math.min(40000, 6000 + resposta.length * 70));
}
// atalho com ⌘ no meio da fala: descarta sem executar nada
function cancelar(){
  if (!Voz.ouvindo) return;
  Voz.ouvindo = false; Voz.executado = true; Voz.pedido++;
  clearTimeout(Voz.timerLimite); clearTimeout(Voz.timerSilencio);
  if (Voz.rec){ try { Voz.rec.abort(); } catch (e) {} Voz.rec = null; }
  if (vozDisponivel() === 'nativa'){ try { window.webkit.messageHandlers.escuta.postMessage({acao: 'parar'}); } catch (e) {} }
  fecharVozDepois(0);
}
function falhaVoz(msg){
  Voz.ouvindo = false; Voz.executado = true; Voz.rec = null;
  clearTimeout(Voz.timerLimite); clearTimeout(Voz.timerSilencio);
  SC.mapa.sinal('erro'); pintarVoz('erro', msg); fecharVozDepois(5000);
}
// eventos do reconhecimento nativo (app/main.swift → SC.emit('escuta', …))
SC.on('escuta', ev => {
  if (!ev) return;
  if (ev.tipo === 'parcial') aoTexto(ev.texto, false);
  else if (ev.tipo === 'final') aoTexto(ev.texto, true);
  else if (ev.tipo === 'nivel' && Voz.el){ Voz.el.style.setProperty('--nivel', Math.min(1, ev.nivel * 6).toFixed(2)); if (SC.jarvis) SC.jarvis.nivel(ev.nivel); }
  else if (ev.tipo === 'erro') falhaVoz(ev.texto || 'Não consegui ouvir.');
  else if (ev.tipo === 'fim') aoFim();
});

/* ---------- interface ---------- */
function pintarVoz(estado, texto, ouvido){
  if (!Voz.el) return;
  clearTimeout(Voz.timerFechar);
  Voz.el.className = 'sc-raiz on ' + estado;
  const rot = {ouvindo: 'OUVINDO', pensando: 'PROCESSANDO', ok: 'ENTENDIDO', erro: 'NÃO ENTENDI', vazio: 'SILÊNCIO', resposta: 'JARVIS'}[estado] || '';
  Voz.el.querySelector('small').textContent = rot;
  Voz.el.querySelector('b').textContent = texto || '';
  Voz.el.querySelector('em').textContent = ouvido && estado !== 'ouvindo' ? '“' + ouvido + '”' : '';
  if (Voz.btn) Voz.btn.classList.toggle('on', estado === 'ouvindo' || estado === 'pensando');
  if (SC.jarvis && SC.jarvis.ativo()) SC.jarvis.estado(estado, texto, ouvido);   // o Núcleo mostra o mesmo estado
}
function fecharVozDepois(ms){
  clearTimeout(Voz.timerFechar);
  Voz.timerFechar = setTimeout(() => { if (!Voz.ouvindo && Voz.el){ Voz.el.className = 'sc-raiz'; if (Voz.btn) Voz.btn.classList.remove('on'); } }, ms);
  if (SC.jarvis && SC.jarvis.ativo()) SC.jarvis.ocultarDepois(ms);
}
function abrirAjudaVoz(){
  modal({rotulo: 'COMANDOS DE VOZ', titulo: 'Fale com o Segundo Cérebro',
    corpo: `<p class="sc-voz-ajuda-dica">Segure <b>⌘ Command</b> (ou clique em <b>MIC</b>), fale e solte. Pode começar com “Jarvis”.</p>
      <ul class="sc-voz-ajuda">
        <li><b>Pergunte o que quiser</b> — “Qual o status do projeto X?”, “O que falta no site?”: o Claude lê o vault e o Jarvis responde pelo Núcleo, no centro da tela, com a legenda no tempo da fala; se a resposta cita notas, a câmera vai até elas</li>
        <li><b>“Abre o Cliente X”</b> — voa até o sistema</li>
        <li><b>“Abre Site da Loja”</b> — abre uma nota pelo nome</li>
        <li><b>“Painel do Cliente X”</b> — abre o workspace do sistema</li>
        <li><b>“Busca contrato”</b> — abre a busca com o termo</li>
        <li><b>“Mostra as decisões travadas”</b> — destaca as 🔒</li>
        <li><b>“Modo apresentação”</b> · <b>“próximo”</b> · <b>“para a apresentação”</b></li>
        <li><b>“Visão geral”</b> · <b>“fecha”</b></li>
        <li><b>“Aproxima”</b> · <b>“afasta”</b> · <b>“pausa”</b> · <b>“continua”</b></li>
        <li><b>“Esconde os prompts”</b> · <b>“mostra o arquivo”</b></li>
        <li><b>“Silêncio”</b> · <b>“liga o som”</b></li>
        <li><b>“Bom dia”</b> ou <b>“resumo do dia”</b> — o Jarvis faz o briefing: pendências urgentes, o que foi tocado por último, projetos ativos</li>
        <li><b>“Anota na inbox…”</b>, <b>“cria uma tarefa…”</b>, <b>“marca como feita…”</b>, <b>“registra a decisão…”</b> — ele propõe e pergunta “Confirma, senhor?”; só grava depois do seu <b>“confirma”</b></li>
        <li>Falar por cima dele <b>interrompe</b> a resposta e para a pesquisa na hora · <b>“nova conversa”</b> (ou <b>Shift+J</b>) faz ele esquecer o assunto</li>
        <li>Tecla <b>J</b> — digitar para o Jarvis em vez de falar</li>
      </ul>`,
    largura: 520});
}
function montarVoz(){
  const tipo = vozDisponivel();
  const el = document.createElement('div');
  el.id = 'sc-voz'; el.className = 'sc-raiz'; el.setAttribute('aria-live', 'polite');
  el.innerHTML = '<div class="sc-voz-onda" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div><div class="sc-voz-txt"><small></small><b></b><em></em></div>';
  document.body.append(el); Voz.el = el;
  const controles = $('.controls'), vozBtn = $('#voz');
  if (controles && tipo){
    const b = document.createElement('button');
    b.type = 'button'; b.id = 'mic'; b.className = 'som'; b.textContent = 'MIC';
    b.title = 'Comando de voz — segure ⌘ Command e fale'; b.setAttribute('aria-label', 'Comando de voz (segure Command)');
    b.addEventListener('click', () => { Voz.segurando = false; Voz.ouvindo ? parar() : ouvir(); });
    controles.insertBefore(b, vozBtn || controles.firstChild);
    Voz.btn = b;
  }
  // segurar ⌘ Command sozinho = falar (fora de campos de texto e janelas). Só liga depois de 350 ms sem outra
  // tecla, e qualquer tecla ou clique com o ⌘ apertado (⌘K, ⌘R, ⌘C…) cancela — os atalhos seguem normais.
  let timerCmd = 0;
  const soltarCmd = enviar => {
    clearTimeout(timerCmd); timerCmd = 0;
    if (!Voz.segurando) return;
    Voz.segurando = false; enviar ? parar() : cancelar();
  };
  addEventListener('keydown', e => {
    // J = digitar para o Jarvis · Shift+J = conversa nova (só com o servidor, fora de campos de texto e janelas;
    // N, T, D e P já são da interface: nova nota, tarefa, decisão e apresentação — ui/60-shell.js)
    if (CFG && !e.metaKey && !e.ctrlKey && !e.altKey && !e.repeat && e.code === 'KeyJ'
        && !(e.target.closest && e.target.closest('input,textarea,select,[contenteditable="true"]'))
        && !(typeof pilha !== 'undefined' && pilha.length) && !Voz.ouvindo){
      e.preventDefault(); e.stopImmediatePropagation();
      if (e.shiftKey) novaConversa(); else abrirDigitar();
      return;
    }
    if (e.key !== 'Meta'){ if (e.metaKey && (timerCmd || Voz.segurando)) soltarCmd(false); return; }
    if (e.repeat || e.shiftKey || e.ctrlKey || e.altKey || !vozDisponivel() || Voz.ouvindo) return;
    if (e.target.closest && e.target.closest('input,textarea,select,[contenteditable="true"]')) return;
    if (typeof pilha !== 'undefined' && pilha.length && pilha[pilha.length - 1].tipo !== 'pagina') return;
    clearTimeout(timerCmd);
    timerCmd = setTimeout(() => { timerCmd = 0; Voz.segurando = true; ouvir(); }, 350);
  }, true);
  addEventListener('keyup', e => { if (e.key === 'Meta') soltarCmd(true); }, true);
  addEventListener('mousedown', e => { if (e.metaKey) soltarCmd(false); }, true);
  addEventListener('blur', () => soltarCmd(false));
}
montarVoz();
SC.on('mapa-pronto', () => { if (CFG) conectarEventos(); });
SC.voz = {ouvir, parar, executar: executarComando, disponivel: vozDisponivel, digitar: abrirDigitar, novaConversa, processar: processarTexto,
  evento: aoEventoConversa, depurar: () => ({pedido: Voz.pedido, emAndamento: Voz.emAndamento, respondeu: Voz.respondeu, ouvindo: Voz.ouvindo})};
