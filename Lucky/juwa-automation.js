/**
 * Juwa agent portal automation (Playwright).
 * - Credentials only from env
 * - Optional Python bridge (JUWA_PYTHON_BRIDGE=1) for YOUR captcha code
 * - Node path never auto-solves CAPTCHA; waits for human if challenged
 */

const { spawn } = require("child_process");
const path = require("path");

function envUnquote(value) {
  const s = String(value || "");
  if (s.length >= 2 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) {
    return s.slice(1, -1);
  }
  return s;
}

function juwaConfig() {
  return {
    enabled: String(process.env.JUWA_AUTOMATION_ENABLED || "").trim() === "1",
    loginUrl: String(process.env.JUWA_LOGIN_URL || "https://ht.juwa777.com/login").trim(),
    userMgmtUrl: String(process.env.JUWA_USER_MGMT_URL || "https://ht.juwa777.com/userManagement").trim(),
    username: envUnquote(process.env.JUWA_AGENT_USERNAME || "").trim(),
    password: envUnquote(process.env.JUWA_AGENT_PASSWORD || ""),
    headed: String(process.env.JUWA_HEADED || "0").trim() !== "0",
    timeoutMs: Number(process.env.JUWA_TIMEOUT_MS || 90000),
    captchaWaitMs: Number(process.env.JUWA_CAPTCHA_WAIT_MS || 90000),
    pythonBridge: String(process.env.JUWA_PYTHON_BRIDGE || "1").trim() !== "0",
    pythonBin: String(process.env.JUWA_PYTHON_BIN || "python").trim() || "python",
    pythonScript: String(
      process.env.JUWA_PYTHON_SCRIPT || path.join(__dirname, "juwa_python", "juwa_login_add.py")
    ).trim(),
  };
}

function milkywayConfig() {
  const timeoutMs = Number(process.env.MILKYWAY_TIMEOUT_MS || 90000);
  return {
    enabled: String(process.env.MILKYWAY_AUTOMATION_ENABLED || process.env.JUWA_AUTOMATION_ENABLED || "").trim() === "1",
    loginUrl: String(process.env.MILKYWAY_LOGIN_URL || "https://milkywayapp.xyz:8781/default.aspx?639225872727471705").trim(),
    storeUrl: String(process.env.MILKYWAY_STORE_URL || "https://milkywayapp.xyz:8781/Store.aspx").trim(),
    username: envUnquote(process.env.MILKYWAY_AGENT_USERNAME || "").trim(),
    password: envUnquote(process.env.MILKYWAY_AGENT_PASSWORD || ""),
    headed: String(process.env.JUWA_HEADED || "0").trim() !== "0",
    timeoutMs,
    captchaWaitMs: timeoutMs,
    pythonBin: String(process.env.JUWA_PYTHON_BIN || "python").trim() || "python",
    pythonScript: String(
      process.env.MILKYWAY_PYTHON_SCRIPT || path.join(__dirname, "juwa_python", "milkyway_login_add.py")
    ).trim(),
  };
}

function orionConfig() {
  const timeoutMs = Number(process.env.ORION_TIMEOUT_MS || 75000);
  return {
    enabled: String(process.env.ORION_AUTOMATION_ENABLED || process.env.JUWA_AUTOMATION_ENABLED || "").trim() === "1",
    loginUrl: String(process.env.ORION_LOGIN_URL || "https://orionstars.vip:8781/default.aspx").trim(),
    storeUrl: String(process.env.ORION_STORE_URL || "https://orionstars.vip:8781/Store.aspx").trim(),
    username: envUnquote(process.env.ORION_AGENT_USERNAME || "").trim(),
    password: envUnquote(process.env.ORION_AGENT_PASSWORD || ""),
    headed: String(process.env.JUWA_HEADED || "0").trim() !== "0",
    timeoutMs,
    captchaWaitMs: timeoutMs,
    pythonBin: String(process.env.JUWA_PYTHON_BIN || "python").trim() || "python",
    pythonScript: String(
      process.env.ORION_PYTHON_SCRIPT || path.join(__dirname, "juwa_python", "orion_login_add.py")
    ).trim(),
  };
}

function gamevaultConfig() {
  const timeoutMs = Number(process.env.GAMEVAULT_TIMEOUT_MS || 90000);
  return {
    enabled: String(process.env.GAMEVAULT_AUTOMATION_ENABLED || process.env.JUWA_AUTOMATION_ENABLED || "").trim() === "1",
    loginUrl: String(process.env.GAMEVAULT_LOGIN_URL || "https://agent.gamevault999.com/login").trim(),
    userMgmtUrl: String(process.env.GAMEVAULT_USER_MGMT_URL || "https://agent.gamevault999.com/userManagement").trim(),
    username: envUnquote(process.env.GAMEVAULT_AGENT_USERNAME || "").trim(),
    password: envUnquote(process.env.GAMEVAULT_AGENT_PASSWORD || ""),
    headed: String(process.env.JUWA_HEADED || "0").trim() !== "0",
    timeoutMs,
    captchaWaitMs: timeoutMs,
    pythonBin: String(process.env.JUWA_PYTHON_BIN || "python").trim() || "python",
    pythonScript: String(
      process.env.GAMEVAULT_PYTHON_SCRIPT || path.join(__dirname, "juwa_python", "gamevault_login_add.py")
    ).trim(),
  };
}

function gameConfig(game) {
  if (game === "milkyway") return milkywayConfig();
  if (game === "gamevault") return gamevaultConfig();
  if (game === "orion") return orionConfig();
  return juwaConfig();
}

function maskUser(u) {
  if (!u) return "";
  if (u.length <= 2) return "*";
  return `${u.slice(0, 1)}***${u.slice(-1)}`;
}

async function loadPlaywright() {
  try {
    return require("playwright");
  } catch {
    const err = new Error(
      "Playwright is not installed. Run: npm i playwright && npx playwright install chromium"
    );
    err.code = "PLAYWRIGHT_MISSING";
    throw err;
  }
}

/**
 * Run Lucky/juwa_python/juwa_login_add.py (your captcha lives in solve_captcha.py).
 */
function killPythonTree(child) {
  if (!child) return;
  const pid = child.pid;
  if (!pid) return;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      return;
    }
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      /* ignore */
    }
  }
}

function runPythonBridge(job, cfg, log, extra = {}) {
  return new Promise((resolve) => {
    const payload = {
      targetUsername: String(job.username || "").trim(),
      amount: Number(job.amount),
      loginUrl: cfg.loginUrl,
      userMgmtUrl: cfg.userMgmtUrl,
      storeUrl: cfg.storeUrl,
      agentUsername: cfg.username,
      agentPassword: cfg.password,
      headed: cfg.headed,
      timeoutMs: cfg.timeoutMs,
      ...extra,
    };

    log(`Python bridge: ${cfg.pythonBin} ${path.basename(cfg.pythonScript)}`);
    const child = spawn(cfg.pythonBin, [cfg.pythonScript], {
      cwd: path.dirname(cfg.pythonScript),
      env: { ...process.env, PLAYWRIGHT_CHROMIUM_USE_HEADLESS_SHELL: "0" },
      windowsHide: true,
      detached: process.platform !== "win32",
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const limitMs = Math.max(20000, Number(cfg.timeoutMs) || 75000);

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      killPythonTree(child);
      resolve(result);
    };

    const killTimer = setTimeout(() => {
      finish({
        ok: false,
        status: "timeout",
        error: `Add-funds timed out after ${Math.round(limitMs / 1000)}s`,
      });
    }, limitMs);

    child.stdout.on("data", (buf) => {
      stdout += String(buf);
    });
    child.stderr.on("data", (buf) => {
      stderr += String(buf);
      const line = String(buf).trim();
      if (line) log(line.slice(0, 200));
    });

    child.on("error", (err) => {
      finish({
        ok: false,
        status: "python_spawn_failed",
        error: err.message || "Could not start Python bridge",
      });
    });

    child.on("close", (code) => {
      const lines = stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      const last = lines[lines.length - 1] || "";
      try {
        const parsed = JSON.parse(last);
        if (parsed && typeof parsed === "object") {
          finish(parsed);
          return;
        }
      } catch {
        /* fall through */
      }
      finish({
        ok: false,
        status: "python_bad_output",
        error:
          last.slice(0, 240) ||
          stderr.slice(0, 240) ||
          `Python bridge exited with code ${code} and no JSON result`,
      });
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

function looksLikeCaptcha(pageContent, url) {
  const t = String(pageContent || "").toLowerCase();
  const u = String(url || "").toLowerCase();
  return (
    u.includes("login") &&
    (/\bcaptcha\b/.test(t) ||
      /self[-\s]?identification/.test(t) ||
      /verification\s*code/.test(t) ||
      /i'?m not a robot/.test(t))
  );
}

/**
 * @param {{
 *   username: string,
 *   amount: number,
 *   onStatus?: (s: string) => void,
 *   shouldAbort?: () => boolean,
 * }} job
 */
async function runAddFunds(job) {
  const game = String(job.game || "juwa").toLowerCase();
  if (game === "milkyway") {
    const cfg = milkywayConfig();
    const log = (s) => {
      try {
        job.onStatus?.(s);
      } catch {
        /* ignore */
      }
    };
    if (!cfg.enabled) {
      return {
        ok: false,
        status: "disabled",
        error: "MilkyWay automation is disabled. Set MILKYWAY_AUTOMATION_ENABLED=1 or JUWA_AUTOMATION_ENABLED=1.",
      };
    }
    if (!cfg.username || !cfg.password) {
      return {
        ok: false,
        status: "misconfigured",
        error: "MilkyWay agent credentials missing. Set MILKYWAY_AGENT_USERNAME and MILKYWAY_AGENT_PASSWORD.",
      };
    }
    const targetUser = String(job.username || "").trim();
    const amount = Number(job.amount);
    if (!targetUser || !Number.isFinite(amount) || amount <= 0) {
      return { ok: false, status: "invalid", error: "Valid MilkyWay username and amount are required." };
    }
    log("Using Python MilkyWay bridge (search → Update → Recharge)");
    return runPythonBridge(job, cfg, log);
  }
  if (game === "gamevault") {
    const cfg = gamevaultConfig();
    const log = (s) => {
      try {
        job.onStatus?.(s);
      } catch {
        /* ignore */
      }
    };
    if (!cfg.enabled) {
      return {
        ok: false,
        status: "disabled",
        error: "GameVault automation is disabled. Set GAMEVAULT_AUTOMATION_ENABLED=1 or JUWA_AUTOMATION_ENABLED=1.",
      };
    }
    if (!cfg.username || !cfg.password) {
      return {
        ok: false,
        status: "misconfigured",
        error: "GameVault agent credentials missing. Set GAMEVAULT_AGENT_USERNAME and GAMEVAULT_AGENT_PASSWORD.",
      };
    }
    const targetUser = String(job.username || "").trim();
    const amount = Number(job.amount);
    if (!targetUser || !Number.isFinite(amount) || amount <= 0) {
      return { ok: false, status: "invalid", error: "Valid GameVault username and amount are required." };
    }
    log("Using Python GameVault bridge (search → editor → Recharge)");
    return runPythonBridge(job, cfg, log);
  }
  if (game === "orion") {
    const cfg = orionConfig();
    const log = (s) => {
      try {
        job.onStatus?.(s);
      } catch {
        /* ignore */
      }
    };
    if (!cfg.enabled) {
      return {
        ok: false,
        status: "disabled",
        error: "Orion automation is disabled. Set ORION_AUTOMATION_ENABLED=1 or JUWA_AUTOMATION_ENABLED=1.",
      };
    }
    if (!cfg.username || !cfg.password) {
      return {
        ok: false,
        status: "misconfigured",
        error: "Orion agent credentials missing. Set ORION_AGENT_USERNAME and ORION_AGENT_PASSWORD.",
      };
    }
    const targetUser = String(job.username || "").trim();
    const amount = Number(job.amount);
    if (!targetUser || !Number.isFinite(amount) || amount <= 0) {
      return { ok: false, status: "invalid", error: "Valid Orion username and amount are required." };
    }
    log("Using Python Orion bridge (search → Update → Recharge)");
    return runPythonBridge(job, cfg, log);
  }
  return runJuwaAddFunds(job);
}

async function runJuwaAddFunds(job) {
  const cfg = juwaConfig();
  const log = (s) => {
    try {
      job.onStatus?.(s);
    } catch {
      /* ignore */
    }
  };

  if (!cfg.enabled) {
    return {
      ok: false,
      status: "disabled",
      error: "Juwa automation is disabled. Set JUWA_AUTOMATION_ENABLED=1 on the server.",
    };
  }
  if (!cfg.username || !cfg.password) {
    return {
      ok: false,
      status: "misconfigured",
      error: "Juwa agent credentials missing. Set JUWA_AGENT_USERNAME and JUWA_AGENT_PASSWORD in server env.",
    };
  }

  const targetUser = String(job.username || "").trim();
  const amount = Number(job.amount);
  if (!targetUser || !Number.isFinite(amount) || amount <= 0) {
    return { ok: false, status: "invalid", error: "Valid Juwa username and amount are required." };
  }

  if (cfg.pythonBridge) {
    log("Using Python Juwa bridge (captcha + recharge)");
    return runPythonBridge(job, cfg, log);
  }

  const playwright = await loadPlaywright();
  log(`Launching browser (credentials user=${maskUser(cfg.username)})`);

  const browser = await playwright.chromium.launch({
    headless: !cfg.headed,
    args: ["--disable-dev-shm-usage"],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  try {
    if (job.shouldAbort?.()) throw Object.assign(new Error("Aborted"), { code: "ABORTED" });

    log("Opening Juwa login page");
    await page.goto(cfg.loginUrl, { waitUntil: "domcontentloaded", timeout: cfg.timeoutMs });

    // Fill login fields without logging secrets
    const userSel = [
      'input[name="username"]',
      'input[name="user"]',
      'input[name="account"]',
      'input[type="text"]',
      "#username",
      "#user",
    ];
    const passSel = ['input[type="password"]', 'input[name="password"]', "#password"];

    let filledUser = false;
    for (const sel of userSel) {
      const el = page.locator(sel).first();
      if ((await el.count()) > 0) {
        await el.fill(cfg.username);
        filledUser = true;
        break;
      }
    }
    let filledPass = false;
    for (const sel of passSel) {
      const el = page.locator(sel).first();
      if ((await el.count()) > 0) {
        await el.fill(cfg.password);
        filledPass = true;
        break;
      }
    }
    if (!filledUser || !filledPass) {
      return {
        ok: false,
        status: "login_form_not_found",
        error: "Could not find Juwa login fields. Update selectors for the current Juwa UI.",
      };
    }

    // Optional captcha text field — never auto-solve; admin must type if required.
    const bodyText = await page.locator("body").innerText().catch(() => "");
    if (looksLikeCaptcha(bodyText, page.url())) {
      log("CAPTCHA / self-identification detected — complete it in the browser window, then wait");
      // Do not fill captcha automatically.
      const loginBtn = page.locator('button[type="submit"], button:has-text("Login"), button:has-text("Sign in"), input[type="submit"]').first();
      // Wait until we leave login OR admin completed captcha + login
      const deadline = Date.now() + cfg.captchaWaitMs;
      let leftLogin = false;
      while (Date.now() < deadline) {
        if (job.shouldAbort?.()) throw Object.assign(new Error("Aborted"), { code: "ABORTED" });
        const url = page.url();
        if (!/login/i.test(url)) {
          leftLogin = true;
          break;
        }
        // If login button exists and captcha may already be filled by human, try click once periodically
        await page.waitForTimeout(1500);
      }
      if (!leftLogin) {
        // Try one submit in case human filled captcha already
        if ((await loginBtn.count()) > 0) {
          await loginBtn.click().catch(() => {});
          await page.waitForTimeout(2000);
        }
        if (/login/i.test(page.url())) {
          return {
            ok: false,
            status: "awaiting_captcha",
            error:
              "CAPTCHA still present. Complete self-identification in the opened browser, then retry Confirm.",
          };
        }
      }
    } else {
      const loginBtn = page.locator('button[type="submit"], button:has-text("Login"), button:has-text("Sign in"), input[type="submit"]').first();
      if ((await loginBtn.count()) > 0) await loginBtn.click();
      else await page.keyboard.press("Enter");
      await page.waitForTimeout(1500);
      const after = await page.locator("body").innerText().catch(() => "");
      if (looksLikeCaptcha(after, page.url()) || /login/i.test(page.url())) {
        log("Login held for manual CAPTCHA completion");
        const deadline = Date.now() + cfg.captchaWaitMs;
        while (Date.now() < deadline) {
          if (job.shouldAbort?.()) throw Object.assign(new Error("Aborted"), { code: "ABORTED" });
          if (!/login/i.test(page.url())) break;
          await page.waitForTimeout(1500);
        }
        if (/login/i.test(page.url())) {
          return {
            ok: false,
            status: "awaiting_captcha",
            error: "CAPTCHA required. Complete it in the browser window, then retry.",
          };
        }
      }
    }

    log("Opening User Management");
    await page.goto(cfg.userMgmtUrl, { waitUntil: "domcontentloaded", timeout: cfg.timeoutMs });
    await page.waitForTimeout(1000);

    // Search box heuristics
    const searchBoxes = [
      'input[placeholder*="user" i]',
      'input[placeholder*="search" i]',
      'input[name*="user" i]',
      'input[type="search"]',
      'input[type="text"]',
    ];
    let searched = false;
    for (const sel of searchBoxes) {
      const el = page.locator(sel).first();
      if ((await el.count()) > 0 && (await el.isVisible().catch(() => false))) {
        await el.fill("");
        await el.fill(targetUser);
        await el.press("Enter").catch(() => {});
        searched = true;
        break;
      }
    }
    await page.waitForTimeout(1200);

    // Exact username match in table/list
    const exact = page.locator(`text="${targetUser}"`).first();
    const exactCount = await page.locator(`text="${targetUser}"`).count();
    if (exactCount === 0) {
      return {
        ok: false,
        status: "user_not_found",
        error: `No Juwa user found matching "${targetUser}".`,
        searched,
      };
    }
    if (exactCount > 8) {
      // Too many loose matches — require row-level unique match
      log("Multiple text matches; attempting row-level exact match");
    }

    const row = page.locator("tr", { hasText: targetUser }).first();
    const rowCount = await page.locator("tr", { hasText: targetUser }).count();
    if (rowCount === 0) {
      // fallback: click the exact text
      await exact.click();
    } else if (rowCount > 1) {
      // Prefer exact cell match
      let unique = null;
      for (let i = 0; i < rowCount; i += 1) {
        const r = page.locator("tr", { hasText: targetUser }).nth(i);
        const txt = (await r.innerText().catch(() => "")).trim();
        const tokens = txt.split(/\s+/);
        if (tokens.includes(targetUser)) {
          if (unique) {
            return {
              ok: false,
              status: "ambiguous_user",
              error: `Multiple Juwa rows match "${targetUser}". Resolve manually.`,
            };
          }
          unique = r;
        }
      }
      if (!unique) {
        return {
          ok: false,
          status: "ambiguous_user",
          error: `Could not uniquely match username "${targetUser}".`,
        };
      }
      const editBtn = unique.locator('button:has-text("Edit"), a:has-text("Edit"), button:has-text("Editor"), a:has-text("Editor")').first();
      if ((await editBtn.count()) > 0) await editBtn.click();
      else await unique.click();
    } else {
      const editBtn = row.locator('button:has-text("Edit"), a:has-text("Edit"), button:has-text("Editor"), a:has-text("Editor")').first();
      if ((await editBtn.count()) > 0) await editBtn.click();
      else await row.click();
    }

    await page.waitForTimeout(800);

    // Amount field heuristics (points / balance / money / amount)
    const amountSelectors = [
      'input[name*="amount" i]',
      'input[name*="balance" i]',
      'input[name*="point" i]',
      'input[name*="money" i]',
      'input[placeholder*="amount" i]',
      'input[placeholder*="balance" i]',
      'input[type="number"]',
    ];
    let amountFilled = false;
    for (const sel of amountSelectors) {
      const el = page.locator(sel).first();
      if ((await el.count()) > 0 && (await el.isVisible().catch(() => false))) {
        await el.fill(String(amount));
        amountFilled = true;
        break;
      }
    }
    if (!amountFilled) {
      return {
        ok: false,
        status: "amount_field_not_found",
        error: "Opened user editor but could not find an amount field. Adjust Juwa selectors.",
      };
    }

    // Submit / save / add / confirm on Juwa side
    const submit = page
      .locator(
        'button:has-text("Save"), button:has-text("Submit"), button:has-text("Confirm"), button:has-text("Add"), button:has-text("OK"), button[type="submit"]'
      )
      .first();
    if ((await submit.count()) === 0) {
      return {
        ok: false,
        status: "submit_not_found",
        error: "Amount entered but submit/save button was not found.",
      };
    }
    await submit.click();
    await page.waitForTimeout(1500);

    const resultText = (await page.locator("body").innerText().catch(() => "")).slice(0, 500);
    const failed = /fail|error|invalid|not found|denied/i.test(resultText) && /success|saved|ok|成功/i.test(resultText) === false;

    if (failed) {
      return {
        ok: false,
        status: "juwa_rejected",
        error: "Juwa returned an error-like response after submit. Verify manually.",
        detail: resultText.slice(0, 240),
      };
    }

    log("Juwa submit completed");
    return {
      ok: true,
      status: "success",
      username: targetUser,
      amount,
      detail: "Submitted in Juwa user management. Verify balance in Juwa UI.",
    };
  } catch (err) {
    if (err?.code === "ABORTED") {
      return { ok: false, status: "aborted", error: "Automation aborted." };
    }
    return {
      ok: false,
      status: "error",
      error: err?.message || "Juwa automation failed",
    };
  } finally {
    // Keep headed browser briefly so admin can verify; always close.
    try {
      await page.waitForTimeout(cfg.headed ? 2500 : 200);
    } catch {
      /* ignore */
    }
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

module.exports = {
  juwaConfig,
  milkywayConfig,
  gamevaultConfig,
  orionConfig,
  gameConfig,
  runJuwaAddFunds,
  runAddFunds,
  looksLikeCaptcha,
};
