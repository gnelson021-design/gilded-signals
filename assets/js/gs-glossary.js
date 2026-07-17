/* =====================================================================
   GILDED SIGNALS -- GLOSSARY / TAP-TO-DEFINE ENGINE
   One shared source of truth for jargon definitions across the site.
   Works on static markup and on content rendered later by
   gs-scanner.js / gs-scorecard-live.js via event delegation.
   -----------------------------------------------------------------------
   Usage:
     Icon trigger (labels):     <span class="gs-term-icon" data-term="rsi" tabindex="0" role="button">i</span>
     Underline trigger (prose): <span class="gs-term-underline" data-term="rsi" tabindex="0" role="button">RSI</span>
     Inline trigger (dynamic content, no glossary entry needed):
       <span class="gs-term-icon" data-tip="Some sentence." tabindex="0" role="button">i</span>
   ===================================================================== */
(function () {
  var GS_GLOSSARY = {
    rsi: {
      term: 'RSI',
      def: 'Measures whether a stock has moved too far, too fast \u2014 a 0\u2013100 reading based on recent price swings.',
      why: 'Extreme readings often mean the easy move is already behind you, whether that\u2019s a rally or a selloff.',
      use: 'I never trade RSI alone. I check it alongside the broader trend, how heavily the stock is trading compared to normal, price structure, and the catalyst before a conviction call changes.'
    },
    ema: {
      term: 'EMA',
      def: 'An average price that leans on recent days more than older ones, so it turns faster than a simple average when a trend shifts.',
      why: 'It\u2019s a cleaner read on the real trend than the raw price, which jumps around day to day.',
      use: 'I use EMA to confirm a trend is real before sizing into it \u2014 not to time the exact day.'
    },
    pe: {
      term: 'P/E (Price-to-Earnings)',
      def: 'How many dollars investors are paying for each dollar the company earns in a year.',
      why: 'A high P/E means the market\u2019s already pricing in strong growth \u2014 good news has to keep showing up, or the stock gets punished on a miss.',
      use: 'I weigh P/E against growth and industry, not on its own \u2014 a "high" number means something different for a chipmaker than a bank.'
    },
    analystconsensus: {
      term: 'Analyst Consensus',
      def: 'The average price target across the Wall Street analysts who cover a stock.',
      why: 'It\u2019s a snapshot of professional sentiment, not a prediction \u2014 targets shift constantly as new information comes in.',
      use: 'I treat it as one data point among many, and I always note the date it was pulled, since it\u2019s a manual snapshot, not a live feed.'
    },
    grossmargin: {
      term: 'Gross Margin',
      def: 'The percentage of revenue left after direct production costs, before overhead like R&amp;D and marketing.',
      why: 'It shows how profitable the core business actually is \u2014 a shrinking margin can be a real warning sign, or just a temporary shift in what the company\u2019s selling.',
      use: 'I dig into why a margin moved before reacting to it. A dip from a deliberate strategic shift isn\u2019t the same red flag as one from rising costs eating into profit.'
    },
    'signal-strength': {
      term: 'Signal Strength',
      def: 'A 0\u2013100 score measuring current momentum and technical conditions over roughly the last 1\u201320 trading sessions.',
      why: 'It\u2019s a fast read on whether momentum currently favors buyers or sellers for a given name.',
      use: 'It\u2019s one of the first things I check when scanning, but never the deciding factor \u2014 it\u2019s not a probability of profit, and I always pair it with the setup and catalyst.'
    },
    strongbuy: {
      term: 'Strong Buy',
      def: 'Our highest-conviction tier.',
      why: 'It flags the picks where I have the most confidence right now, relative to everything else published.',
      use: 'Setup, catalyst, and risk profile all line up. Not currently shown as a tap-to-define badge on the site \u2014 kept here as the single source of truth if that ever changes.'
    },
    buy: {
      term: 'Buy',
      def: 'A real, actionable setup, evaluated the same way as every other pick.',
      why: 'It still means I see a legitimate opportunity \u2014 just without every box checked the way a Strong Buy does.',
      use: 'Sized and tracked identically to Strong Buy picks. Not currently shown as a tap-to-define badge on the site \u2014 kept here as the single source of truth if that ever changes.'
    }
  };

  var POPOVER_ID = 'gs-glossary-popover';
  var currentTrigger = null;

  function ensurePopover() {
    var el = document.getElementById(POPOVER_ID);
    if (el) return el;
    el = document.createElement('div');
    el.id = POPOVER_ID;
    el.className = 'gs-glossary-popover';
    el.setAttribute('role', 'tooltip');
    document.body.appendChild(el);
    return el;
  }

  function buildContent(trigger) {
    var inlineTip = trigger.getAttribute('data-tip');
    if (inlineTip) {
      return '<div class="gs-gp-body">' + inlineTip + '</div>';
    }
    var termKey = trigger.getAttribute('data-term');
    var entry = termKey && GS_GLOSSARY[termKey];
    if (!entry) return null;

    var html = '<div class="gs-gp-term">' + entry.term + '</div>';
    html += '<div class="gs-gp-body">' + entry.def + '</div>';
    if (entry.why) {
      html += '<div class="gs-gp-lbl">Why It Matters</div><div class="gs-gp-body">' + entry.why + '</div>';
    }
    if (entry.use) {
      html += '<div class="gs-gp-lbl">How Gilded Signals Uses It</div><div class="gs-gp-body">' + entry.use + '</div>';
    }
    return html;
  }

  function closePopover() {
    var pop = document.getElementById(POPOVER_ID);
    if (pop) pop.classList.remove('open');
    currentTrigger = null;
  }

  function openPopover(trigger) {
    var content = buildContent(trigger);
    if (!content) return;
    var pop = ensurePopover();
    pop.innerHTML = content;
    pop.classList.add('open');

    var r = trigger.getBoundingClientRect();
    var top = window.scrollY + r.bottom + 8;
    var left = window.scrollX + r.left;
    var maxLeft = window.scrollX + document.documentElement.clientWidth - 286;
    if (left > maxLeft) left = Math.max(window.scrollX + 8, maxLeft);
    pop.style.top = top + 'px';
    pop.style.left = left + 'px';
  }

  document.addEventListener('click', function (e) {
    var trigger = e.target.closest('.gs-term-icon, .gs-term-underline');
    if (!trigger) {
      if (!e.target.closest('.gs-glossary-popover')) closePopover();
      return;
    }
    e.stopPropagation();
    if (trigger === currentTrigger) {
      closePopover();
      return;
    }
    currentTrigger = trigger;
    openPopover(trigger);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') {
      var t = document.activeElement;
      if (t && (t.classList.contains('gs-term-icon') || t.classList.contains('gs-term-underline'))) {
        e.preventDefault();
        t.click();
      }
    }
    if (e.key === 'Escape') closePopover();
  });

  window.addEventListener('scroll', closePopover, true);
  window.addEventListener('resize', closePopover);
})();
