(() => {
  const canvas = document.getElementById("wheel");
  const ctx = canvas.getContext("2d");
  const spinBtn = document.getElementById("spin-btn");
  const statusEl = document.getElementById("spin-status");
  const claimModal = document.getElementById("claim-modal");
  const claimForm = document.getElementById("claim-form");
  const claimTitle = document.getElementById("claim-title");
  const claimCopy = document.getElementById("claim-copy");
  const claimError = document.getElementById("claim-error");
  const claimPhone = document.getElementById("claim-phone");
  const pointer = document.getElementById("spin-pointer");
  const wheelWrap = document.getElementById("wheel-wrap");
  const lights = document.querySelector(".wheel-lights");
  const confettiCanvas = document.getElementById("confetti");
  const confettiCtx = confettiCanvas.getContext("2d");

  const DEVICE_KEY = "lucky_vips_spin_device";
  const PLAYER_KEY = "lucky_player_cache";
  const params = new URLSearchParams(location.search);
  const isEmbed = params.get("embed") === "1" || window.self !== window.top;

  if (isEmbed) document.body.classList.add("is-embed");

  let prizes = [];
  let rotation = 0;
  let spinning = false;
  let currentSpinId = "";
  let currentPrize = null;
  let lastTick = -1;
  let audioCtx = null;
  let dpr = 1;
  let prizeLocked = false;

  function readPlayerProfile() {
    const fromQuery = {
      name: String(params.get("name") || "").trim(),
      phone: String(params.get("phone") || "").trim(),
      email: String(params.get("email") || "").trim(),
    };
    try {
      const cached = JSON.parse(localStorage.getItem(PLAYER_KEY) || "null");
      if (cached && typeof cached === "object") {
        return {
          name: fromQuery.name || String(cached.name || "").trim(),
          phone: fromQuery.phone || String(cached.phone || "").trim(),
          email: fromQuery.email || String(cached.email || "").trim(),
        };
      }
    } catch {
      /* ignore */
    }
    return fromQuery;
  }

  function fillClaimFields(profile) {
    const nameEl = document.getElementById("claim-name");
    const phoneEl = document.getElementById("claim-phone");
    const emailEl = document.getElementById("claim-email");
    if (nameEl && profile.name) nameEl.value = profile.name;
    if (phoneEl && profile.phone) phoneEl.value = profile.phone;
    if (emailEl && profile.email) emailEl.value = profile.email;
  }

  function getDeviceId() {
    try {
      let id = localStorage.getItem(DEVICE_KEY) || "";
      if (!/^[a-zA-Z0-9_-]{8,64}$/.test(id)) {
        id =
          typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
        localStorage.setItem(DEVICE_KEY, id);
      }
      return id;
    } catch {
      return `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    }
  }

  function formatWhen(ms) {
    if (!ms) return "";
    try {
      return new Date(ms).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
    } catch {
      return "";
    }
  }

  function cooldownMessage(data) {
    const when = formatWhen(data?.nextAvailableAt);
    return (
      data?.error ||
      (when
        ? `Prize already claimed this week. Next prize after ${when}.`
        : "Prize already claimed this week. Try again in 7 days.")
    );
  }

  async function checkDeviceCooldown() {
    const deviceId = getDeviceId();
    const res = await fetch(`/api/spin/check?deviceId=${encodeURIComponent(deviceId)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Could not check eligibility");
    if (data.used) throw new Error(cooldownMessage(data));
    return data;
  }

  const COLORS_A = ["#b42318", "#0f1419", "#c45c12", "#12181f", "#8f1d14"];
  const COLORS_B = ["#0f8f86", "#1a222b", "#2bb8ae", "#10161c", "#167a72"];

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text || "";
  }

  function ensureAudio() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    }
    if (audioCtx?.state === "suspended") audioCtx.resume();
  }

  function tickSound(intensity = 1) {
    if (!audioCtx) return;
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "square";
    osc.frequency.value = 900 + Math.random() * 220;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.045 * intensity, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + 0.06);
  }

  function winSound() {
    if (!audioCtx) return;
    const t = audioCtx.currentTime;
    [523, 659, 784].forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t + i * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.08, t + i * 0.08 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.08 + 0.28);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(t + i * 0.08);
      osc.stop(t + i * 0.08 + 0.3);
    });
  }

  function resizeCanvas() {
    const cssSize = canvas.clientWidth || 420;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(cssSize * dpr);
    canvas.height = Math.floor(cssSize * dpr);
    drawWheel();
  }

  function drawWheel() {
    const size = canvas.width;
    const cx = size / 2;
    const cy = size / 2;
    const radius = size / 2 - 6 * dpr;
    const n = Math.max(prizes.length, 1);
    const arc = (Math.PI * 2) / n;

    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rotation);

    // Outer shadow ring
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fillStyle = "#0a0c0e";
    ctx.fill();

    for (let i = 0; i < n; i++) {
      const start = i * arc - Math.PI / 2;
      const end = start + arc;
      const isNoPrize = /no\s*prize/i.test(String(prizes[i]?.label || ""));
      const palette = i % 2 === 0 ? COLORS_A : COLORS_B;
      const color = isNoPrize ? "#3a424c" : palette[Math.floor(i / 2) % palette.length];

      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, radius - 2 * dpr, start, end);
      ctx.closePath();

      const grad = ctx.createRadialGradient(0, 0, radius * 0.15, 0, 0, radius);
      grad.addColorStop(0, shade(color, 28));
      grad.addColorStop(0.55, color);
      grad.addColorStop(1, shade(color, -22));
      ctx.fillStyle = grad;
      ctx.fill();

      // Divider
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(start) * radius, Math.sin(start) * radius);
      ctx.strokeStyle = "rgba(255, 210, 122, 0.55)";
      ctx.lineWidth = 2.2 * dpr;
      ctx.stroke();

      // Peg near rim
      const pegAngle = start;
      const pegR = radius - 10 * dpr;
      ctx.beginPath();
      ctx.arc(Math.cos(pegAngle) * pegR, Math.sin(pegAngle) * pegR, 4.2 * dpr, 0, Math.PI * 2);
      ctx.fillStyle = "#ffd27a";
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.lineWidth = 1 * dpr;
      ctx.stroke();

      // Label
      ctx.save();
      ctx.rotate(start + arc / 2);
      ctx.textAlign = "right";
      ctx.fillStyle = "#fff8e8";
      ctx.shadowColor = "rgba(0,0,0,0.55)";
      ctx.shadowBlur = 4 * dpr;
      ctx.font = `800 ${Math.round(22 * dpr)}px "Bricolage Grotesque", sans-serif`;
      ctx.fillText(String(prizes[i]?.label || `$${i + 1}`), radius - 28 * dpr, 7 * dpr);
      ctx.restore();
    }

    // Inner ring
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.22, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(10,12,14,0.55)";
    ctx.fill();
    ctx.lineWidth = 3 * dpr;
    ctx.strokeStyle = "rgba(255,210,122,0.35)";
    ctx.stroke();

    ctx.restore();
  }

  function shade(hex, amount) {
    const n = hex.replace("#", "");
    const num = parseInt(n, 16);
    let r = (num >> 16) + amount;
    let g = ((num >> 8) & 0xff) + amount;
    let b = (num & 0xff) + amount;
    r = Math.max(0, Math.min(255, r));
    g = Math.max(0, Math.min(255, g));
    b = Math.max(0, Math.min(255, b));
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
  }

  function currentSegmentIndex() {
    const n = Math.max(prizes.length, 1);
    const arc = (Math.PI * 2) / n;
    const mod = ((rotation % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    // pointer at top; wheel rotation maps segment under pointer
    const absolute = (Math.PI * 2 - mod) % (Math.PI * 2);
    return Math.floor(absolute / arc) % n;
  }

  function easeOutQuint(t) {
    return 1 - Math.pow(1 - t, 5);
  }

  function animateTo(targetRotation, duration = 6800) {
    return new Promise((resolve) => {
      const start = rotation;
      const delta = targetRotation - start;
      const t0 = performance.now();
      lastTick = currentSegmentIndex();
      lights?.classList.add("is-fast");
      wheelWrap?.classList.add("is-spinning");

      function frame(now) {
        const t = Math.min(1, (now - t0) / duration);
        rotation = start + delta * easeOutQuint(t);
        drawWheel();

        const seg = currentSegmentIndex();
        if (seg !== lastTick) {
          lastTick = seg;
          const intensity = 0.35 + (1 - t) * 0.8;
          tickSound(intensity);
          pointer?.classList.add("is-tick");
          setTimeout(() => pointer?.classList.remove("is-tick"), 55);
        }

        if (t < 1) requestAnimationFrame(frame);
        else {
          lights?.classList.remove("is-fast");
          wheelWrap?.classList.remove("is-spinning");
          resolve();
        }
      }

      requestAnimationFrame(frame);
    });
  }

  function burstConfetti() {
    const w = (confettiCanvas.width = window.innerWidth * dpr);
    const h = (confettiCanvas.height = window.innerHeight * dpr);
    confettiCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const parts = Array.from({ length: 90 }, () => ({
      x: w / dpr / 2,
      y: h / dpr * 0.38,
      vx: (Math.random() - 0.5) * 14,
      vy: Math.random() * -11 - 4,
      g: 0.22 + Math.random() * 0.12,
      size: 4 + Math.random() * 6,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      color: ["#ffd27a", "#ff5a36", "#2bb8ae", "#fff", "#e8a54b"][Math.floor(Math.random() * 5)],
      life: 70 + Math.random() * 40,
    }));

    let frame = 0;
    function loop() {
      frame += 1;
      confettiCtx.clearRect(0, 0, w, h);
      parts.forEach((p) => {
        p.vy += p.g;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        p.life -= 1;
        confettiCtx.save();
        confettiCtx.translate(p.x, p.y);
        confettiCtx.rotate(p.rot);
        confettiCtx.globalAlpha = Math.max(0, p.life / 80);
        confettiCtx.fillStyle = p.color;
        confettiCtx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        confettiCtx.restore();
      });
      if (frame < 110) requestAnimationFrame(loop);
      else confettiCtx.clearRect(0, 0, w, h);
    }
    requestAnimationFrame(loop);
  }

  function openClaim(prize) {
    currentPrize = prize;
    claimTitle.textContent = prize.label;
    const profile = readPlayerProfile();
    const hasProfile = Boolean(profile.name && profile.phone && profile.email);
    claimCopy.textContent = hasProfile
      ? "Confirm your details to claim this prize."
      : "Enter your name, phone, and email to claim this prize.";
    claimError.hidden = true;
    fillClaimFields(profile);
    claimModal.hidden = false;
    document.getElementById("claim-name")?.focus();
  }

  async function loadPrizes() {
    const res = await fetch("/api/spin");
    if (!res.ok) throw new Error("Could not load spin prizes");
    const data = await res.json();
    prizes = (data.prizes || []).slice(0, 13);
    if (!prizes.length) {
      setStatus("No prizes configured yet.");
      spinBtn.disabled = true;
      return;
    }
    resizeCanvas();
  }

  spinBtn?.addEventListener("click", async () => {
    if (spinning || prizeLocked || !prizes.length) return;
    const deviceId = getDeviceId();

    ensureAudio();
    spinning = true;
    spinBtn.disabled = true;
    setStatus("Good luck...");

    try {
      await checkDeviceCooldown();

      const res = await fetch("/api/spin/play", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(cooldownMessage(data) || data.error || "Spin failed");

      currentSpinId = data.spinId;
      const index = Number(data.index);
      const n = prizes.length;
      const arc = (Math.PI * 2) / n;
      const jitter = (Math.random() - 0.5) * arc * 0.55;
      const segmentCenter = index * arc + arc / 2 + jitter;
      const currentMod = ((rotation % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      const targetMod = (Math.PI * 2 - segmentCenter) % (Math.PI * 2);
      let extra = targetMod - currentMod;
      if (extra <= 0) extra += Math.PI * 2;
      const loops = 5 + Math.floor(Math.random() * 3);
      const target = rotation + Math.PI * 2 * loops + extra;

      await animateTo(target, 6500 + Math.random() * 1200);
      const noPrize = data.noPrize || /no\s*prize/i.test(String(data.prize?.label || ""));
      if (noPrize) {
        setStatus("No prize this time — spin again anytime");
        spinBtn.disabled = false;
      } else {
        winSound();
        burstConfetti();
        setStatus(`Winner: ${data.prize.label} — enter phone to claim`);
        setTimeout(() => openClaim(data.prize), 450);
        // Keep spin locked until they claim (or refresh)
      }
    } catch (err) {
      setStatus(err.message || "Spin failed");
      if (!prizeLocked) spinBtn.disabled = false;
    } finally {
      spinning = false;
    }
  });

  claimForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    claimError.hidden = true;
    const profile = {
      name: document.getElementById("claim-name").value.trim(),
      phone: document.getElementById("claim-phone").value.trim(),
      email: document.getElementById("claim-email").value.trim(),
      deviceId: getDeviceId(),
    };

    try {
      const res = await fetch("/api/spin/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spinId: currentSpinId, ...profile }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(cooldownMessage(data) || data.error || "Could not claim prize");

      claimModal.hidden = true;
      prizeLocked = true;
      const when = formatWhen(data.nextAvailableAt);
      setStatus(
        when
          ? `Claimed ${currentPrize?.label || "prize"} — next prize after ${when}`
          : `Claimed ${currentPrize?.label || "prize"} — next prize in 7 days`
      );
      spinBtn.disabled = true;
      claimForm.reset();
    } catch (err) {
      claimError.hidden = false;
      claimError.textContent = err.message || "Could not claim prize";
    }
  });

  window.addEventListener("resize", () => {
    if (!spinning) resizeCanvas();
  });

  async function boot() {
    await loadPrizes();
    try {
      await checkDeviceCooldown();
      setStatus("Tap SPIN to play");
    } catch (err) {
      prizeLocked = true;
      setStatus(err.message);
      spinBtn.disabled = true;
    }
  }

  boot().catch((err) => {
    setStatus(err.message || "Failed to load wheel");
    spinBtn.disabled = true;
  });
})();
