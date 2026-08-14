(() => {
  const qs = (id) => document.getElementById(id);

  const panel = qs("pwa-panel");
  const installBtn = qs("pwa-install-btn");
  const heroInstallBtn = qs("hero-install-btn");
  const welcomeInstallBtn = qs("welcome-install-btn");
  const welcomeInstallHint = qs("welcome-install-hint");
  const notifyBtn = qs("pwa-notify-btn");
  const playerNotifyBtn = qs("player-notify-btn");
  const playerNotifyStatus = qs("player-notify-status");
  const statusEl = qs("pwa-status");
  const helpEl = qs("pwa-help");

  let deferredPrompt = null;
  let swReg = null;
  let pushBind = { conversationId: "", email: "" };

  function setStatus(text, isError = false) {
    if (!statusEl) return;
    statusEl.textContent = text || "";
    statusEl.classList.toggle("is-error", Boolean(isError && text));
  }

  function setHelp(text) {
    if (!helpEl) return;
    helpEl.textContent = text || "";
    helpEl.hidden = !text;
  }

  function setWelcomeHint(text) {
    if (!welcomeInstallHint) return;
    welcomeInstallHint.textContent = text || "";
    welcomeInstallHint.hidden = !text;
  }

  function isStandalone() {
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true ||
      document.referrer.includes("android-app://")
    );
  }

  function isIos() {
    const ua = window.navigator.userAgent || "";
    return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }

  function pushSupported() {
    return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
    return out;
  }

  function showInstallButton(show) {
    if (installBtn) installBtn.hidden = !show;
    if (heroInstallBtn) heroInstallBtn.hidden = !show;
    if (welcomeInstallBtn) welcomeInstallBtn.hidden = !show;
  }

  function showNotifyButton(show) {
    if (!notifyBtn) return;
    notifyBtn.hidden = !show;
  }

  async function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return null;
    try {
      swReg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      return swReg;
    } catch {
      setStatus("App install helpers unavailable in this browser.", true);
      return null;
    }
  }

  function setPlayerNotifyStatus(text, isError = false) {
    if (!playerNotifyStatus) return;
    if (!text) {
      playerNotifyStatus.hidden = true;
      playerNotifyStatus.textContent = "";
      return;
    }
    playerNotifyStatus.hidden = false;
    playerNotifyStatus.textContent = text;
    playerNotifyStatus.classList.toggle("is-error", Boolean(isError));
  }

  async function refreshNotifyUi() {
    if (!pushSupported()) {
      showNotifyButton(false);
      if (playerNotifyBtn) {
        playerNotifyBtn.disabled = true;
        playerNotifyBtn.textContent = "Not supported here";
      }
      if (!isIos()) setHelp("Push notifications aren't supported on this device/browser.");
      return;
    }

    if (isIos() && !isStandalone()) {
      showNotifyButton(false);
      if (playerNotifyBtn) {
        playerNotifyBtn.disabled = false;
        playerNotifyBtn.textContent = "Enable notifications";
      }
      setHelp(
        "On iPhone/iPad: tap Share → Add to Home Screen, open the app from your home screen, then enable notifications."
      );
      return;
    }

    showNotifyButton(true);
    const permission = Notification.permission;
    if (permission === "granted") {
      try {
        const reg = swReg || (await navigator.serviceWorker.ready);
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          if (notifyBtn) {
            notifyBtn.textContent = "Notifications On";
            notifyBtn.disabled = true;
          }
          if (playerNotifyBtn) {
            playerNotifyBtn.textContent = "Notifications On";
            playerNotifyBtn.disabled = true;
          }
          setStatus("Notifications enabled.");
          setPlayerNotifyStatus("Alerts enabled on this device.");
          setHelp("");
          return;
        }
      } catch {
        /* fall through */
      }
      if (notifyBtn) {
        notifyBtn.textContent = "Enable Notifications";
        notifyBtn.disabled = false;
      }
      if (playerNotifyBtn) {
        playerNotifyBtn.textContent = "Enable notifications";
        playerNotifyBtn.disabled = false;
      }
      setStatus("Notifications allowed — tap to finish setup.");
    } else if (permission === "denied") {
      if (notifyBtn) {
        notifyBtn.textContent = "Notifications Blocked";
        notifyBtn.disabled = true;
      }
      if (playerNotifyBtn) {
        playerNotifyBtn.textContent = "Blocked in browser";
        playerNotifyBtn.disabled = true;
      }
      setStatus("Notifications are blocked in browser settings.");
      setPlayerNotifyStatus("Notifications are blocked in browser settings.", true);
    } else {
      if (notifyBtn) {
        notifyBtn.textContent = "Enable Notifications";
        notifyBtn.disabled = false;
      }
      if (playerNotifyBtn) {
        playerNotifyBtn.textContent = "Enable notifications";
        playerNotifyBtn.disabled = false;
      }
      setStatus("");
    }
  }

  async function enableNotifications(extra = {}) {
    if (extra.conversationId) pushBind.conversationId = String(extra.conversationId);
    if (extra.email) pushBind.email = String(extra.email).trim().toLowerCase();

    if (!pushSupported()) {
      setHelp("Push notifications aren't supported on this device/browser.");
      setPlayerNotifyStatus("Push notifications aren't supported on this device.", true);
      return false;
    }
    if (isIos() && !isStandalone()) {
      const tip =
        "On iPhone/iPad: tap Share → Add to Home Screen, open the app from your home screen, then enable notifications.";
      setHelp(tip);
      setPlayerNotifyStatus(tip, true);
      return false;
    }

    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setStatus("Notifications were not enabled.", true);
        setPlayerNotifyStatus("Notifications were not enabled.", true);
        await refreshNotifyUi();
        return false;
      }

      const keyRes = await fetch("/api/push/vapid-public-key");
      const keyData = await keyRes.json().catch(() => ({}));
      if (!keyRes.ok || !keyData.publicKey) {
        setStatus("Notifications aren't configured on the server yet.", true);
        setPlayerNotifyStatus("Notifications aren't configured on the server yet.", true);
        return false;
      }

      const reg = swReg || (await navigator.serviceWorker.ready);
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(keyData.publicKey),
        });
      }

      const payload = {
        ...sub.toJSON(),
        conversationId: pushBind.conversationId || "",
        email: pushBind.email || "",
      };
      const saveRes = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!saveRes.ok) {
        setStatus("Could not save notification subscription.", true);
        setPlayerNotifyStatus("Could not save notification subscription.", true);
        return false;
      }

      setStatus("Notifications enabled.");
      setPlayerNotifyStatus("Alerts enabled — you'll hear/see support replies on this device.");
      setHelp("");
      await refreshNotifyUi();
      return true;
    } catch {
      setStatus("Could not enable notifications on this device.", true);
      setPlayerNotifyStatus("Could not enable notifications on this device.", true);
      return false;
    }
  }

  /** Re-bind existing subscription to the player's chat (no permission prompt if already granted). */
  async function bindPush(extra = {}) {
    if (extra.conversationId) pushBind.conversationId = String(extra.conversationId);
    if (extra.email) pushBind.email = String(extra.email).trim().toLowerCase();
    if (!pushBind.conversationId && !pushBind.email) return false;
    if (!pushSupported() || Notification.permission !== "granted") return false;
    try {
      const reg = swReg || (await navigator.serviceWorker.ready);
      const sub = await reg.pushManager.getSubscription();
      if (!sub) return false;
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...sub.toJSON(),
          conversationId: pushBind.conversationId || "",
          email: pushBind.email || "",
        }),
      });
      return true;
    } catch {
      return false;
    }
  }

  async function promptInstall() {
    setWelcomeHint("");
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice.catch(() => null);
      deferredPrompt = null;
      showInstallButton(false);
      if (choice?.outcome === "accepted") {
        setStatus("App installed.");
        setWelcomeHint("App installed.");
      }
      return;
    }
    if (isIos()) {
      const tip = "On iPhone/iPad: tap Share → Add to Home Screen.";
      setHelp(tip);
      setStatus("Add to Home Screen from the Share menu.");
      setWelcomeHint(tip);
      return;
    }
    const tip = "Use your browser menu → Install app / Add to Home screen.";
    setHelp(tip);
    setStatus("Install from your browser menu if the prompt doesn’t appear yet.");
    setWelcomeHint(tip);
  }

  function setupInstallFlow() {
    if (isStandalone()) {
      showInstallButton(false);
      setStatus("Running as installed app.");
      return;
    }

    // Show install on the starting page immediately; native prompt may arrive later.
    showInstallButton(true);

    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      deferredPrompt = event;
      showInstallButton(true);
      setHelp("");
      setWelcomeHint("");
    });

    window.addEventListener("appinstalled", () => {
      deferredPrompt = null;
      showInstallButton(false);
      setStatus("App installed.");
      setWelcomeHint("");
    });
  }

  async function init() {
    if (panel) panel.hidden = false;
    setupInstallFlow();
    await registerServiceWorker();
    await refreshNotifyUi();

    const onInstallClick = () => {
      promptInstall().catch(() => {
        const tip = "Use your browser menu to install this app.";
        setHelp(tip);
        setWelcomeHint(tip);
      });
    };
    installBtn?.addEventListener("click", onInstallClick);
    heroInstallBtn?.addEventListener("click", onInstallClick);
    welcomeInstallBtn?.addEventListener("click", onInstallClick);
    notifyBtn?.addEventListener("click", () => {
      enableNotifications().catch(() => setStatus("Could not enable notifications.", true));
    });
    playerNotifyBtn?.addEventListener("click", () => {
      const session = (() => {
        try {
          return JSON.parse(localStorage.getItem("lucky_chat_session_v1") || "null");
        } catch {
          return null;
        }
      })();
      const player = (() => {
        try {
          return JSON.parse(localStorage.getItem("lucky_player_cache") || "null");
        } catch {
          return null;
        }
      })();
      enableNotifications({
        conversationId: session?.conversationId || "",
        email: session?.email || player?.email || "",
      }).catch(() => setPlayerNotifyStatus("Could not enable notifications.", true));
    });

    window.luckyBindPush = bindPush;
    window.luckyEnablePush = enableNotifications;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
