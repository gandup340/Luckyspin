const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function createCashflowStore(dataDir, { readJson, writeJson }) {
  const filePath = path.join(dataDir, "cashflow.json");

  function empty() {
    return { deposits: [], withdrawals: [] };
  }

  function load() {
    try {
      if (!fs.existsSync(filePath)) return empty();
      const raw = readJson(filePath) || empty();
      return {
        deposits: Array.isArray(raw.deposits) ? raw.deposits : [],
        withdrawals: Array.isArray(raw.withdrawals) ? raw.withdrawals : [],
      };
    } catch {
      return empty();
    }
  }

  function save(store) {
    writeJson(filePath, {
      deposits: store.deposits || [],
      withdrawals: store.withdrawals || [],
    });
  }

  function normalizeEntry(body = {}, existing = null) {
    const playerName = String(body.playerName ?? existing?.playerName ?? "")
      .trim()
      .slice(0, 80);
    const method = String(body.method ?? existing?.method ?? "")
      .trim()
      .slice(0, 60);
    const games = String(body.games ?? existing?.games ?? "")
      .trim()
      .slice(0, 120);
    const amount = Number(body.amount ?? existing?.amount);
    if (!playerName) return { error: "Player name is required" };
    if (!method) return { error: "Method is required" };
    if (!Number.isFinite(amount) || amount <= 0) return { error: "Enter a valid amount" };
    const amountRounded = Math.round(amount * 100) / 100;
    return {
      entry: {
        id: existing?.id || crypto.randomUUID(),
        playerName,
        method,
        amount: amountRounded,
        games,
        createdAt: existing?.createdAt || Date.now(),
        updatedAt: Date.now(),
        createdBy: existing?.createdBy || null,
        updatedBy: null,
      },
    };
  }

  function list(kind) {
    const store = load();
    const rows = kind === "withdrawals" ? store.withdrawals : store.deposits;
    return rows.slice().sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  }

  function create(kind, body, actor) {
    const store = load();
    const norm = normalizeEntry(body);
    if (norm.error) return { error: norm.error, status: 400 };
    norm.entry.createdBy = actor || null;
    norm.entry.updatedBy = actor || null;
    if (kind === "withdrawals") store.withdrawals.push(norm.entry);
    else store.deposits.push(norm.entry);
    save(store);
    return { entry: norm.entry };
  }

  function update(kind, id, body, actor) {
    const store = load();
    const listRef = kind === "withdrawals" ? store.withdrawals : store.deposits;
    const idx = listRef.findIndex((e) => e.id === id);
    if (idx < 0) return { error: "Not found", status: 404 };
    const norm = normalizeEntry(body, listRef[idx]);
    if (norm.error) return { error: norm.error, status: 400 };
    norm.entry.updatedBy = actor || null;
    listRef[idx] = norm.entry;
    save(store);
    return { entry: norm.entry };
  }

  function remove(kind, id) {
    const store = load();
    const key = kind === "withdrawals" ? "withdrawals" : "deposits";
    const before = store[key].length;
    store[key] = store[key].filter((e) => e.id !== id);
    if (store[key].length === before) return { error: "Not found", status: 404 };
    save(store);
    return { ok: true };
  }

  function dayBounds(dateStr) {
    const raw = String(dateStr || "").trim();
    let start;
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      start = new Date(`${raw}T00:00:00`);
    } else {
      const now = new Date();
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }
    if (Number.isNaN(start.getTime())) {
      const now = new Date();
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    return { start: start.getTime(), end: end.getTime(), date: start.toISOString().slice(0, 10) };
  }

  function dashboard({ date } = {}) {
    const { start, end, date: day } = dayBounds(date);
    const store = load();
    const deps = (store.deposits || []).filter((e) => {
      const t = Number(e.createdAt || 0);
      return t >= start && t < end;
    });
    const wds = (store.withdrawals || []).filter((e) => {
      const t = Number(e.createdAt || 0);
      return t >= start && t < end;
    });
    const totalIn = deps.reduce((s, e) => s + Number(e.amount || 0), 0);
    const totalOut = wds.reduce((s, e) => s + Number(e.amount || 0), 0);
    const byPlayer = new Map();
    for (const e of deps) {
      const key = String(e.playerName || "Unknown").trim() || "Unknown";
      const row = byPlayer.get(key) || { playerName: key, in: 0, out: 0, net: 0, deposits: 0, withdrawals: 0 };
      row.in += Number(e.amount || 0);
      row.deposits += 1;
      byPlayer.set(key, row);
    }
    for (const e of wds) {
      const key = String(e.playerName || "Unknown").trim() || "Unknown";
      const row = byPlayer.get(key) || { playerName: key, in: 0, out: 0, net: 0, deposits: 0, withdrawals: 0 };
      row.out += Number(e.amount || 0);
      row.withdrawals += 1;
      byPlayer.set(key, row);
    }
    const players = Array.from(byPlayer.values())
      .map((p) => ({
        ...p,
        in: Math.round(p.in * 100) / 100,
        out: Math.round(p.out * 100) / 100,
        net: Math.round((p.in - p.out) * 100) / 100,
      }))
      .sort((a, b) => a.playerName.localeCompare(b.playerName));

    return {
      date: day,
      totalIn: Math.round(totalIn * 100) / 100,
      totalOut: Math.round(totalOut * 100) / 100,
      net: Math.round((totalIn - totalOut) * 100) / 100,
      depositCount: deps.length,
      withdrawalCount: wds.length,
      players,
      deposits: deps,
      withdrawals: wds,
    };
  }

  function historyForPlayer({ name, phone, email } = {}) {
    const store = load();
    const nameKey = String(name || "")
      .trim()
      .toLowerCase();
    const matchName = (n) => nameKey && String(n || "").trim().toLowerCase() === nameKey;
    const deposits = (store.deposits || []).filter((e) => matchName(e.playerName));
    const withdrawals = (store.withdrawals || []).filter((e) => matchName(e.playerName));
    const totalIn = deposits.reduce((s, e) => s + Number(e.amount || 0), 0);
    const totalOut = withdrawals.reduce((s, e) => s + Number(e.amount || 0), 0);
    return {
      playerName: name || "",
      phone: phone || "",
      email: email || "",
      deposits: deposits.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)),
      withdrawals: withdrawals.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)),
      totalIn: Math.round(totalIn * 100) / 100,
      totalOut: Math.round(totalOut * 100) / 100,
      net: Math.round((totalIn - totalOut) * 100) / 100,
    };
  }

  return { list, create, update, remove, dashboard, historyForPlayer, load };
}

module.exports = { createCashflowStore };
