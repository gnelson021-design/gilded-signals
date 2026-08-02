#!/usr/bin/env python3
"""
Gilded Signals -- Weekly Brief HTML generator (Phase 1 prototype)

Reads:
  data/picks-{week}.json   (existing, LOCKED schema -- feeds scorecard.js, untouched)
  data/brief-{week}.json   (new, editorial content only)

Produces:
  The gb-week-panel HTML block, structurally identical to what is currently
  hand-authored -- same classes, same layout, same math.

This script does NOT touch index.html. It only renders a block of HTML to
stdout/file for review and diffing. Wiring it into the guarded patch step
(build_brief.py) is a later, separate step -- done only after this output
is verified against a live week.
"""
import json, html, sys

TIER_HEADS = {
    1: {
        "eyebrow": "Tier 1 &middot; Ranked by Conviction",
        "title": "Primary Picks",
        "sub": ('A specific this-week trigger &mdash; a target hike, a confirmed catalyst, '
                'no earnings conflict &mdash; not just a good year-long story. The first five '
                'are open to everyone. <b>Risk level</b> is a plain read on volatility, not '
                'quality &mdash; Low moves slowly, High can swing hard in a single session, so '
                'size accordingly. <b>Strong Buy</b> is the tier I have the most conviction in '
                'right now &mdash; setup, catalyst, and risk profile all line up. <b>Buy</b> '
                'still means a real, actionable setup, just without every box checked.')
    },
    2: {
        "eyebrow": "Tier 2 &middot; Strong Businesses, No Single-Week Trigger",
        "title": "Secondary Watchlist",
        "sub": ('High-quality companies with attractive setups, just without a single dated '
                'catalyst forcing the issue this specific week.')
    },
    3: {
        "eyebrow": "Tier 3 &middot; Real Upside, Real Near-Term Risk",
        "title": "Buy-On-Dip Candidates",
        "sub": ('The upside case is real here, but so is something concrete working against it '
                'right now &mdash; earnings risk, thin coverage, active regulatory or analyst '
                'headwinds. Sized and framed accordingly.')
    }
}

LIVE_STATUS_STYLE = """  <style>
  .gs-live-status{margin:24px 0 36px;padding:20px 22px;border-radius:12px;background:rgba(212,175,55,.04);border:1px solid rgba(212,175,55,.16);}
  .gs-live-status-lbl{font-family:monospace;font-size:.62rem;letter-spacing:.18em;text-transform:uppercase;color:var(--gold);}
  .gs-live-status-title{font-family:'Cormorant Garamond',serif;font-size:1.4rem;font-weight:600;color:var(--text-primary);margin:6px 0 4px;}
  .gs-live-status-sub{font-size:.8rem;color:var(--text-secondary);margin-bottom:16px;max-width:620px;}
  .gs-live-status-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px;}
  .gs-live-status-item{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:10px 12px;border-radius:8px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);}
  .gs-live-status-sym{font-family:monospace;font-weight:700;font-size:.82rem;color:var(--text-primary);}
  .gs-live-status-badge{font-family:monospace;font-size:.6rem;letter-spacing:.05em;text-transform:uppercase;padding:3px 8px;border-radius:999px;white-space:nowrap;}
  .gs-live-status-badge.waiting{color:#9a9690;background:rgba(154,150,144,.12);}
  .gs-live-status-badge.triggered{color:#e8ca7a;background:rgba(212,175,55,.14);}
  .gs-live-status-badge.watch-closely{color:#e8ca7a;background:rgba(212,175,55,.14);}
  .gs-live-status-badge.buy-zone{color:#3ECA7A;background:rgba(62,202,122,.14);}
  .gs-live-status-badge.completed{color:#B0ABA5;background:rgba(176,171,165,.12);}
  .gs-live-status-badge.no-entry{color:#7a7770;background:rgba(122,119,112,.1);}
  .gs-live-status-badge.breakout-pending{color:#7ba7c9;background:rgba(94,150,196,.12);}
  .gs-live-status-badge.breakout-triggered{color:#5eb3e8;background:rgba(94,179,232,.18);}
  .gs-live-status-legend{margin-top:16px;padding-top:14px;border-top:1px solid rgba(255,255,255,.06);font-size:.72rem;line-height:1.6;color:var(--text-muted);}
  .gs-live-status-legend b{color:var(--text-secondary);font-weight:600;}
  .gs-live-status-ret{font-family:monospace;font-size:.76rem;font-weight:600;}
  .gs-live-status-loading{grid-column:1/-1;color:var(--text-muted);font-family:monospace;font-size:.7rem;letter-spacing:.1em;text-transform:uppercase;padding:10px 0;}
  </style>"""


def clamp(v, lo=0, hi=100):
    return max(lo, min(hi, v))


def pct_position(target, lo, hi):
    if hi == lo:
        return 0
    return clamp(round((target - lo) / (hi - lo) * 100, 1))


def pct_change(target, current):
    if current == 0:
        return 0.0
    return round((target - current) / current * 100, 2)


def fmt_pct(p):
    sign = "+" if p >= 0 else "-"
    return f"{sign}{abs(p):.2f}%"


def render_ladder(ticker, ladder, data_min, data_max):
    cur = ladder["currentPrice"]
    cur_disp = ladder["currentPriceDisplay"]
    asof = ladder["asOfDate"]
    avg = ladder["avg"]
    avg_disp = ladder["avgDisplay"]
    avg_pct = pct_change(avg, cur)
    avg_cls = "up" if avg_pct >= 0 else "dn"
    source_line = html.escape(ladder["sourceLine"], quote=False).replace("&amp;", "&")

    if ladder.get("partial"):
        return f'''<div class="tl tl-partial" id="tl-{ticker}" data-symbol="{ticker}">
          <div class="tl-head">
            <div><div class="tl-curlabel">Current <span class="tl-live-badge">{asof}</span></div><div class="tl-cur">{cur_disp}</div></div>
            <div class="tl-avgwrap"><div class="tl-avglabel">Avg Target</div><div class="tl-avg {avg_cls}">{avg_disp}</div><div class="tl-curlabel {avg_cls}">{fmt_pct(avg_pct)}</div></div>
          </div>
          <div class="tl-foot">{source_line}</div>
        </div>'''

    mn, mx = ladder["min"], ladder["max"]
    mn_disp, mx_disp = ladder["minDisplay"], ladder["maxDisplay"]
    cur_left = pct_position(cur, mn, mx)
    avg_left = pct_position(avg, mn, mx)
    min_pct = pct_change(mn, cur)
    max_pct = pct_change(mx, cur)
    min_cls = "up" if min_pct >= 0 else "dn"
    max_cls = "up" if max_pct >= 0 else "dn"

    return f'''<div class="tl" id="tl-{ticker}" data-symbol="{ticker}" data-min="{mn}" data-max="{mx}">
          <div class="tl-head">
            <div><div class="tl-curlabel">Current <span class="tl-live-badge">{asof}</span></div><div class="tl-cur">{cur_disp}</div></div>
            <div class="tl-avgwrap"><div class="tl-avglabel">Avg Target</div><div class="tl-avg {avg_cls}">{avg_disp}</div><div class="tl-curlabel {avg_cls}">{fmt_pct(avg_pct)}</div></div>
          </div>
          <div class="tl-track">
            <div class="tl-cur-marker" style="left:{cur_left}%"><span class="tl-cur-marker-live">{cur_disp}</span></div>
            <div class="tl-dot" style="left:{avg_left}%"><span class="tl-dot-lbl">Avg</span></div>
          </div>
          <div class="tl-ends"><span>Min <span class="v {min_cls}">{mn_disp} &middot; {fmt_pct(min_pct)}</span></span><span>Max <span class="v {max_cls}">{mx_disp} &middot; {fmt_pct(max_pct)}</span></span></div>
          <div class="tl-foot">{source_line}</div>
        </div>'''


def render_pick(pick, brief_pick):
    rank = f'{pick["rank"]:02d}'
    ticker = pick["ticker"]
    company = pick["company"]
    conv_label = brief_pick["convictionLabel"]
    conv_cls = brief_pick["convictionClass"]
    risk_label = brief_pick["riskLabel"]
    risk_cls = brief_pick["riskClass"]
    thesis = brief_pick["thesis"]
    catalyst_html = brief_pick["catalystHtml"]
    ladder_html = render_ladder(ticker, brief_pick["ladder"], pick.get("priceAtPublish"), None)

    dip_block = ""
    if brief_pick.get("dipHtml"):
        dip_block = f'\n        <div class="gb-dip">Where I&rsquo;m buying: <b>{brief_pick["dipHtml"]}</b></div>'

    watch_block = ""
    if brief_pick.get("watchHtml"):
        watch_block = f'\n        <div class="gb-watch">Watching: <b>{brief_pick["watchHtml"]}</b></div>'

    return f'''  <!-- {ticker} -->
  <div class="gb-pick">
    <div class="gb-pick-row">
      <div class="gb-rank">{rank}</div>
      <div>
        <div class="gb-scoretop">
          <div class="gb-pick-head"><span class="gb-ticker">{ticker}</span><span class="gb-company">{company}</span></div>
          <span class="gb-conviction {conv_cls}">{conv_label}</span><span class="gb-risk {risk_cls}">{risk_label}</span>
        </div>
        <p class="gb-thesis">{thesis}</p>
        <div class="gb-catalyst"><b>Catalyst:</b> {catalyst_html}</div>
        {ladder_html}{dip_block}{watch_block}
      </div>
    </div>
  </div>'''


def render_week_panel(picks_data, brief_data, is_live=True):
    week = picks_data["weekOf"]
    panel_id = f"gb-week-{week}"
    data_live = "true" if is_live else "false"

    by_tier = {1: [], 2: [], 3: []}
    for p in picks_data["picks"]:
        by_tier[p["tier"]].append(p)

    tiers_html = []
    for tier_num in (1, 2, 3):
        head = TIER_HEADS[tier_num]
        picks_html = "\n\n".join(
            render_pick(p, brief_data["picks"][p["ticker"]]) for p in by_tier[tier_num]
        )
        tiers_html.append(f'''  <!-- ============ TIER: {head["title"].upper()} ============ -->
  <div class="gb-tier-head">
    <div class="gb-tier-eyebrow">{head["eyebrow"]}</div>
    <h2 class="gb-tier-title">{head["title"]}</h2>
    <p class="gb-tier-sub">{head["sub"]}</p>
  </div>

{picks_html}''')

    all_tiers = "\n\n  <!-- ============================================ -->\n\n".join(tiers_html)

    return f'''    <div class="gb-week-panel" id="{panel_id}" data-live="{data_live}">
    <div class="gb-dateline">{brief_data["dateline"]}</div>

  <div class="gb-rule"></div>

  <p class="gb-lead">{brief_data["lead"]}</p>

  <!-- ============ RESULTS CROSSLINK ============ -->
  <div class="gb-crosslink">
    <span class="gb-crosslink-lbl">Last Week&rsquo;s Results</span>
    <a id="gb-lastweek-link" onclick="{brief_data["crosslinkOnclick"]}">{brief_data["crosslinkText"]}</a>
  </div>
{LIVE_STATUS_STYLE}

  <!-- ============ LIVE SCORECARD STATUS ============ -->
  <div class="gs-live-status" id="gs-live-status" data-live="true" data-week="{week}">
    <span class="gs-live-status-lbl">Live &middot; Updated Continuously</span>
    <h3 class="gs-live-status-title">This Week&rsquo;s Board, Right Now</h3>
    <p class="gs-live-status-sub">Where each pick actually stands &mdash; entry zones triggered, still waiting, or off the table this week. This is the same engine that grades the Friday scorecard; nothing here is estimated. Red % reflects movement since that entry price was published, not a loss &mdash; several of these are exactly where I&rsquo;m still buying.</p>
    <div class="gs-live-status-grid" id="gs-live-status-grid">
      <div class="gs-live-status-loading">Loading live status&hellip;</div>
    </div>
    <div class="gs-live-status-legend" id="gs-live-status-legend">
      <b>Buy Zone</b> &mdash; price is currently inside a published entry range. Same accumulation zones described in each pick&rsquo;s write-up below.<br>
      <b>Triggered</b> &mdash; a published entry zone has been reached. Return shown is measured from that entry, not from today&rsquo;s price &mdash; it does not imply the stock remains a buy at the current level.<br>
      <b>Waiting for Entry</b> &mdash; no published zone has been reached yet this week.<br>
      <b>Breakout Pending / Breakout Triggered</b> &mdash; MSTR only. Tracks a confirmed close above a published level, a different mechanic from the dip-entry zones above.<br>
      <b>No Setup This Week</b> &mdash; no entry was planned this week (earnings risk, unreliable data, etc.) &mdash; never a fabricated zone.
    </div>
  </div>

{all_tiers}

  </div>'''


if __name__ == '__main__':
    picks = json.load(open('/home/claude/current-repo/picks-2026-07-20.json'))
    brief = json.load(open('/home/claude/migration/brief-2026-07-20.EXTRACTED.json'))
    out = render_week_panel(picks, brief, is_live=True)
    with open('/home/claude/migration/gb-week-2026-07-20.REGENERATED.html', 'w', encoding='utf-8') as f:
        f.write(out)
    print(f"Wrote {len(out)} chars")
