---
name: revisar-memoria
description: Audita o Segundo Cérebro procurando duplicações, decisões conflitantes, notas abandonadas, conteúdo desatualizado, links quebrados e notas sem contexto.
---

Vault: `__VAULT__`

1. Links quebrados: script que lista `[[alvos]]` sem nota correspondente (ignorar blocos `~~~~`).
2. Duplicações: nomes parecidos (ex.: "Identidade 2", "FINAL") e decisões sobre o mesmo tema com status vigente.
3. Conflitos: decisões vigentes que se contradizem; projetos com status incoerente com a data de atualização (>30 dias "ativo").
4. Órfãs: notas sem links de entrada; Inbox com itens antigos.
5. Produza relatório: problema → notas → sugestão. Corrija automaticamente só o trivial e seguro (link quebrado óbvio). **Não altere decisões críticas/🔒 nem apague nada** quando houver ambiguidade — liste para o usuário decidir.
