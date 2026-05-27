/**
 * SECURE MARKET QUOTE API — Netlify Serverless Function
 * ======================================================
 * Endpoint: /api/quote?symbol=NVDA
 * Endpoint: /api/quote?symbols=NVDA,AAPL,MSFT  (batch, max 10)
 *
 * SECURITY: All API credentials are stored in Netlify environment variables.
 * Keys are NEVER exposed to the browser, client-side JS, GitHub, or logs.
 *
 * This function uses Alpaca MARKET DATA endpoints ONLY.
 * Trading endpoints (orders, positions, accounts) are NEVER called.
 *
 * CORS is restricted to your known domains only.
 */

const https = require("https");

// ─── CONFIGURATION ───────────────────────────────────────────────────────────

const CONFIG = {
  cacheTtlMs: 20_000,          // 20-second server-side cache per symbol
  batchMax: 10,                // Max symbols per batch request
  timeoutMs: 8_000,            // 8-second HTTP timeout

  // Domains allowed to call this API (keep this locked down)
  allowedOrigins: [
    "https://tradingbotguru.com",
    "https://www.tradingbotguru.com",
    "https://scanner.tradingbotguru.com",
    "https://gildedsignals.com",
    "https://www.gildedsignals.com",
    "https://gupdates.info",
    "https://www.gupdates.info",
    "https://gupdates.live",
    "https://www.gupdates.live",
    "https://gupdates.com",
    "https://www.gupdates.com",
    // Allow localhost for dev testing only
    "http://localhost:8888",
    "http://localhost:3000",
    "http://127.0.0.1:5500",
  ],
};

// ─── IN-MEMORY CACHE ─────────────────────────────────────────────────────────
// Note: Netlify function instances may be separate — this is a best-effort
// cache that prevents burst calls within a single warm function instance.

const _cache = new Map(); // { symbol -> { data, timestamp } }

function cacheGet(symbol) {
  const entry = _cache.get(symbol);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CONFIG.cacheTtlMs) {
    _cache.delete(symbol);
    return null;
  }
  return entry.data;
}

function cacheSet(symbol, data) {
  _cache.set(symbol, { data, timestamp: Date.now() });
}

// ─── MARKET STATUS ───────────────────────────────────────────────────────────

function getMarketStatus() {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun, 6=Sat

  // Weekend check
  if (day === 0 || day === 6) return "closed";

  // US Eastern Time offset (DST-aware approximation)
  const month = now.getUTCMonth() + 1;
  const d = now.getUTCDate();

  // Rough DST: second Sunday in March → first Sunday in November
  // This is an approximation; use a proper library for strict accuracy
  const isDST = month > 3 && month < 11
    || (month === 3 && d >= 8)
    || (month === 11 && d < 7);
  const offsetHrs = isDST ? 4 : 5;

  const etHour = (now.getUTCHours() - offsetHrs + 24) % 24;
  const etMinutes = etHour * 60 + now.getUTCMinutes();

  const preOpen  = 4 * 60;          // 4:00 AM ET
  const open     = 9 * 60 + 30;     // 9:30 AM ET
  const close    = 16 * 60;         // 4:00 PM ET
  const afterEnd = 20 * 60;         // 8:00 PM ET

  if (etMinutes >= open && etMinutes < close)    return "open";
  if (etMinutes >= preOpen && etMinutes < open)  return "pre-market";
  if (etMinutes >= close && etMinutes < afterEnd) return "after-hours";
  return "closed";
}

// ─── ALPACA MARKET DATA FETCH ─────────────────────────────────────────────────
// Uses data.alpaca.markets (market data, READ-ONLY)
// NEVER uses api.alpaca.markets (trading API — would expose account access)

function alpacaRequest(path) {
  const apiKey    = process.env.ALPACA_API_KEY;
  const apiSecret = process.env.ALPACA_API_SECRET;

  if (!apiKey || !apiSecret) {
    return Promise.reject(new Error("MISSING_CREDENTIALS"));
  }

  return new Promise((resolve, reject) => {
    const options = {
      hostname: "data.alpaca.markets",
      port: 443,
      path,
      method: "GET",
      headers: {
        "APCA-API-KEY-ID":     apiKey,
        "APCA-API-SECRET-KEY": apiSecret,
        "Accept":              "application/json",
      },
    };

    const req = https.request(options, (res) => {
      let raw = "";
      res.on("data", (chunk) => (raw += chunk));
      res.on("end", () => {
        if (res.statusCode === 404) {
          return reject(new Error("INVALID_SYMBOL"));
        }
        if (res.statusCode === 403 || res.statusCode === 401) {
          return reject(new Error("AUTH_ERROR"));
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`ALPACA_${res.statusCode}`));
        }
        try {
          resolve(JSON.parse(raw));
        } catch {
          reject(new Error("PARSE_ERROR"));
        }
      });
    });

    req.setTimeout(CONFIG.timeoutMs, () => {
      req.destroy();
      reject(new Error("TIMEOUT"));
    });
    req.on("error", reject);
    req.end();
  });
}

// ─── QUOTE BUILDER ───────────────────────────────────────────────────────────

async function buildQuote(symbol) {
  // Check cache first
  const cached = cacheGet(symbol);
  if (cached) return { ...cached, _cached: true };

  // Fetch snapshot — contains latestTrade, latestQuote, dailyBar, prevDailyBar
  // This is a MARKET DATA endpoint — no trading access, no account info
  const snapshot = await alpacaRequest(
    `/v2/stocks/${encodeURIComponent(symbol)}/snapshot`
  );

  // Extract price from latest trade, fall back to ask quote
  const latestPrice =
    snapshot.latestTrade?.p   ??
    snapshot.latestQuote?.ap  ??
    snapshot.dailyBar?.c      ??
    null;

  if (latestPrice === null) {
    throw new Error("NO_PRICE_DATA");
  }

  // Previous close for change calculation
  const prevClose =
    snapshot.prevDailyBar?.c ??
    snapshot.dailyBar?.o     ??
    latestPrice;

  const change = latestPrice - prevClose;
  const changePercent = prevClose !== 0 ? (change / prevClose) * 100 : 0;

  // Daily high/low from bar data
  const dayHigh = snapshot.dailyBar?.h ?? null;
  const dayLow  = snapshot.dailyBar?.l ?? null;
  const volume  = snapshot.dailyBar?.v ?? null;

  const result = {
    symbol:         symbol.toUpperCase(),
    price:          round(latestPrice, 2),
    change:         round(change, 2),
    changePercent:  round(changePercent, 4),
    previousClose:  round(prevClose, 2),
    dayHigh:        dayHigh !== null ? round(dayHigh, 2) : null,
    dayLow:         dayLow  !== null ? round(dayLow,  2) : null,
    volume:         volume  ?? null,
    marketStatus:   getMarketStatus(),
    lastUpdated:    new Date().toISOString(),
    _cached:        false,
  };

  cacheSet(symbol, result);
  return result;
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function round(n, decimals) {
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}

function validateSymbol(s) {
  if (!s || typeof s !== "string") return false;
  const trimmed = s.trim().toUpperCase();
  // Standard US equity tickers: 1-5 letters, optionally with . for classes (BRK.A)
  return /^[A-Z]{1,5}(\.[A-Z]{1,2})?$/.test(trimmed) ? trimmed : false;
}

function errorResponse(statusCode, message, headers) {
  return {
    statusCode,
    headers,
    body: JSON.stringify({ error: message }),
  };
}

// ─── HANDLER ─────────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  const origin      = event.headers?.origin || event.headers?.Origin || "";
  const corsOrigin  = CONFIG.allowedOrigins.includes(origin)
    ? origin
    : CONFIG.allowedOrigins[0];

  const baseHeaders = {
    "Access-Control-Allow-Origin":  corsOrigin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age":       "86400",
    "Content-Type":                 "application/json",
    "X-Content-Type-Options":       "nosniff",
  };

  // Preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: baseHeaders, body: "" };
  }

  if (event.httpMethod !== "GET") {
    return errorResponse(405, "Method not allowed", baseHeaders);
  }

  const params = event.queryStringParameters || {};

  // ── BATCH MODE: ?symbols=NVDA,AAPL,MSFT ──────────────────────────────────
  if (params.symbols) {
    const rawSymbols = params.symbols.split(",").slice(0, CONFIG.batchMax);
    const symbols = rawSymbols.map(validateSymbol).filter(Boolean);

    if (symbols.length === 0) {
      return errorResponse(400, "No valid symbols provided.", baseHeaders);
    }

    const results = await Promise.allSettled(symbols.map(buildQuote));

    const quotes = {};
    results.forEach((r, i) => {
      const sym = symbols[i];
      if (r.status === "fulfilled") {
        quotes[sym] = r.value;
      } else {
        quotes[sym] = { symbol: sym, error: mapError(r.reason) };
      }
    });

    return {
      statusCode: 200,
      headers: { ...baseHeaders, "Cache-Control": "public, max-age=20" },
      body: JSON.stringify({ quotes, marketStatus: getMarketStatus() }),
    };
  }

  // ── SINGLE MODE: ?symbol=NVDA ─────────────────────────────────────────────
  const rawSymbol = params.symbol || params.s || "";
  const symbol    = validateSymbol(rawSymbol);

  if (!symbol) {
    return errorResponse(
      400,
      "Invalid symbol. Use 1–5 uppercase letters (e.g. NVDA, BRK.A).",
      baseHeaders
    );
  }

  try {
    const quote = await buildQuote(symbol);
    const isCached = quote._cached;
    delete quote._cached;

    return {
      statusCode: 200,
      headers: {
        ...baseHeaders,
        "Cache-Control": "public, max-age=20",
        "X-Cache":       isCached ? "HIT" : "MISS",
      },
      body: JSON.stringify(quote),
    };
  } catch (err) {
    const { status, message } = classifyError(err);
    return errorResponse(status, message, baseHeaders);
  }
};

// ─── ERROR CLASSIFICATION ─────────────────────────────────────────────────────

function mapError(err) {
  const { message } = classifyError(err);
  return message;
}

function classifyError(err) {
  const msg = err?.message || "UNKNOWN";
  if (msg === "INVALID_SYMBOL")    return { status: 404, message: "Symbol not found. Check the ticker and try again." };
  if (msg === "MISSING_CREDENTIALS") return { status: 503, message: "Market data service is not configured." };
  if (msg === "AUTH_ERROR")        return { status: 503, message: "Market data credentials are invalid." };
  if (msg === "TIMEOUT")           return { status: 504, message: "Market data request timed out. Try again." };
  if (msg === "NO_PRICE_DATA")     return { status: 404, message: "No price data available for this symbol." };
  if (msg.startsWith("ALPACA_"))   return { status: 502, message: "Market data provider returned an error." };
  console.error("[quote] Unhandled error:", msg);
  return { status: 502, message: "Failed to fetch market data. Please try again." };
}
