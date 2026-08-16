/**
 * Pure chat → Juwa fund-request detection (no I/O).
 * Never guesses: both username and amount must be clearly present.
 */

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

/**
 * Username patterns: juwa id / user id style tokens.
 * Avoid matching pure words like "please" by requiring length + alnum mix rules.
 */
function extractUsernames(text) {
  const t = normalizeText(text);
  const found = new Set();

  // Explicit labels: user/username/id/juwa: xyz
  const labeled =
    t.matchAll(
      /\b(?:juwa\s*(?:user(?:name)?|id)|user(?:name)?|id|uid|account)\s*[:=#-]?\s*([a-zA-Z0-9_]{3,32})\b/gi
    ) || [];
  for (const m of labeled) {
    if (m[1]) found.add(m[1]);
  }

  // "add to juwa USER" / "juwa USER add 50"
  const juwaNear =
    t.matchAll(/\bjuwa\b[^a-zA-Z0-9_]{0,12}([a-zA-Z0-9_]{3,32})\b/gi) || [];
  for (const m of juwaNear) {
    const u = m[1];
    if (u && !/^(add|please|need|fund|balance|deposit|money|dollar|dollars)$/i.test(u)) {
      found.add(u);
    }
  }

  // Standalone game-style ids (letters+digits), e.g. vvkj1555
  const standalone = t.matchAll(/\b(?=[a-zA-Z0-9_]*\d)(?=[a-zA-Z0-9_]*[a-zA-Z])[a-zA-Z][a-zA-Z0-9_]{2,31}\b/g) || [];
  for (const m of standalone) {
    const u = m[0];
    if (!/^(juwa|add|please|need|fund|balance|deposit|money|dollar|dollars|chat|user)$/i.test(u)) {
      found.add(u);
    }
  }

  return [...found];
}

function extractAmounts(text) {
  const t = normalizeText(text);
  const amounts = [];
  const patterns = [
    /(?:add|deposit|fund|load|put|top\s*up)\s*(?:me\s*)?(?:\$)?\s*(\d+(?:\.\d{1,2})?)/gi,
    /(?:\$)\s*(\d+(?:\.\d{1,2})?)/g,
    /\b(\d+(?:\.\d{1,2})?)\s*(?:\$|usd|dollars?|bucks)\b/gi,
    /\bamount\s*[:=]?\s*(\d+(?:\.\d{1,2})?)/gi,
  ];
  for (const re of patterns) {
    for (const m of t.matchAll(re)) {
      const a = parseAmount(m[1]);
      if (a != null) amounts.push(a);
    }
  }
  return [...new Set(amounts)];
}

function looksLikeJuwaFundRequest(text) {
  const t = normalizeText(text).toLowerCase();
  if (!/\bjuwa\b/.test(t)) return false;
  return (
    /\b(add|deposit|fund|load|top\s*up|credit|balance|put)\b/.test(t) ||
    /\$\s*\d/.test(t) ||
    /\d+(?:\.\d{1,2})?\s*(\$|usd|dollars?)/.test(t)
  );
}

/**
 * @returns {{
 *   ok: boolean,
 *   intent: boolean,
 *   username: string|null,
 *   amount: number|null,
 *   missing: string[],
 *   usernames: string[],
 *   amounts: number[],
 *   reason: string
 * }}
 */
function parseJuwaFundRequest(text) {
  const raw = normalizeText(text);
  const intent = looksLikeJuwaFundRequest(raw);
  const usernames = extractUsernames(raw);
  const amounts = extractAmounts(raw);

  if (!intent) {
    return {
      ok: false,
      intent: false,
      username: null,
      amount: null,
      missing: [],
      usernames,
      amounts,
      reason: "Not a Juwa fund request",
    };
  }

  const missing = [];
  let username = null;
  let amount = null;

  if (usernames.length === 1) username = usernames[0];
  else if (usernames.length === 0) missing.push("username");
  else missing.push("username (multiple candidates — verify)");

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
    usernames,
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
  fingerprintRequest,
  looksLikeJuwaFundRequest,
};
