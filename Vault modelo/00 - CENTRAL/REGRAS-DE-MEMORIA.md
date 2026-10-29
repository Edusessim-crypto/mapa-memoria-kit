---
type: sistema
estado: ativo
tags: [sistema, memoria]
---

# Regras de Memória

**Inbox permissiva → memória seletiva.** O Segundo Cérebro não é depósito de conversas.

| Categoria | O que é | Onde vai |
|---|---|---|
| 1. Permanente | identidade de marca, posicionamento, arquitetura, preferências, decisões aprovadas, padrões, regras de negócio | `70 - DECISÕES` (🔒 se travado), identidade em `20 - CLIENTES E MARCAS`, [[Preferências de Trabalho]], `40 - CONHECIMENTO` |
| 1b. Técnico | stack usada/escolhida, padrões de código que funcionaram ou foram rejeitados (sempre com o porquê) | [[Stack Técnica]] (linha do projeto) · [[Padrões de Código]] · decisão estrutural em `70 - DECISÕES` |
| 2. Projeto | roadmap, decisões técnicas, pendências, estado atual | nota do projeto em `10 - PROJETOS` (Status atual, Pendências, Próximos passos) |
| 3. Histórico | mudanças importantes fora do contexto principal | seção *Histórico* do projeto; decisões `substituida`; `90 - ARQUIVO` |
| 4. Inbox | não processado | [[Inbox]] |
| 5. Descartável | tentativas ruins, conversa trivial, raciocínio intermediário, versões rejeitadas sem valor | **não salvar** |

## Estado (propriedade `estado`)
Toda nota tem `estado:` — é o que o Graph e o [[Painel de Estado.base|Painel de Estado]] usam para separar o vivo do histórico.
- `ativo` — em uso agora: painéis, projetos ativo/aguardando/planejamento, decisões vigentes, clientes com relação ativa, áreas, Inbox.
- `referencia` — consulta: conhecimento, SOPs, prompts, identidades, pessoas, projetos pausados/incertos, clientes sem relação ativa.
- `arquivo` — encerrado/histórico: `90 - ARQUIVO`, `status` substituida/rejeitada/arquivado/concluido/historico.
Ao substituir, arquivar ou concluir algo: atualizar `status` **e** `estado: arquivo`.

## Regras de consolidação
- Guardar o **resultado final**, não as tentativas ("identidade aprovada: fonte X, cor Y, não usar A — TRAVADO").
- Versão rejeitada só vira nota se ensinar algo ([[Erros a evitar]]).
- Antes de criar: procurar; atualizar a fonte existente.
- Toda decisão nova: nota em `70 - DECISÕES` + link na nota do projeto + [[Padrões Travados]] se travada.
- Nunca apagar informação não consolidada.

## Automação (padrão em toda tarefa — o usuário nunca pede)
**Antes de qualquer tarefa (leitura):**
1. INDEX → projeto/cliente/tema do pedido **e** temas parecidos em outros projetos (stack, padrão, decisão).
2. Só as notas-âncora e decisões relevantes; [[Padrões Travados]] do cliente; [[Stack Técnica]]/[[Padrões de Código]] se for técnico.
3. Aplicar sem pedir para o usuário repetir. **Conflito** com decisão/preferência/🔒 → avisar e perguntar **antes** de executar.

**Registro — só quando o usuário rodar `/finalizar-sessao`** (ou pedir "guarde isso"). Registrar a cada entrega deixa as sessões lentas.
1. Status do projeto (Status atual, Pendências, Próximos passos, Histórico).
2. Decisões + porquê → `70 - DECISÕES`; padrões técnicos ✅/❌ + porquê → [[Padrões de Código]]; stack → [[Stack Técnica]].
3. Preferência nova ou alterada → [[Preferências de Trabalho]] (a antiga fica riscada com "substituída em AAAA-MM-DD", não apagar).
4. Aprendizado reutilizável → [[Aprendizados]] / [[Erros a evitar]].
5. Nada de valor futuro → não escrever nada. Commit local no vault (sem push), se o vault tiver git.

**Como é garantido:**
- Claude Code: hooks globais em `~/.claude/settings.json` → `~/.claude/hooks/segundo-cerebro/hook.js` (SessionStart injeta INDEX + preferências + 🔒 gerais; UserPromptSubmit injeta o projeto/🔒 citados no pedido). Instruções em `~/.claude/CLAUDE.md`.
