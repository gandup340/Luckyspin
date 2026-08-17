const { parseJuwaFundRequest, parseFollowUpUsername, parseFollowUpAmount, parseFollowUpGame } = require("./juwa-parser");
const { createJuwaStore } = require("./juwa-store");
const { runAddFunds, juwaConfig, milkywayConfig, gamevaultConfig, orionConfig } = require("./juwa-automation");
const { gameLabel, askGameText, isSupportedGame, supportedGameIds } = require("./fund-games");

const ASK_AMOUNT = "How much should we add? Reply with the amount (example: 20).";
const ASK_USERNAME = "What is your username? Reply with your account.";
const PLAYER_ADDED_REPLY = "added";

function envFlagOn(name, defaultOn = true) {
  const raw = String(process.env[name] ?? (defaultOn ? "1" : "")).trim().toLowerCase();
  if (!raw) return defaultOn;
  return raw !== "0" && raw !== "false" && raw !== "off";
}

function autoProcessEnabled(gameId) {
  const g = String(gameId || "").toLowerCase();
  if (g === "gamevault" && String(process.env.GAMEVAULT_AUTO_PROCESS || "").trim() !== "") {
    return envFlagOn("GAMEVAULT_AUTO_PROCESS");
  }
  if (g === "orion" && String(process.env.ORION_AUTO_PROCESS || "").trim() !== "") {
    return envFlagOn("ORION_AUTO_PROCESS");
  }
  if (g === "milkyway" && String(process.env.MILKYWAY_AUTO_PROCESS || "").trim() !== "") {
    return envFlagOn("MILKYWAY_AUTO_PROCESS");
  }
  return envFlagOn("JUWA_AUTO_PROCESS");
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

  function addedReply(row) {
    const game = gameLabel(row.game);
    const amount = row.amount;
    const username = row.username;
    if (username && amount != null) {
      return `added ${amount} to ${username} on ${game}`;
    }
    return `added on ${game}`;
  }

  function askUsernameText(gameId) {
    if (!gameId) return ASK_USERNAME;
    return `What is your ${gameLabel(gameId)} username? Reply with your account.`;
  }

  function computeMissing({ game, username, amount }) {
    const missing = [];
    if (!(Number(amount) > 0)) missing.push("amount");
    if (!username) missing.push("username");
    if (!game) missing.push("game");
    return missing;
  }

  function askNextMissing(row, missing) {
    const need = missing || row.missing || [];
    if (need.includes("amount")) return ASK_AMOUNT;
    if (need.includes("username")) return askUsernameText(row.game);
    if (need.includes("game")) return askGameText(row.username);
    return ASK_USERNAME;
  }

  async function replyAddedToPlayer(row, admin) {
    if (row.playerRepliedAt) return { ok: true, skipped: true };
    return replyToPlayerChat(row, addedReply(row), admin, "player_replied");
  }

  async function replyNotAddedErrorToPlayer(row, admin, errorText) {
    const msg = `not added: ${shortError(errorText)}`;
    return replyToPlayerChat(row, msg, admin, "player_error_replied");
  }

  /**
   * Run Juwa add-funds then reply "added" or "not added: …" in the player chat.
   * Fire-and-forget after marking the request running.
   */
  async function executeJuwaAdd(rowId, { username, amount, admin, auditMessage, game: gameArg }) {
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
    const game = String(gameArg || row.game || "").toLowerCase();
    if (!game || !isSupportedGame(game)) {
      const err = `Which game is required — reply ${supportedGameIds().join(" or ")}`;
      store.updateRequest(rowId, { status: "needs_info", error: err, missing: ["game"] });
      await replyNotAddedErrorToPlayer(store.getRequest(rowId), admin, err);
      return { ok: false, error: err };
    }
    if (!username || !Number.isFinite(amount) || amount <= 0) {
      const err = "Exact username and positive amount required";
      store.updateRequest(rowId, { status: "needs_info", error: err, missing: ["username", "amount"].filter((k) => (k === "username" ? !username : !(amount > 0))) });
      await replyNotAddedErrorToPlayer(store.getRequest(rowId), admin, err);
      return { ok: false, error: err };
    }
    amount = Math.round(amount * 100) / 100;

    store.updateRequest(rowId, {
      username,
      amount,
      game,
      status: "running",
      confirmedBy: admin,
      confirmedAt: Date.now(),
      missing: [],
      error: "",
      reason: `Running ${gameLabel(game)} add`,
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
      const result = await Promise.race([
        runAddFunds({
          username,
          amount,
          game,
          onStatus: (s) => {
            store.updateRequest(rowId, { reason: String(s || "").slice(0, 240) });
          },
        }),
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve({
                ok: false,
                status: "timeout",
                error: "Add-funds took too long. Try again.",
              }),
            game === "orion" ? 85000 : 100000
          );
        }),
      ]);

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
        console.log(`[${game}] success request=${rowId} user=${username} amount=${amount} by=${admin}`);
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

  async function replyAskPlayer(row, text, admin) {
    return replyToPlayerChat(row, text, admin || "auto", "player_asked");
  }

  function addingNowText(username, amount, gameId) {
    return `Adding ${amount} to ${username} on ${gameLabel(gameId)} now. I'll reply when it's done.`;
  }

  function credentialsForGame(gameId) {
    if (gameId === "milkyway") {
      const cfg = milkywayConfig();
      return { enabled: cfg.enabled, username: cfg.username, password: cfg.password, name: "MilkyWay" };
    }
    if (gameId === "orion") {
      const cfg = orionConfig();
      return { enabled: cfg.enabled, username: cfg.username, password: cfg.password, name: "Orion" };
    }
    if (gameId === "gamevault") {
      const cfg = gamevaultConfig();
      return { enabled: cfg.enabled, username: cfg.username, password: cfg.password, name: "GameVault" };
    }
    const cfg = juwaConfig();
    return { enabled: cfg.enabled, username: cfg.username, password: cfg.password, name: "Juwa" };
  }

  async function startAddIfReady(row, admin, auditMessage) {
    const username = String(row.username || "").trim();
    const amount = Number(row.amount);
    const game = String(row.game || "").toLowerCase();
    if (!game || !username || !Number.isFinite(amount) || amount <= 0) return row;

    if (!autoProcessEnabled(game)) {
      await replyAskPlayer(
        row,
        "Got it — waiting for support to confirm (auto-process off).",
        admin
      );
      return store.getRequest(row.id);
    }
    const creds = credentialsForGame(game);
    if (!creds.enabled) {
      await replyNotAddedErrorToPlayer(row, admin, `${creds.name} automation disabled on server`);
      return store.getRequest(row.id);
    }
    if (!creds.username || !creds.password) {
      await replyNotAddedErrorToPlayer(row, admin, `${creds.name} agent credentials not configured`);
      return store.getRequest(row.id);
    }

    await replyAskPlayer(row, addingNowText(username, amount, game), admin);
    executeJuwaAdd(row.id, {
      username,
      amount,
      game,
      admin: admin || "auto",
      auditMessage: auditMessage || "Auto-started from customer chat",
    }).catch((err) => console.warn("[juwa] auto execute:", err?.message || err));
    return store.getRequest(row.id);
  }

  /**
   * Customer chat → parse → ask for missing username/amount → add on Juwa.
   */
  async function handleCustomerJuwaMessage({ conversationId, messageId, text, recentText }) {
    const conversation = String(conversationId || "");
    const msgId = String(messageId || "");
    const single = String(text || "").trim();
    if (!conversation || !single) return null;

    let parsed = parseJuwaFundRequest(single);

    const open = store.findOpenByConversation(conversation);

    if (!parsed.intent) {
      if (!open) return null;
      const followGame = parseFollowUpGame(single);
      const followUser = parseFollowUpUsername(single);
      const followAmt = parseFollowUpAmount(single);
      if (!followGame && !followUser && followAmt == null) return null;

      const game = followGame || open.game || null;
      const username = followUser || open.username;
      const amount = followAmt != null ? followAmt : open.amount;
      const missing = computeMissing({ game, username, amount });

      store.updateRequest(open.id, {
        game,
        username: username || null,
        amount: Number(amount) > 0 ? amount : open.amount,
        missing,
        status: game && username && Number(amount) > 0 ? "pending_review" : "needs_info",
        reason: missing.length ? `Need: ${missing.join(", ")}` : `Ready to add on ${game}`,
        messageId: msgId || open.messageId,
        messageText: `${open.messageText || ""}\n${single}`.trim().slice(0, 2000),
        error: "",
      });
      const row = store.getRequest(open.id);
      store.addAudit({
        type: "follow_up",
        requestId: row.id,
        admin: "auto",
        username: row.username,
        amount: row.amount,
        status: row.status,
        conversationId: conversation,
        message: "Merged follow-up from customer chat",
      });
      if (missing.length) {
        await replyAskPlayer(row, askNextMissing(row, missing), "auto");
        return store.getRequest(row.id);
      }
      return startAddIfReady(row, "auto", "Completed from chat follow-up");
    }

    return handleParsedCustomerRequest({
      conversationId: conversation,
      messageId: msgId,
      text: single,
      parsed,
      open,
    });
  }

  async function handleParsedCustomerRequest({ conversationId, messageId, text, parsed, open }) {
    const username = parsed.username || (parsed.usernames && parsed.usernames[0]) || open?.username || null;
    const amount = parsed.amount != null ? parsed.amount : open?.amount;
    const game = parsed.game || open?.game || null;
    const missing = computeMissing({ game, username, amount });
    const ready = Boolean(game && username && Number(amount) > 0);

    let row;
    if (open) {
      store.updateRequest(open.id, {
        game,
        username: username || null,
        amount: Number(amount) > 0 ? amount : null,
        missing,
        usernames: parsed.usernames || open.usernames || [],
        reason: ready ? `Ready to add on ${game}` : `Need: ${missing.join(", ")}`,
        status: ready ? "pending_review" : "needs_info",
        messageId: messageId || open.messageId,
        messageText: text,
        error: "",
      });
      row = store.getRequest(open.id);
    } else {
      const created = store.createRequest({
        ok: ready,
        conversationId,
        messageId,
        messageText: text,
        game,
        username,
        amount: Number(amount) > 0 ? amount : null,
        missing,
        reason: ready ? `Ready to add on ${game}` : `Need: ${missing.join(", ")}`,
        usernames: parsed.usernames || [],
      });
      row = created.request;
      if (!row) return null;
    }

    store.addAudit({
      type: "request_created",
      requestId: row.id,
      admin: "auto",
      username: row.username,
      amount: row.amount,
      status: row.status,
      conversationId,
      message: open ? "Updated from customer chat" : "Created from customer chat",
    });

    if (row.status === "success") {
      await replyAddedToPlayer(row, "auto");
      return row;
    }

    if (!ready) {
      await replyAskPlayer(row, askNextMissing(row, missing), "auto");
      return store.getRequest(row.id);
    }

    return startAddIfReady(row, "auto", "Auto-started from customer chat");
  }

  app.get("/api/admin/juwa/status", auth, (_req, res) => {
    const cfg = juwaConfig();
    const mw = milkywayConfig();
    const gv = gamevaultConfig();
    const orion = orionConfig();
    res.json({
      automationEnabled: cfg.enabled,
      autoProcess: autoProcessEnabled(),
      pythonBridge: Boolean(cfg.pythonBridge),
      credentialsConfigured: Boolean(cfg.username && cfg.password),
      loginUrl: cfg.loginUrl,
      userMgmtUrl: cfg.userMgmtUrl,
      headed: cfg.headed,
      milkyway: {
        automationEnabled: mw.enabled,
        autoProcess: autoProcessEnabled("milkyway"),
        credentialsConfigured: Boolean(mw.username && mw.password),
        loginUrl: mw.loginUrl,
        storeUrl: mw.storeUrl,
      },
      gamevault: {
        automationEnabled: gv.enabled,
        autoProcess: autoProcessEnabled("gamevault"),
        credentialsConfigured: Boolean(gv.username && gv.password),
        loginUrl: gv.loginUrl,
        userMgmtUrl: gv.userMgmtUrl,
      },
      orion: {
        automationEnabled: orion.enabled,
        autoProcess: autoProcessEnabled("orion"),
        credentialsConfigured: Boolean(orion.username && orion.password),
        loginUrl: orion.loginUrl,
        storeUrl: orion.storeUrl,
      },
    });
  });

  app.post("/api/admin/juwa/parse", auth, (req, res) => {
    const parsed = parseJuwaFundRequest(req.body?.text || "");
    res.json({ ok: true, parsed });
  });

  app.post("/api/admin/juwa/requests", auth, async (req, res) => {
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
      game: parsed.game || null,
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

    let request = created.request;
    if (parsed.ok && request && !created.error) {
      request = await startAddIfReady(request, actorName(req), "Auto-started from chat (no admin confirm)");
    }

    res.json({ ...created, request, parsed });
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
    const game = String(req.body?.game || row.game || "").toLowerCase();
    if (!username || !Number.isFinite(amount) || amount <= 0) {
      const err = "Need an exact username and a positive amount before marking added.";
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
      game: game || row.game || null,
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
      message: `Marked added and replied "${addedReply(store.getRequest(row.id))}" to player.`,
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
    const game = String(req.body?.game || row.game || "").toLowerCase();
    if (!username || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({
        error: "Confirm requires an exact username and a positive amount. Do not guess.",
        request: row,
      });
    }
    if (!game || !isSupportedGame(game)) {
      return res.status(400).json({
        error: `Confirm requires a game (${supportedGameIds().join(" or ")}).`,
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
      game,
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
