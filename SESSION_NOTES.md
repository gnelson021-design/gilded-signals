# GILDED SIGNALS — SESSION NOTES
# Save this file and paste into any new Claude chat to restore context.

## SITE
- URL: gildedsignals.com
- Repo: ~/gilded-signals (GitHub: gnelson021-design/gilded-signals)
- Deploy: git add / commit / push -> Netlify auto-deploys (coruscating-capybara-6e7d33)
- All edits: Python str.replace (count=1) only. Never sed.
- One command per code block.

## STACK
- Netlify functions: netlify/functions/quote.js (Alpaca+Finnhub), netlify/functions/news.js (Finnhub)
- Env vars in Netlify: ALPACA_API_KEY, ALPACA_SECRET_KEY, FINNHUB_API_KEY
- Stocks: Alpaca Market Data API (NOT paper trading portfolio)
- Crypto: CoinGecko (free, no key)
- News: Finnhub /news endpoint
- Email: intel@gildedsignals.com
- Newsletter: Kit/ConvertKit Form ID 9477301

## QUOTE API
- Endpoint: /api/quote?symbol=NVDA or /api/quote?symbol=BTC/USD
- Returns: price, change, changePercent, weekChange, monthChange, ytdChange,
  high, low, open, previousClose, volume, avgVolume, rvol,
  rsi14, ema20, ema50, ema200, emaStatus, macd, macdSignal, macdHist,
  support, resistance, week52High, week52Low,
  marketCap, peRatio, revenueGrowth, epsGrowth, analystRating, sector,
  gildedScore (0-100), gildedBadge, gildedReasons[], updatedAt, source
- quote.js written by Opus (20558 chars), deployed and confirmed working

## NEWS API
- Endpoint: /api/news?cat=market|ai|crypto|earnings|econ|world
- Returns: array of {source, headline, summary, url, time, cat, catLabel}
- 10-min cache per category

## PAGES (all SPA via showPage())
- home, news, ai, world, scanner, pricing
- about, newsletter, contact, terms, privacy, disclaimer (added today)
- showPage is global: window.showPage=function showPage(id){...}
- Null check added so missing page ID never kills routing

## SCANNER
- Compare tool at TOP of scanner page
- Live grid (Stocks/Tech/Crypto tabs) BELOW compare tool
- Click any card in grid -> auto-fills next open compare slot
- gsLoadTab() loads on showPage('scanner')
- Stocks tab: SPY, QQQ, TSLA, AMZN, MSFT, JPM, GLD, BAC, DIS
- Tech tab: NVDA, AMD, AVGO, ASML, MU, MRVL, VRT, COHR, PLTR, PANW
- Crypto tab: BTC/USD, ETH/USD, SOL/USD, XRP/USD

## KNOWN ISSUES / TODO
- Logo: nav still shows old gs-logo.png -- new logos ready (IMG_9945.png=nav, FullSizeRender=favicon)
  New logos saved on phone, need to be dragged into Linux and copied
- Compare cards: data is live but UI doesn't show all fields yet
  (MACD, Gilded Score, week/month/YTD change not displayed in cards)
- Stripe: Subscribe $9/mo button on pricing has no live payment link yet
- FAQ answer "when does live data go online" is outdated -- it IS live now
- marketCap, peRatio, sector returning null -- Finnhub free tier limitation
- filterNews_disabled function left in code (harmless, can clean up)

## BRANDING
- Fonts: Cormorant Garamond, Playfair Display, DM Sans
- Gold: #D4AF37 / var(--gold)
- Background: black + charcoal (#1a1a1a, #222)
- Admin bypass: gildedsignals.com?admin=true
- Tagline: Real signals. No noise. No hype.

## OTHER SITES
- tradingbotguru.com (tbg-site repo) -- bots v3/v6/v7.1 for sale on Gumroad
- prefprep.com -- hospitality startup with Carlito
- gupdates.info -- newsletter landing page
