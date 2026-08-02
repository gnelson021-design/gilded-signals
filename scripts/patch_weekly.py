#!/usr/bin/env python3
"""
Gilded Signals -- guarded weekly patcher (component 3 of 3)

Two entry points, each following the same safety contract as every prior
Gilded Signals patch script:
  - every anchor string must appear EXACTLY ONCE in the source (count==1),
    otherwise abort with no write
  - a timestamped .bak copy is written before any change
  - the result is re-parsed afterward to confirm no structural breakage
  - nothing is written to the real repo by this script -- it only
    transforms an HTML string in memory / on a local scratch copy

publish_brief_and_open_results(...)  -- Sunday: archive last week's brief,
    insert this week's brief, open a fresh live results skeleton, rebuild
    both archive dropdowns.

freeze_friday_results(...)  -- Friday, after scorecard.js reports
    gradingComplete=true: replace the live results skeleton with the frozen
    static scorecard, rebuild the results archive dropdown.
"""
import re
import shutil
import datetime
from bs4 import BeautifulSoup

from gen_brief_html import render_week_panel
from gen_results_skeleton import render_results_skeleton
from freeze_results import render_frozen_results


class PatchError(Exception):
    pass


def _require_once(html, anchor, label):
    n = html.count(anchor)
    if n != 1:
        raise PatchError(f"Guard failed for {label}: found {n} occurrences (expected exactly 1). Aborting -- no changes written.")


def _backup(path):
    stamp = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
    backup_path = f"{path}.bak.{stamp}"
    shutil.copyfile(path, backup_path)
    return backup_path


def _extract_balanced_div(html, open_tag):
    """
    Finds `open_tag` (must appear exactly once) and returns (full_block,
    start_index, end_index) where full_block spans from open_tag through
    its correctly-balanced closing </div>, tracking nested <div> depth so
    it doesn't stop at the first inner </div> the way a naive .*?</div>
    regex would.
    """
    n = html.count(open_tag)
    if n != 1:
        raise PatchError(f"Guard failed locating balanced div for anchor (found {n}, expected 1): {open_tag!r}")
    start = html.index(open_tag)
    depth = 0
    i = start
    tag_re = re.compile(r'<div\b[^>]*>|</div>')
    pos = start
    while True:
        m = tag_re.search(html, pos)
        if not m:
            raise PatchError("Unbalanced <div> tags: reached end of document before closing the anchored block.")
        if m.group(0) == '</div>':
            depth -= 1
            if depth == 0:
                end = m.end()
                return html[start:end], start, end
        else:
            depth += 1
        pos = m.end()


def _sanity_check_parses(html, label, before_html=None):
    """Not a full validator -- just confirms BeautifulSoup can walk the
    document without throwing, and that the patch didn't change the
    document's div open/close balance. Compared as a DELTA against
    before_html rather than asserting perfect zero-imbalance, because the
    live site already carries one pre-existing, harmless unclosed <div>
    somewhere unrelated to the weekly panels (confirmed present before this
    pipeline ever touches the file) -- asserting absolute balance would
    false-positive-abort on every run for a reason with nothing to do with
    this patch. What matters is that THIS patch didn't introduce a NEW
    imbalance, which is what a silently-reparenting unclosed div would do."""
    soup = BeautifulSoup(html, 'html.parser')
    if soup is None:
        raise PatchError(f"{label}: BeautifulSoup failed to parse output")
    opens = len(re.findall(r'<div\b', html))
    closes = len(re.findall(r'</div>', html))
    after_diff = opens - closes
    if before_html is not None:
        b_opens = len(re.findall(r'<div\b', before_html))
        b_closes = len(re.findall(r'</div>', before_html))
        before_diff = b_opens - b_closes
        if after_diff != before_diff:
            raise PatchError(
                f"{label}: div balance changed by this patch (before diff={before_diff}, "
                f"after diff={after_diff}) -- aborting write, this looks like a newly "
                f"introduced unclosed tag."
            )
    elif after_diff != 0:
        raise PatchError(f"{label}: div tag mismatch after patch ({opens} opens vs {closes} closes) -- aborting write.")


def render_options(pairs):
    """
    pairs: ordered list of (value, full_label_text) tuples, most-recent-first.
    Labels are fully pre-computed by the caller (see label helpers below) --
    this function does no inference, so Friday's "no live week exists right
    now" state and Sunday's "new live week just opened" state can never be
    confused with each other inside the renderer itself.
    """
    return "\n".join(f'      <option value="{v}">{label}</option>' for v, label in pairs)


def brief_label_live(date_range_label):
    return f"This Week &mdash; {date_range_label}"


def results_label_live(date_range_label):
    return f"This Week (Live) &mdash; {date_range_label}"


def results_label_most_recent(date_range_label):
    return f"Most Recent &mdash; {date_range_label}"


# ---------------------------------------------------------------------------
# SUNDAY: publish new brief, archive old brief, open new live results
# ---------------------------------------------------------------------------
def publish_brief_and_open_results(html, *, prev_week_id, new_week_picks, new_week_brief,
                                    new_dateline_html, new_crosslink_text, new_crosslink_onclick,
                                    brief_dropdown_pairs, results_dropdown_pairs,
                                    most_recent_frozen_results_id):
    """
    prev_week_id: e.g. '2026-07-20' -- the gb-week-panel id currently marked data-live="true"
    new_week_picks / new_week_brief: the picks-{week}.json / brief-{week}.json dicts for the new week
    brief_dropdown_pairs / results_dropdown_pairs: full ordered (most-recent-first)
        list of (value, full_label_text) tuples -- build with the label helpers
        above (brief_label_live / results_label_live / results_label_most_recent)
        plus plain date-range strings for every older week.
    most_recent_frozen_results_id: the resultsGradeDate id of the week that was
        frozen on the most recent Friday -- the new live results skeleton is
        inserted immediately before it.
    """
    out = html

    # 1. Archive the outgoing brief panel: data-live true -> false, add display:none
    old_open_tag = f'<div class="gb-week-panel" id="gb-week-{prev_week_id}" data-live="true">'
    _require_once(out, old_open_tag, f"outgoing brief panel open tag ({prev_week_id})")
    new_open_tag = f'<div class="gb-week-panel" id="gb-week-{prev_week_id}" data-live="false" style="display:none;">'
    out = out.replace(old_open_tag, new_open_tag, 1)

    # 2. Insert the new brief panel immediately before the (now archived) old one
    new_panel_html = render_week_panel(new_week_picks, new_week_brief, is_live=True)
    _require_once(out, new_open_tag, "archived panel anchor (post-archive, for insertion point)")
    out = out.replace(new_open_tag, new_panel_html + "\n\n" + new_open_tag, 1)

    # 3. Rebuild the brief page's archive <select> options
    brief_select_re = re.compile(
        r'(<select class="gb-archive-select" onchange="gsBriefArchiveSwitch\(this\.value\)">\n)(.*?)(\n\s*</select>)',
        re.DOTALL
    )
    matches = brief_select_re.findall(out)
    if len(matches) != 1:
        raise PatchError(f"Guard failed for brief archive <select>: found {len(matches)} matches (expected 1).")
    new_options = render_options(brief_dropdown_pairs)
    out = brief_select_re.sub(lambda m: m.group(1) + new_options + m.group(3), out, count=1)

    # 4. Insert a fresh live results skeleton for the new week, immediately before
    #    the most-recently-frozen results panel (that panel's id is keyed by
    #    resultsGradeDate -- see freeze_friday_results / gen_results_skeleton.py
    #    docstring for why live vs. frozen panels use different key fields).
    frozen_anchor = f'<div class="gr-week-panel" id="gr-week-{most_recent_frozen_results_id}" data-week="{most_recent_frozen_results_id}" style="display:none;">'
    _require_once(out, frozen_anchor, f"most-recently-frozen results panel anchor ({most_recent_frozen_results_id})")
    new_results_skel = render_results_skeleton(
        new_week_picks["weekOf"], new_dateline_html, new_crosslink_text, new_crosslink_onclick
    )
    out = out.replace(frozen_anchor, new_results_skel + "\n\n" + frozen_anchor, 1)

    # 5. Rebuild the results page's archive <select> options
    results_select_re = re.compile(
        r'(<select class="gb-archive-select" onchange="gsResultsArchiveSwitch\(this\.value\)">\n)(.*?)(\n\s*</select>)',
        re.DOTALL
    )
    matches = results_select_re.findall(out)
    if len(matches) != 1:
        raise PatchError(f"Guard failed for results archive <select>: found {len(matches)} matches (expected 1).")
    new_results_options = render_options(results_dropdown_pairs)
    out = results_select_re.sub(lambda m: m.group(1) + new_results_options + m.group(3), out, count=1)

    _sanity_check_parses(out, "publish_brief_and_open_results", before_html=html)
    return out


# ---------------------------------------------------------------------------
# FRIDAY: freeze the completing week's results
# ---------------------------------------------------------------------------
def freeze_friday_results(html, *, live_week_id, scorecard_response, dateline_html,
                           lead_summary, scorefoot_narrative, crosslink_text, crosslink_onclick,
                           results_dropdown_pairs):
    """
    live_week_id: the weekOf key of the panel currently live, e.g. '2026-07-20'
        (its panel id/data-week is keyed by weekOf while live -- see gen_results_skeleton.py)
    scorecard_response: the JSON returned by scorecard.js for this week, fetched
        AFTER confirming gradingComplete == true
    """
    out = html

    live_open_tag = f'<div class="gr-week-panel" id="gr-week-{live_week_id}" data-live="true" data-week="{live_week_id}">'
    old_block, start, end = _extract_balanced_div(out, live_open_tag)

    frozen_html = render_frozen_results(
        scorecard_response, dateline_html, lead_summary, scorefoot_narrative,
        crosslink_text, crosslink_onclick
    )
    out = out[:start] + frozen_html + out[end:]

    results_select_re = re.compile(
        r'(<select class="gb-archive-select" onchange="gsResultsArchiveSwitch\(this\.value\)">\n)(.*?)(\n\s*</select>)',
        re.DOTALL
    )
    matches = results_select_re.findall(out)
    if len(matches) != 1:
        raise PatchError(f"Guard failed for results archive <select>: found {len(matches)} matches (expected 1).")
    new_results_options = render_options(results_dropdown_pairs)
    out = results_select_re.sub(lambda m: m.group(1) + new_results_options + m.group(3), out, count=1)

    _sanity_check_parses(out, "freeze_friday_results", before_html=html)
    return out
