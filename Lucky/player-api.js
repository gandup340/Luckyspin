const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { dbEnabled, query, withTransaction } = require("./db");
const { sendMail, makeVerifyCode, hashVerifyCode, brandEmailHtml } = require("./mail");

const BCRYPT_ROUNDS = 12;
const SESSION_DAYS = 30;
const VERIFY_MINUTES = 30;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function publicPlayer(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    name: row.name || "",
    phone: row.phone || "",
    email: row.email || "",
    emailVerified: Boolean(row.email_verified),
    facebookName: row.facebook_name || "",
    referralCode: row.referral_code,
    points: Number(row.points || 0),
    balanceCents: Number(row.balance_cents || 0),
    vipTier: row.vip_tier || "bronze",
    createdAt: row.created_at,
  };
}

function makeReferralCode() {
  return crypto.randomBytes(4).toString("hex");
}

function makeToken() {
  return crypto.randomBytes(32).toString("hex");
}

function normalizeEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase()
    .slice(0, 120);
}

function usernameFromEmail(email) {
  const local = String(email.split("@")[0] || "player")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 28);
  const base = local.length >= 3 ? local : `player${local}`;
  return base.slice(0, 28);
}

async function ensureEmailSchema() {
  if (!dbEnabled()) return;
  await query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false`);
  await query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS email_verify_code_hash TEXT`);
  await query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS email_verify_expires_at TIMESTAMPTZ`);
  await query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS password_reset_code_hash TEXT`);
  await query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS password_reset_expires_at TIMESTAMPTZ`);
  await query(
    `CREATE UNIQUE INDEX IF NOT EXISTS players_email_unique ON players (lower(email)) WHERE email <> ''`
  );
}

async function createSession(playerId) {
  const token = makeToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000);
  await query(`INSERT INTO player_sessions (token, player_id, expires_at) VALUES ($1,$2,$3)`, [
    token,
    playerId,
    expires.toISOString(),
  ]);
  return token;
}

async function issueVerification(player, { reason = "verify" } = {}) {
  const code = makeVerifyCode();
  const expires = new Date(Date.now() + VERIFY_MINUTES * 60 * 1000);
  await query(
    `UPDATE players
     SET email_verify_code_hash = $2,
         email_verify_expires_at = $3,
         email_verified = false,
         updated_at = now()
     WHERE id = $1`,
    [player.id, hashVerifyCode(code), expires.toISOString()]
  );
  const subject =
    reason === "resend"
      ? "Your LUCKY VIPS GAME verification code"
      : "Verify your LUCKY VIPS GAME email";
  const text = `Your verification code is ${code}. It expires in ${VERIFY_MINUTES} minutes.`;
  const html = brandEmailHtml({
    title: "Verify your email",
    bodyHtml: `<p>Welcome to LUCKY VIPS GAME.</p>
      <p>Your verification code is:</p>
      <p style="font-size:28px;letter-spacing:0.18em;font-weight:700;color:#2bb8ae;margin:16px 0;">${code}</p>
      <p>This code expires in ${VERIFY_MINUTES} minutes.</p>`,
  });
  const mail = await sendMail({
    to: player.email,
    subject,
    text,
    html,
    previewCode: code,
    title: "Verify your email",
  });
  return mail;
}

async function issuePasswordReset(player) {
  const code = makeVerifyCode();
  const expires = new Date(Date.now() + VERIFY_MINUTES * 60 * 1000);
  await query(
    `UPDATE players
     SET password_reset_code_hash = $2,
         password_reset_expires_at = $3,
         updated_at = now()
     WHERE id = $1`,
    [player.id, hashVerifyCode(code), expires.toISOString()]
  );
  const subject = "Reset your LUCKY VIPS GAME password";
  const text = `Your password reset code is ${code}. It expires in ${VERIFY_MINUTES} minutes. If you did not request this, ignore this email.`;
  const html = brandEmailHtml({
    title: "Reset your password",
    bodyHtml: `<p>We received a request to reset your LUCKY VIPS GAME password.</p>
      <p>Your reset code is:</p>
      <p style="font-size:28px;letter-spacing:0.18em;font-weight:700;color:#2bb8ae;margin:16px 0;">${code}</p>
      <p>This code expires in ${VERIFY_MINUTES} minutes.</p>
      <p>If you did not request this, you can ignore this email.</p>`,
  });
  return sendMail({
    to: player.email,
    subject,
    text,
    html,
    previewCode: code,
    title: "Reset your password",
  });
}

async function requireDb(_req, res, next) {
  if (!dbEnabled()) {
    return res.status(503).json({ error: "Player database is not configured (DATABASE_URL)." });
  }
  return next();
}

async function playerAuth(req, res, next) {
  try {
    if (!dbEnabled()) {
      return res.status(503).json({ error: "Player database is not configured (DATABASE_URL)." });
    }
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!token) return res.status(401).json({ error: "Unauthorized" });

    const sess = await query(
      `SELECT s.token, s.expires_at, p.*
       FROM player_sessions s
       JOIN players p ON p.id = s.player_id
       WHERE s.token = $1`,
      [token]
    );
    const row = sess.rows[0];
    if (!row || new Date(row.expires_at).getTime() < Date.now()) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    req.playerToken = token;
    req.player = row;
    return next();
  } catch (err) {
    console.error("playerAuth:", err.message || err);
    return res.status(500).json({ error: "Auth failed" });
  }
}

function mountPlayerApi(app, { auth, requireAdmin }) {
  ensureEmailSchema().catch((err) => {
    console.error("ensureEmailSchema:", err.message || err);
  });

  app.post("/api/player/register", requireDb, async (req, res) => {
    try {
      const email = normalizeEmail(req.body?.email);
      const password = String(req.body?.password || "");
      const name = String(req.body?.name || "").trim().slice(0, 80);
      const phone = String(req.body?.phone || "").trim().slice(0, 30);
      const referralFrom = String(req.body?.referralCode || "")
        .trim()
        .toLowerCase()
        .slice(0, 32);
      let username = String(req.body?.username || "")
        .trim()
        .toLowerCase()
        .slice(0, 40);

      if (!EMAIL_RE.test(email)) {
        return res.status(400).json({ error: "Enter a valid email address" });
      }
      if (password.length < 6) {
        return res.status(400).json({ error: "Password must be at least 6 characters" });
      }
      if (!username) username = usernameFromEmail(email);
      if (!/^[a-z0-9_]{3,40}$/.test(username)) {
        return res.status(400).json({ error: "Username must be 3–40 letters, numbers, or _" });
      }

      const phoneDigits = phone.replace(/\D/g, "");
      if (phone && phoneDigits.length < 7) {
        return res.status(400).json({ error: "Enter a valid phone number" });
      }

      let referredBy = null;
      if (referralFrom) {
        const ref = await query(`SELECT id FROM players WHERE referral_code = $1`, [referralFrom]);
        referredBy = ref.rows[0]?.id || null;
      }

      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      let referralCode = makeReferralCode();
      let player;
      for (let i = 0; i < 8; i += 1) {
        try {
          const inserted = await query(
            `INSERT INTO players (username, password_hash, name, phone, email, referral_code, referred_by, email_verified)
             VALUES ($1,$2,$3,$4,$5,$6,$7,false)
             RETURNING *`,
            [username, passwordHash, name || username, phone, email, referralCode, referredBy]
          );
          player = inserted.rows[0];
          break;
        } catch (err) {
          if (String(err.code) === "23505" && String(err.constraint || "").includes("username")) {
            if (req.body?.username) {
              return res.status(409).json({ error: "Username already taken" });
            }
            username = `${usernameFromEmail(email)}${crypto.randomInt(10, 99)}`.slice(0, 40);
            continue;
          }
          if (String(err.code) === "23505" && String(err.constraint || "").includes("email")) {
            return res.status(409).json({ error: "Email already registered. Sign in instead." });
          }
          if (String(err.code) === "23505") {
            referralCode = makeReferralCode();
            continue;
          }
          throw err;
        }
      }
      if (!player) return res.status(500).json({ error: "Could not create account" });

      if (referredBy) {
        await query(
          `INSERT INTO referral_spins (player_id, from_player_id, spins, status)
           VALUES ($1,$2,1,'available')`,
          [referredBy, player.id]
        );
      }

      const mail = await issueVerification(player);
      const payload = {
        ok: true,
        needsVerification: true,
        email,
        message: mail.sent
          ? "Check your email for a verification code."
          : "Email sending is not configured yet — use the code shown below.",
        player: publicPlayer({ ...player, email_verified: false }),
      };
      if (mail.previewCode) payload.devCode = mail.previewCode;
      res.json(payload);
    } catch (err) {
      console.error("register:", err.message || err);
      res.status(500).json({ error: "Registration failed" });
    }
  });

  app.post("/api/player/verify-email", requireDb, async (req, res) => {
    try {
      const email = normalizeEmail(req.body?.email);
      const code = String(req.body?.code || "").trim();
      if (!EMAIL_RE.test(email) || !/^\d{6}$/.test(code)) {
        return res.status(400).json({ error: "Enter your email and the 6-digit code" });
      }
      const found = await query(`SELECT * FROM players WHERE lower(email) = $1`, [email]);
      const player = found.rows[0];
      if (!player) return res.status(404).json({ error: "Account not found" });
      if (player.email_verified) {
        const token = await createSession(player.id);
        return res.json({ ok: true, token, player: publicPlayer(player) });
      }
      if (
        !player.email_verify_code_hash ||
        !player.email_verify_expires_at ||
        new Date(player.email_verify_expires_at).getTime() < Date.now()
      ) {
        return res.status(400).json({ error: "Code expired. Request a new one." });
      }
      if (hashVerifyCode(code) !== player.email_verify_code_hash) {
        return res.status(400).json({ error: "Invalid verification code" });
      }
      const updated = await query(
        `UPDATE players
         SET email_verified = true,
             email_verify_code_hash = NULL,
             email_verify_expires_at = NULL,
             updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [player.id]
      );
      const token = await createSession(player.id);
      res.json({ ok: true, token, player: publicPlayer(updated.rows[0]) });
    } catch (err) {
      console.error("verify-email:", err.message || err);
      res.status(500).json({ error: "Verification failed" });
    }
  });

  app.post("/api/player/resend-verification", requireDb, async (req, res) => {
    try {
      const email = normalizeEmail(req.body?.email);
      if (!EMAIL_RE.test(email)) {
        return res.status(400).json({ error: "Enter a valid email address" });
      }
      const found = await query(`SELECT * FROM players WHERE lower(email) = $1`, [email]);
      const player = found.rows[0];
      if (!player) return res.status(404).json({ error: "Account not found" });
      if (player.email_verified) {
        return res.json({ ok: true, alreadyVerified: true, message: "Email already verified. Sign in." });
      }
      const mail = await issueVerification(player, { reason: "resend" });
      const payload = {
        ok: true,
        message: mail.sent ? "Verification code sent." : "Verification code ready.",
      };
      if (mail.previewCode) payload.devCode = mail.previewCode;
      res.json(payload);
    } catch (err) {
      console.error("resend-verification:", err.message || err);
      res.status(500).json({ error: "Could not resend code" });
    }
  });

  app.post("/api/player/forgot-password", requireDb, async (req, res) => {
    try {
      const email = normalizeEmail(req.body?.email);
      if (!EMAIL_RE.test(email)) {
        return res.status(400).json({ error: "Enter a valid email address" });
      }
      const found = await query(`SELECT * FROM players WHERE lower(email) = $1`, [email]);
      const player = found.rows[0];
      const generic = {
        ok: true,
        email,
        message: "If that email is registered, a reset code is on the way.",
      };
      if (!player) return res.json(generic);

      const mail = await issuePasswordReset(player);
      if (mail.previewCode) generic.devCode = mail.previewCode;
      if (!mail.sent && mail.previewCode) {
        generic.message = "Enter the reset code below to choose a new password.";
      }
      res.json(generic);
    } catch (err) {
      console.error("forgot-password:", err.message || err);
      res.status(500).json({ error: "Could not start password reset" });
    }
  });

  app.post("/api/player/reset-password", requireDb, async (req, res) => {
    try {
      const email = normalizeEmail(req.body?.email);
      const code = String(req.body?.code || "").trim();
      const password = String(req.body?.password || "");
      if (!EMAIL_RE.test(email) || !/^\d{6}$/.test(code)) {
        return res.status(400).json({ error: "Enter your email and the 6-digit code" });
      }
      if (password.length < 6) {
        return res.status(400).json({ error: "Password must be at least 6 characters" });
      }
      const found = await query(`SELECT * FROM players WHERE lower(email) = $1`, [email]);
      const player = found.rows[0];
      if (!player) return res.status(400).json({ error: "Invalid or expired reset code" });
      if (
        !player.password_reset_code_hash ||
        !player.password_reset_expires_at ||
        new Date(player.password_reset_expires_at).getTime() < Date.now()
      ) {
        return res.status(400).json({ error: "Code expired. Request a new one." });
      }
      if (hashVerifyCode(code) !== player.password_reset_code_hash) {
        return res.status(400).json({ error: "Invalid reset code" });
      }

      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      const updated = await query(
        `UPDATE players
         SET password_hash = $2,
             password_reset_code_hash = NULL,
             password_reset_expires_at = NULL,
             email_verified = true,
             updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [player.id, passwordHash]
      );
      await query(`DELETE FROM player_sessions WHERE player_id = $1`, [player.id]);
      const token = await createSession(player.id);
      res.json({ ok: true, token, player: publicPlayer(updated.rows[0]) });
    } catch (err) {
      console.error("reset-password:", err.message || err);
      res.status(500).json({ error: "Could not reset password" });
    }
  });

  app.post("/api/player/login", requireDb, async (req, res) => {
    try {
      const password = String(req.body?.password || "");
      const email = normalizeEmail(req.body?.email);
      const username = String(req.body?.username || req.body?.login || "")
        .trim()
        .toLowerCase();

      let player = null;
      if (email && EMAIL_RE.test(email)) {
        const found = await query(`SELECT * FROM players WHERE lower(email) = $1`, [email]);
        player = found.rows[0] || null;
      } else if (username) {
        if (EMAIL_RE.test(username)) {
          const found = await query(`SELECT * FROM players WHERE lower(email) = $1`, [username]);
          player = found.rows[0] || null;
        } else {
          const found = await query(`SELECT * FROM players WHERE username = $1`, [username]);
          player = found.rows[0] || null;
        }
      }

      if (!player) return res.status(401).json({ error: "Invalid email or password" });
      const ok = await bcrypt.compare(password, player.password_hash);
      if (!ok) return res.status(401).json({ error: "Invalid email or password" });

      if (player.email && !player.email_verified) {
        // Legacy accounts (created before email verification) have no pending code.
        if (!player.email_verify_code_hash) {
          await query(`UPDATE players SET email_verified = true, updated_at = now() WHERE id = $1`, [
            player.id,
          ]);
          player.email_verified = true;
        } else {
          const mail = await issueVerification(player, { reason: "resend" });
          const payload = {
            ok: false,
            needsVerification: true,
            email: player.email,
            error: "Verify your email before signing in.",
          };
          if (mail.previewCode) payload.devCode = mail.previewCode;
          return res.status(403).json(payload);
        }
      }

      const token = await createSession(player.id);
      res.json({ ok: true, token, player: publicPlayer(player) });
    } catch (err) {
      console.error("login:", err.message || err);
      res.status(500).json({ error: "Login failed" });
    }
  });

  app.post("/api/player/logout", requireDb, playerAuth, async (req, res) => {
    try {
      await query(`DELETE FROM player_sessions WHERE token = $1`, [req.playerToken]);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: "Logout failed" });
    }
  });

  app.get("/api/player/me", requireDb, playerAuth, async (req, res) => {
    const spins = await query(
      `SELECT COALESCE(SUM(spins),0)::int AS spins FROM referral_spins
       WHERE player_id = $1 AND status = 'available'`,
      [req.player.id]
    );
    res.json({
      player: publicPlayer(req.player),
      referralSpins: Number(spins.rows[0]?.spins || 0),
    });
  });

  app.put("/api/player/profile", requireDb, playerAuth, async (req, res) => {
    try {
      const name = String(req.body?.name ?? req.player.name ?? "").trim().slice(0, 80);
      const phone = String(req.body?.phone ?? req.player.phone ?? "").trim().slice(0, 30);
      const nextEmail = normalizeEmail(req.body?.email ?? req.player.email ?? "");
      const facebookName = String(req.body?.facebookName ?? req.player.facebook_name ?? "")
        .trim()
        .slice(0, 80);
      const emailChanged = nextEmail && nextEmail !== normalizeEmail(req.player.email);
      if (emailChanged && !EMAIL_RE.test(nextEmail)) {
        return res.status(400).json({ error: "Enter a valid email address" });
      }
      const updated = await query(
        `UPDATE players SET name=$2, phone=$3, email=$4, facebook_name=$5,
           email_verified = CASE WHEN $6 THEN false ELSE email_verified END,
           updated_at=now()
         WHERE id=$1 RETURNING *`,
        [req.player.id, name, phone, nextEmail, facebookName, emailChanged]
      );
      let player = updated.rows[0];
      let payload = { ok: true, player: publicPlayer(player) };
      if (emailChanged) {
        const mail = await issueVerification(player);
        payload.needsVerification = true;
        payload.message = "Verify your new email address.";
        if (mail.previewCode) payload.devCode = mail.previewCode;
      }
      res.json(payload);
    } catch (err) {
      if (String(err.code) === "23505") {
        return res.status(409).json({ error: "Email already in use" });
      }
      res.status(500).json({ error: "Could not update profile" });
    }
  });

  app.put("/api/player/password", requireDb, playerAuth, async (req, res) => {
    try {
      const currentPassword = String(req.body?.currentPassword || "");
      const newPassword = String(req.body?.newPassword || "");
      if (!currentPassword || newPassword.length < 6) {
        return res.status(400).json({ error: "Enter your current password and a new password (min 6)." });
      }
      const ok = await bcrypt.compare(currentPassword, req.player.password_hash);
      if (!ok) return res.status(401).json({ error: "Current password is incorrect" });
      const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
      await query(`UPDATE players SET password_hash = $2, updated_at = now() WHERE id = $1`, [
        req.player.id,
        passwordHash,
      ]);
      await query(`DELETE FROM player_sessions WHERE player_id = $1 AND token <> $2`, [
        req.player.id,
        req.playerToken,
      ]);
      res.json({ ok: true, message: "Password updated." });
    } catch (err) {
      console.error("change-password:", err.message || err);
      res.status(500).json({ error: "Could not update password" });
    }
  });

  app.get("/api/player/game-ids", requireDb, playerAuth, async (req, res) => {
    const rows = await query(
      `SELECT id, game_key AS "gameKey", game_name AS "gameName", game_user_id AS "gameUserId", created_at AS "createdAt"
       FROM player_game_ids WHERE player_id = $1 ORDER BY created_at DESC`,
      [req.player.id]
    );
    res.json({ gameIds: rows.rows });
  });

  app.post("/api/player/game-ids", requireDb, playerAuth, async (req, res) => {
    const gameKey = String(req.body?.gameKey || "").trim().slice(0, 60);
    const gameName = String(req.body?.gameName || gameKey).trim().slice(0, 80);
    const gameUserId = String(req.body?.gameUserId || "").trim().slice(0, 120);
    if (!gameKey || !gameUserId) {
      return res.status(400).json({ error: "gameKey and gameUserId required" });
    }
    try {
      const row = await query(
        `INSERT INTO player_game_ids (player_id, game_key, game_name, game_user_id)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (player_id, game_key)
         DO UPDATE SET game_user_id = EXCLUDED.game_user_id, game_name = EXCLUDED.game_name
         RETURNING id, game_key AS "gameKey", game_name AS "gameName", game_user_id AS "gameUserId", created_at AS "createdAt"`,
        [req.player.id, gameKey, gameName, gameUserId]
      );
      res.json({ ok: true, gameId: row.rows[0] });
    } catch (err) {
      res.status(500).json({ error: "Could not save game ID" });
    }
  });

  app.post("/api/player/deposit", requireDb, playerAuth, async (req, res) => {
    const amount = Number(req.body?.amount);
    const method = String(req.body?.method || "").trim().slice(0, 60);
    const gameKey = String(req.body?.gameKey || "").trim().slice(0, 60);
    const reference = String(req.body?.reference || "").trim().slice(0, 120);
    const proofUrl = String(req.body?.proofUrl || "").trim().slice(0, 500);
    if (!Number.isFinite(amount) || amount < 1) {
      return res.status(400).json({ error: "Enter a valid amount (USD)" });
    }
    const amountCents = Math.round(amount * 100);
    const row = await query(
      `INSERT INTO deposits (player_id, amount_cents, method, game_key, reference, proof_url)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, amount_cents AS "amountCents", method, game_key AS "gameKey", reference, proof_url AS "proofUrl",
                 status, created_at AS "createdAt"`,
      [req.player.id, amountCents, method, gameKey, reference, proofUrl]
    );
    res.json({ ok: true, deposit: row.rows[0] });
  });

  app.get("/api/player/deposits", requireDb, playerAuth, async (req, res) => {
    const rows = await query(
      `SELECT id, amount_cents AS "amountCents", method, game_key AS "gameKey", reference,
              proof_url AS "proofUrl", status, admin_note AS "adminNote", created_at AS "createdAt"
       FROM deposits WHERE player_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [req.player.id]
    );
    res.json({ deposits: rows.rows });
  });

  app.post("/api/player/withdraw", requireDb, playerAuth, async (req, res) => {
    const amount = Number(req.body?.amount);
    const method = String(req.body?.method || "").trim().slice(0, 60);
    const destination = String(req.body?.destination || "").trim().slice(0, 160);
    const gameKey = String(req.body?.gameKey || "").trim().slice(0, 60);
    if (!Number.isFinite(amount) || amount < 1) {
      return res.status(400).json({ error: "Enter a valid amount (USD)" });
    }
    if (!destination) return res.status(400).json({ error: "Destination required" });
    const amountCents = Math.round(amount * 100);
    if (amountCents > Number(req.player.balance_cents || 0)) {
      return res.status(400).json({ error: "Insufficient balance" });
    }
    const row = await query(
      `INSERT INTO withdrawals (player_id, amount_cents, method, destination, game_key)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, amount_cents AS "amountCents", method, destination, game_key AS "gameKey",
                 status, created_at AS "createdAt"`,
      [req.player.id, amountCents, method, destination, gameKey]
    );
    res.json({ ok: true, withdrawal: row.rows[0] });
  });

  app.get("/api/player/withdrawals", requireDb, playerAuth, async (req, res) => {
    const rows = await query(
      `SELECT id, amount_cents AS "amountCents", method, destination, game_key AS "gameKey",
              status, admin_note AS "adminNote", created_at AS "createdAt"
       FROM withdrawals WHERE player_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [req.player.id]
    );
    res.json({ withdrawals: rows.rows });
  });

  app.get("/api/admin/player-deposits", auth, requireAdmin, requireDb, async (_req, res) => {
    const rows = await query(
      `SELECT d.id, d.amount_cents AS "amountCents", d.method, d.game_key AS "gameKey", d.reference,
              d.proof_url AS "proofUrl", d.status, d.admin_note AS "adminNote", d.created_at AS "createdAt",
              p.username, p.name
       FROM deposits d
       JOIN players p ON p.id = d.player_id
       ORDER BY d.created_at DESC
       LIMIT 100`
    );
    res.json({ deposits: rows.rows });
  });

  app.post("/api/admin/player-deposits/:id/approve", auth, requireAdmin, requireDb, async (req, res) => {
    try {
      const note = String(req.body?.adminNote || "").trim().slice(0, 300);
      const result = await withTransaction(async (client) => {
        const cur = await client.query(`SELECT * FROM deposits WHERE id = $1 FOR UPDATE`, [req.params.id]);
        const dep = cur.rows[0];
        if (!dep) return { error: "Deposit not found", status: 404 };
        if (dep.status !== "pending") return { error: "Deposit already processed", status: 400 };

        await client.query(
          `UPDATE deposits SET status='approved', admin_note=$2, updated_at=now() WHERE id=$1`,
          [dep.id, note]
        );
        await client.query(
          `UPDATE players SET balance_cents = balance_cents + $2, points = points + $3, updated_at=now()
           WHERE id=$1`,
          [dep.player_id, dep.amount_cents, Math.floor(dep.amount_cents / 100)]
        );
        await client.query(
          `INSERT INTO point_ledger (player_id, delta, reason, meta)
           VALUES ($1,$2,'deposit_approved',$3::jsonb)`,
          [dep.player_id, Math.floor(dep.amount_cents / 100), JSON.stringify({ depositId: dep.id })]
        );
        return { ok: true };
      });
      if (result.error) return res.status(result.status).json({ error: result.error });
      res.json(result);
    } catch (err) {
      console.error("approve deposit:", err.message || err);
      res.status(500).json({ error: "Could not approve deposit" });
    }
  });

  app.post("/api/admin/player-deposits/:id/reject", auth, requireAdmin, requireDb, async (req, res) => {
    const note = String(req.body?.adminNote || "").trim().slice(0, 300);
    const cur = await query(`SELECT * FROM deposits WHERE id = $1`, [req.params.id]);
    const dep = cur.rows[0];
    if (!dep) return res.status(404).json({ error: "Deposit not found" });
    if (dep.status !== "pending") return res.status(400).json({ error: "Deposit already processed" });
    await query(`UPDATE deposits SET status='rejected', admin_note=$2, updated_at=now() WHERE id=$1`, [
      dep.id,
      note,
    ]);
    res.json({ ok: true });
  });

  app.get("/api/admin/player-withdrawals", auth, requireAdmin, requireDb, async (_req, res) => {
    const rows = await query(
      `SELECT w.id, w.amount_cents AS "amountCents", w.method, w.destination, w.game_key AS "gameKey",
              w.status, w.admin_note AS "adminNote", w.created_at AS "createdAt",
              p.username, p.name, p.balance_cents AS "balanceCents"
       FROM withdrawals w
       JOIN players p ON p.id = w.player_id
       ORDER BY w.created_at DESC
       LIMIT 100`
    );
    res.json({ withdrawals: rows.rows });
  });

  app.post("/api/admin/player-withdrawals/:id/approve", auth, requireAdmin, requireDb, async (req, res) => {
    try {
      const note = String(req.body?.adminNote || "").trim().slice(0, 300);
      const result = await withTransaction(async (client) => {
        const cur = await client.query(`SELECT * FROM withdrawals WHERE id = $1 FOR UPDATE`, [req.params.id]);
        const w = cur.rows[0];
        if (!w) return { error: "Withdrawal not found", status: 404 };
        if (w.status !== "pending") return { error: "Withdrawal already processed", status: 400 };

        const bal = await client.query(`SELECT balance_cents FROM players WHERE id=$1 FOR UPDATE`, [
          w.player_id,
        ]);
        const balance = Number(bal.rows[0]?.balance_cents || 0);
        if (balance < w.amount_cents) return { error: "Player has insufficient balance", status: 400 };

        await client.query(
          `UPDATE players SET balance_cents = balance_cents - $2, updated_at=now() WHERE id=$1`,
          [w.player_id, w.amount_cents]
        );
        await client.query(
          `UPDATE withdrawals SET status='approved', admin_note=$2, updated_at=now() WHERE id=$1`,
          [w.id, note]
        );
        return { ok: true };
      });
      if (result.error) return res.status(result.status).json({ error: result.error });
      res.json(result);
    } catch (err) {
      console.error("approve withdrawal:", err.message || err);
      res.status(500).json({ error: "Could not approve withdrawal" });
    }
  });

  app.post("/api/admin/player-withdrawals/:id/reject", auth, requireAdmin, requireDb, async (req, res) => {
    const note = String(req.body?.adminNote || "").trim().slice(0, 300);
    const cur = await query(`SELECT * FROM withdrawals WHERE id = $1`, [req.params.id]);
    const w = cur.rows[0];
    if (!w) return res.status(404).json({ error: "Withdrawal not found" });
    if (w.status !== "pending") return res.status(400).json({ error: "Withdrawal already processed" });
    await query(`UPDATE withdrawals SET status='rejected', admin_note=$2, updated_at=now() WHERE id=$1`, [
      w.id,
      note,
    ]);
    res.json({ ok: true });
  });

  app.get("/api/admin/players", auth, requireAdmin, requireDb, async (_req, res) => {
    const rows = await query(
      `SELECT id, username, name, phone, email, facebook_name AS "facebookName", referral_code AS "referralCode",
              points, balance_cents AS "balanceCents", vip_tier AS "vipTier", created_at AS "createdAt"
       FROM players ORDER BY created_at DESC LIMIT 200`
    );
    res.json({ players: rows.rows });
  });
}

module.exports = {
  mountPlayerApi,
  playerAuth,
  dbEnabled,
  publicPlayer,
};
