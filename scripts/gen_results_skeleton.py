#!/usr/bin/env python3
"""
Gilded Signals -- Results skeleton generator (component 1 of 3)

Produces the thin, live gr-week-panel for a week that is JUST STARTING
(i.e. published alongside that week's new Sunday Brief). This skeleton has
no baked numbers -- gs-scorecard-live.js populates it at runtime by calling
GET /.netlify/functions/scorecard?week={week}. scorecard.js is never
modified; this script only ever produces HTML that matches what that
function's frontend consumer (gs-scorecard-live.js) expects to find by ID.

Does not touch index.html. Writes/returns an HTML string only.
"""
import json


def render_results_skeleton(week, dateline_html, crosslink_text, crosslink_onclick):
    """
    week:              '2026-07-27'
    dateline_html:     'Week of <b>July 27&ndash;31, 2026</b>'
    crosslink_text:    'Week of July 27&ndash;31, 2026 &middot; 15 Names, 3 Tiers &rarr;'
    crosslink_onclick: "gsGoToBriefing('2026-07-27')"
    """
    return f'''    <div class="gr-week-panel" id="gr-week-{week}" data-live="true" data-week="{week}">
    <div class="gb-dateline">{dateline_html}</div>
    <div class="gb-rule"></div>

    <div class="gr-status-banner live" id="gr-status-banner">
      <div class="gr-status-main"><span class="gr-status-dot"></span> <span id="gr-status-label">Live</span></div>
      <div class="gr-status-sub" id="gr-status-sub">Grading completes Friday after close &middot; nothing below is final</div>
    </div>

    <p class="gb-lead" id="gr-status-lead">This week is still in progress. Every number below comes from the same engine that grades the final scorecard Friday after close &mdash; nothing here is final until the week closes.</p>

    <div class="gr-stats-v2" id="gr-live-stats">
      <div class="gr-live-loading">Loading live scorecard&hellip;</div>
    </div>

    <div class="gb-section-lbl">Live Scorecard</div>
    <h2 class="gb-section-title">15 Picks, Tracked Live</h2>

    <div id="gr-live-scorelist">
      <div class="gr-live-loading">Loading&hellip;</div>
    </div>

    <p class="gb-scorefoot" id="gr-live-scorefoot"></p>
    <div class="gr-live-meta" id="gr-live-meta"></div>

    <div class="gb-crosslink">
      <span class="gb-crosslink-lbl">This Week&rsquo;s Picks</span>
      <a onclick="{crosslink_onclick}">{crosslink_text}</a>
    </div>
  </div>'''


if __name__ == '__main__':
    out = render_results_skeleton(
        '2026-07-27',
        'Week of <b>July 27&ndash;31, 2026</b>',
        'Week of July 27&ndash;31, 2026 &middot; 15 Names, 3 Tiers &rarr;',
        "gsGoToBriefing('2026-07-27')"
    )
    print(out)
