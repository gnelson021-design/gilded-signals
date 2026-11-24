// engine/lib/http.js
// Fetch with timeout, per-host rate limiting, and bounded retries.
// Never logs URLs with credentials: API keys travel in headers (Alpaca) or
// are stripped from the logged URL (Finnhub `token=`).

'use strict';

const DEFAULTS = { timeoutMs: 15000, retries: 3, backoffMs: 1000 };

// Minimum spacing between requests per host (ms). Alpaca Basic ≈ 200/min,
// Finnhub free ≈ 60/min — both kept safely under the published limits.
const HOST_SPACING = {
  'data.alpaca.markets': 330,
  'api.alpaca.markets': 330,
  'paper-api.alpaca.markets': 330,
  'finnhub.io': 1100,
  'api.anthropic.com': 1500,
};
const nextSlot = new Map();
const stats = { requests: 0, retries: 0, failures: 0, byHost: {} };

function safeUrl(url) {
  return String(url).replace(/([?&]token=)[^&]+/i, '$1***');
}

async function waitForSlot(host) {
  const spacing = HOST_SPACING[host] || 0;
  if (!spacing) return;
  const now = Date.now();
  const slot = Math.max(now, nextSlot.get(host) || 0);
  nextSlot.set(host, slot + spacing);
  if (slot > now) await new Promise((r) => setTimeout(r, slot - now));
}

class HttpError extends Error {
  constructor(message, status, url) {
    super(message);
    this.status = status;
    this.url = url;
  }
}

async function getJSON(url, opts = {}) {
  const { headers = {}, timeoutMs, retries, backoffMs } = { ...DEFAULTS, ...opts };
  const host = new URL(url).host;
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await waitForSlot(host);
    stats.requests++;
    stats.byHost[host] = (stats.byHost[host] || 0) + 1;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const init = { headers, signal: ctrl.signal };
      if (opts.body != null) { init.method = 'POST'; init.body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body); }
      const res = await (opts.fetchImpl || fetch)(url, init);
      if (res.ok) return await res.json();
      const retryable = res.status === 429 || res.status >= 500; // incl. 529 overloaded
      lastErr = new HttpError(`HTTP ${res.status} ${safeUrl(url).split('?')[0]}`, res.status, safeUrl(url));
      if (!retryable) break;
      const ra = Number(res.headers && res.headers.get && res.headers.get('retry-after'));
      if (attempt < retries) {
        stats.retries++;
        await new Promise((r) => setTimeout(r, isFinite(ra) && ra > 0 ? ra * 1000 : backoffMs * Math.pow(3, attempt)));
      }
    } catch (e) {
      lastErr = e instanceof HttpError ? e : new HttpError(`${e.name === 'AbortError' ? 'timeout' : e.message} ${safeUrl(url).split('?')[0]}`, 0, safeUrl(url));
      if (attempt < retries) {
        stats.retries++;
        await new Promise((r) => setTimeout(r, backoffMs * Math.pow(3, attempt)));
      }
    } finally {
      clearTimeout(t);
    }
  }
  stats.failures++;
  throw lastErr;
}

module.exports = { getJSON, HttpError, stats, safeUrl, HOST_SPACING };
