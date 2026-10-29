#!/bin/bash
# Instalador do Kit Segundo Cérebro (Mapa + Jarvis por voz + Claude Code).
# Uso: abra o Terminal, entre na pasta do kit e rode:  bash instalar.sh
#
# O que ele faz, nesta ordem (e nunca apaga nem sobrescreve uma nota sua):
#   1. confere os pré-requisitos (macOS, python3, node, Xcode Command Line Tools, claude);
#   2. pergunta onde fica o seu vault do Obsidian e cria nele só as pastas e notas que faltam;
#   3. copia o app Mapa para <vault>/99 - SISTEMA/Mapa e baixa as bibliotecas (three.js e fontes);
#   4. cria ~/.config/segundo-cerebro/elevenlabs.env (modelo, sem chave) se ainda não existir
#      e grava o caminho do vault em ~/.config/segundo-cerebro/vault;
#   5. instala o hook e as skills do Claude Code em ~/.claude, mescla o hook no settings.json
#      (com backup) e acrescenta o trecho do Segundo Cérebro ao ~/.claude/CLAUDE.md se ainda não estiver lá;
#   6. compila o app "Segundo Cérebro.app" em ~/Applications.
set -u
KIT="$(cd "$(dirname "$0")" && pwd)"
CONFIG_DIR="$HOME/.config/segundo-cerebro"
CLAUDE_DIR="$HOME/.claude"
APPS_DIR="${SC_APPS_DIR:-$HOME/Applications}"
HOJE="$(date +%Y%m%d-%H%M%S)"
FALTOU=0

titulo() { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok()     { printf '  ✔ %s\n' "$1"; }
aviso()  { printf '  • %s\n' "$1"; }
erro()   { printf '  ✖ %s\n' "$1"; }

# ------------------------------------------------------------------ 1. pré-requisitos
titulo "1/6  Conferindo o que o kit precisa"
if [ "$(uname -s)" != "Darwin" ]; then
  erro "Este kit é para Mac (macOS 13 ou mais novo)."; exit 1
fi
ok "macOS $(sw_vers -productVersion 2>/dev/null || echo '?')"

# o app usa sempre /usr/bin/python3 (o das Command Line Tools); o instalador usa o mesmo, se existir
if [ -x /usr/bin/python3 ] && /usr/bin/python3 --version >/dev/null 2>&1; then PY=/usr/bin/python3; else PY="$(command -v python3 || true)"; fi
if [ -n "$PY" ]; then ok "Python 3: $($PY --version 2>&1) ($PY)"; else
  erro "Python 3 não encontrado. Instale as Xcode Command Line Tools (xcode-select --install)."; FALTOU=1; fi
if command -v node >/dev/null 2>&1; then ok "Node: $(node --version)"; else
  erro "Node não encontrado (o hook do Claude Code precisa dele). Instale em nodejs.org ou com: brew install node"; FALTOU=1; fi
if xcode-select -p >/dev/null 2>&1 && command -v swiftc >/dev/null 2>&1; then ok "Xcode Command Line Tools (swiftc)"; else
  erro "Xcode Command Line Tools não encontradas (precisa delas para compilar o app). Rode: xcode-select --install"; FALTOU=1; fi
if command -v claude >/dev/null 2>&1 || [ -x "$HOME/.local/bin/claude" ] || [ -x "$HOME/.claude/local/claude" ]; then
  ok "Claude Code encontrado"
else
  aviso "Claude Code (comando 'claude') não encontrado. O mapa funciona, mas a conversa por voz com o Jarvis precisa dele."
  aviso "Instale (npm install -g @anthropic-ai/claude-code) e faça login com: claude"
fi
if [ "$FALTOU" = 1 ]; then
  printf '\nInstale o que está faltando e rode o instalador de novo.\n'; exit 1
fi

# ------------------------------------------------------------------ 2. vault
titulo "2/6  Onde fica o seu vault do Obsidian?"
printf '  Arraste a pasta do vault para esta janela (ou digite o caminho) e aperte Enter.\n  Se ainda não tem um vault, digite o caminho da pasta nova que quer criar.\n  > '
read -r VAULT_IN
VAULT="${VAULT_IN/#\~/$HOME}"
VAULT="$(printf '%s' "$VAULT" | sed -e 's/^ *//' -e 's/ *$//' -e "s/^'//" -e "s/'$//" -e 's/\\ / /g')"
if [ -z "$VAULT" ]; then erro "Caminho vazio."; exit 1; fi
if [ ! -d "$VAULT" ]; then
  printf '  A pasta não existe. Criar "%s"? [s/N] ' "$VAULT"; read -r R
  case "$R" in s|S|sim|Sim) mkdir -p "$VAULT" || { erro "Não consegui criar."; exit 1; } ;; *) exit 1 ;; esac
fi
VAULT="$(cd "$VAULT" && pwd)"
ok "Vault: $VAULT"

titulo "     Criando só o que falta no vault (notas que já existem ficam como estão)"
CRIADAS=0; PULADAS=0
while IFS= read -r -d '' ORIGEM; do
  REL="${ORIGEM#"$KIT/Vault modelo/"}"
  DEST="$VAULT/$REL"
  if [ -e "$DEST" ]; then
    case "$REL" in */.gitkeep) ;; *) aviso "já existe, mantida: $REL"; PULADAS=$((PULADAS+1)) ;; esac
  else
    mkdir -p "$(dirname "$DEST")" && cp "$ORIGEM" "$DEST" && CRIADAS=$((CRIADAS+1))
  fi
done < <(find "$KIT/Vault modelo" -type f -print0)
ok "$CRIADAS arquivos criados, $PULADAS já existiam"

# ------------------------------------------------------------------ 3. Mapa
titulo "3/6  Instalando o app Mapa em 99 - SISTEMA/Mapa"
MAPA="$VAULT/99 - SISTEMA/Mapa"
mkdir -p "$MAPA"
if [ -f "$MAPA/servidor.py" ]; then aviso "já havia um Mapa aqui: o código é atualizado; voz/, vendor/ e .estado/ ficam como estão"; fi
if command -v rsync >/dev/null 2>&1; then
  rsync -a --exclude '.estado' --exclude '__pycache__' --exclude 'vendor' --exclude 'voz/*.mp3' --exclude 'voz/roteiro' --exclude 'voz/saudacoes' "$KIT/Mapa/" "$MAPA/"
else
  cp -R "$KIT/Mapa/." "$MAPA/"
fi
ok "código copiado"
printf '  Baixando three.js e as fontes (precisa de internet, uma vez)... '
if "$PY" "$MAPA/baixar_vendor.py" >/dev/null 2>&1; then printf 'pronto.\n'; else
  printf 'não deu.\n'; aviso "Sem a pasta vendor/ o mapa carrega as bibliotecas pela internet. Para tentar de novo: $PY \"$MAPA/baixar_vendor.py\""; fi

# ------------------------------------------------------------------ 4. configuração
titulo "4/6  Configuração em ~/.config/segundo-cerebro"
mkdir -p "$CONFIG_DIR"
printf '%s\n' "$VAULT" > "$CONFIG_DIR/vault"
ok "caminho do vault gravado em $CONFIG_DIR/vault"
if [ -f "$CONFIG_DIR/elevenlabs.env" ]; then
  aviso "elevenlabs.env já existe, mantido (confira se tem SC_NOME=Roberto)"
else
  cp "$KIT/elevenlabs.env.exemplo" "$CONFIG_DIR/elevenlabs.env"
  chmod 600 "$CONFIG_DIR/elevenlabs.env"
  ok "elevenlabs.env criado (SC_NOME=Roberto; a chave e a voz do ElevenLabs ficam para você preencher)"
fi

# ------------------------------------------------------------------ 5. Claude Code
titulo "5/6  Claude Code: hook, skills, settings.json e CLAUDE.md"
mkdir -p "$CLAUDE_DIR/hooks/segundo-cerebro" "$CLAUDE_DIR/skills"
if [ -f "$CLAUDE_DIR/hooks/segundo-cerebro/hook.js" ]; then
  cp "$CLAUDE_DIR/hooks/segundo-cerebro/hook.js" "$CLAUDE_DIR/hooks/segundo-cerebro/hook.js.bak-$HOJE"
  aviso "hook.js já existia: backup em hook.js.bak-$HOJE"
fi
cp "$KIT/Claude Code/hooks/segundo-cerebro/hook.js" "$CLAUDE_DIR/hooks/segundo-cerebro/hook.js"
ok "hook instalado em ~/.claude/hooks/segundo-cerebro/hook.js"

for S in "$KIT/Claude Code/skills"/*/; do
  NOME="$(basename "$S")"
  mkdir -p "$CLAUDE_DIR/skills/$NOME"
  if [ -f "$CLAUDE_DIR/skills/$NOME/SKILL.md" ]; then
    cp "$CLAUDE_DIR/skills/$NOME/SKILL.md" "$CLAUDE_DIR/skills/$NOME/SKILL.md.bak-$HOJE"
    aviso "skill $NOME já existia: backup em SKILL.md.bak-$HOJE"
  fi
  sed "s#__VAULT__#$VAULT#g" "$S/SKILL.md" > "$CLAUDE_DIR/skills/$NOME/SKILL.md"
done
ok "6 skills instaladas em ~/.claude/skills (buscar-contexto, criar-projeto, finalizar-sessao, processar-inbox, revisar-memoria, salvar-memoria)"

SETTINGS="$CLAUDE_DIR/settings.json"
if [ -f "$SETTINGS" ]; then cp "$SETTINGS" "$SETTINGS.bak-$HOJE"; aviso "backup do settings.json em settings.json.bak-$HOJE"; fi
HOOK_CMD="node \"$CLAUDE_DIR/hooks/segundo-cerebro/hook.js\""
node - "$SETTINGS" "$HOOK_CMD" <<'EOF'
const fs = require('fs');
const [arquivo, cmd] = process.argv.slice(2);
let s = {};
try { s = JSON.parse(fs.readFileSync(arquivo, 'utf8')); } catch (_) { s = {}; }
if (typeof s !== 'object' || s === null || Array.isArray(s)) s = {};
s.hooks = s.hooks || {};
let mudou = false;
for (const [evento, modo] of [['SessionStart', 'session-start'], ['UserPromptSubmit', 'prompt']]) {
  const lista = Array.isArray(s.hooks[evento]) ? s.hooks[evento] : [];
  const jaTem = lista.some(g => (g.hooks || []).some(h => typeof h.command === 'string' && h.command.includes('segundo-cerebro/hook.js')));
  if (!jaTem) {
    lista.push({ matcher: '', hooks: [{ type: 'command', command: `${cmd} ${modo}`, timeout: 15 }] });
    mudou = true;
  }
  s.hooks[evento] = lista;
}
fs.writeFileSync(arquivo, JSON.stringify(s, null, 2) + '\n');
console.log(mudou ? '  ✔ hook mesclado no settings.json (o que já existia foi mantido)' : '  • settings.json já tinha o hook, nada mudou');
EOF

CLAUDE_MD="$CLAUDE_DIR/CLAUDE.md"
if [ -f "$CLAUDE_MD" ] && grep -q "Segundo Cérebro — memória de longo prazo" "$CLAUDE_MD"; then
  aviso "CLAUDE.md já tem a seção do Segundo Cérebro, nada acrescentado"
else
  { [ -f "$CLAUDE_MD" ] && [ -s "$CLAUDE_MD" ] && printf '\n\n'; sed "s#__VAULT__#$VAULT#g" "$KIT/Claude Code/CLAUDE.md-trecho.md"; } >> "$CLAUDE_MD"
  ok "trecho acrescentado ao ~/.claude/CLAUDE.md"
fi

# ------------------------------------------------------------------ 6. app
titulo "6/6  Compilando o app Segundo Cérebro.app"
if bash "$MAPA/app/construir.sh" "$APPS_DIR"; then
  ok "app em $APPS_DIR/Segundo Cérebro.app"
else
  erro "a compilação falhou. Confira as Xcode Command Line Tools (xcode-select --install) e rode de novo: bash \"$MAPA/app/construir.sh\""
fi

printf '\n\033[1mPronto.\033[0m Próximos passos:\n'
printf '  1. Abra %s/elevenlabs.env e preencha ELEVENLABS_API_KEY e ELEVENLABS_VOZ (opcional, para a voz do Jarvis).\n' "$CONFIG_DIR"
printf '  2. Abra o app "Segundo Cérebro" em %s e permita o microfone e o Reconhecimento de Fala quando o Mac perguntar.\n' "$APPS_DIR"
printf '  3. Abra o Claude Code em qualquer projeto: o INDEX do vault entra sozinho; ao terminar, rode /finalizar-sessao.\n'
printf '  Leia o LEIA-ME.md do kit para os detalhes.\n'
