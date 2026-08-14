(() => {
  const qs = (id) => document.getElementById(id);

  const panel = qs("pwa-panel");
  const installBtn = qs("pwa-install-btn");
  const heroInstallBtn = qs("hero-install-btn");
  const notifyBtn = qs("pwa-notify-btn");
  const statusEl = qs("pwa-status");
  const helpEl = qs("pwa-help");

  let deferredPrompt = null;
  let swReg = null;

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

  async function refreshNotifyUi() {
    if (!pushSupported()) {
      showNotifyButton(false);
      if (!isIos()) setHelp("Push notifications aren't supported on this device/browser.");
      return;
    }

    if (isIos() && !isStandalone()) {
      showNotifyButton(false);
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
          notifyBtn.textContent = "Notifications On";
          notifyBtn.disabled = true;
          setStatus("Notifications enabled.");
          setHelp("");
          return;
        }
      } catch {
        /* fall through */
      }
      notifyBtn.textContent = "Enable Notifications";
      notifyBtn.disabled = false;
      setStatus("Notifications allowed — tap to finish setup.");
    } else if (permission === "denied") {
      notifyBtn.textContent = "Notifications Blocked";
      notifyBtn.disabled = true;
      setStatus("Notifications are blocked in browser settings.");
    } else {
      notifyBtn.textContent = "Enable Notifications";
      notifyBtn.disabled = false;
      setStatus("");
    }
  }

  async function enableNotifications() {
    if (!pushSupported()) {
      setHelp("Push notifications aren't supported on this device/browser.");
      return;
    }
    if (isIos() && !isStandalone()) {
      setHelp(
        "On iPhone/iPad: tap Share → Add to Home Screen, open the app from your home screen, then enable notifications."
      );
      return;
    }

    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setStatus("Notifications were not enabled.", true);
        await refreshNotifyUi();
        return;
      }

      const keyRes = await fetch("/api/push/vapid-public-key");
      const keyData = await keyRes.json().catch(() => ({}));
      if (!keyRes.ok || !keyData.publicKey) {
        setStatus("Notifications aren't configured on the server yet.", true);
        return;
      }

      const reg = swReg || (await navigator.serviceWorker.ready);
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(keyData.publicKey),
        });
      }

      const saveRes = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      if (!saveRes.ok) {
        setStatus("Could not save notification subscription.", true);
        return;
      }

      setStatus("Notifications enabled.");
      setHelp("");
      await refreshNotifyUi();
    } catch {
      setStatus("Could not enable notifications on this device.", true);
    }
  }

  async function promptInstall() {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice.catch(() => null);
      deferredPrompt = null;
      showInstallButton(false);
      if (choice?.outcome === "accepted") setStatus("App installed.");
      return;
    }
    if (isIos()) {
      setHelp("On iPhone/iPad: tap Share → Add to Home Screen to install this app.");
      setStatus("Add to Home Screen from the Share menu.");
      document.getElementById("pwa-panel")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      return;
    }
    setHelp("Use your browser menu → Install app / Add to Home screen.");
    setStatus("Install from your browser menu if the prompt doesn’t appear yet.");
    document.getElementById("pwa-panel")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
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
    });

    window.addEventListener("appinstalled", () => {
      deferredPrompt = null;
      showInstallButton(false);
      setStatus("App installed.");
    });
  }

  async function init() {
    if (panel) panel.hidden = false;
    setupInstallFlow();
    await registerServiceWorker();
    await refreshNotifyUi();

    const onInstallClick = () => {
      promptInstall().catch(() => setHelp("Use your browser menu to install this app."));
    };
    installBtn?.addEventListener("click", onInstallClick);
    heroInstallBtn?.addEventListener("click", onInstallClick);
    notifyBtn?.addEventListener("click", () => {
      enableNotifications().catch(() => setStatus("Could not enable notifications.", true));
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
