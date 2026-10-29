/* Interface de vidro: ajustes de marcação que o CSS sozinho não faz — ícones de linha no lugar dos textos
   (Apresentação, Hoje), placeholder curto da busca, o orbe do Jarvis no centro de baixo e as faixas de
   enquadramento. Nada de função é removido: o microfone vira o orbe, o botão de apresentação vira um ícone. */
const ICONE = {
  play: '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M7 4l12 8-12 8z"></path></svg>',
  parar: '<svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg>',
  sol: '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"></path></svg>',
  alvo: '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="width:15px;height:15px"><circle cx="12" cy="12" r="8"></circle><circle cx="12" cy="12" r="2"></circle></svg>',
  som: '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px"><path d="M4 10v4h4l5 4V6l-5 4zM16 9a4 4 0 010 6"></path></svg>',
  tema: '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="2.2"></circle><path d="M4 12a8 8 0 0116 0"></path><path d="M7.5 12a4.5 4.5 0 019 0" opacity=".6"></path><circle cx="5" cy="18" r="1" fill="currentColor"></circle><circle cx="19" cy="18" r="1" fill="currentColor"></circle><circle cx="12" cy="20" r="1" fill="currentColor"></circle></svg>',
};
function vidroMontar(){
  // faixas de cinema
  if (!$('#cine-topo')){ const a = document.createElement('div'); a.id = 'cine-topo'; const b = document.createElement('div'); b.id = 'cine-base'; document.body.append(a, b); }
  // nome em caixa normal (o HTML vem em caixa alta) e lista de sistemas com os nomes reais
  const h1 = $('.brand h1'); if (h1){ const dot = $('.dot', h1); h1.textContent = 'Segundo Cérebro'; if (dot) h1.prepend(dot); }
  $$('#index li button').forEach(b => { const c = porCl.get(b.dataset.sis); const sp = b.querySelectorAll('span')[1]; if (c && sp) sp.textContent = nomeSistema(c); });
  // busca: só "Buscar ⌘K"
  const q = $('#q'); if (q) q.placeholder = 'Buscar';
  // apresentação: ícone + rótulo acessível; o texto muda quando o modo liga/desliga, então observa
  const tour = $('#tourBtn');
  if (tour){
    const pintar = () => { const on = tour.classList.contains('on'); if (tour.dataset.icone !== (on ? 'parar' : 'play')){ tour.dataset.icone = on ? 'parar' : 'play'; tour.innerHTML = ICONE[tour.dataset.icone]; } tour.setAttribute('aria-label', on ? 'Sair da apresentação' : 'Modo apresentação'); tour.title = tour.getAttribute('aria-label'); };
    pintar();
    new MutationObserver(muts => { if (muts.some(m => m.type === 'childList' && !tour.dataset.pintando || m.type === 'attributes')){ tour.dataset.pintando = '1'; pintar(); delete tour.dataset.pintando; } }).observe(tour, {childList: true, attributes: true, attributeFilter: ['class']});
  }
  // hoje: ícone de sol + ponto vermelho (o número fica no title)
  const hoje = $('#sc-hoje-btn');
  if (hoje && !hoje.dataset.icone){ hoje.dataset.icone = '1'; const n = $('.sc-hoje-n', hoje); hoje.innerHTML = ICONE.sol; if (n) hoje.append(n); }
  // tema do mapa: Holomapa (aprovado) ↔ Constelação (conceito do zero); a escolha fica salva e o mapa recarrega no lugar
  if (!$('#sc-tema-btn')){
    const b = document.createElement('button');
    b.type = 'button'; b.id = 'sc-tema-btn'; b.className = 'hud';
    const atual = (SC.mapa.tema && SC.mapa.tema()) || 'holomapa';
    const pintar = () => { b.innerHTML = ICONE.tema; b.setAttribute('aria-label', atual === 'constelacao' ? 'Tema: Constelação. Trocar para Holomapa' : 'Tema: Holomapa. Trocar para Constelação'); b.title = b.getAttribute('aria-label'); b.classList.toggle('constelacao', atual === 'constelacao'); };
    pintar();
    b.addEventListener('click', () => { const alvo = atual === 'constelacao' ? 'holomapa' : 'constelacao'; try { localStorage.setItem('sc-tema', alvo); } catch (e) {} recarregarMapa(alvo === 'constelacao' ? 'Tema Constelação.' : 'Tema Holomapa.'); });
    document.body.append(b);
  }
  // controles: visão geral e som como ícones
  const zfit = $('#zfit'); if (zfit && !zfit.dataset.icone){ zfit.dataset.icone = '1'; zfit.innerHTML = ICONE.alvo; }
  // orbe do Jarvis (substitui o botão MIC)
  if (!$('#sc-orbe')){
    const el = document.createElement('div'); el.id = 'sc-orbe'; el.className = 'sc-raiz';
    const temVoz = SC.voz && SC.voz.disponivel && SC.voz.disponivel();
    el.innerHTML = `<button type="button" aria-label="Falar com o Jarvis"></button><span>${temVoz ? 'segure ⌘ e fale com o Jarvis' : 'o Jarvis fala por aqui'}</span>`;
    $('button', el).addEventListener('click', () => {
      if (SC.voz && SC.voz.disponivel && SC.voz.disponivel()){ const mic = $('#mic'); if (mic) mic.click(); else SC.voz.ouvir(); }
      else if (SC.jarvis) SC.jarvis.demo(true);
    });
    document.body.append(el);
    SC.on('jarvis', ev => { if (!ev) return; el.className = 'sc-raiz ' + (ev.estado === 'repouso' ? '' : ev.estado); });
  }
}
SC.on('mapa-pronto', vidroMontar);
