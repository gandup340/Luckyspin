(() => {
  const DEFAULT_ICE = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
  ];
  let cachedIce = null;
  let iceFetchPromise = null;

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
      iceFetchPromise = fetch("/api/webrtc/ice")
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
  }) {
    let pc = null;
    let localStream = null;
    let inCall = false;
    let pendingOffer = null;
    let pendingIce = [];
    let makingOffer = false;
    let callConversationId = null;

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
        if (state === "connected") setStatus?.("Call connected.");
        if (state === "failed") {
          setStatus?.("Call failed — check microphone permission and try again.");
        }
        if (state === "disconnected") setStatus?.("Call reconnecting…");
      };
      pc.ontrack = (ev) => {
        if (remoteAudioEl) {
          remoteAudioEl.srcObject = ev.streams[0] || new MediaStream([ev.track]);
          remoteAudioEl.play?.().catch(() => {});
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
      try {
        await startLocalAudio();
        const name =
          typeof callerName === "function" ? callerName() : callerName || (role === "admin" ? "Support" : "Player");
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
        endCall(false);
      } finally {
        makingOffer = false;
      }
    }

    async function acceptCall(conversationId) {
      callConversationId = conversationId;
      try {
        await startLocalAudio();
        sendJson({ type: "call_accept", conversationId });
        setCallUi(true);
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
        endCall(false);
      }
    }

    function rejectCall(conversationId) {
      sendJson({ type: "call_reject", conversationId });
      pendingOffer = null;
      pendingIce = [];
      endCall(false);
      setStatus?.("Call declined.");
    }

    function endCall(notify = true) {
      const conversationId = signalingConversationId();
      if (notify && conversationId) sendJson({ type: "call_end", conversationId });
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
          }
        } else if (signal.type === "ice" && signal.candidate) {
          if (!peer.remoteDescription) pendingIce.push(signal.candidate);
          else await peer.addIceCandidate(signal.candidate);
        }
      } catch (err) {
        console.warn("webrtc signal:", err?.message || err);
      }
    }

    function handleServerEvent(msg) {
      if (msg.type === "call_invite") {
        if (inCall && makingOffer) return;
        callConversationId = msg.conversationId || callConversationId;
        playAlertSound();
        if (typeof onIncoming === "function") {
          onIncoming(msg, {
            accept: () => acceptCall(msg.conversationId),
            reject: () => rejectCall(msg.conversationId),
          });
        } else {
          const ok = window.confirm(`${msg.name || "Caller"} is calling. Accept?`);
          if (ok) acceptCall(msg.conversationId);
          else rejectCall(msg.conversationId);
        }
        return;
      }
      if (msg.type === "call_accept") {
        callConversationId = msg.conversationId || callConversationId;
        setStatus?.("Call accepted — connecting…");
        setCallUi(true);
        return;
      }
      if (msg.type === "call_reject") {
        setStatus?.("Call declined.");
        endCall(false);
        return;
      }
      if (msg.type === "call_end") {
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
    renderMediaAttachment,
    voiceBlobToFile,
    createVoiceController,
    createCallController,
  };
})();
