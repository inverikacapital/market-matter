# Inverika Market Matter

A daily sweep of the Indian stock market, built by Manisha Hebbar for Inverika.

Every weekday after the NSE close, a GitHub Action runs `sweep/sweep.py`, which:

1. **Collects the day's numbers** from Yahoo Finance: Nifty 50, Sensex, Nifty Bank, Midcap and India VIX;
   11 sector indices; all 50 Nifty stocks; the previous US session (S&P 500, Nasdaq); Asia and Europe;
   Brent crude, gold, silver, USD/INR, the US 10-year yield and the dollar index.
2. **Reads the day's market headlines** from Economic Times, Mint, Business Standard, Hindu BusinessLine
   and a Google News search for Sensex/Nifty.
3. **Explains the move.** Each signal that moved beyond a set threshold becomes a "driver": sector leaders,
   market breadth (broad or narrow), big single-stock moves, global cues, crude, gold, the rupee, US yields,
   volatility and foreign-flow news. Each driver states its numbers, why it matters for Indian stocks, and
   links the headlines (published around the session) that mention it.
4. **Publishes** `data/latest.json`, one file per trading day under `data/sweeps/`, and an
   `data/index.json` archive list. `index.html` reads these files directly.

The thresholds are fixed in code (for example, crude counts when Brent moves 1% or more), so every
explanation can be traced to a rule and a number. Drivers describe what moved alongside the market;
they are not proof of cause. Not investment advice.

## Folder layout

```
market-matter/
├── index.html                  Page: same design as inverikacapital.github.io; reads its live data/latest.json
├── assets/                     styles.css, app.js and icons for index.html (copied from inverikacapital.github.io)
├── market-matter.js            The <market-matter> web component that draws a sweep
├── serve.ps1                   Local preview server: powershell -File serve.ps1
├── sweep/
│   ├── sweep.py                The daily sweep
│   ├── requirements.txt        Python dependencies
│   └── constituents.json       Nifty 50 member list used by the sweep
├── data/
│   ├── latest.json             Newest sweep
│   ├── index.json              Archive list of every sweep
│   └── sweeps/YYYY-MM-DD.json  One file per trading day
└── .github/workflows/
    └── daily-sweep.yml         Runs the sweep Mon–Fri at 16:45 IST and commits data/
```

## Run it yourself

```bash
pip install -r sweep/requirements.txt
python sweep/sweep.py --out data
```

Then preview the page locally:

```powershell
powershell -File serve.ps1    # opens on http://localhost:8765/
```

## Publishing

- Push this repository to the `inverikacapital` GitHub account as `market-matter`.
- In **Settings → Actions → General**, set workflow permissions to "Read and write" so the daily
  sweep can commit its results.
- Optional: turn on **Settings → Pages** (deploy from `main`, root) to publish `index.html` at https://inverikacapital.github.io/market-matter/ (the hebbarmanisha.github.io site loads its live panel from there).

## Note on the Nifty 50 list

`sweep/constituents.json` was copied from FinSpider (in the hebbarmanisha.github.io repository), which
refreshes it weekly. In this repository it does not update itself, so replace it when the Nifty 50 changes.

## Live market dashboard (moved here from inverikacapital.github.io)

`index.html` with `assets/app.js` and `assets/styles.css` is the Market Matters dashboard (Nifty 500, indices,
sectors, movers, FII/DII, global, FX & commodities, outlook, news). Its data lives in `market/`:

- `scripts/fetch_data.py` writes `market/latest.json`, `market/history.json` and `market/flows.json` (standard library only).
- `.github/workflows/update.yml` runs it, commits settled data and deploys the site to GitHub Pages
  (Settings → Pages → Source: GitHub Actions). It also redeploys after code pushes and after the daily sweep.
- `.github/workflows/ticker.yml` triggers `update.yml` every 15 minutes in market hours and in the FII/DII evening window.
- `scripts/make_share_image.py` rebuilds `assets/share-v3.jpg`, the link-preview image.
