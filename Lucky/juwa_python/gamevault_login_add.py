#!/usr/bin/env python3
"""
GameVault login + add-funds CLI for Lucky (called from Node).

After login: https://agent.gamevault999.com/userManagement
→ Please enter your search content → Search → Editor → Recharge
→ dialog amount → Recharge
"""

from __future__ import annotations

import json
import os
import sys
import traceback
from pathlib import Path
from typing import Any

DEBUG_DIR = Path(__file__).resolve().parent / "_gv_debug"


def eprint(*args: Any) -> None:
    text = " ".join(str(a) for a in args)
    print(text.encode("ascii", "backslashreplace").decode("ascii"), file=sys.stderr, flush=True)


def read_job() -> dict:
    raw = sys.stdin.read()
    if not raw.strip():
        raise SystemExit("Expected JSON job on stdin")
    return json.loads(raw)


def emit(result: dict) -> None:
    sys.stdout.write(json.dumps(result, ensure_ascii=True))
    sys.stdout.write("\n")
    sys.stdout.flush()


def env(name: str, default: str = "") -> str:
    return str(os.environ.get(name, default) or "").strip()


LOGIN_DEFAULT = "https://agent.gamevault999.com/login"
USER_MGMT_DEFAULT = "https://agent.gamevault999.com/userManagement"


def launch_browser(p: Any, headed: bool) -> Any:
    os.environ["PLAYWRIGHT_CHROMIUM_USE_HEADLESS_SHELL"] = "0"
    args = ["--disable-dev-shm-usage", "--ignore-certificate-errors", "--no-sandbox"]
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


def fill_first(page: Any, selectors: list[str], value: str) -> bool:
    for sel in selectors:
        loc = page.locator(sel).first
        if loc.count() > 0:
            loc.fill(value)
            return True
    return False


def still_on_login(page: Any) -> bool:
    url = (page.url or "").lower()
    if "usermanagement" in url.replace("-", "").replace("/", ""):
        return False
    if "/login" in url:
        return True
    return page.locator('input[placeholder="Username"], input[placeholder="Password"]').count() > 0


def login_gamevault(page: Any, login_url: str, agent_user: str, agent_pass: str, solve_captcha: Any, brand: str = "GameVault") -> str | None:
    eprint(f"[gamevault] open login {login_url}")
    page.goto(login_url, wait_until="domcontentloaded", timeout=20000)
    try:
        page.locator('img[src*="captcha" i]').first.wait_for(state="visible", timeout=8000)
    except Exception:  # noqa: BLE001
        pass

    ok_user = fill_first(
        page,
        [
            'input[placeholder="Username"]',
            'input[placeholder*="username" i]',
            'input[placeholder*="account" i]',
            'input[name="username"]',
            'input[type="text"]',
            "#username",
        ],
        agent_user,
    )
    ok_pass = fill_first(
        page,
        [
            'input[placeholder="Password"]',
            'input[placeholder*="password" i]',
            'input[type="password"]',
            'input[name="password"]',
            "#password",
        ],
        agent_pass,
    )
    if not ok_user or not ok_pass:
        return f"Could not find {brand} login fields"

    last_err = "captcha failed"
    img = page.locator('img[src*="captcha" i]').first

    def captcha_src() -> str:
        try:
            return str(img.get_attribute("src") or "")
        except Exception:  # noqa: BLE001
            return ""

    def wait_for_new_captcha(old_src: str, click_refresh: bool) -> None:
        if img.count() == 0:
            return
        if click_refresh:
            try:
                img.click(force=True, timeout=2000)
            except Exception:  # noqa: BLE001
                try:
                    img.evaluate("el => el.click()")
                except Exception:  # noqa: BLE001
                    pass
        try:
            page.wait_for_function(
                """old => {
                  const el = document.querySelector('img[src*=\"captcha\" i]');
                  return !!(el && el.src && el.src !== old && el.complete && el.naturalWidth);
                }""",
                arg=old_src,
                timeout=4000,
            )
        except Exception:  # noqa: BLE001
            page.wait_for_timeout(700)

    for attempt in range(8):
        if not still_on_login(page):
            return None
        src_before = captcha_src()
        try:
            code = solve_captcha(
                page, {"expected_len": 4, "login_url": login_url, "max_attempts": 1, "style": "dark"}
            )
        except Exception as err:  # noqa: BLE001
            last_err = f"solve_captcha failed: {err}"
            eprint(f"[gamevault] captcha attempt {attempt + 1}: {last_err}")
            wait_for_new_captcha(src_before, click_refresh=True)
            continue
        box = page.locator(
            'input[placeholder="Please enter the verification code"], '
            'input[placeholder*="captcha" i], '
            'input[placeholder*="verification code" i]:not([placeholder*="google" i]), '
            'input[placeholder*="code" i]:not([placeholder*="google" i])'
        ).first
        if box is None or box.count() == 0:
            texts = page.locator('input.el-input__inner[type="text"]')
            for i in range(texts.count()):
                el = texts.nth(i)
                ph = (el.get_attribute("placeholder") or "").lower()
                if "google" in ph or "username" in ph or "account" in ph:
                    continue
                if "code" in ph or "captcha" in ph or "verif" in ph:
                    box = el
                    break
        if box is None or box.count() == 0:
            return f"Could not find {brand} captcha field"
        try:
            box.click(force=True, timeout=2000)
        except Exception:  # noqa: BLE001
            pass
        try:
            box.fill("")
            box.type(code, delay=25)
        except Exception:  # noqa: BLE001
            box.evaluate(
                """(el, v) => {
                  el.focus();
                  el.value = v;
                  el.dispatchEvent(new Event('input', { bubbles: true }));
                  el.dispatchEvent(new Event('change', { bubbles: true }));
                }""",
                code,
            )
        eprint(f"[gamevault] filled code {code}, login attempt {attempt + 1}")
        btn = page.locator('button.el-button--primary:has-text("Login")').first
        try:
            if btn.count() > 0:
                btn.evaluate("el => el.click()")
            else:
                page.keyboard.press("Enter")
        except Exception:  # noqa: BLE001
            page.keyboard.press("Enter")
        page.wait_for_timeout(1800)
        if not still_on_login(page):
            return None
        toast = ""
        try:
            toast = (page.locator(".el-message, .el-message__content").last.inner_text() or "").strip()
        except Exception:  # noqa: BLE001
            toast = ""
        last_err = f"Still on {brand} login after submit (wrong code or credentials)"
        if toast:
            last_err = f"{last_err}: {toast}"
        eprint(f"[gamevault] {last_err}")
        low = toast.lower()
        if any(
            tok in low
            for tok in (
                "password error",
                "password verification failed",
                "wrong password",
                "incorrect password",
            )
        ):
            return last_err
        wait_for_new_captcha(src_before, click_refresh=captcha_src() == src_before)
    return last_err


def click_loose(locator: Any) -> bool:
    if locator is None or locator.count() == 0:
        return False
    try:
        locator.click(force=True, timeout=4000)
        return True
    except Exception:  # noqa: BLE001
        try:
            locator.evaluate("el => el.click()")
            return True
        except Exception:  # noqa: BLE001
            return False


def page_toast(page: Any) -> str:
    try:
        loc = page.locator(".el-message__content, .el-message").last
        if loc.count() > 0:
            return (loc.inner_text() or "").strip()
    except Exception:  # noqa: BLE001
        pass
    return ""


def dump_ui(page: Any, name: str) -> None:
    try:
        DEBUG_DIR.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(DEBUG_DIR / f"{name}.png"), full_page=True)
        info = page.evaluate(
            """() => {
              const vis = (el) => !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
              const items = (nodes) => [...nodes].slice(0, 30).map((el) => ({
                tag: el.tagName,
                cls: String(el.className || "").slice(0, 80),
                text: String(el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 80),
                vis: vis(el),
              }));
              const byText = (re) => items(
                [...document.querySelectorAll("button,a,li,span,div")].filter((el) => re.test(el.innerText || ""))
              );
              return {
                url: location.href,
                editor: byText(/editor/i),
                recharge: byText(/recharge/i),
                dialogs: items(document.querySelectorAll(".el-dialog, .el-dialog__wrapper, .el-overlay, [role=dialog]")),
                menus: items(document.querySelectorAll(".el-dropdown-menu, .el-popper, .el-dropdown")),
                row: String(document.querySelector(".el-table__body tr, .el-table__row")?.innerText || "").slice(0, 200),
              };
            }"""
        )
        (DEBUG_DIR / f"{name}.json").write_text(json.dumps(info, indent=2), encoding="utf-8")
        eprint(f"[gamevault] dump {name} url={info.get('url')} editors={len(info.get('editor') or [])} recharge={len(info.get('recharge') or [])} menus={len(info.get('menus') or [])} dialogs={len(info.get('dialogs') or [])}")
    except Exception as err:  # noqa: BLE001
        eprint(f"[gamevault] dump {name} failed: {err}")


def dismiss_popups(page: Any, wait_ms: int = 5000) -> None:
    try:
        page.locator(
            ".el-overlay.is-message-box, .el-message-box, text=Please download and use this flyer"
        ).first.wait_for(state="visible", timeout=max(200, wait_ms))
    except Exception:  # noqa: BLE001
        pass
    for _ in range(6):
        closed = False
        overlay = page.locator(".el-overlay.is-message-box, .el-message-box")
        try:
            if overlay.count() > 0 and overlay.first.is_visible():
                ok = overlay.locator("button").filter(has_text="OK").first
                if ok.count() == 0:
                    ok = page.locator("button").filter(has_text="OK").first
                eprint("[gamevault] dismiss announcement")
                if ok.count() == 0 or not click_loose(ok):
                    page.keyboard.press("Escape")
                closed = True
        except Exception:  # noqa: BLE001
            pass
        flyer_open = False
        try:
            flyer_open = bool(
                page.evaluate(
                    """() => {
                      const o = document.querySelector('.flyer-overlay');
                      return !!(o && o.offsetWidth && o.offsetHeight);
                    }"""
                )
            )
        except Exception:  # noqa: BLE001
            flyer_open = False
        if flyer_open:
            eprint("[gamevault] dismiss marketing flyer")
            btn = page.locator(".flyer-close-btn").first
            if btn.count() == 0 or not click_loose(btn):
                try:
                    page.evaluate("() => document.querySelector('.flyer-close-btn')?.click()")
                except Exception:  # noqa: BLE001
                    page.keyboard.press("Escape")
            closed = True
        if not closed:
            return
        page.wait_for_timeout(450)


def visible_dialog(page: Any) -> Any:
    return page.locator(
        ".el-overlay:visible .el-dialog, .el-dialog:visible, [role='dialog']:visible"
    ).last


def fill_amount_in(dialog: Any, amount_str: str) -> bool:
    amount_box = dialog.locator(".el-form-item").filter(has_text="Recharge Amount").locator(
        "input:not([disabled])"
    )
    if amount_box.count() == 0:
        amount_box = dialog.locator(".el-form-item").filter(has_text="Amount").locator("input:not([disabled])")
    if amount_box.count() == 0:
        amount_box = dialog.locator("input.el-input__inner:not([disabled])").first
    if amount_box.count() == 0:
        return False
    amount_box.first.fill(amount_str)
    return True


def confirm_recharge_if_needed(page: Any) -> None:
    confirm_dlg = page.locator(".el-dialog:visible, .el-overlay:visible .el-dialog").filter(
        has_text="confirm your recharge"
    )
    if confirm_dlg.count() == 0:
        confirm_dlg = page.get_by_text("Please confirm your recharge", exact=False)
    btn = page.locator(".el-dialog:visible, .el-overlay.is-message-box:visible, .el-message-box:visible").locator(
        "button"
    ).filter(has_text="Confirm").last
    if btn.count() > 0:
        click_loose(btn)
        page.wait_for_timeout(800)


def search_and_recharge(page: Any, user_mgmt: str, target: str, amount: float, brand: str = "GameVault", game_id: str = "gamevault") -> dict:
    amount_str = str(int(amount) if float(amount).is_integer() else amount)
    store_url = user_mgmt or USER_MGMT_DEFAULT
    eprint(f"[gamevault] open {store_url} search={target} amount={amount_str}")
    page.goto(store_url, wait_until="domcontentloaded", timeout=20000)
    page.wait_for_timeout(1200)
    if still_on_login(page):
        return {"ok": False, "status": "login_failed", "error": f"Redirected to {brand} login on userManagement"}
    dismiss_popups(page)

    search = page.get_by_placeholder("Search by Account")
    if search.count() == 0:
        search = page.get_by_placeholder("Please enter your search content")
    if search.count() == 0:
        search = page.locator('input[placeholder*="search" i]').first
    if search.count() == 0:
        return {"ok": False, "status": "search_field_not_found", "error": "Could not find account search box"}
    search.first.fill(target)
    search_btn = page.locator('button:has-text("Search"), button:has-text("search")').first
    if not click_loose(search_btn):
        search.first.press("Enter")
    page.wait_for_timeout(1800)
    dismiss_popups(page, wait_ms=2000)
    dump_ui(page, "after_search")

    row = page.locator(".el-table__body tr, .el-table__row, tr").filter(has_text=target).first
    if row.count() == 0 and page.get_by_text(target, exact=True).count() == 0:
        return {
            "ok": False,
            "status": "user_not_found",
            "error": f"Search for {target} returned no matching account",
        }

    editor = row.locator('button:has-text("editor")').first
    if editor.count() == 0:
        editor = row.get_by_text("editor", exact=False).first
    if editor.count() == 0:
        editor = page.locator('button:has-text("editor")').first
    if editor.count() == 0:
        return {"ok": False, "status": "editor_not_found", "error": "Could not find Editor on the user row"}
    dismiss_popups(page, wait_ms=800)
    if not click_loose(editor):
        return {"ok": False, "status": "editor_not_found", "error": "Could not click Editor"}
    eprint("[gamevault] clicked Editor")
    page.wait_for_timeout(700)
    dump_ui(page, "after_editor")

    dialog = visible_dialog(page)
    opened = False
    try:
        dialog.wait_for(state="visible", timeout=5000)
        opened = True
    except Exception:  # noqa: BLE001
        opened = False

    if not opened:
        menu = page.locator(
            ".el-dropdown-menu:visible, .el-popper:visible, .el-dropdown__popper:visible"
        )
        recharge_open = menu.get_by_text("recharge", exact=False).first
        if recharge_open.count() == 0:
            try:
                page.locator(".el-table__body-wrapper").evaluate("el => { el.scrollLeft = el.scrollWidth }")
            except Exception:  # noqa: BLE001
                pass
            recharge_open = row.locator("button, a, span").filter(has_text="Recharge").first
        if recharge_open.count() == 0:
            recharge_open = page.locator("button:visible").filter(has_text="Recharge").first
        if not click_loose(recharge_open):
            dump_ui(page, "recharge_not_found")
            return {"ok": False, "status": "recharge_not_found", "error": "Could not click Recharge after Editor"}
        eprint("[gamevault] clicked Recharge")
        page.wait_for_timeout(700)
        dialog = visible_dialog(page)
        try:
            dialog.wait_for(state="visible", timeout=8000)
            opened = True
        except Exception as err:  # noqa: BLE001
            dump_ui(page, "dialog_miss")
            return {"ok": False, "status": "recharge_dialog_not_found", "error": f"Recharge dialog did not open ({err})"}

    dump_ui(page, "after_recharge_click")
    if not fill_amount_in(dialog, amount_str):
        # User Data dialog may have Recharge as a nested action.
        recharge_in = dialog.locator("button, span").filter(has_text="Recharge").first
        if click_loose(recharge_in):
            page.wait_for_timeout(600)
            dialog = visible_dialog(page)
            if not fill_amount_in(dialog, amount_str):
                dump_ui(page, "amount_miss")
                return {
                    "ok": False,
                    "status": "amount_field_not_found",
                    "error": "Editor opened but amount box was not found",
                }
        else:
            dump_ui(page, "amount_miss")
            return {
                "ok": False,
                "status": "amount_field_not_found",
                "error": "Editor opened but amount box was not found",
            }

    recharge_go = dialog.locator("button").filter(has_text="Recharge").last
    if recharge_go.count() == 0:
        recharge_go = dialog.locator("button").filter(has_text="Confirm").last
    if recharge_go.count() == 0:
        recharge_go = dialog.locator("button.el-button--primary").last
    if not click_loose(recharge_go):
        return {"ok": False, "status": "recharge_confirm_not_found", "error": "Could not click Recharge in the dialog"}
    page.wait_for_timeout(900)
    confirm_recharge_if_needed(page)

    cap = page.locator(".el-dialog:visible, .el-overlay:visible .el-dialog").filter(has_text="Captcha")
    if cap.count() > 0:
        try:
            from solve_captcha import solve_captcha

            code = solve_captcha(page, {"expected_len": 4, "max_attempts": 2, "style": "dark"})
            cap_in = cap.locator("input.el-input__inner").first
            if cap_in.count() > 0:
                cap_in.fill(code)
            click_loose(cap.locator("button").filter(has_text="Confirm").first)
            page.wait_for_timeout(900)
        except Exception as err:  # noqa: BLE001
            return {"ok": False, "status": "recharge_captcha_failed", "error": str(err)}

    page.wait_for_timeout(1200)
    toast = page_toast(page)
    low = toast.lower()
    if any(tok in low for tok in ("error", "fail", "incorrect", "invalid", "not enough")):
        err = toast or f"{brand} recharge did not succeed"
        return {"ok": False, "status": "recharge_failed", "error": err, "detail": err}

    return {
        "ok": True,
        "status": "success",
        "game": game_id,
        "detail": f"added {amount_str} to {target} on {brand}",
        "toast": toast,
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
    login_url = str(job.get("loginUrl") or env("GAMEVAULT_LOGIN_URL", LOGIN_DEFAULT))
    user_mgmt = str(job.get("userMgmtUrl") or env("GAMEVAULT_USER_MGMT_URL", USER_MGMT_DEFAULT))
    agent_user = str(job.get("agentUsername") or env("GAMEVAULT_AGENT_USERNAME"))
    agent_pass = str(job.get("agentPassword") or env("GAMEVAULT_AGENT_PASSWORD"))
    brand = str(job.get("brand") or "GameVault")
    game_id = str(job.get("game") or "gamevault")
    headed = bool(job.get("headed", env("JUWA_HEADED", "0") != "0"))
    timeout_ms = int(job.get("timeoutMs") or env("GAMEVAULT_TIMEOUT_MS") or env("JUWA_TIMEOUT_MS") or 90000)

    if not target or amount <= 0:
        emit({"ok": False, "status": "invalid", "error": "targetUsername and positive amount required"})
        return 1
    if not agent_user or not agent_pass:
        emit({"ok": False, "status": "misconfigured", "error": f"{brand} agent credentials missing"})
        return 1

    try:
        with sync_playwright() as p:
            browser = launch_browser(p, headed)
            context = browser.new_context(
                viewport={"width": 1600, "height": 900},
                ignore_https_errors=True,
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
                ),
            )
            page = context.new_page()
            page.set_default_timeout(min(timeout_ms, 20000))
            page.on("dialog", lambda dialog: dialog.accept())

            login_err = login_gamevault(page, login_url, agent_user, agent_pass, solve_captcha, brand)
            if login_err:
                emit({"ok": False, "status": "login_failed", "error": login_err})
                browser.close()
                return 1

            result = search_and_recharge(page, user_mgmt, target, amount, brand, game_id)
            browser.close()
            emit(result)
            return 0 if result.get("ok") else 1

    except Exception as err:  # noqa: BLE001
        eprint(traceback.format_exc())
        emit({"ok": False, "status": "crash", "error": str(err)})
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
