"""Juwa login captcha: preprocess + Tesseract 4-digit OCR."""

from __future__ import annotations

import base64
from io import BytesIO
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

import cv2
import numpy as np
import pytesseract
from PIL import Image

HOME_URL = "https://ht.juwa777.com/"
LOGIN_URL = "https://ht.juwa777.com/login"
CAPTCHA_URL = "https://ht.juwa777.com/api/agent/captcha"

_DIR = Path(__file__).resolve().parent
_LAST_PNG = _DIR / "captcha_last.png"

_OCR_CONFIG = "--oem 3 --psm 7 -c tessedit_char_whitelist=0123456789"

_CAPTCHA_IMG_SELECTORS = [
    'img[src*="captcha" i]',
    'img[alt*="captcha" i]',
    'img[src*="/api/agent/captcha"]',
    "#captcha img",
    ".captcha img",
]

_CAPTCHA_INPUT_SELECTORS = [
    'input[placeholder="Please enter the verification code"]',
    'input[placeholder*="verification code" i]:not([placeholder*="google" i])',
    'input[name="captcha"]',
    'input[id="captcha"]',
    'input[name*="captcha" i]',
    'input[id*="captcha" i]',
    'input[placeholder*="captcha" i]',
]


_OCR_ENGINE = None


def _ddddocr():
    global _OCR_ENGINE
    if _OCR_ENGINE is None:
        import ddddocr

        _OCR_ENGINE = ddddocr.DdddOcr(show_ad=False)
    return _OCR_ENGINE


def preprocess_captcha(image: Image.Image) -> Image.Image:
    """Keep saturated purple digits, drop faint noise, invert for Tesseract fallback."""
    rgb = np.array(image.convert("RGB"))
    bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    mask = cv2.inRange(hsv, (115, 50, 40), (175, 255, 200))
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, k)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, k)
    up = cv2.resize(mask, None, fx=4, fy=4, interpolation=cv2.INTER_NEAREST)
    return Image.fromarray(255 - up)


def read_digits(image: Image.Image) -> str:
    buf = BytesIO()
    image.convert("RGB").save(buf, format="PNG")
    try:
        raw = str(_ddddocr().classification(buf.getvalue()) or "")
        digits = "".join(ch for ch in raw if ch.isdigit())[:4]
        if len(digits) == 4:
            return digits
    except Exception:
        digits = ""

    processed = preprocess_captcha(image)
    tess = pytesseract.image_to_string(processed, config=_OCR_CONFIG)
    tess_digits = "".join(ch for ch in tess if ch.isdigit())[:4]
    return tess_digits if len(tess_digits) == 4 else digits


def _captcha_image_locator(page: Any) -> Any | None:
    for sel in _CAPTCHA_IMG_SELECTORS:
        loc = page.locator(sel).first
        if loc.count() > 0:
            return loc
    return None


def captcha_present(page: Any) -> bool:
    img = _captcha_image_locator(page)
    if img is not None and img.count() > 0:
        return True
    inp = find_captcha_input(page)
    return inp is not None and inp.count() > 0


def _image_from_locator(page: Any, loc: Any) -> Image.Image:
    """Use the img's natural pixels (not the smaller CSS screenshot)."""
    loc.wait_for(state="visible")
    data_url = loc.evaluate(
        """el => {
          if (!el.complete || !el.naturalWidth) return null;
          const c = document.createElement('canvas');
          c.width = el.naturalWidth;
          c.height = el.naturalHeight;
          c.getContext('2d').drawImage(el, 0, 0);
          return c.toDataURL('image/png');
        }"""
    )
    if data_url:
        raw = base64.b64decode(data_url.split(",", 1)[1])
        return Image.open(BytesIO(raw)).convert("RGB")

    src = loc.get_attribute("src")
    if src:
        resp = page.request.get(urljoin(page.url, src))
        if resp.ok:
            return Image.open(BytesIO(resp.body())).convert("RGB")

    return Image.open(BytesIO(loc.screenshot())).convert("RGB")


def find_captcha_input(page: Any) -> Any | None:
    for sel in _CAPTCHA_INPUT_SELECTORS:
        loc = page.locator(sel).first
        if loc.count() > 0:
            return loc

    candidates = page.locator(
        'input:not([type="password"]):not([type="hidden"]):not([type="submit"]):not([type="checkbox"])'
    )
    n = candidates.count()
    for i in range(n):
        el = candidates.nth(i)
        blob = " ".join(
            filter(
                None,
                [
                    el.get_attribute("name"),
                    el.get_attribute("id"),
                    el.get_attribute("placeholder"),
                    el.get_attribute("aria-label"),
                ],
            )
        ).lower()
        if any(tok in blob for tok in ("user", "account", "login", "email")):
            continue
        if any(tok in blob for tok in ("captcha", "code", "verify", "valid")):
            return el
    return None


def solve_captcha(page: Any, ctx: dict | None = None) -> str:
    """Read the captcha currently shown on the Playwright login page."""
    loc = _captcha_image_locator(page)
    if loc is None:
        raise RuntimeError("Captcha image not found on the login page")

    last = ""
    for attempt in range(3):
        image = _image_from_locator(page, loc)
        try:
            image.save(_LAST_PNG)
        except OSError:
            pass
        last = read_digits(image)
        if len(last) == 4:
            return last
        loc.click()
        page.wait_for_timeout(800)

    raise RuntimeError(f"OCR did not return 4 digits (got {last!r})")


def get_new_captcha(session: Any | None = None):
    """Fetch a fresh captcha from the API (notebook / local test)."""
    import requests

    sess = session or requests.Session()
    sess.get(LOGIN_URL)
    response = sess.get(CAPTCHA_URL)
    response.raise_for_status()
    image = Image.open(BytesIO(response.content))
    return image, read_digits(image)


if __name__ == "__main__":
    img = Image.open(_LAST_PNG)
    print(read_digits(img))
