#!/usr/bin/env python3
"""
Nightly KFS leaderboard updater.
- Every night: fetch new club activities, add to current week, update index.html
- Sunday night: also archive last week first, then start fresh
"""
import os, re, json, requests
from datetime import datetime, timedelta, timezone
from collections import defaultdict

CLIENT_ID     = os.environ['STRAVA_CLIENT_ID']
CLIENT_SECRET = os.environ['STRAVA_CLIENT_SECRET']
REFRESH_TOKEN = os.environ['STRAVA_REFRESH_TOKEN']
CLUB_ID       = os.environ['STRAVA_CLUB_ID']

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
    r = requests.post('https://www.strava.com/oauth/token', data={
        'client_id':     CLIENT_ID,
        'client_secret': CLIENT_SECRET,
        'refresh_token': REFRESH_TOKEN,
        'grant_type':    'refresh_token',
    })
    r.raise_for_status()
    return r.json()['access_token']

def fetch_club_activities(token):
    hdrs, all_acts = {'Authorization': f'Bearer {token}'}, []
    for page in range(1, 15):
        r = requests.get(
            f'https://www.strava.com/api/v3/clubs/{CLUB_ID}/activities',
            headers=hdrs, params={'per_page': 200, 'page': page}
        )
        r.raise_for_status()
        batch = r.json()
        all_acts.extend(batch)
        if len(batch) < 200:
            break
    return all_acts

# ── State files ───────────────────────────────────────────────────────────────

def fingerprint(a):
    return f"{a['athlete']['firstname']}|{a['athlete']['lastname']}|{a['distance']}|{a['moving_time']}"

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

def avg_pace_str_val(elapsed_secs, dist_m):
    if dist_m < 10:
        return '--', 9999
    spk = elapsed_secs / (dist_m / 1000)
    return f"{int(spk//60)}:{int(spk%60):02d}", int(spk)

def aggregate(activities, name_map):
    data = defaultdict(lambda: dict(
        distance=0.0, runs=0, longest=0.0,
        best_pv=9999, best_pace='--', elev=0.0,
        moving_total=0, elapsed_total=0, distance_raw=0.0
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
        d['distance_raw'] += a['distance']
        d['moving_total']  += a['moving_time']
        d['elapsed_total'] += a.get('elapsed_time', a['moving_time'])
        if dk > d['longest']: d['longest'] = dk
        if pv < d['best_pv']:
            d['best_pv']   = pv
            d['best_pace'] = ps
        d['elev'] += a.get('total_elevation_gain', 0)

    rows = sorted(data.items(), key=lambda x: -x[1]['distance'])
    result = []
    for i, (name, d) in enumerate(rows):
        ap, apv = avg_pace_str_val(d['moving_total'], d['distance_raw'])
        result.append({
            'name':        name,
            'distance':    d['distance'],
            'runs':        d['runs'],
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

def week_html_id(monday):
    months = {1:'jan',2:'feb',3:'mar',4:'apr',5:'may',6:'jun',
              7:'jul',8:'aug',9:'sep',10:'oct',11:'nov',12:'dec'}
    return f"{months[monday.month]}{monday.day}"

def next_week_range():
    ist    = timezone(timedelta(hours=5, minutes=30))
    today  = datetime.now(ist)
    monday = (today - timedelta(days=today.weekday())).replace(
                 hour=0, minute=0, second=0, microsecond=0)
    monday += timedelta(days=7)
    sunday = monday + timedelta(days=6)
    return monday, sunday

def is_sunday():
    ist = timezone(timedelta(hours=5, minutes=30))
    now = datetime.now(ist)
    return now.weekday() == 6 or (now.weekday() == 0 and now.hour < 10)

# ── HoF computation ───────────────────────────────────────────────────────────

# Names excluded from ALL speed records
SPEED_EXCLUDED_NAMES = {'Amol Jain'}

# Fingerprints excluded from speed records (cheated/invalid runs)
SPEED_EXCLUDED_FPS = set()

SPEED_BANDS = {
    '5K':   (4800,  5600),
    '10K':  (9500,  10500),
    '21K':  (20500, 22000),
    '42K':  (41500, 43000),
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
        elapsed_lookup[fp] = a.get('elapsed_time', a['moving_time'])

    # ── Speed records ─────────────────────────────────────────────────────────
    speed = {}
    for band, (lo, hi) in SPEED_BANDS.items():
        runs = []
        for fp in seen_fps:
            if fp in SPEED_EXCLUDED_FPS:
                continue
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
        runs.sort()
        top3, seen_names = [], set()
        for elapsed, name, dist in runs:
            if name not in seen_names:
                top3.append({
                    'name':    name,
                    'time':    elapsed,
                    'timeStr': fmt_time(elapsed),
                    'pace':    fmt_pace(elapsed, dist),
                })
                seen_names.add(name)
            if len(top3) == 3:
                break
        speed[band] = top3

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
            runs = a['runs']

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
    if not m: return []
    result = []
    for obj in re.finditer(r'\{([^}]+)\}', m.group(1)):
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
        html = html.replace(
            '    <div class="hist-week-card"',
            hist_card + '    <div class="hist-week-card"',
            1
        )

    return html

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print("Getting Strava access token...")
    token = get_access_token()

    print("Fetching club activities...")
    activities = fetch_club_activities(token)
    print(f"  {len(activities)} activities from API")

    seen     = set(load_json(SEEN_FILE, []))
    name_map = load_json(NAME_MAP, {})

    new_acts = [a for a in activities if fingerprint(a) not in seen]
    print(f"  {len(new_acts)} new since last run")

    known_names = set('|'.join(fp.split('|')[:2]) for fp in seen)
    def is_new_runner(a):
        return f"{a['athlete']['firstname']}|{a['athlete']['lastname']}" not in known_names

    from collections import Counter
    new_runner_counts = Counter(
        f"{a['athlete']['firstname']}|{a['athlete']['lastname']}"
        for a in new_acts if is_new_runner(a)
    )

    seen.update(fingerprint(a) for a in activities)
    save_json(SEEN_FILE, sorted(seen))

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

    sunday    = is_sunday()
    week_acts = load_json(WEEK_FILE, [])
    hist_weeks = load_json(HIST_FILE, [])

    with open(HTML_FILE, encoding='utf-8') as f:
        html = f.read()

    mon, sun  = current_week_range()
    cur_badge = badge_text(mon, sun)

    if sunday:
        print("It's Sunday IST — archiving this week and starting fresh.")
        full_week_acts = week_acts + new_acts

        prev_badge = parse_current_badge(html)
        prev_wid   = badge_to_week_id(prev_badge)

        if full_week_acts:
            prev_athletes = aggregate(full_week_acts, name_map)
        else:
            prev_athletes = parse_current_athletes(html)

        print(f"  Archiving: {prev_badge} ({len(prev_athletes)} athletes)")

        # Prepend new week to historical_weeks.json
        new_hist_entry = {
            'id':       prev_wid,
            'label':    prev_badge,
            'athletes': [{k: v for k, v in a.items() if k != 'color'}
                         for a in prev_athletes],
        }
        hist_weeks = [new_hist_entry] + hist_weeks
        save_json(HIST_FILE, hist_weeks)

        save_json(WEEK_FILE, [])

        nmon, nsun = next_week_range()
        new_badge  = badge_text(nmon, nsun)

        # Compute HoF with updated history (no current week on Sunday reset)
        hof = compute_hof(list(seen), [], name_map, hist_weeks)

        html = update_html(html, [], new_badge,
                           prev_badge, prev_wid, prev_athletes,
                           prev_rank_names=[],
                           hist_weeks=hist_weeks, hof=hof)
        with open(HTML_FILE, 'w', encoding='utf-8') as f:
            f.write(html)
        print(f"  Archived. New week: {new_badge}")
        return

    # Mid-week: append new activities
    week_acts = week_acts + new_acts
    save_json(WEEK_FILE, week_acts)

    if not week_acts:
        print("No activities this week yet — skipping HTML update.")
        return

    prev_rank_names = [a['name'] for a in parse_current_athletes(html)]
    new_athletes    = aggregate(week_acts, name_map)

    print(f"\nWeek: {cur_badge}  |  {len(new_athletes)} athletes")
    for a in new_athletes[:5]:
        print(f"  {a['name']:30s} {a['distance']} km")

    # Compute HoF including current week activities
    hof = compute_hof(list(seen), week_acts, name_map, hist_weeks)

    html = update_html(html, new_athletes, cur_badge,
                       prev_rank_names=prev_rank_names,
                       hist_weeks=hist_weeks, hof=hof)

    with open(HTML_FILE, 'w', encoding='utf-8') as f:
        f.write(html)

    print("\nindex.html updated.")

if __name__ == '__main__':
    main()
