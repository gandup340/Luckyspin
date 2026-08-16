const { parseJuwaFundRequest } = require("./juwa-parser");
const { createJuwaStore } = require("./juwa-store");
const { runJuwaAddFunds, juwaConfig } = require("./juwa-automation");

function mountJuwaApi(app, { auth, requireAdmin, dataDir, readJson, writeJson }) {
  const store = createJuwaStore({ dataDir, readJson, writeJson });
  const running = new Set();

  function actorName(req) {
    return req.adminUser?.username || req.adminUser?.name || "admin";
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
      username: parsed.username,
      amount: parsed.amount,
      missing: parsed.missing,
      reason: parsed.reason,
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
   * Admin confirms in Lucky UI → only then run Juwa automation.
   * Optional overrides for username/amount when clarifying ambiguous chat.
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
        const updated = store.updateRequest(row.id, {
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
        return updated;
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

module.exports = { mountJuwaApi };
