(() => {
  const DEFAULT_ICE = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
  ];
  let cachedIce = null;
  let iceFetchPromise = null;
  let ringtoneState = null;

  function playAlertSound() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = playAlertSound._ctx || new Ctx();
      playAlertSound._ctx = ctx;
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.exponentialRampToValueAtTime(660, now + 0.12);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.3);
    } catch {
      /* ignore */
    }
  }

  function startRingtone() {
    stopRingtone();
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      ringtoneState = { ctx, timer: null, vibrateTimer: null, running: true };

      // Loud classic phone RING-RING … pause — built to cut through sleep / background noise.
      const playRingCycle = () => {
        if (!ringtoneState?.running || !ringtoneState?.ctx) return;
        const c = ringtoneState.ctx;
        if (c.state === "suspended") c.resume().catch(() => {});
        const t0 = c.currentTime;

        const ringBurst = (start, durationSec, freqA, freqB) => {
          [freqA, freqB].forEach((freq, i) => {
            const osc = c.createOscillator();
            const gain = c.createGain();
            osc.type = "square";
            osc.frequency.value = freq;
            const startAt = start + i * 0.015;
            const endAt = startAt + durationSec;
            gain.gain.setValueAtTime(0.0001, startAt);
            gain.gain.exponentialRampToValueAtTime(0.5, startAt + 0.025);
            gain.gain.setValueAtTime(0.5, endAt - 0.04);
            gain.gain.exponentialRampToValueAtTime(0.0001, endAt);
            osc.connect(gain);
            gain.connect(c.destination);
            osc.start(startAt);
            osc.stop(endAt + 0.02);
          });
        };

        ringBurst(t0, 0.48, 880, 988);
        ringBurst(t0 + 0.62, 0.48, 880, 988);
      };

      const vibratePattern = [500, 150, 500, 150, 500, 1800];

      playRingCycle();
      ringtoneState.timer = setInterval(playRingCycle, 3200);

      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        navigator.vibrate(vibratePattern);
        ringtoneState.vibrateTimer = setInterval(() => {
          if (ringtoneState?.running) navigator.vibrate(vibratePattern);
        }, 3200);
      }
    } catch {
      /* ignore */
    }
  }

  function stopRingtone() {
    if (ringtoneState) ringtoneState.running = false;
    if (ringtoneState?.timer) clearInterval(ringtoneState.timer);
    if (ringtoneState?.vibrateTimer) clearInterval(ringtoneState.vibrateTimer);
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(0);
    }
    if (ringtoneState?.ctx) {
      try {
        ringtoneState.ctx.close();
      } catch {
        /* ignore */
      }
    }
    ringtoneState = null;
  }

  function injectCallOverlayStyles() {
    if (document.getElementById("lucky-call-overlay-styles")) return;
    const style = document.createElement("style");
    style.id = "lucky-call-overlay-styles";
    style.textContent = `
      .lucky-call-overlay {
        position: fixed;
        inset: 0;
        z-index: 100000;
        display: grid;
        place-items: center;
        padding: max(1rem, env(safe-area-inset-top)) max(1rem, env(safe-area-inset-right))
          max(1rem, env(safe-area-inset-bottom)) max(1rem, env(safe-area-inset-left));
        background: rgba(8, 10, 12, 0.82);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
      }
      .lucky-call-overlay[hidden] { display: none !important; }
      .lucky-call-card {
        width: min(100%, 22rem);
        padding: 1.75rem 1.5rem 1.5rem;
        border-radius: 18px;
        border: 1px solid rgba(238, 241, 244, 0.12);
        background: linear-gradient(165deg, #22262b 0%, #1b1e22 100%);
        box-shadow: 0 24px 64px rgba(0, 0, 0, 0.45);
        text-align: center;
        color: #eef1f4;
        font-family: "Outfit", "Segoe UI", sans-serif;
      }
      .lucky-call-avatar {
        width: 4.5rem;
        height: 4.5rem;
        margin: 0 auto 1rem;
        border-radius: 50%;
        display: grid;
        place-items: center;
        font-size: 1.85rem;
        background: rgba(43, 184, 174, 0.14);
        border: 1px solid rgba(61, 205, 194, 0.35);
      }
      .lucky-call-avatar.is-ringing { animation: lucky-call-pulse 1.2s ease-in-out infinite; }
      .lucky-call-avatar.is-outgoing { animation: lucky-call-pulse 1.6s ease-in-out infinite; }
      @keyframes lucky-call-pulse {
        0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(61, 205, 194, 0.35); }
        50% { transform: scale(1.06); box-shadow: 0 0 0 14px rgba(61, 205, 194, 0); }
      }
      .lucky-call-title {
        margin: 0 0 0.35rem;
        font-size: 0.78rem;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: #3dcdc2;
        font-weight: 700;
      }
      .lucky-call-name {
        margin: 0 0 0.35rem;
        font-size: 1.35rem;
        font-weight: 700;
        line-height: 1.2;
      }
      .lucky-call-status {
        margin: 0 0 1.25rem;
        font-size: 0.92rem;
        color: #8b949e;
        min-height: 1.25rem;
      }
      .lucky-call-actions {
        display: flex;
        gap: 0.65rem;
        justify-content: center;
        flex-wrap: wrap;
      }
      .lucky-call-actions[hidden] { display: none !important; }
      .lucky-call-btn {
        min-width: 7rem;
        padding: 0.72rem 1rem;
        border-radius: 999px;
        border: 1px solid rgba(238, 241, 244, 0.14);
        background: #2a2f36;
        color: #eef1f4;
        font: inherit;
        font-size: 0.92rem;
        font-weight: 600;
        cursor: pointer;
      }
      .lucky-call-btn:active { transform: scale(0.97); }
      .lucky-call-btn.is-accept {
        background: linear-gradient(135deg, #2bb8ae, #3dcdc2);
        border-color: transparent;
        color: #0a0c0e;
      }
      .lucky-call-btn.is-decline,
      .lucky-call-btn.is-end {
        background: rgba(240, 113, 103, 0.12);
        border-color: rgba(240, 113, 103, 0.45);
        color: #f07167;
      }
      .lucky-call-controls {
        display: flex;
        gap: 1rem;
        justify-content: center;
        align-items: flex-start;
        flex-wrap: wrap;
      }
      .lucky-call-controls[hidden] { display: none !important; }
      .lucky-call-control {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.4rem;
        min-width: 4.5rem;
        padding: 0;
        border: 0;
        background: transparent;
        color: #eef1f4;
        font: inherit;
        cursor: pointer;
      }
      .lucky-call-control:active { transform: scale(0.96); }
      .lucky-call-control-icon {
        width: 3.25rem;
        height: 3.25rem;
        border-radius: 50%;
        display: grid;
        place-items: center;
        font-size: 1.25rem;
        background: #2a2f36;
        border: 1px solid rgba(238, 241, 244, 0.14);
      }
      .lucky-call-control.is-active .lucky-call-control-icon {
        background: rgba(43, 184, 174, 0.18);
        border-color: rgba(61, 205, 194, 0.45);
        color: #3dcdc2;
      }
      .lucky-call-control.is-muted .lucky-call-control-icon,
      .lucky-call-control.is-speaker-off .lucky-call-control-icon {
        background: rgba(240, 113, 103, 0.14);
        border-color: rgba(240, 113, 103, 0.45);
        color: #f07167;
      }
      .lucky-call-control.is-end .lucky-call-control-icon {
        background: #f07167;
        border-color: #f07167;
        color: #0a0c0e;
        transform: rotate(135deg);
      }
      .lucky-call-control-label {
        font-size: 0.72rem;
        font-weight: 600;
        color: #8b949e;
        letter-spacing: 0.02em;
      }
    `;
    document.head.appendChild(style);
  }

  function createCallOverlay() {
    injectCallOverlayStyles();
    let root = document.getElementById("lucky-call-overlay");
    if (!root) {
      root = document.createElement("div");
      root.id = "lucky-call-overlay";
      root.className = "lucky-call-overlay";
      root.hidden = true;
      root.innerHTML = `
        <div class="lucky-call-card" role="dialog" aria-modal="true" aria-labelledby="lucky-call-title">
          <div class="lucky-call-avatar" id="lucky-call-avatar" aria-hidden="true">📞</div>
          <p class="lucky-call-title" id="lucky-call-title">Voice call</p>
          <p class="lucky-call-name" id="lucky-call-name"></p>
          <p class="lucky-call-status" id="lucky-call-status"></p>
          <div class="lucky-call-actions" id="lucky-call-incoming-actions">
            <button type="button" class="lucky-call-btn is-decline" id="lucky-call-decline">Decline</button>
            <button type="button" class="lucky-call-btn is-accept" id="lucky-call-accept">Accept</button>
          </div>
          <div class="lucky-call-actions" id="lucky-call-outgoing-actions" hidden>
            <button type="button" class="lucky-call-btn is-end" id="lucky-call-cancel">Cancel call</button>
          </div>
          <div class="lucky-call-controls" id="lucky-call-active-actions" hidden>
            <button type="button" class="lucky-call-control is-mute" id="lucky-call-mute" aria-pressed="false">
              <span class="lucky-call-control-icon" aria-hidden="true">🎤</span>
              <span class="lucky-call-control-label">Mute</span>
            </button>
            <button type="button" class="lucky-call-control is-speaker" id="lucky-call-speaker" aria-pressed="true">
              <span class="lucky-call-control-icon" aria-hidden="true">🔊</span>
              <span class="lucky-call-control-label">Speaker</span>
            </button>
            <button type="button" class="lucky-call-control is-end" id="lucky-call-end" aria-label="End call">
              <span class="lucky-call-control-icon" aria-hidden="true">📞</span>
              <span class="lucky-call-control-label">End</span>
            </button>
          </div>
        </div>
      `;
      document.body.appendChild(root);
    }

    const els = {
      root,
      avatar: root.querySelector("#lucky-call-avatar"),
      title: root.querySelector("#lucky-call-title"),
      name: root.querySelector("#lucky-call-name"),
      status: root.querySelector("#lucky-call-status"),
      incoming: root.querySelector("#lucky-call-incoming-actions"),
      outgoing: root.querySelector("#lucky-call-outgoing-actions"),
      active: root.querySelector("#lucky-call-active-actions"),
      accept: root.querySelector("#lucky-call-accept"),
      decline: root.querySelector("#lucky-call-decline"),
      cancel: root.querySelector("#lucky-call-cancel"),
      end: root.querySelector("#lucky-call-end"),
      mute: root.querySelector("#lucky-call-mute"),
      speaker: root.querySelector("#lucky-call-speaker"),
    };

    let handlers = {
      onAccept: null,
      onDecline: null,
      onCancel: null,
      onEnd: null,
      onMute: null,
      onSpeaker: null,
    };
    let muted = false;
    let speakerOn = true;

    function bind(btn, fn) {
      btn.replaceWith(btn.cloneNode(true));
      const fresh = root.querySelector(`#${btn.id}`);
      fresh.addEventListener("click", () => fn?.());
      return fresh;
    }

    function setMutedState(next) {
      muted = !!next;
      els.mute.classList.toggle("is-muted", muted);
      els.mute.classList.toggle("is-active", !muted);
      els.mute.setAttribute("aria-pressed", String(muted));
      const label = els.mute.querySelector(".lucky-call-control-label");
      const icon = els.mute.querySelector(".lucky-call-control-icon");
      if (label) label.textContent = muted ? "Unmute" : "Mute";
      if (icon) icon.textContent = muted ? "🔇" : "🎤";
    }

    function setSpeakerState(next) {
      speakerOn = !!next;
      els.speaker.classList.toggle("is-speaker-off", !speakerOn);
      els.speaker.classList.toggle("is-active", speakerOn);
      els.speaker.setAttribute("aria-pressed", String(speakerOn));
      const label = els.speaker.querySelector(".lucky-call-control-label");
      const icon = els.speaker.querySelector(".lucky-call-control-icon");
      if (label) label.textContent = speakerOn ? "Speaker" : "Earpiece";
      if (icon) icon.textContent = speakerOn ? "🔊" : "📱";
    }

    els.accept = bind(els.accept, () => handlers.onAccept?.());
    els.decline = bind(els.decline, () => handlers.onDecline?.());
    els.cancel = bind(els.cancel, () => handlers.onCancel?.());
    els.end = bind(els.end, () => handlers.onEnd?.());
    els.mute = bind(els.mute, () => handlers.onMute?.());
    els.speaker = bind(els.speaker, () => handlers.onSpeaker?.());

    function showMode(mode) {
      els.incoming.hidden = mode !== "incoming";
      els.outgoing.hidden = mode !== "outgoing";
      els.active.hidden = mode !== "active";
      els.avatar.classList.toggle("is-ringing", mode === "incoming");
      els.avatar.classList.toggle("is-outgoing", mode === "outgoing");
      root.hidden = false;
    }

    return {
      showIncoming({ title, name, status, ring, onAccept, onDecline }) {
        handlers = { onAccept, onDecline, onCancel: onDecline, onEnd: null };
        els.title.textContent = title || "Incoming call";
        els.name.textContent = name || "Caller";
        els.status.textContent = status || "Ringing…";
        if (ring) startRingtone();
        else stopRingtone();
        showMode("incoming");
      },
      showOutgoing({ title, name, status, onCancel }) {
        stopRingtone();
        handlers = { onAccept: null, onDecline: null, onCancel, onEnd: onCancel };
        els.title.textContent = title || "Calling…";
        els.name.textContent = name || "";
        els.status.textContent = status || "Waiting for answer…";
        showMode("outgoing");
      },
      showActive({ title, name, status, onEnd, onMute, onSpeaker }) {
        stopRingtone();
        handlers = { onAccept: null, onDecline: null, onCancel: onEnd, onEnd, onMute, onSpeaker };
        setMutedState(false);
        setSpeakerState(true);
        els.title.textContent = title || "On call";
        els.name.textContent = name || "";
        els.status.textContent = status || "Connected";
        showMode("active");
      },
      updateStatus(text) {
        if (text) els.status.textContent = text;
      },
      setMuted(next) {
        setMutedState(next);
      },
      setSpeaker(next) {
        setSpeakerState(next);
      },
      hide() {
        stopRingtone();
        root.hidden = true;
        handlers = {
          onAccept: null,
          onDecline: null,
          onCancel: null,
          onEnd: null,
          onMute: null,
          onSpeaker: null,
        };
        setMutedState(false);
        setSpeakerState(true);
      },
    };
  }

  function renderMediaAttachment(attachment, esc) {
    if (!attachment?.url) return "";
    const url = esc(attachment.url);
    const name = esc(attachment.name || "Download file");
    if (attachment.kind === "image") {
      return `<a href="${url}" target="_blank" rel="noopener noreferrer"><img class="bubble-media" src="${url}" alt="${name}" loading="lazy" /></a>`;
    }
    if (attachment.kind === "video") {
      return `<video class="bubble-media" src="${url}" controls preload="metadata"></video>`;
    }
    if (attachment.kind === "audio") {
      return `<audio class="bubble-audio" src="${url}" controls preload="metadata"></audio>`;
    }
    return `<a class="bubble-file" href="${url}" target="_blank" rel="noopener noreferrer">${name}</a>`;
  }

  function pickAudioMime() {
    const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/aac", ""];
    for (const mime of candidates) {
      if (!mime || MediaRecorder.isTypeSupported(mime)) return mime;
    }
    return "";
  }

  function voiceBlobToFile(blob) {
    const rawType = String(blob.type || "audio/webm");
    const baseType = rawType.split(";")[0].trim() || "audio/webm";
    const ext = /mp4|aac|m4a/i.test(baseType) ? "m4a" : "webm";
    return new File([blob], `voice-${Date.now()}.${ext}`, { type: baseType });
  }

  async function loadIceServers() {
    if (cachedIce) return cachedIce;
    if (!iceFetchPromise) {
      iceFetchPromise = fetch("/api/webrtc/ice", { credentials: "include" })
        .then((res) => (res.ok ? res.json() : { iceServers: DEFAULT_ICE }))
        .then((data) => {
          cachedIce = Array.isArray(data?.iceServers) && data.iceServers.length ? data.iceServers : DEFAULT_ICE;
          return cachedIce;
        })
        .catch(() => {
          cachedIce = DEFAULT_ICE;
          return cachedIce;
        });
    }
    return iceFetchPromise;
  }

  function createVoiceController({ button, onRecorded, setStatus }) {
    let mediaRecorder = null;
    let chunks = [];
    let stream = null;
    let recording = false;

    async function toggle() {
      if (recording) {
        mediaRecorder?.stop();
        return;
      }
      if (!window.isSecureContext) {
        setStatus?.("Voice notes require HTTPS.");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        chunks = [];
        const mime = pickAudioMime();
        mediaRecorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
        mediaRecorder.addEventListener("dataavailable", (e) => {
          if (e.data?.size) chunks.push(e.data);
        });
        mediaRecorder.addEventListener("stop", () => {
          recording = false;
          button?.classList.remove("is-recording");
          if (button) button.textContent = "Voice";
          stream?.getTracks()?.forEach((t) => t.stop());
          stream = null;
          const blob = new Blob(chunks, { type: mediaRecorder.mimeType || mime || "audio/webm" });
          chunks = [];
          if (blob.size < 500) {
            setStatus?.("Voice note too short.");
            return;
          }
          onRecorded?.(blob);
        });
        mediaRecorder.start();
        recording = true;
        button?.classList.add("is-recording");
        if (button) button.textContent = "Stop";
        setStatus?.("Recording… tap Stop to send.");
      } catch {
        setStatus?.("Microphone permission is required for voice notes.");
      }
    }

    button?.addEventListener("click", () => {
      toggle().catch(() => setStatus?.("Could not record voice note."));
    });

    return { toggle };
  }

  function createCallController({
    role,
    getConversationId,
    sendJson,
    localAudioEl,
    remoteAudioEl,
    callBtn,
    hangBtn,
    setStatus,
    onIncoming,
    callerName,
    useOverlay = true,
  }) {
    let pc = null;
    let localStream = null;
    let inCall = false;
    let pendingOffer = null;
    let pendingIce = [];
    let makingOffer = false;
    let callConversationId = null;
    let micMuted = false;
    let speakerOn = true;
    const overlay = useOverlay ? createCallOverlay() : null;

    function peerLabel() {
      return role === "admin" ? "Player" : "Support";
    }

    function signalingConversationId() {
      return callConversationId || getConversationId();
    }

    function matchesCallThread(msg) {
      const msgId = String(msg.conversationId || "");
      if (!msgId) return false;
      if (String(callConversationId || "") === msgId) return true;
      if (String(getConversationId() || "") === msgId) return true;
      if (pendingOffer && String(pendingOffer.conversationId) === msgId) return true;
      return false;
    }

    function showOutgoingUi(name) {
      overlay?.showOutgoing({
        title: role === "admin" ? "Calling player" : "Calling support",
        name: name || peerLabel(),
        status: "Waiting for answer…",
        onCancel: () => {
          endCall(true);
          setStatus?.("Call cancelled.");
        },
      });
    }

    function showActiveUi(name, status) {
      overlay?.showActive({
        title: "On call",
        name: name || peerLabel(),
        status: status || "Connected",
        onEnd: () => {
          endCall(true);
          setStatus?.("Call ended.");
        },
        onMute: () => toggleMute(),
        onSpeaker: () => toggleSpeaker(),
      });
      overlay?.setMuted(micMuted);
      overlay?.setSpeaker(speakerOn);
      applySpeakerRoute();
    }

    function toggleMute() {
      micMuted = !micMuted;
      localStream?.getAudioTracks()?.forEach((track) => {
        track.enabled = !micMuted;
      });
      overlay?.setMuted(micMuted);
      setStatus?.(micMuted ? "Microphone muted" : "Microphone on");
    }

    async function applySpeakerRoute() {
      if (!remoteAudioEl) return;
      remoteAudioEl.muted = false;
      if (speakerOn) {
        remoteAudioEl.volume = 1;
        if (typeof remoteAudioEl.setSinkId === "function") {
          try {
            await remoteAudioEl.setSinkId("");
          } catch {
            /* ignore */
          }
        }
      } else {
        remoteAudioEl.volume = 0.45;
        if (typeof remoteAudioEl.setSinkId === "function" && navigator.mediaDevices?.enumerateDevices) {
          try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const comm =
              devices.find((d) => d.kind === "audiooutput" && /handset|phone|ear|communication/i.test(d.label)) ||
              devices.find((d) => d.kind === "audiooutput" && d.deviceId === "communications");
            if (comm?.deviceId) await remoteAudioEl.setSinkId(comm.deviceId);
          } catch {
            /* ignore */
          }
        }
      }
    }

    function toggleSpeaker() {
      speakerOn = !speakerOn;
      overlay?.setSpeaker(speakerOn);
      applySpeakerRoute();
      setStatus?.(speakerOn ? "Speaker on" : "Earpiece mode");
    }

    async function flushIce(peer) {
      if (!peer?.remoteDescription) return;
      const queued = pendingIce.splice(0, pendingIce.length);
      for (const candidate of queued) {
        try {
          await peer.addIceCandidate(candidate);
        } catch (err) {
          console.warn("ice add:", err?.message || err);
        }
      }
    }

    async function ensurePc() {
      if (pc) return pc;
      const iceServers = await loadIceServers();
      pc = new RTCPeerConnection({ iceServers });
      pc.onicecandidate = (ev) => {
        if (!ev.candidate) return;
        const conversationId = signalingConversationId();
        if (!conversationId) return;
        sendJson({
          type: "webrtc_signal",
          conversationId,
          signal: { type: "ice", candidate: ev.candidate.toJSON ? ev.candidate.toJSON() : ev.candidate },
        });
      };
      pc.onconnectionstatechange = () => {
        const state = pc?.connectionState;
        if (state === "connected") {
          setStatus?.("Call connected.");
          overlay?.updateStatus("Connected");
        }
        if (state === "failed") {
          setStatus?.("Call failed — check microphone permission and try again.");
          overlay?.updateStatus("Connection failed");
        }
        if (state === "disconnected") {
          setStatus?.("Call reconnecting…");
          overlay?.updateStatus("Reconnecting…");
        }
      };
      pc.ontrack = (ev) => {
        if (remoteAudioEl) {
          remoteAudioEl.srcObject = ev.streams[0] || new MediaStream([ev.track]);
          remoteAudioEl.setAttribute("playsinline", "");
          remoteAudioEl.play?.().catch(() => {});
          applySpeakerRoute();
        }
      };
      return pc;
    }

    async function startLocalAudio() {
      if (localStream) return localStream;
      if (!window.isSecureContext) {
        throw new Error("Calls require HTTPS.");
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("This browser cannot access the microphone.");
      }
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      if (localAudioEl) {
        localAudioEl.srcObject = localStream;
        localAudioEl.muted = true;
        localAudioEl.play?.().catch(() => {});
      }
      const peer = await ensurePc();
      const senders = peer.getSenders();
      localStream.getTracks().forEach((track) => {
        const already = senders.some((s) => s.track && s.track.id === track.id);
        if (!already) peer.addTrack(track, localStream);
      });
      return localStream;
    }

    function setCallUi(active) {
      inCall = active;
      hangBtn && (hangBtn.hidden = !active);
      callBtn && (callBtn.disabled = active);
    }

    async function answerOffer(offerMsg) {
      const peer = await ensurePc();
      const desc = offerMsg.signal?.sdp || offerMsg.signal;
      await peer.setRemoteDescription(desc);
      await flushIce(peer);
      if (!localStream) await startLocalAudio();
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      sendJson({
        type: "webrtc_signal",
        conversationId: offerMsg.conversationId || signalingConversationId(),
        signal: { type: "answer", sdp: peer.localDescription },
      });
      setCallUi(true);
    }

    async function startCall() {
      const conversationId = getConversationId();
      if (!conversationId) {
        setStatus?.("Open a chat first.");
        return;
      }
      if (inCall || makingOffer) return;
      makingOffer = true;
      callConversationId = conversationId;
      const name =
        typeof callerName === "function" ? callerName() : callerName || (role === "admin" ? "Support" : "Player");
      try {
        showOutgoingUi(role === "admin" ? name : peerLabel());
        await startLocalAudio();
        sendJson({ type: "call_invite", conversationId, name });
        const peer = await ensurePc();
        const offer = await peer.createOffer({ offerToReceiveAudio: true });
        await peer.setLocalDescription(offer);
        sendJson({
          type: "webrtc_signal",
          conversationId,
          signal: { type: "offer", sdp: peer.localDescription },
        });
        setCallUi(true);
        setStatus?.(role === "admin" ? "Calling player…" : "Calling support…");
      } catch (err) {
        console.warn("startCall:", err?.message || err);
        setStatus?.(err?.message || "Microphone permission is required for calls.");
        overlay?.hide();
        endCall(false);
      } finally {
        makingOffer = false;
      }
    }

    async function acceptCall(conversationId) {
      callConversationId = conversationId;
      overlay?.hide();
      try {
        await startLocalAudio();
        sendJson({ type: "call_accept", conversationId });
        setCallUi(true);
        showActiveUi(
          role === "admin" ? pendingOffer?.name || "Player" : peerLabel(),
          "Connecting…"
        );
        setStatus?.("Connecting call…");
        if (pendingOffer && String(pendingOffer.conversationId) === String(conversationId)) {
          const offer = pendingOffer;
          pendingOffer = null;
          await answerOffer(offer);
        }
      } catch (err) {
        console.warn("acceptCall:", err?.message || err);
        setStatus?.(err?.message || "Could not access microphone.");
        sendJson({ type: "call_reject", conversationId });
        overlay?.hide();
        endCall(false);
      }
    }

    function rejectCall(conversationId) {
      sendJson({ type: "call_reject", conversationId });
      pendingOffer = null;
      pendingIce = [];
      overlay?.hide();
      endCall(false);
      setStatus?.("Call declined.");
    }

    function endCall(notify = true) {
      const conversationId = signalingConversationId();
      if (notify && conversationId) sendJson({ type: "call_end", conversationId });
      overlay?.hide();
      try {
        pc?.getSenders()?.forEach((s) => {
          try {
            s.track?.stop();
          } catch {
            /* ignore */
          }
        });
        pc?.close();
      } catch {
        /* ignore */
      }
      pc = null;
      localStream?.getTracks()?.forEach((t) => t.stop());
      localStream = null;
      pendingOffer = null;
      pendingIce = [];
      makingOffer = false;
      callConversationId = null;
      micMuted = false;
      speakerOn = true;
      if (localAudioEl) localAudioEl.srcObject = null;
      if (remoteAudioEl) remoteAudioEl.srcObject = null;
      setCallUi(false);
    }

    async function handleSignal(msg) {
      if (!matchesCallThread(msg)) return;

      const signal = msg.signal;
      if (!signal) return;

      try {
        if (signal.type === "offer") {
          callConversationId = msg.conversationId || callConversationId;
          if (!inCall) {
            pendingOffer = msg;
            return;
          }
          await answerOffer(msg);
          return;
        }

        const peer = await ensurePc();
        if (signal.type === "answer") {
          const desc = signal.sdp || signal;
          if (peer.signalingState === "have-local-offer" || peer.signalingState === "have-local-pranswer") {
            await peer.setRemoteDescription(desc);
            await flushIce(peer);
            showActiveUi(role === "admin" ? "Player" : peerLabel(), "Connected");
          }
        } else if (signal.type === "ice" && signal.candidate) {
          if (!peer.remoteDescription) pendingIce.push(signal.candidate);
          else await peer.addIceCandidate(signal.candidate);
        }
      } catch (err) {
        console.warn("webrtc signal:", err?.message || err);
      }
    }

    function showIncomingUi(msg, actions) {
      const caller = msg.name || (msg.from === "admin" ? "Support" : "Player");
      if (overlay) {
        overlay.showIncoming({
          title: "Incoming call",
          name: caller,
          status: "Ringing…",
          ring: role === "admin",
          onAccept: () => actions.accept(),
          onDecline: () => actions.reject(),
        });
        return;
      }
      playAlertSound();
      const ok = window.confirm(`${caller} is calling. Accept?`);
      if (ok) actions.accept();
      else actions.reject();
    }

    function handleServerEvent(msg) {
      if (msg.type === "call_invite") {
        if (inCall && makingOffer) return;
        callConversationId = msg.conversationId || callConversationId;
        const actions = {
          accept: () => acceptCall(msg.conversationId),
          reject: () => rejectCall(msg.conversationId),
        };
        if (typeof onIncoming === "function") onIncoming(msg, actions);
        showIncomingUi(msg, actions);
        return;
      }
      if (msg.type === "call_accept") {
        callConversationId = msg.conversationId || callConversationId;
        overlay?.hide();
        showActiveUi(role === "admin" ? "Player" : peerLabel(), "Connecting…");
        setStatus?.("Call accepted — connecting…");
        setCallUi(true);
        return;
      }
      if (msg.type === "call_reject") {
        overlay?.hide();
        setStatus?.("Call declined.");
        endCall(false);
        return;
      }
      if (msg.type === "call_end") {
        overlay?.hide();
        setStatus?.("Call ended.");
        endCall(false);
        return;
      }
      if (msg.type === "webrtc_signal") {
        handleSignal(msg);
      }
    }

    callBtn?.addEventListener("click", () => {
      startCall().catch((err) => setStatus?.(err?.message || "Could not start call."));
    });
    hangBtn?.addEventListener("click", () => {
      endCall(true);
      setStatus?.("Call ended.");
    });

    return {
      startCall,
      acceptCall,
      rejectCall,
      endCall,
      handleServerEvent,
    };
  }

  window.LuckyChatMedia = {
    playAlertSound,
    startRingtone,
    stopRingtone,
    renderMediaAttachment,
    voiceBlobToFile,
    createVoiceController,
    createCallController,
  };
})();
