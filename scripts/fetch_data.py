"""
Market Matters (Inverika Capital) - data builder.

Pulls prices from Yahoo Finance (chart API), the Nifty 50 constituent list from
NSE, and headlines from public RSS feeds. Computes the recap, the signal-based
outlook and the prediction track record, then writes site/data/latest.json.

Standard library only, so it runs anywhere Python 3.9+ is installed.
"""
from __future__ import annotations

import concurrent.futures as cf
import csv
import io
import json
import math
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "market"
LATEST = DATA_DIR / "latest.json"
HISTORY = DATA_DIR / "history.json"
FLOWS = DATA_DIR / "flows.json"  # FII/DII history; NSE only serves the latest day, so we keep our own

IST = timezone(timedelta(hours=5, minutes=30))
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"}

# ---------------------------------------------------------------- instruments
MAIN = "^CRSLDX"  # Nifty 500: the headline index (top 500 = 100 large + 150 mid + 250 small caps)
INDIA_INDICES = [
    ("^CRSLDX", "Nifty 500"),
    ("^NSEI", "Nifty 50"),
    ("^BSESN", "Sensex"),
    ("^NSEBANK", "Nifty Bank"),
    ("^CNX100", "Nifty 100"),
    ("NIFTYMIDCAP150.NS", "Midcap 150"),
    ("NIFTYSMLCAP250.NS", "Smallcap 250"),
    ("^INDIAVIX", "India VIX"),
]
SECTORS = [
    ("^CNXIT", "IT"), ("^NSEBANK", "Bank"), ("NIFTY_FIN_SERVICE.NS", "Financials"),
    ("^CNXAUTO", "Auto"), ("^CNXPHARMA", "Pharma"), ("NIFTY_HEALTHCARE.NS", "Healthcare"),
    ("^CNXFMCG", "FMCG"), ("^CNXMETAL", "Metal"), ("^CNXENERGY", "Energy"),
    ("NIFTY_OIL_AND_GAS.NS", "Oil & Gas"), ("^CNXREALTY", "Realty"), ("^CNXMEDIA", "Media"),
    ("^CNXPSUBANK", "PSU Bank"), ("^CNXINFRA", "Infra"), ("^CNXCONSUM", "Consumption"),
]
GLOBAL = {
    "Americas": [("^GSPC", "S&P 500"), ("^IXIC", "Nasdaq"), ("^DJI", "Dow Jones"), ("^VIX", "CBOE VIX")],
    "Europe": [("^FTSE", "FTSE 100"), ("^GDAXI", "DAX"), ("^FCHI", "CAC 40"), ("^STOXX50E", "Euro Stoxx 50")],
    "Asia": [("^N225", "Nikkei 225"), ("^HSI", "Hang Seng"), ("000001.SS", "Shanghai"), ("^KS11", "KOSPI")],
}
FUTURES = [("ES=F", "S&P 500 Fut"), ("NQ=F", "Nasdaq 100 Fut")]
MACRO = {
    "Currencies": [("INR=X", "USD/INR"), ("EURINR=X", "EUR/INR"), ("GBPINR=X", "GBP/INR"),
                   ("JPYINR=X", "JPY/INR"), ("DX-Y.NYB", "Dollar Index")],
    "Commodities": [("BZ=F", "Brent Crude"), ("CL=F", "WTI Crude"), ("GC=F", "Gold"),
                    ("SI=F", "Silver"), ("NG=F", "Natural Gas"), ("HG=F", "Copper")],
    "Bonds": [("^TNX", "US 10Y Yield")],
    "Crypto": [("BTC-USD", "Bitcoin"), ("ETH-USD", "Ethereum")],
}

# Fallback if the NSE list can't be downloaded. Refreshed automatically when it can.
FALLBACK_NIFTY50 = """ADANIENT ADANIPORTS APOLLOHOSP ASIANPAINT AXISBANK BAJAJ-AUTO BAJFINANCE BAJAJFINSV
BEL BHARTIARTL CIPLA COALINDIA DRREDDY EICHERMOT ETERNAL GRASIM HCLTECH HDFCBANK HDFCLIFE HEROMOTOCO
HINDALCO HINDUNILVR ICICIBANK INDUSINDBK INFY ITC JIOFIN JSWSTEEL KOTAKBANK LT M&M MARUTI NESTLEIND
NTPC ONGC POWERGRID RELIANCE SBILIFE SBIN SHRIRAMFIN SUNPHARMA TATACONSUM TATAMOTORS TATASTEEL TCS
TECHM TITAN TRENT ULTRACEMCO WIPRO""".split()

NEWS_FEEDS = {
    "india": [
        ("Economic Times", "https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms"),
        ("Mint", "https://www.livemint.com/rss/markets"),
        ("Business Standard", "https://www.business-standard.com/rss/markets-106.rss"),
    ],
    "global": [
        ("CNBC", "https://www.cnbc.com/id/100727362/device/rss/rss.html"),
        ("CNBC", "https://www.cnbc.com/id/20910258/device/rss/rss.html"),
        ("Yahoo Finance", "https://feeds.finance.yahoo.com/rss/2.0/headline?s=%5EGSPC&region=US&lang=en-US"),
    ],
}
NEWS_TAGS = [
    ("RBI", r"\bRBI\b|repo rate|reserve bank of india"),
    ("Fed", r"\bFed\b|federal reserve|powell|fomc"),
    ("Rates", r"rate (cut|hike)|yields?\b|bond"),
    ("Inflation", r"inflation|\bCPI\b|\bWPI\b|consumer prices"),
    ("Rupee", r"rupee|\bINR\b"),
    ("Oil", r"\boil\b|crude|brent|opec"),
    ("Gold", r"\bgold\b|silver"),
    ("Earnings", r"\bQ[1-4]\b|earnings|results|profit|revenue"),
    ("FII", r"\bFII|\bFPI|foreign (investors|inflows|outflows)"),
    ("IPO", r"\bIPO\b|listing"),
    ("China", r"china|beijing|yuan"),
    ("Tech", r"\bAI\b|nvidia|semiconductor|tech stocks"),
    ("Geopolitics", r"war|iran|israel|russia|ukraine|tariff|sanction"),
]


# -------------------------------------------------------------------- helpers
def http_get(url: str, timeout: int = 20, tries: int = 3) -> bytes:
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(1.5 * (i + 1))
    raise RuntimeError(f"GET failed {url}: {last}")


def rnd(x, n=2):
    return None if x is None or (isinstance(x, float) and math.isnan(x)) else round(x, n)


def pct(a, b):
    return None if a is None or not b else (a / b - 1.0) * 100.0


def clip(x, lo=-1.0, hi=1.0):
    return max(lo, min(hi, x))


def chart(symbol: str, rng: str = "1y", interval: str = "1d") -> dict | None:
    """Yahoo chart API -> {meta, bars:[{t,o,h,l,c,v}]} with null bars dropped."""
    url = ("https://query1.finance.yahoo.com/v8/finance/chart/" + urllib.parse.quote(symbol)
           + f"?range={rng}&interval={interval}&includePrePost=false")
    try:
        js = json.loads(http_get(url))
        res = js["chart"]["result"][0]
    except Exception as e:  # noqa: BLE001
        print(f"  ! {symbol} {rng}/{interval}: {e}", file=sys.stderr)
        return None
    ts = res.get("timestamp") or []
    q = (res.get("indicators", {}).get("quote") or [{}])[0]
    bars = []
    for i, t in enumerate(ts):
        c = (q.get("close") or [None])[i] if i < len(q.get("close") or []) else None
        if c is None:
            continue
        g = lambda k: (q.get(k) or [None] * len(ts))[i]  # noqa: E731
        bars.append({"t": t, "o": g("open"), "h": g("high"), "l": g("low"), "c": c, "v": g("volume")})
    return {"meta": res.get("meta", {}), "bars": bars}


def daily_series(sym: str, rng: str = "1y") -> dict | None:
    """Daily bars with the live/last price folded in so the final bar is exact."""
    d = chart(sym, rng, "1d")
    if not d or not d["bars"]:
        return None
    meta, bars = d["meta"], d["bars"]
    tz = timezone(timedelta(seconds=meta.get("gmtoffset", 0)))
    price = meta.get("regularMarketPrice")
    mtime = meta.get("regularMarketTime")
    if price is not None and mtime:
        last_day = datetime.fromtimestamp(bars[-1]["t"], tz).date()
        mday = datetime.fromtimestamp(mtime, tz).date()
        if mday == last_day:
            bars[-1]["c"] = price
        elif mday > last_day:
            bars.append({"t": mtime, "o": meta.get("regularMarketOpen") or price,
                         "h": meta.get("regularMarketDayHigh") or price,
                         "l": meta.get("regularMarketDayLow") or price, "c": price, "v": None})
    # collapse duplicate calendar days (Yahoo sometimes sends two bars for today)
    out = []
    for b in bars:
        day = datetime.fromtimestamp(b["t"], tz).date()
        if out and out[-1]["_d"] == day:
            out[-1].update({k: v for k, v in b.items() if v is not None})
        else:
            out.append({**b, "_d": day})
    for b in out:
        b["d"] = b.pop("_d").isoformat()
    return {"meta": meta, "bars": out, "tz": tz}


def summarize(sym: str, name: str, series: dict | None, spark_n: int = 30) -> dict | None:
    if not series:
        return None
    bars, meta = series["bars"], series["meta"]
    closes = [b["c"] for b in bars]
    last = bars[-1]
    prev = closes[-2] if len(closes) > 1 else meta.get("chartPreviousClose")
    chg = last["c"] - prev if prev else None

    def ret_back(n):
        return pct(closes[-1], closes[-1 - n]) if len(closes) > n else None

    year = last["d"][:4]
    ytd_base = next((closes[i - 1] for i, b in enumerate(bars) if b["d"][:4] == year and i > 0), None)
    return {
        "sym": sym, "name": name,
        "price": rnd(last["c"], 4 if last["c"] < 10 else 2),
        "prev": rnd(prev, 4 if prev and prev < 10 else 2),
        "chg": rnd(chg, 4 if abs(chg or 0) < 1 else 2),
        "chgPct": rnd(pct(last["c"], prev)),
        "open": rnd(last.get("o")), "high": rnd(last.get("h")), "low": rnd(last.get("l")),
        "date": last["d"],
        "w52h": rnd(max(b["h"] or b["c"] for b in bars[-252:])),
        "w52l": rnd(min(b["l"] or b["c"] for b in bars[-252:])),
        "perf": {"1W": rnd(ret_back(5)), "1M": rnd(ret_back(21)), "3M": rnd(ret_back(63)),
                 "YTD": rnd(pct(closes[-1], ytd_base)), "1Y": rnd(ret_back(min(250, len(closes) - 1)))},
        "spark": [rnd(c, 4) for c in closes[-spark_n:]],
        "currency": meta.get("currency"),
    }


# ----------------------------------------------------------------- indicators
def sma(xs, n):
    return sum(xs[-n:]) / n if len(xs) >= n else None


def ema_series(xs, n):
    k, out, e = 2 / (n + 1), [], None
    for x in xs:
        e = x if e is None else x * k + e * (1 - k)
        out.append(e)
    return out


def rsi(xs, n=14):
    if len(xs) <= n:
        return None
    gains = [max(0, xs[i] - xs[i - 1]) for i in range(1, len(xs))]
    losses = [max(0, xs[i - 1] - xs[i]) for i in range(1, len(xs))]
    ag, al = sum(gains[:n]) / n, sum(losses[:n]) / n
    for g, l in zip(gains[n:], losses[n:]):
        ag, al = (ag * (n - 1) + g) / n, (al * (n - 1) + l) / n
    return 100.0 if al == 0 else 100 - 100 / (1 + ag / al)


def macd_hist(xs):
    if len(xs) < 35:
        return None, None
    macd = [a - b for a, b in zip(ema_series(xs, 12), ema_series(xs, 26))]
    sig = ema_series(macd, 9)
    h = [m - s for m, s in zip(macd, sig)]
    return h[-1], h[-2]


# ------------------------------------------------------------------- sections
NSE_LIST = "https://archives.nseindia.com/content/indices/{}.csv"
SEGMENTS = [("Large", "ind_nifty100list"), ("Mid", "ind_niftymidcap150list"), ("Small", "ind_niftysmallcap250list")]


def nse_list(name: str) -> list[dict]:
    raw = http_get(NSE_LIST.format(name)).decode("utf-8", "ignore")
    # NSE adds temporary "DUMMY..." placeholder rows during corporate actions; they aren't real stocks
    return [{"sym": r["Symbol"].strip(), "name": r["Company Name"].strip(), "industry": r["Industry"].strip()}
            for r in csv.DictReader(io.StringIO(raw))
            if r.get("Symbol") and not r["Symbol"].strip().upper().startswith("DUMMY")]


def nifty500_list() -> list[dict]:
    """Nifty 500 constituents tagged Large (Nifty 100), Mid (Midcap 150) or Small (Smallcap 250)."""
    try:
        lst = nse_list("ind_nifty500list")
        seg = {}
        for label, name in SEGMENTS:
            for r in nse_list(name):
                seg[r["sym"]] = label
        for r in lst:
            r["seg"] = seg.get(r["sym"], "Small")
        if len(lst) >= 450:
            return lst
    except Exception as e:  # noqa: BLE001
        print(f"  ! NSE lists: {e}", file=sys.stderr)
    return [{"sym": s, "name": s, "industry": "—", "seg": "Large"} for s in FALLBACK_NIFTY50]


def short_name(n: str) -> str:
    n = re.sub(r"\b(Limited|Ltd\.?|Corporation|Company|Co\.)\s*$", "", n).strip().rstrip(".")
    n = n.replace(" and ", " & ").replace("Enterprise", "Ent.")
    if len(n) > 24:
        n = n[:24].rsplit(" ", 1)[0].rstrip("&,- ")
    return n


def stock_row(info: dict) -> dict | None:
    def usable(x):
        if not x or len(x["bars"]) < 2:
            return False
        mt = x["meta"].get("regularMarketTime") or 0
        return time.time() - mt < 5 * 86400  # Yahoo's NSE feed for some REITs is frozen years in the past

    s = daily_series(info["sym"] + ".NS", "3mo")
    if not usable(s):
        # fall back to the BSE listing (new listings and REITs are often only reliable there)
        b = daily_series(info["sym"] + ".BO", "3mo")
        if usable(b):
            s = b
    if not usable(s):
        return None
    bars = s["bars"]
    c, p = bars[-1]["c"], bars[-2]["c"]
    vols = [b["v"] for b in bars[-21:-1] if b.get("v")]
    v = bars[-1].get("v") or 0
    return {
        "sym": info["sym"], "name": short_name(info["name"]), "industry": info["industry"], "seg": info.get("seg"),
        "price": rnd(c), "chg": rnd(c - p), "chgPct": rnd(pct(c, p)),
        "vol": v, "volRatio": rnd(v / (sum(vols) / len(vols)), 2) if vols and v else None,
        "w1": rnd(pct(c, bars[-6]["c"])) if len(bars) > 6 else None,
        "date": bars[-1]["d"],
    }


def fetch_nse_flows() -> list[dict]:
    """Latest FII/FPI and DII cash-market activity from NSE (₹ crore). Published ~7-8 PM IST."""
    import http.cookiejar
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    hdr = {**UA, "Accept-Language": "en-US,en;q=0.9"}
    opener.open(urllib.request.Request("https://www.nseindia.com/reports/fii-dii", headers=hdr), timeout=20).read()
    req = urllib.request.Request("https://www.nseindia.com/api/fiidiiTradeReact",
                                 headers={**hdr, "Accept": "application/json",
                                          "Referer": "https://www.nseindia.com/reports/fii-dii"})
    rows = json.loads(opener.open(req, timeout=20).read())
    out = {}
    for r in rows:
        day = datetime.strptime(r["date"], "%d-%b-%Y").date().isoformat()
        key = "fii" if "FII" in r["category"].upper() else "dii"
        out.setdefault(day, {"date": day})[key] = {
            "buy": float(r["buyValue"]), "sell": float(r["sellValue"]), "net": float(r["netValue"])}
    return [v for v in out.values() if "fii" in v and "dii" in v]


def build_flows(fetch=True):
    hist = []
    if FLOWS.exists():
        try:
            hist = json.loads(FLOWS.read_text("utf-8"))
        except Exception:  # noqa: BLE001
            hist = []
    fresh = fetch
    if fetch:
        try:
            for row in fetch_nse_flows():
                hist = [h for h in hist if h["date"] != row["date"]] + [row]  # same day = revised numbers
        except Exception as e:  # noqa: BLE001
            fresh = False
            print(f"  ! FII/DII: {e}", file=sys.stderr)
    hist = sorted(hist, key=lambda h: h["date"])[-250:]
    if not hist:
        return None
    FLOWS.write_text(json.dumps(hist, indent=1), "utf-8")

    last = hist[-1]
    month = last["date"][:7]
    mtd = [h for h in hist if h["date"][:7] == month]
    last5 = hist[-5:]

    def streak(key):
        sign = 1 if hist[-1][key]["net"] >= 0 else -1
        n = 0
        for h in reversed(hist):
            if (1 if h[key]["net"] >= 0 else -1) != sign:
                break
            n += 1
        return {"days": n, "side": "buying" if sign > 0 else "selling"}

    return {
        "latest": last, "fresh": fresh, "since": hist[0]["date"],
        "mtd": {"days": len(mtd), "fii": rnd(sum(h["fii"]["net"] for h in mtd)), "dii": rnd(sum(h["dii"]["net"] for h in mtd))},
        "last5": {"days": len(last5), "fii": rnd(sum(h["fii"]["net"] for h in last5)), "dii": rnd(sum(h["dii"]["net"] for h in last5))},
        "streak": {"fii": streak("fii"), "dii": streak("dii")},
        "recent": [{"date": h["date"], "fii": h["fii"]["net"], "dii": h["dii"]["net"]} for h in hist[-20:]],
    }


def fetch_news(feeds) -> list[dict]:
    items, seen = [], set()
    for source, url in feeds:
        try:
            root = ET.fromstring(http_get(url, timeout=15))
        except Exception as e:  # noqa: BLE001
            print(f"  ! news {source}: {e}", file=sys.stderr)
            continue
        for it in root.iter("item"):
            title = re.sub(r"\s+", " ", (it.findtext("title") or "")).strip()
            link = (it.findtext("link") or "").strip()
            if not title or not link:
                continue
            key = re.sub(r"\W+", "", title.lower())[:60]
            if key in seen:
                continue
            seen.add(key)
            try:
                ts = parsedate_to_datetime(it.findtext("pubDate")).astimezone(timezone.utc)
            except Exception:  # noqa: BLE001
                continue
            tags = [t for t, rx in NEWS_TAGS if re.search(rx, title, re.I)][:2]
            items.append({"title": title, "link": link, "source": source,
                          "time": ts.isoformat().replace("+00:00", "Z"), "tags": tags})
    cutoff = datetime.now(timezone.utc) - timedelta(hours=48)
    items = [i for i in items if datetime.fromisoformat(i["time"].replace("Z", "+00:00")) >= cutoff]
    # newest first, but rotate between publishers so one feed can't crowd out the rest
    by_src: dict[str, list] = {}
    for i in sorted(items, key=lambda i: i["time"], reverse=True):
        by_src.setdefault(i["source"], []).append(i)
    mixed = []
    while any(by_src.values()) and len(mixed) < 14:
        for lst in by_src.values():
            if lst:
                mixed.append(lst.pop(0))
    return sorted(mixed[:14], key=lambda i: i["time"], reverse=True)


# -------------------------------------------------------------------- outlook
def build_outlook(nifty_s, vix, glob, futures, macro, breadth, now_ist):
    bars = nifty_s["bars"]
    closes = [b["c"] for b in bars]
    last = bars[-1]
    price = closes[-1]
    sma20, sma50, sma200 = sma(closes, 20), sma(closes, 50), sma(closes, 200)
    r = rsi(closes)
    h, h_prev = macd_hist(closes)
    factors = []

    def add(name, value, signal, weight, note):
        factors.append({"name": name, "value": value, "signal": rnd(clip(signal), 3), "weight": weight, "note": note})

    t = (0.5 if price > sma20 else -0.5) + (0.5 if price > sma50 else -0.5)
    add("Trend", f"{'Above' if price > sma20 else 'Below'} 20D · {'above' if price > sma50 else 'below'} 50D",
        t, 20, f"20D avg {sma20:,.0f}, 50D avg {sma50:,.0f}")

    mom = (r - 50) / 20
    if r > 70:
        mom = 1 - (r - 70) / 7.5  # stretched: the higher it goes, the likelier a pullback
    elif r < 30:
        mom = -1 + (30 - r) / 7.5  # washed out: the lower it goes, the likelier a bounce
    add("Momentum (RSI 14)", f"{r:.1f}", mom, 15,
        "Overbought" if r > 70 else "Oversold" if r < 30 else "Neutral zone")

    if h is not None:
        ms = (0.6 if h > 0 else -0.6) + (0.4 if h > h_prev else -0.4)
        add("MACD", f"{'Positive' if h > 0 else 'Negative'}, {'rising' if h > h_prev else 'falling'}", ms, 10,
            "Histogram direction shows momentum shift")

    if vix:
        vc = vix["chgPct"] or 0
        lvl = vix["price"]
        add("India VIX", f"{lvl:.2f} ({vc:+.1f}%)", -vc / 8 - (0.3 if lvl > 20 else 0), 15,
            "Rising fear gauge weighs on equities" if vc > 0 else "Falling fear gauge supports equities")

    us = [x for x in glob.get("Americas", []) if x and x["sym"] in ("^GSPC", "^IXIC")]
    fut = [x for x in futures if x]
    asia = [x for x in glob.get("Asia", []) if x and x["sym"] in ("^N225", "^HSI", "^KS11")]
    cues = [x["chgPct"] for x in us + fut + asia if x.get("chgPct") is not None]
    if cues:
        avg = sum(cues) / len(cues)
        add("Global cues", f"{avg:+.2f}% avg", avg / 1.0, 20, "US close, US futures and Asian indices")

    fx = next((x for x in macro["Currencies"] if x and x["sym"] == "INR=X"), None)
    if fx:
        add("Rupee", f"USD/INR {fx['price']:.2f} ({fx['chgPct']:+.2f}%)", -fx["chgPct"] / 0.4, 7,
            "Weaker rupee tends to pull FII money out" if fx["chgPct"] > 0 else "Firmer rupee supports flows")

    brent = next((x for x in macro["Commodities"] if x and x["sym"] == "BZ=F"), None)
    if brent:
        add("Crude oil", f"Brent ${brent['price']:.2f} ({brent['chgPct']:+.2f}%)", -brent["chgPct"] / 2.5, 6,
            "India imports most of its oil, so higher crude is a headwind")

    if breadth and breadth["total"]:
        b = (breadth["adv"] - breadth["dec"]) / breadth["total"]
        add("Breadth", f"{breadth['adv']} up / {breadth['dec']} down", b * 1.4, 7, "Nifty 500 advancers vs decliners")

    wsum = sum(f["weight"] for f in factors)
    score = sum(f["signal"] * f["weight"] for f in factors) / wsum * 100
    agree = sum(1 for f in factors if (f["signal"] > 0) == (score > 0) and abs(f["signal"]) > 0.1) / len(factors)
    conf = round(clip(45 + abs(score) * 0.5 + (agree - 0.5) * 30, 35, 85))

    if score >= 35:
        bias = "Bullish"
    elif score >= 12:
        bias = "Mildly Bullish"
    elif score <= -35:
        bias = "Bearish"
    elif score <= -12:
        bias = "Mildly Bearish"
    else:
        bias = "Neutral"

    vix_lvl = vix["price"] if vix else 15
    sigma = price * vix_lvl / 100 / math.sqrt(252)  # one-day 1-sigma move implied by VIX
    center = price + score / 100 * 0.3 * sigma
    hi, lo, cl = last["h"] or price, last["l"] or price, price
    p = (hi + lo + cl) / 3
    pivots = {"R2": p + (hi - lo), "R1": 2 * p - lo, "P": p, "S1": 2 * p - hi, "S2": p - (hi - lo)}

    # the next trading day for which this call is made
    base_day = datetime.fromisoformat(last["d"]).date()
    nxt = base_day + timedelta(days=1)
    while nxt.weekday() >= 5:
        nxt += timedelta(days=1)

    return {
        "index": MAIN, "indexName": "Nifty 500",
        "baseDate": last["d"], "forDate": nxt.isoformat(), "bias": bias, "score": rnd(score, 1),
        "confidence": conf, "sigma": rnd(sigma),
        "range": {"low": rnd(center - sigma), "high": rnd(center + sigma), "center": rnd(center)},
        "pivots": {k: rnd(v) for k, v in pivots.items()},
        "levels": {"sma20": rnd(sma20), "sma50": rnd(sma50), "sma200": rnd(sma200), "rsi": rnd(r, 1)},
        "factors": factors,
    }


def update_track_record(outlook, nifty_bars, live=False):
    hist = []
    if HISTORY.exists():
        try:
            hist = json.loads(HISTORY.read_text("utf-8"))
        except Exception:  # noqa: BLE001
            hist = []
    hist = [h for h in hist if h.get("index") == outlook["index"]]  # only calls on the current headline index
    by_date = {b["d"]: b for b in nifty_bars}
    days = [b["d"] for b in nifty_bars]

    # store/overwrite today's call (keyed by the session it was built from)
    entry = {"index": outlook["index"], "baseDate": outlook["baseDate"], "forDate": outlook["forDate"], "bias": outlook["bias"],
             "score": outlook["score"], "low": outlook["range"]["low"], "high": outlook["range"]["high"],
             "baseClose": by_date[outlook["baseDate"]]["c"]}
    # mid-session runs only give a provisional view; the call is locked in from the closing data
    if not live:
        hist = [h for h in hist if h["baseDate"] != entry["baseDate"]] + [entry]

    # grade calls whose following session has now closed
    for h in hist:
        if h.get("graded"):
            continue
        later = [d for d in days if d > h["baseDate"]]
        if not later:
            continue
        nb = by_date[later[0]]
        if later[0] == days[-1] and (live or (datetime.now(IST).date().isoformat() == later[0]
                                             and datetime.now(IST).time() < datetime.strptime("15:35", "%H:%M").time())):
            continue  # session still in progress
        move = pct(nb["c"], h["baseClose"])
        b = h["bias"]
        if "Bullish" in b:
            hit = move > 0
        elif "Bearish" in b:
            hit = move < 0
        else:
            hit = abs(move) < 0.5
        h.update({"actualDate": later[0], "actualClose": rnd(nb["c"]), "actualPct": rnd(move),
                  "hit": hit, "inRange": h["low"] <= nb["c"] <= h["high"], "graded": True})
    hist = sorted(hist, key=lambda h: h["baseDate"])[-250:]
    HISTORY.write_text(json.dumps(hist, indent=1), "utf-8")

    graded = [h for h in hist if h.get("graded")]
    n = len(graded)
    # during a session: the call made for it (before the open) that is still waiting to be graded
    pend = [h for h in hist if not h.get("graded") and h["baseDate"] < days[-1]]
    pending = ({k: pend[-1][k] for k in ("forDate", "bias", "score", "low", "high", "baseClose")}
               if live and pend else None)
    return {
        "pending": pending,
        "calls": n,
        "hits": sum(h["hit"] for h in graded),
        "accuracy": rnd(sum(h["hit"] for h in graded) / n * 100, 1) if n else None,
        "inRange": rnd(sum(h["inRange"] for h in graded) / n * 100, 1) if n else None,
        "recent": [{k: h.get(k) for k in ("forDate", "actualDate", "bias", "actualPct", "hit", "inRange")}
                   for h in graded[-10:]][::-1],
    }


# ---------------------------------------------------------------------- recap
def fmt_move(x):
    return f"{'up' if x >= 0 else 'down'} {abs(x):.2f}%"


def build_recap(idx, sectors, movers, breadth, vix, glob, macro, live=False, as_of=""):
    m5, n, s, b = idx.get(MAIN), idx.get("^NSEI"), idx.get("^BSESN"), idx.get("^NSEBANK")
    lines = []
    if m5:
        lines.append(f"Nifty 500 is at {m5['price']:,.2f} as of {as_of} IST, {fmt_move(m5['chgPct'])} ({m5['chg']:+,.2f} pts) so far today."
                     if live else
                     f"Nifty 500 closed at {m5['price']:,.2f}, {fmt_move(m5['chgPct'])} ({m5['chg']:+,.2f} pts).")
    if n and s:
        bank = f"; Bank Nifty {'is' if live else 'moved'} {b['chgPct']:+.2f}%" if b else ""
        lines.append(f"Nifty 50 {'is at' if live else 'ended at'} {n['price']:,.2f} ({n['chgPct']:+.2f}%) and the Sensex at "
                     f"{s['price']:,.2f} ({s['chgPct']:+.2f}%){bank}.")
    large, mid, small = idx.get("^CNX100"), idx.get("NIFTYMIDCAP150.NS"), idx.get("NIFTYSMLCAP250.NS")
    if large and mid and small:
        lines.append(f"By size: large caps (Nifty 100) {large['chgPct']:+.2f}%, mid caps (Midcap 150) "
                     f"{mid['chgPct']:+.2f}%, small caps (Smallcap 250) {small['chgPct']:+.2f}%.")
    if sectors:
        ss = sorted(sectors, key=lambda x: x["chgPct"])
        lead, lag = ("is leading", "is lagging") if live else ("led", "lagged")
        lines.append(f"{ss[-1]['name']} {lead} the sectors ({ss[-1]['chgPct']:+.2f}%), "
                     f"while {ss[0]['name']} {lag} ({ss[0]['chgPct']:+.2f}%).")
    if movers["gainers"] and movers["losers"]:
        g, l = movers["gainers"][0], movers["losers"][0]
        verb = "is" if live else "was"
        lines.append(f"Top Nifty 500 gainer {verb} {g['name']} ({g['chgPct']:+.2f}%); biggest faller {verb} "
                     f"{l['name']} ({l['chgPct']:+.2f}%). Breadth: {breadth['adv']} advances vs {breadth['dec']} declines.")
    if vix:
        up_w, dn_w = ("is up", "is down") if live else ("rose", "eased")
        lines.append(f"India VIX {up_w if vix['chgPct'] >= 0 else dn_w} {abs(vix['chgPct']):.1f}% at {vix['price']:.2f}.")
    us = {x["sym"]: x for x in glob.get("Americas", []) if x}
    if "^GSPC" in us and "^IXIC" in us:
        lines.append(f"Overseas, the S&P 500 last closed {fmt_move(us['^GSPC']['chgPct'])} and the Nasdaq "
                     f"{fmt_move(us['^IXIC']['chgPct'])}.")
    m = {x["sym"]: x for grp in macro.values() for x in grp if x}
    if "INR=X" in m and "BZ=F" in m and "GC=F" in m:
        lines.append(f"The rupee is at {m['INR=X']['price']:.2f} per dollar, Brent at ${m['BZ=F']['price']:.2f} "
                     f"({m['BZ=F']['chgPct']:+.2f}%) and gold at ${m['GC=F']['price']:,.0f} ({m['GC=F']['chgPct']:+.2f}%).")
    return lines


# ----------------------------------------------------------------------- main
def main():
    t0 = time.time()
    now_utc = datetime.now(timezone.utc)
    now_ist = now_utc.astimezone(IST)
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    syms = {s for s, _ in INDIA_INDICES + SECTORS + FUTURES}
    syms |= {s for g in GLOBAL.values() for s, _ in g}
    syms |= {s for g in MACRO.values() for s, _ in g}

    print(f"Fetching {len(syms)} instruments…")
    with cf.ThreadPoolExecutor(8) as ex:
        series = dict(zip(syms, ex.map(lambda s: daily_series(s, "1y"), syms)))

    nifty_s = series.get(MAIN)
    if not nifty_s:
        sys.exit("Nifty 500 data unavailable — aborting without overwriting the last good data.")

    names = dict(SECTORS + INDIA_INDICES + FUTURES)  # India index names win over sector labels
    for g in list(GLOBAL.values()) + list(MACRO.values()):
        names.update(dict(g))
    summ = {s: summarize(s, names[s], series[s]) for s in syms}

    india_idx = [summ[s] for s, _ in INDIA_INDICES if summ.get(s)]
    idx_map = {x["sym"]: x for x in india_idx}
    sectors = [{"sym": s, "name": n, "chgPct": summ[s]["chgPct"], "price": summ[s]["price"],
                "w1": summ[s]["perf"]["1W"], "m1": summ[s]["perf"]["1M"]}
               for s, n in SECTORS if summ.get(s)]

    # India charts: full year of daily closes + today's intraday for the headline indices
    charts = {}
    for s, _ in INDIA_INDICES:
        ds = series.get(s)
        if not ds:
            continue
        intra = chart(s, "1d", "5m")
        ib = intra["bars"] if intra else []
        if ib and ds["bars"]:
            tz = timezone(timedelta(seconds=intra["meta"].get("gmtoffset", 19800)))
            if datetime.fromtimestamp(ib[-1]["t"], tz).date().isoformat() != ds["bars"][-1]["d"]:
                ib = []
        charts[s] = {
            "daily": [[b["d"], rnd(b["c"])] for b in ds["bars"]],
            "intraday": [[b["t"], rnd(b["c"])] for b in ib],
            "prevClose": idx_map.get(s, {}).get("prev"),
        }

    print("Fetching Nifty 500 constituents…")
    const = nifty500_list()
    with cf.ThreadPoolExecutor(16) as ex:
        stocks = [r for r in ex.map(stock_row, const) if r and r["chgPct"] is not None]
    last_day = nifty_s["bars"][-1]["d"]
    stocks = [s for s in stocks if s["date"] == last_day] or stocks
    stocks.sort(key=lambda x: x["chgPct"], reverse=True)
    breadth = {"adv": sum(s["chgPct"] > 0 for s in stocks), "dec": sum(s["chgPct"] < 0 for s in stocks),
               "unch": sum(s["chgPct"] == 0 for s in stocks), "total": len(stocks)}
    segments = []
    for label, idx_sym in (("Large", "^CNX100"), ("Mid", "NIFTYMIDCAP150.NS"), ("Small", "NIFTYSMLCAP250.NS")):
        grp = [s for s in stocks if s["seg"] == label]  # already sorted best → worst
        if not grp:
            continue
        mv = sorted(s["chgPct"] for s in grp)
        ix = idx_map.get(idx_sym, {})
        members = [c for c in const if c.get("seg") == label]
        priced = {s["sym"] for s in grp}
        missing = [c["name"] for c in members if c["sym"] not in priced]
        if missing:
            print(f"  ! {label}: not priced today: {', '.join(missing)}", file=sys.stderr)
        segments.append({
            "seg": label, "index": ix.get("name"), "chgPct": ix.get("chgPct"), "count": len(grp),
            "members": len(members), "missing": missing,
            "adv": sum(x > 0 for x in mv), "dec": sum(x < 0 for x in mv), "median": rnd(mv[len(mv) // 2]),
            "top": grp[0], "bottom": grp[-1],
        })
    movers = {
        "gainers": stocks[:5], "losers": stocks[::-1][:5],
        "active": sorted([s for s in stocks if s["volRatio"]], key=lambda x: x["volRatio"], reverse=True)[:5],
    }

    glob = {k: [summ[s] for s, _ in v if summ.get(s)] for k, v in GLOBAL.items()}
    futures = [summ[s] for s, _ in FUTURES if summ.get(s)]
    macro = {k: [summ[s] for s, _ in v if summ.get(s)] for k, v in MACRO.items()}
    vix = idx_map.get("^INDIAVIX")

    # Session state
    close_t = now_ist.replace(hour=15, minute=30, second=0, microsecond=0)
    open_t = now_ist.replace(hour=9, minute=15, second=0, microsecond=0)
    if last_day == now_ist.date().isoformat():
        status = "closed" if now_ist >= close_t else "live" if now_ist >= open_t else "pre-open"
    else:
        status = "pre-open" if now_ist.weekday() < 5 and now_ist < open_t else "closed"
    status = os.environ.get("SWEEP_FORCE_STATUS", status)  # for local testing only
    live = status == "live"

    print("Building outlook…")
    outlook = build_outlook(nifty_s, vix, glob, futures, macro, breadth, now_ist)
    outlook["provisional"] = live
    track = update_track_record(outlook, nifty_s["bars"], live=live)

    print("Fetching news…")
    news = {k: fetch_news(v) for k, v in NEWS_FEEDS.items()}

    print("Fetching FII/DII activity…")
    flows = build_flows(fetch=not live)  # NSE publishes once, ~7-8 PM IST; no need to hit it every 15 min
    recap = build_recap(idx_map, sectors, movers, breadth, vix, glob, macro, live=live,
                        as_of=now_ist.strftime("%I:%M %p").lstrip("0"))
    if flows and flows["latest"]["date"] == last_day and not live:
        f, dd = flows["latest"]["fii"]["net"], flows["latest"]["dii"]["net"]
        recap.insert(3, f"FIIs were net {'buyers' if f >= 0 else 'sellers'} of ₹{abs(f):,.0f} cr and DIIs net "
                        f"{'buyers' if dd >= 0 else 'sellers'} of ₹{abs(dd):,.0f} cr (provisional, NSE).")

    out = {
        "generatedAt": now_utc.isoformat(timespec="seconds").replace("+00:00", "Z"),
        "session": {"date": last_day, "status": status},
        "india": {"indices": india_idx, "sectors": sectors, "breadth": breadth, "movers": movers,
                  "stocks": stocks, "segments": segments, "charts": charts, "main": MAIN},
        "global": glob, "futures": futures, "macro": macro,
        "outlook": outlook, "track": track,
        "recap": recap,
        "flows": flows,
        "news": news,
        "sources": ["Yahoo Finance", "NSE India", "Economic Times", "Mint", "Business Standard", "CNBC"],
    }
    tmp = LATEST.with_suffix(".tmp")
    tmp.write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False), "utf-8")
    tmp.replace(LATEST)
    print(f"Wrote {LATEST.relative_to(ROOT)} ({LATEST.stat().st_size/1024:.0f} KB) in {time.time()-t0:.1f}s · "
          f"session {last_day} [{status}] · outlook {outlook['bias']} ({outlook['score']})")


if __name__ == "__main__":
    main()
