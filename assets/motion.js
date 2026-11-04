/* JournalCheck — scroll motion. Progressive enhancement: the page is complete without this file.
   The inline script in <head> adds .motion to <html> only when the reader allows motion. */
(() => {
  "use strict";
  const root = document.documentElement;
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  window.__motionReady = true;

  /* scroll progress line (shown with or without motion) */
  const bar = document.createElement("div");
  bar.className = "progress"; bar.setAttribute("aria-hidden", "true");
  document.body.appendChild(bar);

  /* copy buttons on code blocks (always on) */
  $$(".codebox").forEach((box) => {
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "copy"; btn.textContent = "Copy";
    btn.setAttribute("aria-label", "Copy these commands");
    btn.addEventListener("click", async () => {
      const text = box.querySelector("code").innerText.trim() + "\n";
      let ok = false;
      try { await navigator.clipboard.writeText(text); ok = true; } catch (_) {
        const ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select(); try { ok = document.execCommand("copy"); } catch (_) {} ta.remove();
      }
      btn.textContent = ok ? "Copied ✓" : "Select and copy"; btn.classList.toggle("done", ok);
      setTimeout(() => { btn.textContent = "Copy"; btn.classList.remove("done"); }, 1800);
    });
    box.appendChild(btn);
  });

  /* hover / focus tooltip for chart marks */
  const tip = document.createElement("div"); tip.className = "tip"; tip.setAttribute("role", "tooltip"); document.body.appendChild(tip);
  const showTip = (el, x, y) => { tip.textContent = el.dataset.tip; tip.classList.add("on");
    const w = tip.offsetWidth, h = tip.offsetHeight; tip.style.left = Math.min(innerWidth - w - 8, Math.max(8, x - w / 2)) + "px"; tip.style.top = Math.max(8, y - h - 12) + "px"; };
  document.addEventListener("pointermove", (e) => { const el = e.target.closest && e.target.closest("[data-tip]"); if (el) showTip(el, e.clientX, e.clientY); else tip.classList.remove("on"); }, { passive: true });
  document.addEventListener("focusin", (e) => { const el = e.target.closest && e.target.closest("[data-tip]"); if (el) { const r = el.getBoundingClientRect(); showTip(el, r.left + r.width / 2, r.top); } });
  document.addEventListener("focusout", () => tip.classList.remove("on"));
  addEventListener("scroll", () => tip.classList.remove("on"), { passive: true });

  /* index rendered report / live-check pieces so CSS can stagger them */
  const indexKids = (rootEl) => {
    [".itable tbody tr", ".adv", ".cb", ".fa"].forEach((sel) => $$(sel, rootEl).forEach((el, i) => el.style.setProperty("--i", Math.min(i, 30))));
    const small = rootEl.querySelector(".r-vbig small");
    if (small && root.classList.contains("motion")) {
      const m = small.textContent.match(/^Trust (\d+)(.*)$/);
      if (m) { const target = +m[1], rest = m[2], t0 = performance.now();
        const step = (t) => { const k = Math.min(1, (t - t0 - 350) / 1200); const e = k <= 0 ? 0 : 1 - Math.pow(1 - k, 3); small.textContent = `Trust ${Math.round(target * e)}${rest}`; if (k < 1) requestAnimationFrame(step); };
        requestAnimationFrame(step); }
    }
  };
  ["r-body", "check-out"].forEach((id) => { const el = document.getElementById(id); if (el) new MutationObserver(() => indexKids(el)).observe(el, { childList: true }); });

  const pipeRows = $$(".pipe-row");
  if (!root.classList.contains("motion")) {
    pipeRows.forEach((r) => r.classList.add("lit"));
    addEventListener("scroll", () => { bar.style.transform = `scaleX(${scrollY / Math.max(1, root.scrollHeight - innerHeight)})`; }, { passive: true });
    return;
  }

  /* 1. split big headings into lines that rise out of a mask */
  $$(".display, .sec-head h2, .foot-mark, .sub").forEach((el) => {
    const parts = el.innerHTML.split(/<br\s*\/?>/i);
    el.innerHTML = parts.map((p, i) => `<span class="ln" style="--i:${i}"><span>${p}</span></span>`).join("");
    el.classList.add("lines");
  });

  /* 2. mark elements that fade up; stagger children of grids */
  const single = [
    ".hero .label", ".lead", ".cta", ".hero-card", ".sec-head .label", ".sec-head > p", ".intro-l", ".intro-r",
    ".sources-label", ".checkform", ".examples", ".toolbar", ".tablewrap", ".tfoot", ".note", ".sub-head .label",
    "#cats", ".more", ".panel", ".links", ".foot-row",
  ];
  $$(single.join(",")).forEach((el) => el.classList.add("rv"));
  [".stats .stat", ".sources li", ".pipe-row", ".two .panel"].forEach((sel) => $$(sel).forEach((el, i, all) => {
    el.classList.add("rv"); el.style.setProperty("--i", sel === ".pipe-row" ? 0 : i % (all.length > 5 ? 5 : all.length));
  }));
  $$(".gallery .fig").forEach((el, i) => { el.classList.add("wipe"); el.style.setProperty("--i", i % 2); });

  /* 3. reveal on enter */
  const io = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (!e.isIntersecting) return;
    e.target.classList.add("in");
    if (e.target.matches("[data-count], .stat .sv")) countUp(e.target);
    io.unobserve(e.target);
  }), { rootMargin: "0px 0px -8% 0px", threshold: 0.12 });
  $$(".rv, .wipe, .lines, [data-count], .stat .sv").forEach((el) => io.observe(el));

  /* results section: table rows rise, F1 bars grow */
  const resIo = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (e.isIntersecting) { e.target.classList.add("seen"); resIo.unobserve(e.target); }
  }), { threshold: 0.08 });
  const results = document.getElementById("results");
  if (results) resIo.observe(results);

  /* 4. count numbers up from zero */
  function countUp(el) {
    const m = el.textContent.trim().match(/^(\d+(?:\.\d+)?)(.*)$/);
    if (!m) return;
    const target = parseFloat(m[1]), dec = (m[1].split(".")[1] || "").length, rest = m[2];
    const t0 = performance.now(), dur = 1500;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = (target * e).toFixed(dec) + rest;
      if (k < 1) requestAnimationFrame(step);
    };
    el.textContent = (0).toFixed(dec) + rest;
    requestAnimationFrame(step);
  }

  /* 5. scroll-linked effects: progress, sphere parallax, rings, pipeline line */
  const sphere = document.querySelector(".sphere-wrap");
  const heroRings = document.querySelector(".hero .rings");
  const sideRings = document.querySelector(".rings.side");
  const pipe = document.querySelector(".pipe");
  let line = null;
  if (pipe) { line = document.createElement("span"); line.className = "pipe-line"; line.setAttribute("aria-hidden", "true"); pipe.prepend(line); }

  const sizePipe = () => {
    if (!pipe || !pipeRows.length) return;
    const n0 = pipeRows[0].querySelector(".pipe-n"), n1 = pipeRows[pipeRows.length - 1].querySelector(".pipe-n");
    const top = n0.offsetTop + n0.offsetHeight / 2, end = pipeRows[pipeRows.length - 1].offsetTop + n1.offsetTop + n1.offsetHeight / 2;
    pipe.style.setProperty("--top", top + "px"); pipe.style.setProperty("--len", Math.max(0, end - top) + "px");
  };
  sizePipe(); addEventListener("resize", sizePipe);
  let ticking = false;
  function frame() {
    ticking = false;
    const y = scrollY, vh = innerHeight;
    bar.style.transform = `scaleX(${y / Math.max(1, root.scrollHeight - vh)})`;
    if (sphere && y < vh * 1.4) {
      sphere.style.setProperty("--py", `${y * 0.28}px`);
      if (heroRings) heroRings.style.setProperty("--rs", (1 + y / vh * 0.35).toFixed(3));
    }
    if (sideRings) {
      const r = sideRings.parentElement.getBoundingClientRect();
      if (r.bottom > 0 && r.top < vh) sideRings.style.transform = `translateY(${(r.top * -0.18).toFixed(1)}px) rotate(${(r.top * 0.02).toFixed(2)}deg)`;
    }
    if (pipe && line) {
      const r = pipe.getBoundingClientRect();
      const p = Math.max(0, Math.min(1, (vh * 0.6 - r.top) / r.height));
      line.style.setProperty("--p", p.toFixed(3));
      pipeRows.forEach((row) => { const rr = row.getBoundingClientRect(); row.classList.toggle("lit", rr.top + 40 < vh * 0.6); });
    }
  }
  const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(frame); } };
  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", onScroll, { passive: true });
  frame();
})();
