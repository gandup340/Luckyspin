(() => {
  const TOKEN_KEY = "lucky_player_token";
  const PLAYER_KEY = "lucky_player_cache";
  const CHAT_KEY = "lucky_chat_session_v1";

  const shell = document.getElementById("player-shell");
  const burger = document.getElementById("player-burger");
  const drawer = document.getElementById("player-drawer");
  const backdrop = document.getElementById("player-drawer-backdrop");
  const titleEl = document.getElementById("player-bar-title");
  const userEl = document.getElementById("player-bar-user");
  const logoutBtn = document.getElementById("player-logout");
  const profileForm = document.getElementById("player-profile-form");
  const passwordForm = document.getElementById("player-password-form");

  if (!shell) return;

  const titles = {
    chat: "Chat",
    spin: "Spin & Win",
    games: "Games",
    settings: "Settings",
  };

  function loadPlayer() {
    try {
      return JSON.parse(localStorage.getItem(PLAYER_KEY) || "null");
    } catch {
      return null;
    }
  }

  function setMsg(el, text) {
    if (!el) return;
    if (!text) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    el.hidden = false;
    el.textContent = text;
  }

  function closeDrawer() {
    if (drawer) drawer.hidden = true;
    if (backdrop) backdrop.hidden = true;
    burger?.setAttribute("aria-expanded", "false");
    burger?.classList.remove("is-open");
  }

  function openDrawer() {
    if (drawer) drawer.hidden = false;
    if (backdrop) backdrop.hidden = false;
    burger?.setAttribute("aria-expanded", "true");
    burger?.classList.add("is-open");
  }

  function toggleDrawer() {
    if (drawer?.hidden) openDrawer();
    else closeDrawer();
  }

  function ensureSpinFrame() {
    const frame = document.getElementById("player-spin-frame");
    if (!frame) return;
    const player = loadPlayer() || {};
    const params = new URLSearchParams({ embed: "1" });
    if (player.name) params.set("name", player.name);
    if (player.phone) params.set("phone", player.phone);
    if (player.email) params.set("email", player.email);
    const next = `/spin/?${params.toString()}`;
    // Reload when profile changes or first open so claim fields stay current.
    if (frame.dataset.loadedSrc !== next) {
      frame.src = next;
      frame.dataset.loadedSrc = next;
    }
  }

  function showView(name) {
    const view = String(name || "chat");
    document.querySelectorAll(".player-view").forEach((el) => {
      const on = el.dataset.playerView === view;
      el.hidden = !on;
      el.classList.toggle("is-active", on);
    });
    document.querySelectorAll(".player-nav-btn").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.playerView === view);
    });
    if (titleEl) titleEl.textContent = titles[view] || "LUCKY VIPS";
    closeDrawer();
    if (view === "settings") fillSettings();
    if (view === "spin") ensureSpinFrame();
  }

  function fillSettings() {
    const player = loadPlayer() || {};
    const name = document.getElementById("set-name");
    const email = document.getElementById("set-email");
    const phone = document.getElementById("set-phone");
    if (name) name.value = player.name || "";
    if (email) email.value = player.email || "";
    if (phone) phone.value = player.phone || "";
    refreshUserChip();
  }

  function refreshUserChip() {
    const player = loadPlayer() || {};
    if (userEl) userEl.textContent = player.name || player.email || "";
  }

  async function api(path, opts = {}) {
    const token = localStorage.getItem(TOKEN_KEY) || "";
    const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(path, { credentials: "include", ...opts, headers });
    const data = await res.json().catch(() => ({}));
    if (data?.token) {
      try {
        localStorage.setItem(TOKEN_KEY, data.token);
      } catch {
        /* ignore */
      }
    }
    return { res, data };
  }

  async function logout() {
    try {
      await api("/api/player/logout", { method: "POST", body: "{}" });
    } catch {
      /* ignore */
    }
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(PLAYER_KEY);
      localStorage.removeItem(CHAT_KEY);
    } catch {
      /* ignore */
    }
    document.body.classList.remove("is-player");
    shell.hidden = true;
    if (typeof window.luckyShowWelcome === "function") {
      window.luckyShowWelcome("signin");
    } else {
      location.reload();
    }
  }

  burger?.addEventListener("click", () => toggleDrawer());
  backdrop?.addEventListener("click", () => closeDrawer());

  document.querySelectorAll(".player-nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const view = btn.dataset.playerView;
      showView(view);
      if (view === "chat" && typeof window.luckyOpenPlayerChat === "function") {
        window.luckyOpenPlayerChat();
      }
    });
  });

  logoutBtn?.addEventListener("click", () => logout());

  profileForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = profileForm.querySelector('button[type="submit"]');
    if (btn) {
      btn.disabled = true;
      btn.setAttribute("aria-busy", "true");
    }
    const errEl = document.getElementById("set-profile-error");
    const okEl = document.getElementById("set-profile-ok");
    setMsg(errEl, "");
    setMsg(okEl, "");
    try {
      const body = {
        name: document.getElementById("set-name")?.value || "",
        email: document.getElementById("set-email")?.value || "",
        phone: document.getElementById("set-phone")?.value || "",
      };
      const { res, data } = await api("/api/player/profile", {
        method: "PUT",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setMsg(errEl, data.error || "Could not save profile");
        return;
      }
      if (data.player) {
        localStorage.setItem(PLAYER_KEY, JSON.stringify(data.player));
        refreshUserChip();
        window.luckyUpdatePlayer?.(data.player);
      }
      let msg = "Profile saved.";
      if (data.needsVerification) {
        msg = data.message || "Verify your new email.";
        if (data.devCode) msg += ` Code: ${data.devCode}`;
      }
      setMsg(okEl, msg);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.removeAttribute("aria-busy");
      }
    }
  });

  passwordForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = passwordForm.querySelector('button[type="submit"]');
    if (btn) {
      btn.disabled = true;
      btn.setAttribute("aria-busy", "true");
    }
    const errEl = document.getElementById("set-pass-error");
    const okEl = document.getElementById("set-pass-ok");
    setMsg(errEl, "");
    setMsg(okEl, "");
    try {
      const { res, data } = await api("/api/player/password", {
        method: "PUT",
        body: JSON.stringify({
          currentPassword: document.getElementById("set-pass-current")?.value || "",
          newPassword: document.getElementById("set-pass-new")?.value || "",
        }),
      });
      if (!res.ok) {
        setMsg(errEl, data.error || "Could not update password");
        return;
      }
      passwordForm.reset();
      setMsg(okEl, data.message || "Password updated.");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.removeAttribute("aria-busy");
      }
    }
  });

  window.luckyPlayerShell = {
    showView,
    refreshUserChip,
    closeDrawer,
    open: () => {
      shell.hidden = false;
      document.body.classList.add("is-player");
      document.body.classList.remove("is-welcome");
      refreshUserChip();
      showView("chat");
    },
  };
})();
