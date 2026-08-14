(() => {
  const TOKEN_KEY = "lucky_player_token";
  const PLAYER_KEY = "lucky_player_cache";
  const CHAT_KEY = "lucky_chat_session_v1";
  const MOBILE_MQ = window.matchMedia("(max-width: 900px)");

  const panel = document.getElementById("chat-panel");
  const badge = document.getElementById("chat-badge");
  const statusEl = document.getElementById("chat-status");
  const bodyEl = document.getElementById("chat-body");
  const quickEl = document.getElementById("chat-quick");
  const authEl = document.getElementById("chat-auth");
  const welcomeGate = document.getElementById("welcome-gate");
  const playerShell = document.getElementById("player-shell");
  const intake = document.getElementById("chat-intake");
  const intakeError = document.getElementById("chat-intake-error");
  const form = document.getElementById("chat-form");
  const input = document.getElementById("chat-input");
  const fileInput = document.getElementById("chat-file");
  const fileName = document.getElementById("chat-file-name");
  const fileClear = document.getElementById("chat-file-clear");
  const voiceBtn = document.getElementById("chat-voice-btn");
  const callBtn = document.getElementById("chat-call-btn");
  const hangBtn = document.getElementById("chat-hang-btn");
  const localAudioEl = document.getElementById("chat-local-audio");
  const remoteAudioEl = document.getElementById("chat-remote-audio");
  const signinForm = document.getElementById("chat-signin");
  const signupForm = document.getElementById("chat-signup");
  const verifyForm = document.getElementById("chat-verify");
  const forgotForm = document.getElementById("chat-forgot");
  const resetForm = document.getElementById("chat-reset");
  const tabSignin = document.getElementById("chat-tab-signin");
  const tabSignup = document.getElementById("chat-tab-signup");

  if (!panel || !form) return;

  let ws = null;
  let reconnectTimer = null;
  let conversationId = null;
  let profile = null;
  let player = null;
  let token = localStorage.getItem(TOKEN_KEY) || "";
  let pendingEmail = "";
  let messages = [];
  let unread = 0;
  let open = false;
  let joining = false;

  function isMobile() {
    return MOBILE_MQ.matches;
  }

  function esc(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function loadJson(key) {
    try {
      return JSON.parse(localStorage.getItem(key) || "null");
    } catch {
      return null;
    }
  }

  function saveJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  }

  function cachePlayer(nextPlayer, nextToken) {
    player = nextPlayer || null;
    if (nextToken) {
      token = nextToken;
      try {
        localStorage.setItem(TOKEN_KEY, nextToken);
      } catch {
        /* private mode / quota */
      }
    }
    if (player) saveJson(PLAYER_KEY, player);
    else {
      try {
        localStorage.removeItem(PLAYER_KEY);
      } catch {
        /* ignore */
      }
    }
  }

  function clearAuth() {
    token = "";
    player = null;
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(PLAYER_KEY);
    } catch {
      /* ignore */
    }
  }

  function loadChatSession() {
    const data = loadJson(CHAT_KEY);
    if (!data?.conversationId || !data?.name || !data?.phone || !data?.email) return null;
    return data;
  }

  function saveChatSession(next) {
    saveJson(CHAT_KEY, next);
  }

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  function setError(el, text) {
    if (!el) return;
    if (!text) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    el.hidden = false;
    el.textContent = text;
  }

  async function withBusyForm(form, run) {
    const btn = form?.querySelector('button[type="submit"]');
    if (btn) {
      btn.disabled = true;
      btn.setAttribute("aria-busy", "true");
    }
    try {
      return await run();
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.removeAttribute("aria-busy");
      }
    }
  }

  function bubbleClass(from) {
    if (from === "customer") return "user";
    if (from === "admin") return "bot";
    return "system";
  }

  function renderAttachment(attachment) {
    if (window.LuckyChatMedia?.renderMediaAttachment) {
      return window.LuckyChatMedia.renderMediaAttachment(attachment, esc);
    }
    if (!attachment?.url) return "";
    return `<a class="bubble-file" href="${esc(attachment.url)}" target="_blank" rel="noopener noreferrer">${esc(
      attachment.name || "Download file"
    )}</a>`;
  }

  function isAutoCaption(message) {
    const text = String(message.text || "");
    if (!message.attachment) return false;
    return (
      text === "Photo" ||
      text === "Video" ||
      text === "Audio message" ||
      text === "Voice message" ||
      text === message.attachment.name ||
      text.startsWith("Photo:") ||
      text.startsWith("Video:") ||
      text.startsWith("File:")
    );
  }

  function bindPushForChat() {
    window.luckyBindPush?.({
      conversationId,
      email: profile?.email || player?.email || "",
    });
  }

  function renderMessages() {
    if (!bodyEl) return;
    bodyEl.innerHTML = messages
      .map((m) => {
        const attachmentHtml = renderAttachment(m.attachment);
        const caption = String(m.text || "");
        const auto = isAutoCaption(m);
        const textHtml =
          caption && !(m.attachment && auto)
            ? `<div>${esc(caption)}</div>`
            : !m.attachment
              ? esc(caption)
              : "";
        return `<div class="bubble ${bubbleClass(m.from)}">${attachmentHtml}${textHtml}</div>`;
      })
      .join("");
    bodyEl.scrollTop = bodyEl.scrollHeight;
  }

  function setUnread(n) {
    unread = Math.max(0, n);
    if (!badge) return;
    if (!unread || open) {
      badge.hidden = true;
      badge.textContent = "0";
      return;
    }
    badge.hidden = false;
    badge.textContent = unread > 9 ? "9+" : String(unread);
  }

  function profileFromPlayer(p) {
    const saved = loadChatSession();
    const phone = String(p.phone || "").trim();
    const phoneOk = phone.replace(/\D/g, "").length >= 7;
    return {
      conversationId: saved?.conversationId || conversationId || "",
      name: String(p.name || p.username || "Player").trim().slice(0, 60),
      phone: phoneOk ? phone : "0000000000",
      email: String(p.email || "").trim().toLowerCase(),
    };
  }

  function showWelcome(mode = "signin") {
    if (welcomeGate) welcomeGate.hidden = false;
    if (playerShell) playerShell.hidden = true;
    document.body.classList.add("is-welcome");
    document.body.classList.remove("is-player");
    showAuthMode(mode);
    window.scrollTo(0, 0);
  }

  function enterSite() {
    if (welcomeGate) welcomeGate.hidden = true;
    document.body.classList.remove("is-welcome");
    document.body.classList.add("is-player");
    if (window.luckyPlayerShell?.open) {
      window.luckyPlayerShell.open();
    } else if (playerShell) {
      playerShell.hidden = false;
    }
  }

  function showAuthMode(mode) {
    if (authEl) authEl.hidden = false;
    const isVerify = mode === "verify";
    const isSignup = mode === "signup";
    const isForgot = mode === "forgot";
    const isReset = mode === "reset";
    const hideTabs = isVerify || isForgot || isReset;
    tabSignin?.classList.toggle("is-active", mode === "signin");
    tabSignup?.classList.toggle("is-active", isSignup);
    if (tabSignin) tabSignin.hidden = hideTabs;
    if (tabSignup) tabSignup.hidden = hideTabs;
    if (signinForm) signinForm.hidden = mode !== "signin";
    if (signupForm) signupForm.hidden = mode !== "signup";
    if (verifyForm) verifyForm.hidden = mode !== "verify";
    if (forgotForm) forgotForm.hidden = mode !== "forgot";
    if (resetForm) resetForm.hidden = mode !== "reset";
    const title = document.querySelector(".welcome-title");
    const lead = document.querySelector(".welcome-lead");
    if (isVerify) {
      if (title) title.textContent = "Almost there";
      if (lead) lead.textContent = "Confirm your email and you’re officially in the VIP circle.";
    } else if (isForgot) {
      if (title) title.textContent = "Forgot your password?";
      if (lead) lead.textContent = "No stress — enter your email and we’ll send a reset code.";
    } else if (isReset) {
      if (title) title.textContent = "Choose a new password";
      if (lead) lead.textContent = "Enter the code from your email, then set a fresh password.";
    } else if (isSignup) {
      if (title) title.textContent = "Join the VIP circle";
      if (lead) {
        lead.textContent =
          "Create your account in a minute — then chat with us and open verified game doors.";
      }
    } else {
      if (title) title.textContent = "Welcome home, VIP";
      if (lead) {
        lead.textContent =
          "Glad you’re here. Sign in to unlock verified game links, live support chat, and your player desk.";
      }
    }
  }

  function showGuestIntake() {
    if (intake) intake.hidden = false;
    if (form) form.hidden = true;
    if (bodyEl) bodyEl.hidden = true;
    if (quickEl) quickEl.hidden = true;
    setStatus("On this site only");
  }

  function showChatUi() {
    if (intake) intake.hidden = true;
    if (form) form.hidden = false;
    if (bodyEl) bodyEl.hidden = false;
    if (quickEl) quickEl.hidden = false;
    setStatus(player?.name || player?.email || "Connected");
  }

  function startChatWithPlayer(p) {
    cachePlayer(p, token);
    profile = profileFromPlayer(p);
    enterSite();
    if (!profile.email) {
      setStatus("Add email in settings to chat");
      return;
    }
    open = true;
    panel.hidden = false;
    setUnread(0);
    showChatUi();
    ensureSocket();
    if (ws?.readyState === WebSocket.OPEN) joinCustomer(profile);
    window.luckyPlayerShell?.refreshUserChip?.();
  }

  function clearFile() {
    if (fileInput) fileInput.value = "";
    if (fileName) {
      fileName.hidden = true;
      fileName.textContent = "";
    }
    if (fileClear) fileClear.hidden = true;
  }

  async function api(path, body) {
    const res = await fetch(path, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (data?.token) cachePlayer(data.player || player, data.token);
    return { res, data };
  }

  async function uploadFile(file) {
    const body = new FormData();
    body.append("file", file);
    if (conversationId) body.append("conversationId", conversationId);
    const res = await fetch("/api/chat/upload", {
      method: "POST",
      headers: conversationId ? { "X-Conversation-Id": conversationId } : {},
      body,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Upload failed");
    return data.attachment;
  }

  function sendJson(payload) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(payload));
    return true;
  }

  const callController = window.LuckyChatMedia?.createCallController?.({
    role: "customer",
    getConversationId: () => conversationId,
    sendJson,
    localAudioEl,
    remoteAudioEl,
    callBtn,
    hangBtn,
    setStatus,
    callerName: () => profile?.name || player?.name || "Player",
    onIncoming: (msg, actions) => {
      const ok = window.confirm(`${msg.name || "Support"} is calling. Accept?`);
      if (ok) actions.accept();
      else actions.reject();
    },
  });

  window.LuckyChatMedia?.createVoiceController?.({
    button: voiceBtn,
    setStatus,
    onRecorded: async (blob) => {
      if (!conversationId) {
        setStatus("Connect to chat first.");
        return;
      }
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        setStatus("Reconnecting…");
        ensureSocket();
        return;
      }
      try {
        setStatus("Sending voice…");
        const file = new File([blob], `voice-${Date.now()}.webm`, { type: blob.type || "audio/webm" });
        const attachment = await uploadFile(file);
        sendJson({ type: "message", text: "Voice message", attachment });
        setStatus("Voice sent");
      } catch (err) {
        setStatus(err.message || "Could not send voice");
      }
    },
  });

  function joinCustomer(details) {
    joining = true;
    setStatus("Connecting…");
    return sendJson({
      type: "join_customer",
      name: details.name,
      phone: details.phone,
      email: details.email,
      conversationId: details.conversationId || undefined,
    });
  }

  function ensureSocket() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}/ws`);

    ws.addEventListener("open", () => {
      if (profile) joinCustomer(profile);
      else setStatus(isMobile() ? "Sign in to chat" : "On this site only");
    });

    ws.addEventListener("message", (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      if (msg.type === "error") {
        joining = false;
        setError(intakeError, msg.error || "Chat error");
        setStatus("Could not connect");
        return;
      }

      if (msg.type === "joined" && msg.role === "customer") {
        joining = false;
        conversationId = msg.conversationId;
        profile = {
          conversationId,
          name: msg.profile?.name || profile?.name || "",
          phone: msg.profile?.phone || profile?.phone || "",
          email: msg.profile?.email || profile?.email || "",
        };
        saveChatSession(profile);
        messages = Array.isArray(msg.messages) ? msg.messages : [];
        showChatUi();
        renderMessages();
        setError(intakeError, "");
        setStatus("Connected");
        bindPushForChat();
        if (typeof Notification !== "undefined" && Notification.permission === "default") {
          setStatus("Connected — enable notifications in Settings for phone/laptop alerts");
        }
        return;
      }

      if (
        msg.type === "call_invite" ||
        msg.type === "call_accept" ||
        msg.type === "call_reject" ||
        msg.type === "call_end" ||
        msg.type === "webrtc_signal"
      ) {
        callController?.handleServerEvent?.(msg);
        return;
      }

      if (msg.type === "message" && msg.conversationId === conversationId) {
        messages.push(msg.message);
        renderMessages();
        if (msg.message?.from === "admin") {
          window.LuckyChatMedia?.playAlertSound?.();
          if (!open) setUnread(unread + 1);
        }
      }
    });

    ws.addEventListener("close", () => {
      setStatus("Reconnecting…");
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => {
        if (open || profile) ensureSocket();
      }, 2000);
    });
  }

  async function restorePlayerSession() {
    const cached = loadJson(PLAYER_KEY);
    if (cached) player = cached;
    token = localStorage.getItem(TOKEN_KEY) || token || "";
    const hasCachedSession = Boolean((token || player?.email) && player?.email);
    try {
      const res = await fetch("/api/player/me", {
        credentials: "include",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.status === 401) {
        clearAuth();
        return false;
      }
      if (!res.ok) {
        // Keep local session on temporary server/network errors.
        return hasCachedSession;
      }
      const data = await res.json();
      cachePlayer(data.player, data.token || token);
      return Boolean(player?.email);
    } catch {
      return hasCachedSession;
    }
  }

  function openPlayerChat() {
    if (!(player?.email && token)) {
      showWelcome("signin");
      return;
    }
    startChatWithPlayer(player);
  }

  function showVerify(email, hint, devCode) {
    pendingEmail = email;
    const hintEl = document.getElementById("chat-verify-hint");
    const codeBox = document.getElementById("chat-verify-code-box");
    const codeInput = document.getElementById("chat-verify-code");
    if (hintEl) {
      hintEl.textContent = hint || `Enter the 6-digit code sent to ${email}.`;
    }
    if (codeBox) {
      if (devCode) {
        codeBox.hidden = false;
        codeBox.textContent = `Your code: ${devCode}`;
        if (codeInput) codeInput.value = String(devCode);
      } else {
        codeBox.hidden = true;
        codeBox.textContent = "";
      }
    }
    showWelcome("verify");
    codeInput?.focus();
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") window.luckyPlayerShell?.closeDrawer?.();
  });

  tabSignin?.addEventListener("click", () => showAuthMode("signin"));
  tabSignup?.addEventListener("click", () => showAuthMode("signup"));

  document.getElementById("chat-forgot-btn")?.addEventListener("click", () => {
    const email = String(document.getElementById("chat-login-email")?.value || "").trim();
    const forgotEmail = document.getElementById("chat-forgot-email");
    if (forgotEmail && email) forgotEmail.value = email;
    showAuthMode("forgot");
    forgotEmail?.focus();
  });

  document.getElementById("chat-forgot-back")?.addEventListener("click", () => showAuthMode("signin"));
  document.getElementById("chat-reset-back")?.addEventListener("click", () => showAuthMode("signin"));

  forgotForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    await withBusyForm(forgotForm, async () => {
      const email = String(document.getElementById("chat-forgot-email")?.value || "")
        .trim()
        .toLowerCase();
      const errEl = document.getElementById("chat-forgot-error");
      setError(errEl, "");
      const { res, data } = await api("/api/player/forgot-password", { email });
      if (!res.ok) {
        setError(errEl, data.error || "Could not send reset code");
        return;
      }
      pendingEmail = email;
      const hintEl = document.getElementById("chat-reset-hint");
      if (hintEl) {
        hintEl.textContent = data.message || `Enter the code sent to ${email}.`;
        if (data.devCode) hintEl.textContent += ` Dev code: ${data.devCode}`;
      }
      showAuthMode("reset");
      document.getElementById("chat-reset-code")?.focus();
    });
  });

  resetForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    await withBusyForm(resetForm, async () => {
      const code = String(document.getElementById("chat-reset-code")?.value || "").trim();
      const password = String(document.getElementById("chat-reset-password")?.value || "");
      const errEl = document.getElementById("chat-reset-error");
      setError(errEl, "");
      const { res, data } = await api("/api/player/reset-password", {
        email: pendingEmail,
        code,
        password,
      });
      if (!res.ok || !data.token) {
        setError(errEl, data.error || "Could not reset password");
        return;
      }
      cachePlayer(data.player, data.token);
      startChatWithPlayer(data.player);
    });
  });

  signinForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    await withBusyForm(signinForm, async () => {
      const email = String(document.getElementById("chat-login-email")?.value || "")
        .trim()
        .toLowerCase();
      const password = String(document.getElementById("chat-login-password")?.value || "");
      const errEl = document.getElementById("chat-signin-error");
      setError(errEl, "");
      const { res, data } = await api("/api/player/login", { email, password });
      if (data.needsVerification) {
        showVerify(data.email || email, data.error, data.devCode);
        return;
      }
      if (!res.ok || !data.token) {
        setError(errEl, data.error || "Sign in failed");
        return;
      }
      cachePlayer(data.player, data.token);
      startChatWithPlayer(data.player);
    });
  });

  signupForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    await withBusyForm(signupForm, async () => {
      const email = String(document.getElementById("chat-reg-email")?.value || "")
        .trim()
        .toLowerCase();
      const password = String(document.getElementById("chat-reg-password")?.value || "");
      const name = String(document.getElementById("chat-reg-name")?.value || "").trim();
      const phone = String(document.getElementById("chat-reg-phone")?.value || "").trim();
      const errEl = document.getElementById("chat-signup-error");
      setError(errEl, "");
      if (phone.replace(/\D/g, "").length < 7) {
        setError(errEl, "Enter a valid phone number");
        return;
      }
      const { res, data } = await api("/api/player/register", { email, password, name, phone });
      if (!res.ok) {
        setError(errEl, data.error || "Sign up failed");
        return;
      }
      showVerify(email, data.message, data.devCode);
    });
  });

  verifyForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    await withBusyForm(verifyForm, async () => {
      const code = String(document.getElementById("chat-verify-code")?.value || "").trim();
      const errEl = document.getElementById("chat-verify-error");
      setError(errEl, "");
      const { res, data } = await api("/api/player/verify-email", {
        email: pendingEmail,
        code,
      });
      if (!res.ok || !data.token) {
        setError(errEl, data.error || "Verification failed");
        return;
      }
      cachePlayer(data.player, data.token);
      startChatWithPlayer(data.player);
    });
  });

  document.getElementById("chat-resend-btn")?.addEventListener("click", async () => {
    const errEl = document.getElementById("chat-verify-error");
    setError(errEl, "");
    const { res, data } = await api("/api/player/resend-verification", { email: pendingEmail });
    if (!res.ok) {
      setError(errEl, data.error || "Could not resend");
      return;
    }
    const hintEl = document.getElementById("chat-verify-hint");
    const codeBox = document.getElementById("chat-verify-code-box");
    if (hintEl) hintEl.textContent = data.message || "Code resent.";
    if (codeBox) {
      if (data.devCode) {
        codeBox.hidden = false;
        codeBox.textContent = `Your code: ${data.devCode}`;
        const codeInput = document.getElementById("chat-verify-code");
        if (codeInput) codeInput.value = String(data.devCode);
      }
    }
  });

  intake?.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = String(document.getElementById("chat-name")?.value || "").trim();
    const phone = String(document.getElementById("chat-phone")?.value || "").trim();
    const email = String(document.getElementById("chat-email")?.value || "").trim().toLowerCase();
    const phoneOk = phone.replace(/\D/g, "").length >= 7;
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!name || !phoneOk || !emailOk) {
      setError(intakeError, "Enter your name, a valid phone, and email.");
      return;
    }
    setError(intakeError, "");
    profile = {
      conversationId: conversationId || loadChatSession()?.conversationId || "",
      name,
      phone,
      email,
    };
    ensureSocket();
    if (ws?.readyState === WebSocket.OPEN) {
      if (!joinCustomer(profile) && !joining) setStatus("Could not connect");
    } else {
      setStatus("Connecting…");
    }
  });

  quickEl?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-quick]");
    if (!btn || !conversationId) return;
    const text = btn.getAttribute("data-quick");
    if (!text) return;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      ensureSocket();
      return;
    }
    sendJson({ type: "message", text });
  });

  fileInput?.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) {
      clearFile();
      return;
    }
    if (fileName) {
      fileName.hidden = false;
      fileName.textContent = file.name;
    }
    if (fileClear) fileClear.hidden = false;
  });

  fileClear?.addEventListener("click", () => clearFile());

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = String(input?.value || "").trim();
    const file = fileInput?.files?.[0] || null;
    if ((!text && !file) || !conversationId) return;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setStatus("Reconnecting…");
      ensureSocket();
      return;
    }

    const sendBtn = form.querySelector('button[type="submit"]');
    if (sendBtn) sendBtn.disabled = true;
    try {
      let attachment = null;
      if (file) attachment = await uploadFile(file);
      const payload = { type: "message", text: text || "" };
      if (attachment) payload.attachment = attachment;
      sendJson(payload);
      if (input) input.value = "";
      clearFile();
    } catch (err) {
      setStatus(err.message || "Could not send");
    } finally {
      if (sendBtn) sendBtn.disabled = false;
    }
  });

  const savedChat = loadChatSession();
  if (savedChat) {
    profile = savedChat;
    conversationId = savedChat.conversationId;
    const nameEl = document.getElementById("chat-name");
    const phoneEl = document.getElementById("chat-phone");
    const emailEl = document.getElementById("chat-email");
    if (nameEl) nameEl.value = savedChat.name || "";
    if (phoneEl) phoneEl.value = savedChat.phone || "";
    if (emailEl) emailEl.value = savedChat.email || "";
  }

  restorePlayerSession().then((ok) => {
    if (ok && player?.email) {
      startChatWithPlayer(player);
      return;
    }
    showWelcome("signin");
  });

  window.luckyShowWelcome = showWelcome;
  window.luckyOpenPlayerChat = openPlayerChat;
  window.luckyUpdatePlayer = (next) => {
    if (!next) return;
    player = next;
    cachePlayer(next, token);
    if (player?.email) profile = profileFromPlayer(player);
  };
})();
