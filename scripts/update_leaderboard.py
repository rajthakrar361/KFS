#!/usr/bin/env python3
"""
Nightly KFS leaderboard updater (cron: 21:00 IST).
- Every night: fetch new activities, update current week board in index.html
- Monday night: date-based check archives the past week and starts a fresh week

Activities come from the Strava API, or with `--runs-file PATH` from a file of runs
collected from the club feed in a browser (one per line:
id|type|start_date|firstname|lastname|distance_m|moving_s|elapsed_s|elev_m).
"""
import os, re, sys, json, argparse
from datetime import datetime, timedelta, timezone
from collections import defaultdict

ROOT      = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HTML_FILE = os.path.join(ROOT, 'index.html')
SCRIPTS   = os.path.dirname(os.path.abspath(__file__))
NAME_MAP  = os.path.join(SCRIPTS, 'name_map.json')
SEEN_FILE = os.path.join(SCRIPTS, 'seen_activities.json')
WEEK_FILE = os.path.join(SCRIPTS, 'current_week_activities.json')
HIST_FILE = os.path.join(SCRIPTS, 'historical_weeks.json')

COLORS = [
    "#FC4C02","#e05c00","#d45a00","#c85500","#bc5000","#b04b00","#a44600","#984100",
    "#8c3c00","#803700","#7a3200","#742d00","#6e2800","#682300","#621e00","#5c1900",
    "#561500","#501100","#4a0e00","#440b00","#3e0800","#380500","#320300","#2c0100",
]

# ── Strava API ────────────────────────────────────────────────────────────────

def get_access_token():
    import requests
    r = requests.post('https://www.strava.com/oauth/token', data={
        'client_id':     os.environ['STRAVA_CLIENT_ID'],
        'client_secret': os.environ['STRAVA_CLIENT_SECRET'],
        'refresh_token': os.environ['STRAVA_REFRESH_TOKEN'],
        'grant_type':    'refresh_token',
    })
    r.raise_for_status()
    return r.json()['access_token']

def fetch_club_activities(token):
    import requests
    hdrs, all_acts = {'Authorization': f'Bearer {token}'}, []
    for page in range(1, 15):
        r = requests.get(
            f'https://www.strava.com/api/v3/clubs/{os.environ["STRAVA_CLUB_ID"]}/activities',
            headers=hdrs, params={'per_page': 200, 'page': page}
        )
        r.raise_for_status()
        batch = r.json()
        all_acts.extend(batch)
        if len(batch) < 200:
            break
    return all_acts

def load_runs_file(path):
    acts = []
    for line in open(path, encoding='utf-8'):
        p = line.strip().split('|')
        if len(p) < 9 or not p[0].isdigit():
            continue
        acts.append({
            'id': p[0], 'type': p[1], 'start_date': p[2] or None,
            'athlete': {'firstname': p[3], 'lastname': p[4]},
            'distance': float(p[5]), 'moving_time': int(p[6]),
            'elapsed_time': int(p[7]) if p[7] else int(p[6]),
            'total_elevation_gain': float(p[8]) if p[8] else 0.0,
        })
    return acts

# ── State files ───────────────────────────────────────────────────────────────

def fingerprint(a):
    fp = f"{a['athlete']['firstname']}|{a['athlete']['lastname']}|{a['distance']}|{a['moving_time']}"
    return f"{fp}|{a['id']}" if a.get('id') else fp

def seen_key(fp_or_act):
    """Dedup key: the activity id when known, else the whole fingerprint."""
    if isinstance(fp_or_act, dict):
        return f"id:{fp_or_act['id']}" if fp_or_act.get('id') else fingerprint(fp_or_act)
    parts = fp_or_act.split('|')
    return f"id:{parts[4]}" if len(parts) > 4 and parts[4] else fp_or_act

def load_json(path, default):
    if os.path.exists(path):
        return json.loads(open(path, encoding='utf-8-sig').read())
    return default

def save_json(path, data):
    json.dump(data, open(path, 'w', encoding='utf-8'), indent=2, ensure_ascii=False)

# ── Name resolution ───────────────────────────────────────────────────────────

def resolve_name(firstname, lastname, name_map):
    key = f"{firstname} {lastname}"
    return name_map.get(key, key)

# ── Aggregation ───────────────────────────────────────────────────────────────

RUN_TYPES = {'Run', 'TrailRun', 'VirtualRun'}

def pace_str_val(moving_secs, dist_m):
    if dist_m < 10:
        return '--', 9999
    spk = moving_secs / (dist_m / 1000)
    return f"{int(spk//60)}:{int(spk%60):02d}", int(spk)

def avg_pace_str_val(moving_secs, dist_m):
    if dist_m < 10:
        return '--', 9999
    spk = moving_secs / (dist_m / 1000)
    return f"{int(spk//60)}:{int(spk%60):02d}", int(spk)

def aggregate(activities, name_map):
    data = defaultdict(lambda: dict(
        distance=0.0, runs=0, runs_2k=0, longest=0.0,
        best_pv=9999, best_pace='--', elev=0.0,
        moving_total=0, distance_raw=0.0
    ))
    for a in activities:
        if a.get('type') not in RUN_TYPES:
            continue
        name = resolve_name(a['athlete']['firstname'], a['athlete']['lastname'], name_map)
        dk   = round(a['distance'] / 1000, 1)
        ps, pv = pace_str_val(a['moving_time'], a['distance'])
        d = data[name]
        d['distance']      = round(d['distance'] + dk, 1)
        d['runs']         += 1
        d['runs_2k']      += 1 if a['distance'] >= 2000 else 0
        d['distance_raw'] += a['distance']
        d['moving_total']  += a['moving_time']
        if dk > d['longest']: d['longest'] = dk
        if pv < d['best_pv']:
            d['best_pv']   = pv
            d['best_pace'] = ps
        d['elev'] += a.get('total_elevation_gain') or 0

    rows = sorted(data.items(), key=lambda x: -x[1]['distance'])
    result = []
    for i, (name, d) in enumerate(rows):
        ap, apv = avg_pace_str_val(d['moving_total'], d['distance_raw'])
        result.append({
            'name':        name,
            'distance':    d['distance'],
            'runs':        d['runs'],
            'runs_2k':     d['runs_2k'],
            'longest':     d['longest'],
            'pace':        d['best_pace'],
            'paceVal':     d['best_pv'],
            'avgPace':     ap,
            'avgPaceVal':  apv,
            'elev':        f"{int(d['elev'])}m" if d['elev'] else '--',
            'color':       COLORS[i % len(COLORS)],
        })
    return result

# ── Date helpers ──────────────────────────────────────────────────────────────

def current_week_range():
    ist    = timezone(timedelta(hours=5, minutes=30))
    today  = datetime.now(ist)
    monday = (today - timedelta(days=today.weekday())).replace(
                 hour=0, minute=0, second=0, microsecond=0)
    sunday = monday + timedelta(days=6)
    return monday, sunday

def badge_text(monday, sunday):
    if monday.month == sunday.month:
        return f"{monday.strftime('%b')} {monday.day} – {sunday.day}, {sunday.year}"
    return (f"{monday.strftime('%b')} {monday.day} – "
            f"{sunday.strftime('%b')} {sunday.day}, {sunday.year}")

MONTHS = {'Jan':1,'Feb':2,'Mar':3,'Apr':4,'May':5,'Jun':6,
          'Jul':7,'Aug':8,'Sep':9,'Oct':10,'Nov':11,'Dec':12}

def badge_end_date(badge):
    """Return the Sunday date from a badge string, e.g. 'May 25 – 31, 2026' → date(2026,5,31)."""
    from datetime import date as date_
    import re
    # Cross-month: "Apr 27 – May 3, 2026"
    m = re.match(r'\w+ \d+ \S+ (\w+) (\d+), (\d+)', badge)
    if m:
        return date_(int(m.group(3)), MONTHS[m.group(1)], int(m.group(2)))
    # Same month: "May 25 – 31, 2026"
    m = re.match(r'(\w+) \d+ \S+ (\d+), (\d+)', badge)
    if m:
        return date_(int(m.group(3)), MONTHS[m.group(1)], int(m.group(2)))
    return None

IST = timezone(timedelta(hours=5, minutes=30))

def ist_date(a):
    """IST calendar date an activity started on, or None when unknown (API data)."""
    s = a.get('start_date')
    if not s:
        return None
    return datetime.fromisoformat(s.replace('Z', '+00:00')).astimezone(IST).date()

def should_archive(html):
    """Archive when today (IST) is strictly after the badge week's Sunday."""
    from datetime import date as date_
    ist = timezone(timedelta(hours=5, minutes=30))
    today = datetime.now(ist).date()
    badge = parse_current_badge(html)
    end = badge_end_date(badge)
    if end is None:
        return False
    result = today > end
    if result:
        print(f"  Badge week ended {end} — today is {today}, archiving.")
    return result

# ── HoF computation ───────────────────────────────────────────────────────────

# Names excluded from ALL speed records
SPEED_EXCLUDED_NAMES = {'Amol Jain'}

SPEED_BANDS = {
    '5K':   (4800,  5600),
    '10K':  (9500,  10500),
    '21K':  (20500, 22000),
    '42K':  (41500, 43000),
}

# Manual seed entries for bands with no auto-detected runs yet
# Format: (elapsed_secs, full_name, dist_m)
MANUAL_SPEED_SEEDS = {
    '21K': [
        ( 7226, 'Rishendra Chauhan', 21097),  # 2:00:26
        ( 8095, 'Bhargav Kumare',    21097),  # 2:14:55
        (10581, 'Mihir Pandit',      21097),  # 2:56:21
        (11969, 'Sakha Ghotekar',    21097),  # 3:19:29
    ],
}

def fmt_time(secs):
    h = secs // 3600
    m = (secs % 3600) // 60
    s = secs % 60
    if h:
        return f"{h}:{m:02d}:{s:02d}"
    return f"{m}:{s:02d}"

def fmt_pace(elapsed_secs, dist_m):
    if dist_m < 10:
        return '--'
    spk = elapsed_secs / (dist_m / 1000)
    return f"{int(spk//60)}:{int(spk%60):02d}/km"

def compute_hof(seen_fps, current_week_acts, name_map, hist_weeks):
    # Build elapsed_time lookup from current week activities
    elapsed_lookup = {}
    for a in current_week_acts:
        fp = fingerprint(a)
        elapsed_lookup[fp] = a.get('elapsed_time') or a['moving_time']

    # ── Speed records ─────────────────────────────────────────────────────────
    speed = {}
    for band, (lo, hi) in SPEED_BANDS.items():
        runs = []
        for fp in seen_fps:
            parts = fp.split('|')
            if len(parts) < 4:
                continue
            try:
                dist   = float(parts[2])
                moving = int(parts[3])
            except ValueError:
                continue
            if lo <= dist <= hi:
                name    = resolve_name(parts[0], parts[1], name_map)
                if name in SPEED_EXCLUDED_NAMES:
                    continue
                elapsed = elapsed_lookup.get(fp, moving)
                runs.append((elapsed, name, dist))
        runs.extend(MANUAL_SPEED_SEEDS.get(band, []))
        runs.sort()
        top8 = []
        for elapsed, name, dist in runs[:8]:
            top8.append({
                'name':    name,
                'time':    elapsed,
                'timeStr': fmt_time(elapsed),
                'pace':    fmt_pace(elapsed, dist),
            })
        speed[band] = top8

    # ── Individual records ────────────────────────────────────────────────────
    # Build all-weeks list: hist weeks + current week aggregated
    all_weeks = list(hist_weeks)
    if current_week_acts:
        cur_ath = aggregate(current_week_acts, name_map)
        all_weeks = [{'id': 'current', 'label': 'Current Week', 'athletes': cur_ath}] + all_weeks

    longest_run   = {}   # name -> km
    best_km_week  = {}   # name -> (km, label)
    best_run_week = {}   # name -> (runs, label)
    weeks_count   = {}   # name -> int

    for week in all_weeks:
        label = week['label']
        for a in week['athletes']:
            name = a['name']
            km   = a['distance']
            lng  = a['longest']
            runs = a.get('runs_2k', a['runs'])  # 2km+ filter; falls back for old historical data

            if lng > longest_run.get(name, 0):
                longest_run[name] = lng
            if km > best_km_week.get(name, (0, ''))[0]:
                best_km_week[name] = (km, label)
            if runs > best_run_week.get(name, (0, ''))[0]:
                best_run_week[name] = (runs, label)
            weeks_count[name] = weeks_count.get(name, 0) + 1

    def top3_simple(d):
        return [{'name': n, 'val': v}
                for n, v in sorted(d.items(), key=lambda x: -x[1])[:3]]

    def top3_weekly(d):
        return [{'name': n, 'val': v, 'week': w}
                for n, (v, w) in sorted(d.items(), key=lambda x: -x[1][0])[:3]]

    individual = {
        'longestRun':   top3_simple(longest_run),
        'mostKmWeek':   top3_weekly(best_km_week),
        'mostRunsWeek': top3_weekly(best_run_week),
        'mostWeeks':    top3_simple(weeks_count),
    }

    # ── Club records ──────────────────────────────────────────────────────────
    week_stats = []
    for week in all_weeks:
        if week['id'] == 'current':
            continue  # exclude live week from club records
        total_km  = round(sum(a['distance'] for a in week['athletes']), 1)
        n_runners = len(week['athletes'])
        week_stats.append((total_km, n_runners, week['label']))

    if week_stats:
        best_km    = max(week_stats, key=lambda x: x[0])
        best_runners = max(week_stats, key=lambda x: x[1])
    else:
        best_km = best_runners = (0, 0, '')

    club = {
        'bestWeekKm':   {'val': best_km[0],      'runners': best_km[1],      'week': best_km[2]},
        'mostRunners':  {'val': best_runners[1],  'km':      best_runners[0], 'week': best_runners[2]},
    }

    return {'speed': speed, 'individual': individual, 'club': club}

# ── HTML helpers ──────────────────────────────────────────────────────────────

def athletes_to_js(athletes, with_color=True):
    lines = []
    for a in athletes:
        ap  = a.get('avgPace', '--')
        apv = a.get('avgPaceVal', 9999)
        if with_color:
            lines.append(
                f'  {{ name: "{a["name"]}", distance: {a["distance"]}, runs: {a["runs"]}, '
                f'longest: {a["longest"]}, pace: "{a["pace"]}", paceVal: {a["paceVal"]}, '
                f'avgPace: "{ap}", avgPaceVal: {apv}, '
                f'elev: "{a["elev"]}", color: "{a["color"]}" }}'
            )
        else:
            lines.append(
                f'      {{ name: "{a["name"]}", distance: {a["distance"]}, runs: {a["runs"]}, '
                f'longest: {a["longest"]}, pace: "{a["pace"]}", paceVal: {a["paceVal"]}, '
                f'avgPace: "{ap}", avgPaceVal: {apv}, '
                f'elev: "{a["elev"]}" }}'
            )
    return ',\n'.join(lines)

def hist_weeks_to_js(hist_weeks):
    entries = []
    for w in hist_weeks:
        wid     = w['id']
        ath_js  = athletes_to_js(w['athletes'], with_color=False)
        entries.append(
            f'  "hist-week-{wid}": {{\n    sortKey: "distance",\n    athletes: [\n{ath_js}\n    ]\n  }}'
        )
    return ',\n'.join(entries)

def hof_to_js(hof):
    def speed_entry(e):
        return (f'{{name:"{e["name"]}",time:{e["time"]},'
                f'timeStr:"{e["timeStr"]}",pace:"{e["pace"]}\"}}')

    def ind_simple(e):
        return f'{{name:"{e["name"]}",val:{e["val"]}}}'

    def ind_weekly(e):
        return f'{{name:"{e["name"]}",val:{e["val"]},week:"{e["week"]}"}}'

    speed_js = {}
    for band, entries in hof['speed'].items():
        speed_js[band] = '[' + ','.join(speed_entry(e) for e in entries) + ']'

    ind = hof['individual']
    club = hof['club']

    lines = [
        '{',
        '  speed: {',
        f'    "5K":  {speed_js.get("5K",  "[]")},',
        f'    "10K": {speed_js.get("10K", "[]")},',
        f'    "21K": {speed_js.get("21K", "[]")},',
        f'    "42K": {speed_js.get("42K", "[]")}',
        '  },',
        '  individual: {',
        f'    longestRun:   [{",".join(ind_simple(e) for e in ind["longestRun"])}],',
        f'    mostKmWeek:   [{",".join(ind_weekly(e) for e in ind["mostKmWeek"])}],',
        f'    mostRunsWeek: [{",".join(ind_weekly(e) for e in ind["mostRunsWeek"])}],',
        f'    mostWeeks:    [{",".join(ind_simple(e) for e in ind["mostWeeks"])}]',
        '  },',
        '  club: {',
        f'    bestWeekKm:  {{val:{club["bestWeekKm"]["val"]},runners:{club["bestWeekKm"]["runners"]},week:"{club["bestWeekKm"]["week"]}"}},',
        f'    mostRunners: {{val:{club["mostRunners"]["val"]},km:{club["mostRunners"]["km"]},week:"{club["mostRunners"]["week"]}\"}}',
        '  }',
        '}',
    ]
    return '\n'.join(lines)

def parse_current_athletes(html):
    m = re.search(r'const athletes = \[(.*?)\];', html, re.DOTALL)
    return parse_athlete_objs(m.group(1)) if m else []

def sync_hist_from_html(html, hist_weeks):
    """Add weeks that exist in index.html's historicalWeeks but not in the JSON
    (e.g. weeks entered by hand), so regenerating the HTML never drops them."""
    block = re.search(r'const historicalWeeks = \{(.*?)\n\};', html, re.DOTALL)
    if not block:
        return hist_weeks, []
    have = {w['id'] for w in hist_weeks}
    added = []
    for m in re.finditer(r'"hist-week-(\w+)":\s*\{.*?athletes:\s*\[(.*?)\]\s*\}', block.group(1), re.DOTALL):
        wid = m.group(1)
        if wid in have:
            continue
        t = re.search(rf'id="hist-week-{wid}".*?<div class="hist-week-title">([^<]+)</div>', html, re.DOTALL)
        if not t:
            continue
        hist_weeks.append({'id': wid, 'label': t.group(1).strip(), 'athletes': parse_athlete_objs(m.group(2))})
        added.append(wid)
    if added:
        hist_weeks.sort(key=lambda w: badge_end_date(w['label']) or datetime.min.date(), reverse=True)
    return hist_weeks, added

def parse_athlete_objs(text):
    result = []
    for obj in re.finditer(r'\{([^}]+)\}', text):
        s = obj.group(1)
        def get(field, src=s):
            fm = re.search(rf'{field}:\s*("([^"]*)"|([\d.]+))', src)
            if not fm: return ''
            return fm.group(2) if fm.group(2) is not None else fm.group(3)
        try:
            result.append({
                'name':        get('name'),
                'distance':    float(get('distance') or 0),
                'runs':        int(get('runs') or 0),
                'longest':     float(get('longest') or 0),
                'pace':        get('pace'),
                'paceVal':     int(get('paceVal') or 999),
                'avgPace':     get('avgPace') or '--',
                'avgPaceVal':  int(get('avgPaceVal') or 9999),
                'elev':        get('elev'),
            })
        except (ValueError, TypeError):
            pass
    return result

def parse_current_badge(html):
    m = re.search(r'<div class="week-badge"><span>([^<]+)</span></div>', html)
    return m.group(1) if m else ''

def badge_to_week_id(badge):
    m = re.match(r'(\w+)\s+(\d+)', badge)
    if not m: return 'week'
    month_map = {
        'Jan':'jan','Feb':'feb','Mar':'mar','Apr':'apr','May':'may','Jun':'jun',
        'Jul':'jul','Aug':'aug','Sep':'sep','Oct':'oct','Nov':'nov','Dec':'dec'
    }
    return f"{month_map.get(m.group(1), m.group(1).lower())}{m.group(2)}"

def make_hist_html_card(wid, badge, athletes):
    total_km   = round(sum(a['distance'] for a in athletes), 1)
    total_runs = sum(a['runs'] for a in athletes)
    n          = len(athletes)
    return f"""\
    <!-- Week of {badge} -->
    <div class="hist-week-card" id="hist-week-{wid}">
      <div class="hist-week-header" onclick="toggleHistWeek('hist-week-{wid}')">
        <div>
          <div class="hist-week-title">{badge}</div>
          <div class="hist-week-meta">
            <span><strong>{n}</strong> runners</span>
            <span><strong>{total_km}</strong> km total</span>
            <span><strong>{total_runs}</strong> runs</span>
          </div>
        </div>
        <span class="hist-chevron">▼</span>
      </div>
      <div class="hist-week-body">
        <div class="board" style="border:none;border-radius:0">
          <div class="board-header">
            <span></span><span>Athlete</span><span>Distance</span>
            <span>Pace</span><span class="col-elev">Elev.</span>
          </div>
          <div id="hist-body-{wid}"></div>
        </div>
      </div>
    </div>

"""

def merge_runs(athletes, runs, name_map):
    """Add runs to an already-aggregated week (a hand-entered board or an archived week)."""
    by_name = {a['name']: dict(a) for a in athletes}
    for a in aggregate(runs, name_map):
        b = by_name.get(a['name'])
        if b is None:
            by_name[a['name']] = dict(a)
            continue
        d_old, d_new = b['distance'], a['distance']
        b['distance'] = round(d_old + d_new, 1)
        b['runs']    += a['runs']
        if 'runs_2k' in b:
            b['runs_2k'] += a['runs_2k']
        b['longest'] = max(b['longest'], a['longest'])
        if a.get('paceVal', 9999) < b.get('paceVal', 9999):
            b['pace'] = a['pace']; b['paceVal'] = a['paceVal']
        # Average pace weighted by distance (the raw times of archived runs aren't kept)
        if b.get('avgPaceVal', 9999) < 9999 and a['avgPaceVal'] < 9999 and d_old + d_new:
            spk = (b['avgPaceVal'] * d_old + a['avgPaceVal'] * d_new) / (d_old + d_new)
            b['avgPace'], b['avgPaceVal'] = f"{int(spk // 60)}:{int(spk % 60):02d}", int(spk)
        elev = int((b.get('elev') or '0m').rstrip('m').replace('--', '0') or 0) + \
               int((a['elev'] or '0m').rstrip('m').replace('--', '0') or 0)
        b['elev'] = f"{elev}m" if elev else '--'
    return sorted(by_name.values(), key=lambda a: -a['distance'])

def update_hist_card_meta(html, wid, athletes):
    """Refresh the runners / km / runs totals in a history card's header."""
    total_km   = round(sum(a['distance'] for a in athletes), 1)
    total_runs = sum(a['runs'] for a in athletes)
    meta = (f'<div class="hist-week-meta">\n'
            f'            <span><strong>{len(athletes)}</strong> runners</span>\n'
            f'            <span><strong>{total_km}</strong> km total</span>\n'
            f'            <span><strong>{total_runs}</strong> runs</span>\n'
            f'          </div>')
    return re.sub(rf'(id="hist-week-{wid}".*?)<div class="hist-week-meta">.*?</div>',
                  lambda m: m.group(1) + meta, html, count=1, flags=re.DOTALL)

def update_html(html, new_athletes, new_badge,
                prev_badge=None, prev_wid=None, prev_athletes=None,
                prev_rank_names=None, hist_weeks=None, hof=None):
    # Update week badge
    old_badge = parse_current_badge(html)
    html = html.replace(
        f'<div class="week-badge"><span>{old_badge}</span></div>',
        f'<div class="week-badge"><span>{new_badge}</span></div>',
    )

    # Save current ranking as prevAthletes
    prev_names_js = ', '.join(f'"{n}"' for n in (prev_rank_names or []))
    html = re.sub(
        r'const prevAthletes = \[.*?\];',
        f'const prevAthletes = [{prev_names_js}];',
        html, flags=re.DOTALL
    )

    # Replace athletes array
    athletes_js = athletes_to_js(new_athletes) if new_athletes else ''
    html = re.sub(
        r'const athletes = \[.*?\];',
        f'const athletes = [\n{athletes_js}\n];',
        html, flags=re.DOTALL
    )

    # Replace historicalWeeks from JSON file
    if hist_weeks is not None:
        hw_js = hist_weeks_to_js(hist_weeks)
        html = re.sub(
            r'const historicalWeeks = \{.*?\};',
            f'const historicalWeeks = {{\n{hw_js}\n}};',
            html, flags=re.DOTALL
        )

    # Replace hofData
    if hof is not None:
        hof_js = hof_to_js(hof)
        html = re.sub(
            r'const hofData = \{.*?\};',
            f'const hofData = {hof_js};',
            html, flags=re.DOTALL
        )

    # On Sunday: archive previous week into history HTML cards + JSON
    if prev_badge and prev_wid and prev_athletes:
        hist_card = make_hist_html_card(prev_wid, prev_badge, prev_athletes)
        if f'id="hist-week-{prev_wid}"' not in html:
            html = html.replace(
                '    <div class="hist-week-card"',
                hist_card + '    <div class="hist-week-card"',
                1
            )

    return html

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--runs-file', help='runs collected from the club feed instead of the Strava API')
    args = ap.parse_args()

    if args.runs_file:
        activities = load_runs_file(args.runs_file)
        print(f"  {len(activities)} activities from {args.runs_file}")
    else:
        print("Getting Strava access token...")
        token = get_access_token()
        print("Fetching club activities...")
        activities = fetch_club_activities(token)
        print(f"  {len(activities)} activities from API")

    seen_fps = load_json(SEEN_FILE, [])
    seen     = set(seen_fps)
    seen_ids = {seen_key(fp) for fp in seen_fps}
    name_map = load_json(NAME_MAP, {})

    new_acts = [a for a in activities if seen_key(a) not in seen_ids]
    print(f"  {len(new_acts)} new since last run")

    if not args.runs_file:
        # API data has no dates: skip the backlog of runners who just joined
        known_names = set('|'.join(fp.split('|')[:2]) for fp in seen)
        def is_new_runner(a):
            return f"{a['athlete']['firstname']}|{a['athlete']['lastname']}" not in known_names
        from collections import Counter
        new_runner_counts = Counter(
            f"{a['athlete']['firstname']}|{a['athlete']['lastname']}"
            for a in new_acts if is_new_runner(a)
        )
        skipped, included = [], []
        for a in new_acts:
            name_key = f"{a['athlete']['firstname']}|{a['athlete']['lastname']}"
            if is_new_runner(a) and new_runner_counts[name_key] > 3:
                skipped.append(a)
            else:
                included.append(a)
        new_acts = included
        if skipped:
            names = sorted({f"{a['athlete']['firstname']} {a['athlete']['lastname']}" for a in skipped})
            print(f"  New runners with history skipped: {', '.join(names)}")

    seen.update(fingerprint(a) for a in activities)
    save_json(SEEN_FILE, sorted(seen))

    week_acts  = load_json(WEEK_FILE, [])
    hist_weeks = load_json(HIST_FILE, [])

    with open(HTML_FILE, encoding='utf-8') as f:
        html = f.read()

    hist_weeks, synced = sync_hist_from_html(html, hist_weeks)
    if synced:
        print(f"  Synced weeks from index.html into history: {', '.join(synced)}")
        # Hand-entered weeks lack the 2km+ run count used by the HoF; fill it from dated runs
        for w in hist_weeks:
            end = badge_end_date(w['label']) if w['id'] in synced else None
            acts = [a for a in activities
                    if end and ist_date(a) and end - timedelta(days=6) <= ist_date(a) <= end]
            if acts:
                counts = {r['name']: r['runs_2k'] for r in aggregate(acts, name_map)}
                for a in w['athletes']:
                    if a['name'] in counts:
                        a['runs_2k'] = counts[a['name']]
        save_json(HIST_FILE, hist_weeks)

    mon, sun  = current_week_range()
    cur_badge = badge_text(mon, sun)

    # Dated runs (runs-file) are bucketed by the IST week they started in
    cur_new  = [a for a in new_acts if ist_date(a) is None or ist_date(a) >= mon.date()]
    prev_new = [a for a in new_acts if ist_date(a) is not None and ist_date(a) < mon.date()]

    if should_archive(html):
        prev_badge = parse_current_badge(html)
        prev_wid   = badge_to_week_id(prev_badge)
        prev_end   = badge_end_date(prev_badge)
        prev_start = prev_end - timedelta(days=6)
        late = [a for a in prev_new if prev_start <= ist_date(a) <= prev_end]
        if len(late) < len(prev_new):
            print(f"  Ignoring {len(prev_new) - len(late)} runs from before {prev_start}")
        if all(ist_date(a) is None for a in new_acts):
            late, cur_new = new_acts, []    # API data: can't tell weeks apart

        if week_acts:
            prev_athletes = aggregate(week_acts + late, name_map)
        else:
            # Week was entered by hand: the HTML board is the only record of it
            prev_athletes = merge_runs(parse_current_athletes(html), late, name_map)

        print(f"  Archiving: {prev_badge} ({len(prev_athletes)} athletes)")
        new_hist_entry = {
            'id':       prev_wid,
            'label':    prev_badge,
            'athletes': [{k: v for k, v in a.items() if k != 'color'} for a in prev_athletes],
        }
        if any(w['id'] == prev_wid for w in hist_weeks):
            hist_weeks = [new_hist_entry if w['id'] == prev_wid else w for w in hist_weeks]
        else:
            hist_weeks = [new_hist_entry] + hist_weeks
        save_json(HIST_FILE, hist_weeks)

        # Add the archived week's history card, then start the new week
        html = update_html(html, [], cur_badge, prev_badge, prev_wid, prev_athletes,
                           prev_rank_names=[a['name'] for a in prev_athletes])
        week_acts, prev_rank_names = [], [a['name'] for a in prev_athletes]
        print(f"  Archived. New week: {cur_badge}")
    else:
        # Runs uploaded after their week was archived (e.g. a Sunday run uploaded after midnight IST)
        # go into that week's history entry, which is also what Last Week shows
        last_end = mon.date() - timedelta(days=1)
        late = [a for a in prev_new if last_end - timedelta(days=6) <= ist_date(a) <= last_end]
        if late and hist_weeks and badge_end_date(hist_weeks[0]['label']) == last_end:
            last = hist_weeks[0]
            last['athletes'] = [{k: v for k, v in a.items() if k != 'color'}
                                for a in merge_runs(last['athletes'], late, name_map)]
            save_json(HIST_FILE, hist_weeks)
            html = update_hist_card_meta(html, last['id'], last['athletes'])
            print(f"  Added {len(late)} late runs to last week ({last['label']})")
        else:
            late = []
        if not cur_new and not synced and not late:
            print("No new runs this week — index.html unchanged.")
            return
        if len(prev_new) > len(late):
            print(f"  Ignoring {len(prev_new) - len(late)} runs from before this week")
        prev_rank_names = [a['name'] for a in parse_current_athletes(html)]

    week_acts = week_acts + cur_new
    save_json(WEEK_FILE, week_acts)

    new_athletes = aggregate(week_acts, name_map) if week_acts else []
    print(f"\nWeek: {cur_badge}  |  {len(new_athletes)} athletes")
    for a in new_athletes[:5]:
        print(f"  {a['name']:30s} {a['distance']} km")

    hof = compute_hof(list(seen), week_acts, name_map, hist_weeks)
    html = update_html(html, new_athletes, cur_badge,
                       prev_rank_names=prev_rank_names or None,
                       hist_weeks=hist_weeks, hof=hof)

    with open(HTML_FILE, 'w', encoding='utf-8') as f:
        f.write(html)

    print("\nindex.html updated.")

if __name__ == '__main__':
    main()
