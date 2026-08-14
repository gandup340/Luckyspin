const crypto = require("crypto");

function emailConfigured() {
  return Boolean(
    String(process.env.RESEND_API_KEY || "").trim() ||
      String(process.env.SMTP_HOST || "").trim()
  );
}

async function sendViaResend({ to, subject, text, html }) {
  const key = String(process.env.RESEND_API_KEY || "").trim();
  if (!key) return false;
  const from =
    String(process.env.EMAIL_FROM || "").trim() || "LUCKY VIPS GAME <onboarding@resend.dev>";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to: [to], subject, text, html }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend failed: ${res.status} ${body.slice(0, 200)}`);
  }
  return true;
}

async function sendViaSmtp({ to, subject, text, html }) {
  const host = String(process.env.SMTP_HOST || "").trim();
  if (!host) return false;
  let nodemailer;
  try {
    nodemailer = require("nodemailer");
  } catch {
    throw new Error("Install nodemailer to use SMTP (npm i nodemailer)");
  }
  const port = Number(process.env.SMTP_PORT || 587);
  const user = String(process.env.SMTP_USER || "").trim();
  const pass = String(process.env.SMTP_PASS || "").trim();
  const from =
    String(process.env.EMAIL_FROM || "").trim() || user || "noreply@luckyvips.game";
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: user ? { user, pass } : undefined,
  });
  await transporter.sendMail({ from, to, subject, text, html });
  return true;
}

/**
 * Send transactional email. Returns { sent, previewCode }.
 * If mail cannot be delivered, previewCode is always returned so signup/reset can continue.
 */
async function sendMail({ to, subject, text, html, previewCode }) {
  try {
    if (await sendViaResend({ to, subject, text, html })) {
      return { sent: true, previewCode: null };
    }
    if (await sendViaSmtp({ to, subject, text, html })) {
      return { sent: true, previewCode: null };
    }
  } catch (err) {
    console.error("sendMail:", err.message || err);
  }

  console.log(`[email:fallback] to=${to} subject=${subject}\n${text}`);
  return {
    sent: false,
    previewCode: previewCode || null,
  };
}

function makeVerifyCode() {
  return String(crypto.randomInt(100000, 999999));
}

function hashVerifyCode(code) {
  return crypto.createHash("sha256").update(String(code)).digest("hex");
}

module.exports = {
  emailConfigured,
  sendMail,
  makeVerifyCode,
  hashVerifyCode,
};
