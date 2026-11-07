/* NC-Tracker – läuft komplett im Browser. Online-Modus über Supabase (config.js). */
(() => {
  "use strict";

  // ---------- Hilfen ----------
  const $ = (sel, el = document) => el.querySelector(sel);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === "x" ? r : (r & 3) | 8).toString(16); }));
  const secretKey = () => Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, "0")).join("");
  const fmt = (n, d = 2) => (n == null || isNaN(n) ? "–" : n.toFixed(d).replace(".", ","));
  const store = {
    get(k, fb) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch { return fb; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* privat-Modus */ } },
  };
  const loadScript = (src) => new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) return res();
    const s = document.createElement("script");
    s.src = src; s.onload = res; s.onerror = () => rej(new Error("Konnte " + src + " nicht laden"));
    document.head.appendChild(s);
  });
  let toastTimer;
  function toast(msg, bad = false) {
    const t = $("#toast");
    t.textContent = msg; t.hidden = false; t.classList.toggle("bad", bad);
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 3200);
  }

  // ---------- Noten-Logik ----------
  const GRADE_TYPES = [
    { key: "klausur", label: "Klausur", w: 2 },
    { key: "test", label: "Test", w: 1 },
    { key: "muendlich", label: "Mündlich", w: 1 },
  ];
  const toNote = (v, scale) => (scale === "punkte" ? (17 - v) / 3 : v);
  function subjectAvg(sub) {
    const g = sub.grades || [];
    if (!g.length) return null;
    const sw = g.reduce((a, x) => a + x.w, 0);
    return g.reduce((a, x) => a + x.v * x.w, 0) / sw;
  }
  function calcNC(profile) {
    let sum = 0, w = 0;
    for (const s of profile.subjects) {
      if (!s.include) continue;
      const avg = subjectAvg(s);
      if (avg == null) continue;
      const k = s.lk ? 2 : 1;
      sum += toNote(avg, profile.scale) * k; w += k;
    }
    return w ? Math.round((sum / w) * 100) / 100 : null;
  }
  const ncClass = (n) => (n == null ? "" : n <= 1.5 ? "top" : n <= 2.5 ? "good" : n <= 3.5 ? "mid" : "low");
  const gradeOptions = (scale) => scale === "punkte"
    ? Array.from({ length: 16 }, (_, i) => 15 - i).map((p) => ({ v: p, t: p + " P" }))
    : [1, 1.3, 1.7, 2, 2.3, 2.7, 3, 3.3, 3.7, 4, 4.3, 4.7, 5, 5.3, 5.7, 6].map((n) => ({ v: n, t: noteLabel(n) }));
  function noteLabel(n) {
    const base = Math.round(n), d = Math.round((n - base) * 10) / 10;
    if (d === 0) return String(base);
    return d < 0 ? base + "+" : base + "−";
  }
  const gradeText = (v, scale) => (scale === "punkte" ? v + " P" : noteLabel(v));

  // ---------- Zustand ----------
  const cfg = window.NC_CONFIG || {};
  const online = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase);
  const sb = online ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { persistSession: false } }) : null;

  const S = {
    me: store.get("nc.me", null),
    profile: store.get("nc.profile", { scale: "noten", subjects: [], show_grades: true }),
    groups: store.get("nc.groups", []),
    tab: store.get("nc.tab", "nc"),
    boardGroup: null,
    boardSubject: "",
    board: null,
    boardError: null,
    plan: { status: "idle", progress: 0, text: "", found: null, preview: null, error: null },
    profileOpen: false,
    pendingJoin: new URLSearchParams(location.search).get("join"),
  };

  async function rpc(fn, args) {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw new Error(error.message);
    return data;
  }
  const auth = () => ({ p_id: S.me.id, p_secret: S.me.secret });

  // ---------- Speichern ----------
  let saveTimer, saving = false;
  function persist() {
    store.set("nc.profile", S.profile);
    if (!online || !S.me) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(pushProfile, 700);
  }
  async function pushProfile() {
    if (saving) { saveTimer = setTimeout(pushProfile, 500); return; }
    saving = true;
    try {
      const subjects = S.profile.subjects.map((s) => {
        const avg = subjectAvg(s);
        return { ...s, avgNote: avg == null ? null : Math.round(toNote(avg, S.profile.scale) * 100) / 100 };
      });
      await rpc("save_profile", { ...auth(), p_name: S.me.name, p_scale: S.profile.scale, p_subjects: subjects, p_nc: calcNC(S.profile), p_show: S.profile.show_grades });
      S.board = null; // Rangliste neu laden
    } catch (e) {
      toast("Speichern fehlgeschlagen: " + e.message, true);
    } finally { saving = false; }
  }

  // ---------- Demo-Daten (nur ohne Datenbank) ----------
  function demoBoard() {
    const mk = (name, nc, subs) => ({ id: "demo-" + name, name, nc, demo: true, updated_at: new Date(Date.now() - Math.random() * 6e8).toISOString(),
      subjects: subs.map(([n, a]) => ({ name: n, include: true, avgNote: a })) });
    const rows = [
      mk("Lena (Beispiel)", 1.42, [["Mathematik", 1.3], ["Deutsch", 1.7], ["Englisch", 1.0], ["Biologie", 1.7]]),
      mk("Yusuf (Beispiel)", 1.86, [["Mathematik", 1.0], ["Deutsch", 2.7], ["Physik", 1.3], ["Englisch", 2.3]]),
      mk("Mia (Beispiel)", 2.21, [["Mathematik", 2.7], ["Deutsch", 1.7], ["Englisch", 2.0], ["Kunst", 1.0]]),
      mk("Jonas (Beispiel)", 2.64, [["Mathematik", 3.0], ["Deutsch", 2.3], ["Geschichte", 2.0], ["Sport", 1.0]]),
      mk("Emir (Beispiel)", 3.05, [["Mathematik", 3.7], ["Deutsch", 3.0], ["Englisch", 2.3], ["Chemie", 3.3]]),
    ];
    if (S.me) rows.push({ id: S.me.id, name: S.me.name, nc: calcNC(S.profile), subjects: S.profile.subjects.map((s) => { const a = subjectAvg(s); return { ...s, avgNote: a == null ? null : toNote(a, S.profile.scale) }; }), updated_at: new Date().toISOString() });
    return rows.sort((a, b) => (a.nc ?? 99) - (b.nc ?? 99));
  }

  // ---------- Rendern ----------
  const view = $("#view");
  function render() {
    $("#modeLine").innerHTML = online
      ? '<span class="dot ok"></span>Online · Gruppen werden geteilt'
      : '<span class="dot"></span>Demo-Modus · Daten bleiben in diesem Browser';
    const who = $("#whoBtn");
    who.hidden = !S.me;
    if (S.me) who.innerHTML = `<span class="avatar">${esc(S.me.name.slice(0, 1).toUpperCase())}</span><span>${esc(S.me.name)}</span>`;
    document.querySelectorAll("#tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === S.tab && !S.profileOpen)));
    $("#tabs").hidden = !S.me;

    if (!S.me) return renderWelcome();
    if (S.profileOpen) return renderProfile();
    ({ nc: renderNC, plan: renderPlan, groups: renderGroups, board: renderBoard })[S.tab]();
  }

  function renderWelcome() {
    view.innerHTML = `
      <section class="welcome">
        <h2>Wie stehst du gerade?</h2>
        <p>Lade deinen Stundenplan hoch, trag deine Noten ein und vergleich deinen Schnitt mit deiner Klasse oder deinen Freunden.</p>
        ${S.pendingJoin ? `<p class="note">Du wurdest in die Gruppe <b>${esc(S.pendingJoin.toUpperCase())}</b> eingeladen. Leg kurz ein Profil an, dann bist du drin.</p>` : ""}
        <form id="nameForm" class="row">
          <label class="field grow"><span>Dein Name (sehen die anderen in der Rangliste)</span>
            <input id="nameInput" maxlength="40" required placeholder="z. B. Aly" autocomplete="nickname"></label>
          <button class="btn primary">Los geht's</button>
        </form>
        <details class="small"><summary>Ich habe schon ein Profil auf einem anderen Gerät</summary>
          <form id="importForm" class="row">
            <label class="field grow"><span>Geräte-Code</span><input id="importCode" placeholder="nc1:…"></label>
            <button class="btn">Übernehmen</button>
          </form>
        </details>
      </section>`;
    $("#nameForm").onsubmit = async (e) => {
      e.preventDefault();
      const name = $("#nameInput").value.trim();
      if (!name) return;
      S.me = { id: uid(), secret: secretKey(), name };
      store.set("nc.me", S.me);
      if (online) {
        try { await pushProfileNow(); } catch (err) { toast(err.message, true); }
        await handlePendingJoin();
      }
      S.tab = "plan"; render();
    };
    $("#importForm").onsubmit = (e) => { e.preventDefault(); importDevice($("#importCode").value); };
  }

  async function pushProfileNow() { clearTimeout(saveTimer); await pushProfile(); }

  async function handlePendingJoin() {
    if (!S.pendingJoin || !online) return;
    const code = S.pendingJoin; S.pendingJoin = null;
    history.replaceState(null, "", location.pathname);
    try {
      const name = await rpc("join_group", { ...auth(), p_code: code });
      toast(`Du bist jetzt in „${name}“`);
      await refreshGroups();
      S.boardGroup = code.toUpperCase();
    } catch (e) { toast(e.message, true); }
  }

  // ----- Mein NC -----
  function renderNC() {
    const p = S.profile;
    const nc = calcNC(p);
    const counted = p.subjects.filter((s) => s.include && subjectAvg(s) != null).length;
    const opts = gradeOptions(p.scale);
    view.innerHTML = `
      <section class="hero">
        <div class="nc-card ${ncClass(nc)}">
          <span class="label">Dein NC</span>
          <span class="nc-num">${fmt(nc)}</span>
          <span class="nc-meta">${counted ? `aus ${counted} ${counted === 1 ? "Fach" : "Fächern"}` : "noch keine Noten"}${p.subjects.some((s) => s.lk && s.include) ? " · LK zählen doppelt" : ""}</span>
        </div>
        <div class="hero-side">
          <div class="seg" role="group" aria-label="Notensystem">
            <button data-scale="noten" aria-pressed="${p.scale === "noten"}">Noten 1–6</button>
            <button data-scale="punkte" aria-pressed="${p.scale === "punkte"}">Punkte 0–15</button>
          </div>
          <label class="switch"><input type="checkbox" id="showGrades" ${p.show_grades ? "checked" : ""}><span></span>Einzelnoten in Gruppen zeigen</label>
          <p class="hint">Aus: Andere sehen nur deinen Gesamt-NC.</p>
        </div>
      </section>
      ${p.subjects.length ? "" : `
        <div class="empty">
          <h3>Noch keine Fächer</h3>
          <p>Lade deinen Stundenplan hoch, dann erkennen wir deine Fächer automatisch.</p>
          <button class="btn primary" data-go="plan">Stundenplan hochladen</button>
        </div>`}
      <section class="subjects">
        ${p.subjects.map((s) => {
          const avg = subjectAvg(s);
          return `
          <article class="subj ${s.include ? "" : "off"}" data-id="${s.id}">
            <header>
              <h3>${esc(s.name)}${s.lk ? ' <span class="pill">LK</span>' : ""}</h3>
              <span class="avg ${ncClass(avg == null ? null : toNote(avg, p.scale))}">${avg == null ? "–" : p.scale === "punkte" ? fmt(avg, 1) + " P" : fmt(avg)}</span>
            </header>
            <div class="grades">
              ${(s.grades || []).map((g) => `<button class="grade" data-del="${g.id}" title="${esc(g.label)} · Gewicht ${g.w} – klicken zum Löschen"><b>${esc(gradeText(g.v, p.scale))}</b><small>${esc(g.label)}</small></button>`).join("") || '<span class="muted">Noch keine Noten</span>'}
            </div>
            <form class="add-grade">
              <select name="v" aria-label="Note">${opts.map((o) => `<option value="${o.v}">${o.t}</option>`).join("")}</select>
              <select name="t" aria-label="Art">${GRADE_TYPES.map((t) => `<option value="${t.key}">${t.label} ×${t.w}</option>`).join("")}</select>
              <button class="btn small">+ Note</button>
            </form>
            <footer>
              <label class="switch sm"><input type="checkbox" data-include ${s.include ? "checked" : ""}><span></span>zählt zum NC</label>
              <label class="switch sm"><input type="checkbox" data-lk ${s.lk ? "checked" : ""}><span></span>LK</label>
              <button class="link danger" data-remove>Fach entfernen</button>
            </footer>
          </article>`;
        }).join("")}
      </section>`;

    view.querySelectorAll("[data-scale]").forEach((b) => (b.onclick = () => {
      if (p.scale === b.dataset.scale) return;
      if (p.subjects.some((s) => s.grades?.length)) {
        // Vorhandene Noten umrechnen
        const conv = p.scale === "noten" ? (v) => Math.max(0, Math.min(15, Math.round(17 - 3 * v))) : (v) => Math.round(((17 - v) / 3) * 10) / 10;
        p.subjects.forEach((s) => s.grades?.forEach((g) => (g.v = conv(g.v))));
      }
      p.scale = b.dataset.scale; persist(); render();
    }));
    $("#showGrades").onchange = (e) => { p.show_grades = e.target.checked; persist(); };
    view.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => go(b.dataset.go)));
    view.querySelectorAll(".subj").forEach((card) => {
      const s = p.subjects.find((x) => x.id === card.dataset.id);
      $(".add-grade", card).onsubmit = (e) => {
        e.preventDefault();
        const f = e.target, t = GRADE_TYPES.find((x) => x.key === f.t.value);
        (s.grades ||= []).push({ id: uid().slice(0, 8), v: Number(f.v.value), w: t.w, label: t.label, date: new Date().toISOString().slice(0, 10) });
        persist(); render();
      };
      card.querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => { s.grades = s.grades.filter((g) => g.id !== b.dataset.del); persist(); render(); }));
      $("[data-include]", card).onchange = (e) => { s.include = e.target.checked; persist(); render(); };
      $("[data-lk]", card).onchange = (e) => { s.lk = e.target.checked; persist(); render(); };
      const rm = $("[data-remove]", card);
      rm.onclick = () => {
        if (rm.dataset.armed) { p.subjects = p.subjects.filter((x) => x !== s); persist(); render(); return; }
        rm.dataset.armed = "1"; rm.textContent = "Wirklich entfernen?";
        setTimeout(() => { if (rm.isConnected) { delete rm.dataset.armed; rm.textContent = "Fach entfernen"; } }, 3000);
      };
    });
  }

  // ----- Stundenplan -----
  function renderPlan() {
    const P = S.plan;
    const have = new Set(S.profile.subjects.map((s) => s.name));
    const found = P.found || [];
    const foundNames = new Set(found.map((f) => f.name));
    const others = window.SUBJECTS.filter((s) => !foundNames.has(s.name));
    view.innerHTML = `
      <section class="plan">
        <div class="drop" id="drop" tabindex="0">
          <input type="file" id="planFile" accept="image/*,application/pdf" hidden>
          <div class="drop-inner">
            <strong>Stundenplan hochladen</strong>
            <span>Foto, Screenshot (z. B. WebUntis) oder PDF · hierher ziehen, klicken oder Bild einfügen (Strg+V)</span>
            <button class="btn primary" id="pickBtn" type="button">Datei auswählen</button>
          </div>
          ${P.preview ? `<img class="preview" src="${P.preview}" alt="Dein Stundenplan">` : ""}
        </div>
        ${P.status === "working" ? `<div class="progress"><div style="width:${Math.round(P.progress * 100)}%"></div><span>Stundenplan wird gelesen … ${Math.round(P.progress * 100)} %</span></div>` : ""}
        ${P.error ? `<p class="error">${esc(P.error)}</p>` : ""}
        <details class="small" ${P.status === "idle" && !P.found ? "" : ""}>
          <summary>Oder Stundenplan als Text einfügen</summary>
          <textarea id="planText" rows="5" placeholder="Mo: M D E Bio …">${esc(P.text)}</textarea>
          <button class="btn small" id="parseText" type="button">Fächer erkennen</button>
        </details>

        ${P.found ? `
          <h3 class="sec">${found.length ? `${found.length} Fächer erkannt` : "Keine Fächer erkannt"}</h3>
          <p class="hint">${found.length ? "Hak ab, welche Fächer du übernehmen willst. Ob ein Fach zum NC zählt, kannst du später unter „Mein NC“ ändern." : "Versuch ein schärferes Foto oder wähl deine Fächer unten aus."}</p>
          <div class="chips">
            ${found.map((f) => `<label class="chip ${have.has(f.name) ? "have" : ""}"><input type="checkbox" value="${esc(f.name)}" ${have.has(f.name) ? "checked disabled" : "checked"}><span>${esc(f.name)}${have.has(f.name) ? " ✓" : ""}</span></label>`).join("")}
          </div>` : ""}

        <h3 class="sec">${P.found ? "Weitere Fächer" : "Fächer selbst auswählen"}</h3>
        <div class="chips">
          ${others.map((s) => `<label class="chip ${have.has(s.name) ? "have" : ""}"><input type="checkbox" value="${esc(s.name)}" ${have.has(s.name) ? "checked disabled" : ""}><span>${esc(s.name)}${have.has(s.name) ? " ✓" : ""}</span></label>`).join("")}
        </div>
        <form class="row" id="customForm">
          <label class="field grow"><span>Anderes Fach</span><input id="customName" maxlength="40" placeholder="z. B. Astronomie"></label>
          <button class="btn">Hinzufügen</button>
        </form>
        <div class="sticky-action">
          <button class="btn primary" id="applyBtn">Ausgewählte Fächer übernehmen</button>
        </div>
      </section>`;

    const fileInput = $("#planFile");
    $("#pickBtn").onclick = () => fileInput.click();
    fileInput.onchange = () => fileInput.files[0] && readPlan(fileInput.files[0]);
    const drop = $("#drop");
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
    drop.ondragleave = () => drop.classList.remove("over");
    drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); const f = e.dataTransfer.files[0]; if (f) readPlan(f); };
    $("#parseText").onclick = () => { P.text = $("#planText").value; P.found = window.detectSubjects(P.text); P.error = null; render(); };
    $("#customForm").onsubmit = (e) => {
      e.preventDefault();
      const n = $("#customName").value.trim();
      if (!n) return;
      addSubjects([n]); toast(`${n} hinzugefügt`); render();
    };
    $("#applyBtn").onclick = () => {
      const names = [...view.querySelectorAll(".chips input:checked:not(:disabled)")].map((i) => i.value);
      if (!names.length) return toast("Wähl mindestens ein neues Fach aus", true);
      addSubjects(names);
      toast(`${names.length} ${names.length === 1 ? "Fach" : "Fächer"} übernommen`);
      go("nc");
    };
  }

  function addSubjects(names) {
    const have = new Set(S.profile.subjects.map((s) => s.name.toLowerCase()));
    for (const name of names) {
      if (have.has(name.toLowerCase())) continue;
      S.profile.subjects.push({ id: uid().slice(0, 8), name, include: !/^(sport|religion|ethik|darstellendes spiel)$/i.test(name), lk: false, grades: [] });
    }
    persist();
  }

  async function readPlan(file) {
    const P = S.plan;
    Object.assign(P, { status: "working", progress: 0.02, error: null, found: null });
    try {
      let text = "";
      if (file.type === "application/pdf") {
        P.preview = null; render();
        await loadScript("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js");
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
        const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          text += (await page.getTextContent()).items.map((it) => it.str).join(" ") + "\n";
          P.progress = i / pdf.numPages; render();
        }
        if (text.trim().length < 10) {
          // Gescanntes PDF: erste Seite als Bild an die Texterkennung geben
          const page = await pdf.getPage(1);
          const vp = page.getViewport({ scale: 2 });
          const c = document.createElement("canvas"); c.width = vp.width; c.height = vp.height;
          await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
          P.preview = c.toDataURL("image/jpeg", 0.7);
          text = await ocr(c);
        }
      } else if (file.type.startsWith("image/")) {
        P.preview = URL.createObjectURL(file); render();
        text = await ocr(file);
      } else {
        throw new Error("Bitte ein Bild (JPG, PNG) oder PDF hochladen.");
      }
      P.text = text.trim();
      P.found = window.detectSubjects(text);
      P.status = "done";
    } catch (e) {
      P.status = "idle"; P.error = "Konnte den Stundenplan nicht lesen: " + e.message;
    }
    if (S.tab === "plan") render();
  }

  async function ocr(img) {
    await loadScript("https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js");
    const res = await window.Tesseract.recognize(img, "deu", {
      logger: (m) => { if (m.status === "recognizing text") { S.plan.progress = 0.1 + m.progress * 0.9; if (S.tab === "plan") updateProgress(); } },
    });
    return res.data.text;
  }
  function updateProgress() {
    const bar = $(".progress div"), lbl = $(".progress span");
    if (bar) bar.style.width = Math.round(S.plan.progress * 100) + "%";
    if (lbl) lbl.textContent = `Stundenplan wird gelesen … ${Math.round(S.plan.progress * 100)} %`;
    else render();
  }
  document.addEventListener("paste", (e) => {
    if (!S.me || S.tab !== "plan" || S.profileOpen) return;
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
    if (item) { e.preventDefault(); readPlan(item.getAsFile()); }
  });

  // ----- Gruppen -----
  async function refreshGroups() {
    if (!online) return;
    try { S.groups = await rpc("my_groups", auth()); store.set("nc.groups", S.groups); } catch (e) { toast(e.message, true); }
  }

  function inviteLink(code) { return location.origin + location.pathname + "?join=" + encodeURIComponent(code); }

  function renderGroups() {
    const groups = online ? S.groups : [{ code: "DEMO10", name: "Beispielklasse 10b", members: 6 }];
    view.innerHTML = `
      ${online ? "" : `<p class="note">Im Demo-Modus gibt es nur eine Beispielgruppe. Sobald die Datenbank verbunden ist (siehe README), kannst du echte Gruppen erstellen und Freunde einladen.</p>`}
      <section class="two">
        <form id="createForm" class="panel">
          <h3>Neue Gruppe</h3>
          <label class="field"><span>Name</span><input id="groupName" maxlength="60" required placeholder="z. B. Q1 Mathe-LK"></label>
          <button class="btn primary" ${online ? "" : "disabled"}>Gruppe erstellen</button>
        </form>
        <form id="joinForm" class="panel">
          <h3>Gruppe beitreten</h3>
          <label class="field"><span>Gruppen-Code</span><input id="joinCode" maxlength="6" required placeholder="ABC123" class="mono" autocapitalize="characters"></label>
          <button class="btn" ${online ? "" : "disabled"}>Beitreten</button>
        </form>
      </section>
      <h3 class="sec">Deine Gruppen</h3>
      <section class="group-list">
        ${groups.length ? groups.map((g) => `
          <article class="group">
            <div class="g-main">
              <h4>${esc(g.name)}</h4>
              <span class="muted">${g.members} ${g.members == 1 ? "Mitglied" : "Mitglieder"} · Code <b class="mono">${esc(g.code)}</b></span>
            </div>
            <div class="g-actions">
              <button class="btn small primary" data-board="${esc(g.code)}">Rangliste</button>
              ${online ? `<button class="btn small" data-copy="${esc(g.code)}">Einladungslink kopieren</button>
              <button class="link danger" data-leave="${esc(g.code)}">Verlassen</button>` : ""}
            </div>
          </article>`).join("") : '<div class="empty"><p>Du bist noch in keiner Gruppe. Erstell eine und schick den Link an deine Klasse.</p></div>'}
      </section>`;

    $("#createForm").onsubmit = async (e) => {
      e.preventDefault();
      try {
        const code = await rpc("create_group", { ...auth(), p_name: $("#groupName").value.trim() });
        await refreshGroups();
        toast(`Gruppe erstellt · Code ${code}`);
        render();
      } catch (err) { toast(err.message, true); }
    };
    $("#joinForm").onsubmit = async (e) => {
      e.preventDefault();
      try {
        const name = await rpc("join_group", { ...auth(), p_code: $("#joinCode").value });
        await refreshGroups(); toast(`Du bist jetzt in „${name}“`); render();
      } catch (err) { toast(err.message, true); }
    };
    view.querySelectorAll("[data-board]").forEach((b) => (b.onclick = () => { S.boardGroup = b.dataset.board; S.board = null; go("board"); }));
    view.querySelectorAll("[data-copy]").forEach((b) => (b.onclick = async () => {
      const link = inviteLink(b.dataset.copy);
      try { await navigator.clipboard.writeText(link); toast("Link kopiert – schick ihn in eure Klassengruppe"); }
      catch { prompt("Link kopieren:", link); }
    }));
    view.querySelectorAll("[data-leave]").forEach((b) => (b.onclick = async () => {
      if (!b.dataset.armed) { b.dataset.armed = "1"; b.textContent = "Wirklich verlassen?"; return; }
      try { await rpc("leave_group", { ...auth(), p_code: b.dataset.leave }); await refreshGroups(); if (S.boardGroup === b.dataset.leave) S.boardGroup = null; render(); }
      catch (err) { toast(err.message, true); }
    }));
  }

  // ----- Rangliste -----
  async function loadBoard() {
    if (!online) { S.board = demoBoard(); return; }
    try { S.board = await rpc("leaderboard", { ...auth(), p_code: S.boardGroup }); S.boardError = null; }
    catch (e) { S.board = []; S.boardError = e.message; }
  }

  function renderBoard() {
    const groups = online ? S.groups : [{ code: "DEMO10", name: "Beispielklasse 10b" }];
    if (!groups.length) {
      view.innerHTML = `<div class="empty"><h3>Noch keine Gruppe</h3><p>Erstell eine Gruppe oder tritt einer bei, um dich mit anderen zu vergleichen.</p><button class="btn primary" data-go="groups">Zu den Gruppen</button></div>`;
      $("[data-go]").onclick = () => go("groups");
      return;
    }
    if (!groups.some((g) => g.code === S.boardGroup)) { S.boardGroup = groups[0].code; S.board = null; }
    if (!S.board) {
      view.innerHTML = `<p class="muted center">Rangliste lädt …</p>`;
      loadBoard().then(() => S.tab === "board" && !S.profileOpen && render());
      return;
    }
    // Alle Fächer, die in der Gruppe vorkommen
    const subjNames = [...new Set(S.board.flatMap((r) => (r.subjects || []).filter((s) => s.include && s.avgNote != null).map((s) => s.name)))].sort((a, b) => a.localeCompare(b, "de"));
    if (S.boardSubject && !subjNames.includes(S.boardSubject)) S.boardSubject = "";

    let rows = S.board.map((r) => {
      const score = S.boardSubject ? (r.subjects || []).find((s) => s.name === S.boardSubject && s.include)?.avgNote ?? null : r.nc == null ? null : Number(r.nc);
      const counted = (r.subjects || []).filter((s) => s.include && s.avgNote != null);
      const best = counted.slice().sort((a, b) => a.avgNote - b.avgNote)[0];
      return { ...r, score, counted: counted.length, best };
    });
    if (S.boardSubject) rows = rows.filter((r) => r.score != null);
    rows.sort((a, b) => (a.score ?? 99) - (b.score ?? 99));
    // Gleicher Schnitt = gleicher Platz
    let rank = 0, prev = null;
    rows.forEach((r, i) => { if (r.score == null) r.rank = null; else { if (r.score !== prev) rank = i + 1; r.rank = rank; prev = r.score; } });

    const mine = rows.find((r) => r.id === S.me.id);
    const scored = rows.filter((r) => r.score != null);
    const groupAvg = scored.length ? scored.reduce((a, r) => a + r.score, 0) / scored.length : null;
    const podium = scored.slice(0, 3);

    view.innerHTML = `
      <section class="board-head">
        <label class="field"><span>Gruppe</span>
          <select id="groupSel">${groups.map((g) => `<option value="${esc(g.code)}" ${g.code === S.boardGroup ? "selected" : ""}>${esc(g.name)}</option>`).join("")}</select></label>
        <label class="field"><span>Wertung</span>
          <select id="subjSel"><option value="">Gesamt-NC</option>${subjNames.map((n) => `<option ${n === S.boardSubject ? "selected" : ""}>${esc(n)}</option>`).join("")}</select></label>
        <button class="btn small" id="reloadBtn" type="button">Aktualisieren</button>
      </section>
      ${S.boardError ? `<p class="error">${esc(S.boardError)}</p>` : ""}
      ${online ? "" : `<p class="note">Beispieldaten – im Demo-Modus siehst du erfundene Mitschüler neben deinem eigenen NC.</p>`}

      <section class="stats">
        <div><span class="label">Dein Platz</span><b>${mine?.rank ? mine.rank + ". von " + scored.length : "–"}</b></div>
        <div><span class="label">Dein Schnitt</span><b>${fmt(mine?.score)}</b></div>
        <div><span class="label">Gruppenschnitt</span><b>${fmt(groupAvg)}</b></div>
        <div><span class="label">Abstand zu Platz 1</span><b>${mine?.score != null && scored[0] ? (mine.score === scored[0].score ? "Du bist vorne" : "+" + fmt(mine.score - scored[0].score)) : "–"}</b></div>
      </section>

      ${podium.length ? `<section class="podium">
        ${[1, 0, 2].filter((i) => podium[i]).map((i) => `
          <div class="step p${i + 1} ${podium[i].id === S.me.id ? "me" : ""}">
            <span class="p-name">${esc(podium[i].name)}</span>
            <span class="p-nc">${fmt(podium[i].score)}</span>
            <div class="block"><span>${podium[i].rank}</span></div>
          </div>`).join("")}
      </section>` : ""}

      <div class="table-wrap">
        <table class="board">
          <thead><tr><th>#</th><th>Name</th><th class="num">${S.boardSubject ? esc(S.boardSubject) : "NC"}</th><th class="hide-sm">Fächer</th><th class="hide-sm">Bestes Fach</th><th class="hide-sm">Stand</th></tr></thead>
          <tbody>
            ${rows.map((r) => `
              <tr class="${r.id === S.me.id ? "me" : ""}">
                <td class="rank">${r.rank ?? "–"}</td>
                <td>${esc(r.name)}${r.id === S.me.id ? ' <span class="pill">du</span>' : ""}</td>
                <td class="num"><span class="score ${ncClass(r.score)}">${fmt(r.score)}</span></td>
                <td class="hide-sm">${(r.subjects || []).length ? r.counted : r.nc != null ? '<span class="muted">privat</span>' : "0"}</td>
                <td class="hide-sm">${r.best ? esc(r.best.name) + " (" + fmt(r.best.avgNote, 1) + ")" : '<span class="muted">–</span>'}</td>
                <td class="hide-sm muted">${r.updated_at ? new Date(r.updated_at).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" }) : ""}</td>
              </tr>`).join("") || `<tr><td colspan="6" class="muted center">Noch niemand hat Noten in diesem Fach.</td></tr>`}
          </tbody>
        </table>
      </div>
      <p class="hint">Niedriger ist besser. Wer Einzelnoten ausgeblendet hat, erscheint nur in der Gesamt-Wertung.</p>`;

    $("#groupSel").onchange = (e) => { S.boardGroup = e.target.value; S.board = null; render(); };
    $("#subjSel").onchange = (e) => { S.boardSubject = e.target.value; render(); };
    $("#reloadBtn").onclick = () => { S.board = null; render(); };
  }

  // ----- Profil -----
  function deviceCode() { return "nc1:" + btoa(JSON.stringify([S.me.id, S.me.secret, S.me.name])); }
  async function importDevice(code) {
    try {
      const [id, secret, name] = JSON.parse(atob(code.trim().replace(/^nc1:/, "")));
      if (!id || !secret) throw new Error();
      S.me = { id, secret, name };
      if (online) {
        const rows = await rpc("load_profile", { p_id: id, p_secret: secret });
        const r = rows[0];
        S.me.name = r.name;
        S.profile = { scale: r.scale, subjects: (r.subjects || []).map(({ avgNote, ...s }) => s), show_grades: r.show_grades };
        store.set("nc.profile", S.profile);
        await refreshGroups();
      }
      store.set("nc.me", S.me);
      S.profileOpen = false; S.tab = "nc"; toast("Profil übernommen"); render();
    } catch (e) {
      S.me = store.get("nc.me", null);
      toast("Der Code passt nicht. " + (e.message || ""), true);
    }
  }

  function renderProfile() {
    view.innerHTML = `
      <section class="panel narrow">
        <h3>Profil</h3>
        <form id="renameForm" class="row">
          <label class="field grow"><span>Name</span><input id="renameInput" maxlength="40" value="${esc(S.me.name)}" required></label>
          <button class="btn">Speichern</button>
        </form>
        <h4>Auf anderem Gerät nutzen</h4>
        <p class="hint">Diesen Code auf dem anderen Gerät beim Start unter „Ich habe schon ein Profil“ einfügen. Behalte ihn für dich – wer ihn hat, kann deine Noten ändern.</p>
        <div class="row">
          <input class="mono grow" id="devCode" readonly value="${esc(deviceCode())}">
          <button class="btn" id="copyCode" type="button">Kopieren</button>
        </div>
        <div class="row end"><button class="btn" id="closeProfile" type="button">Fertig</button></div>
      </section>`;
    $("#renameForm").onsubmit = (e) => {
      e.preventDefault();
      S.me.name = $("#renameInput").value.trim() || S.me.name;
      store.set("nc.me", S.me); persist(); toast("Name gespeichert"); render();
    };
    $("#copyCode").onclick = async () => { try { await navigator.clipboard.writeText(deviceCode()); toast("Code kopiert"); } catch { $("#devCode").select(); } };
    $("#closeProfile").onclick = () => { S.profileOpen = false; render(); };
  }

  // ---------- Navigation ----------
  function go(tab) { S.tab = tab; S.profileOpen = false; store.set("nc.tab", tab); render(); window.scrollTo({ top: 0, behavior: "smooth" }); }
  $("#tabs").onclick = (e) => { const b = e.target.closest("button[data-tab]"); if (b) go(b.dataset.tab); };
  $("#whoBtn").onclick = () => { S.profileOpen = !S.profileOpen; render(); };

  // ---------- Start ----------
  (async () => {
    render();
    if (online && S.me) {
      await refreshGroups();
      if (S.pendingJoin) { await handlePendingJoin(); S.tab = "board"; }
      render();
    }
  })();
})();
