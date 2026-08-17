#!/usr/bin/env python3
"""
Orion Stars login + recharge CLI for Lucky (called from Node).

Same ASP.NET Store.aspx flow as MilkyWay:
login (username / password / 5-digit code) → Store.aspx
→ search user → Update → Recharge → fill amount → Recharge
"""

from __future__ import annotations

import json
import os
import re
import sys
import threading
import time
import traceback
from typing import Any


def eprint(*args: Any) -> None:
    text = " ".join(str(a) for a in args)
    print(text.encode("ascii", "backslashreplace").decode("ascii"), file=sys.stderr, flush=True)


def emit(result: dict) -> None:
    sys.stdout.write(json.dumps(result, ensure_ascii=True))
    sys.stdout.write("\n")
    sys.stdout.flush()


def read_job() -> dict:
    raw = sys.stdin.read()
    if not raw.strip():
        raise SystemExit("Expected JSON job on stdin")
    return json.loads(raw)


def env(name: str, default: str = "") -> str:
    return str(os.environ.get(name, default) or "").strip()


CHROME_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)
LOGIN_PREFERRED = "https://orionstars.vip:8781/default.aspx"
STORE_DEFAULT = "https://orionstars.vip:8781/Store.aspx"


def launch_browser(p: Any, headed: bool) -> Any:
    # Headless-shell TLS fingerprint makes this IIS host return Runtime Error / 500.
    os.environ["PLAYWRIGHT_CHROMIUM_USE_HEADLESS_SHELL"] = "0"
    args = [
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--renderer-process-limit=1",
        "--ignore-certificate-errors",
        "--no-sandbox",
        "--disable-blink-features=AutomationControlled",
    ]
    bundled = {"headless": not headed, "args": args}
    chrome = {"headless": not headed, "channel": "chrome", "args": args}
    edge = {"headless": not headed, "channel": "msedge", "args": args}
    attempts = [chrome, edge, bundled] if os.name == "nt" else [bundled, chrome, edge]
    last_err: Exception | None = None
    for kwargs in attempts:
        try:
            return p.chromium.launch(**kwargs)
        except Exception as err:  # noqa: BLE001
            last_err = err
    raise last_err or RuntimeError("Could not launch Chromium")


def new_browser_context(browser: Any) -> Any:
    context = browser.new_context(
        viewport={"width": 1280, "height": 800},
        ignore_https_errors=True,
        user_agent=CHROME_UA,
        locale="en-US",
        extra_http_headers={
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        },
    )
    context.add_init_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")
    return context


def login_url_candidates(preferred: str) -> list[str]:
    ordered = [
        (preferred or "").strip(),
        LOGIN_PREFERRED,
        "https://orionstars.vip:8781/default.aspx",
        "https://orionstars.vip:8781/",
    ]
    out: list[str] = []
    for url in ordered:
        if url and url not in out:
            out.append(url)
    return out


def contexts(page: Any):
    yield page
    for fr in page.frames:
        if fr != page.main_frame:
            yield fr


def unquote_cred(value: str) -> str:
    s = str(value or "")
    if len(s) >= 2 and s[0] == s[-1] and s[0] in ("'", '"'):
        return s[1:-1]
    return s


def restore_orion_password(value: str) -> str:
    s = unquote_cred(value)
    if not s:
        return s
    if not s.endswith("#"):
        s += "#"
    if s.endswith("$#") and not s.endswith("$$#"):
        s = s[:-2] + "$$#"
    return s


def fill_first(page: Any, selectors: list[str], value: str) -> bool:
    for ctx in contexts(page):
        for sel in selectors:
            loc = ctx.locator(sel).first
            if loc.count() > 0:
                loc.fill(value, force=True, timeout=2500)
                try:
                    loc.evaluate(
                        """(el, v) => {
                          el.value = v;
                          el.dispatchEvent(new Event('input', { bubbles: true }));
                          el.dispatchEvent(new Event('change', { bubbles: true }));
                        }""",
                        value,
                    )
                except Exception:  # noqa: BLE001
                    pass
                return True
    return False


def click_first(page: Any, selectors: list[str]) -> bool:
    for ctx in contexts(page):
        for sel in selectors:
            loc = ctx.locator(sel).first
            if loc.count() > 0:
                loc.click(force=True, timeout=2500)
                return True
    return False


def poll(page: Any, fn: Any, timeout_s: float = 8, interval_ms: int = 120) -> Any:
    end = time.time() + timeout_s
    last: Any = None
    while time.time() < end:
        try:
            last = fn()
            if last:
                return last
        except Exception:  # noqa: BLE001
            pass
        page.wait_for_timeout(interval_ms)
    return last


def still_on_login(page: Any) -> bool:
    if "store.aspx" in page.url.lower():
        return False
    if page.locator("#txtLoginName, #btnLogin, input[name='txtLoginName']").count() > 0:
        return True
    return "login" in (page.title() or "").lower()


def page_hint(page: Any) -> str:
    title = ""
    body = ""
    fields = ""
    try:
        title = page.title() or ""
    except Exception:  # noqa: BLE001
        pass
    try:
        body = (page.locator("body").inner_text() or "").replace("\n", " ").strip()[:80]
    except Exception:  # noqa: BLE001
        pass
    try:
        names = []
        for ctx in contexts(page):
            names.extend(
                ctx.evaluate(
                    """() => [...document.querySelectorAll('input')].slice(0, 12).map(el =>
                      el.id || el.name || el.getAttribute('placeholder') || el.type || '')"""
                )
                or []
            )
        fields = ",".join(str(n) for n in names if n)
    except Exception:  # noqa: BLE001
        pass
    return f"url={page.url} title={title!r} fields={fields!r} body={body!r}"


LOGIN_USER_SELS = [
    "#txtLoginName",
    'input[name="txtLoginName"]',
    'input[placeholder*="username" i]',
    'input[placeholder*="user" i]',
    'input[id*="LoginName" i]',
    'input[name*="LoginName" i]',
]
LOGIN_PASS_SELS = [
    "#txtLoginPass",
    'input[name="txtLoginPass"]',
    'input[type="password"]',
    'input[id*="Pass" i]',
    'input[name*="Pass" i]',
]


def login_fields_present(page: Any) -> bool:
    return any(ctx.locator(sel).count() > 0 for ctx in contexts(page) for sel in LOGIN_USER_SELS)


def looks_like_aspnet_crash(page: Any) -> bool:
    if login_fields_present(page):
        return False
    title = ""
    body = ""
    try:
        title = (page.title() or "").lower()
    except Exception:  # noqa: BLE001
        title = ""
    try:
        body = (page.locator("body").inner_text() or "").lower()
    except Exception:  # noqa: BLE001
        body = ""
    return "runtime error" in title or "server error" in body or "application error" in body


def open_login_page(page: Any, login_url: str) -> str | None:
    last_nav = None
    last_crash = False
    for url in login_url_candidates(login_url):
        eprint(f"[orion] open login {url}")
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=15000)
            last_nav = None
        except Exception as err:  # noqa: BLE001
            last_nav = str(err)
            eprint(f"[orion] goto failed: {err}")
            continue
        if poll(page, lambda: login_fields_present(page), timeout_s=2.5, interval_ms=120):
            return None
        if looks_like_aspnet_crash(page):
            last_crash = True
            eprint(f"[orion] error page on {url}")
            continue
        last_crash = False
    if login_fields_present(page):
        return None
    if last_nav:
        return f"Orion login page would not load ({last_nav})"
    if last_crash:
        return f"Orion agent site is down (Runtime Error / 500). Open the panel in a browser and retry when login loads. ({page_hint(page)})"
    return f"Could not find Orion login fields ({page_hint(page)})"


def overlay_text(page: Any) -> str:
    chunks: list[str] = []
    for ctx in contexts(page):
        for sel in (
            "#alertOverlay",
            "#alertOverlay .alert-content",
            "#mb_msg",
            "#lblMsg",
            "#lblError",
            ".alert-overlay",
        ):
            loc = ctx.locator(sel).first
            if loc.count() == 0:
                continue
            try:
                t = (loc.inner_text() or "").replace("\n", " ").strip()
            except Exception:  # noqa: BLE001
                t = ""
            if t and t not in chunks:
                chunks.append(t)
    return " | ".join(chunks)[:220]


def login_page_hint(page: Any) -> str:
    alert = overlay_text(page)
    body = ""
    try:
        body = (page.locator("body").inner_text() or "").replace("\n", " ").strip()[:220]
    except Exception:  # noqa: BLE001
        body = ""
    # Form labels always include Username/Password — only classify from the alert.
    low = (alert or body).lower()
    captcha_kw = (
        "verification",
        "verify code",
        "invalid code",
        "wrong code",
        "incorrect code",
        "code error",
        "validate code",
        "验证",
    )
    if any(s in low for s in captcha_kw):
        return "wrong captcha"
    alert_low = alert.lower()
    if alert_low and any(s in alert_low for s in ("password", "account", "username", "user name")) and any(
        s in alert_low for s in ("invalid", "incorrect", "wrong", "fail")
    ):
        return "wrong credentials"
    if alert:
        return alert[:80]
    return body[:80]


def login_orion(page: Any, login_url: str, agent_user: str, agent_pass: str, solve_captcha: Any) -> str | None:
    open_err = open_login_page(page, login_url)
    if open_err:
        return open_err

    ready = poll(page, lambda: login_fields_present(page), timeout_s=8, interval_ms=150)
    if not ready:
        if looks_like_aspnet_crash(page):
            return f"Orion agent site is down (Runtime Error / 500). Open the panel in a browser and retry when login loads. ({page_hint(page)})"
        return f"Could not find Orion login fields ({page_hint(page)})"

    last_err = "captcha failed"
    deadline = time.time() + 55
    for attempt in range(4):
        if time.time() > deadline:
            return "Login timed out on captcha. Try again."
        if not still_on_login(page):
            return None
        dismiss_overlays(page)
        ok_user = fill_first(page, LOGIN_USER_SELS, agent_user)
        ok_pass = fill_first(page, LOGIN_PASS_SELS, agent_pass)
        if not ok_user or not ok_pass:
            return f"Could not find Orion login fields ({page_hint(page)})"
        try:
            code = solve_captcha(
                page,
                {"expected_len": 5, "login_url": login_url, "max_attempts": 3, "style": "aspnet"},
            )
        except Exception as err:  # noqa: BLE001
            last_err = f"solve_captcha failed: {err}"
            eprint(f"[orion] captcha attempt {attempt + 1}: {last_err}")
            page.wait_for_timeout(300)
            continue
        filled = fill_first(
            page,
            ["#txtVerifyCode", 'input[name="txtVerifyCode"]', 'input[placeholder="Code"]'],
            code,
        )
        if not filled:
            return "Could not find Orion verification code field"
        eprint(f"[orion] filled code {code} ({len(code)} digits), login attempt {attempt + 1}")
        if not click_first(page, ["#btnLogin", 'input[name="btnLogin"]', 'input[value*="Login" i]']):
            page.keyboard.press("Enter")
        left = poll(page, lambda: not still_on_login(page), timeout_s=6, interval_ms=150)
        if left:
            return None
        hint = login_page_hint(page)
        last_err = (
            f"Still on Orion login after submit ({hint or 'wrong code or credentials'}); "
            f"agent={agent_user} passLen={len(agent_pass)} v=33"
        )
        eprint(f"[orion] {last_err}")
        img = page.locator("#imgCode, #imgVerify, #Image1, img[src*='ValidateCode' i]").first
        if img.count() > 0:
            try:
                img.click(timeout=2000)
            except Exception:  # noqa: BLE001
                pass
            page.wait_for_timeout(400)
    return last_err


def loc_if(locator: Any) -> Any | None:
    return locator if locator is not None and locator.count() > 0 else None


def accounts_frame(page: Any) -> Any | None:
    for fr in page.frames:
        url = (fr.url or "").lower()
        if "granttreasure" in url:
            continue
        if "accountslist" in url or "/module/accountmanager/" in url:
            return fr
    return None


def grant_frame(page: Any) -> Any | None:
    for fr in page.frames:
        url = (fr.url or "").lower()
        title = ""
        try:
            title = (fr.title() or "").lower()
        except Exception:  # noqa: BLE001
            title = ""
        if "404" in title or "file or directory not found" in title:
            continue
        if "granttreasure" in url:
            return fr
        try:
            if fr.locator("#txtAddGold, input[name='txtAddGold']").count() > 0:
                return fr
        except Exception:  # noqa: BLE001
            pass
    return None


def find_recharge_button(ctx: Any, target: str) -> Any | None:
    row = loc_if(ctx.locator("tr").filter(has_text=target).first)
    if row is not None:
        btn = loc_if(row.locator("a.btn-danger:has-text('Recharge'), a[onclick*='Recharge']").first)
        if btn is not None:
            return btn
        btn = loc_if(row.get_by_text("Recharge", exact=True).first)
        if btn is not None:
            return btn
    links = ctx.locator("a[onclick*='Recharge'], a.btn-danger:has-text('Recharge')")
    try:
        n = min(links.count(), 12)
    except Exception:  # noqa: BLE001
        n = 0
    for i in range(n):
        el = links.nth(i)
        onclick = ""
        try:
            onclick = el.get_attribute("onclick") or ""
        except Exception:  # noqa: BLE001
            onclick = ""
        if "showDialog('0'" in onclick or 'showDialog("0"' in onclick:
            continue
        if loc_if(el) is not None:
            eprint(f"[orion] recharge onclick={onclick[:80]}")
            return el
    return None


def find_search_box(ctx: Any) -> Any | None:
    return (
        loc_if(ctx.get_by_placeholder("ID or Account"))
        or loc_if(ctx.locator('input[placeholder*="ID" i], input[placeholder*="account" i]').first)
        or loc_if(
            ctx.locator(
                "input:not([type='hidden']):not([type='password']):not([type='submit']):not([type='button'])"
            ).first
        )
    )


def dismiss_overlays(page: Any) -> None:
    for _ in range(6):
        acted = False
        for ctx in list(contexts(page)):
            overlay = ctx.locator("#alertOverlay.show, #alertOverlay:visible, .alert-overlay.show, .modal.show")
            if overlay.count() == 0:
                continue
            eprint("[orion] dismissing overlay")
            for sel in (
                "#alertOverlay input[value='OK']",
                "#alertOverlay button:has-text('OK')",
                "#alertOverlay a:has-text('OK')",
                "#alertOverlay .btn-ok",
                "#alertOverlay .close",
                "input[value='OK']",
                "button:has-text('OK')",
                "a:has-text('OK')",
            ):
                btn = ctx.locator(sel).first
                if btn.count() > 0:
                    try:
                        btn.click(force=True, timeout=1500)
                        acted = True
                        break
                    except Exception:  # noqa: BLE001
                        pass
            try:
                ctx.evaluate(
                    """() => {
                      const el = document.getElementById('alertOverlay');
                      if (el) { el.classList.remove('show'); el.style.display = 'none'; }
                    }"""
                )
                acted = True
            except Exception:  # noqa: BLE001
                pass
        if not acted:
            return
        page.wait_for_timeout(250)


def wait_for_store_ready(page: Any) -> Any | None:
    try:
        page.wait_for_selector("iframe", timeout=4000)
    except Exception:  # noqa: BLE001
        pass

    def ready() -> Any | None:
        ctx = accounts_frame(page)
        if ctx is None:
            return None
        return ctx if find_search_box(ctx) is not None else None

    ctx = poll(page, ready, timeout_s=10, interval_ms=120)
    if ctx:
        eprint("[orion] store ready")
    return ctx


def go_to_store(page: Any, store_url: str) -> str | None:
    eprint(f"[orion] open store {store_url}")
    try:
        page.goto(store_url, wait_until="domcontentloaded", timeout=20000)
    except Exception as err:  # noqa: BLE001
        return f"Orion Store.aspx would not load ({err})"
    if still_on_login(page):
        return "Redirected to Orion login on Store.aspx"
    return None


def dump_store(page: Any, label: str) -> str:
    urls = []
    for fr in page.frames:
        urls.append((fr.url or "")[:120])
    eprint(f"[orion] dump {label} frames={urls}")
    ctx = accounts_frame(page) or page
    text = ""
    try:
        text = (ctx.locator("body").inner_text() or "").replace("\n", " | ").strip()[:450]
        eprint(f"[orion] body {text}")
    except Exception as err:  # noqa: BLE001
        eprint(f"[orion] body err {err}")
    try:
        controls = ctx.evaluate(
            """() => [...document.querySelectorAll('input,button,a')].slice(0, 50).map(el => ({
              tag: el.tagName, id: el.id, name: el.name, type: el.type,
              value: (el.value || '').slice(0, 24), ph: el.placeholder || '',
              text: (el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 24)
            }))"""
        )
        eprint(f"[orion] controls {controls}")
    except Exception as err:  # noqa: BLE001
        eprint(f"[orion] controls err {err}")
    try:
        links = ctx.locator("a[onclick*='Recharge'], a:has-text('Recharge')")
        n = min(links.count(), 8)
        for i in range(n):
            el = links.nth(i)
            eprint(f"[orion] link[{i}] text={(el.inner_text() or '').strip()[:24]!r} onclick={(el.get_attribute('onclick') or '')[:90]!r}")
    except Exception as err:  # noqa: BLE001
        eprint(f"[orion] link dump err {err}")
    try:
        rows = ctx.evaluate(
            """() => [...document.querySelectorAll('table tr')].slice(0, 20).map(tr =>
              (tr.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 140))"""
        )
        eprint(f"[orion] rows {rows}")
    except Exception as err:  # noqa: BLE001
        eprint(f"[orion] rows err {err}")
    return text


def row_for_user(ctx: Any, target: str) -> Any | None:
    return loc_if(ctx.locator("tr").filter(has_text=target).first) or loc_if(
        ctx.locator("tr").filter(has_text=target.lower()).first
    )


def refresh_accounts(page: Any, fallback: Any) -> Any:
    ctx = accounts_frame(page)
    if ctx is not None:
        return ctx
    ready = wait_for_store_ready(page)
    return ready if ready is not None else fallback


def find_update_button(ctx: Any, target: str) -> Any | None:
    row = loc_if(ctx.locator("tr").filter(has_text=target).first)
    if row is None:
        row = loc_if(ctx.locator("tr").filter(has_text=target.lower()).first)
    for label in ("Update", "Edit", "Modify"):
        if row is not None:
            btn = loc_if(row.get_by_text(label, exact=True))
            if btn is not None:
                return btn
        btn = loc_if(ctx.get_by_text(label, exact=True).first)
        if btn is not None:
            return btn
    return loc_if(ctx.locator("a[onclick*='Update' i], input[value*='Update' i]").first)


def search_and_recharge(page: Any, store_url: str, target: str, amount_str: str, alerts: list[str] | None = None) -> dict:
    alerts = alerts if alerts is not None else []
    eprint(f"[orion] store search {target} amount={amount_str} url={page.url}")
    if "store.aspx" not in page.url.lower():
        store_err = go_to_store(page, store_url)
        if store_err:
            return {"ok": False, "status": "store_failed", "error": store_err}
    dismiss_overlays(page)
    ctx = wait_for_store_ready(page)
    if ctx is None:
        ctx = page
    ctx = refresh_accounts(page, ctx)
    if still_on_login(page):
        return {"ok": False, "status": "login_failed", "error": "Redirected to Orion login on Store.aspx"}

    search = loc_if(ctx.locator("#txtSearch, input[name='txtSearch']").first) or find_search_box(ctx)
    if search is None:
        dump_store(page, "no_search")
        return {"ok": False, "status": "search_field_not_found", "error": "Could not find Orion search box"}

    search.fill(target, force=True)
    page.wait_for_timeout(200)
    eprint("[orion] submit search via __doPostBack")
    how = ctx.evaluate(
        """(user) => {
          const input = document.getElementById('txtSearch');
          if (input) {
            input.value = user;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
          }
          const a = [...document.querySelectorAll('a')].find((el) => (el.innerText || '').trim() === 'Search');
          const href = a && a.getAttribute('href') || '';
          const m = href.match(/__doPostBack\\('([^']*)','([^']*)'\\)/);
          if (m && typeof __doPostBack === 'function') {
            __doPostBack(m[1], m[2]);
            return 'postback:' + m[1];
          }
          if (a) { a.click(); return 'click'; }
          return 'none';
        }""",
        target,
    )
    eprint(f"[orion] search submit {how}")
    page.wait_for_timeout(800)

    def row_ready() -> Any | None:
        fresh = refresh_accounts(page, ctx)
        return row_for_user(fresh, target)

    row = poll(page, row_ready, timeout_s=8, interval_ms=150)
    if row is None:
        hint = dump_store(page, "after_search")
        return {
            "ok": False,
            "status": "update_not_found",
            "error": f"Could not find Update for {target}" + (f" ({hint[:180]})" if hint else ""),
        }
    ctx = refresh_accounts(page, ctx)
    acc_id = None
    update_href = ""
    try:
        text = (row.inner_text() or "").replace("\n", " ")
        m = re.search(r"\b(\d{5,})\b", text)
        acc_id = m.group(1) if m else None
        upd = loc_if(row.get_by_text("Update", exact=True))
        if upd is not None:
            update_href = upd.get_attribute("href") or ""
    except Exception:  # noqa: BLE001
        acc_id = None
    eprint(f"[orion] account id={acc_id} update_href={update_href[:90]!r}")
    try:
        eprint(
            "[orion] row html "
            + (row.evaluate("el => el.outerHTML") or "")[:900].replace("\n", " ")
        )
        eprint(
            "[orion] row links "
            + str(
                row.evaluate(
                    """el => [...el.querySelectorAll('a,*[onclick]')].map(a => ({
                      tag: a.tagName, id: a.id,
                      href: a.getAttribute('href') || '',
                      onclick: (a.getAttribute('onclick') || '').slice(0, 120),
                      text: (a.innerText || '').trim().slice(0, 40)
                    }))"""
                )
            )
        )
    except Exception as err:  # noqa: BLE001
        eprint(f"[orion] row dump err {err}")
    try:
        row.click(force=True, timeout=2500)
        page.wait_for_timeout(200)
    except Exception as err:  # noqa: BLE001
        eprint(f"[orion] row click err {err}")
    try:
        upd = loc_if(row.locator("a, *[onclick]").filter(has_text="Update").first)
        if upd is not None:
            upd.click(force=True, timeout=2500)
            page.wait_for_timeout(400)
            ctx = refresh_accounts(page, ctx)
    except Exception as err:  # noqa: BLE001
        eprint(f"[orion] update click err {err}")

    opened = False
    if acc_id:
        try:
            how = ctx.evaluate(
                """({ id, user }) => {
                  const uid = document.getElementById('txtUserID');
                  const gid = document.getElementById('txtGameID');
                  const before = {
                    uid: uid && (uid.innerText || uid.value || ''),
                    gid: gid && (gid.innerText || gid.value || ''),
                  };
                  const set = (el, val) => {
                    if (!el) return;
                    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') el.value = val;
                    else el.innerText = val;
                  };
                  if (!(before.uid || '').trim()) set(uid, id);
                  if (!(before.gid || '').trim()) set(gid, id);
                  if (typeof showDialog !== 'function') {
                    return JSON.stringify({ ok: false, err: 'no local showDialog', before });
                  }
                  showDialog(0, 'Recharge', 900, 450);
                  return JSON.stringify({
                    ok: true,
                    before,
                    uid: uid && (uid.innerText || uid.value),
                    gid: gid && (gid.innerText || gid.value),
                  });
                }""",
                {"id": acc_id, "user": target},
            )
            eprint(f"[orion] showDialog {how}")
            opened = '"ok":true' in str(how).replace(" ", "")
        except Exception as err:  # noqa: BLE001
            eprint(f"[orion] showDialog err {err}")

    if not opened:
        recharge_open = find_recharge_button(refresh_accounts(page, ctx), target)
        if recharge_open is None:
            dump_store(page, "after_update")
            return {"ok": False, "status": "recharge_not_found", "error": "Could not find Recharge after Update"}
        try:
            recharge_open.click(force=True, timeout=5000)
        except Exception:  # noqa: BLE001
            recharge_open.evaluate("el => el.click()")

    dlg = poll(page, lambda: grant_frame(page), timeout_s=12, interval_ms=200)
    if dlg is None:
        page.wait_for_timeout(1500)
        for fr in page.frames:
            extra = ""
            try:
                extra = f" gold={fr.locator('#txtAddGold').count()} title={(fr.title() or '')[:40]!r}"
            except Exception:  # noqa: BLE001
                extra = ""
            eprint(f"[orion] frame2 {(fr.url or '')[:160]}{extra}")
        try:
            info = page.evaluate(
                """() => ({
                  iframes: [...document.querySelectorAll('iframe')].map(i => i.src || i.id || i.name),
                  mb: (document.getElementById('mb_box') || document.getElementById('mb_con') || {outerHTML:''}).outerHTML.slice(0, 400)
                })"""
            )
            eprint(f"[orion] parent dialog {info}")
        except Exception as err:  # noqa: BLE001
            eprint(f"[orion] parent dialog err {err}")
        try:
            ctx2 = accounts_frame(page)
            if ctx2 is not None:
                info = ctx2.evaluate(
                    """() => ({
                      iframes: [...document.querySelectorAll('iframe')].map(i => i.src || i.id || i.name),
                      mb: (document.getElementById('mb_box') || document.getElementById('mb_con') || {outerHTML:''}).outerHTML.slice(0, 500)
                    })"""
                )
                eprint(f"[orion] list dialog {info}")
        except Exception as err:  # noqa: BLE001
            eprint(f"[orion] list dialog err {err}")
        dump_store(page, "after_recharge_click")
        return {"ok": False, "status": "recharge_dialog_not_found", "error": "Recharge dialog did not open"}
    eprint(f"[orion] recharge dialog url={dlg.url}")
    try:
        dlg.wait_for_load_state("domcontentloaded", timeout=8000)
    except Exception:  # noqa: BLE001
        pass

    def gold_target() -> Any | None:
        for fr in page.frames:
            try:
                loc = fr.locator("#txtAddGold, input[name='txtAddGold']").first
                if loc.count() > 0:
                    return (fr, loc)
            except Exception:  # noqa: BLE001
                continue
        return None

    found = poll(page, gold_target, timeout_s=10, interval_ms=200)
    if found is None:
        loc = dlg.locator("input[type='text']:not([disabled]):not([readonly])").first
        found = (dlg, loc) if loc.count() > 0 else None
    if found is None:
        try:
            eprint(f"[orion] dialog title={(dlg.title() or '')[:80]!r}")
            eprint(f"[orion] dialog body={(dlg.locator('body').inner_text() or '')[:400]!r}")
            eprint(f"[orion] dialog html={(dlg.content() or '')[:800]!r}")
            eprint(f"[orion] all frames {[fr.url[:120] for fr in page.frames]}")
        except Exception as err:  # noqa: BLE001
            eprint(f"[orion] dialog dump err {err}")
        return {"ok": False, "status": "amount_field_not_found", "error": "Recharge amount box not found"}
    gold_fr, amount_box = found
    eprint(f"[orion] amount box on {gold_fr.url[:120]}")
    try:
        fields = gold_fr.evaluate(
            """() => [...document.querySelectorAll('input,button,textarea')].slice(0, 25).map(el => ({
              id: el.id, name: el.name, type: el.type, value: (el.value || '').slice(0, 40),
              onclick: (el.getAttribute('onclick') || '').slice(0, 80)
            }))"""
        )
        eprint(f"[orion] grant fields {fields}")
        eprint(f"[orion] grant body={(gold_fr.locator('body').inner_text() or '')[:250]!r}")
    except Exception as err:  # noqa: BLE001
        eprint(f"[orion] grant fields err {err}")

    def fill_named(fid: str, val: str) -> None:
        loc = gold_fr.locator(f"#{fid}, input[name='{fid}']").first
        if loc.count() == 0:
            return
        try:
            loc.fill(val, force=True, timeout=2000)
        except Exception:  # noqa: BLE001
            loc.evaluate("(el, v) => { el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); }", val)

    if acc_id:
        fill_named("textGameID", acc_id)
        fill_named("textAccounts", target)
    fill_named("txtAddGold", amount_str)
    filled = ""
    try:
        filled = gold_fr.locator("#txtAddGold").input_value()
    except Exception:  # noqa: BLE001
        filled = ""
    eprint(f"[orion] txtAddGold={filled!r} gameid={gold_fr.locator('#textGameID').input_value() if gold_fr.locator('#textGameID').count() else ''} acct={gold_fr.locator('#textAccounts').input_value() if gold_fr.locator('#textAccounts').count() else ''}")
    if str(filled).strip() != str(amount_str).strip():
        return {"ok": False, "status": "amount_not_set", "error": f"Amount box shows {filled!r}, not {amount_str}"}

    confirm = gold_fr.locator("#Button1, input[name='Button1']").first
    if confirm.count() == 0:
        confirm = gold_fr.locator("input[type='submit'][value='Recharge'], input[value='Recharge']").first
    if confirm.count() == 0:
        return {"ok": False, "status": "recharge_confirm_not_found", "error": "Could not find Recharge confirm"}
    eprint(f"[orion] click confirm id={confirm.get_attribute('id')!r} value={confirm.get_attribute('value')!r}")
    try:
        confirm.click(timeout=5000)
    except Exception:  # noqa: BLE001
        confirm.click(force=True, timeout=5000)

    def outcome() -> str | None:
        blobs = list(alerts)
        for fr in page.frames:
            try:
                blobs.append(fr.locator("body").inner_text() or "")
            except Exception:  # noqa: BLE001
                continue
        text = " ".join(blobs)
        low = text.lower()
        if "confirmed successful" in low:
            return "success"
        if "operation failed" in low:
            idx = low.find("operation failed")
            return "error:" + text[idx : idx + 40].replace("\n", " ")
        if "please select" in low or "not in a correct format" in low:
            return "error:" + text.replace("\n", " ")[:180]
        return None

    result_kind = poll(page, outcome, timeout_s=8, interval_ms=200)
    eprint(f"[orion] after confirm alerts={alerts!r} kind={result_kind!r}")
    try:
        eprint(f"[orion] grant body={(gold_fr.locator('body').inner_text() or '')[:300]!r}")
    except Exception:  # noqa: BLE001
        pass
    try:
        ok_btn = page.get_by_text("OK", exact=True).last
        if ok_btn.count() > 0:
            ok_btn.click(timeout=2500)
    except Exception:  # noqa: BLE001
        pass

    if result_kind != "success" and not any("success" in str(a).lower() for a in alerts):
        return {
            "ok": False,
            "status": "recharge_not_confirmed",
            "error": f"Orion did not confirm the add ({result_kind or 'no success message'})",
        }

    return {
        "ok": True,
        "status": "success",
        "game": "orion",
        "detail": f"Orion recharged {amount_str} for {target}",
    }


def main() -> int:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        emit(
            {
                "ok": False,
                "status": "python_deps_missing",
                "error": "Install: pip install -r juwa_python/requirements.txt && playwright install chromium",
            }
        )
        return 2

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    try:
        from solve_captcha import solve_captcha
    except Exception as err:  # noqa: BLE001
        emit({"ok": False, "status": "import_error", "error": f"solve_captcha import failed: {err}"})
        return 2

    job = read_job()
    target = str(job.get("targetUsername") or "").strip()
    amount = float(job.get("amount") or 0)
    login_url = str(job.get("loginUrl") or env("ORION_LOGIN_URL", LOGIN_PREFERRED))
    store_url = str(job.get("storeUrl") or env("ORION_STORE_URL", STORE_DEFAULT))
    agent_user = unquote_cred(str(job.get("agentUsername") or env("ORION_AGENT_USERNAME"))).strip()
    agent_pass = restore_orion_password(str(job.get("agentPassword") or env("ORION_AGENT_PASSWORD")))
    headed = bool(job.get("headed", env("JUWA_HEADED", "0") != "0"))
    timeout_ms = int(job.get("timeoutMs") or env("ORION_TIMEOUT_MS") or env("JUWA_TIMEOUT_MS", "75000") or 75000)
    amount_str = str(int(amount) if float(amount).is_integer() else amount)

    if not target or amount <= 0:
        emit({"ok": False, "status": "invalid", "error": "targetUsername and positive amount required"})
        return 1
    if not agent_user or not agent_pass:
        emit({"ok": False, "status": "misconfigured", "error": "Orion agent credentials missing"})
        return 1

    def hard_stop() -> None:
        try:
            emit({"ok": False, "status": "timeout", "error": "Orion add timed out. Try again."})
        except Exception:  # noqa: BLE001
            pass
        os._exit(1)

    killer = threading.Timer(max(25.0, timeout_ms / 1000.0 - 8.0), hard_stop)
    killer.daemon = True
    killer.start()

    def done(result: dict, code: int) -> int:
        killer.cancel()
        emit(result)
        return code

    try:
        with sync_playwright() as p:
            browser = launch_browser(p, headed)
            context = new_browser_context(browser)
            page = context.new_page()
            page.set_default_timeout(8000)
            alerts: list[str] = []

            def on_dialog(dialog: Any) -> None:
                msg = dialog.message or ""
                eprint(f"[orion] js-dialog {dialog.type}: {msg}")
                alerts.append(msg)
                dialog.accept()

            page.on("dialog", on_dialog)

            login_err = login_orion(page, login_url, agent_user, agent_pass, solve_captcha)
            if login_err:
                return done({"ok": False, "status": "login_failed", "error": login_err}, 1)

            dismiss_overlays(page)
            store_err = go_to_store(page, store_url)
            if store_err:
                return done({"ok": False, "status": "store_failed", "error": store_err}, 1)

            result = search_and_recharge(page, store_url, target, amount_str, alerts)
            return done(result, 0 if result.get("ok") else 1)

    except Exception as err:  # noqa: BLE001
        eprint(traceback.format_exc())
        return done({"ok": False, "status": "crash", "error": str(err)}, 1)


if __name__ == "__main__":
    raise SystemExit(main())
