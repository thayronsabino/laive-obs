# Estrategia Standalone para Cena Fixa por Destino

## Objetivo
Entregar equivalencia funcional de `cena fixa por destino` sem mover o motor principal do LAIVE OBS para dentro do processo do OBS Studio.

## Base tecnica oficial
- a API oficial do `obs-websocket` expõe `GetMonitorList`, `OpenSourceProjector` e `OpenVideoMixProjector`;
- na documentacao oficial do OBS, **uma scene e uma source**;
- isso permite ao LAIVE OBS abrir um projector de uma scene especifica sem usar `libobs` nem compilar plugin nativo.

## Estrategia de implementacao
### Fase A - Automacao de projector no core
- listar monitores do OBS;
- abrir projector de `source` via API local do LAIVE OBS;
- usar `sourceName = sceneName` quando o alvo for uma scene do OBS;
- permitir projector em modo janela (`monitorIndex = -1`) para captura isolada.

### Fase B - Capture standalone do projector
- cada destino passara a suportar dois modos de video:
  - `master_ingest`: comportamento atual;
  - `scene_projector_capture`: captura dedicada de projector de scene;
- a captura sera feita pelo FFmpeg com mecanismo especifico por SO:
  - Windows: captura de janela/tela;
  - macOS: captura de tela/janela suportada pelo runtime local;
  - Linux: captura equivalente do ambiente grafico suportado.

### Fase C - Operacao por destino
- ao iniciar um destino com `scene_projector_capture`, o LAIVE OBS:
  - garante que o projector da scene alvo esteja aberto;
  - resolve a geometria/alvo de captura;
  - sobe um pipeline FFmpeg isolado para aquele destino;
- falhas de captura ou rede devem afetar apenas o destino correspondente.

## Regras de arquitetura
- o projector e apenas um mecanismo auxiliar do OBS para gerar uma superficie visual capturavel;
- o LAIVE OBS continua standalone;
- nao sera adotado `libobs`, plugin C/C++ nativo ou linkagem ao core do OBS como caminho padrao para fechar este item.

## Criterio de aceite
O item `cena fixa por destino` so podera ser marcado como concluido quando:

1. o operador puder associar uma scene especifica a um destino sem trocar a `program scene` principal;
2. o pipeline daquele destino usar render/captura isolada da scene escolhida;
3. a falha daquele destino nao derrubar o OBS nem afetar os outros destinos;
4. houver cobertura automatizada para:
   - abertura de projector via API;
   - resolucao do modo de captura por SO;
   - montagem correta do pipeline FFmpeg por destino.

## Estado atual
- base da Fase A implementada no core:
  - `GET /api/obs/monitors`
  - `POST /api/obs/projectors/source`
  - `POST /api/obs/projectors/video-mix`
- `POST /api/destinations/:id/projector/open`
- `POST /api/destinations/:id/projector/detect`
- `POST /api/destinations/:id/projector/validate`
- `GET /api/destinations/:id/projector/preview.jpg`
- `GET /api/projectors/managed`
- `POST /api/projectors/reopen-managed`
- `POST /api/projectors/managed/:destinationId/reopen`
- `POST /api/projectors/managed/:destinationId/close`
- `DELETE /api/projectors/managed/:destinationId`
- `GET /api/transmission/readiness`
- base inicial da Fase B implementada para Windows:
  - destinos podem usar `videoSourceMode = scene_projector_capture`;
  - o audio continua vindo do ingest master;
- implementacoes operacionais por SO:
  - Windows: `windows_window_title` com `gdigrab`;
  - macOS: `darwin_display_crop` com `avfoundation` + crop por geometria da janela do projector;
  - Linux X11: `linux_x11_window_id` com `x11grab` + `window_id`;
- descoberta e UX ja melhoradas:
  - o core consegue enumerar janelas visiveis do OBS e ranquear candidatos de projector;
  - o endpoint `POST /api/destinations/:id/projector/detect` pode abrir o projector, detectar candidatos e fazer autobind quando houver apenas uma janela compativel;
  - o endpoint `POST /api/destinations/:id/projector/validate` executa um probe curto de captura com FFmpeg antes do start;
  - o start real do destino agora tambem valida automaticamente o target de captura e bloqueia o pipeline se o projector/capture nao estiver operacional;
  - o dashboard agora expõe pt-BR/en-US, acao manual de validacao do capture target, preview visual de um frame real antes do start e readiness operacional sob demanda;
  - o runtime agora mantem um registry dos projectors gerenciados pelo LAIVE OBS, com acoes de reopen individual/coletivo, close best-effort por plataforma e forget do estado gerenciado;
- ainda faltam:
  - no Linux, o caminho operacional atual continua baseado em X11 (`DISPLAY`) + `wmctrl`; quando o host estiver em Wayland puro, o core agora detecta e explica o bloqueio em vez de falhar silenciosamente;
  - no macOS, o host continua precisando conceder permissoes de Screen Recording / Accessibility; o core agora detecta melhor esses cenarios durante a validacao, mas nao pode conceder a permissao pelo usuario.

## Observacao sobre fechamento remoto
- o LAIVE OBS agora gerencia abertura, tracking, reopen, close best-effort e forget dos projectors sob seu controle;
- o `close` continua sendo um caminho auxiliar de automacao de janela do sistema operacional, nao um request oficial do `obs-websocket`;
- por isso, o comportamento de fechamento depende da plataforma e dos identificadores disponiveis:
  - Windows e macOS: titulo da janela do projector;
  - Linux X11: `window_id` + `DISPLAY`;
- se a plataforma nao expuser identificadores suficientes, o registry sinaliza `closeSupported = false` em vez de fingir suporte.
