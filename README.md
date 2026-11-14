# Martian Map: hazard-aware routes on Mars (NASA Space Apps 2026)

A static web app that plans safe Marswalks: it finds the ONE safest route between landing sites and science stops,
steering around hazards, and shows it on a 2D map and in 3D.
Demo region: Oxia Planum (16.5°N to 20°N, 26.5°W to 22.5°W, about 207 x 225 km), clay-rich terrain about 4 billion years old
and the planned landing site of ESA's Rosalind Franklin rover. The earlier Arcadia Planitia version (SpaceX Starship
candidate sites, shallow ice) is kept under the git tag `arcadia-version`.

## What it does
- Map of Mars (NASA Mars Trek MOLA relief / CTX imagery) with candidate sites (black squares) and points of interest (open diamonds).
- Pick start and end (dropdowns or map clicks) and get one route, found by A* in a Web Worker on an 8-neighbour grid:
  step cost = distance × (1 + 0.1 × slope° + extra hazards). Slopes over the limit (default 15°) are blocked;
  cells with no data are high-cost "unknown", never treated as flat.
- Extra hazards, each with its own penalty slider and map overlay:
  - Loose or dusty ground: from TES thermal inertia and the TES Dust Cover Index (`src/hazards.js`).
  - Crater rims: distance to the rim crest of every crater 1 km or wider in the Robbins & Hynek catalog.
- Route to the nearest likely ice: from point A to the closest cell where the SWIM ice-consistency score (ice within 1 m) is 0.25 or more.
  Hidden when no cell in the region reaches that score (as in Oxia Planum, where the score stays below 0.1).
- Weather by season: dust opacity, ground temperature and wind for each Mars month from the Mars Climate Database, with warnings.
- Marswalk plan: travel on foot or by unpressurised rover (2 astronauts), EVA length 4/6/8 h; checks whether the
  out-and-back trip fits one EVA, gives the furthest reachable target, and estimates the radiation dose outside
  (Curiosity RAD surface rate, about 0.67 mSv/day). Speeds are assumptions: 1.5-3 km/h on foot, 5-10 km/h by rover.
- Science stops: add any number of stops; the route goes A -> stops -> B, leg by leg.
- Go (simulated navigation): an astronaut marker moves along the route at the slower planned speed (about 60 s
  for the whole trip), with distance and direction to the next stop, EVA time used and left, radiation so far,
  hazards in the next 1 km, and a turn-back alert. Position is simulated: Mars has no GPS, so a real mission
  would use suit or rover motion tracking and camera matching to orbital maps.
- Site popups link to the HiRISE close-ups; the panel lists the data types used (topographic, optical, thermal,
  spectral, geophysical, atmospheric, radiation, geologic).
- Summary: distance, climb/descent, steepest slope with a map marker (Measured, from MOLA); walking time, loose ground,
  crater rims, ice score and weather (Estimated); elevation profile chart.
- "3D view": Three.js terrain (≤500×500 vertices, 3× vertical exaggeration, low sun and shadows), real CTX imagery
  draped on top, route drawn as a smoothed tube a few metres above the ground.
- Works offline (PWA): app and data are cached; map tiles you have viewed stay cached.
- Shareable link: the URL hash stores `startLat,startLon,endLat,endLon`.

## Run
    npm install
    npm run dev      # http://localhost:5173
    npm test         # unit tests: distance, slope, A*, hazards
    npm run build    # static site in dist/ (deploy to Vercel or GitHub Pages)

## Prepare data (one time, already done for the demo region)
    python -m venv .venv && .venv\Scripts\pip install -r scripts/requirements.txt
    .venv\Scripts\python scripts/prep_dem.py 16.5 20 -26.5 -22.5 --layer ice=data/raw/swim/SWIM2_c0_1.tif ^
        --layer ti=data/raw/ti/ti_oxia.tif --layer dci=data/raw/dci/dci_16ppd.tif --craters data/raw/craters/craters2020.csv.zip
    .venv\Scripts\python scripts/fetch_mcd.py 18.25 335.5
`prep_dem.py` reads `data/raw/mola.tif` (USGS DEM) and resamples every `--layer` raster onto the same grid, writing
`public/data/*.bin` and `dem.json`. `fetch_mcd.py` writes `public/data/climate.json`.
Longitudes are -180..180 east (except `fetch_mcd.py`, which takes 0..360 east). Distances use Mars radius 3389.5 km.

## Data sources
- Elevation: USGS Astrogeology, Mars MGS MOLA DEM 463 m, https://astrogeology.usgs.gov/search/map/mars_mgs_mola_dem_463m
- Base map: NASA Mars Trek WMTS: MOLA colour shaded relief (463 m) and CTX global mosaic (5 m, Caltech Murray Lab), https://trek.nasa.gov/mars/
- Landing sites and science stop: HiRISE (University of Arizona) image centres of the "Candidate ExoMars Landing Site in Oxia Palus"
  images (2015-2016) and "Clay-Rich Terrain in Oxia Planum" (2014), https://www.uahirise.org (image IDs in `public/sites.json`)
- Ice: SWIM 2.0 combined ice consistency, 0-1 m (Planetary Science Institute / NASA), https://swim.psi.edu/SWIM2Products.php
- Thermal inertia: TES nighttime thermal inertia, Putzig & Mellon (2007), via the ASU JMARS map server, https://www.mars.asu.edu/data/tes_putzigti/nightside2007/
- Dust cover: TES Dust Cover Index, Ruff & Christensen (2002), https://www.mars.asu.edu/~ruff/DCI/dci.html
- Craters: Robbins & Hynek (2012) Mars crater database, 2020 release, https://craters.sjrdesign.net/
- Weather: Mars Climate Database v6.2 (LMD/OU/IAA/ESA/CNES) web interface, https://www-mars.lmd.jussieu.fr/mcd_python/
- Oxia Planum reference point: USGS Gazetteer of Planetary Nomenclature, https://planetarynames.wr.usgs.gov

## Limitations
- 463 m cells: boulders, small craters, cliffs and anything under ~460 m are invisible.
- Loose ground, ice and crater data are coarser than the grid (SWIM about 3 km, TES about 3 km); they mark zones, not exact spots.
- Oxia Planum has no shallow-ice signal (SWIM score at most 0.09), so water would have to come from clay minerals, not ice.
- Craters wider than 100 km are skipped as rims: these ancient basins are worn down and their relief is already in the slope grid.
- Weather is a climate model for one point at the region centre, not a forecast. Dust storm values exist only in storm season (Ls 180 to 360).
- Walk time assumes 1.5 to 3 km/h in a suit; it is an estimate, not a plan.
- Site positions are HiRISE image centres, not exact landing points or ESA's official landing ellipse.
- The CTX mosaic has gaps and brightness seams; around Erebus Montes one tile zoom level returns a repeated placeholder.

## AI assistance
AI assistance (Claude Code) was used to write this code.
