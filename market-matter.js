/*
  <market-matter src="data/latest.json" archive="data/index.json">
  Shows one Inverika Market Matter sweep: the day's numbers, why the market moved, sectors,
  movers, global cues and headlines. Reads the JSON files written by sweep/sweep.py.
  Uses the page's colour tokens (--accent, --ink, --muted, --line, --surface, --bg) when present.
*/
(function () {
  if (customElements.get("market-matter")) return;

  const CSS = `
  market-matter { display: block; --mm-up: #19804a; --mm-down: #c0392f; --mm-flat: var(--muted, #667); }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) market-matter { --mm-up: #4cc27a; --mm-down: #ef7b70; } }
  :root[data-theme="dark"] market-matter { --mm-up: #4cc27a; --mm-down: #ef7b70; }
  .mm { display: flex; flex-direction: column; gap: 18px; color: var(--ink, #151821); font-size: 14px; }
  .mm .up { color: var(--mm-up); } .mm .down { color: var(--mm-down); } .mm .flat { color: var(--mm-flat); }
  .mm .num { font-variant-numeric: tabular-nums; }
  .mm-top { display: flex; justify-content: space-between; align-items: center; gap: 10px 16px; flex-wrap: wrap; }
  .mm-when { font: 500 12px/1.4 var(--f-mono, ui-monospace, monospace); letter-spacing: .06em; text-transform: uppercase; color: var(--muted, #667); }
  .mm-when b { color: var(--ink, #151821); font-weight: 500; }
  .mm-live { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--mm-up); margin-right: 7px; vertical-align: 1px; }
  .mm-pick { display: flex; gap: 8px; align-items: center; font-size: 13px; color: var(--muted, #667); }
  .mm-pick select { font: inherit; font-size: 13px; color: var(--ink, #151821); background: var(--surface, #fff); border: 1px solid var(--line, #dde); border-radius: 7px; padding: 5px 8px; max-width: 100%; }
  .mm-head { display: flex; flex-direction: column; gap: 8px; padding: 18px 20px; border-radius: 10px; background: var(--surface, #fff); border: 1px solid var(--line, #dde); }
  .mm-head h4 { margin: 0; font: 600 clamp(19px, 2.4vw, 24px)/1.25 var(--f-display, Georgia, serif); text-wrap: balance; }
  .mm-head p { margin: 0; color: var(--ink, #151821); max-width: 80ch; line-height: 1.55; }
  .mm-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
  .mm-tile { background: var(--surface, #fff); border: 1px solid var(--line, #dde); border-radius: 10px; padding: 12px 14px; display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .mm-tile .nm { font-size: 12.5px; color: var(--muted, #667); }
  .mm-tile .v { font: 600 19px/1.2 var(--f-display, Georgia, serif); }
  .mm-tile .p { font: 500 13px var(--f-mono, ui-monospace, monospace); }
  .mm-tile svg { display: block; width: 100%; height: 34px; margin-top: 4px; }
  .mm-grid { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); gap: 18px; align-items: start; }
  .mm-col { display: flex; flex-direction: column; gap: 18px; min-width: 0; }
  .mm-card { background: var(--surface, #fff); border: 1px solid var(--line, #dde); border-radius: 10px; padding: 16px 18px; display: flex; flex-direction: column; gap: 12px; min-width: 0; }
  .mm-card h5 { margin: 0; font: 600 15px/1.3 var(--f-body, system-ui, sans-serif); }
  .mm-card .sub { margin: -6px 0 0; font-size: 12.5px; color: var(--muted, #667); }
  .mm-drivers { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  .mm-drivers > li { display: grid; grid-template-columns: 12px minmax(0, 1fr); gap: 12px; padding: 12px 0; }
  .mm-drivers > li + li { border-top: 1px solid var(--line, #dde); }
  .mm-drivers .pip { width: 10px; height: 10px; border-radius: 3px; margin-top: 5px; background: var(--mm-flat); }
  .mm-drivers .pip.up { background: var(--mm-up); } .mm-drivers .pip.down { background: var(--mm-down); }
  .mm-drivers .t { font-weight: 600; }
  .mm-drivers .x { margin: 3px 0 0; line-height: 1.5; }
  .mm-ev { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .mm-ev span { font: 500 12px var(--f-mono, ui-monospace, monospace); background: var(--bg, #f3f4f7); border-radius: 5px; padding: 2px 7px; }
  .mm-ev span i { font-style: normal; color: var(--muted, #667); margin-right: 5px; font-family: var(--f-body, system-ui, sans-serif); }
  .mm-hl { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
  .mm-hl a { color: var(--accent, #2f3fb8); text-decoration: none; }
  .mm-hl a:hover { text-decoration: underline; }
  .mm-hl .src { color: var(--muted, #667); font-size: 12px; white-space: nowrap; }
  .mm-bars { display: flex; flex-direction: column; gap: 7px; }
  .mm-bar { display: grid; grid-template-columns: minmax(0, 40%) minmax(0, 1fr) 60px; gap: 10px; align-items: center; font-size: 13px; }
  .mm-bar .track { position: relative; height: 12px; background: var(--bg, #f3f4f7); border-radius: 3px; }
  .mm-bar .fill { position: absolute; top: 0; bottom: 0; border-radius: 3px; }
  .mm-bar .fill.up { background: var(--mm-up); } .mm-bar .fill.down { background: var(--mm-down); }
  .mm-bar .zero { position: absolute; top: -3px; bottom: -3px; width: 1px; background: var(--muted, #667); }
  .mm-bar .val { text-align: right; font: 500 12.5px var(--f-mono, ui-monospace, monospace); }
  .mm-breadth { display: flex; height: 12px; border-radius: 3px; overflow: hidden; background: var(--bg, #f3f4f7); }
  .mm-breadth .a { background: var(--mm-up); } .mm-breadth .d { background: var(--mm-down); }
  .mm-breadth-l { display: flex; justify-content: space-between; font-size: 12.5px; color: var(--muted, #667); }
  .mm-movers { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; }
  .mm-tbl { width: 100%; border-collapse: collapse; font-size: 13px; }
  .mm-tbl th { text-align: left; font: 500 11px var(--f-mono, ui-monospace, monospace); text-transform: uppercase; letter-spacing: .06em; color: var(--muted, #667); padding: 0 0 6px; }
  .mm-tbl td { padding: 5px 0; border-top: 1px solid var(--line, #dde); vertical-align: top; }
  .mm-tbl td.r, .mm-tbl th.r { text-align: right; padding-left: 8px; white-space: nowrap; }
  .mm-tbl .note { display: block; font-size: 11.5px; color: var(--muted, #667); }
  .mm-wrap { overflow-x: auto; }
  .mm-news { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  .mm-news li { display: grid; grid-template-columns: 52px minmax(0, 1fr); gap: 12px; padding: 8px 0; font-size: 13.5px; }
  .mm-news li + li { border-top: 1px solid var(--line, #dde); }
  .mm-news time { font: 500 12px var(--f-mono, ui-monospace, monospace); color: var(--muted, #667); padding-top: 2px; }
  .mm-news a { color: var(--ink, #151821); text-decoration: none; }
  .mm-news a:hover { color: var(--accent, #2f3fb8); text-decoration: underline; }
  .mm-news .meta { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 3px; font-size: 12px; color: var(--muted, #667); }
  .mm-news .tag { background: var(--bg, #f3f4f7); border-radius: 4px; padding: 0 6px; }
  .mm-more { align-self: flex-start; border: 1px solid var(--line, #dde); background: var(--surface, #fff); color: var(--accent, #2f3fb8); border-radius: 7px; padding: 5px 12px; font: inherit; font-size: 13px; cursor: pointer; }
  .mm-more:hover { border-color: var(--accent, #2f3fb8); }
  .mm-msg { padding: 28px; text-align: center; color: var(--muted, #667); background: var(--surface, #fff); border: 1px solid var(--line, #dde); border-radius: 10px; }
  @media (max-width: 900px) { .mm-grid { grid-template-columns: minmax(0, 1fr); } }
  @media (max-width: 520px) { .mm-bar { grid-template-columns: minmax(0, 1fr) 58px; } .mm-bar .lbl { grid-column: 1 / -1; } }
  `;

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const tone = (p) => (p == null || Math.abs(p) < 0.005 ? "flat" : p > 0 ? "up" : "down");
  const pct = (p) => (p == null ? "–" : (p > 0 ? "+" : p < 0 ? "−" : "") + Math.abs(p).toFixed(2) + "%");
  const num = (x, d = 2) => (x == null ? "–" : Number(x).toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d }));
  const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : "#");
  const istTime = (iso) => new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });
  const istDay = (iso) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
  const longDate = (d) => new Date(d + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

  function sparkline(points) {
    if (!points || points.length < 2) return "";
    const v = points.map((p) => p.c), min = Math.min(...v), max = Math.max(...v), span = max - min || 1;
    const W = 160, H = 34, pad = 3;
    const xy = v.map((c, i) => [(i / (v.length - 1)) * W, pad + (1 - (c - min) / span) * (H - 2 * pad)]);
    const line = xy.map(([x, y], i) => (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1)).join(" ");
    const area = line + ` L${W} ${H} L0 ${H} Z`;
    const cls = v[v.length - 1] >= v[0] ? "up" : "down";
    const [lx, ly] = xy[xy.length - 1];
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="Nifty 50, last ${v.length} sessions" role="img">
      <path d="${area}" fill="currentColor" opacity=".12" class="${cls}"></path>
      <path d="${line}" fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke" class="${cls}"></path>
      <circle cx="${lx}" cy="${ly}" r="2.5" fill="currentColor" class="${cls}"></circle></svg>`;
  }

  function bars(rows) {
    const vals = rows.map((r) => r.pct);
    const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals), span = hi - lo || 1;
    const pos = (v) => ((v - lo) / span) * 100, z = pos(0);
    return `<div class="mm-bars">${rows.map((r) => {
      const x = pos(r.pct), left = Math.min(z, x), w = Math.max(Math.abs(x - z), r.pct ? 0.8 : 0);
      return `<div class="mm-bar"><span class="lbl">${esc(r.name)}</span>
        <span class="track"><span class="fill ${tone(r.pct)}" style="left:${left}%;width:${w}%"></span>${z > 0 && z < 100 ? `<span class="zero" style="left:${z}%"></span>` : ""}</span>
        <span class="val num ${tone(r.pct)}">${pct(r.pct)}</span></div>`;
    }).join("")}</div>`;
  }

  function moversTable(title, rows) {
    return `<table class="mm-tbl"><thead><tr><th>${esc(title)}</th><th class="r">₹</th><th class="r">Change</th></tr></thead><tbody>
      ${rows.map((s) => `<tr><td>${esc(s.name)}</td><td class="r num">${num(s.last)}</td><td class="r num ${tone(s.pct)}">${pct(s.pct)}</td></tr>`).join("")}
    </tbody></table>`;
  }

  class MarketMatter extends HTMLElement {
    connectedCallback() {
      if (!document.getElementById("mm-style")) {
        const st = document.createElement("style"); st.id = "mm-style"; st.textContent = CSS;
        document.head.appendChild(st);
      }
      this.base = (this.getAttribute("src") || "").replace(/[^/]*$/, "");
      this.innerHTML = `<div class="mm-msg">Loading the latest market sweep…</div>`;
      this.load(this.getAttribute("src"));
      const arch = this.getAttribute("archive");
      if (arch) fetch(arch, { cache: "no-cache" }).then((r) => r.json()).then((j) => { this.archive = j.sweeps || []; this.paintPicker(); }).catch(() => {});
    }

    load(url) {
      fetch(url, { cache: "no-cache" })
        .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then((d) => { this.data = d; this.render(); })
        .catch(() => { this.innerHTML = `<div class="mm-msg">The latest sweep couldn't be loaded. Please try again later.</div>`; });
    }

    paintPicker() {
      const sel = this.querySelector("#mm-date");
      if (!sel || !this.archive || !this.data) return;
      sel.innerHTML = this.archive.map((s) =>
        `<option value="${esc(s.file)}"${s.date === this.data.market_date ? " selected" : ""}>${esc(longDate(s.date))} · Nifty ${pct(s.pct)}</option>`).join("");
      sel.disabled = this.archive.length < 2;
    }

    render() {
      const d = this.data;
      const idx = Object.fromEntries((d.indices || []).map((i) => [i.key, i]));
      const b = d.breadth || { adv: 0, dec: 0, total: 0 };
      const latest = !this.archive || !this.archive.length || this.archive[0].date === d.market_date;
      const showAll = this.showAllNews;
      const news = d.news || [];
      const tile = (i, extra = "") => i ? `
        <div class="mm-tile"><span class="nm">${esc(i.name)}</span>
          <span class="v num">${num(i.last)}</span>
          <span class="p num ${i.key === "vix" ? "flat" : tone(i.pct)}">${pct(i.pct)} <span class="flat">(${i.chg > 0 ? "+" : i.chg < 0 ? "−" : ""}${num(Math.abs(i.chg))})</span></span>${extra}</div>` : "";

      this.innerHTML = `
      <div class="mm">
        <div class="mm-top">
          <div class="mm-when">${latest ? `<span class="mm-live" aria-hidden="true"></span>` : ""}Sweep for <b>${esc(longDate(d.market_date))}</b> · ran ${esc(istDay(d.generated_at))}, ${esc(istTime(d.generated_at))} IST${d.session === "intraday" ? " · during trading hours" : " · after the close"}</div>
          <label class="mm-pick" for="mm-date">Past sweeps <select id="mm-date" disabled><option>${esc(longDate(d.market_date))}</option></select></label>
        </div>

        <div class="mm-head">
          <h4>${esc(d.headline)}</h4>
          <p>${esc(d.summary)}</p>
        </div>

        <div class="mm-tiles">
          ${tile(idx.nifty, sparkline(d.nifty_trend))}${tile(idx.sensex)}${tile(idx.bank)}${tile(idx.midcap)}${tile(idx.vix)}
        </div>

        <div class="mm-grid">
          <div class="mm-col">
            <section class="mm-card">
              <h5>Why it moved</h5>
              <p class="sub">Signals that moved with the market beyond set thresholds, strongest first, with the day's headlines that mention them.</p>
              ${(d.drivers || []).length ? `<ul class="mm-drivers">${d.drivers.map((x) => `
                <li><span class="pip ${esc(x.tone)}" aria-hidden="true"></span><div>
                  <div class="t">${esc(x.title)}</div>
                  <p class="x">${esc(x.text)}</p>
                  ${(x.evidence || []).length ? `<div class="mm-ev">${x.evidence.map((e) => `<span><i>${esc(e.label)}</i>${esc(e.value)}</span>`).join("")}</div>` : ""}
                  ${(x.headlines || []).length ? `<ul class="mm-hl">${x.headlines.map((h) => `<li><a href="${esc(safeUrl(h.url))}" target="_blank" rel="noopener">${esc(h.title)}</a> <span class="src">· ${esc(h.source)}</span></li>`).join("")}</ul>` : ""}
                </div></li>`).join("")}</ul>` : `<p class="sub">No signal crossed its threshold: a quiet session.</p>`}
            </section>

            <section class="mm-card">
              <h5>Headlines</h5>
              <p class="sub">${news.length} market stories from the last 30 hours, newest first. Times in IST.</p>
              <ul class="mm-news">${news.slice(0, showAll ? news.length : 10).map((n) => `
                <li><time datetime="${esc(n.time)}">${esc(istTime(n.time))}</time><div>
                  <a href="${esc(safeUrl(n.url))}" target="_blank" rel="noopener">${esc(n.title)}</a>
                  <div class="meta"><span>${esc(n.source)}</span>${(n.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>
                </div></li>`).join("")}</ul>
              ${news.length > 10 ? `<button type="button" class="mm-more" id="mm-more">${showAll ? "Show fewer" : `Show all ${news.length}`}</button>` : ""}
            </section>
          </div>

          <div class="mm-col">
            <section class="mm-card">
              <h5>Sectors</h5>
              ${bars(d.sectors || [])}
            </section>

            <section class="mm-card">
              <h5>Nifty 50 breadth</h5>
              <div class="mm-breadth" role="img" aria-label="${b.adv} advanced, ${b.dec} declined">
                <span class="a" style="width:${b.total ? (b.adv / b.total) * 100 : 0}%"></span>
                <span class="d" style="width:${b.total ? (b.dec / b.total) * 100 : 0}%"></span>
              </div>
              <div class="mm-breadth-l"><span class="up">${b.adv} rose</span><span class="down">${b.dec} fell</span></div>
              <div class="mm-movers">${moversTable("Top gainers", d.gainers || [])}${moversTable("Top losers", d.losers || [])}</div>
            </section>

            <section class="mm-card">
              <h5>Global cues &amp; commodities</h5>
              <div class="mm-wrap"><table class="mm-tbl"><thead><tr><th>Market</th><th class="r">Last</th><th class="r">Change</th></tr></thead><tbody>
                ${(d.global || []).map((g) => `<tr><td>${esc(g.name)}<span class="note">${esc(g.region)} · ${g.session === "overnight" ? "previous session" : g.stale ? `last close ${esc(g.date)}` : "same day"}</span></td>
                  <td class="r num">${num(g.last)}</td><td class="r num ${tone(g.pct)}">${pct(g.pct)}</td></tr>`).join("")}
                ${(d.macro || []).map((m) => `<tr><td>${esc(m.name)}</td>
                  <td class="r num">${m.kind === "yield" ? num(m.last) + "%" : (m.unit === "$" || m.unit === "₹" ? m.unit : "") + num(m.last)}</td>
                  <td class="r num ${m.name === "US dollar in rupees" ? tone(-m.pct) : tone(m.pct)}">${m.kind === "yield" ? ((m.chg > 0 ? "+" : m.chg < 0 ? "−" : "") + Math.abs(m.chg * 100).toFixed(0) + " bps") : pct(m.pct)}</td></tr>`).join("")}
              </tbody></table></div>
              <p class="sub" style="margin:0">US markets close after India, so the previous US session is the one Indian stocks react to. A rising USD/INR means a weaker rupee, shown in red.</p>
            </section>
          </div>
        </div>
      </div>`;

      this.paintPicker();
      const sel = this.querySelector("#mm-date");
      sel.addEventListener("change", () => { this.showAllNews = false; this.load(this.base + sel.value); });
      const more = this.querySelector("#mm-more");
      if (more) more.addEventListener("click", () => { this.showAllNews = !this.showAllNews; this.render(); });
    }
  }
  customElements.define("market-matter", MarketMatter);
})();
