const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, "data"));
const AUDIT_PATH = path.join(DATA_DIR, "audit-log.json");
const MAX_ENTRIES = 5000;

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readStore() {
  try {
    ensureDir();
    if (!fs.existsSync(AUDIT_PATH)) return { entries: [] };
    const raw = JSON.parse(fs.readFileSync(AUDIT_PATH, "utf8"));
    return { entries: Array.isArray(raw.entries) ? raw.entries : [] };
  } catch {
    return { entries: [] };
  }
}

function writeStore(store) {
  ensureDir();
  const tmp = `${AUDIT_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, AUDIT_PATH);
}

/**
 * Append a security/ops audit event.
 * Categories: auth | wallet | admin | chat | security
 */
function auditLog({
  category = "security",
  action,
  actor = null,
  actorRole = null,
  target = null,
  ip = null,
  success = true,
  meta = {},
  message = "",
} = {}) {
  try {
    const store = readStore();
    store.entries.push({
      id: crypto.randomUUID(),
      at: Date.now(),
      category: String(category).slice(0, 40),
      action: String(action || "unknown").slice(0, 80),
      actor: actor ? String(actor).slice(0, 120) : null,
      actorRole: actorRole ? String(actorRole).slice(0, 40) : null,
      target: target ? String(target).slice(0, 160) : null,
      ip: ip ? String(ip).slice(0, 80) : null,
      success: Boolean(success),
      message: String(message || "").slice(0, 300),
      meta: meta && typeof meta === "object" ? meta : {},
    });
    if (store.entries.length > MAX_ENTRIES) {
      store.entries = store.entries.slice(-MAX_ENTRIES);
    }
    writeStore(store);
  } catch (err) {
    console.warn("[audit]", err?.message || err);
  }
}

function clientIp(req) {
  if (!req) return null;
  const xf = String(req.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  return xf || req.ip || req.socket?.remoteAddress || null;
}

function listAudits({ limit = 100, category = null } = {}) {
  const store = readStore();
  let rows = store.entries.slice().reverse();
  if (category) {
    const cat = String(category).toLowerCase();
    rows = rows.filter((e) => String(e.category).toLowerCase() === cat);
  }
  return rows.slice(0, Math.min(500, Math.max(1, Number(limit) || 100)));
}

module.exports = { auditLog, clientIp, listAudits };
