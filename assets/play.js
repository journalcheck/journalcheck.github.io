/* JournalCheck — "Spot the red flag": a six-round game with made-up journal emails.
   Every example is fictional (reserved .example domains); the red flags map to JournalCheck indicators. */
(() => {
  "use strict";
  const root = document.getElementById("play-game");
  if (!root) return;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const ROUNDS = [
    { risky: true, from: "editor.office.journal@mail.example", subject: "Call for Papers — publish within 72 hours!",
      body: "Dear Esteemed Author, we are pleased to invite your valuable manuscript. Impact Factor 7.85 (Global Impact Factor). Fast review, publication within 72 hours. Only US$49. E-certificate and hard copy available.",
      flags: [["I8", "Guaranteed speed: no real peer review takes 72 hours"], ["I6", "An unofficial “impact factor” from a metrics mill"], ["I12", "Selling certificates and hard copies as extras"]] },
    { risky: false, from: "editorial-office@physlett.example", subject: "Your submission has been sent for review",
      body: "Thank you for your submission. It has been assigned to a handling editor and sent to two reviewers (double-blind). Typical time to a first decision is 8–10 weeks. Our open-access fee (US$1,450) is listed on the fees page; articles are published under CC BY and registered with Crossref.",
      flags: [["I8", "A realistic review timeline"], ["I11", "The fee is disclosed up front"], ["I16", "A stated licence and Crossref DOIs (I17)"]], good: true },
    { risky: true, from: "submissions@annals-coastal-biosciences-journal.example", subject: "Annals of Coastal Biosciences — submit now",
      body: "The Annals of Coastal Biosciences (publishing since 1978, same title and ISSN) now accepts online submissions at our new website, launched last year. Pay the processing fee by bank transfer after acceptance.",
      flags: [["I3", "A long-running title on a new website: the registered homepage is elsewhere"], ["I4", "The domain is far younger than the journal it claims to be"], ["I19", "The classic pattern of a hijacked clone: check the Hijacked Journal Checker"]] },
    { risky: false, from: "eic@datascijournal.example", subject: "Invitation to review",
      body: "Our editorial board, with affiliations and ORCID iDs, is listed on the website. The journal is subscription-based with no fee to publish. Its homepage matches the ISSN Portal record, and back issues go back to 2009.",
      flags: [["I10", "A real, linked editorial board"], ["I3", "The homepage matches the registry record"], ["I1", "A registered ISSN with a long record"]], good: true },
    { risky: true, from: "info@globaljournal-allsciences.example", subject: "International Journal of Everything — all subjects welcome",
      body: "We publish in medicine, engineering, management, arts, agriculture and law. Indexed in Google Scholar, ResearchGate and Academia.edu. Monthly issues, unlimited pages.",
      flags: [["I14", "No focused scope: one journal for every field"], ["I7", "“Indexed in Google Scholar” is not a quality badge"], ["I15", "Unlimited, monthly volume suggests a paper mill"]] },
    { risky: false, from: "office@open-ecology.example", subject: "Special issue: urban ecology — guest editors announced",
      body: "Guest editors are named with institutional pages. The journal is listed in DOAJ, its fee waiver policy is public, and the special issue follows the journal's normal peer-review process.",
      flags: [["I5", "Listed in DOAJ"], ["I11", "Fees and waivers are public"], ["I9", "The usual peer-review policy applies"]], good: true },
  ];

  let i = 0, score = 0, answers = [];
  const dots = () => ROUNDS.map((_, k) => `<span class="pg-dot ${k < answers.length ? (answers[k] ? "ok" : "no") : k === i ? "now" : ""}"></span>`).join("");

  function card() {
    const r = ROUNDS[i];
    root.innerHTML = `
      <div class="pg-top"><span class="label">Email ${i + 1} of ${ROUNDS.length}</span><span class="pg-dots" aria-hidden="true">${dots()}</span></div>
      <article class="pg-card" aria-live="polite">
        <div class="pg-meta"><span><b>From</b> ${esc(r.from)}</span><span><b>Subject</b> ${esc(r.subject)}</span></div>
        <p class="pg-body">${esc(r.body)}</p>
        <div class="pg-ask"><span class="label">Would you send your paper here?</span>
          <div class="pg-btns"><button type="button" class="pill" data-a="safe">Looks safe</button><button type="button" class="pill" data-a="risky">Red flag</button></div>
        </div>
      </article>`;
  }

  function reveal(choice) {
    const r = ROUNDS[i], right = (choice === "risky") === r.risky;
    if (right) score++;
    answers.push(right);
    const art = root.querySelector(".pg-card");
    art.classList.add(right ? "right" : "wrong");
    art.querySelector(".pg-ask").outerHTML = `
      <div class="pg-reveal">
        <p class="pg-verdict ${right ? "ok" : "no"}">${right ? "Right." : "Not quite."} ${r.risky ? "This one has red flags:" : "This one looks genuine:"}</p>
        <ul class="pg-flags ${r.good ? "good" : ""}">${r.flags.map(([id, t]) => `<li><b>${id}</b>${esc(t)}</li>`).join("")}</ul>
        <button type="button" class="pill solid" data-next>${i + 1 < ROUNDS.length ? "Next email →" : "See your score →"}</button>
      </div>`;
    root.querySelector(".pg-dots").innerHTML = dots();
    root.querySelector("[data-next]").focus({ preventScroll: true });
  }

  function end() {
    const msg = score === ROUNDS.length ? "A perfect eye. Predatory journals would struggle with you."
      : score >= 4 ? "Sharp. The clone and the all-subjects journal fool a lot of people."
      : "Worth a second round: the red flags repeat more than you might think.";
    root.innerHTML = `
      <div class="pg-top"><span class="label">Your score</span><span class="pg-dots" aria-hidden="true">${dots()}</span></div>
      <article class="pg-card pg-end ${score === ROUNDS.length ? "perfect" : ""}">
        <p class="pg-score"><span>${score}</span>/${ROUNDS.length}</p>
        <p class="pg-body">${msg}</p>
        <div class="pg-btns"><button type="button" class="pill solid" data-again>Play again ↺</button><a class="ghost" href="#check">Check a real journal <span aria-hidden="true">→</span></a></div>
      </article>`;
    if (score === ROUNDS.length) burst(root.querySelector(".pg-score"));
  }

  /* a small burst of sphere-coloured dots for a perfect score */
  function burst(el) {
    if (!document.documentElement.classList.contains("motion")) return;
    const cols = ["#f2b705", "#e9579b", "#5aa3dc", "#2c7a57"];
    for (let k = 0; k < 18; k++) {
      const d = document.createElement("i"); d.className = "pg-spark";
      const a = (k / 18) * Math.PI * 2, r = 60 + Math.random() * 50;
      d.style.setProperty("--x", `${Math.cos(a) * r}px`); d.style.setProperty("--y", `${Math.sin(a) * r}px`);
      d.style.background = cols[k % cols.length];
      el.appendChild(d); setTimeout(() => d.remove(), 1200);
    }
  }

  root.addEventListener("click", (e) => {
    const a = e.target.closest("[data-a]"), n = e.target.closest("[data-next]"), again = e.target.closest("[data-again]");
    if (a) reveal(a.dataset.a);
    else if (n) { i++; i < ROUNDS.length ? card() : end(); }
    else if (again) { i = 0; score = 0; answers = []; card(); }
  });
  card();
})();
