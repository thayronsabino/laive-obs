# Product Requirements Document (PRD) - LAIVE OBS

## 1. Visão do Produto
O **LAIVE OBS** é um aplicativo de nível executivo e dashboard de controle standalone, desenhado para gerenciar múltiplas transmissões RTMP simultâneas. O sistema opera como um *"cérebro externo"*, comunicando-se com o OBS e recebendo a transmissão principal para redistribuí-la. 

Esta engenharia não apenas garante 100% de propriedade intelectual para a Trionu/LAIVE (blindando o modelo de licença de uso comercial) como **supera tecnicamente** o projeto antigo, oferecendo maior estabilidade ao OBS.

Diretriz arquitetural obrigatoria:
- o motor principal do LAIVE OBS deve permanecer **fora** do processo do OBS Studio;
- a integracao oficial com o OBS deve ocorrer por interfaces externas, como `obs-websocket`, ingest local e embed opcional da interface via Browser Dock;
- qualquer equivalencia funcional com plugins nativos de referencia deve ser buscada primeiro no modelo standalone, e nao por migracao do produto para dentro do core do OBS.

## 2. Missão e Público-Alvo
- **Missão:** Democratizar a transmissão multiplataforma com alta performance, garantindo gratuidade para igrejas e ONGs, enquanto monetiza operações corporativas.
- **Público-Alvo:** Igrejas (Free), Agências de Lançamento, Criadores Profissionais e Emissoras (Licenciados).

## 3. Paridade e Superioridade Técnica (Os "In-Negociáveis")
Este aplicativo deve reproduzir e expandir **todas** as capacidades do antigo plugin `obs-multi-rtmp`:
- **Cross-Platform Nativo:** Distribuição homologada com instaladores para **Windows (.exe/.msi), macOS (.dmg/Apple Silicon & Intel) e Linux (.AppImage/.deb)**.
- **Destinos Infinitos:** Capacidade de adicionar N destinos independentes (YouTube, IG, FB, TikTok, etc.) sem limite arquitetural de software.
- **Controle Individual e Sincronizado:** Opção de parear os botões de Start/Stop com a transmissão "Mãe" do OBS, ou ativar destinos de forma totalmente independente a qualquer momento.
- **Configuração Individual de Encoders/Bitrate:** Assim como no projeto antigo, cada destino poderá herdar a configuração do OBS ou ter configurações próprias de Vídeo/Áudio (permitindo mandar em 1080p pro Youtube e 720p pro Instagram, por exemplo).
- **Sem Perda de Frames no OBS:** O antigo plugin rodava *dentro* do processo do OBS, causando crash ou drop lag quando muitos destinos eram abertos. O novo modelo processa tudo no sistema operacional gerando alívio total para o OBS Studio.
- **Regra de Referência:** a pasta local `obs-multi-rtmp (projeto referencia)` serve apenas como referência técnica e comparativa. Ela nao faz parte do produto, nao deve ser distribuida nos artefatos e nao deve ser publicada no repositório oficial do LAIVE OBS.
- **Critério Formal de Paridade:** o acompanhamento da paridade funcional deve seguir a matriz viva em `docs/PARIDADE_OBS_MULTI_RTMP.md`, e nenhum marco de "paridade 100%" pode ser declarado sem fechamento integral daquele documento.
- **Regra de Equivalência:** paridade com o plugin antigo significa equivalencia de resultado operacional para o usuario, e nao obrigacao de copiar a mesma implementacao interna baseada em `libobs`.
- **Cena Fixa Standalone:** a estrategia oficial para `cena fixa por destino` deve seguir `docs/CENA_FIXA_STANDALONE.md`, usando projectors do OBS como mecanismo auxiliar controlado externamente, sem migrar o motor para plugin nativo.

## 4. Funcionalidades Principais (MVP)

### 4.1. Conexão via WebSocket / Motor de Recebimento
- Conexão auto-discovery com o OBS.
- O App atua como servidor neutro na máquina, blindado e altamente responsivo.

### 4.2. Gestão de Destinos RTMP
- Criação e armazenamento protegido de chaves e URLs de servidores.

### 4.3. Acesso Híbrido: Painel Embedado no OBS e Web App
- **Sensação de "Plugin" Nativo (OBS Browser Dock):** Embora arquitetonicamente o motor seja separado para blindar a licença, a Interface Gráfica (Dashboard) da LAIVE pode ser perfeitamente "colada" dentro da UI do OBS Studio. O usuário apenas adiciona o endereço local nas Docks de Navegador do OBS, e ela fica afixada ao fluxo de trabalho sem parecer um programa isolado.
- **Acesso Web e Mobile Extendido:** Por conta da arquitetura moderna, a mesma interface funciona livremente num navegador web de outro monitor ou pode ser acessada remotamente pelo celular do produtor/pastor, acompanhando a saúde dos envios do altar, sem tocar no PC servidor.
- Interface High-End, monitoramento granular unificado de status em tempo real, painel visual panorâmico das falhas de conexão ou sucesso de multiplas plataformas.

## 5. Modelo de Monetização e Governança
- Licença Source Available com Restrições Comerciais.
- Integração modular transparente para cross-sell com as plataformas Trionu/LAIVE.
