---
name: criar-projeto
description: Cria um novo projeto no Segundo Cérebro com a estrutura mínima adequada e atualiza o INDEX.
---

Vault: `__VAULT__`

1. Verifique se já existe projeto/marca com o nome (`rg -l -i` em `10 - PROJETOS`, `20 - CLIENTES E MARCAS`, `90 - ARQUIVO`). Se existir, não duplique — reative/atualize.
2. Crie `10 - PROJETOS/<Nome>.md` a partir de `99 - SISTEMA/Templates/Modelo de Projeto.md` (status: ideia | ativo | pausado | manutenção | concluido | arquivado; datas de hoje; cliente/marca linkados; pasta de código se houver).
3. Se for cliente/marca nova, crie a nota em `20 - CLIENTES E MARCAS` (Modelo de Cliente). Não crie arquivos vazios desnecessários.
4. Adicione o projeto na seção correta de `00 - CENTRAL/INDEX.md` (uma linha de descrição + âncora) e em `00 - CENTRAL/Mapa de Projetos.md`.
5. Informe o que foi criado.
