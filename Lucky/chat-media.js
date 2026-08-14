(() => {
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
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        chunks = [];
        const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : MediaRecorder.isTypeSupported("audio/webm")
            ? "audio/webm"
            : "";
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
          const blob = new Blob(chunks, { type: mediaRecorder.mimeType || "audio/webm" });
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

    async function ensurePc() {
      if (pc) return pc;
      pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });
      pc.onicecandidate = (ev) => {
        if (!ev.candidate) return;
        sendJson({
          type: "webrtc_signal",
          conversationId: getConversationId(),
          signal: { type: "ice", candidate: ev.candidate },
        });
      };
      pc.ontrack = (ev) => {
        if (remoteAudioEl) {
          remoteAudioEl.srcObject = ev.streams[0];
          remoteAudioEl.play?.().catch(() => {});
        }
      };
      return pc;
    }

    async function startLocalAudio() {
      if (localStream) return;
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      if (localAudioEl) {
        localAudioEl.srcObject = localStream;
        localAudioEl.muted = true;
      }
      const peer = await ensurePc();
      localStream.getTracks().forEach((track) => peer.addTrack(track, localStream));
    }

    function setCallUi(active) {
      inCall = active;
      hangBtn && (hangBtn.hidden = !active);
      callBtn && (callBtn.disabled = active);
    }

    async function answerOffer(offerMsg) {
      const peer = await ensurePc();
      await peer.setRemoteDescription(offerMsg.signal.sdp);
      if (!localStream) await startLocalAudio();
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      sendJson({
        type: "webrtc_signal",
        conversationId: offerMsg.conversationId,
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
      try {
        await startLocalAudio();
        const name =
          typeof callerName === "function" ? callerName() : callerName || (role === "admin" ? "Support" : "Player");
        sendJson({ type: "call_invite", conversationId, name });
        const peer = await ensurePc();
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        sendJson({
          type: "webrtc_signal",
          conversationId,
          signal: { type: "offer", sdp: peer.localDescription },
        });
        setCallUi(true);
        setStatus?.(role === "admin" ? "Calling player…" : "Calling support…");
      } catch {
        setStatus?.("Microphone permission is required for calls.");
        endCall(false);
      }
    }

    async function acceptCall(conversationId) {
      try {
        await startLocalAudio();
        sendJson({ type: "call_accept", conversationId });
        setCallUi(true);
        setStatus?.("Call connected.");
        if (pendingOffer && String(pendingOffer.conversationId) === String(conversationId)) {
          const offer = pendingOffer;
          pendingOffer = null;
          await answerOffer(offer);
        }
      } catch {
        setStatus?.("Could not access microphone.");
        sendJson({ type: "call_reject", conversationId });
        endCall(false);
      }
    }

    function rejectCall(conversationId) {
      sendJson({ type: "call_reject", conversationId });
      pendingOffer = null;
      endCall(false);
      setStatus?.("Call declined.");
    }

    function endCall(notify = true) {
      const conversationId = getConversationId();
      if (notify && conversationId) sendJson({ type: "call_end", conversationId });
      try {
        pc?.close();
      } catch {
        /* ignore */
      }
      pc = null;
      localStream?.getTracks()?.forEach((t) => t.stop());
      localStream = null;
      pendingOffer = null;
      if (localAudioEl) localAudioEl.srcObject = null;
      if (remoteAudioEl) remoteAudioEl.srcObject = null;
      setCallUi(false);
    }

    async function handleSignal(msg) {
      const conversationId = getConversationId();
      if (role !== "admin" && String(msg.conversationId) !== String(conversationId)) return;
      if (role === "admin" && conversationId && String(msg.conversationId) !== String(conversationId)) return;

      const peer = await ensurePc();
      const signal = msg.signal;
      try {
        if (signal.type === "offer") {
          if (!inCall) {
            pendingOffer = msg;
            return;
          }
          await answerOffer(msg);
        } else if (signal.type === "answer") {
          await peer.setRemoteDescription(signal.sdp);
        } else if (signal.type === "ice" && signal.candidate) {
          await peer.addIceCandidate(signal.candidate);
        }
      } catch (err) {
        console.warn("webrtc signal:", err?.message || err);
      }
    }

    function handleServerEvent(msg) {
      if (msg.type === "call_invite") {
        if (role === "admin" && getConversationId() && String(msg.conversationId) !== String(getConversationId())) {
          // Still alert admins even if another thread is open
        }
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
        setStatus?.("Call accepted.");
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

    callBtn?.addEventListener("click", () => startCall());
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
    createVoiceController,
    createCallController,
  };
})();
