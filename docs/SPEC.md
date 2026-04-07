# Technical Specifications (SPEC) - LAIVE OBS

## 1. Arquitetura do Sistema Central (App Standalone)
Para entregar a paridade técnica requerida (Destinos infinitos, Instalação Windows/Mac/Linux e customização de encoder) sem tocar no ecossistema de bibliotecas C++ GPL (libobs), utilizaremos uma integração Híbrida:

### 1.1. Core Tech Stack
- **Modos de Apresentação ao Usuário (UI Delivery):**
  - **OBS Browser Dock nativo:** A interface se alinha na dock engine interna do OBS Studio.
  - **App Desktop / Servidor Embutido:** Aplicação master responsável pela compilação nativa em cada SO lidando com chaves restritas e injetando FFMPEG.
  - **Web Dashboard Local:** Acessível via `<ip-local>:<port>` do Wi-Fi permitindo controles via smartphone ou tablet (operação Multi-Telas remota sem latência).
- **Frontend UI:** React 18 / Vue 3 visando UX Responsiva High-End flexível a espaços minúsculos (doca) e paineis master full screen de controle de shows.
- **Integração OBS:** protocolo remoto `obs-websocket-js`.
- **Media Engine:** O projeto controla conexões spawnando pools binários de **FFmpeg** em background nativamente, livrando a UI principal de crash lags, atuando como Restream/Relay local.
- **Equivalência de Cena Fixa:** quando um destino exigir scene dedicada, a estrategia oficial e abrir/capturar projectors do OBS por API externa, conforme `docs/CENA_FIXA_STANDALONE.md`.

## 2. Fluxo de Multiplexação (Como criar infinitos canais com encoders únicos)
Nativamente, o WebSockets v5 do OBS controla o "Start" e "Stop" da transmissão Mãe, mas não permite abrir destinos clones independentes do zero. Para resolver a paridade de "múltiplos plugins RTMP":

1. O OBS envia UMA única stream principal de qualidade Master da rede local (ex: localhost:1935, levantado pela LAIVE) ou via Virtual Cam/Audio.
2. A aplicação local da LAIVE recebe essa Stream RAW de qualidade master.
3. O **Media Engine (FFmpeg)** spawnado silenciosamente pela aplicação Electron clona a stream (Restreaming/Multiplex) e lança simultaneamente para todos os pontos infinitos N.
4. **Vantagem de Encoder Local:** Se o destino A precisar de codificação via Hardware (NVIDIA NVENC no Windows, ou Apple VideoToolbox M1/M2 no Mac) com bitrates customizados, o App LAIVE passa esses argumentos usando 100% das GPUs de forma independente assim como era feito via UI interna do OBS antigamente. Tudo sem sobrecarregar a Thread Visual do OBS, resolvendo o problema mais criticado do OBS original que travava quando a GPU era dividida internamente e mal escalonada.

## 3. Experiência Cross-Platform

- O build de produção do app envolverá pipelines automatizadas (`Electron-Forge` ou `Tauri`) visando:
  - `Windows`: Instalador Setup (.exe) com suporte à API DirectX e MediaFoundation/NVENC.
  - `macOS`: App Bundle (.dmg) Universal suportando processadores Intel e Apple Silicon (M1/M2/M3) com codificação hardware via VideoToolbox.
  - `Linux`: Pacotes padrão AppImage/Deb com suporte à VAAPI para hardware encoding.

## 4. Estrutura de Automação Visual (UX)
Como o app não está amarrado ao layout "quadrado" do form Qt nativo do OBS, é possível exibir telas ricas com gráficos de consumo de rede e pre-sets atados a contas salvas, gerenciando tokens das APIs de cada plataforma em vez do usuário colar chaves RTMP estáticas todo streaming. E ainda comandar o OBS via websocket de forma bidirecional (ex: apertar Record ou Scene Switch a partir do app LAIVE).
