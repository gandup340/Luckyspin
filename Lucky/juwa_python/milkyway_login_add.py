#!/usr/bin/env python3
"""
MilkyWay login + recharge CLI for Lucky (called from Node).

Flow: login (username / password / 5-digit code) → Store.aspx
      → search user → Update → Recharge → fill amount → Recharge
"""

from __future__ import annotations

import json
import os
import sys
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


def launch_browser(p: Any, headed: bool) -> Any:
    args = ["--disable-dev-shm-usage"]
    attempts = [
        {"headless": not headed, "channel": "chrome", "args": args},
        {"headless": not headed, "channel": "msedge", "args": args},
        {"headless": not headed, "args": args},
    ]
    last_err: Exception | None = None
    for kwargs in attempts:
        try:
            return p.chromium.launch(**kwargs)
        except Exception as err:  # noqa: BLE001
            last_err = err
    raise last_err or RuntimeError("Could not launch Chromium")


def fill_first(page: Any, selectors: list[str], value: str) -> bool:
    for sel in selectors:
        loc = page.locator(sel).first
        if loc.count() > 0:
            loc.fill(value)
            return True
    return False


def click_first(page: Any, selectors: list[str]) -> bool:
    for sel in selectors:
        loc = page.locator(sel).first
        if loc.count() > 0:
            loc.click()
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


def login_milkyway(page: Any, login_url: str, agent_user: str, agent_pass: str, solve_captcha: Any) -> str | None:
    eprint(f"[milkyway] open login {login_url}")
    page.goto(login_url, wait_until="domcontentloaded")
    try:
        page.locator("#txtLoginName").wait_for(state="visible", timeout=5000)
    except Exception:  # noqa: BLE001
        page.wait_for_timeout(200)

    ok_user = fill_first(
        page,
        ["#txtLoginName", 'input[name="txtLoginName"]', 'input[placeholder*="username" i]'],
        agent_user,
    )
    ok_pass = fill_first(
        page,
        ["#txtLoginPass", 'input[name="txtLoginPass"]', 'input[type="password"]'],
        agent_pass,
    )
    if not ok_user or not ok_pass:
        return "Could not find MilkyWay login fields"

    last_err = "captcha failed"
    for attempt in range(5):
        if not still_on_login(page):
            return None
        try:
            code = solve_captcha(page, {"expected_len": 5, "login_url": login_url})
        except Exception as err:  # noqa: BLE001
            last_err = f"solve_captcha failed: {err}"
            eprint(f"[milkyway] captcha attempt {attempt + 1}: {last_err}")
            page.wait_for_timeout(250)
            continue
        filled = fill_first(
            page,
            ["#txtVerifyCode", 'input[name="txtVerifyCode"]', 'input[placeholder="Code"]'],
            code,
        )
        if not filled:
            return "Could not find MilkyWay verification code field"
        eprint(f"[milkyway] filled code ({len(code)} digits), login attempt {attempt + 1}")
        if not click_first(page, ["#btnLogin", 'input[name="btnLogin"]', 'input[value*="Login" i]']):
            page.keyboard.press("Enter")
        left = poll(page, lambda: not still_on_login(page), timeout_s=6, interval_ms=150)
        if left:
            return None
        last_err = "Still on MilkyWay login after submit (wrong code or credentials)"
        eprint(f"[milkyway] {last_err}")
        img = page.locator("#imgCode, #imgVerify, #Image1, img[src*='ValidateCode' i]").first
        if img.count() > 0:
            img.click()
            page.wait_for_timeout(350)
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
        if "granttreasure" in (fr.url or "").lower():
            return fr
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
        eprint("[milkyway] store ready")
    return ctx


def search_and_recharge(page: Any, store_url: str, target: str, amount_str: str) -> dict:
    eprint(f"[milkyway] store search {target} amount={amount_str} url={page.url}")
    if "store.aspx" not in page.url.lower():
        page.goto(store_url, wait_until="domcontentloaded")
    ctx = wait_for_store_ready(page)
    if ctx is None:
        ctx = page
    if still_on_login(page):
        return {"ok": False, "status": "login_failed", "error": "Redirected to MilkyWay login on Store.aspx"}

    search = find_search_box(ctx)
    if search is None:
        return {"ok": False, "status": "search_field_not_found", "error": "Could not find MilkyWay search box"}

    search.fill(target)
    if not click_first(
        ctx,
        [
            'input[value*="Search" i]',
            'button:has-text("Search")',
            'a:has-text("Search")',
            "#btnSearch",
        ],
    ):
        search.press("Enter")

    row = poll(
        page,
        lambda: loc_if(ctx.locator("tr").filter(has_text=target).first),
        timeout_s=5,
        interval_ms=120,
    )
    update_btn = loc_if(row.get_by_text("Update", exact=True)) if row is not None else None
    if update_btn is None:
        update_btn = loc_if(ctx.get_by_text("Update", exact=True).first)
    if update_btn is None:
        return {"ok": False, "status": "update_not_found", "error": f"Could not find Update for {target}"}
    update_btn.click(timeout=5000)

    recharge_open = poll(
        page,
        lambda: loc_if(ctx.locator("a.btn-danger:has-text('Recharge'), a[onclick*='Recharge']").first)
        or loc_if(ctx.get_by_text("Recharge", exact=True).first),
        timeout_s=4,
        interval_ms=100,
    )
    if recharge_open is None:
        return {"ok": False, "status": "recharge_not_found", "error": "Could not find Recharge after Update"}
    recharge_open.click(timeout=5000)

    dlg = poll(page, lambda: grant_frame(page), timeout_s=6, interval_ms=100)
    if dlg is None:
        return {"ok": False, "status": "recharge_dialog_not_found", "error": "Recharge dialog did not open"}
    eprint("[milkyway] recharge dialog")
    try:
        dlg.locator("#txtAddGold").wait_for(state="visible", timeout=5000)
    except Exception:  # noqa: BLE001
        pass

    amount_box = dlg.locator("#txtAddGold, input[name='txtAddGold']").first
    if amount_box.count() == 0:
        amount_box = dlg.locator("input[type='text']:not([disabled]):not([readonly])").first
    if amount_box.count() == 0:
        return {"ok": False, "status": "amount_field_not_found", "error": "Recharge amount box not found"}
    amount_box.fill(amount_str, timeout=5000)

    confirm = dlg.locator("#Button1, input[name='Button1'], input[value='Recharge']").first
    if confirm.count() == 0:
        return {"ok": False, "status": "recharge_confirm_not_found", "error": "Could not find Recharge confirm"}
    confirm.click(timeout=5000)

    poll(
        page,
        lambda: page.get_by_text("Confirmed successful").count() > 0 or page.get_by_text("OK", exact=True).count() > 0,
        timeout_s=4,
        interval_ms=120,
    )
    try:
        ok_btn = page.get_by_text("OK", exact=True).last
        if ok_btn.count() > 0:
            ok_btn.click(timeout=2500)
    except Exception:  # noqa: BLE001
        pass

    return {
        "ok": True,
        "status": "success",
        "game": "milkyway",
        "detail": f"MilkyWay recharged {amount_str} for {target}",
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
    login_url = str(job.get("loginUrl") or env("MILKYWAY_LOGIN_URL", "https://milkywayapp.xyz:8781/"))
    store_url = str(job.get("storeUrl") or env("MILKYWAY_STORE_URL", "https://milkywayapp.xyz:8781/Store.aspx"))
    agent_user = str(job.get("agentUsername") or env("MILKYWAY_AGENT_USERNAME"))
    agent_pass = str(job.get("agentPassword") or env("MILKYWAY_AGENT_PASSWORD"))
    headed = bool(job.get("headed", env("JUWA_HEADED", "0") != "0"))
    timeout_ms = int(job.get("timeoutMs") or env("JUWA_TIMEOUT_MS", "45000") or 45000)
    amount_str = str(int(amount) if float(amount).is_integer() else amount)

    if not target or amount <= 0:
        emit({"ok": False, "status": "invalid", "error": "targetUsername and positive amount required"})
        return 1
    if not agent_user or not agent_pass:
        emit({"ok": False, "status": "misconfigured", "error": "MilkyWay agent credentials missing"})
        return 1

    try:
        with sync_playwright() as p:
            browser = launch_browser(p, headed)
            context = browser.new_context(viewport={"width": 1280, "height": 800}, ignore_https_errors=True)
            page = context.new_page()
            page.set_default_timeout(min(timeout_ms, 15000))
            page.on("dialog", lambda dialog: dialog.accept())

            login_err = login_milkyway(page, login_url, agent_user, agent_pass, solve_captcha)
            if login_err:
                emit({"ok": False, "status": "login_failed", "error": login_err})
                browser.close()
                return 1

            result = search_and_recharge(page, store_url, target, amount_str)
            browser.close()
            emit(result)
            return 0 if result.get("ok") else 1

    except Exception as err:  # noqa: BLE001
        eprint(traceback.format_exc())
        emit({"ok": False, "status": "crash", "error": str(err)})
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
