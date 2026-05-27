#!/usr/bin/env python3
"""
Nightly KFS leaderboard updater.
- Every night: fetch new club activities, add to current week, update index.html
- Monday night: also archive last week first, then start fresh
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
    json.dump(data, open(path, 'w'), indent=2)

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
        # avgPace uses moving_time (matches Strava display)
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
    """Mon → Sun for the current week in IST."""
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
    """Mon → Sun for next week in IST."""
    ist    = timezone(timedelta(hours=5, minutes=30))
    today  = datetime.now(ist)
    monday = (today - timedelta(days=today.weekday())).replace(
                 hour=0, minute=0, second=0, microsecond=0)
    monday += timedelta(days=7)
    sunday = monday + timedelta(days=6)
    return monday, sunday

def is_sunday():
    # Use IST (UTC+5:30) — the club's home timezone
    # Also catches Monday before 10am IST in case Sunday night run failed/was old code
    ist = timezone(timedelta(hours=5, minutes=30))
    now = datetime.now(ist)
    return now.weekday() == 6 or (now.weekday() == 0 and now.hour < 10)

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

def make_hist_js_entry(wid, athletes):
    ath_js = athletes_to_js(athletes, with_color=False)
    return f'  "hist-week-{wid}": {{\n    sortKey: "distance",\n    athletes: [\n{ath_js},\n    ]\n  }},\n'

def update_html(html, new_athletes, new_badge,
                prev_badge=None, prev_wid=None, prev_athletes=None,
                prev_rank_names=None):
    # Update week badge
    old_badge = parse_current_badge(html)
    html = html.replace(
        f'<div class="week-badge"><span>{old_badge}</span></div>',
        f'<div class="week-badge"><span>{new_badge}</span></div>',
    )

    # Save current ranking as prevAthletes before overwriting
    prev_names_js = ', '.join(f'"{n}"' for n in (prev_rank_names or []))
    html = re.sub(
        r'const prevAthletes = \[.*?\];',
        f'const prevAthletes = [{prev_names_js}];',
        html, flags=re.DOTALL
    )

    # Replace athletes array (may be empty on Sunday reset)
    athletes_js = athletes_to_js(new_athletes) if new_athletes else ''
    html = re.sub(
        r'const athletes = \[.*?\];',
        f'const athletes = [\n{athletes_js}\n];',
        html, flags=re.DOTALL
    )

    # On Monday: archive previous week into history
    if prev_badge and prev_wid and prev_athletes:
        hist_card  = make_hist_html_card(prev_wid, prev_badge, prev_athletes)
        hist_entry = make_hist_js_entry(prev_wid, prev_athletes)

        html = html.replace(
            '    <div class="hist-week-card"',
            hist_card + '    <div class="hist-week-card"',
            1
        )
        html = html.replace(
            'const historicalWeeks = {\n',
            f'const historicalWeeks = {{\n{hist_entry}',
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

    # Find activities we haven't seen before
    new_acts = [a for a in activities if fingerprint(a) not in seen]
    print(f"  {len(new_acts)} new since last run")

    # Identify runners we have NEVER seen before (no prior fingerprint for their name)
    known_names = set('|'.join(fp.split('|')[:2]) for fp in seen)
    def is_new_runner(a):
        return f"{a['athlete']['firstname']}|{a['athlete']['lastname']}" not in known_names

    # Count new activities per new runner
    from collections import Counter
    new_runner_counts = Counter(
        f"{a['athlete']['firstname']}|{a['athlete']['lastname']}"
        for a in new_acts if is_new_runner(a)
    )

    # Update seen set (all activities, including new runners' history)
    seen.update(fingerprint(a) for a in activities)
    save_json(SEEN_FILE, sorted(seen))

    # For brand-new runners with many new activities (> 3), skip them —
    # they likely have multi-week history that predates the current week.
    # Strava club API returns no dates so we can't filter by week.
    # Runners with 1-3 new activities are genuinely starting this week → include them.
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
        print(f"  New runners with history skipped (will track from next run): {', '.join(names)}")

    sunday = is_sunday()

    # Load this week's accumulated activities
    week_acts = load_json(WEEK_FILE, [])

    with open(HTML_FILE) as f:
        html = f.read()

    mon, sun  = current_week_range()
    cur_badge = badge_text(mon, sun)

    if sunday:
        print("It's Sunday IST — archiving this week and starting fresh.")
        # Include any runs done today (Sunday) in the archived week
        full_week_acts = week_acts + new_acts

        prev_badge = parse_current_badge(html)
        prev_wid   = badge_to_week_id(prev_badge)

        # Build prev_athletes from the JSON accumulator — more reliable than regex-parsing HTML
        if full_week_acts:
            prev_athletes = aggregate(full_week_acts, name_map)
        else:
            prev_athletes = parse_current_athletes(html)  # fallback: nothing in accumulator

        print(f"  Archiving: {prev_badge} ({len(prev_athletes)} athletes, "
              f"{len(new_acts)} Sunday runs included)")

        # Reset accumulator for the new week
        save_json(WEEK_FILE, [])

        # Badge for the incoming week (next Mon–Sun)
        nmon, nsun = next_week_range()
        new_badge  = badge_text(nmon, nsun)

        html = update_html(html, [], new_badge, prev_badge, prev_wid, prev_athletes, prev_rank_names=[])
        with open(HTML_FILE, 'w') as f:
            f.write(html)
        print(f"  Archived. New week badge: {new_badge}")
        print("  Leaderboard starts empty — Monday's run will be first.")
        return

    # Mid-week: append new activities to this week's accumulator
    week_acts = week_acts + new_acts
    save_json(WEEK_FILE, week_acts)

    if not week_acts:
        print("No activities this week yet — skipping HTML update.")
        return

    # Capture current ranking before overwriting (for daily rank-change arrows)
    prev_rank_names = [a['name'] for a in parse_current_athletes(html)]

    # Aggregate all of this week's activities
    new_athletes = aggregate(week_acts, name_map)

    print(f"\nWeek: {cur_badge}  |  {len(new_athletes)} athletes")
    for a in new_athletes[:5]:
        print(f"  {a['name']:30s} {a['distance']} km")

    html = update_html(html, new_athletes, cur_badge, prev_rank_names=prev_rank_names)

    with open(HTML_FILE, 'w') as f:
        f.write(html)

    print("\nindex.html updated.")

if __name__ == '__main__':
    main()
