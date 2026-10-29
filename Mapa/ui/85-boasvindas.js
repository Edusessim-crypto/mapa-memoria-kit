/* Boas-vindas: sempre que o app abre, o Jarvis cumprimenta de acordo com o momento (hora, dia da semana, a última
   sessão registrada, o que está pendente). O texto é escrito pelo Claude no servidor (/api/boasvindas, ver
   conversa.boas_vindas) e falado na voz do Jarvis; cada período do dia é gerado uma vez e fica em cache, para
   não gastar créditos a cada abertura. Fala depois da animação de abertura, com o Núcleo reagindo à voz. */
const BoasVindas = {dados: null, pedido: null, falou: false};

function boasVindasPermitidas(){
  if (!CFG || QS.has('jarvis') || QS.has('tour') || QS.get('saudacao') === '0') return false;
  try { if (sessionStorage.getItem('sc-saudou')) return false; } catch (e) {}   // ⌘R na mesma janela não repete
  return true;
}
function pedirBoasVindas(){
  if (!BoasVindas.pedido) BoasVindas.pedido = api('boasvindas').then(d => { BoasVindas.dados = d; return d; }).catch(() => null);
  return BoasVindas.pedido;
}
async function darBoasVindas(forcar){
  if ((BoasVindas.falou && !forcar) || (!forcar && !boasVindasPermitidas())) return false;
  BoasVindas.falou = true;
  const d = await Promise.race([pedirBoasVindas(), new Promise(r => setTimeout(() => r(null), 16000))]);
  if (!d || !d.texto) return false;
  // não atropela: se o usuário já está falando, ouvindo ou com uma janela aberta, deixa para a próxima abertura
  if (!SC.jarvis || !SC.jarvis.ativo() || SC.jarvis.estadoAtual() !== 'repouso' || SC.jarvis.falando()) return false;
  if (typeof pilha !== 'undefined' && pilha.length) return false;
  try { sessionStorage.setItem('sc-saudou', hojeISO()); } catch (e) {}
  // já cumprimentou: a 1ª pergunta não abre com outro "boa noite" (ui/70-voz.js decide pela ultimaConversa)
  if (typeof Voz !== 'undefined') Voz.ultimaConversa = Date.now();
  SC.jarvis.falar({texto: d.texto, audio: d.audio || null, frases: d.frases || null, duracao: d.duracao || null, centro: true, suave: true});
  return true;
}
if (boasVindasPermitidas()) pedirBoasVindas();   // pede enquanto o mapa ainda está abrindo
SC.on('revelado', () => setTimeout(darBoasVindas, REDUZ ? 500 : 1800));
SC.boasVindas = {falar: () => { BoasVindas.pedido = null; return darBoasVindas(true); }, dados: () => BoasVindas.dados};
