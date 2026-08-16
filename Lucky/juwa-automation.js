/**
 * Juwa agent portal automation (Playwright).
 * - Credentials only from env
 * - Never bypasses CAPTCHA; waits for human if challenged
 * - Separated from chat parsing for independent testing
 */

function juwaConfig() {
  return {
    enabled: String(process.env.JUWA_AUTOMATION_ENABLED || "").trim() === "1",
    loginUrl: String(process.env.JUWA_LOGIN_URL || "https://ht.juwa777.com/login").trim(),
    userMgmtUrl: String(process.env.JUWA_USER_MGMT_URL || "https://ht.juwa777.com/userManagement").trim(),
    username: String(process.env.JUWA_AGENT_USERNAME || "").trim(),
    password: String(process.env.JUWA_AGENT_PASSWORD || ""),
    headed: String(process.env.JUWA_HEADED || "1").trim() !== "0",
    timeoutMs: Number(process.env.JUWA_TIMEOUT_MS || 180000),
    captchaWaitMs: Number(process.env.JUWA_CAPTCHA_WAIT_MS || 300000),
  };
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
  runJuwaAddFunds,
  looksLikeCaptcha,
};
