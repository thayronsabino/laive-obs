# LAIVE OBS
**O Hub Executivo para Transmissão Multiplataforma Inteligente**

O **LAIVE OBS** transforma o seu OBS Studio num motor invisível e invencível. Criamos um dashboard próprio (App Desktop) voltado para produtores, igrejas e empresas, focado em facilidade, beleza estética executiva e estabilidade de stream para múltiplos canais. 

## Missão

Este projeto existe para democratizar a transmissão multiplataforma,
especialmente para igrejas e organizações sem fins lucrativos,
permitindo o uso gratuito e acessível da tecnologia.

Ele resolve os clássicos problemas de plugins nativos que cracham a operação principal, movendo todo o trabalho pesado de restream para fora da interface primária do OBS, controlando-o estavelmente via arquitetura Websocket.

Regra de produto:
- a arquitetura oficial do LAIVE OBS e standalone;
- a paridade com plugins de referencia do ecossistema OBS deve ser buscada por equivalencia funcional, e nao por migracao do motor principal para dentro do processo do OBS.

## Documentação Técnica
- [Arquitetura e Especificações Técnicas (SPEC)](./SPEC.md)
- [Requisitos de Produto (PRD)](./PRD.md)
- [Matriz de Paridade com obs-multi-rtmp](./PARIDADE_OBS_MULTI_RTMP.md)
- [Estrategia Standalone para Cena Fixa por Destino](./CENA_FIXA_STANDALONE.md)
- [Implementação MVP v0.1](./MVP_IMPLEMENTATION.md)
- [Processo de Release](./RELEASE_PROCESS.md)

## Comandos de Empacotamento (Alpha)
- `npm run package:windows-alpha`
- `npm run package:windows-installer` (gera pacote alpha + instalador, requer Inno Setup 6)
- `npm run package:windows-msi` (gera pacote alpha + instalador `.msi`; usa WiX Toolset v3 no PATH/`LAIVE_WIX_BIN_PATH` ou bootstrap portatil automatico via NuGet)
- `npm run package:windows-enterprise` (gera `.exe` + `.msi` no mesmo ciclo)
- `npm run package:macos-alpha` (gera bundle + `.dmg` em runner macOS)
- `npm run package:linux-alpha` (gera bundle + `.deb` e `.AppImage` em runner Linux)

## Estado Atual de Produto
- MVP v0.1 entregue com ingest, fan-out RTMP e dashboard operacional.
- Pós-MVP v0.2 em andamento com:
  - autenticação local obrigatória;
  - controle OBS bidirecional (stream/record/scene);
  - perfis avançados por destino com fallback de encoder.

## Releases Automatizadas
- Workflow de release por tag: `.github/workflows/release-cross-platform.yml`
- Workflow dedicado para instaladores Windows: `.github/workflows/windows-installers-ci.yml`
- Trigger: push de tag `v*` ou execução manual (`workflow_dispatch`).
- Publicação automática de artefatos Windows/macOS/Linux em GitHub Releases.
- Gate formal de release: `docs/RELEASE_PARITY_CHECKLIST.json` + `scripts/verify-parity-release-gate.mjs`.
- Scripts de operação: `scripts/setup-release-secrets.ps1`, `scripts/dispatch-release-cross-platform.ps1` e `scripts/dispatch-windows-installers-ci.ps1`.

## Licença

O código-fonte é público e a comunidade é incentivada a contribuir.
O uso comercial de versões modificadas ou redistribuídas requer autorização.

Este projeto **não é open source conforme a definição da OSI**.
Consulte os arquivos [LICENSE.pt-BR](LICENSE.pt-BR) ou [LICENSE.en](LICENSE.en) para os termos completos.
Leia as diretrizes de governança no [GOVERNANCE.md](GOVERNANCE.md).
