#!/usr/bin/env python3
"""
Juwa login + add-funds CLI for Lucky (called from Node).

Protocol:
  stdin  → one JSON object (job)
  stdout → one JSON object (result)  [logs go to stderr]

Job keys:
  targetUsername, amount
  loginUrl, userMgmtUrl (optional; else env)
  agentUsername, agentPassword (optional; else env JUWA_AGENT_*)
  headed (bool)

Env:
  JUWA_LOGIN_URL, JUWA_USER_MGMT_URL, JUWA_AGENT_USERNAME, JUWA_AGENT_PASSWORD
  JUWA_HEADED=1|0
"""

from __future__ import annotations

import json
import os
import sys
import traceback
from typing import Any


def eprint(*args: Any) -> None:
    print(*args, file=sys.stderr, flush=True)


def read_job() -> dict:
    raw = sys.stdin.read()
    if not raw.strip():
        raise SystemExit("Expected JSON job on stdin")
    return json.loads(raw)


def emit(result: dict) -> None:
    sys.stdout.write(json.dumps(result, ensure_ascii=False))
    sys.stdout.write("\n")
    sys.stdout.flush()


def env(name: str, default: str = "") -> str:
    return str(os.environ.get(name, default) or "").strip()


def looks_like_captcha(page_text: str, url: str) -> bool:
    t = (page_text or "").lower()
    return (
        "captcha" in t
        or "self identification" in t
        or "self-identification" in t
        or "verification code" in t
        or "i'm not a robot" in t
        or "im not a robot" in t
    )


def launch_browser(p: Any, headed: bool) -> Any:
    args = ["--disable-dev-shm-usage"]
    last_err: Exception | None = None
    for kwargs in (
        {"headless": not headed, "args": args},
        {"headless": not headed, "channel": "chrome", "args": args},
        {"headless": not headed, "channel": "msedge", "args": args},
    ):
        try:
            return p.chromium.launch(**kwargs)
        except Exception as err:  # noqa: BLE001
            last_err = err
    raise last_err or RuntimeError("Could not launch Chromium")


def fill_and_submit_captcha(page: Any, login_url: str, headed: bool) -> str | None:
    """OCR the visible captcha, fill it, submit. Returns error string or None."""
    from solve_captcha import find_captcha_input, solve_captcha

    eprint("[juwa-py] captcha detected → calling solve_captcha()")
    ctx = {
        "login_url": login_url,
        "page_url": page.url,
        "headed": headed,
    }
    try:
        answer = solve_captcha(page, ctx)
    except NotImplementedError as err:
        return str(err)
    except Exception as err:  # noqa: BLE001
        return f"solve_captcha failed: {err}"

    if not (isinstance(answer, str) and answer.strip()):
        return "solve_captcha returned empty text"

    captcha_input = find_captcha_input(page)
    if captcha_input is None:
        return "solve_captcha returned text but no captcha input was found"
    captcha_input.fill(answer.strip())
    eprint(f"[juwa-py] filled captcha ({len(answer.strip())} digits)")

    btn = page.locator(
        'button[type="submit"], button:has-text("Login"), button:has-text("Sign in"), input[type="submit"]'
    ).first
    if btn.count() > 0:
        btn.click()
    else:
        page.keyboard.press("Enter")
    page.wait_for_timeout(2000)
    return None


def fill_first(page: Any, selectors: list[str], value: str) -> bool:
    for sel in selectors:
        loc = page.locator(sel).first
        if loc.count() > 0:
            loc.fill(value)
            return True
    return False


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

    # Import YOUR captcha module (same folder)
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    try:
        from solve_captcha import captcha_present, find_captcha_input, solve_captcha
    except Exception as err:  # noqa: BLE001
        emit({"ok": False, "status": "import_error", "error": f"solve_captcha import failed: {err}"})
        return 2

    job = read_job()
    target = str(job.get("targetUsername") or "").strip()
    amount = float(job.get("amount") or 0)
    login_url = str(job.get("loginUrl") or env("JUWA_LOGIN_URL", "https://ht.juwa777.com/login"))
    user_mgmt = str(
        job.get("userMgmtUrl") or env("JUWA_USER_MGMT_URL", "https://ht.juwa777.com/userManagement")
    )
    agent_user = str(job.get("agentUsername") or env("JUWA_AGENT_USERNAME"))
    agent_pass = str(job.get("agentPassword") or env("JUWA_AGENT_PASSWORD"))
    headed = bool(job.get("headed", env("JUWA_HEADED", "1") != "0"))
    timeout_ms = int(job.get("timeoutMs") or env("JUWA_TIMEOUT_MS", "180000") or 180000)

    if not target or amount <= 0:
        emit({"ok": False, "status": "invalid", "error": "targetUsername and positive amount required"})
        return 1
    if not agent_user or not agent_pass:
        emit({"ok": False, "status": "misconfigured", "error": "Juwa agent credentials missing"})
        return 1

    try:
        with sync_playwright() as p:
            browser = launch_browser(p, headed)
            context = browser.new_context(viewport={"width": 1280, "height": 900}, ignore_https_errors=True)
            page = context.new_page()
            page.set_default_timeout(timeout_ms)

            eprint(f"[juwa-py] open login {login_url}")
            page.goto(login_url, wait_until="domcontentloaded")
            page.wait_for_timeout(800)
            try:
                page.locator('img[src*="captcha" i]').first.wait_for(state="visible", timeout=8000)
            except Exception:  # noqa: BLE001
                pass

            ok_user = fill_first(
                page,
                [
                    'input[placeholder="Please enter your account"]',
                    'input[name="username"]',
                    'input[name="user"]',
                    'input[name="account"]',
                    'input[type="text"]',
                    "#username",
                    "#user",
                ],
                agent_user,
            )
            ok_pass = fill_first(
                page,
                [
                    'input[placeholder="Please enter your password"]',
                    'input[type="password"]',
                    'input[name="password"]',
                    "#password",
                ],
                agent_pass,
            )
            if not ok_user or not ok_pass:
                emit(
                    {
                        "ok": False,
                        "status": "login_form_not_found",
                        "error": "Could not find Juwa login fields — update selectors in juwa_login_add.py",
                    }
                )
                browser.close()
                return 1

            body = ""
            try:
                body = page.locator("body").inner_text()
            except Exception:  # noqa: BLE001
                body = ""

            if captcha_present(page) or looks_like_captcha(body, page.url):
                cap_err = fill_and_submit_captcha(page, login_url, headed)
                if cap_err:
                    status = (
                        "captcha_not_implemented"
                        if cap_err.startswith("Implement")
                        else "captcha_error"
                    )
                    if "no captcha input" in cap_err:
                        status = "captcha_input_not_found"
                    emit({"ok": False, "status": status, "error": cap_err})
                    browser.close()
                    return 1
            else:
                btn = page.locator(
                    'button[type="submit"], button:has-text("Login"), button:has-text("Sign in"), input[type="submit"]'
                ).first
                if btn.count() > 0:
                    btn.click()
                else:
                    page.keyboard.press("Enter")
                page.wait_for_timeout(1500)
                body2 = ""
                try:
                    body2 = page.locator("body").inner_text()
                except Exception:  # noqa: BLE001
                    body2 = ""
                if captcha_present(page) or looks_like_captcha(body2, page.url) or "login" in page.url.lower():
                    cap_err = fill_and_submit_captcha(page, login_url, headed)
                    if cap_err:
                        emit({"ok": False, "status": "captcha_error", "error": cap_err})
                        browser.close()
                        return 1

            if "login" in page.url.lower():
                emit(
                    {
                        "ok": False,
                        "status": "awaiting_captcha",
                        "error": "Still on login after captcha step — check your solve_captcha() implementation",
                    }
                )
                browser.close()
                return 1

            eprint(f"[juwa-py] logged in → userManagement for {target} amount={amount}")
            page.goto(user_mgmt, wait_until="domcontentloaded")
            page.wait_for_timeout(1500)

            search = page.locator('input[placeholder="Please enter your search content"]').first
            if search.count() == 0:
                emit(
                    {
                        "ok": False,
                        "status": "search_field_not_found",
                        "error": "Could not find User Management search box",
                    }
                )
                browser.close()
                return 1
            search.fill(target)
            page.locator('button:has-text("search")').first.click()
            page.wait_for_timeout(2000)

            if page.get_by_text(target, exact=True).count() == 0:
                emit(
                    {
                        "ok": False,
                        "status": "user_not_found",
                        "error": f"Search for {target} returned no matching account",
                    }
                )
                browser.close()
                return 1

            page.get_by_text("editor", exact=False).first.click()
            page.wait_for_timeout(500)
            recharge_item = page.locator(".el-dropdown-menu:visible").get_by_text("recharge", exact=False).first
            if recharge_item.count() == 0:
                emit(
                    {
                        "ok": False,
                        "status": "recharge_menu_not_found",
                        "error": "editor dropdown opened but Recharge was not found",
                    }
                )
                browser.close()
                return 1
            recharge_item.click()

            dialog = page.locator(".el-dialog:visible").last
            dialog.wait_for(state="visible", timeout=10000)
            amount_box = dialog.locator(".el-form-item").filter(has_text="Recharge Amount").locator(
                "input:not([disabled])"
            )
            if amount_box.count() == 0:
                emit(
                    {
                        "ok": False,
                        "status": "amount_field_not_found",
                        "error": "Recharge dialog opened but Recharge Amount input was not found",
                    }
                )
                browser.close()
                return 1
            amount_box.fill(str(int(amount) if float(amount).is_integer() else amount))
            dialog.get_by_role("button", name="Confirm").click()
            page.wait_for_timeout(2000)

            result_text = ""
            try:
                result_text = page.locator("body").inner_text()[:800]
            except Exception:  # noqa: BLE001
                result_text = ""

            browser.close()
            emit(
                {
                    "ok": True,
                    "status": "success",
                    "detail": f"Python bridge submitted amount={amount} for {target}",
                    "snippet": result_text[:240],
                    "searched": True,
                }
            )
            return 0

    except Exception as err:  # noqa: BLE001
        eprint(traceback.format_exc())
        emit({"ok": False, "status": "crash", "error": str(err)})
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
