#!/usr/bin/env python3
"""Build property-insights.json from the committed MassGIS snapshot.

No network. Reads property-data.json and the eleven property-<TOWN_ID>.json
files written by property-collector.py and precomputes the region-wide
figures the Property tab draws, so the page never has to download all
eleven towns at once. The rules here are mirrored in property.js (use
groups, mailing classes, owner screens, parcel area); change both together.
See property-method.md.
"""
import collections, datetime, json, math, pathlib, re, statistics

ROOT = pathlib.Path(__file__).resolve().parent

# Local mailing-city aliases, same list as the collector.
ALIASES = {'Great Barrington': ['HOUSATONIC', 'GT BARRINGTON', 'GT. BARRINGTON', 'GREAT BARRINGTON MA'],
           'Sheffield': ['ASHLEY FALLS'], 'New Marlborough': ['SOUTHFIELD', 'MILL RIVER', 'HARTSVILLE'],
           'Egremont': ['SOUTH EGREMONT', 'NORTH EGREMONT', 'SO EGREMONT', 'NO EGREMONT'],
           'Becket': ['NORTH BECKET'], 'Otis': ['EAST OTIS']}

USES = ['Residential', 'Commercial / industrial', 'Vacant land', 'Farm, forest & recreation', 'Exempt', 'Other / mixed']
MAIL = ['This town', 'Elsewhere in MA', 'New York', 'Connecticut', 'Other states', 'Not listed']

PUBLIC = re.compile(r'\b(TOWN OF|INHABITANTS|COMMONWEALTH|COMM OF MASS|STATE OF|UNITED STATES|USA|U S A|US GOVT|'
                    r'REGIONAL SCHOOL|SCHOOL DIST|SCHOOL DISTRICT|METROPOLITAN DIST|DEPT OF|DEPARTMENT OF|HOUSING AUTHORITY|'
                    r'FIRE DISTRICT|WATER DISTRICT|COUNTY OF)\b|, TOWN OF\b')
NONPROFIT = re.compile(r'\b(LAND TRUST|CONSERVANCY|TRUSTEES OF RESERVATIONS|AUDUBON|NATURAL RESOURCES|APPALACH\w*|CHURCH|'
                       r'DIOCESE|PARISH|SYNAGOGUE|CONGREGATION|UNIVERSITY|COLLEGE|ACADEMY|YOUNG MENS CHRISTIAN|YMCA|'
                       r'HOSPITAL|ASSOCIATION|ASSN|FOUNDATION|SOCIETY|INSTITUTE|CAMP|SIMONS ROCK|BERKSHIRE SCHOOL)\b')
ENTITY = re.compile(r'\b(LLC|L L C|INC|CORP|CORPORATION|LP|LTD|LLP|COMPANY|CO|HOLDINGS|PARTNERS|PARTNERSHIP|PROPERTIES|REALTY|ASSOCIATES)\b')
TRUST = re.compile(r'\b(TRUST|TRUSTS|TRUSTEE|TRUSTEES|TR|TRS|TRST|TTEE|TTEES|CO-TTEES|CO-TTEE|CO-TRUSTEES|NOMINEE|REVOCABLE|IRREVOCABLE|ESTATE OF)\b')

# Explicit label groups for the largest public and conservation landholders.
# Everything else stays a literal normalized label. Listed on the page.
GROUPS = [
    ('Commonwealth of Massachusetts', re.compile(r'^(COMMONWEALTH OF MASS|COMMONWEALTH OF MA\b|COMM OF MASS|COMMONWEALTH MASS|MASS COMMONWEALTH|STATE OF MASS|MASSACHUSETTS DEPT|MASS DEPT|COMMONWEALTH OF MASSACHUSETTS)')),
    ('United States government', re.compile(r'^(UNITED STATES|USA$|U S A|US GOVT|U S GOVT|UNITED STATES OF AMERICA)')),
    ('Berkshire Natural Resources Council', re.compile(r'^BERKSHIRE NATURAL RESOURCES')),
    ('Mass Audubon', re.compile(r'^MASS(ACHUSETTS)? AUDUBON')),
    ('The Nature Conservancy', re.compile(r'^(THE )?NATURE CONSERVANCY')),
    ('The Trustees of Reservations', re.compile(r'^(THE )?TRUSTEES OF RESERVATIONS')),
    ('Appalachian Trail Conservancy', re.compile(r'^(THE )?APPALACH\w* TRAIL')),
    ('Berkshire County Land Trust', re.compile(r'^BERKSHIRE COUNTY LAND TRUST')),
]


def norm(x):
    return ' '.join(str(x or '').upper().split())


def use_group(code):
    """Broad MA DOR use-code grouping. First three characters of USE_CODE."""
    s = str(code or '')[:3]
    if not s.isdigit():
        return 'Other / mixed'
    c = int(s)
    if c >= 900:
        return 'Exempt'
    if c in (130, 131, 132) or 390 <= c <= 399 or 440 <= c <= 449:
        return 'Vacant land'
    if 100 <= c < 200:
        return 'Residential'
    if 300 <= c < 500:
        return 'Commercial / industrial'
    if 600 <= c < 900:
        return 'Farm, forest & recreation'
    if c < 100 and any(d in '678' for d in s[1:]):
        return 'Farm, forest & recreation'
    return 'Other / mixed'


def mail_class(r, town):
    city, state = norm(r.get('OWN_CITY')), norm(r.get('OWN_STATE'))
    if not city or not state:
        return 'Not listed'
    if state == 'MA':
        return 'This town' if city in {norm(town), *ALIASES.get(town, [])} else 'Elsewhere in MA'
    return {'NY': 'New York', 'CT': 'Connecticut'}.get(state, 'Other states')


def owner_type(name, use):
    if PUBLIC.search(name):
        return 'Public'
    if NONPROFIT.search(name) or use == 'Exempt':
        return 'Nonprofit / conservation'
    return 'Private'


def buyer_type(name):
    if ENTITY.search(name):
        return 'llc'
    if TRUST.search(name):
        return 'trust'
    return 'person'


def group_name(name):
    for label, rx in GROUPS:
        if rx.search(name):
            return label
    return name or '[OWNER NOT LISTED]'


def acres(rings):
    """Planar area of an ESRI polygon (clockwise outer rings) in acres."""
    total = 0.0
    for ring in rings:
        if len(ring) < 4:
            continue
        kx = 111320 * math.cos(math.radians(ring[0][1]))
        ky = 110540
        a = 0.0
        for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
            a += (x1 * kx) * (y2 * ky) - (x2 * kx) * (y1 * ky)
        total += a / 2
    return max(0.0, -total / 4046.8564224)


def sale_date(x, observed):
    s = str(x or '').strip()
    if not re.fullmatch(r'\d{8}', s):
        return None
    try:
        d = datetime.date(int(s[:4]), int(s[4:6]), int(s[6:]))
    except ValueError:
        return None
    return d if 1900 < d.year and d <= observed else None


def quantile(v, q):
    v = sorted(v)
    if not v:
        return None
    i = (len(v) - 1) * q
    lo, hi = math.floor(i), math.ceil(i)
    return v[lo] + (v[hi] - v[lo]) * (i - lo)


def main():
    summary = json.loads((ROOT / 'property-data.json').read_text())
    observed = datetime.date.fromisoformat(summary['retrieved'][:10])
    towns, landholders = [], collections.defaultdict(lambda: {'acres': 0.0, 'value': 0, 'records': 0, 'towns': collections.Counter(), 'labels': collections.Counter(), 'type': collections.Counter()})
    region_sales = collections.defaultdict(lambda: {'n': 0, 'nominal': 0, 'sf': [], 'llc': 0, 'trust': 0, 'person': 0})
    region_cities = collections.Counter()

    for t in summary['towns']:
        name, tid = t['name'], t['id']
        d = json.loads((ROOT / f'property-{tid}.json').read_text())
        recs = d['records']
        shape_acres = collections.defaultdict(float)
        mapped_acres = 0.0
        for f in d['geometry']['features']:
            a = acres(f['geometry']['coordinates'])
            mapped_acres += a
            if str(f['properties'].get('NO_MATCH') or '').upper() != 'Y':
                shape_acres[f['properties']['LOC_ID']] += a
        per_loc = collections.Counter(r['LOC_ID'] for r in recs if r.get('LOC_ID'))

        by_use = {u: {'n': 0, 'value': 0, 'acres': 0.0} for u in USES}
        mail = {m: {'n': 0, 'value': 0} for m in MAIL}
        mail_all = {m: {'n': 0, 'acres': 0.0} for m in MAIL}
        cities, states = collections.Counter(), collections.Counter()
        built = []
        sales = collections.defaultdict(lambda: {'n': 0, 'nominal': 0, 'sf': [], 'llc': 0, 'trust': 0, 'person': 0})
        ratios = []
        owners = collections.defaultdict(lambda: {'n': 0, 'value': 0, 'acres': 0.0, 'type': collections.Counter()})
        land_owner = collections.Counter()
        fy = max(t['fy'])

        for r in recs:
            use = use_group(r.get('USE_CODE'))
            val = r.get('TOTAL_VAL') or 0
            ac = shape_acres.get(r.get('LOC_ID'), 0) / per_loc[r['LOC_ID']] if r.get('LOC_ID') else 0
            label = norm(r.get('OWNER1')) or '[OWNER NOT LISTED]'
            otype = owner_type(label, use)
            mc = mail_class(r, name)
            by_use[use]['n'] += 1; by_use[use]['value'] += val; by_use[use]['acres'] += ac
            mail_all[mc]['n'] += 1; mail_all[mc]['acres'] += ac
            land_owner['Public' if otype == 'Public' else 'Nonprofit / conservation' if otype != 'Private'
                       else ('Private, local or MA' if mc in ('This town', 'Elsewhere in MA') else
                             'Private, out of state' if mc in ('New York', 'Connecticut', 'Other states') else 'Private, address not listed')] += ac
            o = owners[label]; o['n'] += 1; o['value'] += val; o['acres'] += ac; o['type'][otype] += 1
            g = landholders[group_name(label)]
            g['acres'] += ac; g['value'] += val; g['records'] += 1; g['towns'][name] += ac; g['labels'][label] += 1; g['type'][otype] += 1

            if use == 'Residential':
                mail[mc]['n'] += 1; mail[mc]['value'] += val
                if mc not in ('This town', 'Not listed'):
                    city = norm(r.get('OWN_CITY')).title() + ', ' + norm(r.get('OWN_STATE'))
                    cities[city] += 1; region_cities[city] += 1
                if mc in ('New York', 'Connecticut', 'Other states'):
                    states[norm(r.get('OWN_STATE'))] += 1
                yb = r.get('YEAR_BUILT')
                if yb and 1700 < yb <= observed.year:
                    built.append(yb)

            sd, price = sale_date(r.get('LS_DATE'), observed), r.get('LS_PRICE') or 0
            if sd and price > 0:
                y = sd.year
                for bucket in (sales[y], region_sales[y]):
                    bucket['n'] += 1
                    if price < 1000:
                        bucket['nominal'] += 1
                    elif use == 'Residential':
                        bucket[buyer_type(label)] += 1
                    if str(r.get('USE_CODE') or '')[:3] == '101' and price >= 25000:
                        bucket['sf'].append(price)
                if (str(r.get('USE_CODE') or '')[:3] == '101' and price >= 25000 and val > 0
                        and y >= int(r.get('FY') or fy) - 2):
                    ratios.append(price / val)

        total_val = sum(u['value'] for u in by_use.values())
        attributed = sum(u['acres'] for u in by_use.values())
        res_n = by_use['Residential']['n']
        away = sum(mail[m]['n'] for m in ('New York', 'Connecticut', 'Other states'))
        known = res_n - mail['Not listed']['n']
        decades = collections.Counter(min(y // 10 * 10, 2020) if y >= 1900 else 1890 for y in built)
        top_owners = sorted(owners.items(), key=lambda kv: -kv[1]['value'])[:15]
        towns.append({
            'name': name, 'id': tid, 'fy': t['fy'], 'records': len(recs), 'excluded': t['excluded'],
            'value': total_val, 'median': t['median'],
            'mapped_acres': round(mapped_acres), 'acres': round(attributed),
            'uses': {u: {'n': v['n'], 'value': v['value'], 'acres': round(v['acres'], 1)} for u, v in by_use.items()},
            'land_owner': {k: round(v, 1) for k, v in land_owner.items()},
            'mail': mail, 'mail_all': {k: {'n': v['n'], 'acres': round(v['acres'], 1)} for k, v in mail_all.items()},
            'res_records': res_n, 'res_known': known, 'res_away': away,
            'away_share': away / known * 100 if known else 0,
            'away_value_share': sum(mail[m]['value'] for m in ('New York', 'Connecticut', 'Other states')) / max(1, sum(mail[m]['value'] for m in MAIL if m != 'Not listed')) * 100,
            'states': states.most_common(8), 'cities': cities.most_common(12),
            'built': {'n': len(built), 'median': statistics.median(built) if built else None,
                      'q1': quantile(built, .25), 'q3': quantile(built, .75),
                      'p10': quantile(built, .1), 'p90': quantile(built, .9),
                      'since2000': sum(1 for y in built if y >= 2000),
                      'decades': sorted(decades.items())},
            'sales': {y: {'n': v['n'], 'nominal': v['nominal'], 'llc': v['llc'], 'trust': v['trust'], 'person': v['person'],
                          'sf_n': len(v['sf']), 'sf_median': statistics.median(v['sf']) if v['sf'] else None}
                      for y, v in sorted(sales.items())},
            'ratio': {'n': len(ratios), 'median': statistics.median(ratios) if ratios else None,
                      'q1': quantile(ratios, .25), 'q3': quantile(ratios, .75)},
            'top_owners': [{'name': k, 'n': v['n'], 'value': v['value'], 'acres': round(v['acres'], 1),
                            'type': v['type'].most_common(1)[0][0]} for k, v in top_owners],
        })
        print(name, len(recs), round(attributed), f"away {towns[-1]['away_share']:.1f}%", flush=True)

    lh = sorted(landholders.items(), key=lambda kv: -kv[1]['acres'])[:25]
    all_acres = sum(t['acres'] for t in towns)
    out = {
        'retrieved': summary['retrieved'], 'source': summary['source'], 'built': datetime.date.today().isoformat(),
        'uses': USES, 'mail': MAIL, 'towns': towns,
        'region': {
            'records': sum(t['records'] for t in towns), 'value': sum(t['value'] for t in towns), 'acres': round(all_acres),
            'sales': {y: {'n': v['n'], 'nominal': v['nominal'], 'llc': v['llc'], 'trust': v['trust'], 'person': v['person'],
                          'sf_n': len(v['sf']), 'sf_median': statistics.median(v['sf']) if v['sf'] else None}
                      for y, v in sorted(region_sales.items())},
            'cities': region_cities.most_common(15),
            'landholders': [{'name': k, 'acres': round(v['acres'], 1), 'value': v['value'], 'records': v['records'],
                             'share': v['acres'] / all_acres * 100,
                             'type': v['type'].most_common(1)[0][0],
                             'towns': [[n, round(a, 1)] for n, a in v['towns'].most_common()],
                             'labels': [n for n, _ in v['labels'].most_common(6)], 'label_count': len(v['labels'])}
                            for k, v in lh],
        },
    }
    (ROOT / 'property-insights.json').write_text(json.dumps(out, separators=(',', ':'), ensure_ascii=True))
    print('BYTES', (ROOT / 'property-insights.json').stat().st_size)


if __name__ == '__main__':
    main()
