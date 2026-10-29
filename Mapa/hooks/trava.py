#!/usr/bin/env python3
"""Trava da conversa por voz: roda antes de cada ferramenta do Claude quando há conectores ligados
(SC_FERRAMENTAS_EXTRA em ~/.config/segundo-cerebro/elevenlabs.env; ver sessao.py).

Ler, buscar e consultar passa. Qualquer ferramenta que escreva, envie, apague ou publique é barrada: a escrita no
vault acontece só pelo servidor (operacoes.py), depois do "confirma" por voz. Não é uma caixa de areia, é uma
lista de proteção. Adaptado de hooks/trava.py do repositório matheustillimt-tech/jarvis (MIT).
"""
import json
import re
import sys

LIVRES = {"Read", "Glob", "Grep", "LS", "ToolSearch", "ListMcpResourcesTool", "ReadMcpResourceTool"}
MCP_ARRISCADO = re.compile(
    r"(send|enviar|envio|criar|create|salvar|save|update|atualizar|anotar|delete|excluir|trash|apagar|publicar|publish|"
    r"arquivar|cancelar|editar|edit|upload|move|mover|share|reply|forward|draft|label|respond|transfer|set_|add_|remove|"
    r"apply|duplicate|generate|schedule|rename|enable|disable|finish|start_|import|write|copy|merge|comment|resolve|"
    r"activate|boost|attach|react|track)", re.I)
MCP_LEITURA = re.compile(
    r"(list|listar|get|ver|buscar|search|read|ficha|status|show|preview|find|info|help|query|fetch|count|filter|resolve_|"
    r"download|hierarchy|members|insights|schema|operators)", re.I)


def barrar(oque):
    sys.stderr.write(f"TRAVA DO JARVIS: {oque} não pode ser feito por voz. Não tente outro caminho. Se for algo que o "
                     "dono quer, diga em uma frase o que seria preciso fazer e termine com 'Confirma, senhor?'.")
    sys.exit(2)


def main():
    try:
        dados = json.load(sys.stdin)
    except ValueError:
        return
    nome = dados.get("tool_name", "")
    if nome in LIVRES:
        return
    if nome.startswith("mcp__"):
        acao = nome.split("__")[-1]
        if MCP_ARRISCADO.search(acao) or not MCP_LEITURA.search(acao):
            barrar(f"a ação '{acao}' do conector")
        return
    barrar(f"a ferramenta {nome}")


if __name__ == "__main__":
    main()
