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
    "#imgCode",
    'img[src*="ValidateCode" i]',
    'img[src*="validcode" i]',
    "#imgVerify",
    "#Image1",
    'img[src*="captcha" i]',
    'img[alt*="captcha" i]',
    'img[src*="/api/agent/captcha"]',
    'img[src*="verify" i]',
    "#captcha img",
    ".captcha img",
    'img[id*="code" i]',
    'img[id*="valid" i]',
    'img[id*="verify" i]',
]

_CAPTCHA_INPUT_SELECTORS = [
    'input[placeholder="Please enter the verification code"]',
    'input[placeholder*="verification code" i]:not([placeholder*="google" i])',
    'input[name="captcha"]',
    'input[id="captcha"]',
    'input[name*="captcha" i]',
    'input[id*="captcha" i]',
    'input[placeholder*="captcha" i]',
    "#txtVerifyCode",
    'input[name="txtVerifyCode"]',
    'input[placeholder="Code"]',
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


def preprocess_dark_digits(image: Image.Image, expected_len: int = 4) -> Image.Image:
    """Keep large dark digits, drop speckle and the wavy line."""
    rgb = np.array(image.convert("RGB"))
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    blur = cv2.GaussianBlur(gray, (3, 3), 0)
    cutoff = int(np.percentile(blur, 32))
    mask = (blur < max(70, cutoff)).astype("uint8") * 255
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (2, 5)))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3)))
    nlab, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    h, w = mask.shape
    keep = []
    for i in range(1, nlab):
        area = int(stats[i, cv2.CC_STAT_AREA])
        ch = int(stats[i, cv2.CC_STAT_HEIGHT])
        cw = int(stats[i, cv2.CC_STAT_WIDTH])
        if area < 18 or ch < h * 0.28:
            continue
        # Strike-through / wave spans most of the image; digits are narrow.
        if cw >= int(w * 0.45):
            continue
        keep.append((int(stats[i, cv2.CC_STAT_LEFT]), i, ch))
    nkeep = max(4, int(expected_len or 4))
    if len(keep) > nkeep:
        keep = sorted(keep, key=lambda t: t[2], reverse=True)[:nkeep]
    out = np.zeros_like(mask)
    if keep:
        for _x, i, _h in keep:
            out[labels == i] = 255
    else:
        out = mask
    up = cv2.resize(out, None, fx=4, fy=4, interpolation=cv2.INTER_NEAREST)
    return Image.fromarray(255 - up)


def _normalize_digits(raw: str, n: int) -> str:
    t = str(raw or "").translate(
        str.maketrans({"O": "0", "o": "0", "I": "1", "l": "1", "Z": "2", "S": "5", "s": "5", "B": "8"})
    )
    return "".join(ch for ch in t if ch.isdigit())[:n]


def _ocr_dddd(image: Image.Image) -> str:
    buf = BytesIO()
    image.convert("RGB").save(buf, format="PNG")
    raw = buf.getvalue()
    ocr = _ddddocr()
    text = str(ocr.classification(raw) or "")
    if not any(ch.isdigit() for ch in text):
        try:
            ocr.set_ranges("0123456789")
            text = str(ocr.classification(raw) or "")
        except Exception:
            pass
    return text


def read_digits(image: Image.Image, expected_len: int = 4, style: str = "") -> str:
    n = int(expected_len or 4)
    guesses: list[str] = []

    def add_guess(raw: str) -> None:
        digits = _normalize_digits(raw, n)
        if len(digits) == n:
            guesses.append(digits)

    rgb = image.convert("RGB")
    w, h = rgb.size
    prefer_dark = style in ("dark", "aspnet", "orion", "milkyway") or n >= 5
    # ddddocr wants the original bitmap. Upscaled/inverted copies often return ''.
    dddd_imgs = [rgb]
    if w < 140 or h < 40:
        dddd_imgs.append(rgb.resize((max(w * 2, 160), max(h * 2, 48)), Image.Resampling.LANCZOS))
    if prefer_dark:
        dark = preprocess_dark_digits(rgb, expected_len=n)
        for img in dddd_imgs:
            try:
                add_guess(_ocr_dddd(img))
            except Exception:
                pass
        try:
            add_guess(pytesseract.image_to_string(dark, config=_OCR_CONFIG))
        except Exception:
            pass
    else:
        purple = preprocess_captcha(rgb)
        for img in (*dddd_imgs, purple):
            try:
                add_guess(_ocr_dddd(img))
            except Exception:
                pass
        try:
            add_guess(pytesseract.image_to_string(purple, config=_OCR_CONFIG))
        except Exception:
            pass

    if not guesses:
        return ""
    counts: dict[str, int] = {}
    for g in guesses:
        counts[g] = counts.get(g, 0) + 1
    best = max(counts.items(), key=lambda kv: (kv[1], -guesses.index(kv[0])))
    if best[1] >= 2:
        return best[0]
    return guesses[0]


def _frames(page: Any) -> list[Any]:
    out = [page]
    try:
        for fr in page.frames:
            if fr not in out:
                out.append(fr)
    except Exception:
        pass
    return out


def _captcha_image_locator(page: Any) -> Any | None:
    for ctx in _frames(page):
        for sel in _CAPTCHA_IMG_SELECTORS:
            loc = ctx.locator(sel).first
            if loc.count() > 0:
                return loc
    inp = find_captcha_input(page)
    if inp is not None:
        for xp in ("xpath=following::img[1]", "xpath=../img", "xpath=..//img"):
            loc = inp.locator(xp).first
            if loc.count() > 0:
                return loc
    imgs = page.locator("img")
    n = min(imgs.count(), 16)
    for i in range(n):
        el = imgs.nth(i)
        box = el.bounding_box()
        if box and 40 <= box["width"] <= 240 and 18 <= box["height"] <= 90:
            return el
    return None


def captcha_present(page: Any) -> bool:
    img = _captcha_image_locator(page)
    if img is not None and img.count() > 0:
        return True
    inp = find_captcha_input(page)
    return inp is not None and inp.count() > 0


def _open_image_bytes(raw: bytes) -> Image.Image | None:
    if not raw:
        return None
    try:
        img = Image.open(BytesIO(raw))
        img.load()
        return img.convert("RGB")
    except Exception:
        return None


def _image_from_src(page: Any, loc: Any) -> Image.Image | None:
    """Raw ValidateCode.aspx / captcha URL is cleaner than a screenshot."""
    src = ""
    try:
        src = loc.get_attribute("src") or ""
    except Exception:
        src = ""
    if not src:
        return None
    if src.startswith("data:image"):
        try:
            return _open_image_bytes(base64.b64decode(src.split(",", 1)[1]))
        except Exception:
            return None
    url = src if src.lower().startswith("http") else urljoin(page.url, src)
    try:
        resp = page.request.get(url, timeout=8000)
        if resp.ok:
            return _open_image_bytes(resp.body())
    except Exception:
        return None
    return None


def _image_from_locator(page: Any, loc: Any) -> Image.Image:
    """Read the image already on screen. Fetching ValidateCode.aspx again would rotate the code."""
    loc.wait_for(state="visible")
    try:
        loc.evaluate(
            """el => el.complete && el.naturalWidth
              ? true
              : new Promise(r => { el.onload = () => r(true); setTimeout(() => r(true), 1500); })"""
        )
    except Exception:
        pass
    try:
        page.wait_for_timeout(150)
    except Exception:
        pass
    data_url = None
    try:
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
    except Exception:
        data_url = None
    if data_url:
        try:
            img = _open_image_bytes(base64.b64decode(data_url.split(",", 1)[1]))
            if img is not None and min(img.size) >= 10:
                return img
        except Exception:
            pass
    try:
        png = loc.screenshot(type="png", animations="disabled", timeout=5000, scale="css")
        img = _open_image_bytes(png)
        if img is not None and min(img.size) >= 10:
            return img
    except Exception:
        pass
    from_src = _image_from_src(page, loc)
    if from_src is not None and min(from_src.size) >= 10:
        return from_src
    png = loc.screenshot(type="png", timeout=5000)
    img = _open_image_bytes(png)
    if img is None:
        raise RuntimeError("Captcha image could not be decoded")
    return img


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
    expected_len = int((ctx or {}).get("expected_len") or 4)
    loc = _captcha_image_locator(page)
    if loc is None:
        raise RuntimeError("Captcha image not found on the login page")

    last = ""
    attempts = int((ctx or {}).get("max_attempts") or 3)
    style = str((ctx or {}).get("style") or "")
    for attempt in range(max(1, attempts)):
        image = _image_from_locator(page, loc)
        try:
            image.save(_LAST_PNG)
        except OSError:
            pass
        last = read_digits(image, expected_len=expected_len, style=style)
        if len(last) == expected_len:
            return last
        try:
            loc.click(force=True, timeout=2000)
        except Exception:
            try:
                loc.evaluate("el => el.click()")
            except Exception:
                pass
        page.wait_for_timeout(400)

    raise RuntimeError(f"OCR did not return {expected_len} digits (got {last!r})")


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
