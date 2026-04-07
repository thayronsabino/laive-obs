# Paridade com `obs-multi-rtmp`

## Objetivo
Este documento define a regra de paridade funcional do LAIVE OBS em relacao ao projeto de referencia local `obs-multi-rtmp (projeto referencia)`.

Regra do produto:
- o LAIVE OBS deve atingir **100% de paridade funcional** com o `obs-multi-rtmp`;
- essa paridade deve ser entendida como **equivalencia de capacidade e resultado para o operador**, e nao como copia da mesma implementacao interna do plugin de referencia;
- a arquitetura oficial do produto e **standalone**, com integracao ao OBS por WebSocket, ingest local, FFmpeg e opcionalmente Browser Dock para embed da interface;
- o produto **nao deve migrar o motor principal para plugin nativo do OBS** como estrategia padrao, pois isso conflita com a direcao de licenciamento e com o isolamento operacional definidos no projeto;
- depois de atingir a paridade, deve **superar** o projeto de referencia com recursos operacionais, seguranca, UX, observabilidade e distribuicao superiores;
- a pasta de referencia nao faz parte do produto, nao entra em artefatos e nao deve ser publicada no repositório oficial.

## Regra de equivalencia
Para os fins desta matriz:

- um item sera considerado em paridade quando o LAIVE OBS entregar ao usuario final a mesma capacidade pratica, mesmo que por arquitetura diferente;
- quando o plugin de referencia depender de APIs nativas do OBS, o LAIVE OBS deve priorizar uma solucao standalone equivalente antes de considerar qualquer extensao local auxiliar;
- so sera aceitavel adotar um componente auxiliar junto ao OBS se ele nao descaracterizar o produto como aplicacao standalone e se continuar compativel com a politica de licenca do projeto.

## Status atual

### Ja coberto
- multi-destino;
- protocolos por destino: `rtmp`, `rtmps`, `srt`, `rist`, `whip`;
- start/stop individual e em lote;
- sync com OBS;
- perfis customizados basicos por destino;
- edicao completa de destinos existentes na UI;
- reorder persistido de destinos com drag and drop no dashboard;
- controle OBS bidirecional de stream, record e scene;
- reconnect/retry/watchdog operacional;
- metricas, diagnostico, export de logs e support bundle;
- autenticacao local, cookies `HttpOnly`, rate limit e hardening basico;
- empacotamento Windows, macOS e Linux com CI/CD.
- dashboard bilíngue (`pt-BR` / `en-US`) sem dependencias externas;

### Parcial
- audio por destino:
  - o dashboard e o core agora suportam selecao da trilha principal de audio (`inputTrackIndex`) e trilha adicional estilo VOD (`vodTrackInputIndex`) no pipeline FFmpeg;
  - a trilha adicional hoje so e aplicada em protocolos multi-track compativeis (`srt` e `rist`);
  - a equivalencia total com `mixerId` e `audioTracks` do plugin de referencia continua dependente de um source de ingest que entregue mais de uma trilha de audio;
- configuracao de video por destino:
  - existe FPS absoluto, divisor de FPS compativel com o plugin, resolucao customizada, bitrate, GOP, `B-frames` e preset;
  - falta apenas a parte de cena fixa por saida para fechar toda a area de video;
- distribuicao macOS:
  - existe `.dmg`;
  - falta avaliar paridade formal com `.pkg` do projeto de referencia.

### Faltando
- definicao final do artefato macOS de producao (`.dmg` somente ou `.pkg` + `.dmg`) para declarar equivalencia de distribuicao totalmente fechada.

## Matriz de paridade

| Area | Recurso do `obs-multi-rtmp` | Status no LAIVE OBS | Acao necessaria |
|---|---|---|---|
| Protocolos | RTMP / RTMPS | Feito | Manter |
| Protocolos | SRT / RIST | Feito | Manter e ampliar cobertura E2E |
| Protocolos | WHIP | Feito | Manter e ampliar cobertura E2E |
| Destinos | Destinos ilimitados | Feito | Manter |
| Destinos | Start/Stop individual | Feito | Manter |
| Destinos | Start all / Stop all | Feito | Manter |
| Destinos | Sync Start / Sync Stop | Feito | Manter |
| Video | Herdar stream do OBS | Feito | Manter |
| Video | Encoder customizado por destino | Feito | Manter |
| Video | Resolucao por destino | Feito | Manter |
| Video | FPS por destino | Feito | Manter |
| Video | Cena fixa por destino | Feito | Manter, ampliar validacao visual automatizada e documentar restricoes de permissao/Wayland |
| Video | B-frames por destino | Feito | Manter |
| Audio | Encoder de audio por destino | Feito | Manter |
| Audio | Mixer de audio por destino | Parcial | Consolidar equivalencia standalone sobre source multi-track, sem depender de mixer nativo do OBS |
| Audio | VOD track por destino | Parcial | Consolidar trilha adicional em fontes e protocolos que suportem multi-track de ponta a ponta |
| UX | Criacao de destino | Feito | Manter |
| UX | Edicao de destino | Feito | Manter |
| UX | Reorder drag and drop | Feito | Manter |
| UX | Status operacional por destino | Feito | Manter |
| UX | Suporte multi-idioma | Feito | Manter cobertura pt-BR/en-US e evitar novas strings hardcoded |
| Release | Gate formal de release com checklist obrigatorio | Feito | Manter `docs/RELEASE_PARITY_CHECKLIST.json` sincronizado com a tag e com a matriz |
| UX | Preview visual do target de captura antes do start | Feito | Manter endpoint de preview e cobertura de regressao |
| Operacao | Reopen/close/forget de projectors gerenciados pelo runtime | Feito | Manter registry de runtime e documentar que close e best-effort por plataforma |
| Distribuicao | Windows `.exe` / `.zip` / `.msi` | Feito | Manter |
| Distribuicao | macOS instalador de producao | Parcial | Definir se `.dmg` basta ou se havera `.pkg` |
| Distribuicao | Linux pacote nativo | Feito | Manter |

## Ordem de implementacao recomendada

### Fase 1 - Paridade de engine
Objetivo: fechar o que impacta compatibilidade funcional real com o plugin.

1. protocolo por destino (`rtmp`, `rtmps`, `srt`, `rist`, `whip`) - feito;
2. cena fixa por destino - feito;
3. consolidar equivalencia standalone de audio multi-track para mixer principal e VOD track;
4. validar a estrategia standalone final para cena fixa sem quebrar a direcao de licenciamento do produto - feito em `docs/CENA_FIXA_STANDALONE.md`.

### Fase 2 - Paridade de operacao
Objetivo: fechar comportamento e fluxo de uso do painel.

1. edicao completa de destinos existentes na UI;
2. manter a ordenacao persistida com drag and drop e ampliar cobertura de regressao;
3. indicadores visuais por protocolo e perfil;
4. testes de integracao cobrindo protocolos e perfis novos.

### Fase 3 - Paridade de produto
Objetivo: fechar a experiencia percebida comparada ao plugin.

1. internacionalizacao do dashboard - feito;
2. definicao formal do artefato macOS de producao (`.dmg` somente ou `.pkg` + `.dmg`);
3. checklist de paridade no release gate - feito;
4. smoke tests de release por plataforma.

## Criterio de aceite
O LAIVE OBS so podera ser considerado em "paridade 100%" quando:

1. todos os itens marcados como `Faltando` estiverem implementados;
2. todos os itens `Parcial` estiverem fechados;
3. houver cobertura automatizada minima para os recursos equivalentes do plugin;
4. a release oficial nao depender da pasta de referencia para nenhum build, script ou artefato;
5. a implementacao final preservar a arquitetura standalone como direcao principal do LAIVE OBS.
