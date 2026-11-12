#!/usr/bin/env python3
"""Inverika Market Matter: a daily sweep of the Indian stock market.

After the NSE close it collects:
  - Nifty 50, Sensex, Nifty Bank, Midcap and India VIX, plus 10 sector indices
  - every Nifty 50 stock (breadth, top gainers and losers)
  - global cues (US, Japan, Hong Kong, UK), crude, gold, silver, the rupee, US yields
  - the day's market headlines from Indian business news feeds
Then it explains the move: each signal that moved with the market beyond a set threshold
becomes a "driver" with its numbers and the headlines that mention it.

Writes (all JSON, read by the website):
  <out>/latest.json             the newest sweep
  <out>/sweeps/<YYYY-MM-DD>.json one file per trading day (last 120 kept)
  <out>/index.json              list of saved sweeps for the archive picker

Run by a GitHub Action every weekday after the close. By hand:
    python sweep.py --out ../data
"""
from __future__ import annotations

import argparse
import datetime as dt
import email.utils
import html
import json
import logging
import re
import sys
import warnings
import xml.etree.ElementTree as ET
from pathlib import Path

import pandas as pd
import requests
import yfinance as yf

warnings.filterwarnings("ignore")
log = logging.getLogger("marketmatter")
HERE = Path(__file__).resolve().parent
IST = dt.timezone(dt.timedelta(hours=5, minutes=30))
KEEP_SWEEPS = 120
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/124 Safari/537.36"}

# ---------------------------------------------------------------- instruments
INDICES = [  # key, Yahoo symbol, display name
    ("nifty", "^NSEI", "Nifty 50"),
    ("sensex", "^BSESN", "Sensex"),
    ("bank", "^NSEBANK", "Nifty Bank"),
    ("midcap", "^NSEMDCP50", "Nifty Midcap 50"),
    ("vix", "^INDIAVIX", "India VIX"),
]
SECTORS = [  # symbol, name, words that tie a headline to this sector
    ("^NSEBANK", "Banks", ["bank", "banks", "banking", "lender", "lenders", "hdfc bank", "icici bank", "state bank of india", "sbi shares", "kotak", "axis bank"]),
    ("NIFTY_FIN_SERVICE.NS", "Financial services", ["nbfc", "nbfcs", "bajaj finance", "insurer", "insurers", "insurance", "financial services", "financials", "lender", "lenders"]),
    ("^CNXIT", "IT", ["it stocks", "it shares", "it index", "infosys", "tcs", "wipro", "hcltech", "hcl tech", "tech mahindra", "software", "it sector"]),
    ("^CNXAUTO", "Auto", ["auto", "cars", "vehicle", "vehicles", "maruti", "tata motors", "mahindra", "two-wheeler", "ev", "evs"]),
    ("^CNXPHARMA", "Pharma", ["pharma", "drug", "drugmaker", "sun pharma", "cipla", "usfda", "healthcare"]),
    ("^CNXFMCG", "FMCG", ["fmcg", "consumer", "hindustan unilever", "hul", "itc", "nestle", "britannia"]),
    ("^CNXMETAL", "Metals", ["metal", "metals", "steel", "aluminium", "copper", "tata steel", "hindalco", "jsw steel"]),
    ("^CNXENERGY", "Energy", ["oil", "energy", "reliance", "ongc", "power", "gas", "refiners", "refinery"]),
    ("^CNXREALTY", "Realty", ["realty", "real estate", "property", "housing", "dlf"]),
    ("^CNXPSUBANK", "PSU banks", ["psu bank", "psu banks", "public sector bank", "state bank of india", "sbi shares", "bank of baroda", "pnb", "canara"]),
    ("^CNXINFRA", "Infrastructure", ["infra", "infrastructure", "construction", "larsen", "l&t", "cement", "capex"]),
]
GLOBAL = [  # US markets close after India, so India reacts to the previous US session
    ("^GSPC", "S&P 500", "US", "overnight"),
    ("^IXIC", "Nasdaq", "US", "overnight"),
    ("^N225", "Nikkei 225", "Japan", "same day"),
    ("^HSI", "Hang Seng", "Hong Kong", "same day"),
    ("^FTSE", "FTSE 100", "UK", "same day"),
]
MACRO = [  # symbol, name, unit shown before/after, kind
    ("BZ=F", "Brent crude", "$", "price"),
    ("GC=F", "Gold", "$", "price"),
    ("SI=F", "Silver", "$", "price"),
    ("USDINR=X", "US dollar in rupees", "₹", "price"),
    ("^TNX", "US 10-year yield", "%", "yield"),
    ("DX-Y.NYB", "Dollar index", "", "price"),
]

# Short names the press uses for some Nifty companies
ALIASES = {
    "ONGC": ["ongc"], "SBIN": ["sbi"], "HINDUNILVR": ["hul", "hindustan unilever"], "M&M": ["m&m", "mahindra"],
    "LT": ["l&t", "larsen"], "BAJFINANCE": ["bajaj finance"], "BAJAJFINSV": ["bajaj finserv"],
    "HDFCLIFE": ["hdfc life"], "SBILIFE": ["sbi life"], "TMPV": ["tata motors"], "INFY": ["infosys"],
    "HCLTECH": ["hcltech", "hcl tech"], "NESTLEIND": ["nestle"], "POWERGRID": ["power grid"],
    "SUNPHARMA": ["sun pharma"], "ULTRACEMCO": ["ultratech"], "BHARTIARTL": ["airtel"], "ITC": ["itc"],
}

FEEDS = [
    ("Economic Times", "https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms"),
    ("Economic Times", "https://economictimes.indiatimes.com/markets/stocks/rssfeeds/2146842.cms"),
    ("Mint", "https://www.livemint.com/rss/markets"),
    ("Business Standard", "https://www.business-standard.com/rss/markets-106.rss"),
    ("Hindu BusinessLine", "https://www.thehindubusinessline.com/markets/feeder/default.rss"),
    ("Google News", "https://news.google.com/rss/search?q=Sensex+OR+Nifty+when:1d&hl=en-IN&gl=IN&ceid=IN:en"),
]

# Topic tags for the news list; also used to tie headlines to drivers.
TOPICS = {
    "Close": ["sensex", "nifty", "closing bell", "market close", "stock market today", "dalal street", "d-street"],
    "Foreign flows": ["fii", "fiis", "fpi", "fpis", "foreign investor", "foreign investors", "foreign portfolio", "foreign funds", "dii", "diis"],
    "Oil": ["crude", "brent", "oil price", "opec"],
    "Rupee": ["rupee", "forex", "usd/inr", "dollar index"],
    "Global": ["wall street", "us stocks", "nasdaq", "s&p 500", "dow", "fed", "federal reserve", "asian markets", "global cues", "trump", "tariff", "china"],
    "Rates": ["rbi", "repo", "rate cut", "rate hike", "bond yield", "treasury", "inflation", "cpi"],
    "Earnings": ["q1", "q2", "q3", "q4", "results", "earnings", "net profit", "profit", "revenue"],
    "IPO": ["ipo", "listing", "gmp"],
    "Gold": ["gold", "silver"],
}

MARKET_WORDS = ["market", "markets", "stock", "stocks", "share", "shares", "index", "points", "ends", "closes",
                "settles", "trade", "trading", "rally", "rallies", "falls", "gains", "investors", "fii", "fiis",
                "dalal street", "bse", "nse", "sectors", "session"]

# ---------------------------------------------------------------- helpers
def r2(x):
    return None if x is None or pd.isna(x) else round(float(x), 2)


def pct(a, b):
    return None if a is None or b in (None, 0) or pd.isna(a) or pd.isna(b) else (a / b - 1) * 100


def fmt_pct(p):
    return f"{p:+.2f}%".replace("-", "−")


def fmt_num(x, d=2):
    return f"{x:,.{d}f}"


def last_two(df: pd.DataFrame, sym: str, before: dt.date | None = None):
    """(date, last close, previous close, series) for one symbol, or None."""
    try:
        s = df[sym]["Close"].dropna()
    except KeyError:
        return None
    if before is not None:
        s = s[[i.date() < before for i in s.index]]
    if len(s) < 2:
        return None
    return s.index[-1].date(), float(s.iloc[-1]), float(s.iloc[-2]), s


def download(symbols, period="3mo"):
    log.info("downloading %d symbols", len(symbols))
    return yf.download(symbols, period=period, interval="1d", progress=False,
                       auto_adjust=False, group_by="ticker", threads=True)


def quote(df, sym, name, before=None, **extra):
    q = last_two(df, sym, before)
    if not q:
        log.warning("no data for %s", sym)
        return None
    d, last, prev, _ = q
    return {"symbol": sym, "name": name, "date": d.isoformat(), "last": r2(last),
            "prev": r2(prev), "chg": r2(last - prev), "pct": r2(pct(last, prev)), **extra}


# ---------------------------------------------------------------- news
def _clean(s: str) -> str:
    s = html.unescape(html.unescape(s or ""))
    s = re.sub(r"<[^>]+>", "", s)
    return re.sub(r"\s+", " ", s).strip()


def fetch_news(since: dt.datetime) -> list[dict]:
    out, seen = [], set()
    for source, url in FEEDS:
        try:
            r = requests.get(url, headers=UA, timeout=25)
            r.raise_for_status()
            root = ET.fromstring(r.content)
        except Exception as e:  # one bad feed never stops the sweep
            log.warning("feed failed %s: %s", url, e)
            continue
        for it in root.iter("item"):
            title = _clean(it.findtext("title"))
            link = (it.findtext("link") or "").strip()
            try:
                when = email.utils.parsedate_to_datetime(it.findtext("pubDate") or "")
                if when.tzinfo is None:
                    when = when.replace(tzinfo=dt.timezone.utc)
            except Exception:
                continue
            if not title or not link or when < since:
                continue
            src = source
            if source == "Google News" and " - " in title:   # "Headline - Publisher"
                title, src = title.rsplit(" - ", 1)
            key = re.sub(r"[^a-z0-9]+", " ", title.lower()).strip()[:90]
            if key in seen:
                continue
            seen.add(key)
            # Google's search also returns unrelated uses of "nifty"; keep market stories only
            if source == "Google News" and not has_any(title, MARKET_WORDS):
                continue
            tags = [t for t, words in TOPICS.items() if has_any(title, words)]
            out.append({"title": title, "source": src, "url": link,
                        "time": when.astimezone(dt.timezone.utc).isoformat(timespec="minutes"),
                        "tags": tags})
    out.sort(key=lambda n: n["time"], reverse=True)
    log.info("news: %d headlines", len(out))
    return out


def has_any(text: str, words) -> bool:
    """True if any keyword appears in text as whole words (so 'oil' doesn't match 'turmoil')."""
    low = text.lower()
    return any(re.search(r"(?<![a-z0-9])" + re.escape(w.strip()) + r"(?![a-z0-9])", low) for w in words)


def match(news, words, limit=3, exclude=(), until: str | None = None):
    hits = []
    for n in news:
        if n["url"] in exclude or (until and n["time"] > until):
            continue
        if has_any(n["title"], words):
            hits.append({k: n[k] for k in ("title", "source", "url", "time")})
        if len(hits) >= limit:
            break
    return hits


# ---------------------------------------------------------------- explaining the move
def move_word(p: float) -> str:
    a = abs(p)
    if a < 0.15:
        return "was almost flat"
    up = p > 0
    if a < 0.5:
        return "edged up" if up else "edged down"
    if a < 1.0:
        return "rose" if up else "fell"
    if a < 2.0:
        return "rallied" if up else "dropped sharply"
    return "surged" if up else "slumped"


def build_drivers(nifty, sectors, breadth, movers, glob, macro, news, closed_at: dt.datetime):
    """Signals that moved alongside the market, strongest first. Each says what moved,
    by how much, why it matters for Indian stocks, and links the headlines that mention it."""
    up = nifty["pct"] >= 0
    drivers = []
    utc = lambda t: t.astimezone(dt.timezone.utc).isoformat(timespec="minutes")
    wrap_until = utc(closed_at + dt.timedelta(hours=3))     # market-close reports included

    def add(key, title, text, strength, tone, evidence, words=None, n=3, until=wrap_until):
        drivers.append({"key": key, "title": title, "text": text, "strength": round(strength, 2),
                        "tone": tone, "evidence": evidence,
                        "headlines": match(news, words, n, until=until) if words else []})

    # 1. Breadth: was the move broad or narrow?
    a, d, t = breadth["adv"], breadth["dec"], breadth["total"]
    share = a / t if t else 0.5
    if share >= 0.65 or share <= 0.35:
        broad = "broad-based buying" if share >= 0.65 else "broad-based selling"
        add("breadth", f"{a} of {t} Nifty stocks rose",
            f"The move was {broad}: {a} Nifty 50 stocks rose and {d} fell.",
            abs(share - 0.5) * 6, "up" if share > 0.5 else "down",
            [{"label": "Advances", "value": str(a)}, {"label": "Declines", "value": str(d)}])
    elif abs(nifty["pct"]) >= 0.1 and ((up and a < d) or (not up and d < a)):
        add("breadth", "A narrow move",
            f"The Nifty {'rose' if up else 'fell'} even though {d if up else a} of {t} stocks {'fell' if up else 'rose'}, "
            "so a few heavyweights did the work.",
            1.6, "neutral", [{"label": "Advances", "value": str(a)}, {"label": "Declines", "value": str(d)}])

    # 2. Sectors that led and lagged
    ranked = sorted([s for s in sectors if s["pct"] is not None], key=lambda s: s["pct"], reverse=True)
    if ranked:
        side = ranked if up else ranked[::-1]
        lead = side[0]
        if abs(lead["pct"]) >= 0.5 and (lead["pct"] > 0) == up:
            group = [lead] + [s for s in side[1:3] if abs(s["pct"]) >= 1.0 and (s["pct"] > 0) == up]
            verb = "led the gains" if up else "led the fall"
            names = [f"{s['name']} ({fmt_pct(s['pct'])})" for s in group]
            text = (names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]) + f" {verb}."
            other = side[-1]
            if (other["pct"] > 0) != up and abs(other["pct"]) >= 0.4:
                text += f" {other['name']} went the other way ({fmt_pct(other['pct'])})."
            title = (lead["name"] if len(group) == 1 else f"{lead['name']} and {group[1]['name']}") + f" {verb}"
            ev = group + ([other] if other not in group else [])
            add("sector", title, text, abs(lead["pct"]) / 0.6, "up" if up else "down",
                [{"label": s["name"], "value": fmt_pct(s["pct"])} for s in ev],
                words=sorted({w for s in group for w in s["words"]}))

    # 3. Biggest single-stock movers
    for m in movers[:2]:
        if abs(m["pct"]) >= 3:
            words = [m["name"].lower(), m["ticker"].lower()] + ALIASES.get(m["ticker"], [])
            add("stock-" + m["ticker"], f"{m['name']} {'jumped' if m['pct'] > 0 else 'fell'} {fmt_pct(m['pct'])}",
                f"{m['name']} was among the day's biggest Nifty movers, closing at ₹{fmt_num(m['last'])}.",
                abs(m["pct"]) / 3, "up" if m["pct"] > 0 else "down",
                [{"label": "Close", "value": "₹" + fmt_num(m["last"])}, {"label": "Change", "value": fmt_pct(m["pct"])}],
                words=words, n=2)

    # 4. Global cues
    g = {x["name"]: x for x in glob if x and not x.get("stale")}
    cues = [g.get(n) for n in ("S&P 500", "Nikkei 225", "Hang Seng") if g.get(n)]
    strong = [c for c in cues if abs(c["pct"]) >= 0.5]
    if strong:
        ups = [c for c in strong if c["pct"] > 0]
        downs = [c for c in strong if c["pct"] < 0]

        def label(c):
            return f"{c['name']} {fmt_pct(c['pct'])}" + (" overnight" if c.get("session") == "overnight" else "")

        ev = [{"label": c["name"], "value": fmt_pct(c["pct"])} for c in strong]
        if ups and downs:
            add("global", "Global cues were mixed",
                "Overseas markets gave no clear lead: " + ", ".join(label(c) for c in strong) + ".",
                0.5, "neutral", ev, words=TOPICS["Global"], until=utc(closed_at))
        else:
            avg = sum(c["pct"] for c in strong) / len(strong)
            same = (avg > 0) == up
            mood = "positive" if avg > 0 else "negative"
            text = f"Global markets were {mood}: " + ", ".join(label(c) for c in strong) + "."
            text += " Indian stocks moved the same way." if same else " Indian stocks went their own way."
            add("global", f"Global cues were {mood}", text, abs(avg) / 0.6 * (1 if same else 0.6),
                "up" if avg > 0 else "down", ev, words=TOPICS["Global"], until=utc(closed_at))

    m = {x["name"]: x for x in macro if x}
    # 5. Crude oil: India imports most of its oil
    oil = m.get("Brent crude")
    if oil and abs(oil["pct"]) >= 1.0:
        dirw = "rose" if oil["pct"] > 0 else "fell"
        why = ("India imports most of its oil, so dearer crude raises costs and inflation worries."
               if oil["pct"] > 0 else "India imports most of its oil, so cheaper crude eases costs and inflation.")
        add("oil", f"Brent crude {dirw} {fmt_pct(oil['pct'])}", f"Brent {dirw} to ${fmt_num(oil['last'])} a barrel. {why}",
            abs(oil["pct"]) / 1.2, "down" if oil["pct"] > 0 else "up",
            [{"label": "Brent", "value": f"${fmt_num(oil['last'])}"}, {"label": "Change", "value": fmt_pct(oil["pct"])}],
            words=TOPICS["Oil"])

    gold = m.get("Gold")
    if gold and abs(gold["pct"]) >= 1.5:
        dirw = "rose" if gold["pct"] > 0 else "fell"
        add("gold", f"Gold {dirw} {fmt_pct(gold['pct'])}",
            f"Gold {dirw} to ${fmt_num(gold['last'])} an ounce. In India this moves jewellers, gold-loan lenders and gold ETFs.",
            abs(gold["pct"]) / 3, "neutral",
            [{"label": "Gold", "value": f"${fmt_num(gold['last'])}"}, {"label": "Change", "value": fmt_pct(gold["pct"])}],
            words=TOPICS["Gold"])

    # 6. Rupee (USD/INR up = rupee weaker)
    inr = m.get("US dollar in rupees")
    if inr and abs(inr["pct"]) >= 0.2:
        weaker = inr["pct"] > 0
        add("rupee", f"The rupee {'weakened' if weaker else 'strengthened'}",
            f"The dollar moved to ₹{fmt_num(inr['last'])} ({fmt_pct(inr['pct'])}). "
            + ("A weaker rupee can push foreign investors to sell, but helps exporters like IT."
               if weaker else "A stronger rupee tends to support foreign buying of Indian stocks."),
            abs(inr["pct"]) / 0.25, "down" if weaker else "up",
            [{"label": "USD/INR", "value": "₹" + fmt_num(inr["last"])}, {"label": "Change", "value": fmt_pct(inr["pct"])}],
            words=TOPICS["Rupee"])

    # 7. US bond yields (in percentage points)
    y = m.get("US 10-year yield")
    if y and abs(y["chg"]) >= 0.05:
        higher = y["chg"] > 0
        add("yields", f"US 10-year yield {'rose' if higher else 'fell'} {abs(y['chg']) * 100:.0f} bps",
            f"The US 10-year yield moved to {y['last']:.2f}%. "
            + ("Higher US yields can pull foreign money out of emerging markets like India."
               if higher else "Lower US yields make emerging markets like India more attractive."),
            abs(y["chg"]) / 0.06, "down" if higher else "up",
            [{"label": "Yield", "value": f"{y['last']:.2f}%"}, {"label": "Change", "value": f"{y['chg'] * 100:+.0f} bps".replace("-", "−")}],
            words=TOPICS["Rates"])

    # 8. Volatility
    vix = m.get("India VIX")
    if vix and abs(vix["pct"]) >= 4:
        calmer = vix["pct"] < 0
        add("vix", f"India VIX {'fell' if calmer else 'jumped'} {fmt_pct(vix['pct'])}",
            f"The fear gauge moved to {vix['last']:.2f}, "
            + ("so traders expect calmer markets ahead." if calmer else "so traders are pricing in bigger swings ahead."),
            abs(vix["pct"]) / 5, "up" if calmer else "down",
            [{"label": "India VIX", "value": f"{vix['last']:.2f}"}, {"label": "Change", "value": fmt_pct(vix["pct"])}])

    # 9. Foreign flows: only when the day's news talks about them (NSE flow data isn't public via API)
    flows = match(news, TOPICS["Foreign flows"], 3, until=wrap_until)
    if flows:
        add("flows", "Foreign investor flows were in the news",
            "The day's coverage pointed to foreign investor activity. Exact FII/DII figures come from NSE after the close.",
            0.9, "neutral", [], words=TOPICS["Foreign flows"])

    drivers.sort(key=lambda x: x["strength"], reverse=True)
    return drivers[:7]


# ---------------------------------------------------------------- sweep
def run(out: Path) -> dict:
    now = dt.datetime.now(dt.timezone.utc)
    syms = ([s for _, s, _ in INDICES] + [s for s, _, _ in SECTORS] + [g[0] for g in GLOBAL]
            + [s for s, _, _, _ in MACRO])
    df = download(sorted(set(syms)))

    indices = [quote(df, s, n, key=k) for k, s, n in INDICES]
    nifty = next((i for i in indices if i and i["key"] == "nifty"), None)
    if not nifty:
        raise SystemExit("No Nifty 50 data: aborting so the last good sweep stays published")
    market_date = dt.date.fromisoformat(nifty["date"])

    closed_at = dt.datetime.combine(market_date, dt.time(15, 30), IST)
    session = "close" if now >= closed_at else "intraday"

    sectors = []
    for s, n, words in SECTORS:
        q = quote(df, s, n)
        if q and q["date"] == nifty["date"]:
            sectors.append({"name": n, "symbol": s, "last": q["last"], "pct": q["pct"], "words": words})

    # Nifty 50 stocks
    cons = json.loads((HERE / "constituents.json").read_text(encoding="utf-8"))
    names = {c["ticker"]: c["name"] for c in cons if c.get("index") == "Nifty 50"}
    sdf = download(sorted(names), period="10d")
    stocks = []
    for t, n in names.items():
        q = last_two(sdf, t)
        if q and q[0] == market_date:
            stocks.append({"name": n, "ticker": t.replace(".NS", ""), "last": r2(q[1]), "pct": r2(pct(q[1], q[2]))})
    stocks.sort(key=lambda x: x["pct"], reverse=True)
    breadth = {"adv": sum(s["pct"] > 0 for s in stocks), "dec": sum(s["pct"] < 0 for s in stocks),
               "unch": sum(s["pct"] == 0 for s in stocks), "total": len(stocks)}
    movers = sorted(stocks, key=lambda x: abs(x["pct"]), reverse=True)

    glob = [quote(df, s, n, before=market_date if w == "overnight" else None, region=r, session=w)
            for s, n, r, w in GLOBAL]
    for g in glob:   # a same-day market with no bar for today yet is stale: show it, don't use it
        if g and g["session"] == "same day" and g["date"] != nifty["date"]:
            g["stale"] = True
    macro = [quote(df, s, n, unit=u, kind=k) for s, n, u, k in MACRO]
    vixq = next((i for i in indices if i and i["key"] == "vix"), None)

    since = now - dt.timedelta(hours=30)
    news = fetch_news(since)

    drivers = build_drivers(nifty, sectors, breadth, movers, glob,
                            macro + ([dict(vixq, name="India VIX")] if vixq else []), news, closed_at)

    sensex = next((i for i in indices if i and i["key"] == "sensex"), None)
    headline = f"Nifty 50 {move_word(nifty['pct'])} {fmt_pct(nifty['pct'])} to {fmt_num(nifty['last'])}"
    if sensex:
        headline += f"; Sensex {fmt_pct(sensex['pct'])} to {fmt_num(sensex['last'])}"
    summary = " ".join(d["text"] for d in drivers[:2]) if drivers else \
        "No single signal stood out today: sectors, global markets and commodities all moved within their normal range."

    s = df["^NSEI"]["Close"].dropna().tail(30)
    trend = [{"d": i.date().isoformat(), "c": r2(v)} for i, v in s.items()]

    sweep = {
        "version": 1,
        "title": "Inverika Market Matter",
        "market_date": market_date.isoformat(),
        "session": session,
        "generated_at": now.isoformat(timespec="minutes"),
        "headline": headline,
        "summary": summary,
        "indices": [i for i in indices if i],
        "nifty_trend": trend,
        "breadth": breadth,
        "sectors": [{k: v for k, v in x.items() if k != "words"} for x in sorted(sectors, key=lambda x: x["pct"], reverse=True)],
        "gainers": stocks[:5],
        "losers": stocks[::-1][:5],
        "global": [g for g in glob if g],
        "macro": [m for m in macro if m],
        "drivers": drivers,
        "news": news[:30],
        "sources": [
            {"label": "Prices: Yahoo Finance (NSE, BSE, global indices, futures, FX)", "url": "https://finance.yahoo.com/"},
            {"label": "Nifty 50 members: NIFTY 50 (Wikipedia)", "url": "https://en.wikipedia.org/wiki/NIFTY_50"},
            *[{"label": f"News: {n}", "url": u} for n, u in FEEDS if n != "Google News"],
            {"label": "News: Google News search for Sensex/Nifty", "url": "https://news.google.com/"},
        ],
    }

    out.mkdir(parents=True, exist_ok=True)
    (out / "sweeps").mkdir(exist_ok=True)
    blob = json.dumps(sweep, ensure_ascii=False, separators=(",", ":"))
    (out / "latest.json").write_text(blob, encoding="utf-8")
    (out / "sweeps" / f"{market_date.isoformat()}.json").write_text(blob, encoding="utf-8")

    files = sorted((out / "sweeps").glob("*.json"), reverse=True)
    for old in files[KEEP_SWEEPS:]:
        old.unlink()
    entries = []
    for f in files[:KEEP_SWEEPS]:
        try:
            j = json.loads(f.read_text(encoding="utf-8"))
            nif = next(i for i in j["indices"] if i["key"] == "nifty")
            entries.append({"date": j["market_date"], "pct": nif["pct"], "headline": j["headline"],
                            "file": f"sweeps/{f.name}"})
        except Exception as e:
            log.warning("skipping %s: %s", f.name, e)
    (out / "index.json").write_text(json.dumps({"updated": sweep["generated_at"], "sweeps": entries},
                                               ensure_ascii=False, indent=1), encoding="utf-8")
    log.info("%s | %d drivers | %d headlines", headline, len(drivers), len(sweep["news"]))
    return sweep


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", default=str(HERE.parent / "data"))
    a = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    run(Path(a.out))


if __name__ == "__main__":
    sys.exit(main())
