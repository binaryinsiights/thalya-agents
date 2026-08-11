# Modificações da Binary Insights

Este repositório deriva do fazer.ai agents Free, distribuído sob a Apache License 2.0.

## Política

- O remote `upstream` acompanha `https://github.com/fazer-ai/agents.git`.
- Alterações próprias entram por pull request e passam por `bun check`.
- Releases geram imagens privadas versionadas no GitHub Container Registry.
- Instalações de clientes usam tags imutáveis, nunca `latest`.
- Código, imagens ou trechos exclusivos do fazer.ai agents Pro não fazem parte deste repositório.
- Segredos, dados de clientes, sessões Baileys e backups nunca são versionados.

## Histórico

### 0.1.0, fundação

- Repositório privado da Binary Insights criado a partir do histórico do fazer.ai agents Free.
- Upstream oficial preservado para sincronizações futuras.
- Pipeline de imagem configurado explicitamente para a edição Free.
- Varredura de segredos adicionada ao CI.
