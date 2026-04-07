# LAIVE OBS - Design System (Executive)

## 1. Princípios de Design & Sensação (Vibecoding)
O **LAIVE OBS** abandona a aparência rudimentar de softwares técnicos para adotar uma postura de **Controle Executivo**. 
- Deve gerar o *"UAU"* imediato no usuário.
- Design projetado no escuro (Nativo Dark Mode) com aparência high-end, luxuosa e profissional.
- A ferramenta deve parecer um cockpit, instilando confiança imediata no produtor visual/pastor.

## 2. Paleta de Cores (The Executive Dark)

A LAIVE foca num ecossistema polido com toques vívidos apenas em locais cruciais para sinalização de tráfego.

*   **Fundos e Superfícies (Base Dark):**
    *   `Background Master`: #0C0D11 (Quase preto absoluto, passa sensação high-tech).
    *   `Painéis & Cards (Glassmorphism)`: #181A22 (Tom chumbo) com 30% de opacidade e desfoque nativo (blur) gerando profundidade.
    *   `Bordas Separadoras`: #2D303D (Sutís, com 1 pixel de tamanho).
*   **Textos (Typography Colors):**
    *   `Cabeçalhos e Destaques`: #F1F3F5 (Branco nevado).
    *   `Textos Secundários / Labels`: #8F94A8 (Cinza suave para descanso visual).
*   **Cores de Ação (Aura de Status):**
    *   `On-Air (Ao Vivo) / Record`: #FF2A55 (Vermelho vivo com brilho exterior "Glow" na animação).
    *   `OK / Sucesso de Conexão`: #10B981 (Esmeralda elétrico, usado discretamente em ícones de status RTMP).
    *   `Brand Accent (Primária)`: Acor primária remeterá ao ecossistema LAIVE (ex. Roxo/Violeta Premium `#7C3AED` ou Azul Tecnológico `#2563EB`).

## 3. Tipografia Premium

A escolha da tipografia afasta a estética de programação básica.
*   **Fonte Principal (Interfaces e Dashboards):** *Inter* ou *Outfit*.
*   **Hierarquia:** 
    *   Títulos (H1): Peso `600/Semi-Bold`, Tracking (espaçamento) mais fechado.
    *   Leitura de dados (Bitrate/Status): Fontes tabulares/mono (ex. `JetBrains Mono` ou configuração *tabular-nums* da Inter), para que os números de Bitrate (ex: 5400 kbps) não fiquem tremendo visualmente ao mudar em tempo real.

## 4. UI e Micro-Animações

A resposta do software encoraja a interação do produtor:
*   **Formas e Shapes:** Botões e painéis terão um arredondamento confortável de `rounded-lg` (8 a 12px de border-radius). Nem agressivamente quadrado, nem excessivamente circular.
*   **Micro-Animações Inteligentes:**
    *   *Hover State:* Todo botão levantará suavemente e receberá um contorno/brilho no hover com 150ms a 200ms de latência e transição de ease.
    *   *Pulsar do Ao-Vivo:* Quando um destino está conectado mandando mídia, um pequeno badge ou anel ao redor da logo do YouTube/Instagram pulsa em `ease-in-out` infinito avisando da segurança da transmissão.
*   **Glassmorphism (Efeito Vidro Fosco):** Utilizado em painéis dropdown e menus contextuais abertos em cima do grid do painel, garantindo não perda do contexto (você ainda enxerga difusamente os dashboards rodando ao fundo).

## 5. Anatomia de Componentes Chave

### 5.1 O Painel de Destino (Destinations Card)
O cartão de cada plataforma (YouTube, Instagram) manterá 4 camadas cruciais:
1.  **Logo Platform:** Iconográfica de cor sólida ou brand color minimalista.
2.  **Bitrate Real-Time:** Medidor em texto e em mini-gráfico `Sparkline` (se o sinal oscilar caindo, a cor vai para amarelo `#F59E0B`).
3.  **Botão de Ação Isolado:** Um Action Button grande, arredondado e sem ruídos, escrito `INICIAR STREAM` ou `ACOMPANHAR OBS`.
4.  **Configurações Submersas:** Engrenagens ficam camufladas e só revelam um popover fosco (glass) ao clique.
