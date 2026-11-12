/* Market Matter: full-page renderer. Reads data/latest.json and data/index.json written by sweep/sweep.py. */
(function () {
  "use strict";
  const DATA = "data/latest.json", ARCHIVE = "data/index.json";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const tone = (p) => (p == null || Math.abs(p) < 0.005 ? "flat" : p > 0 ? "up" : "down");
  const sign = (x) => (x > 0 ? "+" : x < 0 ? "−" : "");
  const pct = (p) => (p == null ? "–" : sign(p) + Math.abs(p).toFixed(2) + "%");
  const num = (x, d = 2) => (x == null ? "–" : Number(x).toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d }));
  const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : "#");
  const istTime = (iso) => new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });
  const istDay = (iso) => new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
  const longDate = (d) => new Date(d + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  const shortDate = (d) => new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const tri = (t) => t === "up" ? `<svg viewBox="0 0 10 10"><path d="M5 1l4 7H1z"/></svg>` : t === "down" ? `<svg viewBox="0 0 10 10"><path d="M5 9L1 2h8z"/></svg>` : "";
  const chip = (p, t = tone(p)) => `<span class="chip ${t}">${tri(t)}${pct(p)}</span>`;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  let data = null, archive = [], range = 21, showAll = false, newsTag = "All";

  /* ---------------------------------------------------------------- theme + status */
  $("#themeBtn").addEventListener("click", () => {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    root.dataset.theme = dark ? "light" : "dark";
    try { localStorage.setItem("mm-theme", root.dataset.theme); } catch (e) {}
  });

  function marketStatus() {
    const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    const day = now.getDay(), m = now.getHours() * 60 + now.getMinutes();
    if (day === 0 || day === 6) return ["closed", "Market closed"];
    if (m >= 540 && m < 555) return ["pre-open", "Pre-open"];
    if (m >= 555 && m < 930) return ["live", "Market open"];
    return ["closed", "Market closed"];
  }
  function paintStatus() {
    const [cls, txt] = marketStatus(), el = $("#status");
    el.className = "status " + cls; el.lastElementChild.textContent = txt;
  }
  paintStatus(); setInterval(paintStatus, 60000);

  /* ---------------------------------------------------------------- tape */
  function paintTape(d) {
    const items = [...(d.indices || []), ...(d.global || []), ...(d.macro || [])].map((i) => {
      const isFx = i.name === "US dollar in rupees", t = isFx ? tone(-i.pct) : tone(i.pct);
      const name = isFx ? "USD/INR" : i.name;
      const val = i.kind === "yield" ? num(i.last) + "%" : num(i.last);
      return `<span class="tape-item"><b>${esc(name)}</b><span>${val}</span><em class="${t}">${pct(i.pct)}</em></span>`;
    }).join("");
    $("#tape").innerHTML = items + items; // twice, for a seamless loop
  }

  /* ---------------------------------------------------------------- chart */
  function niceTicks(lo, hi, n = 4) {
    const span = hi - lo || 1, step0 = span / n, mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= step0) || step0;
    const a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step, out = [];
    for (let v = a; v <= b + step / 2; v += step) out.push(v);
    return out;
  }

  function drawChart(host, pts, animate) {
    if (!host || !pts || pts.length < 2) { if (host) host.innerHTML = `<div class="msg">Not enough history to chart yet.</div>`; return; }
    const W = host.clientWidth, H = host.clientHeight, padR = 58, padB = 26, padT = 8;
    const vals = pts.map((p) => p.c), first = vals[0], last = vals[vals.length - 1];
    const ticks = niceTicks(Math.min(...vals), Math.max(...vals));
    const lo = ticks[0], hi = ticks[ticks.length - 1];
    const cw = W - padR, ch = H - padB - padT;
    const X = (i) => (i / (pts.length - 1)) * cw, Y = (v) => padT + (1 - (v - lo) / (hi - lo || 1)) * ch;
    const t = last >= first ? "up" : "down", col = `var(--${t})`;
    const line = pts.map((p, i) => (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(p.c).toFixed(1)).join(" ");
    const area = `${line} L${cw} ${padT + ch} L0 ${padT + ch} Z`;
    const xIdx = [...new Set([0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * (pts.length - 1))))];
    const gid = "g" + Math.random().toString(36).slice(2, 7);
    host.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Nifty 50 closing levels, ${esc(shortDate(pts[0].d))} to ${esc(shortDate(pts[pts.length - 1].d))}">
        <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${col}" stop-opacity=".22"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
        ${ticks.map((v) => `<line class="grid-l" x1="0" x2="${cw}" y1="${Y(v)}" y2="${Y(v)}"/><text class="ax" x="${cw + 10}" y="${Y(v) + 4}">${num(v, 0)}</text>`).join("")}
        ${xIdx.map((i) => `<text class="ax" x="${X(i)}" y="${H - 6}" text-anchor="${i === 0 ? "start" : i === pts.length - 1 ? "end" : "middle"}">${esc(shortDate(pts[i].d))}</text>`).join("")}
        <line class="base" x1="0" x2="${cw}" y1="${Y(first)}" y2="${Y(first)}"/>
        <path d="${area}" fill="url(#${gid})" ${animate && !reduced ? `style="opacity:0;animation:fadeIn .9s .5s forwards"` : ""}/>
        <path class="ln" d="${line}" stroke="${col}"/>
        <circle class="end-ring" cx="${X(pts.length - 1)}" cy="${Y(last)}" r="4" fill="${col}"/>
        <circle cx="${X(pts.length - 1)}" cy="${Y(last)}" r="4" fill="${col}" stroke="var(--card)" stroke-width="2"/>
        <line class="xh" x1="0" x2="0" y1="${padT}" y2="${padT + ch}"/>
        <circle class="dot-h" r="5" fill="${col}" stroke="var(--card)" stroke-width="2.5"/>
      </svg><div class="tip"></div>`;
    const ln = $(".ln", host);
    if (animate && !reduced) { const L = ln.getTotalLength(); ln.style.setProperty("--len", L); ln.classList.add("draw"); }
    const xh = $(".xh", host), dot = $(".dot-h", host), tip = $(".tip", host);
    const move = (e) => {
      const r = host.getBoundingClientRect(), x = Math.max(0, Math.min(cw, e.clientX - r.left));
      const i = Math.round((x / cw) * (pts.length - 1)), p = pts[i], prev = pts[i - 1];
      const px = X(i), py = Y(p.c);
      xh.setAttribute("x1", px); xh.setAttribute("x2", px); dot.setAttribute("cx", px); dot.setAttribute("cy", py);
      const chg = prev ? ((p.c - prev.c) / prev.c) * 100 : null;
      tip.innerHTML = `${esc(longDate(p.d))}<br><b>${num(p.c)}</b>${chg != null ? ` <span style="opacity:.75">${pct(chg)}</span>` : ""}`;
      const tw = tip.offsetWidth;
      tip.style.left = Math.max(tw / 2, Math.min(W - tw / 2, px)) + "px";
      tip.style.top = Math.max(0, py - 62) + "px";
      host.classList.add("hover");
    };
    host.onpointermove = move; host.onpointerdown = move;
    host.onpointerleave = () => host.classList.remove("hover");
  }

  /* ---------------------------------------------------------------- pieces */
  function gauge(share) { // share of Nifty 50 stocks that rose, 0..1
    const a = -90 + share * 180;
    const arc = (r) => `M ${140 - r} 140 A ${r} ${r} 0 0 1 ${140 + r} 140`;
    return `<div class="gauge"><svg viewBox="0 0 280 160" role="img" aria-label="${Math.round(share * 100)}% of Nifty 50 stocks rose">
      <defs><linearGradient id="gg" x1="0" x2="1"><stop offset="0" stop-color="var(--down)"/><stop offset=".5" stop-color="var(--ink-3)" stop-opacity=".45"/><stop offset="1" stop-color="var(--up)"/></linearGradient></defs>
      <path d="${arc(108)}" fill="none" stroke="url(#gg)" stroke-width="20" stroke-linecap="round"/>
      ${[0, 0.25, 0.5, 0.75, 1].map((f) => { const ang = Math.PI * (1 - f), x1 = 140 + Math.cos(ang) * 86, y1 = 140 - Math.sin(ang) * 86, x2 = 140 + Math.cos(ang) * 80, y2 = 140 - Math.sin(ang) * 80;
        return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--line-2)" stroke-width="2"/>`; }).join("")}
      <g class="needle" style="transform:rotate(${reduced ? a : -90}deg)" data-a="${a}">
        <path d="M137 140 L140 50 L143 140 Z" fill="var(--ink)"/></g>
      <circle cx="140" cy="140" r="10" fill="var(--ink)"/><circle cx="140" cy="140" r="4" fill="var(--card)"/>
      <text class="lbl" x="22" y="158" text-anchor="middle">Fell</text><text class="lbl" x="258" y="158" text-anchor="middle">Rose</text>
    </svg></div>`;
  }

  const ICONS = {
    sector: `<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>`,
    global: `<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>`,
    breadth: `<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>`,
    yields: `<path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/>`,
    stock: `<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 14l3-3 3 2 4-5"/>`,
    vix: `<path d="M2 12h4l3-8 4 16 3-8h6"/>`,
    crude: `<path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z"/>`,
    gold: `<path d="M4 18h16l-3-6H7z"/><path d="M8 12l2-5h4l2 5"/>`,
    rupee: `<path d="M6 4h12M6 9h12M6 4h3a5 5 0 0 1 0 10H6l8 6"/>`,
    flows: `<path d="M3 7h13l-3-3M21 17H8l3 3"/>`,
  };
  const KIND = { sector: "Sectors", global: "Global cues", breadth: "Breadth", yields: "US yields", stock: "Big mover", vix: "Volatility", crude: "Crude oil", gold: "Gold", rupee: "Rupee", flows: "Foreign flows" };
  const kindOf = (k) => (k || "").split("-")[0];

  function bars(rows) {
    const vals = rows.map((r) => r.pct), lo = Math.min(0, ...vals), hi = Math.max(0, ...vals), span = hi - lo || 1;
    const pos = (v) => ((v - lo) / span) * 100, z = pos(0);
    return `<div class="bars">${rows.map((r) => {
      const x = pos(r.pct), left = Math.min(z, x), w = Math.max(Math.abs(x - z), r.pct ? 0.8 : 0);
      return `<div class="bar"><span class="lbl">${esc(r.name)}</span>
        <span class="track"><span class="fill ${tone(r.pct)}" style="left:${left}%;width:${w}%"></span>${z > 0 && z < 100 ? `<span class="zero" style="left:${z}%"></span>` : ""}</span>
        <span class="val ${tone(r.pct)}">${pct(r.pct)}</span></div>`;
    }).join("")}</div>`;
  }

  function movers(title, rows, maxAbs) {
    return `<div class="card reveal"><h3 class="card-title">${esc(title)} <span>Nifty 50</span></h3>
      <table class="mv"><thead><tr><th>Stock</th><th class="r">Price ₹</th><th class="r">Change</th><th class="mb"><span class="sr-only">Size of move</span></th></tr></thead><tbody>
      ${rows.map((s) => `<tr><td><span class="nm">${esc(s.name)}</span><span class="tk">${esc(s.ticker || "")}</span></td>
        <td class="r num">${num(s.last)}</td><td class="r">${chip(s.pct)}</td>
        <td class="mb"><span class="${tone(s.pct)}" style="width:${Math.max(4, (Math.abs(s.pct) / maxAbs) * 100)}%"></span></td></tr>`).join("")}
      </tbody></table></div>`;
  }

  function bullets(d, I) {
    const out = [], s = d.sectors || [], g = d.gainers || [], l = d.losers || [], b = d.breadth || {};
    if (I.nifty) out.push(`Nifty 50 closed at <b>${num(I.nifty.last)}</b>, ${I.nifty.pct >= 0 ? "up" : "down"} <b>${pct(I.nifty.pct)}</b> (${sign(I.nifty.chg)}${num(Math.abs(I.nifty.chg))} pts)${I.sensex ? `; the Sensex ended at <b>${num(I.sensex.last)}</b> (${pct(I.sensex.pct)})` : ""}.`);
    if (I.bank || I.midcap) out.push([I.bank && `Nifty Bank moved <b>${pct(I.bank.pct)}</b>`, I.midcap && `${esc(I.midcap.name)} <b>${pct(I.midcap.pct)}</b>`].filter(Boolean).join(", ") + ".");
    if (s.length) out.push(`<b>${esc(s[0].name)}</b> led the sectors (${pct(s[0].pct)}), while <b>${esc(s[s.length - 1].name)}</b> lagged (${pct(s[s.length - 1].pct)}).`);
    if (g.length && l.length) out.push(`Top Nifty gainer was <b>${esc(g[0].name)}</b> (${pct(g[0].pct)}); biggest faller was <b>${esc(l[0].name)}</b> (${pct(l[0].pct)}).`);
    if (b.total) out.push(`Breadth: <b>${b.adv}</b> advances vs <b>${b.dec}</b> declines among Nifty 50 stocks.`);
    if (I.vix) out.push(`India VIX ${I.vix.pct < 0 ? "eased" : "rose"} <b>${pct(I.vix.pct)}</b> to <b>${num(I.vix.last)}</b>.`);
    return out;
  }

  /* ---------------------------------------------------------------- render */
  function render(animate = true) {
    const d = data, I = Object.fromEntries((d.indices || []).map((i) => [i.key, i]));
    const nifty = I.nifty || (d.indices || [])[0] || {};
    const b = d.breadth || { adv: 0, dec: 0, unch: 0, total: 0 };
    const latest = !archive.length || archive[0].date === d.market_date;
    const trend = d.nifty_trend || [];
    const pts = range ? trend.slice(-range) : trend;
    const pv = pts.map((p) => p.c);
    const rChg = pv.length > 1 ? ((pv[pv.length - 1] - pv[0]) / pv[0]) * 100 : null;
    const sectors = d.sectors || [], sMax = Math.max(1, ...sectors.map((s) => Math.abs(s.pct)));
    const share = b.total ? b.adv / b.total : 0.5;
    const mood = share >= 0.65 ? ["Broad rally", "up"] : share <= 0.35 ? ["Broad selling", "down"] : share >= 0.5 ? ["Mixed, tilted up", "up"] : ["Mixed, tilted down", "down"];
    const sp = (d.global || []).find((g) => g.session === "overnight");
    const news = d.news || [];
    const tags = ["All", ...[...new Set(news.flatMap((n) => n.tags || []))]];
    const shown = news.filter((n) => newsTag === "All" || (n.tags || []).includes(newsTag));
    const mvMax = Math.max(1, ...[...(d.gainers || []), ...(d.losers || [])].map((s) => Math.abs(s.pct)));
    const idxMax = Math.max(0.5, ...(d.indices || []).filter((i) => i.key !== "vix").map((i) => Math.abs(i.pct)));

    $("#updated").textContent = `Sweep ran ${istDay(d.generated_at)}, ${istTime(d.generated_at)} IST`;
    paintTape(d);

    $("#app").innerHTML = `
    <section id="overview" class="grid g-hero">
      <div class="card hero">
        <div class="hero-head">
          <div>
            <div class="hero-name">${esc(nifty.name || "Nifty 50")}</div>
            <div class="hero-price num" id="heroPrice">${num(nifty.last)}</div>
            <div class="hero-chg"><span class="${tone(nifty.pct)}">${sign(nifty.chg)}${num(Math.abs(nifty.chg))}</span>${chip(nifty.pct)}
              <span class="date">${esc(longDate(d.market_date))}${d.session === "intraday" ? " · intraday" : " · close"}</span></div>
          </div>
          <div class="seg" role="group" aria-label="Chart range">
            ${[[10, "2W"], [21, "1M"], [0, "All"]].map(([n, l]) => `<button type="button" data-r="${n}" class="${range === n ? "on" : ""}">${l}</button>`).join("")}
          </div>
        </div>
        <div class="chart" id="chart"></div>
        <dl class="hero-stats">
          <div><dt>Prev close</dt><dd>${num(nifty.prev)}</dd></div>
          <div><dt>Day change</dt><dd class="${tone(nifty.chg)}">${sign(nifty.chg)}${num(Math.abs(nifty.chg))}</dd></div>
          <div><dt>Period high</dt><dd>${pv.length ? num(Math.max(...pv)) : "–"}</dd></div>
          <div><dt>Period low</dt><dd>${pv.length ? num(Math.min(...pv)) : "–"}</dd></div>
          <div><dt>Period change</dt><dd class="${tone(rChg)}">${pct(rChg)}</dd></div>
          <div><dt>Breadth</dt><dd><span class="up">${b.adv}</span> / <span class="down">${b.dec}</span></dd></div>
        </dl>
      </div>
      <div class="card">
        <h2 class="card-title">Indian indices <label class="pick"><span class="sr-only">Past sweeps</span><select id="pick" ${archive.length < 2 ? "disabled" : ""}>
          ${(archive.length ? archive : [{ date: d.market_date, file: "" }]).map((s) => `<option value="${esc(s.file)}" ${s.date === d.market_date ? "selected" : ""}>${esc(longDate(s.date))}</option>`).join("")}
        </select></label></h2>
        <div class="idx-list">
          ${(d.indices || []).map((i, k) => `<div class="idx-row ${k === 0 ? "lead" : ""}">
            <div><div class="nm">${esc(i.name)}</div><div class="lv">${num(i.last)}</div></div>
            <div class="mag" title="${esc(pct(i.pct))}"><i class="${tone(i.pct)}" style="width:${Math.min(1, Math.abs(i.pct) / idxMax) * 50}%"></i></div>
            <span style="justify-self:end">${chip(i.pct)}</span></div>`).join("")}
        </div>
        <p class="idx-note">${latest ? "Latest sweep" : "Archived sweep"} · bars scale to the day's largest index move (VIX capped). A falling VIX means calmer markets.</p>
      </div>
    </section>

    <section class="grid g-brief">
      <div class="card brief reveal">
        <h2 class="card-title">The day in 60 seconds</h2>
        <h3 class="head">${esc(d.headline)}</h3>
        <p class="lede">${esc(d.summary)}</p>
        <ul class="bullets">${bullets(d, I).map((x) => `<li>${x}</li>`).join("")}</ul>
      </div>
      <div class="card reveal">
        <h2 class="card-title">Market breadth <span>Nifty 50 stocks</span></h2>
        <div class="pulse">
          ${gauge(share)}
          <div class="mood ${mood[1]}">${mood[0]}</div>
          <div class="mood-sub">${b.adv} rose · ${b.dec} fell${b.unch ? ` · ${b.unch} unchanged` : ""}</div>
          <dl class="mini">
            <div><dt>Sectors up</dt><dd>${sectors.filter((s) => s.pct > 0).length}/${sectors.length}</dd></div>
            <div><dt>India VIX</dt><dd class="${I.vix ? tone(-I.vix.pct) : ""}">${I.vix ? num(I.vix.last) : "–"}</dd></div>
            <div><dt>${sp ? esc(sp.name) : "Overnight"}</dt><dd class="${sp ? tone(sp.pct) : ""}">${sp ? pct(sp.pct) : "–"}</dd></div>
          </dl>
        </div>
      </div>
    </section>

    <div class="sec-head" id="why"><h2>Why it moved</h2><p>Signals that moved with the market beyond set thresholds, strongest first.</p></div>
    ${(d.drivers || []).length ? `<section class="drivers">${d.drivers.map((x) => {
      const k = kindOf(x.key), lit = Math.max(1, Math.min(5, Math.ceil(x.strength / 1.5)));
      return `<article class="card drv t-${esc(x.tone)} reveal">
        <div class="drv-top"><span class="drv-kind"><svg viewBox="0 0 24 24">${ICONS[k] || ICONS.stock}</svg>${esc(KIND[k] || k)}</span>
          <span class="strength" title="Signal strength ${esc(x.strength)}">${[1, 2, 3, 4, 5].map((n) => `<i class="${n <= lit ? "on" : ""}"></i>`).join("")}</span></div>
        <h3>${esc(x.title)}</h3>
        <p>${esc(x.text)}</p>
        ${(x.evidence || []).length ? `<div class="ev">${x.evidence.map((e) => `<span><i>${esc(e.label)}</i>${esc(e.value)}</span>`).join("")}</div>` : ""}
        ${(x.headlines || []).length ? `<ul class="hl">${x.headlines.map((h) => `<li><a href="${esc(safeUrl(h.url))}" target="_blank" rel="noopener">${esc(h.title)}</a> <span class="src">· ${esc(h.source)}</span></li>`).join("")}</ul>` : ""}
      </article>`; }).join("")}</section>` : `<div class="card msg">No signal crossed its threshold: a quiet session.</div>`}

    <div class="sec-head" id="sectors"><h2>Sectors</h2><p>NSE sector indices, ${esc(longDate(d.market_date))}.</p></div>
    <section class="grid g-2">
      <div class="card reveal"><h3 class="card-title">Heatmap <span>colour depth = size of move</span></h3>
        <div class="heat">${sectors.map((s) => { const m = Math.round(Math.min(1, Math.abs(s.pct) / sMax) * 62 + 10);
          return `<div class="tile ${tone(s.pct)} ${m > 45 ? "strong" : ""}" style="--mix:${m}%"><span class="tn">${esc(s.name)}</span><span><span class="tp">${pct(s.pct)}</span><br><span class="tl">${num(s.last)}</span></span></div>`; }).join("")}</div>
      </div>
      <div class="card reveal"><h3 class="card-title">Ranked <span>best to worst</span></h3>${bars(sectors)}</div>
    </section>

    <div class="sec-head" id="movers"><h2>Movers</h2><p>Biggest moves among Nifty 50 stocks.</p></div>
    <div class="card reveal">
      <h3 class="card-title">Advance / decline <span>${b.adv} up · ${b.dec} down${b.unch ? ` · ${b.unch} flat` : ""}</span></h3>
      <div class="breadth" role="img" aria-label="${b.adv} advanced, ${b.dec} declined">
        <span class="a" style="flex:${b.adv || 0}"></span>${b.unch ? `<span class="u" style="flex:${b.unch}"></span>` : ""}<span class="d" style="flex:${b.dec || 0}"></span></div>
      <div class="breadth-l"><span class="up">${b.total ? Math.round((b.adv / b.total) * 100) : 0}% advanced</span><span class="down">${b.total ? Math.round((b.dec / b.total) * 100) : 0}% declined</span></div>
    </div>
    <section class="grid g-2">${movers("Top gainers", d.gainers || [], mvMax)}${movers("Top losers", d.losers || [], mvMax)}</section>

    <div class="sec-head" id="global"><h2>Global cues, FX &amp; commodities</h2><p>US markets close after India, so the previous US session is the one Indian stocks react to.</p></div>
    <div class="card reveal">
      <div class="mkts">
        ${(d.global || []).map((g) => `<div class="mkt"><div class="mt"><span class="mn">${esc(g.name)}</span><span class="flag">${g.session === "overnight" ? "Overnight" : g.stale ? "Last close" : "Same day"}</span></div>
          <span class="mr">${esc(g.region)}${g.stale ? ` · ${esc(shortDate(g.date))}` : ""}</span>
          <div class="mt"><span class="mlast">${num(g.last)}</span>${chip(g.pct)}</div></div>`).join("")}
        ${(d.macro || []).map((m) => { const fx = m.name === "US dollar in rupees", t = fx ? tone(-m.pct) : tone(m.pct);
          const last = m.kind === "yield" ? num(m.last) + "%" : (m.unit === "$" || m.unit === "₹" ? m.unit : "") + num(m.last);
          const c = m.kind === "yield" ? `<span class="chip ${tone(-m.chg)}">${sign(m.chg)}${Math.abs(m.chg * 100).toFixed(0)} bps</span>` : chip(m.pct, t);
          return `<div class="mkt"><div class="mt"><span class="mn">${esc(fx ? "USD / INR" : m.name)}</span><span class="flag">${m.kind === "yield" ? "Rates" : fx || m.name === "Dollar index" ? "FX" : "Commodity"}</span></div>
          <span class="mr">${fx ? "Rupees per dollar" : m.kind === "yield" ? "Yield" : m.unit === "$" ? "US dollars" : "Index"}</span>
          <div class="mt"><span class="mlast">${last}</span>${c}</div></div>`; }).join("")}
      </div>
      <p class="foot-note">A rising USD/INR (weaker rupee) and rising US yields are shown in red, as both tend to weigh on Indian stocks. Yields move in basis points (1 bp = 0.01%).</p>
    </div>

    <div class="sec-head" id="news"><h2>Headlines</h2><p>${news.length} market stories from the last 30 hours, newest first. Times in IST.</p></div>
    <div class="card reveal">
      <div class="filters" role="group" aria-label="Filter headlines">${tags.map((t) => `<button type="button" data-tag="${esc(t)}" class="${t === newsTag ? "on" : ""}">${esc(t)}<em>${t === "All" ? news.length : news.filter((n) => (n.tags || []).includes(t)).length}</em></button>`).join("")}</div>
      <ul class="news">${shown.slice(0, showAll ? shown.length : 10).map((n) => `
        <li><time datetime="${esc(n.time)}">${esc(istTime(n.time))}</time><div>
          <a href="${esc(safeUrl(n.url))}" target="_blank" rel="noopener">${esc(n.title)}</a>
          <div class="meta"><span>${esc(n.source)}</span>${(n.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>
        </div></li>`).join("")}</ul>
      ${shown.length > 10 ? `<button type="button" class="more" id="more">${showAll ? "Show fewer" : `Show all ${shown.length}`}</button>` : ""}
    </div>`;

    drawChart($("#chart"), pts, animate);
    wire(animate);
  }

  /* ---------------------------------------------------------------- behaviour */
  let io, navIo;
  function wire(animate) {
    $$(".seg button").forEach((bt) => bt.addEventListener("click", () => {
      range = +bt.dataset.r; $$(".seg button").forEach((x) => x.classList.toggle("on", x === bt));
      const keepY = scrollY; render(false); scrollTo(0, keepY);
    }));
    const pick = $("#pick");
    if (pick) pick.addEventListener("change", () => { if (pick.value) load(pick.value, false); });
    $$(".filters button").forEach((bt) => bt.addEventListener("click", () => { newsTag = bt.dataset.tag; showAll = false; rerenderKeep(); }));
    const more = $("#more");
    if (more) more.addEventListener("click", () => { showAll = !showAll; rerenderKeep(); });

    // needle sweep
    const nd = $(".gauge .needle");
    if (nd && !reduced) requestAnimationFrame(() => requestAnimationFrame(() => { nd.style.transform = `rotate(${nd.dataset.a}deg)`; }));

    // count up the hero price
    const hp = $("#heroPrice"), target = (data.indices || [])[0]?.last;
    if (animate && !reduced && hp && target) {
      const from = target * 0.985, t0 = performance.now();
      const step = (t) => { const k = Math.min(1, (t - t0) / 900), e = 1 - Math.pow(1 - k, 3);
        hp.textContent = num(from + (target - from) * e); if (k < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    }

    // reveal on scroll
    if (io) io.disconnect();
    const items = $$(".reveal");
    if (!animate || reduced || !("IntersectionObserver" in window)) items.forEach((el) => el.classList.add("in"));
    else {
      io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { rootMargin: "0px 0px -8% 0px" });
      items.forEach((el, i) => { el.style.transitionDelay = (i % 3) * 70 + "ms"; io.observe(el); });
    }

    // highlight the section in view
    if (navIo) navIo.disconnect();
    const links = $$("#nav a");
    navIo = new IntersectionObserver((es) => es.forEach((e) => {
      if (e.isIntersecting) links.forEach((a) => a.classList.toggle("active", a.getAttribute("href") === "#" + e.target.id));
    }), { rootMargin: "-45% 0px -50% 0px" });
    ["overview", "why", "sectors", "movers", "global", "news"].forEach((id) => { const el = document.getElementById(id); if (el) navIo.observe(el); });
  }
  function rerenderKeep() { const y = scrollY; render(false); scrollTo(0, y); }

  let lastW = 0;
  new ResizeObserver(() => {
    const c = $("#chart"); if (!c || !data || c.clientWidth === lastW) return;
    lastW = c.clientWidth; const pts = range ? (data.nifty_trend || []).slice(-range) : data.nifty_trend; drawChart(c, pts, false);
  }).observe(document.body);

  function load(url, first) {
    fetch(url, { cache: "no-cache" })
      .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then((d) => { data = d; showAll = false; newsTag = "All"; render(first); lastW = $("#chart")?.clientWidth || 0;
        if (first && location.hash) { const t = document.getElementById(location.hash.slice(1)); if (t) setTimeout(() => t.scrollIntoView(), 50); } })
      .catch(() => { $("#app").innerHTML = `<div class="card msg">The latest sweep couldn't be loaded. Please try again later.</div>`; });
  }

  fetch(ARCHIVE, { cache: "no-cache" }).then((r) => r.json()).then((j) => {
    archive = (j.sweeps || []).map((s) => ({ ...s, file: "data/" + s.file }));
    if (data) rerenderKeep();
  }).catch(() => {});
  load(DATA, true);
})();
