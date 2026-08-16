# Juwa Python bridge (you own the captcha code)

## Setup (on the machine that runs Lucky / or your PC)

```bash
cd Lucky/juwa_python
python -m venv .venv
# Windows:
.venv\Scripts\activate
# macOS/Linux:
# source .venv/bin/activate
pip install -r requirements.txt
playwright install chromium
```

## What you edit

Only this file for captcha:

- `solve_captcha.py` → implement `solve_captcha(page, ctx)`

Default raises `NotImplementedError` on purpose.

## Test from terminal

```bash
# from Lucky/
set JUWA_AGENT_USERNAME=...
set JUWA_AGENT_PASSWORD=...
echo {"targetUsername":"vvkj1555","amount":50,"headed":true} | python juwa_python/juwa_login_add.py
```

Stdout = one JSON result. Logs = stderr.

## Wire into Lucky (Node)

Render / `.env`:

```
JUWA_AUTOMATION_ENABLED=1
JUWA_PYTHON_BRIDGE=1
JUWA_PYTHON_BIN=python
# optional full path:
# JUWA_PYTHON_BIN=C:\Users\...\Lucky\juwa_python\.venv\Scripts\python.exe
JUWA_HEADED=1
```

When `JUWA_PYTHON_BRIDGE=1`, Node runs this script instead of the built-in Playwright path.

## Result contract

Success:

```json
{"ok":true,"status":"success","detail":"..."}
```

Captcha stub not coded yet:

```json
{"ok":false,"status":"captcha_not_implemented","error":"Implement solve_captcha() ..."}
```

That error is posted to the player chat as `not added: ...`.
