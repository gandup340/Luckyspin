(() => {
  const TOKEN_KEY = "lucky_player_token";
  let token = localStorage.getItem(TOKEN_KEY) || "";
  let player = null;
  let mode = "login";

  const authView = document.getElementById("auth-view");
  const appView = document.getElementById("app-view");

  async function api(path, opts = {}) {
    const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(path, { ...opts, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  }

  function money(cents) {
    return `$${(Number(cents || 0) / 100).toFixed(2)}`;
  }

  function showAuthError(msg) {
    const el = document.getElementById("auth-error");
    el.hidden = !msg;
    el.textContent = msg || "";
  }

  function setPanel(name) {
    document.querySelectorAll(".app-panel").forEach((p) => {
      p.classList.toggle("is-active", p.dataset.panel === name);
    });
    document.querySelectorAll(".app-bottom button").forEach((b) => {
      b.classList.toggle("is-active", b.dataset.go === name);
    });
  }

  function renderPlayer() {
    if (!player) return;
    document.getElementById("bal-label").textContent = money(player.balanceCents);
    document.getElementById("home-name").textContent = player.name || player.username;
    document.getElementById("home-tier").textContent = player.vipTier || "bronze";
    document.getElementById("home-points").textContent = String(player.points || 0);
    document.getElementById("home-ref").textContent = player.referralCode || "";
    document.getElementById("pf-name").value = player.name || "";
    document.getElementById("pf-phone").value = player.phone || "";
    document.getElementById("pf-email").value = player.email || "";
    document.getElementById("pf-fb").value = player.facebookName || "";
  }

  async function refreshMe() {
    const data = await api("/api/player/me");
    player = data.player;
    renderPlayer();
  }

  async function loadDeposits() {
    const data = await api("/api/player/deposits");
    const list = document.getElementById("dep-list");
    list.innerHTML = (data.deposits || [])
      .map(
        (d) =>
          `<li>${money(d.amountCents)} · ${d.method || "—"} · <strong>${d.status}</strong><br/><small>${new Date(d.createdAt).toLocaleString()}</small></li>`
      )
      .join("") || "<li>No deposits yet.</li>";
  }

  async function loadWithdrawals() {
    const data = await api("/api/player/withdrawals");
    const list = document.getElementById("wd-list");
    list.innerHTML = (data.withdrawals || [])
      .map(
        (w) =>
          `<li>${money(w.amountCents)} · ${w.method || "—"} → ${w.destination || ""} · <strong>${w.status}</strong></li>`
      )
      .join("") || "<li>No withdrawals yet.</li>";
  }

  async function loadGameIds() {
    const data = await api("/api/player/game-ids");
    const list = document.getElementById("gid-list");
    list.innerHTML = (data.gameIds || [])
      .map((g) => `<li>${g.gameName || g.gameKey}: <code>${g.gameUserId}</code></li>`)
      .join("") || "<li>No game IDs saved.</li>";
  }

  async function enterApp() {
    authView.hidden = true;
    appView.hidden = false;
    await refreshMe();
    await Promise.all([loadDeposits(), loadWithdrawals(), loadGameIds()]);
  }

  document.getElementById("auth-toggle").addEventListener("click", () => {
    mode = mode === "login" ? "register" : "login";
    document.getElementById("auth-title").textContent = mode === "login" ? "Sign in" : "Create account";
    document.getElementById("auth-submit").textContent = mode === "login" ? "Sign in" : "Register";
    document.getElementById("register-extra").hidden = mode !== "register";
    document.getElementById("auth-toggle").textContent =
      mode === "login" ? "Need an account? Register" : "Have an account? Sign in";
    showAuthError("");
  });

  document.getElementById("auth-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    showAuthError("");
    try {
      const body = {
        username: document.getElementById("auth-username").value,
        password: document.getElementById("auth-password").value,
      };
      if (mode === "register") {
        body.name = document.getElementById("auth-name").value;
        body.referralCode = document.getElementById("auth-referral").value;
      }
      const data = await api(mode === "login" ? "/api/player/login" : "/api/player/register", {
        method: "POST",
        body: JSON.stringify(body),
      });
      token = data.token;
      localStorage.setItem(TOKEN_KEY, token);
      player = data.player;
      await enterApp();
    } catch (err) {
      showAuthError(err.message);
    }
  });

  document.getElementById("logout-btn").addEventListener("click", async () => {
    try {
      await api("/api/player/logout", { method: "POST", body: "{}" });
    } catch {
      /* ignore */
    }
    token = "";
    localStorage.removeItem(TOKEN_KEY);
    player = null;
    appView.hidden = true;
    authView.hidden = false;
  });

  document.querySelectorAll("[data-go]").forEach((btn) => {
    btn.addEventListener("click", () => setPanel(btn.dataset.go));
  });

  document.getElementById("deposit-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const status = document.getElementById("dep-status");
    status.textContent = "Submitting…";
    try {
      await api("/api/player/deposit", {
        method: "POST",
        body: JSON.stringify({
          amount: Number(document.getElementById("dep-amount").value),
          method: document.getElementById("dep-method").value,
          gameKey: document.getElementById("dep-game").value,
          reference: document.getElementById("dep-ref").value,
        }),
      });
      status.textContent = "Deposit submitted — waiting for admin approval.";
      e.target.reset();
      await loadDeposits();
    } catch (err) {
      status.textContent = err.message;
    }
  });

  document.getElementById("withdraw-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const status = document.getElementById("wd-status");
    status.textContent = "Submitting…";
    try {
      await api("/api/player/withdraw", {
        method: "POST",
        body: JSON.stringify({
          amount: Number(document.getElementById("wd-amount").value),
          method: document.getElementById("wd-method").value,
          destination: document.getElementById("wd-dest").value,
        }),
      });
      status.textContent = "Withdraw requested.";
      e.target.reset();
      await loadWithdrawals();
      await refreshMe();
    } catch (err) {
      status.textContent = err.message;
    }
  });

  document.getElementById("profile-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const status = document.getElementById("pf-status");
    try {
      const data = await api("/api/player/profile", {
        method: "PUT",
        body: JSON.stringify({
          name: document.getElementById("pf-name").value,
          phone: document.getElementById("pf-phone").value,
          email: document.getElementById("pf-email").value,
          facebookName: document.getElementById("pf-fb").value,
        }),
      });
      player = data.player;
      renderPlayer();
      status.textContent = "Saved.";
    } catch (err) {
      status.textContent = err.message;
    }
  });

  document.getElementById("gid-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api("/api/player/game-ids", {
        method: "POST",
        body: JSON.stringify({
          gameKey: document.getElementById("gid-key").value,
          gameName: document.getElementById("gid-key").value,
          gameUserId: document.getElementById("gid-uid").value,
        }),
      });
      e.target.reset();
      await loadGameIds();
    } catch (err) {
      alert(err.message);
    }
  });

  if (token) {
    enterApp().catch(() => {
      token = "";
      localStorage.removeItem(TOKEN_KEY);
    });
  }
})();
