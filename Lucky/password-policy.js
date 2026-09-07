const crypto = require("crypto");
const https = require("https");

const MIN_PLAYER_PASSWORD = 10;
const COMMON_PASSWORDS = new Set(
  [
    "password",
    "password1",
    "password12",
    "password123",
    "1234567890",
    "123456789",
    "qwerty123",
    "qwertyuiop",
    "letmein123",
    "welcome123",
    "admin12345",
    "luckyvipsadmin",
    "slotvalley",
    "slotvalley1",
    "iloveyou12",
    "monkey1234",
    "dragon1234",
    "baseball12",
    "football12",
    "abc1234567",
    "changeme12",
    "passw0rd12",
  ].map((s) => s.toLowerCase())
);

function passwordTooShort(password, min = MIN_PLAYER_PASSWORD) {
  return String(password || "").length < min;
}

function isCommonPassword(password) {
  const p = String(password || "").toLowerCase();
  if (COMMON_PASSWORDS.has(p)) return true;
  if (/^(.)\1{9,}$/.test(p)) return true;
  if (/^(0123456789|9876543210)$/.test(p)) return true;
  return false;
}

/**
 * Have I Been Pwned k-anonymity range check.
 * Only the first 5 hex chars of SHA-1 are sent; never the full password.
 * Returns true if the password appears in known breaches.
 * On network failure, returns false (fail open for availability) unless failClosed.
 */
function checkPwnedPassword(password, { timeoutMs = 2500, failClosed = false } = {}) {
  return new Promise((resolve) => {
    const sha1 = crypto.createHash("sha1").update(String(password), "utf8").digest("hex").toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);
    const req = https.get(
      {
        hostname: "api.pwnedpasswords.com",
        path: `/range/${prefix}`,
        headers: { "User-Agent": "SlotValley-PasswordCheck/1.0", "Add-Padding": "true" },
        timeout: timeoutMs,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
          if (body.length > 2_000_000) {
            req.destroy();
            resolve(failClosed);
          }
        });
        res.on("end", () => {
          if (res.statusCode !== 200) {
            resolve(failClosed);
            return;
          }
          const hit = body.split("\n").some((line) => {
            const [hashSuffix] = line.trim().split(":");
            return hashSuffix && hashSuffix.toUpperCase() === suffix;
          });
          resolve(hit);
        });
      }
    );
    req.on("timeout", () => {
      req.destroy();
      resolve(failClosed);
    });
    req.on("error", () => resolve(failClosed));
  });
}

/**
 * Validate player password. Returns { ok: true } or { ok: false, error }.
 */
async function validatePlayerPassword(password, { min = MIN_PLAYER_PASSWORD } = {}) {
  if (passwordTooShort(password, min)) {
    return { ok: false, error: `Password must be at least ${min} characters` };
  }
  if (isCommonPassword(password)) {
    return { ok: false, error: "Choose a stronger password that is not commonly used" };
  }
  try {
    const pwned = await checkPwnedPassword(password);
    if (pwned) {
      return {
        ok: false,
        error: "This password appears in known data breaches. Choose a different one.",
      };
    }
  } catch {
    /* network issues — allow if not common */
  }
  return { ok: true };
}

module.exports = {
  MIN_PLAYER_PASSWORD,
  passwordTooShort,
  isCommonPassword,
  checkPwnedPassword,
  validatePlayerPassword,
};
