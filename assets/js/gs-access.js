/* =====================================================================
   GILDED SIGNALS — ACCESS GATE (standalone)
   - Counts compares in localStorage (survives refresh)
   - After FREE_LIMIT, shows subscribe modal
   - Allowlisted emails (hashed) unlock the device permanently
   - Other emails are captured to Kit but stay gated
   Wraps window.gsRunCompare from OUTSIDE. Does NOT modify gs-scanner.js.
   ===================================================================== */
(function () {
  'use strict';

  var FREE_LIMIT = 5;

  /* SHA-256 of lowercased allowlisted emails.
     To change later: hash the new email and replace/extend this list. */
  var ALLOW = [
    'fe382ddadde1ee3d4909bf15f2a977cdf10a486a4742187b944ab3a83b2658fc', // gnelson021@gmail.com
    '9fbd58c33e0746ca2801b66295eef4c5baf12641fcb0a5ffde2ec23780bcba39'  // gildedsignals.support@gmail.com
  ];

  /* Kit (ConvertKit) form id for capturing non-allowlisted leads. */
  var KIT_FORM_ID = '9477301';

  var LS_COUNT = 'gs_scan_count';
  var LS_UNLOCK = 'gs_unlocked';

  /* ---------- localStorage helpers (guarded) ---------- */
  function getCount() {
    try { return parseInt(localStorage.getItem(LS_COUNT) || '0', 10) || 0; }
    catch (e) { return 0; }
  }
  function setCount(n) {
    try { localStorage.setItem(LS_COUNT, String(n)); } catch (e) {}
  }
  function isUnlocked() {
    try { return localStorage.getItem(LS_UNLOCK) === '1'; } catch (e) { return false; }
  }
  function setUnlocked() {
    try { localStorage.setItem(LS_UNLOCK, '1'); } catch (e) {}
    try { document.dispatchEvent(new CustomEvent('gs:unlocked')); } catch (e) {}
  }

  /* ---------- Stripe success redirect: verify with the server, then unlock ----------
     The old version unlocked purely because "?checkout=success" was present in the
     URL, with no server check at all. This confirms the real, paid Checkout Session
     with Stripe before unlocking anything. */
  function checkCheckoutSuccess() {
    try {
      var params = new URLSearchParams(window.location.search);
      if (params.get('checkout') === 'success') {
        var sessionId = params.get('session_id');
        params.delete('checkout');
        params.delete('session_id');
        var qs = params.toString();
        var cleanUrl = window.location.pathname + (qs ? '?' + qs : '') + window.location.hash;
        window.history.replaceState(null, '', cleanUrl);
        if (sessionId) {
          fetch('/.netlify/functions/verify-access', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: sessionId })
          }).then(function (r) { return r.json(); }).then(function (d) {
            if (d && d.active) setUnlocked();
          }).catch(function () {});
        }
      }
    } catch (e) {}
  }

  /* ---------- SHA-256 (Web Crypto) ---------- */
  function sha256Hex(str) {
    var enc = new TextEncoder();
    return crypto.subtle.digest('SHA-256', enc.encode(str)).then(function (buf) {
      var bytes = new Uint8Array(buf), hex = '';
      for (var i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
      return hex;
    });
  }

  /* ---------- update the visible "Free scans: N" counters ---------- */
  function updateCounters() {
    var remaining = isUnlocked() ? '\u221E' : Math.max(0, FREE_LIMIT - getCount());
    ['scanCount', 'navScanCount'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.textContent = remaining;
    });
  }

  /* ---------- modal ---------- */
  function injectModalCss() {
    if (document.getElementById('gsAccessCss')) return;
    var css =
      '.gsx-overlay{position:fixed;inset:0;z-index:99999;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.78);backdrop-filter:blur(6px);padding:20px}' +
      '.gsx-overlay.show{display:flex}' +
      '.gsx-modal{position:relative;width:100%;max-width:440px;background:linear-gradient(180deg,#161616,#0c0c0c);border:1px solid rgba(201,162,75,.35);border-radius:18px;padding:34px 30px;box-shadow:0 30px 80px rgba(0,0,0,.7);animation:gsxIn .3s ease}' +
      '@keyframes gsxIn{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}' +
      '.gsx-close{position:absolute;top:14px;right:16px;background:transparent;border:none;color:#7a7770;font-size:1.5rem;cursor:pointer;line-height:1;transition:color .15s}' +
      '.gsx-close:hover{color:#e8ca7a}' +
      '.gsx-eyebrow{font-family:monospace;font-size:.6rem;letter-spacing:.24em;text-transform:uppercase;color:#c9a24b;margin-bottom:12px}' +
      '.gsx-title{font-family:"Cormorant Garamond",serif;font-size:1.85rem;font-weight:600;color:#f0ece2;line-height:1.15;margin-bottom:10px}' +
      '.gsx-title em{font-style:italic;color:#e8ca7a}' +
      '.gsx-sub{font-size:.86rem;line-height:1.6;color:#9a9690;margin-bottom:22px}' +
      '.gsx-input{width:100%;background:#0c0c0c;border:1px solid rgba(201,162,75,.25);border-radius:10px;padding:13px 15px;color:#f0ece2;font-family:monospace;font-size:.9rem;margin-bottom:12px;transition:border-color .15s}' +
      '.gsx-input:focus{outline:none;border-color:#c9a24b}' +
      '.gsx-btn{width:100%;background:linear-gradient(90deg,#c9a24b,#e7c879);color:#0c0c0c;border:none;border-radius:10px;padding:14px;font-family:"DM Sans",sans-serif;font-weight:700;font-size:.8rem;letter-spacing:.06em;text-transform:uppercase;cursor:pointer;transition:transform .12s,box-shadow .15s}' +
      '.gsx-btn:hover{transform:translateY(-1px);box-shadow:0 8px 24px rgba(201,162,75,.3)}' +
      '.gsx-btn:disabled{opacity:.6;cursor:default;transform:none;box-shadow:none}' +
      '.gsx-msg{font-size:.78rem;text-align:center;margin-top:14px;min-height:18px}' +
      '.gsx-msg.ok{color:#4ecb8d}.gsx-msg.err{color:#d97a7a}' +
      '.gsx-perks{list-style:none;padding:0;margin:0 0 22px}' +
      '.gsx-perks li{font-size:.8rem;color:#b8b4ac;padding:6px 0 6px 22px;position:relative}' +
      '.gsx-perks li::before{content:"\\2713";position:absolute;left:0;color:#c9a24b;font-weight:700}';
    var st = document.createElement('style');
    st.id = 'gsAccessCss';
    st.textContent = css;
    document.head.appendChild(st);
  }

  function buildModal() {
    if (document.getElementById('gsxOverlay')) return;
    injectModalCss();
    var ov = document.createElement('div');
    ov.className = 'gsx-overlay';
    ov.id = 'gsxOverlay';
    ov.innerHTML =
      '<div class="gsx-modal">' +
      '<button class="gsx-close" id="gsxClose" aria-label="Close">&times;</button>' +
      '<div class="gsx-eyebrow">Gilded Signals \u00b7 Full Access</div>' +
      '<div class="gsx-title">You\u2019ve used your <em>5 free scans</em></div>' +
      '<div class="gsx-sub">Subscribe for unlimited Market Scanner access plus daily market news and intelligence \u2014 delivered to your inbox.</div>' +
      '<ul class="gsx-perks">' +
      '<li>Unlimited stock &amp; crypto comparisons</li>' +
      '<li>Daily market news &amp; AI infrastructure briefs</li>' +
      '<li>Live signal grid &amp; Gilded Score access</li>' +
      '</ul>' +
      '<input class="gsx-input" id="gsxEmail" type="email" placeholder="you@email.com" autocomplete="email" />' +
      '<button class="gsx-btn" id="gsxSubmit">Subscribe Now \u2192</button>' +
      '<div class="gsx-msg" id="gsxMsg"></div>' +
      '</div>';
    document.body.appendChild(ov);

    document.getElementById('gsxClose').addEventListener('click', hideModal);
    ov.addEventListener('click', function (e) { if (e.target === ov) hideModal(); });
    document.getElementById('gsxSubmit').addEventListener('click', onSubmit);
    document.getElementById('gsxEmail').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') onSubmit();
    });
  }
  function showModal() { buildModal(); document.getElementById('gsxOverlay').classList.add('show'); }
  function hideModal() { var o = document.getElementById('gsxOverlay'); if (o) o.classList.remove('show'); }

  function setMsg(text, kind) {
    var m = document.getElementById('gsxMsg');
    if (!m) return;
    m.textContent = text || '';
    m.className = 'gsx-msg' + (kind ? ' ' + kind : '');
  }

  function goToStripe(email) {
    var btn = document.getElementById('gsxSubmit');
    if (btn) { btn.disabled = true; btn.textContent = 'Redirecting\u2026'; }
    fetch('/.netlify/functions/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email || '' })
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.url) { window.location.href = d.url; }
        else { setMsg('Could not start checkout. Please try again.', 'err'); if (btn) { btn.disabled = false; btn.textContent = 'Subscribe Now \u2192'; } }
      })
      .catch(function () {
        setMsg('Could not reach checkout. Please try again.', 'err');
        if (btn) { btn.disabled = false; btn.textContent = 'Subscribe Now \u2192'; }
      });
  }

  function verifyEmail(email) {
    return fetch('/.netlify/functions/verify-access', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email })
    }).then(function (r) { return r.json(); })
      .then(function (d) { return !!(d && d.active); })
      .catch(function () { return false; });
  }

  function onSubmit() {
    var inp = document.getElementById('gsxEmail');
    var btn = document.getElementById('gsxSubmit');
    var email = (inp && inp.value || '').trim().toLowerCase();
    if (!email || email.indexOf('@') === -1 || email.indexOf('.') === -1) {
      setMsg('Please enter a valid email.', 'err');
      return;
    }
    btn.disabled = true;
    setMsg('Checking\u2026', '');

    sha256Hex(email).then(function (hash) {
      if (ALLOW.indexOf(hash) !== -1) {
        setUnlocked();
        updateCounters();
        setMsg('Access granted. Welcome back.', 'ok');
        setTimeout(function () { hideModal(); btn.disabled = false; }, 900);
        return;
      }
      // Not allowlisted -- check for an existing active subscription first,
      // so a returning subscriber on a new device isn't sent to pay again.
      verifyEmail(email).then(function (active) {
        if (active) {
          setUnlocked();
          updateCounters();
          setMsg('Welcome back. Access restored.', 'ok');
          setTimeout(function () { hideModal(); btn.disabled = false; }, 900);
          return;
        }
        submitToKit(email).catch(function () { /* silent — proceed to Stripe regardless */ });
        setMsg('Taking you to secure checkout\u2026', 'ok');
        setTimeout(function () { goToStripe(email); }, 600);
      });
    }).catch(function () {
      setMsg('Something went wrong. Try again.', 'err');
      btn.disabled = false;
    });
  }

  function submitToKit(email) {
    var url = 'https://app.kit.com/forms/' + KIT_FORM_ID + '/subscriptions';
    var fd = new FormData();
    fd.append('email_address', email);
    return fetch(url, { method: 'POST', body: fd, headers: { 'Accept': 'application/json' } });
  }

  /* ---------- gate: wrap gsRunCompare from outside ---------- */
  function allowedToRun() {
    return isUnlocked() || getCount() < FREE_LIMIT;
  }

  function installWrapper() {
    if (typeof window.gsRunCompare !== 'function') return false;
    if (window.gsRunCompare.__gated) return true;

    var original = window.gsRunCompare;
    var wrapped = function () {
      if (!allowedToRun()) { showModal(); return; }
      // Count this compare (skip counting for unlocked users).
      if (!isUnlocked()) { setCount(getCount() + 1); updateCounters(); }
      return original.apply(this, arguments);
    };
    wrapped.__gated = true;
    window.gsRunCompare = wrapped;
    return true;
  }

  /* gsRunCompare is defined by gs-scanner.js; it may load after us.
     Poll briefly until it exists, then wrap once. */
  function init() {
    checkCheckoutSuccess();
    updateCounters();
    if (installWrapper()) return;
    var tries = 0;
    var iv = setInterval(function () {
      tries++;
      if (installWrapper() || tries > 40) clearInterval(iv);
    }, 100);
  }

  window.gsGoToStripe = goToStripe;
  window.gsIsUnlocked = isUnlocked;
  window.gsShowAccessModal = showModal;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
