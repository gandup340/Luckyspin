/**
 * Pure chat → Juwa fund-request detection (no I/O).
 * Never guesses: both username and amount must be clearly present
 * (or a single strong game-id + amount after filtering noise words).
 */

const STOP_WORDS = new Set(
  [
    "add",
    "please",
    "need",
    "fund",
    "funds",
    "balance",
    "deposit",
    "money",
    "dollar",
    "dollars",
    "bucks",
    "chat",
    "user",
    "username",
    "account",
    "juwa",
    "for",
    "the",
    "and",
    "to",
    "my",
    "me",
    "on",
    "in",
    "of",
    "put",
    "load",
    "top",
    "up",
    "credit",
    "amount",
    "id",
    "uid",
    "can",
    "you",
    "pls",
    "plz",
    "thanks",
    "thank",
    "hello",
    "hi",
  ].map((w) => w.toLowerCase())
);

function normalizeText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseAmount(raw) {
  const cleaned = String(raw || "")
    .replace(/[$,]/g, "")
    .trim();
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n <= 0 || n > 100000) return null;
  return Math.round(n * 100) / 100;
}

function isGameStyleId(token) {
  const u = String(token || "");
  if (u.length < 3 || u.length > 32) return false;
  if (STOP_WORDS.has(u.toLowerCase())) return false;
  // Prefer ids that mix letters + digits (typical Juwa usernames like vvkj1555)
  return /[a-zA-Z]/.test(u) && /\d/.test(u) && /^[a-zA-Z][a-zA-Z0-9_]*$/.test(u);
}

function isPlausibleUsername(token) {
  const u = String(token || "");
  if (u.length < 3 || u.length > 32) return false;
  if (STOP_WORDS.has(u.toLowerCase())) return false;
  if (!/^[a-zA-Z0-9_]+$/.test(u)) return false;
  // Reject pure numbers (those are amounts)
  if (/^\d+(\.\d+)?$/.test(u)) return false;
  return true;
}

function extractUsernames(text) {
  const t = normalizeText(text);
  const found = new Set();

  const labeled =
    t.matchAll(
      /\b(?:juwa\s*(?:user(?:name)?|id)|user(?:name)?|id|uid|account)\s*[:=#-]?\s*([a-zA-Z][a-zA-Z0-9_]{2,31})\b/gi
    ) || [];
  for (const m of labeled) {
    if (m[1] && isPlausibleUsername(m[1])) found.add(m[1]);
  }

  // "add to juwa USER" / "juwa USER ..."
  const juwaNear = t.matchAll(/\bjuwa\b[^a-zA-Z0-9_]{0,16}([a-zA-Z][a-zA-Z0-9_]{2,31})\b/gi) || [];
  for (const m of juwaNear) {
    if (m[1] && isPlausibleUsername(m[1])) found.add(m[1]);
  }

  // "for USER" / "user USER"
  const forUser = t.matchAll(/\b(?:for|user|id)\s+([a-zA-Z][a-zA-Z0-9_]{2,31})\b/gi) || [];
  for (const m of forUser) {
    if (m[1] && isPlausibleUsername(m[1])) found.add(m[1]);
  }

  // Standalone game-style ids (letters+digits)
  const standalone =
    t.matchAll(/\b(?=[a-zA-Z0-9_]*\d)(?=[a-zA-Z0-9_]*[a-zA-Z])[a-zA-Z][a-zA-Z0-9_]{2,31}\b/g) || [];
  for (const m of standalone) {
    if (isPlausibleUsername(m[0])) found.add(m[0]);
  }

  return [...found];
}

function pickBestUsername(candidates) {
  const list = (candidates || []).filter(isPlausibleUsername);
  if (!list.length) return { username: null, ambiguous: false, usernames: [] };
  const gameIds = list.filter(isGameStyleId);
  if (gameIds.length === 1) return { username: gameIds[0], ambiguous: false, usernames: list };
  if (gameIds.length > 1) return { username: null, ambiguous: true, usernames: gameIds };
  if (list.length === 1) return { username: list[0], ambiguous: false, usernames: list };
  return { username: null, ambiguous: true, usernames: list };
}

function extractAmounts(text) {
  const t = normalizeText(text);
  const amounts = [];
  const patterns = [
    /(?:add|deposit|fund|funds|load|put|top\s*up|credit)\s*(?:me\s*)?(?:\$)?\s*(\d+(?:\.\d{1,2})?)/gi,
    /(?:\$)\s*(\d+(?:\.\d{1,2})?)/g,
    /\b(\d+(?:\.\d{1,2})?)\s*(?:\$|usd|dollars?|bucks)\b/gi,
    /\bamount\s*[:=]?\s*(\d+(?:\.\d{1,2})?)/gi,
    // "juwa USER 50" / "add to juwa USER 50"
    /\bjuwa\b(?:\s+\S+){0,4}\s+(\d+(?:\.\d{1,2})?)\b/gi,
    // trailing amount on a juwa line
    /\b(?:add|juwa|deposit|fund).{0,40}?\s(\d+(?:\.\d{1,2})?)\s*$/gi,
  ];
  for (const re of patterns) {
    for (const m of t.matchAll(re)) {
      const a = parseAmount(m[1]);
      if (a != null) amounts.push(a);
    }
  }
  // Last-token bare number if message mentions juwa/add and a username-like token
  if (/\bjuwa\b/i.test(t) || /\b(add|deposit|fund)\b/i.test(t)) {
    const last = t.match(/(?:^|\s)(\d+(?:\.\d{1,2})?)(?:\s*[!.]*)?$/);
    if (last) {
      const a = parseAmount(last[1]);
      if (a != null) amounts.push(a);
    }
  }
  return [...new Set(amounts)];
}

function looksLikeJuwaFundRequest(text) {
  const t = normalizeText(text).toLowerCase();
  if (!/\bjuwa\b/.test(t)) return false;
  return (
    /\b(add|deposit|fund|funds|load|top\s*up|credit|balance|put)\b/.test(t) ||
    /\$\s*\d/.test(t) ||
    /\d+(?:\.\d{1,2})?\s*(\$|usd|dollars?)/.test(t) ||
    // "juwa vvkj1555 50"
    /\bjuwa\b.+\d/.test(t)
  );
}

function parseJuwaFundRequest(text) {
  const raw = normalizeText(text);
  const intent = looksLikeJuwaFundRequest(raw);
  const usernamesRaw = extractUsernames(raw);
  const picked = pickBestUsername(usernamesRaw);
  const amounts = extractAmounts(raw);

  if (!intent) {
    return {
      ok: false,
      intent: false,
      username: null,
      amount: null,
      missing: [],
      usernames: picked.usernames,
      amounts,
      reason: "Not a Juwa fund request",
    };
  }

  const missing = [];
  let username = picked.username;
  let amount = null;

  if (!username) {
    missing.push(picked.ambiguous ? "username (multiple candidates — verify)" : "username");
  }

  if (amounts.length === 1) amount = amounts[0];
  else if (amounts.length === 0) missing.push("amount");
  else missing.push("amount (multiple candidates — verify)");

  const ok = Boolean(username && amount && missing.length === 0);
  return {
    ok,
    intent: true,
    username,
    amount,
    missing,
    usernames: picked.usernames.length ? picked.usernames : usernamesRaw,
    amounts,
    reason: ok
      ? "Ready for admin review"
      : `Need admin verification: ${missing.join(", ") || "unclear request"}`,
  };
}

function fingerprintRequest({ conversationId, messageId, username, amount }) {
  return [
    String(conversationId || ""),
    String(messageId || ""),
    String(username || "").toLowerCase(),
    String(amount ?? ""),
  ].join("|");
}

module.exports = {
  parseJuwaFundRequest,
  parseAmount,
  extractUsernames,
  extractAmounts,
  pickBestUsername,
  fingerprintRequest,
  looksLikeJuwaFundRequest,
  isGameStyleId,
};
