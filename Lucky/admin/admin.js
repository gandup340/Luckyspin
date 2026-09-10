(() => {
  const USER_KEY = "lucky_vips_admin_user";
  const IS_SUPPORT_PORTAL = location.pathname.startsWith("/support");
  let currentUser = null;
  try {
    currentUser = JSON.parse(localStorage.getItem(USER_KEY) || "null");
  } catch {
    currentUser = null;
  }
  let config = null;
  let users = [];
  let conversations = [];
  let activeId = null;
  let activeMessages = [];
  let ws;
  let loggedIn = false;

  const loginView = document.getElementById("login-view");
  const appView = document.getElementById("app-view");
  const loginForm = document.getElementById("login-form");
  const loginError = document.getElementById("login-error");
  const logoutBtn = document.getElementById("logout-btn");
  const convoList = document.getElementById("convo-list");
  const threadHead = document.getElementById("thread-head");
  const threadName = document.getElementById("thread-name");
  const threadContact = document.getElementById("thread-contact");
  const threadBody = document.getElementById("thread-body");
  const threadForm = document.getElementById("thread-form");
  const threadInput = document.getElementById("thread-input");
  const threadFile = document.getElementById("thread-file");
  const threadFileName = document.getElementById("thread-file-name");
  const threadFileClear = document.getElementById("thread-file-clear");
  const threadVoiceBtn = document.getElementById("thread-voice-btn");
  const threadCallBtn = document.getElementById("thread-call-btn");
  const threadHangBtn = document.getElementById("thread-hang-btn");
  const threadLocalAudio = document.getElementById("thread-local-audio");
  const threadRemoteAudio = document.getElementById("thread-remote-audio");
  const chatBadge = document.getElementById("chat-nav-badge");
  const mobileChatBadge = document.getElementById("mobile-chat-badge");
  const chatLayout = document.getElementById("chat-layout");
  const threadBack = document.getElementById("thread-back");
  const menuToggle = document.getElementById("menu-toggle");
  const menuClose = document.getElementById("menu-close");
  const sidebarBackdrop = document.getElementById("sidebar-backdrop");
  const mobileTopbarTitle = document.getElementById("mobile-topbar-title");

  async function api(url, options = {}) {
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    const res = await fetch(url, { ...options, headers, credentials: "include" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  }

  function showApp(loggedIn) {
    loginView.hidden = loggedIn;
    appView.hidden = !loggedIn;
  }

  function setStatus(id, text, isError) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.classList.toggle("error", !!isError);
  }

  function uid(prefix) {
    return `${prefix}${Math.random().toString(36).slice(2, 9)}`;
  }

  function userRole() {
    return String(currentUser?.role || "").toLowerCase() === "support" ? "support" : "admin";
  }

  function isAdminUser() {
    return userRole() === "admin";
  }

  function applyRoleAccess() {
    const admin = isAdminUser();
    document.querySelectorAll("[data-admin-only]").forEach((el) => {
      el.hidden = !admin;
    });
    const brand = document.querySelector(".side-brand");
    if (brand) brand.textContent = admin ? "Slot Valley Admin" : "Slot Valley Support";
    document.title = admin ? "Slot Valley Admin" : "Slot Valley Support";
    if (!admin) {
      document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("is-active"));
      document.querySelectorAll(".panel").forEach((p) => p.classList.remove("is-active"));
      document.querySelector('.nav-btn[data-tab="chat"]')?.classList.add("is-active");
      document.getElementById("tab-chat")?.classList.add("is-active");
      if (mobileTopbarTitle) mobileTopbarTitle.textContent = "Chats";
      showChatList();
    }
  }

  function applySupportPortalLogin() {
    if (!IS_SUPPORT_PORTAL) return;
    const title = document.getElementById("login-title");
    const sub = document.getElementById("login-sub");
    if (title) title.textContent = "Support";
    if (sub) sub.textContent = "Reply to website and Facebook Messenger chats";
    document.title = "Slot Valley Support";
  }

  function setMenuOpen(open) {
    appView?.classList.toggle("menu-open", open);
    if (menuToggle) menuToggle.setAttribute("aria-expanded", String(open));
    if (sidebarBackdrop) sidebarBackdrop.hidden = !open;
    document.body.classList.toggle("menu-lock", open);
  }

  function showChatList() {
    chatLayout?.classList.add("is-list");
    chatLayout?.classList.remove("is-thread");
    if (mobileTopbarTitle) mobileTopbarTitle.textContent = "Chats";
  }

  function showChatThread() {
    chatLayout?.classList.add("is-thread");
    chatLayout?.classList.remove("is-list");
    if (mobileTopbarTitle) {
      mobileTopbarTitle.textContent = threadName?.textContent || "Chat";
    }
  }

  function setUnreadBadges(count) {
    const show = count > 0;
    [chatBadge, mobileChatBadge].forEach((badge) => {
      if (!badge) return;
      badge.hidden = !show;
      badge.textContent = String(count);
    });
  }

  menuToggle?.addEventListener("click", () => setMenuOpen(!appView.classList.contains("menu-open")));
  menuClose?.addEventListener("click", () => setMenuOpen(false));
  sidebarBackdrop?.addEventListener("click", () => setMenuOpen(false));
  threadBack?.addEventListener("click", () => {
    activeId = null;
    threadForm.hidden = true;
    const delBtn = document.getElementById("thread-delete-btn");
    if (delBtn) delBtn.hidden = true;
    if (threadName) threadName.textContent = "Select a conversation";
    if (threadContact) threadContact.hidden = true;
    threadBody.innerHTML = "";
    showChatList();
    renderConvoList();
  });

  // Tabs
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.hasAttribute("data-admin-only") && !isAdminUser()) return;
      document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("is-active"));
      document.querySelectorAll(".panel").forEach((p) => p.classList.remove("is-active"));
      btn.classList.add("is-active");
      document.getElementById(`tab-${btn.dataset.tab}`)?.classList.add("is-active");
      if (mobileTopbarTitle) {
        mobileTopbarTitle.textContent = btn.dataset.title || btn.textContent.trim();
      }
      if (btn.dataset.tab === "dashboard" && isAdminUser()) loadDashboard().catch(() => {});
      if (btn.dataset.tab === "deposits" && isAdminUser()) loadPlayerDeposits().catch(() => {});
      if (btn.dataset.tab === "withdrawals" && isAdminUser()) loadPlayerWithdrawals().catch(() => {});
      if (btn.dataset.tab === "push") loadPush().catch(() => {});
      if (btn.dataset.tab === "chat") showChatList();
      setMenuOpen(false);
    });
  });

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    loginError.hidden = true;
    try {
      const data = await api("/api/admin/login", {
        method: "POST",
        body: JSON.stringify({
          username: document.getElementById("login-username").value,
          password: document.getElementById("login-password").value,
        }),
      });
      currentUser = data.user;
      loggedIn = true;
      localStorage.setItem(USER_KEY, JSON.stringify(currentUser));
      await bootAdmin();
    } catch (err) {
      loginError.textContent = err.message;
      loginError.hidden = false;
    }
  });

  logoutBtn.addEventListener("click", async () => {
    try {
      if (loggedIn) await api("/api/admin/logout", { method: "POST", body: "{}" });
    } catch {
      /* ignore */
    }
    loggedIn = false;
    currentUser = null;
    localStorage.removeItem(USER_KEY);
    ws?.close();
    setMenuOpen(false);
    showApp(false);
  });

  async function bootAdmin() {
    showApp(true);
    applyRoleAccess();
    const signedIn = document.getElementById("signed-in");
    if (signedIn) {
      const label = currentUser?.name || currentUser?.username || "";
      const roleLabel = userRole() === "support" ? "Support" : "Admin";
      signedIn.textContent = label ? `${roleLabel}: ${label}` : "";
    }

    if (isAdminUser()) {
      config = await api("/api/admin/config");
      renderGames();
      renderFacebook();
      renderContact();
      renderWinners();
      await loadPayments();
      await loadSpin();
      await loadCustomers();
      await loadUsers();
      await loadPush();
      await loadPlayerDeposits();
      await loadPlayerWithdrawals();
      await loadPlayersDb();
      await loadDashboard();
    } else {
      config = { winners: [], spinPrizes: [], games: [] };
      const winnersData = await api("/api/admin/winners");
      config.winners = winnersData.winners || [];
      renderWinners();
      await loadSpin();
      await loadCustomers();
      await loadPush();
    }

    await refreshChats();
    connectWs();
    setupJuwaUi();
    await loadJuwaOps();
  }

  async function loadSpin() {
    const data = await api("/api/admin/spin");
    config.spinPrizes = data.prizes || [];
    renderSpin();
    await loadSpinClaims();
  }

  function renderSpin() {
    const body = document.getElementById("spin-body");
    if (!body) return;
    const list = [...(config.spinPrizes || [])];
    while (list.length < 13) {
      list.push({ id: uid("sp_"), label: "", enabled: true });
    }
    body.innerHTML = list
      .slice(0, 13)
      .map(
        (p, i) => `
      <tr>
        <td data-label="#">${i + 1}</td>
        <td data-label="Prize"><input data-field="label" value="${esc(p.label || "")}" maxlength="24" placeholder="Prize label" /></td>
        <td data-label="Enabled"><label class="toggle-label"><input type="checkbox" data-field="enabled" ${p.enabled !== false ? "checked" : ""} /> On</label></td>
      </tr>`
      )
      .join("");
  }

  function fmtDate(ms) {
    if (!ms) return "—";
    try {
      return new Date(ms).toLocaleString();
    } catch {
      return "—";
    }
  }

  async function loadSpinClaims() {
    const body = document.getElementById("spin-claims-body");
    if (!body) return;
    try {
      const data = await api("/api/admin/spins");
      const spins = data.spins || [];
      if (!spins.length) {
        body.innerHTML = `<tr class="table-empty"><td colspan="6">No claims yet</td></tr>`;
        return;
      }
      body.innerHTML = spins
        .slice(0, 50)
        .map((s) => {
          const spunAt = s.createdAt || s.claimedAt;
          const nextAt = s.nextAvailableAt || (spunAt ? spunAt + 7 * 24 * 60 * 60 * 1000 : 0);
          return `
        <tr>
          <td data-label="Prize">${esc(s.prizeLabel)}</td>
          <td data-label="Name">${esc(s.name)}</td>
          <td data-label="Phone">${esc(s.phone)}</td>
          <td data-label="Email">${esc(s.email)}</td>
          <td data-label="Spun">${esc(fmtDate(spunAt))}</td>
          <td data-label="Next spin">${esc(fmtDate(nextAt))}</td>
        </tr>`;
        })
        .join("");
    } catch {
      body.innerHTML = `<tr class="table-empty"><td colspan="6">Could not load claims</td></tr>`;
    }
  }

  document.getElementById("spin-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const rows = [...document.querySelectorAll("#spin-body tr")];
      const prizes = rows
        .map((tr, i) => ({
          id: (config.spinPrizes || [])[i]?.id || uid("sp_"),
          label: tr.querySelector('[data-field="label"]').value.trim(),
          enabled: tr.querySelector('[data-field="enabled"]').checked,
        }))
        .filter((p) => p.label);
      const data = await api("/api/admin/spin", {
        method: "PUT",
        body: JSON.stringify({ prizes }),
      });
      config.spinPrizes = data.prizes;
      renderSpin();
      setStatus("spin-status", "Saved — live on /spin/");
    } catch (err) {
      setStatus("spin-status", err.message, true);
    }
  });

  // Games
  function renderGames() {
    const body = document.getElementById("games-body");
    body.innerHTML = (config.games || [])
      .map(
        (g, i) => `
      <tr data-i="${i}">
        <td data-label="Name"><input data-field="name" value="${esc(g.name)}" /></td>
        <td data-label="Image"><input data-field="image" value="${esc(g.image)}" /></td>
        <td data-label="Player URL"><input data-field="player" value="${esc(g.player)}" /></td>
        <td data-label="Agent URL"><input data-field="agent" value="${esc(g.agent)}" /></td>
        <td data-label="Actions"><button type="button" class="danger" data-del="${i}">Delete</button></td>
      </tr>`
      )
      .join("");

    body.querySelectorAll("input").forEach((input) => {
      input.addEventListener("change", () => {
        const i = Number(input.closest("tr").dataset.i);
        config.games[i][input.dataset.field] = input.value.trim();
      });
    });
    body.querySelectorAll("[data-del]").forEach((btn) => {
      btn.addEventListener("click", () => {
        config.games.splice(Number(btn.dataset.del), 1);
        renderGames();
      });
    });
  }

  document.getElementById("add-game-btn").addEventListener("click", () => {
    config.games.push({
      id: uid("g"),
      name: "New Game",
      image: "",
      player: "https://",
      agent: "https://",
    });
    renderGames();
  });

  document.getElementById("save-games-btn").addEventListener("click", async () => {
    try {
      const rows = [...document.querySelectorAll("#games-body tr")];
      config.games = rows.map((tr) => {
        const get = (f) => tr.querySelector(`[data-field="${f}"]`).value.trim();
        const existing = config.games[Number(tr.dataset.i)] || {};
        return {
          id: existing.id || uid("g"),
          name: get("name"),
          image: get("image"),
          player: get("player"),
          agent: get("agent"),
        };
      });
      await api("/api/admin/games", {
        method: "PUT",
        body: JSON.stringify({ games: config.games }),
      });
      setStatus("games-status", "Saved");
    } catch (err) {
      setStatus("games-status", err.message, true);
    }
  });

  // Winners (Yesterday's top 3)
  function renderWinners() {
    const body = document.getElementById("winners-body");
    if (!body) return;
    const list = [...(config.winners || [])];
    while (list.length < 3) {
      list.push({ rank: list.length + 1, name: "", amount: "" });
    }
    body.innerHTML = list
      .slice(0, 3)
      .map(
        (w, i) => `
      <tr data-i="${i}">
        <td data-label="Rank"><strong>#${i + 1}</strong></td>
        <td data-label="Name"><input data-field="name" value="${esc(w.name || "")}" placeholder="Player name" required /></td>
        <td data-label="Amount"><input data-field="amount" value="${esc(w.amount || "")}" placeholder="$100.00" required /></td>
      </tr>`
      )
      .join("");
  }

  document.getElementById("winners-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const rows = [...document.querySelectorAll("#winners-body tr")];
      const winners = rows.map((tr, i) => ({
        rank: i + 1,
        name: tr.querySelector('[data-field="name"]').value.trim(),
        amount: tr.querySelector('[data-field="amount"]').value.trim(),
      }));
      const data = await api("/api/admin/winners", {
        method: "PUT",
        body: JSON.stringify({ winners }),
      });
      config.winners = data.winners;
      renderWinners();
      setStatus("winners-status", "Saved — live on the site");
    } catch (err) {
      setStatus("winners-status", err.message, true);
    }
  });

  // Facebook
  function renderFacebook() {
    const messengerStatus = document.getElementById("fb-messenger-status");
    if (messengerStatus) {
      if (config.facebookMessengerConfigured) {
        messengerStatus.textContent =
          "Messenger inbox: connected. Page messages appear in Chats (FB badge).";
        messengerStatus.classList.remove("error");
      } else {
        messengerStatus.textContent =
          "Messenger inbox: NOT connected. Set FACEBOOK_PAGE_ACCESS_TOKEN in Render Environment, then restart.";
        messengerStatus.classList.add("error");
      }
    }

    const list = document.getElementById("fb-list");
    list.innerHTML = (config.facebook || [])
      .map(
        (f, i) => `
      <div class="edit-card" data-i="${i}">
        <label>Name<input data-field="name" value="${esc(f.name)}" /></label>
        <label>URL<input data-field="url" value="${esc(f.url)}" /></label>
        <label>Description<input data-field="desc" value="${esc(f.desc || "")}" /></label>
        <button type="button" class="danger" data-del="${i}">Delete</button>
      </div>`
      )
      .join("");

    list.querySelectorAll("[data-del]").forEach((btn) => {
      btn.addEventListener("click", () => {
        config.facebook.splice(Number(btn.dataset.del), 1);
        renderFacebook();
      });
    });
  }

  document.getElementById("add-fb-btn").addEventListener("click", () => {
    config.facebook.push({
      id: uid("fb"),
      name: "New Page",
      url: "https://www.facebook.com/",
      desc: "",
    });
    renderFacebook();
  });

  document.getElementById("save-fb-btn").addEventListener("click", async () => {
    try {
      const cards = [...document.querySelectorAll("#fb-list .edit-card")];
      config.facebook = cards.map((card) => {
        const get = (f) => card.querySelector(`[data-field="${f}"]`).value.trim();
        const existing = config.facebook[Number(card.dataset.i)] || {};
        return {
          id: existing.id || uid("fb"),
          name: get("name"),
          url: get("url"),
          desc: get("desc"),
        };
      });
      await api("/api/admin/facebook", {
        method: "PUT",
        body: JSON.stringify({ facebook: config.facebook }),
      });
      setStatus("fb-status", "Saved");
    } catch (err) {
      setStatus("fb-status", err.message, true);
    }
  });

  // Contact
  function renderContact() {
    const messengerInput = document.getElementById("messenger-input");
    if (messengerInput) messengerInput.value = config.messenger || "";
    document.getElementById("whatsapp-input").value = config.whatsapp || "";
    document.getElementById("telegram-input").value = config.telegram || "";
  }

  document.getElementById("contact-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const data = await api("/api/admin/contact", {
        method: "PUT",
        body: JSON.stringify({
          messenger: document.getElementById("messenger-input")?.value || "",
          whatsapp: document.getElementById("whatsapp-input").value,
          telegram: document.getElementById("telegram-input").value,
        }),
      });
      config.messenger = data.messenger || "";
      config.whatsapp = data.whatsapp;
      config.telegram = data.telegram;
      setStatus("contact-status", "Saved");
    } catch (err) {
      setStatus("contact-status", err.message, true);
    }
  });

  async function loadPush() {
    const meta = document.getElementById("push-meta");
    try {
      const data = await api("/api/admin/push");
      if (meta) {
        meta.textContent = data.configured
          ? `Push ready — ${data.count} subscribed device(s).`
          : "Push not configured. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY on the server.";
        meta.classList.toggle("error", !data.configured);
      }
    } catch (err) {
      if (meta) {
        meta.textContent = err.message || "Could not load push status.";
        meta.classList.add("error");
      }
    }
  }

  const PUSH_TEMPLATES = {
    welcome: { title: "Welcome bonus", body: "Claim your welcome bonus today at Slot Valley.", url: "/" },
    deposit: { title: "Deposit match", body: "Deposit now and get a match bonus. Limited time.", url: "/" },
    spin: { title: "Free spin", body: "You have a free spin waiting — open the site to play.", url: "/#spin" },
    cashback: { title: "Cashback offer", body: "Weekend cashback is live. Check chat for details.", url: "/" },
    weekend: { title: "Weekend special", body: "Extra rewards this weekend only. Don't miss out.", url: "/" },
  };

  document.getElementById("push-templates")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-push-tpl]");
    if (!btn) return;
    const tpl = PUSH_TEMPLATES[btn.dataset.pushTpl];
    if (!tpl) return;
    const title = document.getElementById("push-title");
    const body = document.getElementById("push-body");
    const url = document.getElementById("push-url");
    if (title) title.value = tpl.title;
    if (body) body.value = tpl.body;
    if (url) url.value = tpl.url || "/";
    setStatus("push-status", "Template loaded — edit and send.");
  });

  document.getElementById("push-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const result = await api("/api/admin/push/send", {
        method: "POST",
        body: JSON.stringify({
          title: document.getElementById("push-title").value,
          body: document.getElementById("push-body").value,
          url: document.getElementById("push-url").value || "/",
          icon: document.getElementById("push-icon").value || "/assets/icons/icon-192.png",
        }),
      });
      setStatus(
        "push-status",
        `Sent ${result.sent || 0} · failed ${result.failed || 0} · removed ${result.removed || 0}`
      );
      await loadPush();
    } catch (err) {
      setStatus("push-status", err.message, true);
    }
  });

  function money(cents) {
    return `$${(Number(cents || 0) / 100).toFixed(2)}`;
  }


  function moneyUsd(amount) {
    return `$${Number(amount || 0).toFixed(2)}`;
  }

  function fillLedgerGameOptions() {
    const list = document.getElementById("ledger-games");
    if (!list) return;
    const names = (config?.games || []).map((g) => g.name).filter(Boolean);
    const defaults = ["Juwa", "Juwa2", "GameVault", "MilkyWay", "Orion"];
    const all = [...new Set([...names, ...defaults])];
    list.innerHTML = all.map((n) => `<option value="${esc(n)}"></option>`).join("");
  }

  function resetDepositForm() {
    const id = document.getElementById("deposit-id");
    if (id) id.value = "";
    document.getElementById("deposit-form")?.reset();
    const btn = document.getElementById("deposit-save-btn");
    if (btn) btn.textContent = "Add deposit";
    const cancel = document.getElementById("deposit-cancel-btn");
    if (cancel) cancel.hidden = true;
  }

  function resetWithdrawalForm() {
    const id = document.getElementById("withdrawal-id");
    if (id) id.value = "";
    document.getElementById("withdrawal-form")?.reset();
    const btn = document.getElementById("withdrawal-save-btn");
    if (btn) btn.textContent = "Add withdrawal";
    const cancel = document.getElementById("withdrawal-cancel-btn");
    if (cancel) cancel.hidden = true;
  }

  async function loadDashboard() {
    const body = document.getElementById("dashboard-body");
    if (!body) return;
    const dateEl = document.getElementById("dashboard-date");
    const date = dateEl?.value || new Date().toISOString().slice(0, 10);
    if (dateEl && !dateEl.value) dateEl.value = date;
    try {
      const data = await api(`/api/admin/dashboard?date=${encodeURIComponent(date)}`);
      const inEl = document.getElementById("dash-in");
      const outEl = document.getElementById("dash-out");
      const netEl = document.getElementById("dash-net");
      if (inEl) inEl.textContent = moneyUsd(data.totalIn);
      if (outEl) outEl.textContent = moneyUsd(data.totalOut);
      if (netEl) netEl.textContent = moneyUsd(data.net);
      const players = data.players || [];
      body.innerHTML = players.length
        ? players
            .map(
              (p) => `<tr>
            <td>${esc(p.playerName)}</td>
            <td>${moneyUsd(p.in)}</td>
            <td>${moneyUsd(p.out)}</td>
            <td>${moneyUsd(p.net)}</td>
            <td>${esc(p.deposits)}</td>
            <td>${esc(p.withdrawals)}</td>
          </tr>`
            )
            .join("")
        : `<tr class="table-empty"><td colspan="6">No deposits or withdrawals on this day.</td></tr>`;
      setStatus("dashboard-status", `${data.depositCount || 0} deposits · ${data.withdrawalCount || 0} withdrawals`);
    } catch (err) {
      setStatus("dashboard-status", err.message, true);
    }
  }

  async function loadPlayerDeposits() {
    const body = document.getElementById("deposits-body");
    if (!body) return;
    fillLedgerGameOptions();
    try {
      const data = await api("/api/admin/ledger/deposits");
      const rows = data.deposits || [];
      body.innerHTML = rows.length
        ? rows
            .map(
              (d) => `<tr data-id="${esc(d.id)}">
            <td>${d.createdAt ? new Date(d.createdAt).toLocaleString() : "—"}</td>
            <td>${esc(d.playerName)}</td>
            <td>${esc(d.method)}</td>
            <td>${moneyUsd(d.amount)}</td>
            <td>${esc(d.games || "")}</td>
            <td class="user-actions">
              <button type="button" class="btn-mini" data-edit-deposit="${esc(d.id)}">Edit</button>
              <button type="button" class="btn-mini danger" data-del-deposit="${esc(d.id)}">Delete</button>
            </td>
          </tr>`
            )
            .join("")
        : `<tr class="table-empty"><td colspan="6">No deposits yet.</td></tr>`;

      body.querySelectorAll("[data-edit-deposit]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const row = rows.find((r) => r.id === btn.dataset.editDeposit);
          if (!row) return;
          document.getElementById("deposit-id").value = row.id;
          document.getElementById("deposit-player").value = row.playerName || "";
          document.getElementById("deposit-method").value = row.method || "";
          document.getElementById("deposit-amount").value = row.amount;
          document.getElementById("deposit-games").value = row.games || "";
          document.getElementById("deposit-save-btn").textContent = "Save changes";
          document.getElementById("deposit-cancel-btn").hidden = false;
        });
      });
      body.querySelectorAll("[data-del-deposit]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (!confirm("Delete this deposit?")) return;
          try {
            await api(`/api/admin/ledger/deposits/${btn.dataset.delDeposit}`, { method: "DELETE" });
            setStatus("deposits-status", "Deleted");
            await loadPlayerDeposits();
            await loadDashboard();
          } catch (err) {
            setStatus("deposits-status", err.message, true);
          }
        });
      });
    } catch (err) {
      setStatus("deposits-status", err.message, true);
    }
  }

  async function loadPlayerWithdrawals() {
    const body = document.getElementById("withdrawals-body");
    if (!body) return;
    fillLedgerGameOptions();
    try {
      const data = await api("/api/admin/ledger/withdrawals");
      const rows = data.withdrawals || [];
      body.innerHTML = rows.length
        ? rows
            .map(
              (w) => `<tr data-id="${esc(w.id)}">
            <td>${w.createdAt ? new Date(w.createdAt).toLocaleString() : "—"}</td>
            <td>${esc(w.playerName)}</td>
            <td>${esc(w.method)}</td>
            <td>${moneyUsd(w.amount)}</td>
            <td>${esc(w.games || "")}</td>
            <td class="user-actions">
              <button type="button" class="btn-mini" data-edit-wd="${esc(w.id)}">Edit</button>
              <button type="button" class="btn-mini danger" data-del-wd="${esc(w.id)}">Delete</button>
            </td>
          </tr>`
            )
            .join("")
        : `<tr class="table-empty"><td colspan="6">No withdrawals yet.</td></tr>`;

      body.querySelectorAll("[data-edit-wd]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const row = rows.find((r) => r.id === btn.dataset.editWd);
          if (!row) return;
          document.getElementById("withdrawal-id").value = row.id;
          document.getElementById("withdrawal-player").value = row.playerName || "";
          document.getElementById("withdrawal-method").value = row.method || "";
          document.getElementById("withdrawal-amount").value = row.amount;
          document.getElementById("withdrawal-games").value = row.games || "";
          document.getElementById("withdrawal-save-btn").textContent = "Save changes";
          document.getElementById("withdrawal-cancel-btn").hidden = false;
        });
      });
      body.querySelectorAll("[data-del-wd]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (!confirm("Delete this withdrawal?")) return;
          try {
            await api(`/api/admin/ledger/withdrawals/${btn.dataset.delWd}`, { method: "DELETE" });
            setStatus("withdrawals-status", "Deleted");
            await loadPlayerWithdrawals();
            await loadDashboard();
          } catch (err) {
            setStatus("withdrawals-status", err.message, true);
          }
        });
      });
    } catch (err) {
      setStatus("withdrawals-status", err.message, true);
    }
  }

  document.getElementById("deposit-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = String(document.getElementById("deposit-id")?.value || "");
    const payload = {
      playerName: document.getElementById("deposit-player").value,
      method: document.getElementById("deposit-method").value,
      amount: Number(document.getElementById("deposit-amount").value),
      games: document.getElementById("deposit-games").value,
    };
    try {
      if (id) {
        await api(`/api/admin/ledger/deposits/${id}`, { method: "PUT", body: JSON.stringify(payload) });
        setStatus("deposits-status", "Updated");
      } else {
        await api("/api/admin/ledger/deposits", { method: "POST", body: JSON.stringify(payload) });
        setStatus("deposits-status", "Added");
      }
      resetDepositForm();
      await loadPlayerDeposits();
      await loadDashboard();
    } catch (err) {
      setStatus("deposits-status", err.message, true);
    }
  });

  document.getElementById("deposit-cancel-btn")?.addEventListener("click", () => resetDepositForm());

  document.getElementById("withdrawal-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = String(document.getElementById("withdrawal-id")?.value || "");
    const payload = {
      playerName: document.getElementById("withdrawal-player").value,
      method: document.getElementById("withdrawal-method").value,
      amount: Number(document.getElementById("withdrawal-amount").value),
      games: document.getElementById("withdrawal-games").value,
    };
    try {
      if (id) {
        await api(`/api/admin/ledger/withdrawals/${id}`, { method: "PUT", body: JSON.stringify(payload) });
        setStatus("withdrawals-status", "Updated");
      } else {
        await api("/api/admin/ledger/withdrawals", { method: "POST", body: JSON.stringify(payload) });
        setStatus("withdrawals-status", "Added");
      }
      resetWithdrawalForm();
      await loadPlayerWithdrawals();
      await loadDashboard();
    } catch (err) {
      setStatus("withdrawals-status", err.message, true);
    }
  });

  document.getElementById("withdrawal-cancel-btn")?.addEventListener("click", () => resetWithdrawalForm());
  document.getElementById("dashboard-date")?.addEventListener("change", () => {
    loadDashboard().catch(() => {});
  });

  async function loadPlayersDb() {
    const body = document.getElementById("players-body");
    if (!body) return;
    try {
      const data = await api("/api/admin/players");
      const players = data.players || [];
      if (!players.length) {
        body.innerHTML = `<tr class="table-empty"><td colspan="8">No registered players yet.</td></tr>`;
        return;
      }
      body.innerHTML = players
        .map(
          (p) => `<tr data-player-id="${esc(p.id)}">
            <td data-label="Username"><code>${esc(p.username)}</code></td>
            <td data-label="Name">${esc(p.name || "")}</td>
            <td data-label="Email">${esc(p.email || "")}</td>
            <td data-label="Phone">${esc(p.phone || "")}</td>
            <td data-label="Balance">${money(p.balanceCents)}</td>
            <td data-label="Points">${esc(p.points)}</td>
            <td data-label="New password">
              <input type="password" data-field="player-password" placeholder="Min 10 chars" minlength="10" autocomplete="new-password" />
            </td>
            <td data-label="Actions" class="user-actions">
              <button type="button" class="btn-mini" data-set-player-pass="${esc(p.id)}">Set password</button>
            </td>
          </tr>`
        )
        .join("");

      body.querySelectorAll("[data-set-player-pass]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const row = btn.closest("tr");
          const input = row?.querySelector('[data-field="player-password"]');
          const password = String(input?.value || "").trim();
          if (password.length < 10) {
            setStatus("players-status", "Password must be at least 10 characters", true);
            return;
          }
          btn.disabled = true;
          try {
            const result = await api(`/api/admin/players/${btn.dataset.setPlayerPass}/password`, {
              method: "PUT",
              body: JSON.stringify({ password }),
            });
            if (input) input.value = "";
            setStatus("players-status", result.message || "Password updated");
          } catch (err) {
            setStatus("players-status", err.message || "Could not update password", true);
          } finally {
            btn.disabled = false;
          }
        });
      });
    } catch (err) {
      body.innerHTML = `<tr class="table-empty"><td colspan="8">${esc(err.message || "Could not load players")}</td></tr>`;
      setStatus("players-status", err.message || "Could not load players", true);
    }
  }

  document.getElementById("refresh-deposits-btn")?.addEventListener("click", () => loadPlayerDeposits());
  document.getElementById("refresh-withdrawals-btn")?.addEventListener("click", () => loadPlayerWithdrawals());
  document.getElementById("refresh-players-btn")?.addEventListener("click", () => loadPlayersDb());

  // Payments
  let payments = [];

  async function loadPayments() {
    const data = await api("/api/admin/payments");
    payments = data.payments || [];
    renderPayments();
  }

  function renderPayments() {
    const body = document.getElementById("payments-body");
    if (!body) return;

    if (!payments.length) {
      body.innerHTML = `<tr class="table-empty"><td colspan="3">No payment options yet. Add one above.</td></tr>`;
      return;
    }

    body.innerHTML = payments
      .map(
        (p) => `
      <tr data-id="${esc(p.id)}">
        <td data-label="Name"><input data-field="name" value="${esc(p.name || "")}" /></td>
        <td data-label="Status">
          <label class="switch">
            <input type="checkbox" data-field="enabled" ${p.enabled !== false ? "checked" : ""} />
            <span>${p.enabled !== false ? "On" : "Off"}</span>
          </label>
        </td>
        <td data-label="Actions" class="user-actions">
          <button type="button" class="btn-mini" data-save-payment="${esc(p.id)}">Save</button>
          <button type="button" class="btn-mini danger" data-del-payment="${esc(p.id)}">Delete</button>
        </td>
      </tr>`
      )
      .join("");

    body.querySelectorAll('[data-field="enabled"]').forEach((input) => {
      input.addEventListener("change", () => {
        const label = input.parentElement?.querySelector("span");
        if (label) label.textContent = input.checked ? "On" : "Off";
      });
    });

    body.querySelectorAll("[data-save-payment]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const row = btn.closest("tr");
        try {
          await api(`/api/admin/payments/${btn.dataset.savePayment}`, {
            method: "PUT",
            body: JSON.stringify({
              name: row.querySelector('[data-field="name"]').value,
              enabled: row.querySelector('[data-field="enabled"]').checked,
            }),
          });
          setStatus("payments-status", "Payment updated");
          await loadPayments();
        } catch (err) {
          setStatus("payments-status", err.message, true);
        }
      });
    });

    body.querySelectorAll("[data-del-payment]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Delete this payment option?")) return;
        try {
          await api(`/api/admin/payments/${btn.dataset.delPayment}`, { method: "DELETE" });
          setStatus("payments-status", "Payment deleted");
          await loadPayments();
        } catch (err) {
          setStatus("payments-status", err.message, true);
        }
      });
    });
  }

  document.getElementById("add-payment-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api("/api/admin/payments", {
        method: "POST",
        body: JSON.stringify({
          name: document.getElementById("new-payment-name").value,
          enabled: document.getElementById("new-payment-enabled").checked,
        }),
      });
      e.target.reset();
      document.getElementById("new-payment-enabled").checked = true;
      setStatus("payments-status", "Payment added");
      await loadPayments();
    } catch (err) {
      setStatus("payments-status", err.message, true);
    }
  });

  // Customers
  let customers = [];

  async function loadCustomers() {
    const data = await api("/api/admin/customers");
    customers = data.customers || [];
    renderCustomers();
  }

  function filteredCustomers() {
    const q = String(document.getElementById("customer-search")?.value || "")
      .trim()
      .toLowerCase();
    if (!q) return customers;
    return customers.filter((c) => String(c.name || "").toLowerCase().includes(q));
  }

  async function loadCustomerHistory(id) {
    const panel = document.getElementById("customer-history");
    if (!panel) return;
    try {
      const data = await api(`/api/admin/customers/${id}/history`);
      const title = document.getElementById("customer-history-title");
      const totals = document.getElementById("customer-history-totals");
      if (title) title.textContent = `History — ${data.customer?.name || "Customer"}`;
      if (totals) {
        totals.textContent = `In ${moneyUsd(data.totalIn)} · Out ${moneyUsd(data.totalOut)} · Net ${moneyUsd(data.net)}`;
      }
      const depBody = document.getElementById("customer-history-deposits");
      const wdBody = document.getElementById("customer-history-withdrawals");
      const spinBody = document.getElementById("customer-history-spins");
      const deps = data.deposits || [];
      const wds = data.withdrawals || [];
      const spins = data.spins || [];
      if (depBody) {
        depBody.innerHTML = deps.length
          ? deps
              .map(
                (d) => `<tr>
              <td>${d.createdAt ? new Date(d.createdAt).toLocaleString() : "—"}</td>
              <td>${esc(d.method)}</td>
              <td>${moneyUsd(d.amount)}</td>
              <td>${esc(d.games || "")}</td>
            </tr>`
              )
              .join("")
          : `<tr class="table-empty"><td colspan="4">No deposits.</td></tr>`;
      }
      if (wdBody) {
        wdBody.innerHTML = wds.length
          ? wds
              .map(
                (w) => `<tr>
              <td>${w.createdAt ? new Date(w.createdAt).toLocaleString() : "—"}</td>
              <td>${esc(w.method)}</td>
              <td>${moneyUsd(w.amount)}</td>
              <td>${esc(w.games || "")}</td>
            </tr>`
              )
              .join("")
          : `<tr class="table-empty"><td colspan="4">No withdrawals.</td></tr>`;
      }
      if (spinBody) {
        spinBody.innerHTML = spins.length
          ? spins
              .map(
                (s) => `<tr>
              <td>${s.claimedAt || s.createdAt ? new Date(s.claimedAt || s.createdAt).toLocaleString() : "—"}</td>
              <td>${esc(s.prizeLabel || "")}</td>
              <td>${s.claimed ? "Claimed" : "Unclaimed"}</td>
              <td>${esc(s.name || "")}</td>
            </tr>`
              )
              .join("")
          : `<tr class="table-empty"><td colspan="4">No spins.</td></tr>`;
      }
      panel.hidden = false;
      panel.scrollIntoView({ behavior: "smooth", block: "start" });
      setStatus("customers-status", "History loaded");
    } catch (err) {
      setStatus("customers-status", err.message, true);
    }
  }

  function renderCustomers() {
    const body = document.getElementById("customers-body");
    if (!body) return;
    const list = filteredCustomers();

    if (!customers.length) {
      body.innerHTML = `<tr class="table-empty"><td colspan="5">No customers yet. They appear here when someone starts a support chat.</td></tr>`;
      return;
    }
    if (!list.length) {
      body.innerHTML = `<tr class="table-empty"><td colspan="5">No customers match that name.</td></tr>`;
      return;
    }

    body.innerHTML = list
      .map(
        (c) => `
      <tr data-id="${esc(c.id)}">
        <td data-label="Name"><input data-field="name" value="${esc(c.name || "")}" /></td>
        <td data-label="Phone"><input data-field="phone" value="${esc(c.phone || "")}" /></td>
        <td data-label="Email"><input data-field="email" value="${esc(c.email || "")}" /></td>
        <td data-label="Updated">${c.updatedAt ? new Date(c.updatedAt).toLocaleString() : "—"}</td>
        <td data-label="Actions" class="user-actions">
          <button type="button" class="btn-mini" data-history-customer="${esc(c.id)}">History</button>
          <button type="button" class="btn-mini" data-save-customer="${esc(c.id)}">Save</button>
          <button type="button" class="btn-mini danger" data-del-customer="${esc(c.id)}">Delete</button>
        </td>
      </tr>`
      )
      .join("");

    body.querySelectorAll("[data-history-customer]").forEach((btn) => {
      btn.addEventListener("click", () => {
        loadCustomerHistory(btn.dataset.historyCustomer).catch(() => {});
      });
    });

    body.querySelectorAll("[data-save-customer]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const row = btn.closest("tr");
        try {
          await api(`/api/admin/customers/${btn.dataset.saveCustomer}`, {
            method: "PUT",
            body: JSON.stringify({
              name: row.querySelector('[data-field="name"]').value,
              phone: row.querySelector('[data-field="phone"]').value,
              email: row.querySelector('[data-field="email"]').value,
            }),
          });
          setStatus("customers-status", "Customer updated");
          await loadCustomers();
        } catch (err) {
          setStatus("customers-status", err.message, true);
        }
      });
    });

    body.querySelectorAll("[data-del-customer]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Delete this customer?")) return;
        try {
          await api(`/api/admin/customers/${btn.dataset.delCustomer}`, { method: "DELETE" });
          setStatus("customers-status", "Customer deleted");
          await loadCustomers();
        } catch (err) {
          setStatus("customers-status", err.message, true);
        }
      });
    });
  }

  document.getElementById("customer-search")?.addEventListener("input", () => renderCustomers());
  document.getElementById("customer-history-close")?.addEventListener("click", () => {
    const panel = document.getElementById("customer-history");
    if (panel) panel.hidden = true;
  });

  document.getElementById("add-customer-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api("/api/admin/customers", {
        method: "POST",
        body: JSON.stringify({
          name: document.getElementById("new-customer-name").value,
          phone: document.getElementById("new-customer-phone").value,
          email: document.getElementById("new-customer-email").value,
        }),
      });
      e.target.reset();
      setStatus("customers-status", "Customer added");
      await loadCustomers();
    } catch (err) {
      setStatus("customers-status", err.message, true);
    }
  });

  // Users
  async function loadUsers() {
    const data = await api("/api/admin/users");
    users = data.users || [];
    renderUsers();
  }

  function renderUsers() {
    const body = document.getElementById("users-body");
    if (!body) return;
    body.innerHTML = users
      .map((u) => {
        const role = String(u.role || "admin").toLowerCase() === "support" ? "support" : "admin";
        return `
      <tr data-id="${esc(u.id)}">
        <td data-label="Name"><input data-field="name" value="${esc(u.name || "")}" /></td>
        <td data-label="Username"><code>${esc(u.username)}</code></td>
        <td data-label="Role">
          <select data-field="role">
            <option value="admin" ${role === "admin" ? "selected" : ""}>Admin</option>
            <option value="support" ${role === "support" ? "selected" : ""}>Support</option>
          </select>
        </td>
        <td data-label="Password"><input data-field="password" type="password" placeholder="Leave blank to keep" /></td>
        <td data-label="Actions" class="user-actions">
          <button type="button" class="btn-mini" data-save="${esc(u.id)}">Save</button>
          <button type="button" class="btn-mini danger" data-del="${esc(u.id)}">Delete</button>
        </td>
      </tr>`;
      })
      .join("");

    body.querySelectorAll("[data-save]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const row = btn.closest("tr");
        const payload = {
          name: row.querySelector('[data-field="name"]').value,
          role: row.querySelector('[data-field="role"]').value,
        };
        const password = row.querySelector('[data-field="password"]').value.trim();
        if (password) payload.password = password;
        try {
          await api(`/api/admin/users/${btn.dataset.save}`, {
            method: "PUT",
            body: JSON.stringify(payload),
          });
          setStatus("users-status", "User updated");
          await loadUsers();
        } catch (err) {
          setStatus("users-status", err.message, true);
        }
      });
    });

    body.querySelectorAll("[data-del]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Delete this user?")) return;
        try {
          await api(`/api/admin/users/${btn.dataset.del}`, { method: "DELETE" });
          setStatus("users-status", "User deleted");
          await loadUsers();
        } catch (err) {
          setStatus("users-status", err.message, true);
        }
      });
    });
  }

  document.getElementById("add-user-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api("/api/admin/users", {
        method: "POST",
        body: JSON.stringify({
          name: document.getElementById("new-user-name").value,
          username: document.getElementById("new-user-username").value,
          password: document.getElementById("new-user-password").value,
          role: document.getElementById("new-user-role").value,
        }),
      });
      e.target.reset();
      const roleSelect = document.getElementById("new-user-role");
      if (roleSelect) roleSelect.value = "support";
      setStatus("users-status", "User added");
      await loadUsers();
    } catch (err) {
      setStatus("users-status", err.message, true);
    }
  });

  // Chat
  async function refreshChats() {
    const data = await api("/api/admin/chats");
    conversations = data.conversations || [];
    renderConvoList();
    const unread = conversations.reduce((n, c) => n + (c.unreadAdmin || 0), 0);
    setUnreadBadges(unread);
  }

  function previewText(message) {
    if (!message) return "No messages";
    if (message.attachment?.kind === "image") return message.text && message.text !== "Photo" ? message.text : "Photo";
    if (message.attachment?.kind === "video") return message.text && message.text !== "Video" ? message.text : "Video";
    if (message.attachment?.kind === "audio") {
      return message.text && message.text !== "Voice message" && message.text !== "Audio message"
        ? message.text
        : "Voice message";
    }
    if (message.attachment) return message.attachment.name || message.text || "Document";
    return message.text || "No messages";
  }

  function renderAttachmentHtml(attachment) {
    if (window.LuckyChatMedia?.renderMediaAttachment) {
      return window.LuckyChatMedia.renderMediaAttachment(attachment, esc);
    }
    if (!attachment?.url) return "";
    const url = esc(attachment.url);
    const name = esc(attachment.name || "Download file");
    if (attachment.kind === "image") {
      return `<a href="${url}" target="_blank" rel="noopener noreferrer"><img class="bubble-media" src="${url}" alt="${name}" loading="lazy" /></a>`;
    }
    if (attachment.kind === "video") {
      return `<video class="bubble-media" src="${url}" controls preload="metadata"></video>`;
    }
    return `<a class="bubble-file" href="${url}" target="_blank" rel="noopener noreferrer">${name}</a>`;
  }

  function initials(name) {
    const parts = String(name || "V").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "V";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }

  function renderConvoList() {
    if (!conversations.length) {
      convoList.innerHTML = `<p class="convo-empty">No Messenger chats yet. When someone messages your Facebook Page, it shows up here.</p>`;
      return;
    }
    convoList.innerHTML = conversations
      .map((c) => {
        const last = previewText(c.lastMessage);
        const when = c.updatedAt
          ? new Date(c.updatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
          : "";
        const unread = c.unreadAdmin ? `<span class="convo-unread">${c.unreadAdmin}</span>` : "";
        const channel =
          c.channel === "facebook"
            ? `<span class="convo-channel" title="Facebook Messenger">FB</span>`
            : "";
        return `
          <button type="button" class="convo-item ${c.id === activeId ? "is-active" : ""}" data-id="${esc(c.id)}">
            <span class="convo-avatar" aria-hidden="true">${esc(initials(c.name))}</span>
            <span class="convo-copy">
              <span class="convo-top">
                <strong>${esc(c.name || "Visitor")}${channel}</strong>
                <span class="convo-time">${esc(when)}</span>
              </span>
              <span class="convo-bottom">
                <span class="preview">${esc(last)}</span>
                ${c.online ? '<span class="dot-online" title="Online"></span>' : ""}
                ${unread}
              </span>
            </span>
          </button>`;
      })
      .join("");

    convoList.querySelectorAll(".convo-item").forEach((btn) => {
      btn.addEventListener("click", () => openConvo(btn.dataset.id));
    });
  }

  document.getElementById("thread-delete-btn")?.addEventListener("click", async () => {
    if (!isAdminUser()) {
      setStatus("chat-status", "Only admins can delete chats", true);
      return;
    }
    if (!activeId) return;
    if (!confirm("Delete this chat permanently?")) return;
    try {
      await api(`/api/admin/chats/${activeId}`, { method: "DELETE" });
      activeId = null;
      activeMessages = [];
      threadForm.hidden = true;
      const delBtn = document.getElementById("thread-delete-btn");
      if (delBtn) delBtn.hidden = true;
      if (threadName) threadName.textContent = "Select a conversation";
      if (threadContact) threadContact.hidden = true;
      threadBody.innerHTML = "";
      showChatList();
      await refreshChats();
      setStatus("chat-status", "Chat deleted");
    } catch (err) {
      setStatus("chat-status", err.message, true);
    }
  });

  async function openConvo(id) {
    const delBtn = document.getElementById("thread-delete-btn");
    if (delBtn) delBtn.hidden = !isAdminUser();
    activeId = id;
    const convo = await api(`/api/admin/chats/${id}`);
    activeMessages = convo.messages || [];
    if (threadName) threadName.textContent = convo.name || "Visitor";
    if (threadContact) {
      const lines = [];
      if (convo.channel === "facebook") lines.push("Facebook Messenger");
      if (convo.phone) lines.push(convo.phone);
      if (convo.email) lines.push(convo.email);
      threadContact.innerHTML = lines.map((l) => `<div>${esc(l)}</div>`).join("");
      threadContact.hidden = lines.length === 0;
    }
    threadForm.hidden = false;
    showChatThread();
    renderThread();
    await refreshChats();
    scanThreadForJuwa();
  }

  function renderThread() {
    threadBody.innerHTML = activeMessages
      .map((m) => {
        const attachmentHtml = renderAttachmentHtml(m.attachment);
        const caption = String(m.text || "").trim();
        const isAuto =
          !caption ||
          caption === "Photo" ||
          caption === "Video" ||
          caption === "Voice message" ||
          caption === "Audio message" ||
          /^File:\s/i.test(caption);
        const textHtml =
          caption && !(m.attachment && isAuto) ? `<div>${esc(caption)}</div>` : !m.attachment ? esc(caption) : "";
        return `<div class="bubble ${esc(m.from)}">${attachmentHtml}${textHtml}</div>`;
      })
      .join("");
    threadBody.scrollTop = threadBody.scrollHeight;
  }

  function clearThreadFile() {
    if (threadFile) threadFile.value = "";
    if (threadFileName) {
      threadFileName.hidden = true;
      threadFileName.textContent = "";
    }
    if (threadFileClear) threadFileClear.hidden = true;
  }

  async function uploadThreadFile(file) {
    const body = new FormData();
    body.append("file", file);
    const res = await fetch("/api/chat/upload", {
      method: "POST",
      credentials: "include",
      body,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Upload failed");
    return data.attachment;
  }

  threadFile?.addEventListener("change", () => {
    const file = threadFile.files?.[0];
    if (!file) {
      clearThreadFile();
      return;
    }
    if (threadFileName) {
      threadFileName.hidden = false;
      threadFileName.textContent = file.name;
    }
    if (threadFileClear) threadFileClear.hidden = false;
  });

  threadFileClear?.addEventListener("click", () => clearThreadFile());

  function adminSendJson(payload) {
    if (!ws || ws.readyState !== 1) return false;
    ws.send(JSON.stringify(payload));
    return true;
  }

  const adminCall = window.LuckyChatMedia?.createCallController?.({
    role: "admin",
    getConversationId: () => activeId,
    sendJson: adminSendJson,
    localAudioEl: threadLocalAudio,
    remoteAudioEl: threadRemoteAudio,
    callBtn: threadCallBtn,
    hangBtn: threadHangBtn,
    setStatus: (t) => {
      if (!t) return;
      if (threadContact) {
        threadContact.hidden = false;
        let el = document.getElementById("thread-call-status");
        if (!el) {
          el = document.createElement("div");
          el.id = "thread-call-status";
          threadContact.appendChild(el);
        }
        el.textContent = t;
      }
    },
    callerName: () => "Support",
    onIncoming: (msg, actions) => {
      if (msg.conversationId && msg.conversationId !== activeId) {
        openConvo(msg.conversationId).catch(() => {});
      }
      const accept = actions.accept;
      actions.accept = () => {
        if (msg.conversationId) activeId = msg.conversationId;
        accept();
      };
    },
  });

  window.LuckyChatMedia?.createVoiceController?.({
    button: threadVoiceBtn,
    setStatus: (t) => {
      if (t) console.info("[voice]", t);
    },
    onRecorded: async (blob) => {
      if (!activeId || !ws || ws.readyState !== 1) {
        alert("Open a conversation first.");
        return;
      }
      try {
        const file = window.LuckyChatMedia.voiceBlobToFile(blob);
        const attachment = await uploadThreadFile(file);
        adminSendJson({
          type: "message",
          conversationId: activeId,
          text: "Voice message",
          attachment,
        });
      } catch (err) {
        alert(err.message || "Could not send voice");
      }
    },
  });

  threadForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = threadInput.value.trim();
    const file = threadFile?.files?.[0] || null;
    if ((!text && !file) || !activeId || !ws || ws.readyState !== 1) return;

    const sendBtn = threadForm.querySelector('button[type="submit"]');
    if (sendBtn) sendBtn.disabled = true;
    try {
      let attachment = null;
      if (file) attachment = await uploadThreadFile(file);
      const payload = { type: "message", conversationId: activeId, text: text || "" };
      if (attachment) payload.attachment = attachment;
      ws.send(JSON.stringify(payload));
      threadInput.value = "";
      clearThreadFile();
    } catch (err) {
      alert(err.message || "Could not send");
    } finally {
      if (sendBtn) sendBtn.disabled = false;
    }
  });

  function connectWs() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ type: "join_admin" }));
    });
    ws.addEventListener("message", async (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "error") {
        alert(msg.error || "Chat error");
        return;
      }
      if (
        msg.type === "call_invite" ||
        msg.type === "call_accept" ||
        msg.type === "call_reject" ||
        msg.type === "call_end" ||
        msg.type === "webrtc_signal"
      ) {
        adminCall?.handleServerEvent?.(msg);
        return;
      }
      if (msg.type === "message") {
        if (msg.conversationId === activeId) {
          activeMessages.push(msg.message);
          renderThread();
          if (msg.message?.from === "customer") scanThreadForJuwa();
        }
        if (msg.message?.from === "customer") {
          window.LuckyChatMedia?.playAlertSound?.();
        }
        await refreshChats();
      }
      if (msg.type === "presence" || msg.type === "chat_deleted") {
        await refreshChats();
      }
    });
    ws.addEventListener("close", () => {
      setTimeout(() => {
        if (loggedIn) connectWs();
      }, 2000);
    });
  }

  // ---- Juwa fund automation (chat detect → admin confirm → server automation) ----
  let juwaActiveRequest = null;
  let juwaPollTimer = null;

  const juwaBanner = document.getElementById("juwa-banner");
  const juwaBannerTitle = document.getElementById("juwa-banner-title");
  const juwaBannerDetail = document.getElementById("juwa-banner-detail");
  const juwaModal = document.getElementById("juwa-modal");
  const juwaModalUsername = document.getElementById("juwa-modal-username");
  const juwaModalAmount = document.getElementById("juwa-modal-amount");
  const juwaModalGame = document.getElementById("juwa-modal-game");
  const juwaModalSource = document.getElementById("juwa-modal-source");
  const juwaModalError = document.getElementById("juwa-modal-error");
  const juwaModalStatus = document.getElementById("juwa-modal-status");

  function hideJuwaBanner() {
    if (juwaBanner) juwaBanner.hidden = true;
  }

  function showJuwaBanner(req) {
    if (!juwaBanner) return;
    juwaActiveRequest = req;
    juwaBanner.hidden = false;
    if (juwaBannerTitle) {
      juwaBannerTitle.textContent =
        req.status === "needs_info"
          ? "Fund request needs verification"
          : req.status === "running" || req.status === "confirmed"
            ? "Auto-adding funds"
            : "Fund request detected — auto-running";
    }
    if (juwaBannerDetail) {
      const bits = [];
      if (req.game) bits.push(`Game: ${req.game}`);
      const userLabel = req.username || (Array.isArray(req.usernames) && req.usernames[0]) || null;
      if (userLabel) bits.push(`User: ${userLabel}`);
      if (req.amount != null) bits.push(`Amount: ${req.amount}`);
      if (req.missing?.length) bits.push(`Missing: ${req.missing.join(", ")}`);
      bits.push(req.reason || req.status);
      juwaBannerDetail.textContent = bits.join(" · ");
    }
  }

  function openJuwaModal(req) {
    juwaActiveRequest = req;
    if (juwaModalError) {
      juwaModalError.hidden = true;
      juwaModalError.textContent = "";
    }
    if (juwaModalStatus) {
      juwaModalStatus.hidden = true;
      juwaModalStatus.textContent = "";
    }
    if (juwaModalUsername) {
      juwaModalUsername.value = req.username || (Array.isArray(req.usernames) && req.usernames[0]) || "";
    }
    if (juwaModalGame) juwaModalGame.value = req.game || "";
    if (juwaModalAmount) juwaModalAmount.value = req.amount != null ? String(req.amount) : "";
    if (juwaModalSource) {
      juwaModalSource.value = `Conversation: ${req.conversationId || ""}\n${req.messageText || ""}`;
    }
    if (juwaModal) juwaModal.hidden = false;
  }

  function closeJuwaModal() {
    if (juwaModal) juwaModal.hidden = true;
    if (juwaPollTimer) {
      clearInterval(juwaPollTimer);
      juwaPollTimer = null;
    }
  }

  async function createJuwaFromMessage(message, textOverride) {
    if (!activeId || !message?.id) return null;
    const text = String(textOverride || message.text || "");
    if (!/\b(juwa2|juwa\s*2|juwa|milkyway|milky|gamevault|gvault|gv|orion|orionstar|orionstars|add|recharge|deposit|fund)\b/i.test(text)) return null;
    try {
      const data = await api("/api/admin/juwa/requests", {
        method: "POST",
        body: JSON.stringify({
          text,
          conversationId: activeId,
          messageId: message.id,
        }),
      });
      return data.request || null;
    } catch (err) {
      if (String(err.message || "").includes("does not look like")) return null;
      console.warn("juwa detect:", err.message || err);
      return null;
    }
  }

  async function scanThreadForJuwa() {
    hideJuwaBanner();
    const customers = [...activeMessages].filter((m) => m.from === "customer");
    if (!customers.length) return;

    // Prefer combined recent customer messages (username in one bubble, amount in another).
    const recent = customers.slice(-6);
    const combined = recent.map((m) => String(m.text || "").trim()).filter(Boolean).join("\n");
    const anchor = recent[recent.length - 1];
    if (anchor && /\b(juwa2|juwa\s*2|juwa|milkyway|milky|gamevault|gvault|gv|orion|orionstar|orionstars|add|recharge|deposit|fund)\b/i.test(combined)) {
      const req = await createJuwaFromMessage(anchor, combined);
      if (req) {
        // Prefill best username if server stored null but parse had candidates in reason — modal still editable
        showJuwaBanner(req);
        return;
      }
    }

    for (const m of [...customers].reverse().slice(0, 8)) {
      const req = await createJuwaFromMessage(m);
      if (req) {
        showJuwaBanner(req);
        return;
      }
    }
  }

  async function loadJuwaOps() {
    const body = document.getElementById("juwa-ops-body");
    const auditBody = document.getElementById("juwa-audit-body");
    if (!body) return;
    try {
      const status = await api("/api/admin/juwa/status");
      const juwaOk = status.credentialsConfigured;
      const mwOk = status.milkyway?.credentialsConfigured;
      const gvOk = status.gamevault?.credentialsConfigured;
      const orionOk = status.orion?.credentialsConfigured;
      const juwa2Ok = status.juwa2?.credentialsConfigured;
      const autoOn =
        status.automationEnabled ||
        status.juwa2?.automationEnabled ||
        status.milkyway?.automationEnabled ||
        status.gamevault?.automationEnabled ||
        status.orion?.automationEnabled;
      setStatus(
        "juwa-ops-status",
        autoOn
          ? `Juwa ${juwaOk ? "ready" : "missing creds"} · Juwa2 ${juwa2Ok ? "ready" : "missing creds"} · MilkyWay ${mwOk ? "ready" : "missing creds"} · GameVault ${gvOk ? "ready" : "missing creds"} · Orion ${orionOk ? "ready" : "missing creds"} · auto-process ${status.autoProcess === false ? "off" : "on"}`
          : "Automation disabled (set JUWA_AUTOMATION_ENABLED=1 / JUWA2_AUTOMATION_ENABLED=1 / MILKYWAY_AUTOMATION_ENABLED=1 / GAMEVAULT_AUTOMATION_ENABLED=1 / ORION_AUTOMATION_ENABLED=1)",
        !autoOn || !juwaOk || !juwa2Ok || !mwOk || !gvOk || !orionOk
      );
      const data = await api("/api/admin/juwa/requests?limit=40");
      const rows = data.requests || [];
      body.innerHTML = rows.length
        ? rows
            .map((r) => {
              const when = r.createdAt ? new Date(r.createdAt).toLocaleString() : "";
              return `<tr>
              <td data-label="When">${esc(when)}</td>
              <td data-label="Game">${esc(r.game || "—")}</td>
              <td data-label="Username"><code>${esc(r.username || "—")}</code></td>
              <td data-label="Amount">${r.amount != null ? esc(r.amount) : "—"}</td>
              <td data-label="Status">${esc(r.status)}</td>
              <td data-label="Admin">${esc(r.confirmedBy || "—")}</td>
              <td data-label="Actions">
                <button type="button" class="btn-mini" data-juwa-open="${esc(r.id)}">Open</button>
              </td>
            </tr>`;
            })
            .join("")
        : `<tr class="table-empty"><td colspan="7">No add-funds requests yet.</td></tr>`;

      body.querySelectorAll("[data-juwa-open]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const req = await api(`/api/admin/juwa/requests/${btn.dataset.juwaOpen}`);
          openJuwaModal(req.request);
        });
      });

      if (auditBody) {
        const audits = await api("/api/admin/juwa/audits?limit=40");
        const list = audits.audits || [];
        auditBody.innerHTML = list.length
          ? list
              .map((a) => {
                const when = a.at ? new Date(a.at).toLocaleString() : "";
                return `<tr>
                <td>${esc(when)}</td>
                <td>${esc(a.type || "")}</td>
                <td><code>${esc(a.username || "—")}</code></td>
                <td>${a.amount != null ? esc(a.amount) : "—"}</td>
                <td>${esc(a.status || "")}</td>
                <td>${esc(a.admin || "")}</td>
                <td>${esc(a.message || "")}</td>
              </tr>`;
              })
              .join("")
          : `<tr class="table-empty"><td colspan="7">No audits yet.</td></tr>`;
      }
    } catch (err) {
      setStatus("juwa-ops-status", err.message || "Could not load Juwa ops", true);
    }
  }

  function setupJuwaUi() {
    document.getElementById("juwa-dismiss-btn")?.addEventListener("click", () => hideJuwaBanner());
    document.getElementById("juwa-review-btn")?.addEventListener("click", () => {
      if (juwaActiveRequest) openJuwaModal(juwaActiveRequest);
    });
    document.getElementById("juwa-modal-cancel")?.addEventListener("click", () => closeJuwaModal());
    document.getElementById("refresh-juwa-btn")?.addEventListener("click", () => loadJuwaOps());

    document.querySelector('.nav-btn[data-tab="juwa"]')?.addEventListener("click", () => {
      loadJuwaOps().catch(() => {});
    });

    async function submitManualJuwa({ markAdded }) {
      const game = String(document.getElementById("juwa-manual-game")?.value || "").trim();
      const username = String(document.getElementById("juwa-manual-username")?.value || "").trim();
      const method = String(document.getElementById("juwa-manual-method")?.value || "").trim();
      const amount = Number(document.getElementById("juwa-manual-amount")?.value);
      try {
        const data = await api("/api/admin/juwa/requests", {
          method: "POST",
          body: JSON.stringify({ manual: true, markAdded: Boolean(markAdded), game, username, method, amount }),
        });
        setStatus("juwa-manual-status", data.message || "Saved");
        document.getElementById("juwa-manual-form")?.reset();
        await loadJuwaOps();
      } catch (err) {
        setStatus("juwa-manual-status", err.message, true);
      }
    }

    document.getElementById("juwa-manual-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      submitManualJuwa({ markAdded: false }).catch(() => {});
    });
    document.getElementById("juwa-manual-save-added")?.addEventListener("click", () => {
      submitManualJuwa({ markAdded: true }).catch(() => {});
    });

    async function markAddedAndReply() {
      if (!juwaActiveRequest?.id) return;
      const username = String(juwaModalUsername?.value || "").trim();
      const amount = Number(juwaModalAmount?.value);
      const game = String(juwaModalGame?.value || juwaActiveRequest.game || "").trim().toLowerCase();
      if (!username || !Number.isFinite(amount) || amount <= 0) {
        if (juwaModalError) {
          juwaModalError.hidden = false;
          juwaModalError.textContent = "Enter an exact username and a positive amount. Do not guess.";
        }
        return;
      }
      if (juwaModalError) juwaModalError.hidden = true;
      const markBtn = document.getElementById("juwa-modal-mark-added");
      const runBtn = document.getElementById("juwa-modal-confirm");
      if (markBtn) markBtn.disabled = true;
      if (runBtn) runBtn.disabled = true;
      try {
        const data = await api(`/api/admin/juwa/requests/${juwaActiveRequest.id}/mark-added`, {
          method: "POST",
          body: JSON.stringify({ username, amount, game }),
        });
        juwaActiveRequest = data.request || juwaActiveRequest;
        if (juwaModalStatus) {
          juwaModalStatus.hidden = false;
          juwaModalStatus.textContent = data.message || 'Marked added — replied "added" to player.';
        }
        showJuwaBanner(juwaActiveRequest);
        await loadJuwaOps();
        // Refresh open chat thread so admin sees the auto-reply
        if (activeId) {
          try {
            await openConvo(activeId);
          } catch {
            /* ignore */
          }
        }
      } catch (err) {
        if (juwaModalError) {
          juwaModalError.hidden = false;
          juwaModalError.textContent = err.message || "Could not mark added";
        }
      } finally {
        if (markBtn) markBtn.disabled = false;
        if (runBtn) runBtn.disabled = false;
      }
    }

    document.getElementById("juwa-modal-mark-added")?.addEventListener("click", () => {
      markAddedAndReply().catch(() => {});
    });

    document.getElementById("juwa-modal-confirm")?.addEventListener("click", async () => {
      if (!juwaActiveRequest?.id) return;
      const username = String(juwaModalUsername?.value || "").trim();
      const amount = Number(juwaModalAmount?.value);
      const game = String(juwaModalGame?.value || juwaActiveRequest.game || "").trim().toLowerCase();
      if (!username || !Number.isFinite(amount) || amount <= 0) {
        if (juwaModalError) {
          juwaModalError.hidden = false;
          juwaModalError.textContent = "Enter an exact username and a positive amount. Do not guess.";
        }
        return;
      }
      if (juwaModalError) juwaModalError.hidden = true;
      const btn = document.getElementById("juwa-modal-confirm");
      const markBtn = document.getElementById("juwa-modal-mark-added");
      if (btn) btn.disabled = true;
      if (markBtn) markBtn.disabled = true;
      try {
        await api(`/api/admin/juwa/requests/${juwaActiveRequest.id}/confirm`, {
          method: "POST",
          body: JSON.stringify({ username, amount, game }),
        });
        if (juwaModalStatus) {
          juwaModalStatus.hidden = false;
          juwaModalStatus.textContent =
            "Running… If CAPTCHA appears, complete self-identification in the browser window.";
        }
        if (juwaPollTimer) clearInterval(juwaPollTimer);
        juwaPollTimer = setInterval(async () => {
          try {
            const data = await api(`/api/admin/juwa/requests/${juwaActiveRequest.id}`);
            const req = data.request;
            juwaActiveRequest = req;
            if (juwaModalStatus) {
              juwaModalStatus.hidden = false;
              juwaModalStatus.textContent = `${req.status}${req.error ? ` — ${req.error}` : req.reason ? ` — ${req.reason}` : ""}`;
            }
              if (["success", "failed", "awaiting_captcha", "cancelled"].includes(req.status)) {
              clearInterval(juwaPollTimer);
              juwaPollTimer = null;
              if (btn) btn.disabled = false;
              if (markBtn) markBtn.disabled = false;
              if (req.status === "success" || req.status === "failed" || req.status === "awaiting_captcha") {
                showJuwaBanner(req);
                await loadJuwaOps();
                if (activeId) {
                  try {
                    await openConvo(activeId);
                  } catch {
                    /* ignore */
                  }
                }
              }
              if (req.status === "failed" && juwaModalError) {
                juwaModalError.hidden = false;
                juwaModalError.textContent = req.error || "not added — see chat for details";
              }
              if (req.status === "awaiting_captcha" && juwaModalError) {
                juwaModalError.hidden = false;
                juwaModalError.textContent =
                  "CAPTCHA required. Use Mark added & reply after you add funds on Juwa (error also posted in chat).";
              }
            }
          } catch {
            /* keep polling */
          }
        }, 2000);
      } catch (err) {
        if (juwaModalError) {
          juwaModalError.hidden = false;
          juwaModalError.textContent = err.message || "Could not start automation";
        }
        if (btn) btn.disabled = false;
        if (markBtn) markBtn.disabled = false;
      }
    });
  }

  function esc(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  applySupportPortalLogin();

  // Auto login if session cookie exists
  if (currentUser) {
    loggedIn = true;
    bootAdmin().catch(() => {
      loggedIn = false;
      currentUser = null;
      localStorage.removeItem(USER_KEY);
      showApp(false);
    });
  }
})();
