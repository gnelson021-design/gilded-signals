#!/usr/bin/env python3
"""
Gilded Signals -- Results freeze/archive generator (component 2 of 3)

Takes the JSON returned by GET /.netlify/functions/scorecard?week={week}
(scorecard.js -- read-only contract, never modified) once that response's
gradingComplete flag is true, and bakes it into the permanent static
gr-week-panel archive format: real stat boxes, a per-pick score row for
every published pick (including no_entry / never-triggered / data-gap
picks shown honestly as "Not Scored", never silently dropped), and a
closing narrative.

leadSummary and scorefootNarrative are short editorial narrative strings
describing the week in Gilded Signals voice -- drafted from the computed
numbers each Friday, same as thesis/catalyst copy is drafted for the brief.

Does not touch index.html. Writes/returns an HTML string only.
"""
import json


def fmt_pct_entity(p, decimals=2):
    """Site convention for the results page: HTML minus entity, not a hyphen."""
    if p is None:
        return "&mdash;"
    sign = "+" if p >= 0 else "&minus;"
    return f"{sign}{abs(p):.{decimals}f}%"


def render_score_row(pick):
    rank = f'{pick["rank"]:02d}'
    ticker = pick["ticker"]
    company = pick["company"]
    status = pick["status"]

    if status in ("closed_win", "closed_loss"):
        cls = "up" if status == "closed_win" else "dn"
        label = "Win" if status == "closed_win" else "Loss"
        pct = fmt_pct_entity(pick["returnPct"])
        return (f'<div class="gb-score"><div class="gb-rank">{rank}</div><div>'
                f'<div class="gb-scoretop"><div class="gb-pick-head">'
                f'<span class="gb-ticker">{ticker}</span><span class="gb-company">{company}</span></div>'
                f'<span class="gb-scorepct {cls}">{pct}</span></div>'
                f'<div class="gb-scoreline">Result: <b class="{cls}">{label}</b> &middot; '
                f'Monday open &rarr; Friday close</div></div></div>')

    # no_entry_this_week / waiting_for_entry (never triggered) / data_unavailable
    # -- always shown, never dropped, always explained.
    reason_map = {
        "no_entry_this_week": pick.get("note") or "No entry was planned for this name this week.",
        "waiting_for_entry": pick.get("note") or "Published entry zone was never reached this week.",
        "data_unavailable": pick.get("note") or "Reliable price data could not be confirmed for this ticker this week.",
    }
    note = reason_map.get(status, pick.get("note") or "Not included in this week's scored results.")
    note = note.rstrip()
    if not note.endswith("statistics."):
        note = note + " Shown here for the permanent record; not counted in the week&rsquo;s statistics."
    return (f'<div class="gb-score"><div class="gb-rank">{rank}</div><div>'
            f'<div class="gb-scoretop"><div class="gb-pick-head">'
            f'<span class="gb-ticker">{ticker}</span><span class="gb-company">{company}</span></div>'
            f'<span class="gb-scorepct" style="color:var(--text-muted);font-size:.68rem;'
            f'letter-spacing:.04em;text-transform:uppercase;">Not Scored</span></div>'
            f'<div class="gb-scoreline gb-pending">Excluded from Winners / Losers / Average Return: '
            f'{note}</div></div></div>')


def render_frozen_results(scorecard_response, dateline_html, lead_summary,
                           scorefoot_narrative, crosslink_text, crosslink_onclick):
    # Archived panels are keyed by resultsGradeDate, not weekOf -- this matches
    # the site's existing convention for every already-archived results week
    # (confirmed by inspection: gr-week-2026-07-17 is the archive for the week
    # OF 2026-07-13, graded ON 2026-07-17). The live/in-progress skeleton uses
    # weekOf instead -- see gen_results_skeleton.py. Both are intentional and
    # must not be unified without checking with Graham first, since it would
    # change existing URLs/anchors already in use.
    week = scorecard_response["resultsGradeDate"]
    s = scorecard_response["summary"]
    bench = scorecard_response["benchmark"]

    stat_boxes = f'''<div class="gr-stats-v2">
      <div class="gr-stat-box"><div class="wrh-stat-num">{s["totalPublished"]}</div><div class="wrh-stat-lbl">Total Published</div></div>
      <div class="gr-stat-box"><div class="wrh-stat-num {"up" if (s["modelReturnPct"] or 0) >= 0 else "dn"}">{fmt_pct_entity(s["modelReturnPct"])}</div><div class="wrh-stat-lbl">Average Return</div></div>
      <div class="gr-stat-box"><div class="wrh-stat-num" style="color:#3ECA7A;">{s["profitable"]}</div><div class="wrh-stat-lbl">Winners</div></div>
      <div class="gr-stat-box"><div class="wrh-stat-num" style="color:#E85555;">{s["unprofitable"]}</div><div class="wrh-stat-lbl">Losers</div></div>
      <div class="gr-stat-box"><div class="wrh-stat-num {"up" if (bench["returnPct"] or 0) >= 0 else "dn"}">{fmt_pct_entity(bench["returnPct"])}</div><div class="wrh-stat-lbl">S&amp;P 500 Benchmark</div></div>
    </div>'''

    rows = "\n    ".join(render_score_row(p) for p in scorecard_response["picks"])

    return f'''  <div class="gr-week-panel" id="gr-week-{week}" data-week="{week}" style="display:none;">
    <div class="gb-dateline">{dateline_html}</div>
    <div class="gb-rule"></div>
    <p class="gb-lead">{lead_summary}</p>

    {stat_boxes}

    <div class="gb-section-lbl">Full Scorecard</div>
    <h2 class="gb-section-title">{s["totalPublished"]} Picks, Graded</h2>

    {rows}

    <p class="gb-scorefoot">{scorefoot_narrative}</p>

    <div class="gb-crosslink">
      <span class="gb-crosslink-lbl">This Week&rsquo;s Picks</span>
      <a onclick="{crosslink_onclick}">{crosslink_text}</a>
    </div>
  </div>'''


if __name__ == '__main__':
    sample = json.load(open('sample_scorecard_response.json'))
    out = render_frozen_results(
        sample,
        'Week of <b>July 13&ndash;17, 2026</b>',
        ("Fifteen names on the board, three closed green. The AI-infrastructure trade hit its "
         "worst stretch in over a year this week &mdash; chip, memory, and optical names gave "
         "back a broad swath of June&rsquo;s gains, and this list was concentrated exactly where "
         "the selling was heaviest."),
        ("3 of 14 scored names closed green, avg <b>&minus;6.93%</b> vs. the S&amp;P 500&rsquo;s "
         "&minus;1.22% &mdash; a rough week, called in advance. <b>Mega-cap names (MSFT, AMZN) "
         "and the MSTR breakout held up; the semiconductor, memory, and optics names (CRDO, MRVL, "
         "CBRS, COHR, MU) took the brunt of a sector-wide correction.</b>"),
        "Week of July 13, 2026 &middot; 15 Names, 3 Tiers &rarr;",
        "gsGoToBriefing('2026-07-13')"
    )
    with open('gr-week-2026-07-13.REGENERATED.html', 'w', encoding='utf-8') as f:
        f.write(out)
    print(f"Wrote {len(out)} chars")
