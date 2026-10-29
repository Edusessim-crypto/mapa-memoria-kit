---
type: sistema
estado: referencia
tags: [sistema, protocolo]
---

# Protocolo do Segundo Cérebro

> Leitura obrigatória para qualquer IA (Claude, ChatGPT, Codex…) que trabalhe neste Vault.

## 1. Mapa rápido
| Pasta | Conteúdo |
|---|---|
| `00 - CENTRAL` | dashboards: [[Segundo Cérebro]], [[Mapa de Projetos]], [[Pendências]], [[Padrões Travados]], [[Decisões Recentes]], [[Preferências de Trabalho]] |
| `10 - PROJETOS` | uma nota por projeto (modelo [[Modelo de Projeto]]) |
| `20 - CLIENTES E MARCAS` | clientes, marcas próprias, identidades visuais (subpastas por marca, se quiser) |
| `30 - ÁREAS` | áreas contínuas de trabalho (sem fim: ex. desenvolvimento, marketing, financeiro) |
| `40 - CONHECIMENTO` | conhecimento atômico reutilizável + [[Aprendizados]] + [[Erros a evitar]] |
| `45 - STACK E PADRÕES` | [[Stack Técnica]] e [[Padrões de Código]] |
| `50 - RECURSOS` | [[Biblioteca de Prompts]] (textos integrais), SOPs, templates, referências |
| `60 - PESSOAS` | pessoas (só dados públicos/comerciais) |
| `70 - DECISÕES` | uma nota por decisão (vigente/substituída/rejeitada) |
| `80 - INBOX` | entrada rápida — classificar depois |
| `90 - ARQUIVO` | projetos arquivados/substituídos (nunca apagar) |
| `99 - SISTEMA` | este protocolo, modelos e o código do app Mapa |

## 2. Entidades — não confundir
- **Cliente/marca** ≠ **projeto** ≠ **sistema**. Ex.: um cliente (empresa) → um projeto (o site dele) → um sistema (o software que roda).

## 3. Hierarquia de verdade (conflitos)
**Decisão explicitamente aprovada mais recente > informação recente > informação antiga.**
- Expressões de aprovação: aprovado, perfeito, manter, não alterar, versão oficial, final, padrão validado, trava, daqui para frente, usar sempre, esse é o correto, modelo base.
- **Versão rejeitada nunca vira oficial só por ser mais nova.**
- Nunca apagar a versão anterior: marcar `status: substituida` + `estado: arquivo` e ligar à nova (`substitui`/`substituida_por`).

## 4. Marcação de certeza
- **FATO** — explicitamente registrado (citar a fonte).
- **CONCLUSÃO** — inferido (dizer de onde).
- **INCERTO** — sem evidência suficiente.

## 5. Status padronizados
Projetos: `ideia · planejamento · ativo · aguardando · pausado · concluido · arquivado · desconhecido`.
Decisões: `vigente · substituida · parcialmente-substituida · rejeitada · necessita-validacao · em-validacao`.
Prompts: `vigente · executado · substituido · rejeitado · historico · pausado · em-validacao`.
Tarefas `- [ ]` **só** para ação realmente pendente; `- [x]` quando houver evidência de conclusão.

## 6. 🔒 Padrões travados
Qualquer item em [[Padrões Travados]] **não muda** sem pedido explícito do usuário. Antes de criar peça, texto, site ou código de um cliente, **ler os travados dele**.

## 7. Comportamento contínuo
Todo conhecimento novo responde **"Onde isso se encaixa?"**:
- Nova decisão → nota em `70 - DECISÕES` **e** link na nota do projeto.
- Visual aprovado → padrão travado.
- Mudança → a decisão anterior fica como **substituída**.
- Prompt melhor → nova versão do prompt (manter a anterior).
- Aprendizado → [[Aprendizados]] / [[Erros a evitar]] + link aos projetos.
- Processo repetido 2–3× → avaliar SOP.
- Dois projetos compartilham conhecimento → criar links.

## 8. Segurança
- **Nunca** gravar no Vault: senhas, tokens, chaves de API, URLs assinadas completas. (O Vault pode ser versionado em git, copiado ou sincronizado.)
- IDs públicos e contatos comerciais públicos podem ser registrados.
- Nenhuma ação destrutiva (apagar arquivos, posts, bancos) sem autorização explícita.

## 9. Nomenclatura
Nomes humanos e pesquisáveis (`Identidade Visual Cliente X.md`). **Proibido em nomes de nota:** `: | ? * " < > \ /` (quebram links no Obsidian) — usar ` — `.
Decisões: `Decisão — …`; prompts: `Prompt — …`; SOPs: `SOP — …`.
