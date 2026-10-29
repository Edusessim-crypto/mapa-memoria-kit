# 🧠 Segundo Cérebro — memória de longo prazo (automático, em TODO projeto)

Vault Obsidian: `__VAULT__`
O usuário (Roberto) **nunca** vai pedir para consultar ou registrar. Isto é comportamento padrão em toda tarefa, sem exceção.

## 1. Antes de qualquer tarefa — leitura
- Leia `00 - CENTRAL/INDEX.md` (no Claude Code ele já vem injetado pelo hook SessionStart). **Nunca** leia o vault inteiro nem pastas inteiras.
- Identifique o projeto/cliente/tema do pedido **e** temas parecidos em outros projetos (mesma stack, padrão, tipo de entrega).
- Abra só as notas necessárias: nota-âncora do projeto, seção do cliente em `00 - CENTRAL/Padrões Travados.md`, decisões linkadas, `45 - STACK E PADRÕES/Stack Técnica.md` e `Padrões de Código.md` se for técnico, `00 - CENTRAL/Preferências de Trabalho.md`.
- Aplique esse contexto sem pedir para o usuário repetir o que já explicou.
- **Conflito** entre o pedido e uma decisão, preferência ou 🔒 registrado: avise (citando a nota) e pergunte **antes** de executar. Nunca sobrescreva em silêncio.

## 2. Registro — SÓ quando o usuário rodar `/finalizar-sessao`
**Não escreva no vault durante a sessão** (registrar a cada entrega deixa as sessões lentas). Exceção: pedido explícito ("guarde isso", "trave isso" → skill `salvar-memoria`). Quando ele rodar `/finalizar-sessao`, siga a skill `finalizar-sessao` e `00 - CENTRAL/REGRAS-DE-MEMORIA.md`. Registre só o que tem valor futuro:
- status/contexto do projeto (nota em `10 - PROJETOS`; projeto novo → skill `criar-projeto`);
- decisões + porquê (`70 - DECISÕES`);
- padrões técnicos que funcionaram ou foram rejeitados + porquê (`45 - STACK E PADRÕES/Padrões de Código.md`);
- stack usada (`45 - STACK E PADRÕES/Stack Técnica.md`);
- preferências novas ou alteradas (`00 - CENTRAL/Preferências de Trabalho.md` — atualize; a versão antiga fica marcada como substituída);
- aprendizados reutilizáveis (`40 - CONHECIMENTO/Aprendizados.md` / `Erros a evitar.md`).
Atualize > crie. Use links `[[...]]` entre projetos relacionados. Nunca grave segredos (o vault pode ser versionado em git, copiado ou sincronizado). Commit local no vault, sem push, se o vault tiver git. Sem nada de valor futuro, não escreva nada. Termine com 1 linha: o que foi registrado e onde.
