const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { fingerprintRequest } = require("./juwa-parser");

function createJuwaStore({ dataDir, writeJson, readJson }) {
  const STORE_PATH = path.join(dataDir, "juwa-ops.json");

  function load() {
    const data = readJson(STORE_PATH, { requests: [], audits: [] });
    if (!Array.isArray(data.requests)) data.requests = [];
    if (!Array.isArray(data.audits)) data.audits = [];
    return data;
  }

  function save(data) {
    writeJson(STORE_PATH, data);
  }

  function publicRequest(row) {
    if (!row) return null;
    return {
      id: row.id,
      conversationId: row.conversationId,
      messageId: row.messageId,
      messageText: row.messageText,
      username: row.username,
      amount: row.amount,
      usernames: row.usernames || [],
      status: row.status,
      missing: row.missing || [],
      reason: row.reason || "",
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      confirmedBy: row.confirmedBy || null,
      confirmedAt: row.confirmedAt || null,
      playerRepliedAt: row.playerRepliedAt || null,
      error: row.error || "",
      result: row.result || null,
    };
  }

  function findByFingerprint(fp) {
    const data = load();
    return data.requests.find((r) => r.fingerprint === fp) || null;
  }

  function createRequest(input) {
    const fingerprint = fingerprintRequest(input);
    const existing = findByFingerprint(fingerprint);
    if (existing) {
      if (existing.status === "success") {
        return { ok: false, error: "This fund request was already completed (idempotent block).", request: publicRequest(existing) };
      }
      if (["pending_review", "awaiting_captcha", "running", "confirmed"].includes(existing.status)) {
        return { ok: true, request: publicRequest(existing), reused: true };
      }
    }

    const data = load();
    const now = Date.now();
    const row = {
      id: crypto.randomUUID(),
      fingerprint,
      conversationId: String(input.conversationId || ""),
      messageId: String(input.messageId || ""),
      messageText: String(input.messageText || "").slice(0, 2000),
      username: input.username ? String(input.username) : null,
      amount: input.amount ?? null,
      usernames: Array.isArray(input.usernames) ? input.usernames.map(String) : [],
      missing: Array.isArray(input.missing) ? input.missing : [],
      reason: String(input.reason || ""),
      status: input.ok ? "pending_review" : "needs_info",
      createdAt: now,
      updatedAt: now,
      confirmedBy: null,
      confirmedAt: null,
      error: "",
      result: null,
      idempotencyKey: fingerprint,
    };
    data.requests.unshift(row);
    data.requests = data.requests.slice(0, 500);
    save(data);
    return { ok: true, request: publicRequest(row), reused: false };
  }

  function getRequest(id) {
    const data = load();
    return publicRequest(data.requests.find((r) => r.id === id));
  }

  function listRequests({ limit = 50 } = {}) {
    const data = load();
    return data.requests.slice(0, limit).map(publicRequest);
  }

  function updateRequest(id, patch) {
    const data = load();
    const idx = data.requests.findIndex((r) => r.id === id);
    if (idx < 0) return null;
    data.requests[idx] = {
      ...data.requests[idx],
      ...patch,
      updatedAt: Date.now(),
    };
    save(data);
    return publicRequest(data.requests[idx]);
  }

  function addAudit(entry) {
    const data = load();
    const row = {
      id: crypto.randomUUID(),
      at: Date.now(),
      ...entry,
    };
    data.audits.unshift(row);
    data.audits = data.audits.slice(0, 1000);
    save(data);
    return row;
  }

  function listAudits({ limit = 100 } = {}) {
    return load().audits.slice(0, limit);
  }

  return {
    createRequest,
    getRequest,
    listRequests,
    updateRequest,
    addAudit,
    listAudits,
    publicRequest,
  };
}

module.exports = { createJuwaStore };
