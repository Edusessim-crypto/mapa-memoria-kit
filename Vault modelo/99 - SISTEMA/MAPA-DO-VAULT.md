---
type: sistema
estado: referencia
tags: [sistema, documentacao]
---

# Mapa do Vault

(Documentação — não precisa ser lida em toda tarefa.)

| Pasta | Finalidade | Salve aqui |
|---|---|---|
| `00 - CENTRAL` | navegação e painéis | INDEX, regras, pendências, padrões travados |
| `10 - PROJETOS` | uma nota por projeto (a nota **é** o README: status, pendências, decisões, histórico) | estado e trabalho de algo com fim |
| `20 - CLIENTES E MARCAS` | quem é o cliente/marca; subpastas com identidade, posicionamento, copy | fontes da verdade de marca |
| `30 - ÁREAS` | responsabilidades contínuas sem fim | visão geral de uma área |
| `40 - CONHECIMENTO` | aprendizados reutilizáveis entre projetos | "como fazer X", lições, erros |
| `45 - STACK E PADRÕES` | tecnologias e padrões de código | stack por projeto, o que funcionou |
| `50 - RECURSOS` | prompts (integrais), SOPs, templates, referências | materiais prontos para usar |
| `60 - PESSOAS` | contatos (só dados públicos/comerciais) | — |
| `70 - DECISÕES` | uma nota por decisão (vigente/substituída) | decisões aprovadas |
| `80 - INBOX` | captura rápida | qualquer coisa não processada |
| `90 - ARQUIVO` | projetos encerrados/substituídos | mover a nota do projeto quando arquivar |
| `99 - SISTEMA` | protocolo, modelos e o app Mapa | — |

**Projeto × área × conhecimento × recurso:** projeto tem fim; área é contínua; conhecimento é reutilizável e independe de cliente; recurso é material pronto (prompt, template).

**Inbox:** captura sem filtro → `/processar-inbox` move para o lugar certo e marca `[x] processado`.

**Arquivar:** mudar `status: arquivado` + `estado: arquivo`, mover a nota para `90 - ARQUIVO`, atualizar INDEX e [[Mapa de Projetos]]. Links continuam funcionando (Obsidian resolve por nome).

**O app Mapa** (`99 - SISTEMA/Mapa`) lê todas as pastas menos `00 - CENTRAL`, `80 - INBOX` e `99 - SISTEMA`; agrupa as notas em "sistemas" pelo cliente/marca (`20 - CLIENTES E MARCAS`) e pelo campo `cliente:`/`projeto:` do frontmatter.

Fontes da verdade: identidade → `Identidade Visual <Marca>` · decisões → `70 - DECISÕES` · estado → nota do projeto · pendências → seção Pendências + [[Pendências]] · histórico → seção Histórico.
