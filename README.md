# Arcadia Pathfinder: safe Marswalks on Mars (NASA Space Apps 2026)

A static web app, like a route planner for Mars, that finds the safest route between candidate landing sites and science
stops and steers around hazards. It uses only measured data from NASA missions and peer-reviewed catalogs.

Region: Arcadia and Amazonis Planitia (37.5°N to 41°N, 171°W to 156°W, about 207 x 690 km), flat lowland plains with
shallow ice, where SpaceX imaged candidate Starship landing sites with HiRISE.

## What it does
- Search a site (S4, P1) or coordinates ("39.8, -157.9"), then route from or to it.
- From and To from a list or by clicking the map, a Swap button, and science stops (A, stops, B).
- Three alternative routes, like a road map's options: Safest (strongest hazard avoidance), Balanced and Shortest
  (still under the slope limit). Cards compare distance, climb, steepest slope, loose ground and crater rims;
  click a card or a grey line to switch.
- Step-by-step directions ("Head east for 35.7 km") with hazard notes; click a step to zoom to it.
- "What's here?": right-click anywhere for measured elevation, slope, ice score, loose ground and crater-rim proximity.
- Avoid options (loose or dusty ground, crater rims), a slope limit, and a route to the nearest likely ice.
- Elevation profile chart, a scale bar measured on Mars, base maps (relief, Viking colour, CTX imagery) and data overlays.
- Works offline (PWA). Shareable link: the URL hash stores `startLat,startLon,endLat,endLon`.

## How routes are found
A* search on an 8-neighbour grid of MOLA elevation cells (1/128°, about 462 m north-south).
Step cost = distance × (1 + k × slope° + hazard terms), where slope is the larger of the cell slope and the step grade.
Steps over the slope limit (default 15°) are blocked; cells with no elevation data are scored like a 75° slope, never as flat.
Safest uses k = 0.1 and hazard weight 2, Balanced k = 0.05 and weight 1, Shortest k = 0.01 and no hazard weight.
Loose ground is a 0 to 1 score from TES thermal inertia (150+ firm, 60 or lower powder) and the TES Dust Cover Index
(0.95+ low dust, 0.92 or lower dusty); these cut-offs are ours. Crater rims score 1 on the rim crest of each catalog crater
1 km to 100 km wide, fading to 0 within a quarter of the radius (at most 2 km).

## Run
    npm install
    npm run dev      # http://localhost:5173
    npm test         # unit tests: distance, slope, A*, hazards
    npm run build    # static site in dist/ (deploy to Vercel or GitHub Pages)

## Prepare data (one time, already done)
    python -m venv .venv && .venv\Scripts\pip install -r scripts/requirements.txt
    .venv\Scripts\python scripts/prep_dem.py 37.5 41 -171 -156 --layer ice=data/raw/swim/SWIM2_c0_1.tif ^
        --layer ti=data/raw/ti/ti_arcadia_wide.tif --layer dci=data/raw/dci/dci_16ppd.tif --craters data/raw/craters/craters2020.csv.zip
Reads `data/raw/mola.tif` (USGS DEM) and resamples every layer onto the same grid, writing `public/data/*.bin` and `dem.json`.

## Data sources (all measured)
- Elevation: USGS Astrogeology, Mars MGS MOLA DEM 463 m (Mars Global Surveyor laser altimeter), https://astrogeology.usgs.gov/search/map/mars_mgs_mola_dem_463m
- Base maps: NASA Mars Trek WMTS: MOLA colour shaded relief, USGS Viking MDIM 2.1 colour mosaic, CTX global mosaic (Caltech Murray Lab), https://trek.nasa.gov/mars/
- Sites: HiRISE (University of Arizona) image centres of "Candidate Landing Site for SpaceX Starship" and traverse-hazard images (2019-2026), https://www.uahirise.org (image IDs in `public/sites.json`)
- Ice: SWIM 2.0 combined ice consistency, 0-1 m, derived from orbital neutron, radar, thermal and landform measurements (Planetary Science Institute / NASA), https://swim.psi.edu/SWIM2Products.php
- Thermal inertia: TES nighttime thermal inertia, Putzig & Mellon (2007), via the ASU map server, https://www.mars.asu.edu/data/tes_putzigti/nightside2007/
- Dust cover: TES Dust Cover Index, Ruff & Christensen (2002), https://www.mars.asu.edu/~ruff/DCI/dci.html
- Craters: Robbins & Hynek (2012) Mars crater database, 2020 release, https://craters.sjrdesign.net/
- Colours: relief tint and Viking layer from the Viking MDIM 2.1 colour mosaic (measured average for this region #755a57)
- Erebus Montes landmark: USGS Gazetteer of Planetary Nomenclature, https://planetarynames.wr.usgs.gov/Feature/1821
- Related study (not on the map, site coordinates not verified): Luzzi et al. (2025), near-surface ice at candidate landing
  sites in northern Amazonis Planitia, JGR Planets, doi 10.1029/2024JE008724

## Limitations
- 463 m cells: boulders, small craters, cliffs and anything under ~460 m are invisible.
- Ice, dust and thermal data are coarser than the grid (about 3 km): they mark zones, not exact spots.
- Ice scores here peak at 0.50 on a -1 to +1 scale: "likely" means the orbiter data is consistent with ice, not proof.
- No travel times: there is no measured walking or rover speed on Mars for suited astronauts, so routes report distance,
  climb, slope and hazards only.
- Site positions are HiRISE image centres, not exact landing points. Directions are from the grid route, so headings are approximate.

## AI assistance
AI assistance (Claude Code) was used to write this code.
