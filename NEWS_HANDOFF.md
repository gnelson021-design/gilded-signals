# GILDED SIGNALS — NEWS BUILD HANDOFF

## HARD RULES
- DO NOT TOUCH THE SCANNER. Locked and perfect. No edits to gs-scanner.js, quote.js, quotes.js, /api/quote, /api/quotes.
- News work stays in DEMO MODE / standalone test file only. Nothing merges to index.html or main until I explicitly approve.
- Edits via Python str.replace (count=1, self-guarded). Never sed. Run node --check before delivering any JS.
- Never put git push in the same block as other commands. Give it separately after I confirm.
- I run all git add/commit/push myself. Netlify auto-deploys from main.
- Always work from my freshly uploaded files or the live repo. The Claude Project attached files are STALE.
- Read-only commands first (git status, git ls-files, grep, find). Measure twice, cut once.

## PROJECT
- Repo: gnelson021-design/gilded-signals. Local: ~/gilded-signals (Chromebook, Linux/penguin).
- Hosting: Netlify (site coruscating-capybara-6e7d33), auto-deploys from main.
- Stack: HTML/CSS/vanilla JS + Netlify functions (Node 18).
- index.html = single-page site ~826 lines, all pages via showPage(id).
- Env vars (Netlify only, NO local .env): ALPACA_API_KEY, ALPACA_SECRET_KEY, FINNHUB_API_KEY.
- Data: Alpaca (stocks), CoinGecko (crypto), Finnhub (fundamentals + news).
- Stripe: check-subscription.js + create-checkout-session.js already exist.
- Newsletter: Kit/ConvertKit Form ID 9477301.

## NEWS FEATURE STATE
- Endpoint: /api/news?cat=market|ai|crypto|earnings|econ|world -> [{source,headline,summary,url,time,cat,catLabel}], 10-min cache.
- Front-end still uses hardcoded NEWS array in index.html (~line 688). renderNews(containerId,filter) ~line 714. Grids: newsGrid (Market, has tabs), aiGrid, worldGrid.
- Field mismatch: news.js returns time as ISO timestamp; front-end expects "2h ago". Need timeAgo() helper.

## ACTIVE BLOCKER
/api/news returns {"error":"Bad response from Finnhub"}. Function deployed, route works, but Finnhub returns non-array (bad/expired key, rate limit, or plan restriction).
NEXT STEP: get FINNHUB_API_KEY from Netlify > Site configuration > Environment variables, then test:
  curl -s "https://finnhub.io/api/v1/news?category=general&token=PASTE_KEY" | head -c 400; echo
Show the RESPONSE only (never the key). That reveals root cause.

## SOURCES (settled)
Cannot scrape Bloomberg/WSJ/Nasdaq/TradingView (paywalled, copyrighted, no free API). Correct model = aggregate via licensed news API (Finnhub now; optionally Marketaux/NewsAPI later), show headline + summary + "Read Source" link out. Never copy full articles.

## SEQUENCE
1. Fix Finnhub blocker (diagnose key).
2. Build news in standalone demo file, wire to /api/news with timeAgo().
3. Confirm working -> I approve -> merge to index.html.
4. THEN set up Stripe and go live.
