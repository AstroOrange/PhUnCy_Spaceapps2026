# Martian Map: hazard-aware routes on Mars (NASA Space Apps 2026)

A static web app that finds the ONE safest route between candidate Mars landing sites and points of interest,
steering around hazards (steep slopes, unknown terrain), and shows it on a 2D map and in 3D.
Demo region: SpaceX's Starship candidate sites in the Arcadia region (37.5°N to 41°N, 171°W to 163°W).

## What it does
- Map of Mars (NASA Mars Trek MOLA relief / CTX imagery) with candidate sites (black squares) and points of interest (blue diamonds).
- Pick start and end (dropdowns or map clicks) and get one route, found by A* in a Web Worker:
  8-neighbour grid, step cost = distance × (1 + 0.1 × slope°), slopes over the limit (default 15°) are blocked,
  cells with no data are high-cost "unknown", never treated as flat.
- Summary: distance, elevation gain/loss, max slope with a map marker (Measured, from MOLA),
  walk time as a range and safety (Estimated), elevation profile chart.
- "View in 3D": Three.js terrain (≤500×500 vertices, 3× vertical exaggeration, low sun and shadows), real CTX imagery
  draped on top, route drawn as a smoothed tube a few metres above the ground.
- Works offline (PWA): app and elevation data are cached; map tiles you have viewed stay cached.
- Shareable link: the URL hash stores `startLat,startLon,endLat,endLon`.

## Run
    npm install
    npm run dev      # http://localhost:5173
    npm test         # unit tests: distance, slope, A*
    npm run build    # static site in dist/ (deploy to Vercel or GitHub Pages)

## Prepare elevation data (one time, already done for the demo region)
    python -m venv .venv && .venv\Scripts\pip install -r scripts/requirements.txt
    .venv\Scripts\python scripts/prep_dem.py 37.5 41 -171 -163
Reads `data/raw/mola.tif` (the USGS DEM below), writes `public/data/dem.bin`, `slope.bin`, `dem.json`.
Longitudes are -180..180 east. Distances use Mars radius 3389.5 km.

## Data sources
- Elevation: USGS Astrogeology, Mars MGS MOLA DEM 463 m, https://astrogeology.usgs.gov/search/map/mars_mgs_mola_dem_463m
- Base map: NASA Mars Trek WMTS: MOLA colour shaded relief (463 m) and CTX global mosaic (5 m, Caltech Murray Lab), https://trek.nasa.gov/mars/
- Landing sites and points of interest: HiRISE (University of Arizona) image centres of the "Candidate Landing Site for SpaceX Starship"
  and traverse-hazard observations, https://www.uahirise.org (image IDs in `public/sites.json`)
- Erebus Montes reference point: USGS Gazetteer of Planetary Nomenclature, https://planetarynames.wr.usgs.gov/Feature/1821

## Limitations
- 463 m cells: boulders, small craters, cliffs and anything under ~460 m are invisible.
- Loose sand/dust and weather (dust storms) are not modelled.
- Walk time assumes 1.5 to 3 km/h in a suit; it is an estimate, not a plan.
- Site positions are HiRISE image centres, not exact landing points.
- The CTX mosaic has gaps and brightness seams; around Erebus Montes one tile zoom level returns a repeated placeholder.

## AI assistance
AI assistance (Claude Code) was used to write this code.
