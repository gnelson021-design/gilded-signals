/* =====================================================================
   GILDED SIGNALS — SIGNED ACCESS TOKEN (shared helper)
   HMAC-SHA256 signed token proving an active subscription, carried in
   an HttpOnly cookie. No external JWT library -- this repo's only
   dependency is "stripe", and a hand-rolled signed token gives the
   same tamper-proof guarantee for a single-claim payload (email + exp)
   without adding one.
   Token format: base64url(JSON payload) + "." + hex HMAC-SHA256
   Requires env var GS_ACCESS_TOKEN_SECRET (Netlify dashboard only).
   ===================================================================== */
'use strict';
const crypto = require('crypto');

const COOKIE_NAME = 'gs_session';
const TOKEN_LIFETIME_SECONDS = 24 * 60 * 60; // 24h, refreshed on each valid check

function secret() {
  const s = process.env.GS_ACCESS_TOKEN_SECRET;
  if (!s) throw new Error('GS_ACCESS_TOKEN_SECRET not configured');
  return s;
}

function b64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(input) {
  input = input.replace(/-/g, '+').replace(/_/g, '/');
  while (input.length % 4) input += '=';
  return Buffer.from(input, 'base64').toString('utf8');
}

function sign(email) {
  const payload = JSON.stringify({
    email: email,
    exp: Math.floor(Date.now() / 1000) + TOKEN_LIFETIME_SECONDS,
  });
  const encoded = b64url(payload);
  const sig = crypto.createHmac('sha256', secret()).update(encoded).digest('hex');
  return encoded + '.' + sig;
}

function verify(token) {
  if (!token || token.indexOf('.') === -1) return null;
  const parts = token.split('.');
  const encoded = parts[0];
  const sig = parts[1];
  if (!encoded || !sig) return null;

  const expected = crypto.createHmac('sha256', secret()).update(encoded).digest('hex');
  const a = Buffer.from(sig, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let payload;
  try {
    payload = JSON.parse(b64urlDecode(encoded));
  } catch (e) {
    return null;
  }
  if (!payload || !payload.email || !payload.exp) return null;
  if (Math.floor(Date.now() / 1000) >= payload.exp) return null;
  return payload; // { email, exp }
}

function serializeCookie(token) {
  return (
    COOKIE_NAME + '=' + token +
    '; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=' + TOKEN_LIFETIME_SECONDS
  );
}

function clearCookie() {
  return COOKIE_NAME + '=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0';
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(';').forEach(function (pair) {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v);
  });
  return out;
}

module.exports = { COOKIE_NAME, sign, verify, serializeCookie, clearCookie, parseCookies };
