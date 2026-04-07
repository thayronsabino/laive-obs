# E2E Validation - LAIVE OBS MVP v0.1

Este guia padroniza a validacao de resiliencia e sincronizacao do core standalone.

## 1. Validacao automatizada (resiliencia de rede RTMP)

Executa um cenario completo:
- sobe ingest local;
- cria destino RTMP local;
- publica stream sintetica para ingest;
- derruba destino;
- valida `destination.reconnecting`;
- religa destino e valida recuperacao.

Comando:

```bash
npm run test:e2e
```

Resultado esperado:
- teste `E2E: destination reconnects after temporary RTMP sink outage` passa.

## 1.1 Validacao automatizada de sessao longa (soak multi-destino)

Executa cenario de resiliencia prolongada:
- multiplos destinos RTMP locais;
- stream sintetica continua;
- interrupcoes periodicas de sink com retorno automatico;
- validacao de reconexao durante a sessao.

Comando padrao (60 minutos):

```bash
npm run test:e2e:soak
```

Comando parametrizado (exemplo rapido):

```powershell
powershell -ExecutionPolicy Bypass -File scripts/run-e2e-soak-tests.ps1 `
  -DurationSec 300 `
  -DestinationCount 3 `
  -OutageIntervalSec 45 `
  -OutageDurationSec 8
```

Resultado esperado:
- teste `E2E Soak: multi-destination session survives periodic sink outages` passa.

## 2. Validacao manual com OBS real (sync start/stop)

Prerequisitos:
- OBS Studio aberto com `obs-websocket` ativo na porta `4455`;
- core-service em execucao.

Passos:
1. Inicie o core:
```bash
npm run dev:core
```
2. Abra o dashboard local:
```text
http://127.0.0.1:4800
```
3. Se for primeiro uso, execute bootstrap de credencial local e faça login.
4. Crie um destino com `syncWithObsStart=true` e `syncWithObsStop=true`.
5. No OBS, configure o envio master para:
```text
rtmp://127.0.0.1:1935/live/master
```
6. Clique `Iniciar Transmissao` no OBS.
7. Verifique no dashboard:
   - OBS muda para `connected | streaming`;
   - destino muda para `connecting -> live`.
8. Clique `Parar Transmissao` no OBS.
9. Verifique no dashboard:
   - destino muda para `stopped`.

## 3. Validacao manual de reconexao

1. Com stream ativa, interrompa o endpoint de destino (queda de rede/servidor).
2. Verifique transicao para `reconnecting`.
3. Restaure o endpoint.
4. Verifique retorno para `live`.

## 3.1 Readiness operacional antes do teste real

Antes de rodar um teste de transmissao real no OBS:

1. abra o dashboard;
2. execute `Transmission Readiness`;
3. confirme:
   - `source probe` com streams de audio/video detectados;
   - nenhum destino em `Blocked`;
   - trilhas `inputTrackIndex` / `vodTrackInputIndex` disponiveis no ingest atual;
   - para `scene_projector_capture`, validacao e preview do capture target.

APIs de apoio:
- `GET /api/transmission/readiness`
- `POST /api/destinations/:id/projector/validate`
- `GET /api/destinations/:id/projector/preview.jpg`
- `GET /api/projectors/managed`
- `POST /api/projectors/managed/:destinationId/close`

## 4. Evidencias minimas para alpha

- Logs estruturados em:
```text
%APPDATA%\laive-obs\data\logs\core.ndjson
```
- Observabilidade por API:
  - `GET /api/metrics`
  - `GET /api/diagnostics`
  - `GET /api/diagnostics/export`
  - `GET /api/logs/recent`
  - `GET /api/logs/export`
  - `GET /api/support-bundle/export`
- Resultado dos comandos:
  - `npm run test`
  - `npm run test:e2e`
  - `npm run test:e2e:soak` (execucao dedicada de sessao longa)
  - `npm run ffmpeg:healthcheck`
  - `npm run quality:local`
