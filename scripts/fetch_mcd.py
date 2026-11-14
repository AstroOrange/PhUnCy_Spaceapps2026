"""Fetch a seasonal weather table for the region centre from the Mars Climate Database v6.2 web interface (LMD).

Usage: python scripts/fetch_mcd.py LAT LON_EAST_0_360 [--out public/data/climate.json]
One row per Mars month (Ls 0, 30, ... 330): dust optical depth (average year and dust-storm scenario),
surface temperature at 13:00 and 04:00 local time, and wind speed 10 m above the ground at 13:00.
"""
import argparse, json, re, time, urllib.parse, urllib.request

URL = 'https://www-mars.lmd.jussieu.fr/mcd_python/cgi-bin/mcdcgi.py?'
p = argparse.ArgumentParser()
p.add_argument('lat', type=float)
p.add_argument('lon', type=float)
p.add_argument('--out', default='public/data/climate.json')
a = p.parse_args()

def query(ls, hour, scenario, *names):
    params = dict(datekeyhtml=1, ls=ls, localtime=hour, latitude=a.lat, longitude=a.lon, altitude=10, zkey=3,
                  dust=scenario, hrkey=1, isfixedlt='off', averaging='off', spacecraft='none',
                  var1=names[0], var2=names[1] if len(names) > 1 else 'none',
                  var3=names[2] if len(names) > 2 else 'none', var4='none')
    for attempt in range(4):  # the public server sometimes drops connections: retry with a growing pause
        try:
            text = re.sub(r'<[^>]+>', ' ', urllib.request.urlopen(URL + urllib.parse.urlencode(params), timeout=120).read().decode())
            break
        except OSError:
            if attempt == 3:
                raise
            time.sleep(15 * (attempt + 1))
    time.sleep(3)  # be polite to the public server
    return [float(v) for v in re.findall(r'\.\.\.\.\.\s+(-?[\d.]+(?:[eE][-+]?\d+)?)', text)]

rows = []
for ls in range(0, 360, 30):
    tau, t_day, wind = query(ls, 13, 1, 'tauref', 'tsurf', 'wind')
    (t_night,) = query(ls, 4, 1, 'tsurf')
    # The model's dust-storm scenario only exists in dust-storm season (180 < Ls < 360); null outside it
    tau_storm = query(ls, 13, 5, 'tauref')[0] if 180 < ls < 360 else None
    rows.append(dict(ls=ls, dust=round(tau, 2), dust_storm=tau_storm and round(tau_storm, 2), t_day=round(t_day - 273.15),
                     t_night=round(t_night - 273.15), wind=round(wind, 1)))
    print(rows[-1])
json.dump({'source': 'Mars Climate Database v6.2, LMD/OU/IAA/ESA/CNES (climatology average solar; dust storm average solar)',
           'lat': a.lat, 'lon_east': a.lon, 'rows': rows}, open(a.out, 'w'), indent=1)
