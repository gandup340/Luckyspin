require("dotenv").config();

const http = require("http");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const multer = require("multer");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const { WebSocketServer } = require("ws");
const webpush = require("web-push");

const IS_PROD = process.env.NODE_ENV === "production";
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = __dirname;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, "data"));
const CONFIG_PATH = path.join(DATA_DIR, "config.json");
const CHATS_PATH = path.join(DATA_DIR, "chats.json");
const CUSTOMERS_PATH = path.join(DATA_DIR, "customers.json");
const SPINS_PATH = path.join(DATA_DIR, "spins.json");
const PUSH_SUBS_PATH = path.join(DATA_DIR, "push-subscriptions.json");
const UPLOADS_CHAT_DIR = path.join(ROOT, "uploads", "chat");
const BCRYPT_ROUNDS = 12;
const MIN_PASSWORD_LENGTH = IS_PROD ? 10 : 6;
const DEFAULT_DEV_PASSWORD = "luckyvipsadmin";
const ALLOWED_ORIGINS = String(process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const FACEBOOK_PAGE_ACCESS_TOKEN = String(process.env.FACEBOOK_PAGE_ACCESS_TOKEN || "").trim();
// Default allows Meta "Verify and save" even if Render env is missing this key.
const FACEBOOK_VERIFY_TOKEN = String(
  process.env.FACEBOOK_VERIFY_TOKEN || "luckyvipspins2026"
).trim();
const FACEBOOK_APP_SECRET = String(process.env.FACEBOOK_APP_SECRET || "").trim();
const FACEBOOK_GRAPH_VERSION = String(process.env.FACEBOOK_GRAPH_VERSION || "v21.0").trim();
const FACEBOOK_ENABLED = Boolean(FACEBOOK_PAGE_ACCESS_TOKEN && FACEBOOK_VERIFY_TOKEN);
const VAPID_PUBLIC_KEY = String(process.env.VAPID_PUBLIC_KEY || "").trim();
const VAPID_PRIVATE_KEY = String(process.env.VAPID_PRIVATE_KEY || "").trim();
const VAPID_SUBJECT = String(process.env.VAPID_SUBJECT || "mailto:admin@luckyvipsgame.com").trim();
const PUSH_ENABLED = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
const FACEBOOK_SUBSCRIBED_FIELDS = [
  "messages",
  "messaging_postbacks",
  "message_deliveries",
  "message_reads",
];
let facebookRuntime = {
  lastWebhookAt: 0,
  lastIngestAt: 0,
  lastIngestText: "",
  pageSubscribe: null,
};
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

fs.mkdirSync(DATA_DIR, { recursive: true });

const CHAT_UPLOAD_TYPES = {
  "image/jpeg": { ext: ".jpg", kind: "image" },
  "image/png": { ext: ".png", kind: "image" },
  "image/gif": { ext: ".gif", kind: "image" },
  "image/webp": { ext: ".webp", kind: "image" },
  "video/mp4": { ext: ".mp4", kind: "video" },
  "video/webm": { ext: ".webm", kind: "video" },
  "application/pdf": { ext: ".pdf", kind: "file" },
  "application/msword": { ext: ".doc", kind: "file" },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
    ext: ".docx",
    kind: "file",
  },
  "application/vnd.ms-excel": { ext: ".xls", kind: "file" },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
    ext: ".xlsx",
    kind: "file",
  },
  "text/plain": { ext: ".txt", kind: "file" },
};

fs.mkdirSync(UPLOADS_CHAT_DIR, { recursive: true });

const chatUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_CHAT_DIR),
    filename: (_req, file, cb) => {
      const meta = CHAT_UPLOAD_TYPES[file.mimetype];
      const ext = meta?.ext || ".bin";
      cb(null, `${Date.now()}_${crypto.randomBytes(8).toString("hex")}${ext}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (CHAT_UPLOAD_TYPES[file.mimetype]) cb(null, true);
    else cb(new Error("File type not allowed. Use photo, video, PDF, Word, Excel, or text."));
  },
});

const DEFAULT_SPIN_PRIZES = [
  { id: "sp7", label: "$7", enabled: true },
  { id: "sp2", label: "$2", enabled: true },
  { id: "sp11", label: "No Prize", enabled: true },
  { id: "sp10", label: "$10", enabled: true },
  { id: "sp4", label: "$4", enabled: true },
  { id: "sp8", label: "$8", enabled: true },
  { id: "sp12", label: "No Prize", enabled: true },
  { id: "sp1", label: "$1", enabled: true },
  { id: "sp6", label: "$6", enabled: true },
  { id: "sp9", label: "$9", enabled: true },
  { id: "sp13", label: "No Prize", enabled: true },
  { id: "sp3", label: "$3", enabled: true },
  { id: "sp5", label: "$5", enabled: true },
];
const MAX_SPIN_PRIZES = 13;

const tokens = new Map(); // token -> { expiresAt, userId, username }
const sockets = new Set();

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function isBcryptHash(hash) {
  return typeof hash === "string" && /^\$2[aby]?\$/.test(hash);
}

function hashPassword(password) {
  return bcrypt.hashSync(String(password), BCRYPT_ROUNDS);
}

function verifyPassword(password, hash) {
  if (!hash) return false;
  if (isBcryptHash(hash)) return bcrypt.compareSync(String(password), hash);
  const legacy = crypto.createHash("sha256").update(String(password)).digest("hex");
  return legacy === hash;
}

function stripLegacySecrets(cfg) {
  if (cfg && Object.prototype.hasOwnProperty.call(cfg, "adminPassword")) {
    delete cfg.adminPassword;
    return true;
  }
  return false;
}

function ensureUsers(cfg) {
  let dirty = stripLegacySecrets(cfg);
  if (!Array.isArray(cfg.users) || cfg.users.length === 0) {
    const fromEnv = String(process.env.ADMIN_PASSWORD || "").trim();
    if (IS_PROD && !fromEnv) {
      console.error(
        "[security] Set ADMIN_PASSWORD in the environment before first production boot."
      );
      process.exit(1);
    }
    const password = fromEnv || DEFAULT_DEV_PASSWORD;
    if (password.length < MIN_PASSWORD_LENGTH) {
      console.error(`[security] ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      process.exit(1);
    }
    cfg.users = [
      {
        id: "u_admin",
        username: "admin",
        name: "Admin",
        passwordHash: hashPassword(password),
        role: "admin",
        createdAt: Date.now(),
      },
    ];
    dirty = true;
    if (!IS_PROD && !fromEnv) {
      console.warn(`[security] Dev admin password is default (${DEFAULT_DEV_PASSWORD}). Change it.`);
    }
  }
  if (dirty) writeJson(CONFIG_PATH, cfg);
  return cfg;
}

function isValidUuid(value) {
  return UUID_RE.test(String(value || ""));
}

function clientIp(req) {
  return String(req.ip || req.socket?.remoteAddress || "unknown");
}

function ensurePayments(cfg) {
  const raw = cfg.payments;
  if (!Array.isArray(raw)) {
    cfg.payments = [];
    writeJson(CONFIG_PATH, cfg);
    return cfg;
  }

  const needsMigrate = raw.some((p) => typeof p === "string");
  if (needsMigrate) {
    cfg.payments = raw.map((p, i) => {
      if (typeof p === "string") {
        return { id: `pay_${i + 1}`, name: p, enabled: true };
      }
      return {
        id: p.id || `pay_${i + 1}`,
        name: String(p.name || "Payment"),
        enabled: p.enabled !== false,
      };
    });
    writeJson(CONFIG_PATH, cfg);
  }
  return cfg;
}

function ensureSpin(cfg) {
  if (!Array.isArray(cfg.spinPrizes) || cfg.spinPrizes.length === 0) {
    cfg.spinPrizes = DEFAULT_SPIN_PRIZES.map((p) => ({ ...p }));
    writeJson(CONFIG_PATH, cfg);
  } else {
    cfg.spinPrizes = cfg.spinPrizes.slice(0, MAX_SPIN_PRIZES).map((p, i) => ({
      id: String(p.id || `sp${i + 1}`),
      label: String(p.label || `Prize ${i + 1}`).trim().slice(0, 24),
      enabled: p.enabled !== false,
    }));
  }
  return cfg;
}

function getConfig() {
  const cfg = readJson(CONFIG_PATH, null);
  if (!cfg) return null;
  ensureUsers(cfg);
  ensurePayments(cfg);
  ensureSpin(cfg);
  return cfg;
}

function getSpins() {
  return readJson(SPINS_PATH, { spins: [] });
}

function saveSpins(data) {
  writeJson(SPINS_PATH, data);
}

function enabledSpinPrizes(cfg) {
  return (cfg.spinPrizes || []).filter((p) => p && p.enabled !== false).slice(0, MAX_SPIN_PRIZES);
}

function getChats() {
  return readJson(CHATS_PATH, { conversations: [] });
}

function saveChats(data) {
  writeJson(CHATS_PATH, data);
}

function getCustomers() {
  return readJson(CUSTOMERS_PATH, { customers: [] });
}

function saveCustomers(data) {
  writeJson(CUSTOMERS_PATH, data);
}

function getPushSubscriptions() {
  return readJson(PUSH_SUBS_PATH, { subscriptions: [] });
}

function savePushSubscriptions(data) {
  writeJson(PUSH_SUBS_PATH, data);
}

function normalizePushSubscription(input) {
  const endpoint = String(input?.endpoint || "").trim();
  const p256dh = String(input?.keys?.p256dh || "").trim();
  const auth = String(input?.keys?.auth || "").trim();
  if (!endpoint || !/^https?:\/\//i.test(endpoint) || !p256dh || !auth) return null;
  return {
    endpoint,
    keys: { p256dh, auth },
    expirationTime: input.expirationTime ?? null,
  };
}

if (PUSH_ENABLED) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

async function sendPushToAll({ title, body, icon, url, data, tag }) {
  if (!PUSH_ENABLED) {
    return { ok: false, error: "Push notifications are not configured (missing VAPID keys)." };
  }
  const store = getPushSubscriptions();
  const list = Array.isArray(store.subscriptions) ? store.subscriptions : [];
  if (!list.length) return { ok: true, sent: 0, failed: 0, removed: 0 };

  const payload = JSON.stringify({
    title: String(title || "LUCKY VIPS GAME").slice(0, 80),
    body: String(body || "").slice(0, 180),
    icon: String(icon || "/assets/icons/icon-192.png"),
    badge: "/assets/icons/icon-192.png",
    url: String(url || "/"),
    tag: String(tag || "lucky-vips"),
    data: data && typeof data === "object" ? data : {},
  });

  let sent = 0;
  let failed = 0;
  const keep = [];

  await Promise.all(
    list.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: sub.keys,
            expirationTime: sub.expirationTime ?? null,
          },
          payload
        );
        sent += 1;
        keep.push(sub);
      } catch (err) {
        const status = Number(err?.statusCode || 0);
        if (status === 404 || status === 410) {
          failed += 1;
          return;
        }
        failed += 1;
        keep.push(sub);
      }
    })
  );

  const removed = list.length - keep.length;
  if (removed > 0) {
    store.subscriptions = keep;
    savePushSubscriptions(store);
  }
  return { ok: true, sent, failed, removed, total: list.length };
}

function normalizePhone(phone) {
  return String(phone || "").trim().slice(0, 30);
}

function phoneDigits(phone) {
  return normalizePhone(phone).replace(/\D/g, "");
}

function normalizeEmail(email) {
  return String(email || "").trim().slice(0, 120).toLowerCase();
}

const SPIN_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

function normalizeDeviceId(id) {
  const value = String(id || "").trim().slice(0, 64);
  return /^[a-zA-Z0-9_-]{8,64}$/.test(value) ? value : "";
}

function isNoPrizeLabel(label) {
  return /no\s*prize/i.test(String(label || ""));
}

function spinTimestamp(spin) {
  return Number(spin?.claimedAt || spin?.createdAt || 0) || 0;
}

function isWithinPrizeCooldown(spin, now = Date.now()) {
  if (!spin?.claimed || isNoPrizeLabel(spin.prizeLabel)) return false;
  const at = spinTimestamp(spin);
  return at > 0 && now - at < SPIN_COOLDOWN_MS;
}

function nextPrizeAvailableAt(spin) {
  return spinTimestamp(spin) + SPIN_COOLDOWN_MS;
}

function formatSpinDate(ms) {
  return new Date(ms).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** Recent claimed real prize for phone and/or device (within 7 days). */
function findClaimedCooldown({ digits = "", deviceId = "" } = {}) {
  if (!digits && !deviceId) return null;
  const data = getSpins();
  const now = Date.now();
  let match = null;
  for (const spin of data.spins || []) {
    if (!isWithinPrizeCooldown(spin, now)) continue;
    const phoneMatch =
      digits &&
      (phoneDigits(spin.phone) === digits || String(spin.phoneDigits || "") === digits);
    const deviceMatch = deviceId && String(spin.deviceId || "") === deviceId;
    if (!phoneMatch && !deviceMatch) continue;
    if (!match || spinTimestamp(spin) > spinTimestamp(match)) match = spin;
  }
  return match;
}

function cooldownResponse(spin, reason) {
  const spunAt = spinTimestamp(spin);
  const nextAvailableAt = nextPrizeAvailableAt(spin);
  const by = reason || "phone";
  return {
    used: true,
    claimed: true,
    reason: by,
    spunAt,
    nextAvailableAt,
    cooldownDays: 7,
    error: `Prize already claimed this week (${by}). Next prize after ${formatSpinDate(nextAvailableAt)}.`,
  };
}

function upsertCustomer(profile = {}) {
  const name = String(profile.name || "").trim().slice(0, 60);
  const phone = normalizePhone(profile.phone);
  const email = normalizeEmail(profile.email);
  if (!name || !phone || !email) return null;

  const data = getCustomers();
  const phoneDigits = phone.replace(/\D/g, "");
  let customer = data.customers.find(
    (c) =>
      normalizeEmail(c.email) === email ||
      (phoneDigits && String(c.phone || "").replace(/\D/g, "") === phoneDigits)
  );

  if (customer) {
    customer.name = name;
    customer.phone = phone;
    customer.email = email;
    customer.updatedAt = Date.now();
  } else {
    customer = {
      id: crypto.randomUUID(),
      name,
      phone,
      email,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    data.customers.push(customer);
  }

  saveCustomers(data);
  return customer;
}

function backfillCustomersFromChats() {
  const chats = getChats();
  for (const convo of chats.conversations || []) {
    if (convo.name && convo.phone && convo.email) {
      upsertCustomer({
        name: convo.name,
        phone: convo.phone,
        email: convo.email,
      });
    }
  }
}

function publicGames(games) {
  return (games || []).map(({ id, name, image, player }) => ({
    id,
    name,
    image,
    player,
  }));
}

function publicConfig(cfg) {
  const { adminPassword, users, payments, spinPrizes, games, ...rest } = cfg;
  return {
    ...rest,
    games: publicGames(games),
    payments: (payments || [])
      .filter((p) => p && (typeof p === "string" || p.enabled !== false))
      .map((p) => (typeof p === "string" ? p : p.name)),
    spinPrizes: enabledSpinPrizes(cfg).map((p) => ({ id: p.id, label: p.label })),
  };
}

function normalizeRole(role) {
  return String(role || "").toLowerCase() === "support" ? "support" : "admin";
}

function publicUsers(users) {
  return (users || []).map(({ id, username, name, role, createdAt }) => ({
    id,
    username,
    name,
    role: normalizeRole(role),
    createdAt,
  }));
}

function countAdmins(users) {
  return (users || []).filter((u) => normalizeRole(u.role) === "admin").length;
}

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const session = tokens.get(token);
  if (!token || !session || Date.now() > session.expiresAt) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  req.adminUser = session;
  next();
}

function requireAdmin(req, res, next) {
  if (normalizeRole(req.adminUser?.role) !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

function sanitizeAttachment(raw) {
  if (!raw || typeof raw !== "object") return null;
  const url = String(raw.url || "");
  if (!url.startsWith("/uploads/chat/")) return null;
  const filename = path.basename(url);
  if (!filename || filename !== url.slice("/uploads/chat/".length)) return null;
  if (!/^[a-zA-Z0-9._-]+$/.test(filename)) return null;
  const fullPath = path.join(UPLOADS_CHAT_DIR, filename);
  if (!fs.existsSync(fullPath)) return null;
  const kind = ["image", "video", "file"].includes(raw.kind) ? raw.kind : "file";
  return {
    kind,
    url: `/uploads/chat/${filename}`,
    name: String(raw.name || filename).replace(/[<>"]/g, "").slice(0, 120),
    mime: String(raw.mime || "application/octet-stream").slice(0, 120),
    size: Math.max(0, Number(raw.size) || 0),
  };
}

function attachmentPreview(attachment) {
  if (!attachment) return "";
  if (attachment.kind === "image") return "Photo";
  if (attachment.kind === "video") return "Video";
  return attachment.name ? `File: ${attachment.name}` : "Document";
}

function broadcast(payload, filterFn) {
  const msg = JSON.stringify(payload);
  for (const ws of sockets) {
    if (ws.readyState !== 1) continue;
    if (filterFn && !filterFn(ws)) continue;
    ws.send(msg);
  }
}

function facebookGraphUrl(pathname, params = {}) {
  const url = new URL(`https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}${pathname}`);
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== "") url.searchParams.set(key, String(value));
  }
  return url;
}

async function fetchFacebookProfileName(psid) {
  if (!FACEBOOK_PAGE_ACCESS_TOKEN || !psid) return "Facebook User";
  try {
    const url = facebookGraphUrl(`/${encodeURIComponent(psid)}`, {
      fields: "first_name,last_name,name",
      access_token: FACEBOOK_PAGE_ACCESS_TOKEN,
    });
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return "Facebook User";
    const full =
      String(data.name || "").trim() ||
      [data.first_name, data.last_name].filter(Boolean).join(" ").trim();
    return full.slice(0, 60) || "Facebook User";
  } catch {
    return "Facebook User";
  }
}

async function sendFacebookMessage(psid, text) {
  if (!FACEBOOK_PAGE_ACCESS_TOKEN || !psid || !text) {
    throw new Error("Facebook messaging is not configured");
  }
  const url = facebookGraphUrl("/me/messages", {
    access_token: FACEBOOK_PAGE_ACCESS_TOKEN,
  });
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: { id: String(psid) },
      messaging_type: "RESPONSE",
      message: { text: String(text).slice(0, 2000) },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = data?.error?.message || "Facebook send failed";
    throw new Error(err);
  }
  return data;
}

async function fetchFacebookPageIdentity() {
  if (!FACEBOOK_PAGE_ACCESS_TOKEN) return null;
  try {
    const url = facebookGraphUrl("/me", {
      fields: "id,name",
      access_token: FACEBOOK_PAGE_ACCESS_TOKEN,
    });
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        error: data?.error?.message || `Graph /me failed (${res.status})`,
      };
    }
    return {
      ok: true,
      id: String(data.id || ""),
      name: String(data.name || ""),
    };
  } catch (err) {
    return { ok: false, error: err?.message || "Graph /me failed" };
  }
}

async function subscribeFacebookPage() {
  if (!FACEBOOK_PAGE_ACCESS_TOKEN) {
    facebookRuntime.pageSubscribe = { ok: false, error: "FACEBOOK_PAGE_ACCESS_TOKEN missing" };
    return facebookRuntime.pageSubscribe;
  }
  try {
    const page = await fetchFacebookPageIdentity();
    const pageId = page?.ok && page.id ? page.id : "me";
    const url = facebookGraphUrl(`/${encodeURIComponent(pageId)}/subscribed_apps`, {
      access_token: FACEBOOK_PAGE_ACCESS_TOKEN,
      subscribed_fields: FACEBOOK_SUBSCRIBED_FIELDS.join(","),
    });
    const res = await fetch(url, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) {
      // Fall back to reading current subscriptions (UI may already be subscribed).
      const listUrl = facebookGraphUrl(`/${encodeURIComponent(pageId)}/subscribed_apps`, {
        access_token: FACEBOOK_PAGE_ACCESS_TOKEN,
      });
      const listRes = await fetch(listUrl);
      const listData = await listRes.json().catch(() => ({}));
      const apps = Array.isArray(listData?.data) ? listData.data : [];
      if (listRes.ok && apps.length) {
        facebookRuntime.pageSubscribe = {
          ok: true,
          via: "existing",
          fields: FACEBOOK_SUBSCRIBED_FIELDS,
          apps: apps.map((a) => ({ id: a.id, name: a.name })),
          at: Date.now(),
          warning: data?.error?.message || "Could not re-subscribe; using existing page app link",
        };
      } else {
        facebookRuntime.pageSubscribe = {
          ok: false,
          error: data?.error?.message || `subscribed_apps failed (${res.status})`,
          hint: "In Meta: Messenger → Webhooks → Page → subscribe messages for Lucky Vips Game. Token needs pages_messaging + pages_manage_metadata.",
        };
      }
    } else {
      facebookRuntime.pageSubscribe = {
        ok: true,
        via: "api",
        fields: FACEBOOK_SUBSCRIBED_FIELDS,
        pageId,
        at: Date.now(),
      };
    }
  } catch (err) {
    facebookRuntime.pageSubscribe = {
      ok: false,
      error: err?.message || "subscribed_apps failed",
    };
  }
  return facebookRuntime.pageSubscribe;
}

function extractFacebookMessageText(message) {
  if (!message || typeof message !== "object") return "";
  if (message.text) return String(message.text).trim().slice(0, 2000);
  if (Array.isArray(message.attachments) && message.attachments.length) {
    const first = message.attachments[0];
    const type = String(first?.type || "file");
    const src = first?.payload?.url || "";
    if (type === "image") return src ? `Photo: ${src}` : "Photo";
    if (type === "video") return src ? `Video: ${src}` : "Video";
    if (type === "audio") return "Audio message";
    if (type === "file") return src ? `File: ${src}` : "File";
    if (type === "fallback" && first?.payload?.url) return String(first.payload.url);
    return "Attachment";
  }
  if (message.sticker_id) return "Sticker";
  return "";
}

async function ensureFacebookConversation(psid) {
  const data = getChats();
  let convo = data.conversations.find(
    (c) => c.channel === "facebook" && String(c.psid) === String(psid)
  );
  if (convo) return { data, convo, created: false };

  const name = await fetchFacebookProfileName(psid);
  convo = {
    id: crypto.randomUUID(),
    channel: "facebook",
    psid: String(psid),
    name,
    phone: "",
    email: "",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    unreadAdmin: 0,
    messages: [
      {
        id: crypto.randomUUID(),
        from: "system",
        text: "Facebook Messenger conversation. Support/Admin replies here go to Messenger.",
        at: Date.now(),
      },
    ],
  };
  data.conversations.push(convo);
  saveChats(data);
  return { data, convo, created: true };
}

async function ingestFacebookMessagingEvent(event) {
  const psid = event?.sender?.id;
  const message = event?.message;
  if (!psid || !message || message.is_echo || message.is_deleted) return;

  const text = extractFacebookMessageText(message);
  if (!text) return;

  const mid = String(message.mid || "");
  const { data, convo } = await ensureFacebookConversation(psid);
  if (mid && convo.messages.some((m) => m.facebookMid === mid)) return;

  if (convo.name === "Facebook User" || !convo.name) {
    convo.name = await fetchFacebookProfileName(psid);
  }

  const entry = {
    id: crypto.randomUUID(),
    from: "customer",
    text,
    at: Number(event.timestamp) || Date.now(),
  };
  if (mid) entry.facebookMid = mid;

  convo.messages.push(entry);
  convo.updatedAt = Date.now();
  convo.unreadAdmin = (convo.unreadAdmin || 0) + 1;
  saveChats(data);
  facebookRuntime.lastIngestAt = Date.now();
  facebookRuntime.lastIngestText = text.slice(0, 80);

  broadcast(
    {
      type: "message",
      conversationId: convo.id,
      message: entry,
      channel: "facebook",
      name: convo.name,
    },
    (s) => s.role === "admin"
  );
}

function verifyFacebookSignature(req) {
  if (!FACEBOOK_APP_SECRET) return true;
  const signature = String(req.get("x-hub-signature-256") || "");
  if (!signature.startsWith("sha256=")) return false;
  const expected =
    "sha256=" +
    crypto.createHmac("sha256", FACEBOOK_APP_SECRET).update(req.rawBody || "").digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", process.env.TRUST_PROXY === "0" ? false : 1);
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (IS_PROD) res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  next();
});
app.use(
  express.json({
    limit: "512kb",
    verify: (req, _res, buf) => {
      req.rawBody = Buffer.isBuffer(buf) ? buf : Buffer.from(buf || "");
    },
  })
);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Try again later." },
});
const spinLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many spin requests. Slow down." },
});
const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many uploads. Slow down." },
});
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

app.get("/api/facebook/webhook", (req, res) => {
  const mode = String(req.query["hub.mode"] || "");
  const token = String(req.query["hub.verify_token"] || "");
  const challenge = String(req.query["hub.challenge"] || "");
  if (mode === "subscribe" && FACEBOOK_VERIFY_TOKEN && token === FACEBOOK_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  if (!FACEBOOK_VERIFY_TOKEN) {
    console.warn("Facebook webhook verify failed: FACEBOOK_VERIFY_TOKEN is not set on this host");
  } else if (mode === "subscribe") {
    console.warn("Facebook webhook verify failed: verify token mismatch");
  }
  return res.sendStatus(403);
});

app.post("/api/facebook/webhook", async (req, res) => {
  res.sendStatus(200);
  facebookRuntime.lastWebhookAt = Date.now();
  if (!FACEBOOK_ENABLED) {
    console.warn(
      "Facebook webhook event ignored: set FACEBOOK_PAGE_ACCESS_TOKEN on this host (Render Environment)"
    );
    return;
  }
  if (!verifyFacebookSignature(req)) {
    console.warn("Facebook webhook event ignored: bad X-Hub-Signature-256 (check FACEBOOK_APP_SECRET)");
    return;
  }
  try {
    const body = req.body || {};
    if (body.object !== "page") return;
    let count = 0;
    for (const entry of body.entry || []) {
      for (const event of entry.messaging || []) {
        await ingestFacebookMessagingEvent(event);
        count += 1;
      }
    }
    if (count) console.log(`Facebook webhook: ingested ${count} messaging event(s)`);
  } catch (err) {
    console.error("Facebook webhook error:", err?.message || err);
  }
});

app.get("/api/facebook/status", async (_req, res) => {
  const page = FACEBOOK_ENABLED ? await fetchFacebookPageIdentity() : null;
  res.json({
    configured: FACEBOOK_ENABLED,
    pageTokenSet: Boolean(FACEBOOK_PAGE_ACCESS_TOKEN),
    verifyTokenSet: Boolean(FACEBOOK_VERIFY_TOKEN),
    page,
    pageSubscribe: facebookRuntime.pageSubscribe,
    lastWebhookAt: facebookRuntime.lastWebhookAt || null,
    lastIngestAt: facebookRuntime.lastIngestAt || null,
    lastIngestText: facebookRuntime.lastIngestText || "",
  });
});

app.get("/api/push/vapid-public-key", (_req, res) => {
  if (!PUSH_ENABLED) {
    return res.status(503).json({ error: "Push notifications are not configured.", configured: false });
  }
  res.json({ configured: true, publicKey: VAPID_PUBLIC_KEY });
});

app.post("/api/push/subscribe", (req, res) => {
  if (!PUSH_ENABLED) {
    return res.status(503).json({ error: "Push notifications are not configured." });
  }
  const normalized = normalizePushSubscription(req.body);
  if (!normalized) return res.status(400).json({ error: "Invalid push subscription." });

  const store = getPushSubscriptions();
  if (!Array.isArray(store.subscriptions)) store.subscriptions = [];
  const now = Date.now();
  const idx = store.subscriptions.findIndex((s) => s.endpoint === normalized.endpoint);
  const entry = {
    ...normalized,
    userAgent: String(req.get("user-agent") || "").slice(0, 300),
    createdAt: idx >= 0 ? store.subscriptions[idx].createdAt || now : now,
    updatedAt: now,
  };
  if (idx >= 0) store.subscriptions[idx] = entry;
  else store.subscriptions.push(entry);
  savePushSubscriptions(store);
  res.json({ ok: true });
});

app.delete("/api/push/subscribe", (req, res) => {
  const endpoint = String(req.body?.endpoint || "").trim();
  if (!endpoint) return res.status(400).json({ error: "endpoint required" });
  const store = getPushSubscriptions();
  const before = (store.subscriptions || []).length;
  store.subscriptions = (store.subscriptions || []).filter((s) => s.endpoint !== endpoint);
  savePushSubscriptions(store);
  res.json({ ok: true, removed: before - store.subscriptions.length });
});

app.use("/api/", apiLimiter);

app.get("/api/config", (_req, res) => {
  const cfg = getConfig();
  if (!cfg) return res.status(500).json({ error: "Config missing. Run npm run seed." });
  res.json(publicConfig(cfg));
});

app.get("/api/spin", (_req, res) => {
  const cfg = getConfig();
  if (!cfg) return res.status(500).json({ error: "Config missing" });
  const prizes = enabledSpinPrizes(cfg);
  if (!prizes.length) return res.status(400).json({ error: "No spin prizes available" });
  res.json({ prizes: prizes.map((p) => ({ id: p.id, label: p.label })) });
});

app.get("/api/spin/check", spinLimiter, (req, res) => {
  const digits = phoneDigits(req.query?.phone);
  const deviceId = normalizeDeviceId(req.query?.deviceId || req.query?.mac);
  const hasPhone = digits.length >= 7;

  if (req.query?.phone && !hasPhone) {
    return res.status(400).json({ error: "Please enter a valid phone number.", used: false });
  }
  if (!hasPhone && !deviceId) {
    return res.json({ used: false, cooldownDays: 7 });
  }

  const phoneHit = hasPhone ? findClaimedCooldown({ digits }) : null;
  if (phoneHit) return res.json(cooldownResponse(phoneHit, "phone"));

  const deviceHit = deviceId ? findClaimedCooldown({ deviceId }) : null;
  if (deviceHit) return res.json(cooldownResponse(deviceHit, "device"));

  res.json({ used: false, cooldownDays: 7 });
});

app.post("/api/spin/play", spinLimiter, (req, res) => {
  const cfg = getConfig();
  if (!cfg) return res.status(500).json({ error: "Config missing" });
  const prizes = enabledSpinPrizes(cfg);
  if (!prizes.length) return res.status(400).json({ error: "No spin prizes available" });

  const deviceId = normalizeDeviceId(req.body?.deviceId || req.body?.mac);
  if (!deviceId) {
    return res.status(400).json({ error: "Missing device id. Refresh and try again." });
  }

  const deviceHit = findClaimedCooldown({ deviceId });
  if (deviceHit) {
    return res.status(409).json(cooldownResponse(deviceHit, "device"));
  }

  const now = Date.now();
  const index = Math.floor(Math.random() * prizes.length);
  const prize = prizes[index];
  const spin = {
    id: crypto.randomUUID(),
    prizeId: prize.id,
    prizeLabel: prize.label,
    index,
    createdAt: now,
    claimed: false,
    name: "",
    phone: "",
    phoneDigits: "",
    deviceId,
    email: "",
  };

  const data = getSpins();
  data.spins = data.spins || [];
  data.spins.push(spin);
  saveSpins(data);

  res.json({
    spinId: spin.id,
    index,
    prize: { id: prize.id, label: prize.label },
    noPrize: isNoPrizeLabel(prize.label),
    spunAt: now,
    cooldownDays: 7,
  });
});

app.post("/api/spin/claim", spinLimiter, (req, res) => {
  const spinId = String(req.body?.spinId || "");
  const name = String(req.body?.name || "").trim().slice(0, 60);
  const phone = normalizePhone(req.body?.phone);
  const email = normalizeEmail(req.body?.email);
  const digits = phoneDigits(phone);
  const deviceId = normalizeDeviceId(req.body?.deviceId || req.body?.mac);

  if (!spinId) return res.status(400).json({ error: "Missing spin" });
  if (!name) return res.status(400).json({ error: "Please enter your name." });
  if (digits.length < 7) {
    return res.status(400).json({ error: "Please enter a valid phone number." });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Please enter a valid email." });
  }
  if (!deviceId) {
    return res.status(400).json({ error: "Missing device id. Refresh and try again." });
  }

  const data = getSpins();
  const spin = (data.spins || []).find((s) => s.id === spinId);
  if (!spin) return res.status(404).json({ error: "Spin not found" });
  if (spin.claimed) return res.status(400).json({ error: "Prize already claimed" });
  if (isNoPrizeLabel(spin.prizeLabel)) {
    return res.status(400).json({ error: "No prize to claim on this spin." });
  }
  if (spin.deviceId && spin.deviceId !== deviceId) {
    return res.status(400).json({ error: "Device must match the one used to spin." });
  }

  const phoneHit = findClaimedCooldown({ digits });
  if (phoneHit) {
    return res.status(409).json(cooldownResponse(phoneHit, "phone"));
  }
  const deviceHit = findClaimedCooldown({ deviceId });
  if (deviceHit) {
    return res.status(409).json(cooldownResponse(deviceHit, "device"));
  }

  const claimedAt = Date.now();
  spin.claimed = true;
  spin.claimedAt = claimedAt;
  spin.nextAvailableAt = claimedAt + SPIN_COOLDOWN_MS;
  spin.name = name;
  spin.phone = phone;
  spin.phoneDigits = digits;
  spin.deviceId = deviceId;
  spin.email = email;
  saveSpins(data);

  const customer = upsertCustomer({ name, phone, email });
  res.json({
    ok: true,
    prize: { id: spin.prizeId, label: spin.prizeLabel },
    customerId: customer?.id || null,
    claimedAt,
    nextAvailableAt: spin.nextAvailableAt,
    cooldownDays: 7,
  });
});

app.post("/api/admin/login", loginLimiter, (req, res) => {
  const cfg = getConfig();
  if (!cfg) return res.status(401).json({ error: "Wrong username or password" });

  const username = String(req.body?.username || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  const user = (cfg.users || []).find((u) => u.username.toLowerCase() === username);

  if (!user || !verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: "Wrong username or password" });
  }

  let dirty = stripLegacySecrets(cfg);
  if (!isBcryptHash(user.passwordHash)) {
    user.passwordHash = hashPassword(password);
    dirty = true;
  }
  if (dirty) writeJson(CONFIG_PATH, cfg);

  const role = normalizeRole(user.role);
  const token = crypto.randomBytes(32).toString("hex");
  tokens.set(token, {
    expiresAt: Date.now() + 1000 * 60 * 60 * 12,
    userId: user.id,
    username: user.username,
    name: user.name,
    role,
  });
  res.json({
    token,
    user: { id: user.id, username: user.username, name: user.name, role },
  });
});

app.post("/api/admin/logout", auth, (req, res) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (token) tokens.delete(token);
  res.json({ ok: true });
});

app.get("/api/admin/users", auth, requireAdmin, (_req, res) => {
  const cfg = getConfig();
  res.json({ users: publicUsers(cfg.users) });
});

app.post("/api/admin/users", auth, requireAdmin, (req, res) => {
  const cfg = getConfig();
  const username = String(req.body?.username || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "");
  const name = String(req.body?.name || "").trim().slice(0, 60) || username;
  const password = String(req.body?.password || "").trim();
  const role = normalizeRole(req.body?.role);

  if (username.length < 3) {
    return res.status(400).json({ error: "Username must be at least 3 characters" });
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({
      error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    });
  }
  if ((cfg.users || []).some((u) => u.username.toLowerCase() === username)) {
    return res.status(400).json({ error: "Username already exists" });
  }

  const user = {
    id: crypto.randomUUID(),
    username,
    name,
    passwordHash: hashPassword(password),
    role,
    createdAt: Date.now(),
  };
  cfg.users.push(user);
  writeJson(CONFIG_PATH, cfg);
  res.json({ ok: true, user: publicUsers([user])[0] });
});

app.put("/api/admin/users/:id", auth, requireAdmin, (req, res) => {
  const cfg = getConfig();
  const user = (cfg.users || []).find((u) => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: "User not found" });

  if (req.body?.name != null) {
    user.name = String(req.body.name).trim().slice(0, 60) || user.name;
  }
  if (req.body?.role != null) {
    const nextRole = normalizeRole(req.body.role);
    if (
      normalizeRole(user.role) === "admin" &&
      nextRole === "support" &&
      countAdmins(cfg.users) <= 1
    ) {
      return res.status(400).json({ error: "Cannot demote the last admin" });
    }
    user.role = nextRole;
  }
  if (req.body?.password) {
    const password = String(req.body.password).trim();
    if (password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({
        error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      });
    }
    user.passwordHash = hashPassword(password);
  }
  stripLegacySecrets(cfg);
  writeJson(CONFIG_PATH, cfg);
  res.json({ ok: true, user: publicUsers([user])[0] });
});

app.delete("/api/admin/users/:id", auth, requireAdmin, (req, res) => {
  const cfg = getConfig();
  const target = (cfg.users || []).find((u) => u.id === req.params.id);
  if (!target) return res.status(404).json({ error: "User not found" });
  if ((cfg.users || []).length <= 1) {
    return res.status(400).json({ error: "Cannot delete the last user" });
  }
  if (req.adminUser?.userId === req.params.id) {
    return res.status(400).json({ error: "Cannot delete your own account while logged in" });
  }
  if (normalizeRole(target.role) === "admin" && countAdmins(cfg.users) <= 1) {
    return res.status(400).json({ error: "Cannot delete the last admin" });
  }
  cfg.users = cfg.users.filter((u) => u.id !== req.params.id);
  writeJson(CONFIG_PATH, cfg);
  res.json({ ok: true });
});

app.get("/api/admin/customers", auth, (_req, res) => {
  const data = getCustomers();
  const customers = [...(data.customers || [])].sort(
    (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)
  );
  res.json({ customers });
});

app.post("/api/admin/customers", auth, (req, res) => {
  const name = String(req.body?.name || "").trim().slice(0, 60);
  const phone = normalizePhone(req.body?.phone);
  const email = normalizeEmail(req.body?.email);
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const phoneOk = phone.replace(/\D/g, "").length >= 7;

  if (!name || !phoneOk || !emailOk) {
    return res.status(400).json({ error: "Valid name, phone, and email are required" });
  }

  const customer = upsertCustomer({ name, phone, email });
  res.json({ ok: true, customer });
});

app.put("/api/admin/customers/:id", auth, (req, res) => {
  const data = getCustomers();
  const customer = data.customers.find((c) => c.id === req.params.id);
  if (!customer) return res.status(404).json({ error: "Customer not found" });

  const name = String(req.body?.name ?? customer.name).trim().slice(0, 60);
  const phone = normalizePhone(req.body?.phone ?? customer.phone);
  const email = normalizeEmail(req.body?.email ?? customer.email);
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const phoneOk = phone.replace(/\D/g, "").length >= 7;

  if (!name || !phoneOk || !emailOk) {
    return res.status(400).json({ error: "Valid name, phone, and email are required" });
  }

  customer.name = name;
  customer.phone = phone;
  customer.email = email;
  customer.updatedAt = Date.now();
  saveCustomers(data);
  res.json({ ok: true, customer });
});

app.delete("/api/admin/customers/:id", auth, (req, res) => {
  const data = getCustomers();
  const before = data.customers.length;
  data.customers = data.customers.filter((c) => c.id !== req.params.id);
  if (data.customers.length === before) {
    return res.status(404).json({ error: "Customer not found" });
  }
  saveCustomers(data);
  res.json({ ok: true });
});

app.get("/api/admin/config", auth, requireAdmin, (_req, res) => {
  const cfg = getConfig();
  const pub = publicConfig(cfg);
  res.json({
    ...pub,
    games: cfg.games || [],
    paymentsAdmin: cfg.payments || [],
    facebookMessengerConfigured: FACEBOOK_ENABLED,
    pushConfigured: PUSH_ENABLED,
    pushSubscriberCount: (getPushSubscriptions().subscriptions || []).length,
  });
});

app.get("/api/admin/push", auth, requireAdmin, (_req, res) => {
  const store = getPushSubscriptions();
  res.json({
    configured: PUSH_ENABLED,
    count: (store.subscriptions || []).length,
  });
});

app.post("/api/admin/push/send", auth, requireAdmin, async (req, res) => {
  const title = String(req.body?.title || "").trim();
  const body = String(req.body?.body || "").trim();
  const icon = String(req.body?.icon || "/assets/icons/icon-192.png").trim();
  const url = String(req.body?.url || "/").trim() || "/";
  const tag = String(req.body?.tag || "lucky-vips").trim();
  const data = req.body?.data && typeof req.body.data === "object" ? req.body.data : {};
  if (!title || !body) {
    return res.status(400).json({ error: "title and body are required" });
  }
  try {
    const result = await sendPushToAll({ title, body, icon, url, data, tag });
    if (!result.ok) return res.status(503).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to send notifications" });
  }
});

app.put("/api/admin/games", auth, requireAdmin, (req, res) => {
  const cfg = getConfig();
  if (!Array.isArray(req.body?.games)) {
    return res.status(400).json({ error: "games array required" });
  }
  cfg.games = req.body.games;
  writeJson(CONFIG_PATH, cfg);
  broadcast({ type: "config_updated" });
  res.json({ ok: true, games: cfg.games });
});

app.put("/api/admin/facebook", auth, requireAdmin, (req, res) => {
  const cfg = getConfig();
  if (!Array.isArray(req.body?.facebook)) {
    return res.status(400).json({ error: "facebook array required" });
  }
  cfg.facebook = req.body.facebook;
  writeJson(CONFIG_PATH, cfg);
  broadcast({ type: "config_updated" });
  res.json({ ok: true, facebook: cfg.facebook });
});

app.put("/api/admin/contact", auth, requireAdmin, (req, res) => {
  const cfg = getConfig();
  if (req.body.whatsapp != null) cfg.whatsapp = String(req.body.whatsapp).replace(/\D/g, "");
  if (req.body.telegram != null) cfg.telegram = String(req.body.telegram).replace(/^@/, "");
  if (req.body.messenger != null) {
    cfg.messenger = String(req.body.messenger)
      .trim()
      .replace(/^@/, "")
      .slice(0, 200);
  }
  writeJson(CONFIG_PATH, cfg);
  broadcast({ type: "config_updated" });
  res.json({
    ok: true,
    whatsapp: cfg.whatsapp,
    telegram: cfg.telegram,
    messenger: cfg.messenger || "",
  });
});

app.get("/api/admin/winners", auth, (_req, res) => {
  const cfg = getConfig();
  res.json({ winners: cfg.winners || [] });
});

app.put("/api/admin/winners", auth, (req, res) => {
  const cfg = getConfig();
  if (!Array.isArray(req.body?.winners)) {
    return res.status(400).json({ error: "winners array required" });
  }

  cfg.winners = req.body.winners.slice(0, 3).map((w, i) => {
    let amount = String(w.amount || "").trim();
    if (amount && !amount.startsWith("$")) amount = `$${amount.replace(/^\$/, "")}`;
    return {
      rank: i + 1,
      name: String(w.name || "").trim().slice(0, 60) || `Player ${i + 1}`,
      amount: amount || "$0.00",
    };
  });

  while (cfg.winners.length < 3) {
    const i = cfg.winners.length;
    cfg.winners.push({ rank: i + 1, name: `Player ${i + 1}`, amount: "$0.00" });
  }

  writeJson(CONFIG_PATH, cfg);
  broadcast({ type: "config_updated" });
  res.json({ ok: true, winners: cfg.winners });
});

app.get("/api/admin/spin", auth, (_req, res) => {
  const cfg = getConfig();
  res.json({ prizes: cfg.spinPrizes || [] });
});

app.put("/api/admin/spin", auth, (req, res) => {
  const cfg = getConfig();
  if (!Array.isArray(req.body?.prizes)) {
    return res.status(400).json({ error: "prizes array required" });
  }
  cfg.spinPrizes = req.body.prizes.slice(0, MAX_SPIN_PRIZES).map((p, i) => ({
    id: String(p.id || crypto.randomUUID()),
    label: String(p.label || "").trim().slice(0, 24) || `Prize ${i + 1}`,
    enabled: p.enabled !== false,
  }));
  writeJson(CONFIG_PATH, cfg);
  broadcast({ type: "config_updated" });
  res.json({ ok: true, prizes: cfg.spinPrizes });
});

app.get("/api/admin/spins", auth, (_req, res) => {
  const data = getSpins();
  const spins = [...(data.spins || [])]
    .filter((s) => s.claimed)
    .sort((a, b) => (b.claimedAt || 0) - (a.claimedAt || 0));
  res.json({ spins });
});

app.get("/api/admin/payments", auth, requireAdmin, (_req, res) => {
  const cfg = getConfig();
  res.json({ payments: cfg.payments || [] });
});

app.put("/api/admin/payments", auth, requireAdmin, (req, res) => {
  const cfg = getConfig();
  if (!Array.isArray(req.body?.payments)) {
    return res.status(400).json({ error: "payments array required" });
  }
  cfg.payments = req.body.payments.map((p, i) => ({
    id: String(p.id || crypto.randomUUID()),
    name: String(p.name || "").trim().slice(0, 40) || `Payment ${i + 1}`,
    enabled: p.enabled !== false,
  }));
  writeJson(CONFIG_PATH, cfg);
  broadcast({ type: "config_updated" });
  res.json({ ok: true, payments: cfg.payments });
});

app.post("/api/admin/payments", auth, requireAdmin, (req, res) => {
  const cfg = getConfig();
  const name = String(req.body?.name || "").trim().slice(0, 40);
  if (!name) return res.status(400).json({ error: "Payment name is required" });

  const payment = {
    id: crypto.randomUUID(),
    name,
    enabled: req.body?.enabled !== false,
  };
  cfg.payments = cfg.payments || [];
  cfg.payments.push(payment);
  writeJson(CONFIG_PATH, cfg);
  broadcast({ type: "config_updated" });
  res.json({ ok: true, payment });
});

app.put("/api/admin/payments/:id", auth, requireAdmin, (req, res) => {
  const cfg = getConfig();
  const payment = (cfg.payments || []).find((p) => p.id === req.params.id);
  if (!payment) return res.status(404).json({ error: "Payment not found" });

  if (req.body?.name != null) {
    const name = String(req.body.name).trim().slice(0, 40);
    if (!name) return res.status(400).json({ error: "Payment name is required" });
    payment.name = name;
  }
  if (req.body?.enabled != null) {
    payment.enabled = !!req.body.enabled;
  }
  writeJson(CONFIG_PATH, cfg);
  broadcast({ type: "config_updated" });
  res.json({ ok: true, payment });
});

app.delete("/api/admin/payments/:id", auth, requireAdmin, (req, res) => {
  const cfg = getConfig();
  const before = (cfg.payments || []).length;
  cfg.payments = (cfg.payments || []).filter((p) => p.id !== req.params.id);
  if (cfg.payments.length === before) {
    return res.status(404).json({ error: "Payment not found" });
  }
  writeJson(CONFIG_PATH, cfg);
  broadcast({ type: "config_updated" });
  res.json({ ok: true });
});

app.post("/api/chat/upload", uploadLimiter, (req, res) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const session = tokens.get(token);
  const isStaff = !!(session && Date.now() <= session.expiresAt);

  chatUpload.single("file")(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || "Upload failed" });
    }
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const cleanup = () => {
      try {
        fs.unlinkSync(req.file.path);
      } catch {
        /* ignore */
      }
    };

    if (!isStaff) {
      const conversationId = String(
        req.body?.conversationId || req.headers["x-conversation-id"] || ""
      );
      if (!isValidUuid(conversationId)) {
        cleanup();
        return res.status(401).json({ error: "Start chat before uploading files." });
      }
      const data = getChats();
      const convo = (data.conversations || []).find((c) => c.id === conversationId);
      if (!convo) {
        cleanup();
        return res.status(401).json({ error: "Start chat before uploading files." });
      }
    }

    const meta = CHAT_UPLOAD_TYPES[req.file.mimetype];
    if (!meta) {
      cleanup();
      return res.status(400).json({ error: "File type not allowed" });
    }

    res.json({
      attachment: {
        kind: meta.kind,
        url: `/uploads/chat/${req.file.filename}`,
        name: String(req.file.originalname || "file").slice(0, 120),
        mime: req.file.mimetype,
        size: req.file.size,
      },
    });
  });
});

app.put("/api/admin/password", auth, (req, res) => {
  const cfg = getConfig();
  const next = String(req.body?.password || "").trim();
  if (next.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({
      error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    });
  }
  const user = (cfg.users || []).find((u) => u.id === req.adminUser.userId);
  if (!user) return res.status(404).json({ error: "User not found" });
  user.passwordHash = hashPassword(next);
  stripLegacySecrets(cfg);
  writeJson(CONFIG_PATH, cfg);
  res.json({ ok: true });
});

app.get("/api/admin/chats", auth, (_req, res) => {
  const data = getChats();
  const list = data.conversations
    .map((c) => ({
      id: c.id,
      name: c.name || "Visitor",
      phone: c.phone || "",
      email: c.email || "",
      channel: c.channel === "facebook" ? "facebook" : "web",
      updatedAt: c.updatedAt,
      unreadAdmin: c.unreadAdmin || 0,
      lastMessage: c.messages?.[c.messages.length - 1] || null,
      online: [...sockets].some((s) => s.role === "customer" && s.conversationId === c.id),
    }))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  res.json({ conversations: list });
});

app.get("/api/admin/chats/:id", auth, (req, res) => {
  const data = getChats();
  const convo = data.conversations.find((c) => c.id === req.params.id);
  if (!convo) return res.status(404).json({ error: "Not found" });
  convo.unreadAdmin = 0;
  saveChats(data);
  res.json(convo);
});

app.delete("/api/admin/chats/:id", auth, (req, res) => {
  const data = getChats();
  data.conversations = data.conversations.filter((c) => c.id !== req.params.id);
  saveChats(data);
  broadcast({ type: "chat_deleted", conversationId: req.params.id });
  res.json({ ok: true });
});

app.use((req, res, next) => {
  const p = req.path.toLowerCase();
  if (
    p === "/server.js" ||
    p === "/seed.js" ||
    p === "/games.js" ||
    p === "/package.json" ||
    p === "/package-lock.json" ||
    p === "/.env" ||
    p === "/.env.example" ||
    p === "/.gitignore" ||
    p.startsWith("/.") ||
    p.startsWith("/data") ||
    p.startsWith("/node_modules") ||
    p.startsWith("/scripts") ||
    (p.startsWith("/uploads") && !p.startsWith("/uploads/chat/"))
  ) {
    return res.status(404).end();
  }
  next();
});

app.use(
  "/uploads/chat",
  express.static(UPLOADS_CHAT_DIR, {
    index: false,
    fallthrough: false,
    maxAge: "7d",
  })
);
app.use(
  "/uploads/chat",
  express.static(UPLOADS_CHAT_DIR, { fallthrough: false, index: false, maxAge: "1d" })
);
app.get("/sw.js", (_req, res) => {
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Service-Worker-Allowed", "/");
  res.type("application/javascript");
  res.sendFile(path.join(ROOT, "sw.js"));
});
app.get("/manifest.webmanifest", (_req, res) => {
  res.setHeader("Cache-Control", "no-cache");
  res.type("application/manifest+json");
  res.sendFile(path.join(ROOT, "manifest.webmanifest"));
});
app.use("/admin", express.static(path.join(ROOT, "admin")));
app.use("/support", express.static(path.join(ROOT, "admin")));
app.use(express.static(ROOT, { index: "index.html" }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

function ensureConversation(id, profile = {}) {
  const data = getChats();
  let convo = data.conversations.find((c) => c.id === id);
  const name = String(profile.name || "Visitor").slice(0, 60);
  const phone = String(profile.phone || "").slice(0, 30);
  const email = String(profile.email || "").slice(0, 120).toLowerCase();

  if (!convo) {
    convo = {
      id,
      name,
      phone,
      email,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      unreadAdmin: 0,
      messages: [
        {
          id: crypto.randomUUID(),
          from: "system",
          text: "Welcome to LUCKY VIPS GAME Support. An agent will reply here on the site.",
          at: Date.now(),
        },
      ],
    };
    data.conversations.push(convo);
    saveChats(data);
  } else {
    if (name) convo.name = name;
    if (phone) convo.phone = phone;
    if (email) convo.email = email;
    saveChats(data);
  }
  return { data, convo };
}

wss.on("connection", (ws, req) => {
  if (ALLOWED_ORIGINS.length) {
    const origin = String(req.headers.origin || "");
    if (origin && !ALLOWED_ORIGINS.includes(origin)) {
      ws.close(1008, "Origin not allowed");
      return;
    }
  }

  sockets.add(ws);
  ws.role = null;
  ws.conversationId = null;

  ws.on("message", async (raw) => {
    if (String(raw).length > 20000) return;
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }

    if (msg.type === "join_customer") {
      const name = String(msg.name || "").trim().slice(0, 60);
      const phone = String(msg.phone || "").trim().slice(0, 30);
      const email = String(msg.email || "").trim().slice(0, 120).toLowerCase();
      const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      const phoneDigitsValue = phone.replace(/\D/g, "");
      const phoneOk = phoneDigitsValue.length >= 7;

      if (!name || !phoneOk || !emailOk) {
        ws.send(
          JSON.stringify({
            type: "error",
            error: "Name, valid phone, and email are required before chat.",
          })
        );
        return;
      }

      let id = msg.conversationId;
      if (id != null && id !== "") {
        if (!isValidUuid(id)) {
          ws.send(JSON.stringify({ type: "error", error: "Invalid chat session." }));
          return;
        }
        const existing = getChats().conversations.find((c) => c.id === id);
        if (existing) {
          const samePhone =
            String(existing.phone || "").replace(/\D/g, "") === phoneDigitsValue;
          const sameEmail = normalizeEmail(existing.email) === email;
          if (!samePhone || !sameEmail) {
            ws.send(
              JSON.stringify({
                type: "error",
                error: "Chat session does not match your contact details.",
              })
            );
            return;
          }
        } else {
          id = crypto.randomUUID();
        }
      } else {
        id = crypto.randomUUID();
      }

      const customer = upsertCustomer({ name, phone, email });
      const { data, convo } = ensureConversation(id, { name, phone, email });
      if (customer) convo.customerId = customer.id;
      saveChats(data);
      ws.role = "customer";
      ws.conversationId = id;
      ws.send(
        JSON.stringify({
          type: "joined",
          role: "customer",
          conversationId: id,
          profile: { name: convo.name, phone: convo.phone, email: convo.email },
          messages: convo.messages,
        })
      );
      broadcast(
        {
          type: "presence",
          conversationId: id,
          online: true,
          name: convo.name,
          phone: convo.phone,
          email: convo.email,
        },
        (s) => s.role === "admin"
      );
      return;
    }

    if (msg.type === "join_admin") {
      const session = tokens.get(msg.token);
      if (!msg.token || !session || Date.now() > session.expiresAt) {
        ws.send(JSON.stringify({ type: "error", error: "Unauthorized" }));
        return;
      }
      ws.role = "admin";
      ws.send(JSON.stringify({ type: "joined", role: "admin" }));
      return;
    }

    if (msg.type === "message") {
      const text = String(msg.text || "").trim().slice(0, 2000);
      const attachment = sanitizeAttachment(msg.attachment);
      if (!text && !attachment) return;

      if (ws.role === "customer") {
        const conversationId = ws.conversationId;
        if (!conversationId) return;
        const data = getChats();
        const convo = data.conversations.find((c) => c.id === conversationId);
        if (!convo) return;
        if (!convo.name || !convo.phone || !convo.email) {
          ws.send(
            JSON.stringify({
              type: "error",
              error: "Complete your contact details before messaging.",
            })
          );
          return;
        }
        const entry = {
          id: crypto.randomUUID(),
          from: "customer",
          text: text || attachmentPreview(attachment),
          at: Date.now(),
        };
        if (attachment) entry.attachment = attachment;
        convo.messages.push(entry);
        convo.updatedAt = Date.now();
        convo.unreadAdmin = (convo.unreadAdmin || 0) + 1;
        saveChats(data);

        broadcast(
          { type: "message", conversationId, message: entry },
          (s) =>
            (s.role === "customer" && s.conversationId === conversationId) ||
            s.role === "admin"
        );
        return;
      }

      if (ws.role === "admin") {
        const conversationId = msg.conversationId;
        if (!conversationId) return;
        const data = getChats();
        const convo = data.conversations.find((c) => c.id === conversationId);
        if (!convo) return;
        const entry = {
          id: crypto.randomUUID(),
          from: "admin",
          text: text || attachmentPreview(attachment),
          at: Date.now(),
        };
        if (attachment) entry.attachment = attachment;

        if (convo.channel === "facebook") {
          if (!convo.psid || !FACEBOOK_ENABLED) {
            ws.send(
              JSON.stringify({
                type: "error",
                error: "Facebook Messenger is not configured for this chat.",
              })
            );
            return;
          }
          if (attachment && !text) {
            ws.send(
              JSON.stringify({
                type: "error",
                error: "Messenger replies support text only right now. Add a text message.",
              })
            );
            return;
          }
          try {
            await sendFacebookMessage(convo.psid, entry.text);
          } catch (err) {
            ws.send(
              JSON.stringify({
                type: "error",
                error: err.message || "Could not send Messenger reply.",
              })
            );
            return;
          }
        }

        convo.messages.push(entry);
        convo.updatedAt = Date.now();
        saveChats(data);

        broadcast(
          { type: "message", conversationId, message: entry },
          (s) =>
            (s.role === "customer" && s.conversationId === conversationId) ||
            s.role === "admin"
        );
      }
    }
  });

  ws.on("close", () => {
    if (ws.role === "customer" && ws.conversationId) {
      broadcast(
        { type: "presence", conversationId: ws.conversationId, online: false },
        (s) => s.role === "admin"
      );
    }
    sockets.delete(ws);
  });
});

if (!fs.existsSync(CONFIG_PATH)) {
  require("./seed.js");
}

if (!fs.existsSync(CUSTOMERS_PATH)) {
  writeJson(CUSTOMERS_PATH, { customers: [] });
}
backfillCustomersFromChats();

server.listen(PORT, HOST, () => {
  const displayHost = HOST === "0.0.0.0" ? "localhost" : HOST;
  console.log(`LUCKY VIPS GAME running at http://${displayHost}:${PORT}`);
  console.log(`Admin panel:      http://${displayHost}:${PORT}/admin`);
  console.log(`Support panel:    http://${displayHost}:${PORT}/support`);
  console.log(
    `Messenger webhook: ${FACEBOOK_ENABLED ? "configured" : "disabled (set FACEBOOK_* in .env)"}`
  );
  console.log(
    `Web Push:          ${PUSH_ENABLED ? "configured" : "disabled (set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY)"}`
  );
  if (!IS_PROD) {
    console.log(`Mode:             development (set NODE_ENV=production for live hosting)`);
  } else {
    console.log(`Mode:             production`);
  }
  if (FACEBOOK_ENABLED) {
    subscribeFacebookPage()
      .then((result) => {
        if (result?.ok) console.log("Facebook page subscribed for Messenger webhooks");
        else console.warn("Facebook page subscribe failed:", result?.error || "unknown error");
      })
      .catch((err) => console.warn("Facebook page subscribe failed:", err?.message || err));
  }
});
