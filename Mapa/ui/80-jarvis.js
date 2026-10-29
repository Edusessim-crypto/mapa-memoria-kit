/* Jarvis no centro da tela. O Núcleo do holomapa é o próprio Jarvis: quando ele fala, a câmera o enquadra, o HUD
   some e o Núcleo reage ao áudio (ver o bloco "Jarvis" no loop do mapa, mapa3d.template.html). Esta camada cuida
   do que está em volta: a legenda sincronizada frase a frase (tempos do ElevenLabs ou estimativa), as notas citadas
   na resposta (etiquetas sob a legenda; a câmera vai até elas quando a fala termina), os estados ouvindo/pensando/erro
   e a demonstração (?jarvis=demo ou SC.jarvis.demo()). Substitui a barra #sc-voz de ui/70-voz.js no mapa 3D. */
const Jarvis = {el: null, estado: 'repouso', falando: false, frases: null, duracao: 0, idx: -1, raf: 0,
  timerOcultar: 0, mic: 0, pedido: 0};

function jarvisAtivo(){ return !!(SC.mapaAtivo && SC.mapa && typeof SC.mapa.jarvis === 'function'); }
function jarvisMontar(){
  if (Jarvis.el) return;
  const el = document.createElement('div');
  el.id = 'sc-jarvis'; el.className = 'sc-raiz'; el.setAttribute('aria-live', 'polite');
  el.innerHTML = '<div class="sc-jarvis-txt"><em></em><small></small><b></b><span class="sc-jarvis-prev"></span><div class="sc-jarvis-bar"><i></i></div>' +
    '<div class="sc-jarvis-notas"></div></div>';
  document.body.append(el);
  Jarvis.el = el;
  document.documentElement.classList.add('sc-jarvis');
}
function b64paraBlob(b64, tipo){
  const bin = atob(b64), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new Blob([u], {type: tipo});
}
// frases estimadas quando não há tempos do ElevenLabs: divide por pontuação e distribui pela duração do áudio
function frasesEstimadas(texto, duracao){
  const partes = String(texto || '').match(/[^.!?…;]+[.!?…;]*\s*/g) || [String(texto || '')];
  const total = partes.reduce((s, p) => s + p.length, 0) || 1;
  let t = 0;
  return partes.map(p => { const d = p.length / total * duracao; const f = {t, fim: t + d, texto: p.trim(), estimada: true}; t += d; return f; }).filter(f => f.texto);
}
function jarvisPintar(classe, rotulo, texto, ouvido){
  jarvisMontar();
  clearTimeout(Jarvis.timerOcultar);
  const el = Jarvis.el;
  el.className = 'sc-raiz on ' + classe;
  $('small', el).textContent = rotulo;
  $('b', el).textContent = texto || '';
  $('em', el).textContent = ouvido ? '“' + ouvido + '”' : '';
  if (classe !== 'falando'){ $('.sc-jarvis-prev', el).textContent = ''; $('.sc-jarvis-notas', el).textContent = ''; el.style.removeProperty('--p'); }
  jarvisAnimar();
}
// etiquetas das notas que a resposta cita (no máximo 4 + "+N")
function jarvisNotas(ids){
  const box = $('.sc-jarvis-notas', Jarvis.el);
  const lista = (ids || []).map(id => porId.get(id)).filter(Boolean);
  if (!lista.length){ box.textContent = ''; return; }
  const mais = lista.length > 4 ? `<i>+${lista.length - 4}</i>` : '';
  box.innerHTML = lista.slice(0, 4).map(n => `<span style="--c:var(${tipoDe(n.tipo).cor})">${esc(n.nome)}</span>`).join('') + mais;
}
function jarvisOcultar(){
  if (!Jarvis.el || Jarvis.falando) return;
  Jarvis.el.className = 'sc-raiz';
  Jarvis.estado = 'repouso';
  if (jarvisAtivo()) SC.mapa.jarvis('estado', {estado: 'repouso'});
  jarvisParaAnimar();
}
function jarvisOcultarDepois(ms){ clearTimeout(Jarvis.timerOcultar); Jarvis.timerOcultar = setTimeout(jarvisOcultar, ms); }

/* ---------- estados vindos dos comandos de voz (ui/70-voz.js) ---------- */
function jarvisEstado(estado, texto, ouvido){
  if (!jarvisAtivo()) return;
  if (Jarvis.falando && estado !== 'ouvindo') return;   // a fala em curso é quem manda; ouvir interrompe
  if (Jarvis.falando && estado === 'ouvindo'){ Jarvis.pedido++; Jarvis.falando = false; SC.mapa.pararFala(); }   // interrompe sem recuar a câmera
  const mapa = {ouvindo: 'ouvindo', pensando: 'pensando', ok: 'pensando', erro: 'erro', vazio: 'erro', resposta: 'falando'}[estado] || 'repouso';
  const rot = {ouvindo: 'Ouvindo', pensando: 'Processando', ok: 'Entendido', erro: 'Não entendi', vazio: 'Silêncio', resposta: 'Jarvis'}[estado] || '';
  Jarvis.estado = mapa;
  SC.mapa.jarvis('estado', {estado: mapa});
  jarvisPintar(estado === 'ok' ? 'ok' : mapa, rot, texto, ouvido);
}
function jarvisNivel(n){ Jarvis.mic = Math.max(0, Math.min(1, n * 6)); if (jarvisAtivo()) SC.mapa.jarvis('nivel', {nivel: Jarvis.mic}); }

/* ---------- fala da resposta ---------- */
// {texto, audio (URL) | null, frases [{t, fim, texto}] | null, duracao, centro, suave, ouvido, aoFim,
//  notas (ids citados: etiquetas na legenda; no fim o Núcleo é solto sem recuar a câmera, e aoFim leva até elas),
//  manter (aviso rápido: ao terminar volta a "pensando" em vez de recolher), depois (texto do estado seguinte)}
function jarvisFalar(op){
  if (!jarvisAtivo()) return false;
  jarvisMontar();
  const pedido = ++Jarvis.pedido;
  Jarvis.falando = true; Jarvis.estado = 'falando'; Jarvis.idx = -1;
  Jarvis.frases = op.frases && op.frases.length ? op.frases : null;
  Jarvis.duracao = op.duracao || (op.texto ? op.texto.length / 14 : 3);
  if (!Jarvis.frases) Jarvis.frases = op.audio ? frasesEstimadas(op.texto, Jarvis.duracao) : [{t: 0, fim: Jarvis.duracao, texto: op.texto}];   // sem áudio não há tempo para seguir: mostra tudo
  SC.mapa.jarvis('estado', {estado: 'falando', centro: !!op.centro, suave: !!op.suave});
  jarvisPintar('falando', 'Jarvis', Jarvis.frases[0] ? Jarvis.frases[0].texto : op.texto, op.ouvido);
  jarvisNotas(op.notas);
  Jarvis.idx = 0;
  const fim = () => {
    if (pedido !== Jarvis.pedido) return;
    Jarvis.falando = false;
    if (op.manter){   // aviso rápido: a resposta ainda vem — volta a "pensando" sem recuar a câmera
      Jarvis.estado = 'pensando'; SC.mapa.jarvis('estado', {estado: 'pensando'});
      jarvisPintar('pensando', 'Processando', op.depois || '', op.ouvido);
      if (op.aoFim) op.aoFim();
      return;
    }
    if (op.notas && op.notas.length) SC.mapa.jarvis('soltar', {voltar: false});   // a câmera sai do Núcleo direto para as notas
    // a última frase fica um instante, depois o Núcleo volta ao lugar
    Jarvis.timerOcultar = setTimeout(() => { if (pedido === Jarvis.pedido) jarvisOcultar(); }, REDUZ ? 300 : 1400);
    if (op.aoFim) op.aoFim();
  };
  if (op.audio){
    SC.mapa.tocar(op.audio, op.texto, fim).then(dur => {
      if (pedido !== Jarvis.pedido) return;
      if (dur === false){ fim(); return; }
      if (typeof dur === 'number' && dur > 0){
        // duração real do áudio: reescala as frases estimadas
        if (Jarvis.frases.every(f => f.estimada)) Jarvis.frases = frasesEstimadas(op.texto, dur);
        Jarvis.duracao = dur;
      }
    });
  } else {
    SC.mapa.falar(op.texto);   // voz do Mac (ou Jarvis ao vivo): sem tempos, só o envelope sintético
    // espera a fala começar e terminar
    let comecou = false, tentativas = 0;
    const limite = Math.ceil(((op.texto || '').length / 10 + 6) * 10);   // sem voz nenhuma, encerra pelo tamanho do texto
    const vigiar = () => {
      if (pedido !== Jarvis.pedido) return;
      const f = SC.mapa.jarvis('info').falando;
      if (f) comecou = true;
      if ((comecou && !f) || ++tentativas > limite) fim(); else setTimeout(vigiar, 100);
    };
    setTimeout(vigiar, 300);
  }
  return true;
}
function jarvisParar(){
  if (!Jarvis.falando) return;
  Jarvis.pedido++; Jarvis.falando = false;
  SC.mapa.pararFala();
  jarvisOcultar();
}

/* ---------- animação: legenda sincronizada ---------- */
function jarvisAnimar(){ if (!Jarvis.raf) Jarvis.raf = requestAnimationFrame(jarvisQuadro); }
function jarvisParaAnimar(){ cancelAnimationFrame(Jarvis.raf); Jarvis.raf = 0; }
function jarvisQuadro(){
  Jarvis.raf = 0;
  const el = Jarvis.el;
  if (!el || !el.classList.contains('on') || !Jarvis.falando || !Jarvis.frases) return;
  const info = SC.mapa.jarvis('info');
  const t = info.decorrido || 0, dur = info.duracao || Jarvis.duracao || 1;
  let i = Jarvis.idx;
  while (i + 1 < Jarvis.frases.length && Jarvis.frases[i + 1].t <= t + .06) i++;
  if (i !== Jarvis.idx && i >= 0){
    Jarvis.idx = i;
    const b = $('b', el), prev = $('.sc-jarvis-prev', el);
    prev.textContent = i > 0 ? Jarvis.frases[i - 1].texto : '';
    b.textContent = Jarvis.frases[i].texto;
    b.classList.remove('troca'); void b.offsetWidth; b.classList.add('troca');
  }
  el.style.setProperty('--p', Math.min(1, t / dur).toFixed(3));
  Jarvis.raf = requestAnimationFrame(jarvisQuadro);
}

/* ---------- demonstração: fala gravada do próprio vault, com legenda estimada ---------- */
function jarvisDemo(centro = true){
  const n = D && D.narracao;
  const item = n && (n.__cmd_ajuda || n.__teste);
  if (!item) return false;
  return jarvisFalar({texto: item.texto, audio: item.audio || null, centro, ouvido: 'Jarvis, me mostra o que você sabe fazer'});
}

SC.jarvis = {ativo: jarvisAtivo, estado: jarvisEstado, estadoAtual: () => Jarvis.estado, falando: () => Jarvis.falando, nivel: jarvisNivel, falar: jarvisFalar, parar: jarvisParar,
  ocultar: jarvisOcultar, ocultarDepois: jarvisOcultarDepois, demo: jarvisDemo};
SC.on('mapa-pronto', () => {
  jarvisMontar();
  if (QS.get('jarvis') === 'demo') setTimeout(() => jarvisDemo(true), REDUZ ? 600 : 7000);
});
