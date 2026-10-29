# Kit Segundo Cérebro — para o Roberto

Este kit instala no seu Mac duas coisas que trabalham juntas:

- **O app "Segundo Cérebro"** — um mapa 3D das suas notas do Obsidian, com o **Jarvis**: um assistente por voz que lê o seu vault, responde falando e, com a sua confirmação, anota coisas nele (inbox, tarefas, decisões).
- **A memória do Claude Code** — um hook e seis skills que fazem o Claude Code ler o seu vault no começo de toda sessão e gravar nele, no fim, só o que tem valor futuro (quando você roda `/finalizar-sessao`).

Tudo roda no seu Mac. Nada do seu vault é enviado para lugar nenhum além do Claude (quando você pergunta algo) e do ElevenLabs (só o texto das frases faladas, para virar áudio).

## O que vem na pasta

| Pasta / arquivo | O que é |
|---|---|
| `instalar.sh` | o instalador: faz tudo o que está descrito abaixo |
| `LEIA-ME.md` | este guia |
| `elevenlabs.env.exemplo` | modelo da configuração (nome, chave e voz do ElevenLabs, opções) |
| `Mapa/` | o código do app (vai para `<seu vault>/99 - SISTEMA/Mapa`) |
| `Vault modelo/` | a estrutura de pastas e as notas-base do sistema, vazias, para o seu vault |
| `Claude Code/` | o hook, as skills e o trecho do `CLAUDE.md` global |

## Antes de instalar — o que você precisa ter

1. **Um Mac** com macOS 13 ou mais novo.
2. **Xcode Command Line Tools** (compila o app e traz o Python). No Terminal: `xcode-select --install`.
3. **Python 3** — vem com as Command Line Tools. Confira com `python3 --version`.
4. **Node** — o hook do Claude Code roda nele. Baixe em nodejs.org ou, se tiver Homebrew, `brew install node`.
5. **Claude Code instalado e logado** — `npm install -g @anthropic-ai/claude-code` e depois `claude` para entrar na sua conta. É o login do Claude Code que o Jarvis usa para responder; não precisa de chave de API.
6. **Obsidian** com um vault (uma pasta). Pode ser um vault que você já usa ou uma pasta nova.
7. **Conta no ElevenLabs** (opcional, mas é o que dá a voz do Jarvis): uma chave de API e **uma voz** na sua biblioteca ("My Voices"). Sem isso o mapa fala com as vozes do próprio Mac, que soam bem mais robóticas.

## Como instalar

1. Abra o **Terminal** e baixe o kit (clone do repositório):
   ```
   cd ~/Downloads
   git clone https://github.com/Edusessim-crypto/mapa-memoria-kit.git
   cd mapa-memoria-kit
   bash instalar.sh
   ```
   Isso baixa o kit para a pasta `mapa-memoria-kit` dentro de Downloads e já abre o instalador (a pasta pode ser apagada depois de instalar).
2. (Se preferir, rode o instalador depois: `bash ~/Downloads/mapa-memoria-kit/instalar.sh`.)
3. O instalador confere os pré-requisitos e diz o que falta.
4. Ele pergunta **onde fica o seu vault**: arraste a pasta do vault para o Terminal e aperte Enter. Se a pasta não existir, ele oferece criar.
5. Ele então:
   - cria no vault **só o que falta** (pastas e notas-base). Se uma nota já existir, ele **não mexe** nela e avisa;
   - copia o app para `99 - SISTEMA/Mapa` e baixa as bibliotecas (precisa de internet);
   - cria `~/.config/segundo-cerebro/elevenlabs.env` a partir do modelo (se ainda não existir) e grava o caminho do vault em `~/.config/segundo-cerebro/vault`;
   - instala o hook e as skills em `~/.claude`, mescla o hook no `~/.claude/settings.json` (faz backup antes e não apaga o que já estava lá) e acrescenta o trecho do Segundo Cérebro ao `~/.claude/CLAUDE.md` (só se ainda não estiver lá);
   - compila o app `Segundo Cérebro.app` em `~/Applications`.

Pode rodar o instalador de novo quando quiser: ele nunca sobrescreve uma nota sua.

## Depois de instalar

### 1. Preencher a chave e a voz do ElevenLabs
Abra `~/.config/segundo-cerebro/elevenlabs.env` (no Finder: ⌘⇧G e cole o caminho; ou no Terminal: `open -e ~/.config/segundo-cerebro/elevenlabs.env`) e preencha:

```
SC_NOME=Roberto
ELEVENLABS_API_KEY=cole-a-sua-chave-aqui
ELEVENLABS_VOZ=nome da voz como está em My Voices (ou o ID da voz)
```

A chave fica nesse arquivo, fora do vault. Nunca copie a chave para dentro de uma nota. As outras opções do arquivo são explicadas em comentários; os padrões servem.

### 2. Abrir o app e liberar microfone e fala
Abra `Segundo Cérebro` em `~/Applications` (Finder → Ir → Aplicativos da sua pasta pessoal, ou pelo Spotlight). Na primeira vez que você usar a voz, o Mac pergunta duas coisas; responda **Permitir** nas duas:

- **Microfone**
- **Reconhecimento de Fala**

Se você negou sem querer: Ajustes do Sistema → Privacidade e Segurança → Microfone (e Reconhecimento de Fala) → ligue o Segundo Cérebro.

### 3. Usar o Jarvis
- Segure a tecla **⌘ Command** (ou clique em MIC) e fale. Solte para enviar.
- Exemplos: "Jarvis, qual o status do projeto X?", "abre o cliente Y", "o que tenho pra hoje?", "anota na inbox: ligar para o fornecedor", "cria uma tarefa no projeto X: revisar o logo".
- Quando você pede para **fazer** algo no vault, o Jarvis descreve o que vai fazer e pergunta "Confirma, senhor?". Diga "confirma" ou "pode" para executar; "não" ou "cancela" para desistir. Nada é gravado sem a sua confirmação.
- Diga "ajuda" para ouvir os comandos. Tecla **P** liga o modo apresentação (o mapa passeia pelos seus sistemas narrando cada um).
- ⌘R recarrega o mapa; ⌘K abre a busca.

Na primeira vez, o Jarvis não sabe nada do seu vault: o mapa fica pequeno até você criar notas. Vai crescendo conforme o vault cresce.

### 4. Usar o Claude Code com a memória
- Abra o Claude Code em qualquer pasta de projeto. O hook injeta sozinho o `INDEX.md`, as `Preferências de Trabalho` e os `Padrões Travados` gerais no começo da sessão; quando você cita um projeto ou cliente no pedido, ele injeta a seção daquele projeto.
- Trabalhe normalmente. O Claude **não grava** no vault durante a sessão.
- No fim, rode **`/finalizar-sessao`**: o Claude registra no vault só o que vale para o futuro — estado do projeto, decisões e o porquê, padrões que funcionaram ou foram rejeitados, aprendizados, pendências — e faz um commit local se o vault tiver git. Se não houve nada de valor, ele não escreve nada.
- Outras skills: `/buscar-contexto <assunto>` (puxa o contexto de um projeto), `/salvar-memoria` ("guarde isso", "trave isso"), `/criar-projeto <nome>`, `/processar-inbox`, `/revisar-memoria`.

## Como o vault é organizado

```
00 - CENTRAL          painéis: INDEX, Pendências, Decisões Recentes, Padrões Travados, Preferências de Trabalho…
10 - PROJETOS         uma nota por projeto (status, pendências, decisões, histórico)
20 - CLIENTES E MARCAS quem é cada cliente ou marca (o mapa agrupa as notas por eles)
30 - ÁREAS            áreas contínuas de trabalho (sem fim)
40 - CONHECIMENTO     o que você aprendeu e vale para outros projetos (+ Aprendizados, Erros a evitar)
45 - STACK E PADRÕES  tecnologias e padrões técnicos
50 - RECURSOS         prompts completos, SOPs (passo a passo), referências
60 - PESSOAS          pessoas (só dados públicos)
70 - DECISÕES         uma nota por decisão: o que foi decidido e por quê
80 - INBOX            entrada rápida, para classificar depois
90 - ARQUIVO          o que acabou ou foi substituído (nunca se apaga)
99 - SISTEMA          protocolo, modelos de nota (Templates) e o código do app (Mapa)
```

Os nomes das pastas e das notas de `00 - CENTRAL` **são fixos**: o app e o Claude procuram por eles. Dentro delas, escreva do seu jeito. O `INDEX.md` é o ponto de partida de tudo: para cada projeto, uma seção `### Nome do Projeto` com a nota principal, o cliente, a pasta de código e os assuntos (há um exemplo comentado dentro dele). O Claude lê o INDEX em toda sessão, então mantenha-o curto e atualizado (`/finalizar-sessao` cuida disso).

### Trazer as suas notas para dentro
Se você já tem notas no Obsidian, pode movê-las para as pastas certas: projetos em `10 - PROJETOS`, clientes em `20 - CLIENTES E MARCAS`, e assim por diante. Para o mapa agrupar bem, cada nota de projeto deve ter no cabeçalho (frontmatter) o campo `cliente: "[[Nome do Cliente]]"` e a nota do cliente deve existir em `20 - CLIENTES E MARCAS`. Os modelos em `99 - SISTEMA/Templates` mostram os campos de cada tipo; o app cria notas novas a partir deles. Depois de mover, peça ao Claude: "atualize o INDEX com as notas que estão nas pastas".

Dica: se o vault for uma pasta com `git init`, o painel "Hoje" do app mostra o que foi tocado por último e `/finalizar-sessao` guarda um histórico.

## Sobre os áudios que já vêm prontos
A pasta `Mapa/voz/pre-gravados` traz 43 frases fixas do sistema (comandos, saudações de espera, "um instante, senhor"…) já gravadas, e `Mapa/voz/avisos` traz 4 avisos curtos. A lista completa, com o texto de cada uma, está em `Mapa/voz/INCLUIDOS.txt`. **Esses áudios estão na voz do Jarvis de quem montou o kit**; todas as frases novas (respostas, saudação de abertura, narração dos seus sistemas) saem na voz que você configurar. Se preferir que tudo saia na sua voz, apague as pastas `voz/pre-gravados` e `voz/avisos`: o app grava as frases que faltam na primeira abertura (gasta alguns créditos do ElevenLabs, uma vez).

## Se algo der errado
- **O app abre mas o mapa não aparece**: confira se o Python 3 está instalado (`python3 --version`) e abra o app de novo. Para ver o erro, rode no Terminal: `python3 "<seu vault>/99 - SISTEMA/Mapa/servidor.py" --abrir`.
- **O Jarvis não fala com a voz do ElevenLabs**: confira a chave e o nome da voz no `elevenlabs.env`. O nome tem de ser exatamente o de "My Voices". Se o ElevenLabs recusar, o app mostra o motivo na lista de vozes (botão de voz no canto da tela) e usa as vozes do Mac.
- **O Jarvis não responde perguntas**: ele usa o Claude Code deste Mac. Rode `claude` no Terminal e confira se está logado. Se o `claude` estiver em um lugar incomum, coloque o caminho em `SC_CLAUDE=` no `elevenlabs.env`.
- **O Claude Code não carrega o vault**: confira `~/.config/segundo-cerebro/vault` (tem de ter o caminho do vault) e se o `~/.claude/settings.json` tem o hook `segundo-cerebro/hook.js` em `SessionStart` e `UserPromptSubmit`.
- **Para testar o app sem gastar nada**: `python3 "<seu vault>/99 - SISTEMA/Mapa/testes/teste_backend.py"` roda os testes numa cópia temporária do vault.

## Segurança
- A chave do ElevenLabs fica só em `~/.config/segundo-cerebro/elevenlabs.env`. Não a coloque em notas.
- O servidor do app só aceita conexões do próprio Mac (127.0.0.1) e exige um código que só a página do app conhece.
- Por voz, o Claude **só lê** o vault; toda escrita passa pela sua confirmação.
