(function () {
  const e = React.createElement;
  const { useEffect, useMemo, useState } = React;

  async function request(path, init = {}) {
    const response = await fetch(path, {
      credentials: "same-origin",
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init.headers || {})
      }
    });

    const text = await response.text();
    const payload = text ? safeJsonParse(text) : null;

    if (!response.ok) {
      const error = new Error(
        (payload && (payload.error || payload.reason)) ||
          `Request failed (${response.status})`
      );
      error.status = response.status;
      error.payload = payload;
      throw error;
    }

    return payload;
  }

  function safeJsonParse(text) {
    try {
      return JSON.parse(text);
    } catch (_) {
      return null;
    }
  }

  function getProtocolDefaultServerUrl(protocol) {
    switch (protocol) {
      case "rtmps":
        return "rtmps://a.rtmps.youtube.com/live2";
      case "srt":
        return "srt://127.0.0.1:9998?mode=caller&latency=2000000";
      case "rist":
        return "rist://127.0.0.1:8193";
      case "whip":
        return "https://whip.example.com/rtc/v1/whip/?app=live&stream=main";
      case "rtmp":
      default:
        return "rtmp://a.rtmp.youtube.com/live2";
    }
  }

  function protocolRequiresStreamKey(protocol) {
    return protocol === "rtmp" || protocol === "rtmps";
  }

  const SUPPORTED_LOCALES = ["pt-BR", "en-US"];
  const TRANSLATIONS = {
    "pt-BR": {
      "app.loading": "Carregando LAIVE OBS...",
      "locale.label": "Idioma",
      "locale.pt-BR": "Português (BR)",
      "locale.en-US": "English",
      "auth.bootstrapDone": "Bootstrap concluído. Faça login.",
      "auth.initialSetup": "Configuração Inicial",
      "auth.initialSetupDesc":
        "Crie a credencial local de administrador para acesso ao dashboard.",
      "auth.username": "Usuário",
      "auth.passwordMin": "Senha (mínimo 8 caracteres)",
      "auth.password": "Senha",
      "auth.saveCredential": "Salvar credencial",
      "auth.saving": "Salvando...",
      "auth.loginTitle": "Entrar no LAIVE OBS",
      "auth.signIn": "Entrar",
      "auth.signingIn": "Entrando...",
      "header.subtitle": "Standalone Hybrid v0.2 — React Dashboard",
      "header.logout": "Sair ({username})",
      "header.userFallback": "user",
      "status.obs": "OBS: {value}",
      "status.connected": "conectado",
      "status.disconnected": "desconectado",
      "status.stream": "Stream: {value}",
      "status.live": "ao vivo",
      "status.idle": "ocioso",
      "status.record": "Record: {value}",
      "status.on": "ligado",
      "status.off": "desligado",
      "status.destination.idle": "idle",
      "status.destination.connecting": "connecting",
      "status.destination.live": "live",
      "status.destination.reconnecting": "reconnecting",
      "status.destination.stopped": "stopped",
      "status.destination.error": "error",
      "banner.dismiss": "Fechar",
      "destination.editTitle": "Editar destino",
      "destination.addTitle": "Adicionar destino",
      "destination.name": "Nome",
      "destination.protocol": "Protocolo",
      "destination.whipEndpoint": "Endpoint WHIP",
      "destination.serverUrl": "Server URL",
      "destination.streamKey": "Stream key",
      "destination.optionalTokenLabel": "Token / rótulo opcional",
      "destination.keepCurrentKey": "Deixe em branco para manter a chave atual",
      "destination.currentMasked": "Atual: {value}",
      "destination.videoSource": "Origem de vídeo",
      "destination.sceneForTarget": "Scene deste destino",
      "destination.selectScene": "Selecione uma scene",
      "destination.refreshScenes": "Atualize as scenes do OBS",
      "destination.projectorTitle": "Vínculo do projector",
      "destination.projectorTitlePlaceholder":
        "Título exato da janela do projector do OBS",
      "destination.projectorHelp":
        "Windows usa o título da janela. No macOS/Linux, a detecção preenche automaticamente o alvo de captura do projector.",
      "destination.detectedProjectors": "Projectors detectados",
      "destination.selectDetectedProjector":
        "Selecione uma janela detectada",
      "destination.captureDisplayMeta":
        "Display index: {displayIndex} | Crop: {cropX}, {cropY} {cropWidth}x{cropHeight}",
      "destination.captureX11Meta":
        "X11 window: {windowId} | DISPLAY: {display}",
      "destination.openProjector": "Abrir projector da scene",
      "destination.detectProjector": "Detectar projector",
      "destination.validateCapture": "Validar captura",
      "destination.previewCapture": "Preview do capture",
      "destination.saveFirst":
        "Salve o destino primeiro para abrir ou validar o projector por este painel.",
      "destination.previewHint":
        "Capture um frame real do target configurado antes do start.",
      "destination.outputMode": "Modo de saída",
      "destination.outputModeInherit": "herdar",
      "destination.outputModeCustom": "customizado",
      "destination.videoSourceMasterIngest": "ingest master",
      "destination.videoSourceSceneProjector": "captura por projector",
      "destination.scenePrefix": "scene: {sceneName}",
      "destination.videoCodec": "Codec de vídeo",
      "destination.videoBitrate": "Bitrate de vídeo kbps",
      "destination.fps": "FPS",
      "destination.fpsDivisor": "Divisor de FPS",
      "destination.width": "Largura",
      "destination.height": "Altura",
      "destination.gop": "GOP (seg)",
      "destination.bframes": "B-frames",
      "destination.preset": "Preset",
      "destination.audioCodec": "Codec de áudio",
      "destination.audioBitrate": "Bitrate de áudio kbps",
      "destination.audioInputTrack": "Trilha principal de áudio",
      "destination.vodTrack": "Trilha VOD (opcional)",
      "destination.vodTrackHelp":
        "Ativo quando o source e o protocolo suportam áudio multi-track.",
      "destination.bitrateOverride": "Override de bitrate",
      "destination.syncStart": "Sincronizar start com OBS",
      "destination.syncStop": "Sincronizar stop com OBS",
      "destination.saveEdit": "Salvar edição",
      "destination.save": "Salvar destino",
      "destination.cancel": "Cancelar",
      "destinations.title": "Destinos",
      "destinations.startAll": "Start all",
      "destinations.stopAll": "Stop all",
      "destinations.order": "Ordem",
      "destinations.publish": "Publish",
      "destinations.mode": "Modo",
      "destinations.videoSource": "Origem de vídeo",
      "destinations.status": "Status",
      "destinations.actions": "Ações",
      "destinations.dragTitle": "Arraste para reordenar",
      "destinations.master": "master",
      "destinations.edit": "Editar",
      "destinations.projector": "Projector",
      "destinations.validate": "Validar",
      "destinations.reopenProjector": "Reabrir",
      "destinations.forgetProjector": "Esquecer",
      "destinations.up": "Subir",
      "destinations.down": "Descer",
      "destinations.start": "Start",
      "destinations.stop": "Stop",
      "destinations.delete": "Excluir",
      "obs.title": "Controle do OBS",
      "obs.refreshScenes": "Atualizar scenes",
      "obs.startStream": "Start Stream",
      "obs.stopStream": "Stop Stream",
      "obs.startRecord": "Start Record",
      "obs.stopRecord": "Stop Record",
      "obs.switchScene": "Trocar scene",
      "network.title": "Rede e Segurança",
      "network.allowLan": "Permitir LAN (0.0.0.0)",
      "network.bind": "Bind",
      "network.sessionTtl": "TTL da sessão (seg)",
      "network.save": "Salvar rede",
      "metrics.title": "Métricas Operacionais",
      "metrics.httpRequests": "HTTP Requests",
      "metrics.reconnects": "Reconnects",
      "metrics.errors": "Errors",
      "metrics.activePipelines": "Pipelines Ativos",
      "metrics.incidentTimeline": "Linha do Tempo de Incidentes",
      "events.title": "Fluxo de eventos",
      "projectors.title": "Projectors Gerenciados",
      "projectors.reopenAll": "Reabrir todos",
      "projectors.close": "Fechar",
      "projectors.empty": "Nenhum projector gerenciado neste runtime.",
      "readiness.title": "Prontidão de Transmissão",
      "readiness.run": "Executar readiness",
      "readiness.empty": "Nenhum relatório de readiness executado nesta sessão.",
      "readiness.summary": "Resumo",
      "readiness.source": "Fonte",
      "readiness.status": "Prontidão",
      "readiness.ready": "Pronto",
      "readiness.warning": "Atenção",
      "readiness.blocked": "Bloqueado",
      "readiness.checks": "Checks",
      "message.editingDestination": "Editando destino \"{name}\".",
      "message.projectorOpened": "Projector aberto para {sceneName}.",
      "message.projectorDetectedBound":
        "Projector detectado e vinculado automaticamente: {title}",
      "message.projectorDetectedMany":
        "Foram detectadas {count} janela(s) de projector. Escolha a correta no formulário.",
      "message.projectorDetectedNone":
        "Nenhuma janela de projector correspondente foi detectada. Confirme que o OBS abriu a janela correta.",
      "message.destinationUpdated": "Destino atualizado com sucesso.",
      "message.destinationSaved": "Destino salvo com sucesso.",
      "message.destinationMovedUp": "Destino movido para cima.",
      "message.destinationMovedDown": "Destino movido para baixo.",
      "message.destinationOrderUpdated": "Ordem dos destinos atualizada.",
      "message.destinationsStarted": "Destinos iniciados.",
      "message.destinationsStopped": "Destinos parados.",
      "message.destinationStarted": "Destino iniciado.",
      "message.destinationStopped": "Destino parado.",
      "message.destinationRemoved": "Destino removido.",
      "message.streamStarted": "Stream iniciada.",
      "message.streamStopped": "Stream parada.",
      "message.recordStarted": "Record iniciado.",
      "message.recordStopped": "Record parado.",
      "message.sceneSwitched": "Cena alterada para {sceneName}.",
      "message.networkUpdated":
        "Configuração de rede atualizada. Reinicie o core para aplicar bind.",
      "message.sessionEnded": "Sessão encerrada.",
      "message.captureValidated":
        "Target de captura validado com sucesso em {platform}.",
      "message.projectorsReopened": "Projectors gerenciados reabertos.",
      "message.projectorClosed": "Projector gerenciado fechado.",
      "message.projectorForgotten": "Projector removido do registry gerenciado.",
      "message.readinessLoaded": "Readiness de transmissão atualizado.",
      "message.guidancePrefix": "Ação sugerida:"
    },
    "en-US": {
      "app.loading": "Loading LAIVE OBS...",
      "locale.label": "Language",
      "locale.pt-BR": "Portuguese (BR)",
      "locale.en-US": "English",
      "auth.bootstrapDone": "Bootstrap completed. Sign in.",
      "auth.initialSetup": "Initial Setup",
      "auth.initialSetupDesc":
        "Create the local administrator credential for dashboard access.",
      "auth.username": "Username",
      "auth.passwordMin": "Password (minimum 8 characters)",
      "auth.password": "Password",
      "auth.saveCredential": "Save credential",
      "auth.saving": "Saving...",
      "auth.loginTitle": "Sign in to LAIVE OBS",
      "auth.signIn": "Sign in",
      "auth.signingIn": "Signing in...",
      "header.subtitle": "Standalone Hybrid v0.2 — React Dashboard",
      "header.logout": "Sign out ({username})",
      "header.userFallback": "user",
      "status.obs": "OBS: {value}",
      "status.connected": "connected",
      "status.disconnected": "disconnected",
      "status.stream": "Stream: {value}",
      "status.live": "live",
      "status.idle": "idle",
      "status.record": "Record: {value}",
      "status.on": "on",
      "status.off": "off",
      "status.destination.idle": "idle",
      "status.destination.connecting": "connecting",
      "status.destination.live": "live",
      "status.destination.reconnecting": "reconnecting",
      "status.destination.stopped": "stopped",
      "status.destination.error": "error",
      "banner.dismiss": "Dismiss",
      "destination.editTitle": "Edit destination",
      "destination.addTitle": "Add destination",
      "destination.name": "Name",
      "destination.protocol": "Protocol",
      "destination.whipEndpoint": "WHIP endpoint",
      "destination.serverUrl": "Server URL",
      "destination.streamKey": "Stream key",
      "destination.optionalTokenLabel": "Optional token / label",
      "destination.keepCurrentKey": "Leave blank to keep the current key",
      "destination.currentMasked": "Current: {value}",
      "destination.videoSource": "Video source",
      "destination.sceneForTarget": "Scene for this destination",
      "destination.selectScene": "Select a scene",
      "destination.refreshScenes": "Refresh OBS scenes",
      "destination.projectorTitle": "Projector binding",
      "destination.projectorTitlePlaceholder":
        "Exact OBS projector window title",
      "destination.projectorHelp":
        "Windows uses the window title. On macOS/Linux, detection auto-fills the projector capture target.",
      "destination.detectedProjectors": "Detected projectors",
      "destination.selectDetectedProjector": "Select a detected window",
      "destination.captureDisplayMeta":
        "Display index: {displayIndex} | Crop: {cropX}, {cropY} {cropWidth}x{cropHeight}",
      "destination.captureX11Meta":
        "X11 window: {windowId} | DISPLAY: {display}",
      "destination.openProjector": "Open scene projector",
      "destination.detectProjector": "Detect projector",
      "destination.validateCapture": "Validate capture",
      "destination.previewCapture": "Preview capture",
      "destination.saveFirst":
        "Save the destination first to open or validate the projector from this panel.",
      "destination.previewHint":
        "Capture a real frame from the configured target before start.",
      "destination.outputMode": "Output mode",
      "destination.outputModeInherit": "inherit",
      "destination.outputModeCustom": "custom",
      "destination.videoSourceMasterIngest": "master ingest",
      "destination.videoSourceSceneProjector": "scene projector capture",
      "destination.scenePrefix": "scene: {sceneName}",
      "destination.videoCodec": "Video codec",
      "destination.videoBitrate": "Video bitrate kbps",
      "destination.fps": "FPS",
      "destination.fpsDivisor": "FPS divisor",
      "destination.width": "Width",
      "destination.height": "Height",
      "destination.gop": "GOP (sec)",
      "destination.bframes": "B-frames",
      "destination.preset": "Preset",
      "destination.audioCodec": "Audio codec",
      "destination.audioBitrate": "Audio bitrate kbps",
      "destination.audioInputTrack": "Primary audio track",
      "destination.vodTrack": "VOD track (optional)",
      "destination.vodTrackHelp":
        "Active when the source and protocol support multi-track audio.",
      "destination.bitrateOverride": "Bitrate override",
      "destination.syncStart": "Sync start with OBS",
      "destination.syncStop": "Sync stop with OBS",
      "destination.saveEdit": "Save edit",
      "destination.save": "Save destination",
      "destination.cancel": "Cancel",
      "destinations.title": "Destinations",
      "destinations.startAll": "Start all",
      "destinations.stopAll": "Stop all",
      "destinations.order": "Order",
      "destinations.publish": "Publish",
      "destinations.mode": "Mode",
      "destinations.videoSource": "Video source",
      "destinations.status": "Status",
      "destinations.actions": "Actions",
      "destinations.dragTitle": "Drag to reorder",
      "destinations.master": "master",
      "destinations.edit": "Edit",
      "destinations.projector": "Projector",
      "destinations.validate": "Validate",
      "destinations.reopenProjector": "Reopen",
      "destinations.forgetProjector": "Forget",
      "destinations.up": "Up",
      "destinations.down": "Down",
      "destinations.start": "Start",
      "destinations.stop": "Stop",
      "destinations.delete": "Delete",
      "obs.title": "OBS Control",
      "obs.refreshScenes": "Refresh scenes",
      "obs.startStream": "Start Stream",
      "obs.stopStream": "Stop Stream",
      "obs.startRecord": "Start Record",
      "obs.stopRecord": "Stop Record",
      "obs.switchScene": "Switch scene",
      "network.title": "Network & Security",
      "network.allowLan": "Allow LAN (0.0.0.0)",
      "network.bind": "Bind",
      "network.sessionTtl": "Session TTL (sec)",
      "network.save": "Save network",
      "metrics.title": "Operational Metrics",
      "metrics.httpRequests": "HTTP Requests",
      "metrics.reconnects": "Reconnects",
      "metrics.errors": "Errors",
      "metrics.activePipelines": "Active Pipelines",
      "metrics.incidentTimeline": "Incident Timeline",
      "events.title": "Event stream",
      "projectors.title": "Managed Projectors",
      "projectors.reopenAll": "Reopen all",
      "projectors.close": "Close",
      "projectors.empty": "No managed projector in this runtime.",
      "readiness.title": "Transmission Readiness",
      "readiness.run": "Run readiness",
      "readiness.empty": "No readiness report has been executed in this session.",
      "readiness.summary": "Summary",
      "readiness.source": "Source",
      "readiness.status": "Readiness",
      "readiness.ready": "Ready",
      "readiness.warning": "Warning",
      "readiness.blocked": "Blocked",
      "readiness.checks": "Checks",
      "message.editingDestination": "Editing destination \"{name}\".",
      "message.projectorOpened": "Projector opened for {sceneName}.",
      "message.projectorDetectedBound":
        "Projector detected and auto-bound: {title}",
      "message.projectorDetectedMany":
        "{count} projector window(s) were detected. Choose the correct one in the form.",
      "message.projectorDetectedNone":
        "No matching projector window was detected. Confirm that OBS opened the correct window.",
      "message.destinationUpdated": "Destination updated successfully.",
      "message.destinationSaved": "Destination saved successfully.",
      "message.destinationMovedUp": "Destination moved up.",
      "message.destinationMovedDown": "Destination moved down.",
      "message.destinationOrderUpdated": "Destination order updated.",
      "message.destinationsStarted": "Destinations started.",
      "message.destinationsStopped": "Destinations stopped.",
      "message.destinationStarted": "Destination started.",
      "message.destinationStopped": "Destination stopped.",
      "message.destinationRemoved": "Destination removed.",
      "message.streamStarted": "Stream started.",
      "message.streamStopped": "Stream stopped.",
      "message.recordStarted": "Record started.",
      "message.recordStopped": "Record stopped.",
      "message.sceneSwitched": "Scene switched to {sceneName}.",
      "message.networkUpdated":
        "Network configuration updated. Restart the core to apply the bind address.",
      "message.sessionEnded": "Session ended.",
      "message.captureValidated":
        "Capture target validated successfully on {platform}.",
      "message.projectorsReopened": "Managed projectors reopened.",
      "message.projectorClosed": "Managed projector closed.",
      "message.projectorForgotten": "Projector removed from managed registry.",
      "message.readinessLoaded": "Transmission readiness refreshed.",
      "message.guidancePrefix": "Suggested action:"
    }
  };

  function normalizeLocale(locale) {
    if (!locale) {
      return "pt-BR";
    }
    const normalized = String(locale).toLowerCase();
    if (normalized.startsWith("en")) {
      return "en-US";
    }
    return "pt-BR";
  }

  function resolveInitialLocale() {
    const browserLocale =
      (navigator.languages && navigator.languages[0]) || navigator.language || "pt-BR";
    return normalizeLocale(browserLocale);
  }

  function formatText(template, params = {}) {
    return String(template).replace(/\{(\w+)\}/g, (_match, key) => {
      return params[key] === undefined || params[key] === null ? "" : String(params[key]);
    });
  }

  function createTranslator(locale) {
    const activeLocale = SUPPORTED_LOCALES.includes(locale) ? locale : "pt-BR";
    const messages = TRANSLATIONS[activeLocale] || TRANSLATIONS["pt-BR"];
    return function t(key, params = {}) {
      const fallback = TRANSLATIONS["pt-BR"][key] || key;
      const template = messages[key] || fallback;
      return formatText(template, params);
    };
  }

  function describeError(error, t) {
    const message =
      error && error.message ? String(error.message) : "Unknown error.";
    const payload = error && error.payload ? error.payload : null;
    const guidance =
      payload && Array.isArray(payload.guidance) && payload.guidance.length > 0
        ? ` ${t("message.guidancePrefix")} ${payload.guidance.join(" ")}`
        : "";
    return `${message}${guidance}`.trim();
  }

  function formatOutputModeLabel(value, t) {
    if (value === "custom") {
      return t("destination.outputModeCustom");
    }
    return t("destination.outputModeInherit");
  }

  function formatVideoSourceModeLabel(destination, t) {
    if (
      destination &&
      destination.videoSourceMode === "scene_projector_capture"
    ) {
      return t("destination.scenePrefix", {
        sceneName:
          (destination.sceneBinding && destination.sceneBinding.sceneName) || "-"
      });
    }
    return t("destination.videoSourceMasterIngest");
  }

  function formatDestinationStatusLabel(status, t) {
    return t(`status.destination.${String(status || "idle")}`);
  }

  function renderLocaleControl(locale, setLocale, t) {
    return e(
      "label",
      { className: "locale-select" },
      e("span", null, t("locale.label")),
      e(
        "select",
        {
          value: locale,
          onChange: (ev) => setLocale(normalizeLocale(ev.target.value))
        },
        SUPPORTED_LOCALES.map((value) =>
          e("option", { key: value, value }, t(`locale.${value}`))
        )
      )
    );
  }

  function buildDefaultDestinationForm() {
    return {
      name: "",
      protocol: "rtmp",
      serverUrl: getProtocolDefaultServerUrl("rtmp"),
      streamKey: "",
      bitrateKbps: 0,
      syncWithObsStart: true,
      syncWithObsStop: true,
      outputMode: "inherit",
      videoSourceMode: "master_ingest",
      sceneBinding: {
        sceneName: "",
        captureMethod: "windows_window_title",
        projectorWindowTitle: ""
      },
      videoProfile: {
        videoCodec: "libx264",
        bitrateKbps: 0,
        fps: 30,
        fpsDenominator: 1,
        width: 1280,
        height: 720,
        gopSec: 2,
        bFrames: 0,
        preset: "veryfast"
      },
      audioProfile: {
        audioCodec: "aac",
        audioBitrateKbps: 128,
        inputTrackIndex: 0,
        vodTrackInputIndex: ""
      }
    };
  }

  function buildDestinationFormFromExisting(destination) {
    const fallback = buildDefaultDestinationForm();
    return {
      ...fallback,
      ...destination,
      streamKey: "",
      videoProfile: {
        ...fallback.videoProfile,
        ...((destination && destination.videoProfile) || {})
      },
      sceneBinding: {
        ...fallback.sceneBinding,
        ...((destination && destination.sceneBinding) || {})
      },
      audioProfile: {
        ...fallback.audioProfile,
        ...((destination && destination.audioProfile) || {}),
        vodTrackInputIndex:
          destination &&
          destination.audioProfile &&
          destination.audioProfile.vodTrackInputIndex !== null &&
          destination.audioProfile.vodTrackInputIndex !== undefined
            ? destination.audioProfile.vodTrackInputIndex
            : ""
      }
    };
  }

  function buildDestinationPayload(formState, options = {}) {
    const payload = {
      name: formState.name,
      protocol: formState.protocol,
      serverUrl: formState.serverUrl,
      bitrateKbps: formState.bitrateKbps,
      syncWithObsStart: formState.syncWithObsStart,
      syncWithObsStop: formState.syncWithObsStop,
      outputMode: formState.outputMode,
      videoSourceMode: formState.videoSourceMode,
      sceneBinding: { ...formState.sceneBinding },
      videoProfile: { ...formState.videoProfile },
      audioProfile: {
        ...formState.audioProfile,
        vodTrackInputIndex:
          formState.audioProfile.vodTrackInputIndex === ""
            ? null
            : Number(formState.audioProfile.vodTrackInputIndex)
      }
    };

    if (!options.preserveExistingStreamKey || formState.streamKey) {
      payload.streamKey = formState.streamKey;
    }

    return payload;
  }

  function App() {
    const [locale, setLocale] = useState(resolveInitialLocale());
    const t = useMemo(() => createTranslator(locale), [locale]);
    const [authStatus, setAuthStatus] = useState({
      loading: true,
      configured: false,
      authenticated: false,
      username: null
    });
    const [message, setMessage] = useState("");

    async function refreshAuthStatus() {
      try {
        const status = await request("/api/auth/status", {
          headers: {}
        });
        setAuthStatus({ loading: false, ...status });
      } catch (error) {
        setAuthStatus((current) => ({ ...current, loading: false }));
        setMessage(describeError(error, t));
      }
    }

    useEffect(() => {
      refreshAuthStatus();
    }, []);

    if (authStatus.loading) {
      return e(
        "div",
        { className: "auth-shell" },
        e(
          "div",
          { className: "auth-card" },
          renderLocaleControl(locale, setLocale, t),
          e("h2", null, t("app.loading"))
        )
      );
    }

    if (!authStatus.configured) {
      return e(BootstrapView, {
        onDone: refreshAuthStatus,
        setGlobalMessage: setMessage,
        locale,
        setLocale,
        t
      });
    }

    if (!authStatus.authenticated) {
      return e(LoginView, {
        onDone: refreshAuthStatus,
        setGlobalMessage: setMessage,
        locale,
        setLocale,
        t
      });
    }

    return e(DashboardView, {
      authStatus,
      onLogout: refreshAuthStatus,
      globalMessage: message,
      clearGlobalMessage: () => setMessage(""),
      locale,
      setLocale,
      t
    });
  }

  function BootstrapView({ onDone, setGlobalMessage, locale, setLocale, t }) {
    const [username, setUsername] = useState("admin");
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);

    async function submit(event) {
      event.preventDefault();
      setLoading(true);
      try {
        await request("/api/auth/bootstrap", {
          method: "POST",
          body: JSON.stringify({ username, password })
        });
        setGlobalMessage(t("auth.bootstrapDone"));
        await onDone();
      } catch (error) {
        setGlobalMessage(describeError(error, t));
      } finally {
        setLoading(false);
      }
    }

    return e(
      "div",
      { className: "auth-shell" },
      e(
        "form",
        { className: "auth-card", onSubmit: submit },
        renderLocaleControl(locale, setLocale, t),
        e("h2", null, t("auth.initialSetup")),
        e("p", null, t("auth.initialSetupDesc")),
        e("label", null, t("auth.username"), e("input", { value: username, onChange: (ev) => setUsername(ev.target.value), required: true })),
        e("label", null, t("auth.passwordMin"), e("input", { type: "password", value: password, onChange: (ev) => setPassword(ev.target.value), required: true, minLength: 8 })),
        e("button", { type: "submit", disabled: loading }, loading ? t("auth.saving") : t("auth.saveCredential"))
      )
    );
  }

  function LoginView({ onDone, setGlobalMessage, locale, setLocale, t }) {
    const [username, setUsername] = useState("admin");
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);

    async function submit(event) {
      event.preventDefault();
      setLoading(true);
      try {
        await request("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({ username, password })
        });
        setGlobalMessage("");
        await onDone();
      } catch (error) {
        setGlobalMessage(describeError(error, t));
      } finally {
        setLoading(false);
      }
    }

    return e(
      "div",
      { className: "auth-shell" },
      e(
        "form",
        { className: "auth-card", onSubmit: submit },
        renderLocaleControl(locale, setLocale, t),
        e("h2", null, t("auth.loginTitle")),
        e("label", null, t("auth.username"), e("input", { value: username, onChange: (ev) => setUsername(ev.target.value), required: true })),
        e("label", null, t("auth.password"), e("input", { type: "password", value: password, onChange: (ev) => setPassword(ev.target.value), required: true })),
        e("button", { type: "submit", disabled: loading }, loading ? t("auth.signingIn") : t("auth.signIn"))
      )
    );
  }

  function DashboardView({
    authStatus,
    onLogout,
    globalMessage,
    clearGlobalMessage,
    locale,
    setLocale,
    t
  }) {
    const [statusPayload, setStatusPayload] = useState({
      destinations: [],
      managedProjectors: [],
      obs: {},
      ingest: {},
      orchestrator: { activePipelines: [] }
    });
    const [diagnostics, setDiagnostics] = useState({
      metrics: { counters: {}, recentEvents: [] }
    });
    const [formState, setFormState] = useState(buildDefaultDestinationForm());
    const [editingDestinationId, setEditingDestinationId] = useState(null);
    const [dragState, setDragState] = useState({
      draggedId: null,
      overId: null
    });
    const [network, setNetwork] = useState({
      allowLan: false,
      bindAddress: "127.0.0.1",
      sessionTtlSec: 1800
    });
    const [scenes, setScenes] = useState([]);
    const [selectedScene, setSelectedScene] = useState("");
    const [events, setEvents] = useState([]);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState(globalMessage || "");
    const [projectorCandidates, setProjectorCandidates] = useState([]);
    const [projectorPreviewUrl, setProjectorPreviewUrl] = useState("");
    const [projectorPreviewMeta, setProjectorPreviewMeta] = useState(null);
    const [readinessReport, setReadinessReport] = useState(null);

    useEffect(() => {
      setMessage(globalMessage || "");
    }, [globalMessage]);

    function pushEvent(label) {
      setEvents((current) => [
        `${new Date().toLocaleTimeString()} · ${label}`,
        ...current
      ].slice(0, 100));
    }

    function clearProjectorPreview() {
      setProjectorPreviewUrl((current) => {
        if (current) {
          URL.revokeObjectURL(current);
        }
        return "";
      });
      setProjectorPreviewMeta(null);
    }

    useEffect(
      () => () => {
        if (projectorPreviewUrl) {
          URL.revokeObjectURL(projectorPreviewUrl);
        }
      },
      [projectorPreviewUrl]
    );

    async function refreshAll() {
      const [status, diag, networkPayload] = await Promise.all([
        request("/api/status"),
        request("/api/diagnostics"),
        request("/api/settings/network")
      ]);
      setStatusPayload(status);
      setDiagnostics(diag || { metrics: { counters: {}, recentEvents: [] } });
      setNetwork(networkPayload || {});
    }

    async function refreshScenes() {
      try {
        const payload = await request("/api/obs/scenes");
        const sceneList = (payload && payload.scenes) || [];
        setScenes(sceneList);
        if (payload && payload.currentSceneName) {
          setSelectedScene(payload.currentSceneName);
        } else if (sceneList.length > 0 && !selectedScene) {
          setSelectedScene(sceneList[0].sceneName);
        }
      } catch (error) {
        pushEvent(`obs.scenes error: ${error.message}`);
      }
    }

    useEffect(() => {
      refreshAll().catch((error) => setMessage(describeError(error, t)));
      refreshScenes().catch(() => {});
    }, []);

    useEffect(() => {
      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${protocol}://${window.location.host}/events`);
      ws.onmessage = (raw) => {
        const event = safeJsonParse(raw.data);
        if (!event) {
          return;
        }
        pushEvent(event.type);
        if (
          String(event.type || "").startsWith("destination.") ||
          String(event.type || "").startsWith("obs.")
        ) {
          refreshAll().catch(() => {});
        }
      };
      ws.onclose = () => {
        pushEvent("event bus disconnected");
      };
      return () => ws.close();
    }, []);

    const counters = diagnostics.metrics ? diagnostics.metrics.counters || {} : {};
    const activePipelines = ((statusPayload.orchestrator || {}).activePipelines || [])
      .length;
    const editingDestination = useMemo(
      () =>
        statusPayload.destinations.find((item) => item.id === editingDestinationId) ||
        null,
      [statusPayload.destinations, editingDestinationId]
    );
    const incidentTimeline = ((diagnostics.metrics || {}).recentEvents || []).filter(
      (event) =>
        [
          "destination.error",
          "destination.reconnecting",
          "engine.watchdog_timeout",
          "engine.pipeline_stalled",
          "engine.force_kill_requested",
          "destination.profile_warning",
          "obs.connection_error"
        ].includes(event.type)
    );

    function resetDestinationForm() {
      setEditingDestinationId(null);
      setProjectorCandidates([]);
      clearProjectorPreview();
      setFormState(buildDefaultDestinationForm());
    }

    function beginEditDestination(destination) {
      setEditingDestinationId(destination.id);
      setProjectorCandidates([]);
      clearProjectorPreview();
      setFormState(buildDestinationFormFromExisting(destination));
      setMessage(t("message.editingDestination", { name: destination.name }));
    }

    async function openProjectorForDestination(destinationId, label) {
      await runAction(label, () =>
        request(`/api/destinations/${destinationId}/projector/open`, {
          method: "POST",
          headers: {}
        })
      );
    }

    async function detectProjectorForEditingDestination() {
      if (!editingDestinationId) {
        return;
      }

      setBusy(true);
      try {
        const payload = await request(
          `/api/destinations/${editingDestinationId}/projector/detect`,
          {
            method: "POST",
            headers: {}
          }
        );

        const candidates = (payload && payload.candidates) || [];
        setProjectorCandidates(candidates);
        clearProjectorPreview();

        if (payload && payload.destination) {
          setFormState(buildDestinationFormFromExisting(payload.destination));
        }

        await refreshAll();

        if (payload && payload.autoBound && payload.destination) {
          setMessage(
            t("message.projectorDetectedBound", {
              title: payload.destination.sceneBinding.projectorWindowTitle
            })
          );
        } else if (candidates.length > 0) {
          setMessage(
            t("message.projectorDetectedMany", { count: candidates.length })
          );
        } else {
          setMessage(t("message.projectorDetectedNone"));
        }
      } catch (error) {
        setMessage(describeError(error, t));
      } finally {
        setBusy(false);
      }
    }

    async function validateProjectorDestination(destinationId) {
      setBusy(true);
      try {
        const payload = await request(
          `/api/destinations/${destinationId}/projector/validate`,
          {
            method: "POST",
            headers: {}
          }
        );
        const platform =
          payload && payload.validation && payload.validation.platform
            ? payload.validation.platform
            : "runtime";
        setMessage(t("message.captureValidated", { platform }));
        await refreshAll();
      } catch (error) {
        setMessage(describeError(error, t));
      } finally {
        setBusy(false);
      }
    }

    async function reopenManagedProjectors() {
      await runAction(t("message.projectorsReopened"), () =>
        request("/api/projectors/reopen-managed", {
          method: "POST",
          headers: {}
        })
      );
    }

    async function reopenManagedProjector(destinationId) {
      await runAction(t("message.projectorsReopened"), () =>
        request(`/api/projectors/managed/${destinationId}/reopen`, {
          method: "POST",
          headers: {}
        })
      );
    }

    async function forgetManagedProjector(destinationId) {
      await runAction(t("message.projectorForgotten"), () =>
        request(`/api/projectors/managed/${destinationId}`, {
          method: "DELETE",
          headers: {}
        })
      );
    }

    async function closeManagedProjector(destinationId) {
      await runAction(t("message.projectorClosed"), () =>
        request(`/api/projectors/managed/${destinationId}/close`, {
          method: "POST",
          headers: {}
        })
      );
    }

    function applyDetectedProjectorCandidate(title) {
      const candidate = projectorCandidates.find((item) => item.title === title);
      if (!candidate) {
        clearProjectorPreview();
        updateForm("sceneBinding.projectorWindowTitle", title);
        return;
      }

      clearProjectorPreview();
      setFormState((current) => ({
        ...current,
        sceneBinding: {
          ...current.sceneBinding,
          ...(candidate.suggestedSceneBinding || {}),
          projectorWindowTitle: candidate.title
        }
      }));
    }

    async function submitDestination(event) {
      event.preventDefault();
      setBusy(true);
      try {
        const isEditing = Boolean(editingDestinationId);
        const path = isEditing
          ? `/api/destinations/${editingDestinationId}`
          : "/api/destinations";
        const method = isEditing ? "PATCH" : "POST";
        const payload = buildDestinationPayload(formState, {
          preserveExistingStreamKey: isEditing
        });
        await request(path, {
          method,
          body: JSON.stringify(payload)
        });
        resetDestinationForm();
        await refreshAll();
        setMessage(
          isEditing
            ? t("message.destinationUpdated")
            : t("message.destinationSaved")
        );
      } catch (error) {
        setMessage(describeError(error, t));
      } finally {
        setBusy(false);
      }
    }

    async function loadProjectorPreview(destinationId) {
      setBusy(true);
      try {
        const response = await fetch(
          `/api/destinations/${destinationId}/projector/preview.jpg?ts=${Date.now()}`,
          {
            credentials: "same-origin"
          }
        );

        if (!response.ok) {
          const text = await response.text();
          const payload = text ? safeJsonParse(text) : null;
          const error = new Error(
            (payload && (payload.error || payload.reason)) ||
              `Request failed (${response.status})`
          );
          error.status = response.status;
          error.payload = payload;
          throw error;
        }

        const blob = await response.blob();
        clearProjectorPreview();
        const nextUrl = URL.createObjectURL(blob);
        setProjectorPreviewUrl(nextUrl);
        setProjectorPreviewMeta({
          platform: response.headers.get("x-laive-preview-platform") || "",
          captureMethod:
            response.headers.get("x-laive-preview-capture-method") || ""
        });
      } catch (error) {
        clearProjectorPreview();
        setMessage(describeError(error, t));
      } finally {
        setBusy(false);
      }
    }

    async function loadTransmissionReadiness() {
      setBusy(true);
      try {
        const payload = await request("/api/transmission/readiness");
        setReadinessReport(payload);
        setMessage(t("message.readinessLoaded"));
      } catch (error) {
        setMessage(describeError(error, t));
      } finally {
        setBusy(false);
      }
    }

    async function runAction(label, action) {
      setBusy(true);
      try {
        await action();
        await refreshAll();
        setMessage(label);
      } catch (error) {
        setMessage(describeError(error, t));
      } finally {
        setBusy(false);
      }
    }

    async function reorderDestinations(ids, label) {
      await runAction(label, () =>
        request("/api/destinations/reorder", {
          method: "POST",
          body: JSON.stringify({ ids })
        })
      );
      setDragState({ draggedId: null, overId: null });
    }

    function moveDestination(destinationId, direction) {
      const ids = statusPayload.destinations.map((item) => item.id);
      const index = ids.indexOf(destinationId);
      const targetIndex = index + direction;
      if (index < 0 || targetIndex < 0 || targetIndex >= ids.length) {
        return;
      }
      const nextIds = [...ids];
      const [moved] = nextIds.splice(index, 1);
      nextIds.splice(targetIndex, 0, moved);
      reorderDestinations(
        nextIds,
        direction < 0
          ? t("message.destinationMovedUp")
          : t("message.destinationMovedDown")
      ).catch((error) => setMessage(describeError(error, t)));
    }

    function handleDestinationDragStart(destinationId, event) {
      if (busy) {
        event.preventDefault();
        return;
      }
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", destinationId);
      }
      setDragState({
        draggedId: destinationId,
        overId: destinationId
      });
    }

    function handleDestinationDragOver(destinationId, event) {
      event.preventDefault();
      if (!dragState.draggedId || dragState.overId === destinationId) {
        return;
      }
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
      }
      setDragState((current) => ({
        ...current,
        overId: destinationId
      }));
    }

    function handleDestinationDrop(destinationId, event) {
      event.preventDefault();
      const draggedId =
        dragState.draggedId ||
        (event.dataTransfer ? event.dataTransfer.getData("text/plain") : "");
      if (!draggedId || draggedId === destinationId) {
        setDragState({ draggedId: null, overId: null });
        return;
      }

      const ids = statusPayload.destinations.map((item) => item.id);
      const sourceIndex = ids.indexOf(draggedId);
      const targetIndex = ids.indexOf(destinationId);
      if (sourceIndex < 0 || targetIndex < 0) {
        setDragState({ draggedId: null, overId: null });
        return;
      }

      const nextIds = [...ids];
      const [moved] = nextIds.splice(sourceIndex, 1);
      nextIds.splice(targetIndex, 0, moved);
      reorderDestinations(nextIds, t("message.destinationOrderUpdated")).catch((error) => {
        setDragState({ draggedId: null, overId: null });
        setMessage(describeError(error, t));
      });
    }

    function handleDestinationDragEnd() {
      setDragState({ draggedId: null, overId: null });
    }

    function updateForm(path, value) {
      setFormState((current) => {
        const next = { ...current };
        if (path.startsWith("videoProfile.")) {
          next.videoProfile = { ...current.videoProfile };
          next.videoProfile[path.split(".")[1]] = value;
          return next;
        }
        if (path.startsWith("audioProfile.")) {
          next.audioProfile = { ...current.audioProfile };
          next.audioProfile[path.split(".")[1]] = value;
          return next;
        }
        if (path.startsWith("sceneBinding.")) {
          clearProjectorPreview();
          next.sceneBinding = { ...current.sceneBinding };
          next.sceneBinding[path.split(".")[1]] = value;
          return next;
        }
        if (path === "protocol") {
          clearProjectorPreview();
          const currentDefaultUrl = getProtocolDefaultServerUrl(current.protocol);
          next.protocol = value;
          if (!current.serverUrl || current.serverUrl === currentDefaultUrl) {
            next.serverUrl = getProtocolDefaultServerUrl(value);
          }
          next.audioProfile = { ...current.audioProfile };
          if (value === "whip" && next.audioProfile.audioCodec === "aac") {
            next.audioProfile.audioCodec = "libopus";
          }
          if (value !== "whip" && next.audioProfile.audioCodec === "libopus") {
            next.audioProfile.audioCodec = "aac";
          }
          return next;
        }
        if (path === "videoSourceMode") {
          next.videoSourceMode = value;
          next.sceneBinding = { ...current.sceneBinding };
          if (
            value === "scene_projector_capture" &&
            !next.sceneBinding.sceneName &&
            selectedScene
          ) {
            next.sceneBinding.sceneName = selectedScene;
          }
          return next;
        }
        if (path === "videoSourceMode") {
          clearProjectorPreview();
        }
        next[path] = value;
        return next;
      });
    }

    async function startDestination(destination) {
      setBusy(true);
      try {
        if (destination.videoSourceMode === "scene_projector_capture") {
          await request(`/api/destinations/${destination.id}/projector/validate`, {
            method: "POST",
            headers: {}
          });
        }
        await request(`/api/streams/${destination.id}/start`, {
          method: "POST",
          headers: {}
        });
        await refreshAll();
        setMessage(t("message.destinationStarted"));
      } catch (error) {
        setMessage(describeError(error, t));
      } finally {
        setBusy(false);
      }
    }

    return e(
      React.Fragment,
      null,
      e(
        "header",
        { className: "topbar" },
        e(
          "div",
          null,
          e("h1", null, "LAIVE OBS"),
          e("p", null, t("header.subtitle"))
        ),
        e(
          "div",
          { className: "status-stack" },
          renderLocaleControl(locale, setLocale, t),
          e(
            "span",
            { className: "pill" },
            t("status.obs", {
              value: (statusPayload.obs || {}).connected
                ? t("status.connected")
                : t("status.disconnected")
            })
          ),
          e(
            "span",
            { className: "pill" },
            t("status.stream", {
              value: (statusPayload.obs || {}).streaming
                ? t("status.live")
                : t("status.idle")
            })
          ),
          e(
            "span",
            { className: "pill" },
            t("status.record", {
              value: (statusPayload.obs || {}).recording
                ? t("status.on")
                : t("status.off")
            })
          ),
          e(
            "button",
            {
              className: "danger",
              onClick: () =>
                runAction(t("message.sessionEnded"), async () => {
                  await request("/api/auth/logout", { method: "POST", headers: {} });
                  await onLogout();
                })
            },
            t("header.logout", {
              username: authStatus.username || t("header.userFallback")
            })
          )
        )
      ),
      message
        ? e(
            "div",
            { className: "banner" },
            e("span", null, message),
            e(
              "button",
              { onClick: () => { setMessage(""); clearGlobalMessage(); } },
              t("banner.dismiss")
            )
          )
        : null,
      e(
        "main",
        { className: "layout" },
        e(
          "section",
          { className: "card" },
          e(
            "h2",
            null,
            editingDestination
              ? t("destination.editTitle")
              : t("destination.addTitle")
          ),
          e(
            "form",
            { onSubmit: submitDestination },
            e("label", null, t("destination.name"), e("input", { value: formState.name, required: true, onChange: (ev) => updateForm("name", ev.target.value) })),
            e(
              "label",
              null,
              t("destination.protocol"),
              e(
                "select",
                { value: formState.protocol, onChange: (ev) => updateForm("protocol", ev.target.value) },
                e("option", { value: "rtmp" }, "rtmp"),
                e("option", { value: "rtmps" }, "rtmps"),
                e("option", { value: "srt" }, "srt"),
                e("option", { value: "rist" }, "rist"),
                e("option", { value: "whip" }, "whip")
              )
            ),
            e("label", null, formState.protocol === "whip" ? t("destination.whipEndpoint") : t("destination.serverUrl"), e("input", { value: formState.serverUrl, required: true, onChange: (ev) => updateForm("serverUrl", ev.target.value) })),
            e(
              "label",
              null,
              protocolRequiresStreamKey(formState.protocol)
                ? t("destination.streamKey")
                : t("destination.optionalTokenLabel"),
              e("input", {
                value: formState.streamKey,
                placeholder:
                  editingDestination && protocolRequiresStreamKey(formState.protocol)
                    ? t("destination.keepCurrentKey")
                    : "",
                required:
                  protocolRequiresStreamKey(formState.protocol) && !editingDestination,
                onChange: (ev) => updateForm("streamKey", ev.target.value)
              }),
              editingDestination && editingDestination.streamKeyMasked
                ? e(
                    "small",
                    null,
                    t("destination.currentMasked", {
                      value: editingDestination.streamKeyMasked
                    })
                  )
                : null
            ),
            e(
              "label",
              null,
              t("destination.videoSource"),
              e(
                "select",
                { value: formState.videoSourceMode, onChange: (ev) => updateForm("videoSourceMode", ev.target.value) },
                e("option", { value: "master_ingest" }, t("destination.videoSourceMasterIngest")),
                e("option", { value: "scene_projector_capture" }, t("destination.videoSourceSceneProjector"))
              )
            ),
            formState.videoSourceMode === "scene_projector_capture"
              ? e(
                  React.Fragment,
                  null,
                  e(
                    "label",
                    null,
                    t("destination.sceneForTarget"),
                    e(
                      "select",
                      {
                        value: formState.sceneBinding.sceneName,
                        onChange: (ev) => {
                          setProjectorCandidates([]);
                          updateForm("sceneBinding.sceneName", ev.target.value);
                        }
                      },
                      e(
                        "option",
                        { value: "" },
                        scenes.length
                          ? t("destination.selectScene")
                          : t("destination.refreshScenes")
                      ),
                      scenes.map((scene) =>
                        e("option", { key: scene.sceneName, value: scene.sceneName }, scene.sceneName)
                      )
                    )
                  ),
                    e(
                      "label",
                      null,
                      t("destination.projectorTitle"),
                    e("input", {
                      value: formState.sceneBinding.projectorWindowTitle,
                      placeholder: t("destination.projectorTitlePlaceholder"),
                      onChange: (ev) => updateForm("sceneBinding.projectorWindowTitle", ev.target.value)
                    }),
                    e(
                      "small",
                      null,
                      t("destination.projectorHelp")
                    )
                    ),
                  projectorCandidates.length > 0
                    ? e(
                        "label",
                        null,
                        t("destination.detectedProjectors"),
                        e(
                          "select",
                          {
                            value: formState.sceneBinding.projectorWindowTitle,
                            onChange: (ev) =>
                              applyDetectedProjectorCandidate(ev.target.value)
                          },
                          e("option", { value: "" }, t("destination.selectDetectedProjector")),
                          projectorCandidates.map((candidate) =>
                            e(
                              "option",
                              { key: candidate.title, value: candidate.title },
                              candidate.title
                            )
                          )
                        )
                      )
                    : null,
                  formState.sceneBinding.captureMethod === "darwin_display_crop"
                    ? e(
                        "div",
                        { className: "capture-meta" },
                        e(
                          "small",
                          null,
                          t("destination.captureDisplayMeta", {
                            displayIndex:
                              formState.sceneBinding.captureDisplayIndex ?? "-",
                            cropX: formState.sceneBinding.captureCropX ?? "-",
                            cropY: formState.sceneBinding.captureCropY ?? "-",
                            cropWidth:
                              formState.sceneBinding.captureCropWidth ?? "-",
                            cropHeight:
                              formState.sceneBinding.captureCropHeight ?? "-"
                          })
                        )
                      )
                    : formState.sceneBinding.captureMethod === "linux_x11_window_id"
                      ? e(
                          "div",
                          { className: "capture-meta" },
                          e(
                            "small",
                            null,
                            t("destination.captureX11Meta", {
                              windowId:
                                formState.sceneBinding.x11WindowId || "-",
                              display:
                                formState.sceneBinding.x11Display || ":0.0"
                            })
                          )
                        )
                    : null,
                  editingDestinationId
                    ? e(
                        "div",
                        { className: "actions" },
                        e(
                          "button",
                          {
                            type: "button",
                            disabled:
                              busy ||
                              !formState.sceneBinding.sceneName,
                            onClick: () =>
                              openProjectorForDestination(
                                editingDestinationId,
                                t("message.projectorOpened", {
                                  sceneName: formState.sceneBinding.sceneName
                                })
                              )
                          },
                          t("destination.openProjector")
                        ),
                        e(
                          "button",
                          {
                            type: "button",
                            disabled: busy || !formState.sceneBinding.sceneName,
                            onClick: detectProjectorForEditingDestination
                          },
                          t("destination.detectProjector")
                        ),
                        e(
                          "button",
                          {
                            type: "button",
                            disabled: busy || !formState.sceneBinding.sceneName,
                            onClick: () =>
                              validateProjectorDestination(editingDestinationId)
                          },
                          t("destination.validateCapture")
                        ),
                        e(
                          "button",
                          {
                            type: "button",
                            disabled: busy || !formState.sceneBinding.sceneName,
                            onClick: () => loadProjectorPreview(editingDestinationId)
                          },
                          t("destination.previewCapture")
                        )
                      )
                    : e(
                        "small",
                        null,
                        t("destination.saveFirst")
                      ),
                  editingDestinationId
                    ? e("small", null, t("destination.previewHint"))
                    : null,
                  projectorPreviewUrl
                    ? e(
                        "div",
                        { className: "capture-preview" },
                        e("img", {
                          src: projectorPreviewUrl,
                          alt: t("destination.previewCapture")
                        }),
                        projectorPreviewMeta
                          ? e(
                              "small",
                              null,
                              `${projectorPreviewMeta.platform || "-"} / ${projectorPreviewMeta.captureMethod || "-"}`
                            )
                          : null
                      )
                    : null
                )
              : null,
            e(
              "label",
              null,
              t("destination.outputMode"),
              e(
                "select",
                { value: formState.outputMode, onChange: (ev) => updateForm("outputMode", ev.target.value) },
                e("option", { value: "inherit" }, t("destination.outputModeInherit")),
                e("option", { value: "custom" }, t("destination.outputModeCustom"))
              )
            ),
            formState.outputMode === "custom"
              ? e(
                  React.Fragment,
                  null,
                  e(
                    "label",
                    null,
                    t("destination.videoCodec"),
                    e(
                      "select",
                      { value: formState.videoProfile.videoCodec, onChange: (ev) => updateForm("videoProfile.videoCodec", ev.target.value) },
                      e("option", { value: "copy" }, "copy"),
                      e("option", { value: "libx264" }, "libx264"),
                      e("option", { value: "h264_amf" }, "h264_amf"),
                      e("option", { value: "h264_nvenc" }, "h264_nvenc"),
                      e("option", { value: "h264_qsv" }, "h264_qsv"),
                      e("option", { value: "h264_videotoolbox" }, "h264_videotoolbox"),
                      e("option", { value: "h264_vaapi" }, "h264_vaapi")
                    )
                  ),
                  e("label", null, t("destination.videoBitrate"), e("input", { type: "number", min: 0, value: formState.videoProfile.bitrateKbps, onChange: (ev) => updateForm("videoProfile.bitrateKbps", Number(ev.target.value || 0)) })),
                  e("label", null, t("destination.fps"), e("input", { type: "number", min: 0, value: formState.videoProfile.fps, onChange: (ev) => updateForm("videoProfile.fps", Number(ev.target.value || 0)) })),
                  e(
                    "label",
                    null,
                    t("destination.fpsDivisor"),
                    e(
                      "select",
                      { value: formState.videoProfile.fpsDenominator, onChange: (ev) => updateForm("videoProfile.fpsDenominator", Number(ev.target.value || 1)) },
                      e("option", { value: 1 }, "1x"),
                      e("option", { value: 2 }, "1/2x"),
                      e("option", { value: 3 }, "1/3x"),
                      e("option", { value: 4 }, "1/4x")
                    )
                  ),
                  e("label", null, t("destination.width"), e("input", { type: "number", min: 16, value: formState.videoProfile.width, onChange: (ev) => updateForm("videoProfile.width", Number(ev.target.value || 0)) })),
                  e("label", null, t("destination.height"), e("input", { type: "number", min: 16, value: formState.videoProfile.height, onChange: (ev) => updateForm("videoProfile.height", Number(ev.target.value || 0)) })),
                  e("label", null, t("destination.gop"), e("input", { type: "number", min: 0, value: formState.videoProfile.gopSec, onChange: (ev) => updateForm("videoProfile.gopSec", Number(ev.target.value || 0)) })),
                  e("label", null, t("destination.bframes"), e("input", { type: "number", min: 0, max: 16, value: formState.videoProfile.bFrames, onChange: (ev) => updateForm("videoProfile.bFrames", Number(ev.target.value || 0)) })),
                  e("label", null, t("destination.preset"), e("input", { value: formState.videoProfile.preset, onChange: (ev) => updateForm("videoProfile.preset", ev.target.value) })),
                  e(
                    "label",
                    null,
                    t("destination.audioCodec"),
                    e(
                      "select",
                      { value: formState.audioProfile.audioCodec, onChange: (ev) => updateForm("audioProfile.audioCodec", ev.target.value) },
                      e("option", { value: "copy" }, "copy"),
                      e("option", { value: "aac" }, "aac"),
                      e("option", { value: "libopus" }, "libopus")
                    )
                  ),
                  e("label", null, t("destination.audioBitrate"), e("input", { type: "number", min: 0, value: formState.audioProfile.audioBitrateKbps, onChange: (ev) => updateForm("audioProfile.audioBitrateKbps", Number(ev.target.value || 0)) })),
                  e("label", null, t("destination.audioInputTrack"), e("input", { type: "number", min: 0, max: 7, value: formState.audioProfile.inputTrackIndex, onChange: (ev) => updateForm("audioProfile.inputTrackIndex", Number(ev.target.value || 0)) })),
                  e(
                    "label",
                    null,
                    t("destination.vodTrack"),
                    e("input", {
                      type: "number",
                      min: 0,
                      max: 7,
                      value: formState.audioProfile.vodTrackInputIndex,
                      onChange: (ev) => updateForm("audioProfile.vodTrackInputIndex", ev.target.value)
                    }),
                    e("small", null, t("destination.vodTrackHelp"))
                  )
                )
              : e("label", null, t("destination.bitrateOverride"), e("input", { type: "number", min: 0, value: formState.bitrateKbps, onChange: (ev) => updateForm("bitrateKbps", Number(ev.target.value || 0)) })),
            e("label", { className: "checkbox" }, e("input", { type: "checkbox", checked: formState.syncWithObsStart, onChange: (ev) => updateForm("syncWithObsStart", ev.target.checked) }), t("destination.syncStart")),
            e("label", { className: "checkbox" }, e("input", { type: "checkbox", checked: formState.syncWithObsStop, onChange: (ev) => updateForm("syncWithObsStop", ev.target.checked) }), t("destination.syncStop")),
            e(
              "div",
              { className: "actions" },
              e("button", { type: "submit", disabled: busy }, busy ? t("auth.saving") : editingDestination ? t("destination.saveEdit") : t("destination.save")),
              editingDestination
                ? e("button", { type: "button", onClick: resetDestinationForm, disabled: busy }, t("destination.cancel"))
                : null
            )
          )
        ),
        e(
          "section",
          { className: "card card-wide" },
          e(
            "div",
            { className: "card-head" },
            e("h2", null, t("destinations.title")),
            e(
              "div",
              { className: "actions" },
              e("button", { onClick: () => runAction(t("message.destinationsStarted"), () => request("/api/streams/start-all", { method: "POST", headers: {} })) }, t("destinations.startAll")),
              e("button", { className: "danger", onClick: () => runAction(t("message.destinationsStopped"), () => request("/api/streams/stop-all", { method: "POST", headers: {} })) }, t("destinations.stopAll"))
            )
          ),
          e(
            "table",
            null,
            e(
              "thead",
              null,
              e(
                "tr",
                null,
                e("th", null, t("destinations.order")),
                e("th", null, t("destination.name")),
                e("th", null, t("destination.protocol")),
                e("th", null, t("destinations.publish")),
                e("th", null, t("destinations.mode")),
                e("th", null, t("destinations.videoSource")),
                e("th", null, t("destinations.status")),
                e("th", null, t("destinations.actions"))
              )
            ),
            e(
              "tbody",
              null,
              statusPayload.destinations.map((destination, index) =>
                e(
                  "tr",
                  {
                    key: destination.id,
                    draggable: !busy,
                    className: [
                      "destination-row",
                      dragState.draggedId === destination.id ? "dragging" : "",
                      dragState.overId === destination.id &&
                      dragState.draggedId !== destination.id
                        ? "drag-over"
                        : ""
                    ]
                      .filter(Boolean)
                      .join(" "),
                    onDragStart: (event) => handleDestinationDragStart(destination.id, event),
                    onDragOver: (event) => handleDestinationDragOver(destination.id, event),
                    onDrop: (event) => handleDestinationDrop(destination.id, event),
                    onDragEnd: handleDestinationDragEnd
                  },
                  e("td", null, e("span", { className: "drag-handle", title: t("destinations.dragTitle") }, "::::")),
                  e("td", null, destination.name),
                  e("td", null, destination.protocol || "rtmp"),
                  e("td", null, destination.serverUrl, destination.streamKeyMasked ? e("span", null, e("br"), e("small", null, destination.streamKeyMasked)) : null),
                  e("td", null, formatOutputModeLabel(destination.outputMode, t)),
                  e("td", null, formatVideoSourceModeLabel(destination, t)),
                  e("td", null, e("span", { className: `status ${destination.status}` }, formatDestinationStatusLabel(destination.status, t))),
                  e(
                    "td",
                    null,
                    e(
                      "div",
                      { className: "row-actions" },
                      e("button", { onClick: () => beginEditDestination(destination), disabled: busy }, t("destinations.edit")),
                      destination.videoSourceMode === "scene_projector_capture"
                        ? e(
                            React.Fragment,
                            null,
                            e(
                              "button",
                              {
                                onClick: () =>
                                  openProjectorForDestination(
                                    destination.id,
                                    t("message.projectorOpened", {
                                      sceneName:
                                        destination.sceneBinding &&
                                        destination.sceneBinding.sceneName
                                    })
                                  ),
                                disabled:
                                  busy ||
                                  !destination.sceneBinding ||
                                  !destination.sceneBinding.sceneName
                              },
                              t("destinations.projector")
                            ),
                            e(
                              "button",
                              {
                                onClick: () =>
                                  reopenManagedProjector(destination.id),
                                disabled: busy
                              },
                              t("destinations.reopenProjector")
                            ),
                            e(
                              "button",
                              {
                                onClick: () =>
                                  validateProjectorDestination(destination.id),
                                disabled:
                                  busy ||
                                  !destination.sceneBinding ||
                                  !destination.sceneBinding.sceneName
                              },
                              t("destinations.validate")
                            ),
                            e(
                              "button",
                              {
                                onClick: () =>
                                  forgetManagedProjector(destination.id),
                                disabled: busy
                              },
                              t("destinations.forgetProjector")
                            )
                          )
                        : null,
                      e("button", { onClick: () => moveDestination(destination.id, -1), disabled: busy || index === 0 }, t("destinations.up")),
                      e("button", { onClick: () => moveDestination(destination.id, 1), disabled: busy || index === statusPayload.destinations.length - 1 }, t("destinations.down")),
                      e("button", { onClick: () => startDestination(destination), disabled: busy }, t("destinations.start")),
                      e("button", { className: "danger", onClick: () => runAction(t("message.destinationStopped"), () => request(`/api/streams/${destination.id}/stop`, { method: "POST", headers: {} })) }, t("destinations.stop")),
                      e("button", { className: "danger", onClick: () => runAction(t("message.destinationRemoved"), () => request(`/api/destinations/${destination.id}`, { method: "DELETE", headers: {} })) }, t("destinations.delete"))
                    )
                  )
                )
              )
            )
          )
        ),
        e(
          "section",
          { className: "card card-wide" },
          e(
            "div",
            { className: "card-head" },
            e("h2", null, t("obs.title")),
            e("div", { className: "actions" }, e("button", { onClick: refreshScenes }, t("obs.refreshScenes")))
          ),
          e(
            "div",
            { className: "actions" },
            e("button", { onClick: () => runAction(t("message.streamStarted"), () => request("/api/obs/stream/start", { method: "POST", headers: {} })) }, t("obs.startStream")),
            e("button", { className: "danger", onClick: () => runAction(t("message.streamStopped"), () => request("/api/obs/stream/stop", { method: "POST", headers: {} })) }, t("obs.stopStream")),
            e("button", { onClick: () => runAction(t("message.recordStarted"), () => request("/api/obs/record/start", { method: "POST", headers: {} })) }, t("obs.startRecord")),
            e("button", { className: "danger", onClick: () => runAction(t("message.recordStopped"), () => request("/api/obs/record/stop", { method: "POST", headers: {} })) }, t("obs.stopRecord"))
          ),
          e(
            "div",
            { className: "actions" },
            e(
              "select",
              { value: selectedScene, onChange: (ev) => setSelectedScene(ev.target.value) },
              scenes.map((scene) => e("option", { key: scene.sceneName, value: scene.sceneName }, scene.sceneName))
            ),
            e("button", { onClick: () => runAction(t("message.sceneSwitched", { sceneName: selectedScene }), () => request("/api/obs/scene/switch", { method: "POST", body: JSON.stringify({ sceneName: selectedScene }) })) }, t("obs.switchScene"))
          )
        ),
        e(
          "section",
          { className: "card card-wide" },
          e(
            "div",
            { className: "card-head" },
            e("h2", null, t("projectors.title")),
            e(
              "div",
              { className: "actions" },
              e(
                "button",
                {
                  onClick: reopenManagedProjectors,
                  disabled:
                    busy ||
                    !Array.isArray(statusPayload.managedProjectors) ||
                    statusPayload.managedProjectors.length === 0
                },
                t("projectors.reopenAll")
              )
            )
          ),
          Array.isArray(statusPayload.managedProjectors) &&
          statusPayload.managedProjectors.length > 0
            ? e(
                "table",
                null,
                e(
                  "thead",
                  null,
                  e(
                    "tr",
                    null,
                    e("th", null, t("destination.name")),
                    e("th", null, t("destination.sceneForTarget")),
                    e("th", null, t("destination.projectorTitle")),
                    e("th", null, t("destinations.actions"))
                  )
                ),
                e(
                  "tbody",
                  null,
                  statusPayload.managedProjectors.map((projector) =>
                    e(
                      "tr",
                      { key: projector.destinationId },
                      e("td", null, projector.destinationName || projector.destinationId),
                      e("td", null, projector.sceneName || "-"),
                      e("td", null, projector.projectorWindowTitle || projector.x11WindowId || projector.captureMethod || "-"),
                      e(
                        "td",
                        null,
                        e(
                          "div",
                          { className: "row-actions" },
                          e(
                            "button",
                            {
                              onClick: () =>
                                reopenManagedProjector(projector.destinationId),
                              disabled: busy
                            },
                            t("destinations.reopenProjector")
                          ),
                          e(
                            "button",
                            {
                              onClick: () =>
                                closeManagedProjector(projector.destinationId),
                              disabled: busy || !projector.closeSupported
                            },
                            t("projectors.close")
                          ),
                          e(
                            "button",
                            {
                              onClick: () =>
                                forgetManagedProjector(projector.destinationId),
                              disabled: busy
                            },
                            t("destinations.forgetProjector")
                          )
                        )
                      )
                    )
                  )
                )
              )
            : e("small", null, t("projectors.empty"))
        ),
        e(
          "section",
          { className: "card card-wide" },
          e(
            "div",
            { className: "card-head" },
            e("h2", null, t("readiness.title")),
            e(
              "div",
              { className: "actions" },
              e(
                "button",
                {
                  onClick: loadTransmissionReadiness,
                  disabled: busy
                },
                t("readiness.run")
              )
            )
          ),
          readinessReport
            ? e(
                "div",
                { className: "readiness-report" },
                e(
                  "div",
                  { className: "readiness-summary" },
                  e("strong", null, t("readiness.summary")),
                  e(
                    "small",
                    null,
                    `${t("readiness.source")}: ${readinessReport.sourceUrl || "-"}`
                  ),
                  e(
                    "small",
                    null,
                    `${t("readiness.ready")}: ${((readinessReport.summary || {}).ready) || 0} | ${t("readiness.warning")}: ${((readinessReport.summary || {}).warning) || 0} | ${t("readiness.blocked")}: ${((readinessReport.summary || {}).blocked) || 0}`
                  )
                ),
                e(
                  "table",
                  null,
                  e(
                    "thead",
                    null,
                    e(
                      "tr",
                      null,
                      e("th", null, t("destination.name")),
                      e("th", null, t("destination.protocol")),
                      e("th", null, t("readiness.status")),
                      e("th", null, t("readiness.checks"))
                    )
                  ),
                  e(
                    "tbody",
                    null,
                    ((readinessReport.destinations || [])).map((item) =>
                      e(
                        "tr",
                        { key: item.destinationId },
                        e("td", null, item.destinationName || item.destinationId),
                        e("td", null, item.protocol || "-"),
                        e(
                          "td",
                          null,
                          e(
                            "span",
                            {
                              className: `readiness-badge readiness-${item.status || "ready"}`
                            },
                            t(`readiness.${item.status || "ready"}`)
                          )
                        ),
                        e(
                          "td",
                          null,
                          e(
                            "ul",
                            { className: "readiness-checks" },
                            (item.checks || []).map((check, index) =>
                              e(
                                "li",
                                {
                                  key: `${item.destinationId}-${check.code || index}`,
                                  className: `readiness-check readiness-${check.level || "ok"}`
                                },
                                check.message
                              )
                            )
                          )
                        )
                      )
                    )
                  )
                )
              )
            : e("small", null, t("readiness.empty"))
        ),
        e(
          "section",
          { className: "card card-wide" },
          e("h2", null, t("network.title")),
          e(
            "div",
            { className: "actions" },
            e("label", { className: "checkbox" }, e("input", { type: "checkbox", checked: Boolean(network.allowLan), onChange: (ev) => setNetwork((current) => ({ ...current, allowLan: ev.target.checked })) }), t("network.allowLan")),
            e("label", null, t("network.bind"), e("input", { value: network.bindAddress || "", onChange: (ev) => setNetwork((current) => ({ ...current, bindAddress: ev.target.value })) })),
            e("label", null, t("network.sessionTtl"), e("input", { type: "number", min: 300, value: network.sessionTtlSec || 1800, onChange: (ev) => setNetwork((current) => ({ ...current, sessionTtlSec: Number(ev.target.value || 1800) })) })),
            e("button", { onClick: () => runAction(t("message.networkUpdated"), () => request("/api/settings/network", { method: "PATCH", body: JSON.stringify(network) })) }, t("network.save"))
          )
        ),
        e(
          "section",
          { className: "card card-wide" },
          e("h2", null, t("metrics.title")),
          e(
            "div",
            { className: "metrics-grid" },
            e("div", { className: "metric-box" }, e("span", { className: "metric-label" }, t("metrics.httpRequests")), e("strong", null, String(counters["http.requests.total"] || 0))),
            e("div", { className: "metric-box" }, e("span", { className: "metric-label" }, t("metrics.reconnects")), e("strong", null, String(counters["event.destination.reconnecting"] || 0))),
            e("div", { className: "metric-box" }, e("span", { className: "metric-label" }, t("metrics.errors")), e("strong", null, String(counters["event.destination.error"] || 0))),
            e("div", { className: "metric-box" }, e("span", { className: "metric-label" }, t("metrics.activePipelines")), e("strong", null, String(activePipelines)))
          ),
          e("h3", { className: "subsection-title" }, t("metrics.incidentTimeline")),
          e(
            "ul",
            { className: "incident-list" },
            incidentTimeline.slice(0, 20).map((event, index) =>
              e(
                "li",
                { key: `${event.type}-${index}`, className: "incident-item" },
                e("span", { className: "incident-type" }, `${event.timestamp} · ${event.type}`),
                e("small", null, JSON.stringify(event.payload || {}))
              )
            )
          )
        ),
        e(
          "section",
          { className: "card card-wide" },
          e("h2", null, t("events.title")),
          e("pre", null, events.join("\n"))
        )
      )
    );
  }

  ReactDOM.createRoot(document.getElementById("root")).render(e(App));
})();
