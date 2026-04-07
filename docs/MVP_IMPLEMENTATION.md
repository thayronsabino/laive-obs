# MVP v0.1 Alpha - Implementacao Tecnica Inicial

Este documento registra a implementacao inicial do plano oficial de arquitetura hibrida standalone.

## Evolucao Pos-MVP (v0.2 - paridade funcional inicial)
- Destinos com `outputMode` (`inherit|custom`) e perfis por destino:
  - `videoProfile` (`videoCodec`, `bitrateKbps`, `fps`, `width`, `height`, `gopSec`, `preset`);
  - `audioProfile` (`audioCodec`, `audioBitrateKbps`).
- Builder FFmpeg por perfil com fallback deterministico de codec hardware para `libx264` e evento `destination.profile_warning`.
- Controle OBS bidirecional por API:
  - stream (`start|stop`), record (`start|stop`) e scene (`list|switch`);
  - tratamento de capability/unsupported com erro controlado.
- Seguranca local obrigatoria:
  - bootstrap de credencial local (`/api/auth/bootstrap`);
  - login/logout com cookie `HttpOnly`;
  - protecao de rotas `/api/*` (exceto bootstrap/login/status) e WebSocket de eventos autenticado.
- Rede local configuravel:
  - `GET|PATCH /api/settings/network` (`allowLan`, `bindAddress`, `sessionTtlSec`);
  - bind LAN aplicado no startup (reinicio requerido apos alteracao de bind).
- Dashboard migrado para React 18 com:
  - fluxo bootstrap/login/logout;
  - editor de destino com perfil avancado;
  - painel de controle OBS (stream/record/scene);
  - operacao protegida por sessao autenticada.

## Estrutura criada
- `apps/core-service`: API local, event bus, ingestao RTMP local, integracao OBS WebSocket, orquestracao FFmpeg e persistencia.
- `apps/dashboard`: painel web operacional para uso desktop e embed em OBS Browser Dock.
- `apps/desktop-shell`: shell Electron para iniciar o core-service e abrir o dashboard local.
- `infra/ffmpeg`: healthcheck e perfis base de runtime.

## Contratos implementados
- REST:
  - `GET /health`
  - `GET|POST|PATCH|DELETE /api/destinations`
  - `POST /api/streams/start-all`
  - `POST /api/streams/stop-all`
  - `POST /api/streams/:id/start`
  - `POST /api/streams/:id/stop`
  - `GET /api/obs/status`
  - `GET /api/status`
- WebSocket local:
  - `obs.connected|disconnected|streaming_started|streaming_stopped`
  - `destination.connecting|live|reconnecting|stopped|error`
  - `engine.process_started|process_exited|retrying|pipeline_stalled|force_kill_requested`

## Escopo entregue nesta etapa
- RTMP/RTMPS para destinos.
- Cadastro/edicao/exclusao de destinos.
- Start/Stop individual e em lote.
- Sync com OBS por eventos do `obs-websocket`.
- Dashboard embutivel em Browser Dock.
- Testes unitarios das regras base (validacao/status/sync).
- Testes de integracao de runtime/API com servicos OBS/ingest desativados.
- Observabilidade inicial com logs estruturados (`core.ndjson`) e log de requisicoes HTTP.
- Empacotamento alpha Windows inicial via `npm run package:windows-alpha`.
- Pendencias iniciais resolvidas:
  - vulnerabilidade de dependencias (`npm audit`) corrigida;
  - deteccao automatica de FFmpeg (PATH/Winget/Chocolatey/Scoop) ativa.
- Validacao E2E:
  - teste automatizado de resiliencia de rede RTMP (`npm run test:e2e`);
  - teste automatizado de sessao longa multi-destino (`npm run test:e2e:soak`);
  - guia de validacao manual com OBS real em `docs/E2E_VALIDATION.md`.
- Hardening operacional adicional:
  - watchdog de conexao FFmpeg para pipelines presos em `connecting`;
  - watchdog de estagnacao para pipelines `live` sem progresso (`engine.pipeline_stalled`);
  - backoff de retry com jitter configuravel;
  - parada graciosa com `q/SIGTERM` seguida de force-kill por timeout (`LAIVE_FFMPEG_STOP_GRACE_MS`);
  - endpoints de observabilidade (`/api/metrics`, `/api/diagnostics`).
- Qualidade automatizada:
  - workflow Windows em `.github/workflows/quality-windows.yml`;
  - workflow Unix de packaging em `.github/workflows/quality-unix-packaging.yml`;
  - runner local de qualidade `npm run quality:local`.
- Dashboard operacional:
  - painel de metricas de runtime (HTTP, reconnect, errors, pipelines);
  - timeline de incidentes baseada em `metrics.recentEvents`.
- Export de suporte operacional:
  - exportacao de diagnostico (`/api/diagnostics/export`);
  - exportacao de logs (`/api/logs/export`);
  - exportacao de incidentes no proprio dashboard;
  - bundle unico `.zip` (`/api/support-bundle/export`);
  - checksum SHA-256 do bundle via header HTTP (`X-LAIVE-BUNDLE-SHA256`).
- Integridade do pacote Windows alpha:
  - manifesto interno `dist/windows-alpha/bundle/checksums.bundle.sha256`;
  - manifesto externo `dist/windows-alpha/checksums.sha256` (inclui hash do `.zip` e do instalador quando habilitado);
  - verificador local `scripts/verify-windows-alpha.ps1` e atalho `verify-bundle.ps1` no bundle.
- Assinatura (signing-ready):
  - hook opcional no empacotamento via `LAIVE_WINDOWS_SIGN_SCRIPT`;
  - script base para `signtool`: `scripts/sign-windows-alpha-artifact.ps1`;
  - validacao de assinatura Authenticode: `scripts/verify-authenticode-signature.ps1`;
  - metadado de build com status de assinatura em `dist/windows-alpha/build-metadata.json`.
  - fallback de verificacao: `Get-AuthenticodeSignature` ou `signtool verify` quando disponivel.
- Instalador Windows (opcional no alpha):
  - comando direto: `npm run package:windows-installer` (executa package alpha com `LAIVE_BUILD_WINDOWS_INSTALLER=1`);
  - integrado ao package alpha com `LAIVE_BUILD_WINDOWS_INSTALLER=1`;
  - requer Inno Setup 6 (`ISCC.exe`) ou `LAIVE_INNO_ISCC_PATH`;
  - metadados do instalador em `dist/windows-alpha/installer-metadata.json`.
  - quando assinatura do instalador e solicitada, o build exige status Authenticode `Valid`.
- Empacotamento Unix (alpha tecnico):
  - macOS: `npm run package:macos-alpha` gera `dist/macos-alpha/laive-obs-macos-alpha.dmg`;
  - Linux: `npm run package:linux-alpha` gera `dist/linux-alpha/laive-obs-linux-alpha.deb`;
  - verificador unix de integridade: `scripts/verify-unix-alpha.sh`.
- Retencao de logs:
  - rotacao automatica de `core.ndjson` por tamanho;
  - limite de arquivos de log rotacionados configuravel via ambiente.
- CI de qualidade Windows:
  - gera pacote alpha (`npm run package:windows-alpha`);
  - valida integridade do pacote no workflow;
  - publica artefatos do alpha via GitHub Actions.
- Pipeline de release cross-platform:
  - workflow: `.github/workflows/release-cross-platform.yml`;
  - builds em `windows-latest`, `macos-latest` e `ubuntu-latest`;
  - validacao de integridade por plataforma antes de publicar artefatos;
  - publica artefatos no GitHub Releases em tags `v*`;
  - suporte a assinatura opcional Windows via secrets do repositório;
  - suporte a politica `LAIVE_REQUIRE_SIGNED_WINDOWS` para falhar release sem assinatura valida.

## Proximos passos para fechar alpha de producao
- Habilitar assinatura real no CI com certificado e cadeia de confianca.
- Validar notarizacao macOS real no CI com credenciais Apple (Developer ID + profile do `notarytool`).
- Validar AppImage Linux em matriz de distros alvo (runner CI + smoke manual).
- Cobertura E2E com OBS real em sessao longa.
- Expandir hardening de resiliencia FFmpeg para cenarios de hung I/O e supervisao de longo prazo.
