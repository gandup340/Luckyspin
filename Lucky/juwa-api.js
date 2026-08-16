const { parseJuwaFundRequest } = require("./juwa-parser");
const { createJuwaStore } = require("./juwa-store");
const { runJuwaAddFunds, juwaConfig } = require("./juwa-automation");

const PLAYER_ADDED_REPLY = "added";

function autoProcessEnabled() {
  const raw = String(process.env.JUWA_AUTO_PROCESS || "1").trim();
  return raw !== "0" && raw.toLowerCase() !== "false";
}

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
    return replyToPlayerChat(row, msg, admin, "player_error_replied");
  }

  /**
   * Run Juwa add-funds then reply "added" or "not added: …" in the player chat.
   * Fire-and-forget after marking the request running.
   */
  async function executeJuwaAdd(rowId, { username, amount, admin, auditMessage }) {
    if (running.has(rowId)) {
      return { ok: false, error: "Already running" };
    }
    const row = store.getRequest(rowId);
    if (!row) return { ok: false, error: "Request not found" };
    if (row.status === "success") {
      await replyAddedToPlayer(row, admin);
      return { ok: true, skipped: true };
    }

    username = String(username || row.username || "").trim();
    amount = Number(amount != null ? amount : row.amount);
    if (!username || !Number.isFinite(amount) || amount <= 0) {
      const err = "Exact Juwa username and positive amount required";
      store.updateRequest(rowId, { status: "needs_info", error: err, missing: ["username", "amount"].filter((k) => (k === "username" ? !username : !(amount > 0))) });
      await replyNotAddedErrorToPlayer(store.getRequest(rowId), admin, err);
      return { ok: false, error: err };
    }
    amount = Math.round(amount * 100) / 100;

    store.updateRequest(rowId, {
      username,
      amount,
      status: "running",
      confirmedBy: admin,
      confirmedAt: Date.now(),
      missing: [],
      error: "",
      reason: "Running Juwa add",
    });
    store.addAudit({
      type: "confirmed",
      requestId: rowId,
      admin,
      username,
      amount,
      status: "running",
      conversationId: row.conversationId,
      message: auditMessage || "Juwa add started",
    });

    running.add(rowId);
    try {
      const result = await runJuwaAddFunds({
        username,
        amount,
        onStatus: (s) => {
          store.updateRequest(rowId, { reason: String(s || "").slice(0, 240) });
        },
      });

      if (result.ok) {
        store.updateRequest(rowId, {
          status: "success",
          result,
          error: "",
          reason: result.detail || "Success",
        });
        store.addAudit({
          type: "success",
          requestId: rowId,
          admin,
          username,
          amount,
          status: "success",
          conversationId: row.conversationId,
          message: result.detail || "Juwa submit ok",
        });
        console.log(`[juwa] success request=${rowId} user=${username} amount=${amount} by=${admin}`);
        const fresh = store.getRequest(rowId);
        const reply = await replyAddedToPlayer(fresh, admin);
        if (!reply.ok && !reply.skipped) {
          console.warn(`[juwa] success but player reply failed: ${reply.error}`);
        }
        return { ok: true, request: store.getRequest(rowId) };
      }

      const status = result.status === "awaiting_captcha" ? "awaiting_captcha" : "failed";
      const errText = result.error || status;
      store.updateRequest(rowId, {
        status,
        error: errText,
        result,
        reason: errText,
      });
      store.addAudit({
        type: "failure",
        requestId: rowId,
        admin,
        username,
        amount,
        status,
        conversationId: row.conversationId,
        message: errText,
      });
      console.warn(`[juwa] ${status} request=${rowId}: ${errText}`);
      await replyNotAddedErrorToPlayer(store.getRequest(rowId), admin, errText);
      return { ok: false, status, error: errText, request: store.getRequest(rowId) };
    } catch (err) {
      const errText = err?.message || "Automation crashed";
      store.updateRequest(rowId, { status: "failed", error: errText });
      store.addAudit({
        type: "failure",
        requestId: rowId,
        admin,
        username,
        amount,
        status: "failed",
        conversationId: row.conversationId,
        message: errText,
      });
      console.warn("[juwa] crash:", errText);
      await replyNotAddedErrorToPlayer(store.getRequest(rowId), admin, errText);
      return { ok: false, error: errText, request: store.getRequest(rowId) };
    } finally {
      running.delete(rowId);
    }
  }

  /**
   * Customer chat → parse → add on Juwa (when clear) → reply added / not added: error.
   * Safe to call fire-and-forget from websocket / Facebook ingest.
   */
  async function handleCustomerJuwaMessage({ conversationId, messageId, text, recentText }) {
    const conversation = String(conversationId || "");
    const msgId = String(messageId || "");
    const combined = String(recentText || text || "").trim();
    const single = String(text || "").trim();
    if (!conversation || (!combined && !single)) return null;

    let parsed = parseJuwaFundRequest(combined);
    if (!parsed.intent && single && single !== combined) {
      parsed = parseJuwaFundRequest(single);
    }
    if (!parsed.intent) return null;

    return handleParsedCustomerRequest({
      conversationId: conversation,
      messageId: msgId,
      text: combined || single,
      parsed,
    });
  }

  async function handleParsedCustomerRequest({ conversationId, messageId, text, parsed }) {
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

    const row = created.request;
    if (!row) return null;

    store.addAudit({
      type: "request_created",
      requestId: row.id,
      admin: "auto",
      username: row.username,
      amount: row.amount,
      status: row.status,
      conversationId,
      message: created.reused ? "Reused from customer chat" : "Created from customer chat",
    });

    // Already completed earlier — remind player
    if (row.status === "success") {
      await replyAddedToPlayer(row, "auto");
      return row;
    }

    if (!parsed.ok || !row.username || !(Number(row.amount) > 0)) {
      const missing = (parsed.missing || []).join(", ") || "username or amount";
      await replyNotAddedErrorToPlayer(
        row,
        "auto",
        `send juwa username and amount (example: add to juwa vvkj1555 50). Missing: ${missing}`
      );
      return store.getRequest(row.id);
    }

    if (!autoProcessEnabled()) {
      await replyNotAddedErrorToPlayer(
        row,
        "auto",
        "waiting for support to confirm (auto-process off)"
      );
      return store.getRequest(row.id);
    }

    const cfg = juwaConfig();
    if (!cfg.enabled) {
      await replyNotAddedErrorToPlayer(row, "auto", "Juwa automation disabled on server");
      return store.getRequest(row.id);
    }
    if (!cfg.username || !cfg.password) {
      await replyNotAddedErrorToPlayer(row, "auto", "Juwa agent credentials not configured");
      return store.getRequest(row.id);
    }

    // Don't block chat thread — run add in background
    executeJuwaAdd(row.id, {
      username: row.username,
      amount: row.amount,
      admin: "auto",
      auditMessage: "Auto-started from customer chat",
    }).catch((err) => console.warn("[juwa] auto execute:", err?.message || err));

    return store.getRequest(row.id);
  }

  app.get("/api/admin/juwa/status", auth, (_req, res) => {
    const cfg = juwaConfig();
    res.json({
      automationEnabled: cfg.enabled,
      autoProcess: autoProcessEnabled(),
      credentialsConfigured: Boolean(cfg.username && cfg.password),
      loginUrl: cfg.loginUrl,
      userMgmtUrl: cfg.userMgmtUrl,
      headed: cfg.headed,
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
      return res.status(400).json({ error: err, request: row });
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

    res.json({
      ok: true,
      started: true,
      request: store.getRequest(row.id),
      message: "Automation started. Player will get added or not added: error in chat.",
    });

    executeJuwaAdd(row.id, {
      username,
      amount,
      admin,
      auditMessage: "Admin confirmed in Lucky software",
    }).catch((err) => console.warn("[juwa] confirm execute:", err?.message || err));
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

  return {
    store,
    parseJuwaFundRequest,
    handleCustomerJuwaMessage,
    executeJuwaAdd,
  };
}

module.exports = { mountJuwaApi, PLAYER_ADDED_REPLY, autoProcessEnabled };
