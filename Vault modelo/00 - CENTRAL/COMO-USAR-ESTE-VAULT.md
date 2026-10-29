---
type: sistema
estado: ativo
tags: [sistema, guia]
---

# Como usar este Vault

## Trabalhar em qualquer projeto com o Segundo Cérebro
Abra o Claude Code na pasta do projeto de código. O hook instalado carrega o INDEX deste vault automaticamente. Depois é só pedir: *"Consulte o contexto do projeto X no Segundo Cérebro antes de fazer essa alteração."* (ou `/buscar-contexto X`).

## Capturar
Jogue qualquer coisa em [[Inbox]] (no Obsidian, pelo app do Mapa ou pedindo ao Claude "anote na inbox: …"). Não precisa organizar.

## Consultar
Comece por [[INDEX]] → nota do projeto → links. No Claude: `/buscar-contexto <assunto>`.

## Salvar
Diga "isso foi aprovado, salve no Segundo Cérebro" ou `/salvar-memoria`. O Claude procura onde já existe e atualiza (não duplica). Padrões aprovados viram 🔒 em [[Padrões Travados]].

## Organizar a Inbox
`/processar-inbox` — classifica, consolida e marca como processado.

## Novo projeto
`/criar-projeto <nome>` — cria a nota a partir do modelo e atualiza o INDEX.

## Finalizar uma sessão
`/finalizar-sessao` — registra só decisões, mudanças, aprendizados, pendências e próximo passo.

## Manutenção
`/revisar-memoria` de vez em quando (duplicações, conflitos, notas abandonadas).

## Não fazer
- Não colar senhas/tokens em notas (o Vault pode ser versionado em git, copiado ou sincronizado).
- Não criar "Identidade 2", "Branding FINAL" — atualize a nota existente.
- Não salvar conversas inteiras nem versões rejeitadas como padrão.
- Não renomear notas com `: | ? * " < > \ /`.
