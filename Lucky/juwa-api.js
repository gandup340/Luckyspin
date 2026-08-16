const { parseJuwaFundRequest } = require("./juwa-parser");
const { createJuwaStore } = require("./juwa-store");
const { runJuwaAddFunds, juwaConfig } = require("./juwa-automation");

const PLAYER_ADDED_REPLY = "added";

function mountJuwaApi(app, { auth, requireAdmin, dataDir, readJson, writeJson, postSupportReply }) {
  const store = createJuwaStore({ dataDir, readJson, writeJson });
  const running = new Set();

  function actorName(req) {
    return req.adminUser?.username || req.adminUser?.name || "admin";
  }

  function shortError(err) {
    return String(err || "unknown error").replace(/\s+/g, " ").trim().slice(0, 240);
  }

  async function replyToPlayerChat(row, text, admin, auditType) {
    if (!row?.conversationId || typeof postSupportReply !== "function") {
      return { ok: false, error: "No conversation to reply" };
    }
    const result = await postSupportReply(row.conversationId, text);
    if (result.ok) {
      const patch = {};
      if (auditType === "player_replied") patch.playerRepliedAt = Date.now();
      if (auditType === "player_error_replied") patch.playerErrorRepliedAt = Date.now();
      if (Object.keys(patch).length) store.updateRequest(row.id, patch);
      store.addAudit({
        type: auditType || "player_chat_reply",
        requestId: row.id,
        admin: admin || "system",
        username: row.username,
        amount: row.amount,
        status: row.status,
        conversationId: row.conversationId,
        message: `Chat reply: ${String(text).slice(0, 180)}`,
      });
    }
    return result;
  }

  async function replyAddedToPlayer(row, admin) {
    if (row.playerRepliedAt) return { ok: true, skipped: true };
    return replyToPlayerChat(row, PLAYER_ADDED_REPLY, admin, "player_replied");
  }

  async function replyNotAddedErrorToPlayer(row, admin, errorText) {
    const msg = `not added: ${shortError(errorText)}`;
    // Always post latest failure reason (admin/player need to see why).
    return replyToPlayerChat(row, msg, admin, "player_error_replied");
  }

  app.get("/api/admin/juwa/status", auth, (_req, res) => {
    const cfg = juwaConfig();
    res.json({
      automationEnabled: cfg.enabled,
      credentialsConfigured: Boolean(cfg.username && cfg.password),
      loginUrl: cfg.loginUrl,
      userMgmtUrl: cfg.userMgmtUrl,
      headed: cfg.headed,
      // never return password/username
    });
  });

  app.post("/api/admin/juwa/parse", auth, (req, res) => {
    const parsed = parseJuwaFundRequest(req.body?.text || "");
    res.json({ ok: true, parsed });
  });

  app.post("/api/admin/juwa/requests", auth, (req, res) => {
    const text = String(req.body?.text || "");
    const conversationId = String(req.body?.conversationId || "");
    const messageId = String(req.body?.messageId || "");
    if (!conversationId) return res.status(400).json({ error: "conversationId required" });

    const parsed = parseJuwaFundRequest(text);
    if (!parsed.intent) {
      return res.status(400).json({ error: "Message does not look like a Juwa fund request.", parsed });
    }

    const created = store.createRequest({
      ok: parsed.ok,
      conversationId,
      messageId,
      messageText: text,
      username: parsed.username || (parsed.usernames && parsed.usernames[0]) || null,
      amount: parsed.amount,
      missing: parsed.missing,
      reason: parsed.reason,
      usernames: parsed.usernames || [],
    });

    store.addAudit({
      type: "request_created",
      requestId: created.request?.id,
      admin: actorName(req),
      username: parsed.username,
      amount: parsed.amount,
      status: created.request?.status,
      message: created.reused ? "Reused existing request" : "Created from chat",
    });

    res.json({ ...created, parsed });
  });

  app.get("/api/admin/juwa/requests", auth, (req, res) => {
    res.json({ requests: store.listRequests({ limit: Number(req.query.limit) || 50 }) });
  });

  app.get("/api/admin/juwa/requests/:id", auth, (req, res) => {
    const row = store.getRequest(req.params.id);
    if (!row) return res.status(404).json({ error: "Request not found" });
    res.json({ request: row });
  });

  app.get("/api/admin/juwa/audits", auth, requireAdmin, (req, res) => {
    res.json({ audits: store.listAudits({ limit: Number(req.query.limit) || 100 }) });
  });

  /**
   * After funds are added on Juwa (manually or by automation): mark success and reply "added".
   * Use this on Render when Playwright/CAPTCHA cannot finish.
   */
  app.post("/api/admin/juwa/requests/:id/mark-added", auth, async (req, res) => {
    const row = store.getRequest(req.params.id);
    if (!row) return res.status(404).json({ error: "Request not found" });
    if (row.status === "success" && row.playerRepliedAt) {
      return res.json({ ok: true, request: row, replied: true, message: "Already marked and replied." });
    }

    let username = String(req.body?.username || row.username || "").trim();
    let amount = req.body?.amount != null ? Number(req.body.amount) : row.amount;
    if (!username || !Number.isFinite(amount) || amount <= 0) {
      const err = "Need an exact Juwa username and a positive amount before marking added.";
      if (row.conversationId) {
        await replyNotAddedErrorToPlayer(row, actorName(req), err).catch(() => {});
      }
      return res.status(400).json({
        error: err,
        request: row,
      });
    }
    amount = Math.round(amount * 100) / 100;
    const admin = actorName(req);

    store.updateRequest(row.id, {
      username,
      amount,
      status: "success",
      confirmedBy: admin,
      confirmedAt: Date.now(),
      missing: [],
      error: "",
      reason: "Marked added by admin",
      result: { ok: true, status: "success", detail: "Marked added by admin (manual)" },
    });
    store.addAudit({
      type: "marked_added",
      requestId: row.id,
      admin,
      username,
      amount,
      status: "success",
      conversationId: row.conversationId,
      message: "Admin marked funds added",
    });

    const fresh = store.getRequest(row.id);
    const reply = await replyAddedToPlayer(fresh, admin);
    if (!reply.ok && !reply.skipped) {
      return res.status(500).json({
        ok: false,
        error: reply.error || "Marked added but failed to reply to player",
        request: store.getRequest(row.id),
      });
    }

    res.json({
      ok: true,
      request: store.getRequest(row.id),
      replied: true,
      message: `Marked added and replied "${PLAYER_ADDED_REPLY}" to player.`,
    });
  });

  /**
   * Admin confirms in Lucky UI → only then run Juwa automation.
   * Optional overrides for username/amount when clarifying ambiguous chat.
   * On success, automatically replies "added" to the player chat.
   */
  app.post("/api/admin/juwa/requests/:id/confirm", auth, async (req, res) => {
    const row = store.getRequest(req.params.id);
    if (!row) return res.status(404).json({ error: "Request not found" });

    if (row.status === "success") {
      return res.status(409).json({ error: "Already completed. Idempotent block prevents double-add.", request: row });
    }
    if (running.has(row.id)) {
      return res.status(409).json({ error: "Automation already running for this request.", request: row });
    }

    let username = String(req.body?.username || row.username || "").trim();
    let amount = req.body?.amount != null ? Number(req.body.amount) : row.amount;
    if (!username || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({
        error: "Confirm requires an exact Juwa username and a positive amount. Do not guess.",
        request: row,
      });
    }
    amount = Math.round(amount * 100) / 100;

    const admin = actorName(req);
    store.updateRequest(row.id, {
      username,
      amount,
      status: "running",
      confirmedBy: admin,
      confirmedAt: Date.now(),
      missing: [],
      error: "",
    });
    store.addAudit({
      type: "confirmed",
      requestId: row.id,
      admin,
      username,
      amount,
      status: "running",
      conversationId: row.conversationId,
      message: "Admin confirmed in Lucky software",
    });

    running.add(row.id);
    // Respond immediately; client polls status. Automation continues server-side.
    res.json({
      ok: true,
      started: true,
      request: store.getRequest(row.id),
      message: "Automation started. If CAPTCHA appears, complete it in the browser window.",
    });

    try {
      const result = await runJuwaAddFunds({
        username,
        amount,
        onStatus: (s) => {
          store.updateRequest(row.id, { reason: String(s || "").slice(0, 240) });
        },
      });

      if (result.ok) {
        store.updateRequest(row.id, {
          status: "success",
          result,
          error: "",
          reason: result.detail || "Success",
        });
        store.addAudit({
          type: "success",
          requestId: row.id,
          admin,
          username,
          amount,
          status: "success",
          conversationId: row.conversationId,
          message: result.detail || "Juwa submit ok",
        });
        console.log(`[juwa] success request=${row.id} user=${username} amount=${amount} by=${admin}`);
        const fresh = store.getRequest(row.id);
        const reply = await replyAddedToPlayer(fresh, admin);
        if (!reply.ok && !reply.skipped) {
          console.warn(`[juwa] success but player reply failed: ${reply.error}`);
        }
        return;
      }

      const status = result.status === "awaiting_captcha" ? "awaiting_captcha" : "failed";
      store.updateRequest(row.id, {
        status,
        error: result.error || "Automation failed",
        result,
        reason: result.error || status,
      });
      store.addAudit({
        type: "failure",
        requestId: row.id,
        admin,
        username,
        amount,
        status,
        conversationId: row.conversationId,
        message: result.error || "Failed",
      });
      console.warn(`[juwa] ${status} request=${row.id}: ${result.error || "failed"}`);
      const freshFail = store.getRequest(row.id);
      const errReply = await replyNotAddedErrorToPlayer(
        freshFail,
        admin,
        result.error || status
      );
      if (!errReply.ok) {
        console.warn(`[juwa] failed to post error to chat: ${errReply.error}`);
      }
    } catch (err) {
      store.updateRequest(row.id, {
        status: "failed",
        error: err?.message || "Automation crashed",
      });
      store.addAudit({
        type: "failure",
        requestId: row.id,
        admin,
        username,
        amount,
        status: "failed",
        conversationId: row.conversationId,
        message: err?.message || "crash",
      });
      console.warn("[juwa] crash:", err?.message || err);
      const freshCrash = store.getRequest(row.id);
      await replyNotAddedErrorToPlayer(freshCrash, admin, err?.message || "Automation crashed").catch(
        () => {}
      );
    } finally {
      running.delete(row.id);
    }
  });

  app.post("/api/admin/juwa/requests/:id/cancel", auth, (req, res) => {
    const row = store.getRequest(req.params.id);
    if (!row) return res.status(404).json({ error: "Request not found" });
    if (row.status === "success") return res.status(409).json({ error: "Already completed" });
    const updated = store.updateRequest(row.id, { status: "cancelled", error: "Cancelled by admin" });
    store.addAudit({
      type: "cancelled",
      requestId: row.id,
      admin: actorName(req),
      username: row.username,
      amount: row.amount,
      status: "cancelled",
      conversationId: row.conversationId,
    });
    res.json({ ok: true, request: updated });
  });

  return { store, parseJuwaFundRequest };
}

module.exports = { mountJuwaApi, PLAYER_ADDED_REPLY };
