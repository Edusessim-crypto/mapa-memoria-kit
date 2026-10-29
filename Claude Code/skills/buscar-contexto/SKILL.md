---
name: buscar-contexto
description: Carrega do Segundo Cérebro (Vault Obsidian) somente o contexto necessário para a tarefa atual — use quando o usuário pedir para consultar o Segundo Cérebro, citar um projeto ou cliente registrado ou antes de trabalhar em algo que já tem decisões registradas.
---

Vault: `__VAULT__`

Recuperação progressiva — pare assim que tiver o suficiente:
1. Leia `00 - CENTRAL/INDEX.md` e identifique o projeto/área/marca do pedido ($ARGUMENTS ou a tarefa atual).
2. Leia a nota-âncora indicada (projeto em `10 - PROJETOS/`, marca em `20 - CLIENTES E MARCAS/`). Foque em Status atual, Pendências, Decisões, Padrões travados.
3. Leia a seção do cliente em `00 - CENTRAL/Padrões Travados.md` (🔒 não pode mudar sem pedido explícito).
4. Abra apenas as notas linkadas relevantes à tarefa (decisões, identidade, prompt usado).
5. Notas relacionadas cujo nome não cita o projeto: use a lista "Relacionados" do INDEX e/ou `rg -l -i "^(projeto|cliente|marca):.*<Nome>"` em `70 - DECISÕES` e `10 - PROJETOS`.
6. Só se ainda faltar algo: `rg -l -i "termo" "__VAULT__/<pasta provável>"`.
O workspace operacional é sempre o diretório atual (projeto de código); o Vault é só memória consultiva — não edite o Vault durante a busca.
Nunca leia o Vault inteiro nem pastas inteiras.

Saída: resumo curto — estado atual, decisões/🔒 que afetam a tarefa, pendências relacionadas, caminhos de código — citando as notas lidas. Se o código atual contradiz uma decisão registrada, aponte antes de agir.
