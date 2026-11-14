# Martian Map: hazard-aware routes on Mars (NASA Space Apps 2026)

A static web app that finds the ONE safest route between candidate Mars landing sites and points of interest,
steering around hazards, and shows it on a 2D map and in 3D.
Regions (pick one in the app; listed in `public/data/regions.json`):
- Arcadia Planitia: SpaceX Starship candidate sites (37.5°N to 41°N, 171°W to 163°W).
- Jezero Crater: Perseverance landing site (16°N to 20.5°N, 75°E to 79.5°E).
- Gale Crater: Curiosity landing site and Aeolis Mons / Mount Sharp (7.5°S to 3°S, 135.5°E to 140°E).

## What it does
- Map of Mars (NASA Mars Trek MOLA relief / CTX imagery) with rover landing sites (ringed dots), candidate sites (black squares)
  and points of interest (open diamonds).
- Pick a start, such as a rover landing site, then click the map to drop a destination pin. Both pins can be dragged and the
  route updates. You get one route, found by A* in a Web Worker on an 8-neighbour grid:
  step cost = distance × (1 + 0.1 × slope° + extra hazards). Slopes over the limit (default 15°) are blocked;
  cells with no data are high-cost "unknown", never treated as flat.
- Extra hazards, each with its own penalty slider and map overlay:
  - Loose or dusty ground: from TES thermal inertia and the TES Dust Cover Index (`src/hazards.js`).
  - Crater rims: distance to the rim crest of every crater 1 km or wider in the Robbins & Hynek catalog.
- Route to the nearest likely ice: from point A to the closest cell where the SWIM ice-consistency score (ice within 1 m) is 0.25 or more.
- Weather by season: dust opacity, ground temperature and wind for each Mars month from the Mars Climate Database, with warnings.
- Summary: distance, climb/descent, steepest slope with a map marker (Measured, from MOLA); walking time, loose ground,
  crater rims, ice score and weather (Estimated); elevation profile chart.
- "3D view": Three.js terrain (≤500×500 vertices, 3× vertical exaggeration, low sun and shadows), real CTX imagery
  draped on top, route drawn as a smoothed tube a few metres above the ground.
- Works offline (PWA): app and data are cached; map tiles you have viewed stay cached.
- Shareable link: the URL hash stores `region/startLat,startLon,endLat,endLon` (old `#lat,lon,lat,lon` links open Arcadia).

## Run
    npm install
    npm run dev      # http://localhost:5173
    npm test         # unit tests: distance, slope, A*, hazards
    npm run build    # static site in dist/ (deploy to Vercel or GitHub Pages)

## Prepare data (one time per region)
Each region's data lives in `public/data/<region>/`. A region without data still shows its sites on the map, but routing
is off until its data is prepared. Windows commands (on Mac/Linux use `.venv/bin/` and `\` instead of `^`):

    python -m venv .venv && .venv\Scripts\pip install -r scripts/requirements.txt

Arcadia (done):

    .venv\Scripts\python scripts/prep_dem.py 37.5 41 -171 -163 --out public/data/arcadia --layer ice=data/raw/swim/SWIM2_c0_1.tif ^
        --layer ti=data/raw/ti/ti_arcadia.tif --layer dci=data/raw/dci/dci_16ppd.tif --craters data/raw/craters/craters2020.csv.zip
    .venv\Scripts\python scripts/fetch_mcd.py 39.25 193 --out public/data/arcadia/climate.json

Jezero:

    .venv\Scripts\python scripts/prep_dem.py 16 20.5 75 79.5 --out public/data/jezero --layer ice=data/raw/swim/SWIM2_c0_1.tif ^
        --layer ti=data/raw/ti/ti_jezero.tif --layer dci=data/raw/dci/dci_16ppd.tif --craters data/raw/craters/craters2020.csv.zip
    .venv\Scripts\python scripts/fetch_mcd.py 18.25 77.25 --out public/data/jezero/climate.json

Gale (SWIM has no ice data south of the equator, so there is no ice layer):

    .venv\Scripts\python scripts/prep_dem.py -7.5 -3 135.5 140 --out public/data/gale ^
        --layer ti=data/raw/ti/ti_gale.tif --layer dci=data/raw/dci/dci_16ppd.tif --craters data/raw/craters/craters2020.csv.zip
    .venv\Scripts\python scripts/fetch_mcd.py -5.25 137.75 --out public/data/gale/climate.json

`prep_dem.py` reads `data/raw/mola.tif` (the global USGS DEM) and resamples every `--layer` raster onto the same grid, writing
`*.bin` and `dem.json` into `--out`. Instead of the 2 GB download, `--src` can be the USGS file's URL
(`--src https://planetarymaps.usgs.gov/mosaic/Mars_MGS_MOLA_DEM_mosaic_global_463m.tif`): only the part covering the box is read.
Every layer is optional, and a layer with no data inside the box is skipped. `ti_<region>.tif` is a TES thermal inertia export
for that box from the JMARS map server, made the same way as `ti_arcadia.tif`. `fetch_mcd.py` writes the region's `climate.json`.
To add another region, add it to `public/data/regions.json` (and its sites to `public/sites.json`, with `"region"`), then run the two scripts.
Longitudes are -180..180 east (except `fetch_mcd.py`, which takes 0..360 east). Distances use Mars radius 3389.5 km.

## Data sources
- Elevation: USGS Astrogeology, Mars MGS MOLA DEM 463 m, https://astrogeology.usgs.gov/search/map/mars_mgs_mola_dem_463m
- Base map: NASA Mars Trek WMTS: MOLA colour shaded relief (463 m) and CTX global mosaic (5 m, Caltech Murray Lab), https://trek.nasa.gov/mars/
- Rover landing sites: NASA/JPL (Perseverance at Octavia E. Butler Landing, Curiosity at Bradbury Landing)
- Landing sites and points of interest: HiRISE (University of Arizona) image centres of the "Candidate Landing Site for SpaceX Starship"
  and traverse-hazard observations, https://www.uahirise.org (image IDs in `public/sites.json`)
- Ice: SWIM 2.0 combined ice consistency, 0-1 m (Planetary Science Institute / NASA), https://swim.psi.edu/SWIM2Products.php
- Thermal inertia: TES nighttime thermal inertia, Putzig & Mellon (2007), via the ASU JMARS map server, https://www.mars.asu.edu/data/tes_putzigti/nightside2007/
- Dust cover: TES Dust Cover Index, Ruff & Christensen (2002), https://www.mars.asu.edu/~ruff/DCI/dci.html
- Craters: Robbins & Hynek (2012) Mars crater database, 2020 release, https://craters.sjrdesign.net/
- Weather: Mars Climate Database v6.2 (LMD/OU/IAA/ESA/CNES) web interface, https://www-mars.lmd.jussieu.fr/mcd_python/
- Named features (Erebus Montes, Jezero, Gale, Aeolis Mons): USGS Gazetteer of Planetary Nomenclature, https://planetarynames.wr.usgs.gov/

## Limitations
- 463 m cells: boulders, small craters, cliffs and anything under ~460 m are invisible.
- Loose ground, ice and crater data are coarser than the grid (SWIM about 3 km, TES about 3 km); they mark zones, not exact spots.
- Ice scores in this region peak at about 0.37 on a -1 to +1 scale: "likely" means the orbiter data is consistent with ice, not proof.
- Craters wider than 100 km are skipped as rims: these ancient basins are worn down and their relief is already in the slope grid.
- Ice: SWIM covers the northern mid-latitudes, so Gale has no ice layer and no "nearest likely ice" route.
- Weather is a climate model for one point at the region centre, not a forecast. Dust storm values exist only in storm season (Ls 180 to 360).
- Walk time assumes 1.5 to 3 km/h in a suit; it is an estimate, not a plan.
- Site positions are HiRISE image centres, not exact landing points.
- The CTX mosaic has gaps and brightness seams; around Erebus Montes one tile zoom level returns a repeated placeholder.

## AI assistance
AI assistance (Claude Code) was used to write this code.
