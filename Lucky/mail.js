const crypto = require("crypto");
const nodemailer = require("nodemailer");

let transporter = null;

function emailConfigured() {
  return Boolean(String(process.env.SMTP_HOST || "").trim());
}

function smtpSettings() {
  const host = String(process.env.SMTP_HOST || "").trim();
  if (!host) return null;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = String(process.env.SMTP_USER || "").trim();
  const pass = String(process.env.SMTP_PASS || "").trim();
  const secureEnv = String(process.env.SMTP_SECURE || "").trim().toLowerCase();
  const secure = secureEnv === "1" || secureEnv === "true" || port === 465;
  const from =
    String(process.env.EMAIL_FROM || "").trim() ||
    (user ? `LUCKY VIPS GAME <${user}>` : "LUCKY VIPS GAME <noreply@luckyvipsgame.com>");
  return { host, port, user, pass, secure, from };
}

function getTransporter() {
  const cfg = smtpSettings();
  if (!cfg) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
      tls: {
        // Many shared hosts use mismatched certs on alternate names.
        rejectUnauthorized: String(process.env.SMTP_TLS_REJECT_UNAUTHORIZED || "1") !== "0",
      },
    });
  }
  return transporter;
}

function brandEmailHtml({ title, bodyHtml }) {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#141618;color:#eef1f4;font-family:Arial,Helvetica,sans-serif;">
    <div style="max-width:520px;margin:0 auto;padding:28px 18px;">
      <div style="background:#1b1e22;border:1px solid #2a3036;border-radius:10px;padding:24px;">
        <p style="margin:0 0 6px;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#3dcdc2;font-weight:700;">LUCKY VIPS GAME</p>
        <h1 style="margin:0 0 14px;font-size:22px;line-height:1.25;color:#eef1f4;">${title}</h1>
        <div style="font-size:15px;line-height:1.55;color:#c4cad1;">${bodyHtml}</div>
      </div>
      <p style="margin:14px 0 0;font-size:12px;color:#8b939c;text-align:center;">Play responsibly. 18+ only.</p>
    </div>
  </body>
</html>`;
}

/**
 * Send transactional email over SMTP.
 * Returns { sent, previewCode, error }.
 * previewCode is returned when SMTP is not configured or send fails.
 */
async function sendMail({ to, subject, text, html, previewCode, title }) {
  const cfg = smtpSettings();
  if (!cfg) {
    console.log(`[email:fallback] SMTP not configured. to=${to} subject=${subject}\n${text}`);
    return { sent: false, previewCode: previewCode || null, error: "SMTP not configured" };
  }

  try {
    const transport = getTransporter();
    const finalHtml =
      html ||
      brandEmailHtml({
        title: title || subject,
        bodyHtml: `<p style="white-space:pre-wrap;margin:0;">${String(text || "")
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")}</p>`,
      });
    await transport.sendMail({
      from: cfg.from,
      to,
      subject,
      text,
      html: finalHtml,
    });
    return { sent: true, previewCode: null };
  } catch (err) {
    console.error("sendMail SMTP:", err.message || err);
    console.log(`[email:fallback] to=${to} subject=${subject}\n${text}`);
    return {
      sent: false,
      previewCode: previewCode || null,
      error: err.message || "SMTP send failed",
    };
  }
}

function makeVerifyCode() {
  return String(crypto.randomInt(100000, 999999));
}

function hashVerifyCode(code) {
  return crypto.createHash("sha256").update(String(code)).digest("hex");
}

module.exports = {
  emailConfigured,
  smtpSettings,
  sendMail,
  makeVerifyCode,
  hashVerifyCode,
  brandEmailHtml,
};
