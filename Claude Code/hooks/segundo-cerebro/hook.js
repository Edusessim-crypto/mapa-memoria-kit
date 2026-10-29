#!/usr/bin/env node
// Segundo Cérebro — leitura automática para Claude Code.
// Uso: node hook.js <session-start|prompt>   (recebe o JSON do hook via stdin)
//
// O INDEX inteiro já entra no SessionStart (inclusive após compactação e resume,
// porque o matcher é vazio). Por isso o hook de prompt NÃO repete a seção do INDEX — só aponta
// para ela — e injeta uma única vez por sessão o que ainda não está no contexto (🔒 do cliente,
// lembrete de stack). O estado da sessão fica em um arquivo temporário por session_id.
const fs = require('fs');
const os = require('os');
const path = require('path');

// Caminho do vault: ~/.config/segundo-cerebro/vault (gravado pelo instalador) ou a variável SC_VAULT.
function acharVault() {
  if (process.env.SC_VAULT) return process.env.SC_VAULT;
  try {
    const p = fs.readFileSync(path.join(os.homedir(), '.config/segundo-cerebro/vault'), 'utf8').trim();
    if (p) return p.replace(/^~(?=\/|$)/, os.homedir());
  } catch (_) {}
  return '';
}
const VAULT = acharVault();
if (!VAULT) process.exit(0);
const INDEX = path.join(VAULT, '00 - CENTRAL/INDEX.md');
const PREFS = path.join(VAULT, '00 - CENTRAL/Preferências de Trabalho.md');
const TRAVADOS = path.join(VAULT, '00 - CENTRAL/Padrões Travados.md');
const STACK = path.join(VAULT, '45 - STACK E PADRÕES/Stack Técnica.md');

const mode = process.argv[2];
let input = {};
try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch (_) {}

const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch (_) { return ''; } };
const stripFront = (s) => s.replace(/^---\n[\s\S]*?\n---\n/, '');
const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const tilde = (p) => (p || '').replace(os.homedir(), '~');

function emit(event, context) {
  if (!context) return;
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: event, additionalContext: context },
  }));
}

// ---- estado por sessão (o que já foi injetado) ----
const sessionId = typeof input.session_id === 'string' ? input.session_id.replace(/[^a-zA-Z0-9_-]/g, '') : '';
const SESSION_FILE = sessionId ? path.join(os.tmpdir(), `segundo-cerebro-${sessionId}.json`) : '';
function lerSessao() {
  if (!SESSION_FILE) return null;
  try { return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8')); } catch (_) { return null; }
}
function gravarSessao(s) {
  if (!SESSION_FILE) return;
  try { fs.writeFileSync(SESSION_FILE, JSON.stringify(s)); } catch (_) {}
}

// Seções "### X" do INDEX → chaves de busca (nomes de projeto/cliente) + texto da seção.
function indexSections(index) {
  const out = [];
  const parts = index.split(/\n(?=### )/);
  for (const part of parts.slice(1)) {
    const heading = part.split('\n')[0].replace(/^###\s*/, '');
    const body = part.split(/\n## /)[0];
    const keys = heading.split('·').map((k) => k.replace(/\(.*?\)/g, '').trim()).filter((k) => k && k !== 'Outros');
    out.push({ heading, body, keys });
  }
  return out;
}

// Seções "## X" de Padrões Travados.
function travadosSection(travados, name) {
  const parts = travados.split(/\n(?=## )/);
  const hit = parts.find((p) => norm(p.split('\n')[0]).includes(norm(name)));
  return hit ? hit.trim() : '';
}

function matchProjects(text, cwd) {
  const index = read(INDEX);
  const t = norm(text);
  const c = tilde(cwd);
  const found = [];
  for (const s of indexSections(index)) {
    const byName = s.keys.some((k) => new RegExp(`(^|[^a-z0-9])${escapeRe(norm(k))}([^a-z0-9]|$)`).test(t));
    const codePaths = [...s.body.matchAll(/`(~\/[^`]+)`/g)].map((m) => m[1]);
    const byCwd = c && codePaths.some((p) => c === p || c.startsWith(p + '/'));
    if (byName || byCwd) found.push(s);
  }
  return found;
}

const PROTOCOLO = `# 🧠 Segundo Cérebro — protocolo automático (obrigatório, o usuário nunca vai pedir)
Vault: ${VAULT}
ANTES de executar qualquer tarefa: use o INDEX abaixo para identificar projeto/cliente/tema (inclusive de OUTROS projetos com stack, padrão ou decisão parecida). Abra só as notas-âncora e decisões relevantes (nunca o vault inteiro). Aplique esse contexto sem pedir que o usuário repita. Se o pedido atual CONFLITAR com decisão, preferência ou 🔒 registrado, AVISE e pergunte antes de executar — nunca sobrescreva em silêncio.
REGISTRO: NÃO escreva no vault durante a sessão. Registre só quando o usuário rodar /finalizar-sessao (ou pedir explicitamente "guarde isso"/salvar-memoria): registrar a cada entrega deixa as sessões lentas.`;

if (mode === 'session-start') {
  const index = stripFront(read(INDEX));
  if (!index) process.exit(0);
  const prefs = stripFront(read(PREFS));
  const geral = travadosSection(read(TRAVADOS), 'Geral');
  const proj = matchProjects('', input.cwd);
  let ctx = `${PROTOCOLO}\n\n## INDEX\n${index}\n\n## Preferências de Trabalho\n${prefs}\n\n## 🔒 Padrões travados gerais\n${geral}`;
  if (proj.length) {
    // A seção do projeto já está no INDEX acima — só apontar, sem repetir o texto.
    ctx += `\n\n## Projeto do diretório atual (${tilde(input.cwd)})\n` +
      proj.map((s) => `Seção "${s.heading}" do INDEX acima.`).join('\n') +
      '\n→ Leia a nota principal deste projeto antes da primeira tarefa.';
  }
  // Começa (ou recomeça, após compactação/resume) o registro do que já entrou no contexto.
  gravarSessao({ inicio: Date.now(), travados: [], stack: false });
  emit('SessionStart', ctx);
}

else if (mode === 'prompt') {
  const prompt = input.prompt || '';
  const found = matchProjects(prompt, '');
  const travados = read(TRAVADOS);
  const sessao = lerSessao(); // null = sem registro (SessionStart não rodou?) → comportamento completo
  const estado = sessao || { travados: [], stack: false };
  let ctx = '🧠 Segundo Cérebro: antes de executar, confira no INDEX (já carregado) projetos, decisões, stack e padrões relacionados a este pedido — inclusive de outros projetos — e avise se algo conflitar. Não registre no vault agora (só em /finalizar-sessao).';
  for (const s of found) {
    if (sessao) {
      ctx += `\n\nRelacionado: seção "${s.heading}" do INDEX (já no contexto).`;
    } else {
      ctx += `\n\n### Relacionado: ${s.heading}\n${s.body.replace(/^### .*\n/, '').trim()}`;
    }
    for (const k of s.keys) {
      const sec = travadosSection(travados, k);
      if (!sec) continue;
      const titulo = sec.split('\n')[0];
      if (estado.travados.includes(titulo)) { ctx += `\n🔒 ${titulo.replace(/^## /, '')}: já carregado nesta sessão.`; }
      else { ctx += `\n\n${sec}`; estado.travados.push(titulo); }
      break;
    }
  }
  if (/\b(stack|framework|biblioteca|banco|deploy|hospedagem|next|react|supabase|html)\b/i.test(prompt) && read(STACK)) {
    if (!estado.stack) {
      ctx += '\n\nPedido envolve stack/tecnologia → consulte 45 - STACK E PADRÕES/Stack Técnica.md e Padrões de Código.md.';
      estado.stack = true;
    }
  }
  if (sessao) gravarSessao(estado);
  emit('UserPromptSubmit', ctx);
}
