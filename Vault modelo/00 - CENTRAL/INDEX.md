---
type: sistema
estado: ativo
tags: [sistema, index]
atualizado: 
---

# INDEX — mapa semântico

> Ponto de partida de toda consulta. Aponta para a **nota principal** de cada assunto e para notas relacionadas cujo nome não cita o projeto. Não contém o conteúdo.
> Busca complementar: decisões têm `projeto:`/`cliente:` no frontmatter → `rg -l 'projeto:.*NomeDoProjeto' "70 - DECISÕES"`.
> Leitura é **automática** em toda sessão do Claude Code; **registro só em `/finalizar-sessao`** → [[REGRAS-DE-MEMORIA]] (seção Automação).

## Mapa por categoria
| Cor | Categoria | Onde | Hub |
|---|---|---|---|
| 🟦 | Projetos (status, contexto, próximos passos) | `10 - PROJETOS` | [[Mapa de Projetos]] · seções abaixo = índice por projeto |
| 🟥 | Decisões (o quê + porquê) | `70 - DECISÕES` | [[Decisões Recentes]] · [[Padrões Travados]] 🔒 |
| 🟪 | Preferências (estilo, ferramentas, forma de trabalhar) | `00 - CENTRAL` | [[Preferências de Trabalho]] |
| 🟩 | Stack e padrões técnicos/código (funcionou / rejeitado) | `45 - STACK E PADRÕES` | [[Stack Técnica]] · [[Padrões de Código]] |
| 🟨 | Aprendizados (valem para outros projetos) | `40 - CONHECIMENTO` | [[Aprendizados]] · [[Erros a evitar]] · [[Conhecimentos]] |
| 🟧 | Clientes e marcas | `20 - CLIENTES E MARCAS` | [[Clientes e Marcas]] |

## Projetos ativos
<!-- Uma seção "### Nome do Projeto" por projeto, neste formato (o hook do Claude Code usa o título da seção para reconhecer o projeto no pedido e a pasta de código entre crases para reconhecê-lo pelo diretório):

### Nome do Projeto
Principal: [[Nome do Projeto]] · Cliente: [[Nome do Cliente]] · Código: `~/Projetos/pasta-do-projeto`
Assuntos: palavras-chave do que o projeto envolve.
Relacionados: [[Decisão — Algo importante]] · [[Identidade Visual do Cliente]]
-->

## Aguardando cliente/conteúdo


## Pausados


## Marcas e clientes de conteúdo
<!-- Uma seção "### Nome do Cliente" por cliente ou marca, com Principal, Projetos, Assuntos e Relacionados. -->

## Áreas
<!-- Ex.: Desenvolvimento → [[Desenvolvimento]] · Marketing → [[Marketing e Conteúdo]] -->

## Regras e sistema
🔒 [[Padrões Travados]] · [[Preferências de Trabalho]] · [[Erros a evitar]] · [[REGRAS-DE-MEMORIA]] · [[Pendências]] · [[Mapa de Projetos]] · [[Decisões Recentes]]

## Recursos
Prompts → [[Biblioteca de Prompts]] · SOPs → [[Processos]] · Templates → `99 - SISTEMA/Templates` · Repositórios/deploys → [[Repositórios e Deploys]] · Conhecimento → [[Conhecimentos]]
