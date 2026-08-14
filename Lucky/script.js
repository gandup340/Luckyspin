(() => {
  let config = {
    games: [],
    facebook: [],
    winners: [],
    payments: [],
    whatsapp: "",
    telegram: "",
    messenger: "",
  };
  let games = [];
  let query = "";

  const grid = document.getElementById("game-grid");
  const empty = document.getElementById("empty-state");
  const hint = document.getElementById("mode-hint");
  const countEl = document.getElementById("game-count");
  const search = document.getElementById("game-search");
  const searchClear = document.getElementById("search-clear");
  const header = document.getElementById("site-header");
  const toTop = document.getElementById("to-top");

  function esc(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function paymentKey(name) {
    const n = String(name || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
    if (n.includes("cashapp") || n === "cash") return "cashapp";
    if (n.includes("venmo")) return "venmo";
    if (n.includes("zelle")) return "zelle";
    if (n.includes("paypal")) return "paypal";
    if (n.includes("chime")) return "chime";
    if (n.includes("applepay") || n === "apple") return "applepay";
    if (n.includes("googlepay") || n === "gpay") return "googlepay";
    if (n.includes("crypto") || n.includes("bitcoin") || n.includes("btc")) return "crypto";
    if (n.includes("bank") || n.includes("wire") || n.includes("ach")) return "bank";
    if (n.includes("stripe")) return "stripe";
    return "generic";
  }

  function paymentIcon(key) {
    const files = {
      cashapp: "cashapp.webp",
      venmo: "venmo.webp",
      zelle: "zelle.webp",
      paypal: "paypal.webp",
      chime: "chime.webp",
      applepay: "applepay.webp",
      googlepay: "googlepay.webp",
      crypto: "bitcoin.webp",
      stripe: "stripe.webp",
      bank: "bank.webp",
      generic: "generic.webp",
    };
    const file = files[key] || files.generic;
    return `<img class="pay-logo" src="assets/payments/${file}" alt="" width="28" height="28" loading="lazy" decoding="async" />`;
  }

  const TOP_GAME_ORDER = ["juwa", "juwa2", "gamevault"];

  function normalizeGameName(name) {
    return String(name || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
  }

  function topGameRank(game) {
    const key = normalizeGameName(game.name);
    const aliases = {
      juwa: "juwa",
      juwa2: "juwa2",
      juwa20: "juwa2",
      gamevault: "gamevault",
    };
    const canonical = aliases[key];
    if (!canonical) return -1;
    return TOP_GAME_ORDER.indexOf(canonical);
  }

  function gameCard(game, { href, tag, featured = false, rank = 0 }) {
    return `
      <a class="game-card${featured ? " is-featured" : ""}" href="${esc(href)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${esc(game.name)} — ${esc(tag)}">
        <span class="game-thumb">
          <img src="${esc(game.image)}" alt="${esc(game.name)}" loading="lazy" decoding="async" />
        </span>
        <span class="game-meta">
          ${featured ? `<span class="game-rank">#${rank}</span>` : ""}
          <span class="game-name">${esc(game.name)}</span>
          <span class="game-tag">${esc(tag)}</span>
        </span>
      </a>`;
  }

  function renderGames() {
    if (!grid) return;
    const q = query.trim().toLowerCase();
    const filtered = games.filter((game) => game.name.toLowerCase().includes(q));

    const top = filtered
      .filter((game) => topGameRank(game) >= 0)
      .sort((a, b) => topGameRank(a) - topGameRank(b));
    const rest = filtered.filter((game) => topGameRank(game) < 0);

    grid.classList.remove("is-loading");
    grid.setAttribute("aria-busy", "false");

    const parts = [];
    if (top.length) {
      parts.push(`<p class="games-section-label">Top 3 games</p>`);
      parts.push(
        `<div class="game-row">${top
          .map((game) =>
            gameCard(game, {
              href: game.player,
              tag: "Top 3 · player",
              featured: true,
              rank: topGameRank(game) + 1,
            })
          )
          .join("")}</div>`
      );
    }
    if (rest.length) {
      if (top.length) {
        parts.push(`<p class="games-section-label">All games</p>`);
      }
      parts.push(
        `<div class="game-row">${rest
          .map((game) =>
            gameCard(game, {
              href: game.player,
              tag: "Player link",
            })
          )
          .join("")}</div>`
      );
    }

    grid.innerHTML = parts.join("");

    if (empty) empty.hidden = filtered.length > 0;
    if (hint) hint.innerHTML = "Showing <strong>player</strong> links";
    if (countEl) {
      countEl.textContent =
        filtered.length === games.length
          ? `${games.length} games`
          : `${filtered.length} of ${games.length} games`;
    }
  }

  function syncSearchClear() {
    if (!searchClear || !search) return;
    searchClear.hidden = !search.value;
  }

  search?.addEventListener("input", () => {
    query = search.value;
    syncSearchClear();
    renderGames();
  });

  searchClear?.addEventListener("click", () => {
    if (!search) return;
    search.value = "";
    query = "";
    syncSearchClear();
    renderGames();
    search.focus();
  });

  function applyConfig(data) {
    config = data;
    games = data.games || [];

    const winnersList = document.getElementById("winners-list");
    if (winnersList) {
      winnersList.innerHTML = (data.winners || [])
        .map(
          (w) => `
        <li>
          <span class="rank">${esc(w.rank)}</span>
          <span class="name">${esc(w.name)}</span>
          <span class="amount">${esc(w.amount)}</span>
        </li>`
        )
        .join("");
    }

    const fbGrid = document.getElementById("fb-grid");
    const fbPop = document.getElementById("fb-pop");
    const pages = data.facebook || [];
    if (fbGrid) {
      fbGrid.innerHTML = pages
        .map(
          (f) => `
        <li>
          <a class="fb-card" href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">
            <span class="fb-icon" aria-hidden="true">f</span>
            <span class="fb-card-text">
              <strong>${esc(f.name)}</strong>
              <small>${esc(f.desc || "Open page")}</small>
            </span>
          </a>
        </li>`
        )
        .join("");
    }
    if (fbPop) {
      fbPop.innerHTML = pages
        .map(
          (f) =>
            `<a href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">${esc(f.name)}</a>`
        )
        .join("");
    }

    const payList = document.getElementById("pay-list");
    if (payList) {
      const items = (data.payments || [])
        .map((p) => (typeof p === "string" ? p : p?.enabled !== false ? p.name : null))
        .filter(Boolean);
      const section = payList.closest(".payments");
      if (section) section.hidden = items.length === 0;
      payList.innerHTML = items
        .map((name) => {
          const key = paymentKey(name);
          return `
            <li class="pay-item pay-${key}">
              <span class="pay-icon" aria-hidden="true">${paymentIcon(key)}</span>
              <span class="pay-name">${esc(name)}</span>
            </li>`;
        })
        .join("");
    }

    const wa = (data.whatsapp || "").replace(/\D/g, "");
    const tg = (data.telegram || "").replace(/^@/, "");
    const waUrl = wa ? `https://wa.me/${wa}` : "#";
    const tgUrl = tg ? `https://t.me/${tg}` : "#";
    const dockWa = document.getElementById("dock-wa");
    const dockTg = document.getElementById("dock-tg");
    if (dockWa) dockWa.href = waUrl;
    if (dockTg) dockTg.href = tgUrl;

    renderGames();
  }

  async function loadConfig() {
    const res = await fetch("/api/config");
    if (!res.ok) throw new Error("Failed to load config");
    applyConfig(await res.json());
  }

  function onScroll() {
    const y = window.scrollY || 0;
    header?.classList.toggle("is-scrolled", y > 12);
    if (toTop) toTop.hidden = y < 480;
  }

  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  toTop?.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  const fbBtn = document.getElementById("fb-dock-btn");
  const fbPop = document.getElementById("fb-pop");

  fbBtn?.addEventListener("click", () => {
    const open = fbPop.hasAttribute("hidden");
    fbPop.toggleAttribute("hidden", !open);
    fbBtn.setAttribute("aria-expanded", String(open));
  });

  document.addEventListener("click", (event) => {
    if (!fbPop || !fbBtn) return;
    if (fbPop.hasAttribute("hidden")) return;
    if (fbPop.contains(event.target) || fbBtn.contains(event.target)) return;
    fbPop.hidden = true;
    fbBtn.setAttribute("aria-expanded", "false");
  });

  loadConfig().catch((err) => {
    console.error(err);
    if (grid) {
      grid.classList.remove("is-loading");
      grid.innerHTML = `<p style="grid-column:1/-1;text-align:center;color:#a8a8a8">Could not load games. Start the server with <code>npm start</code>.</p>`;
    }
  });
})();
