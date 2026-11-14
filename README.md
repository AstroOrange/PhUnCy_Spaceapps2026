# Martian Map: hazard-aware routes on Mars (NASA Space Apps 2026)

A static web app that plans safe Marswalks: it finds the ONE safest route between landing sites and science stops,
steering around hazards, and shows it on a 2D map and in 3D.
Demo region: Arcadia and Amazonis Planitia (37.5°N to 41°N, 171°W to 156°W, about 207 x 690 km), flat lowland plains
with shallow ice: SpaceX Starship candidate sites (S1-S9) and the NASA/SpaceX shortlisted sites AP-1, AP-8, AP-9, EM-15
and EM-16 (Golombek et al. 2021; Luzzi et al. 2025), where ice is estimated to lie tens of centimetres down. An Oxia Planum version (clay-rich, ExoMars
rover site, no shallow ice) was built and is in the git history (commit 8704b26).

## What it does
- World hub: the whole of Mars to pan and zoom. It opens in Mars's own colours (Viking orbiter colour mosaic); the layer menu
  switches to MGS MOLA elevation in colour or CTX close-up imagery. With the elevation map on, a colour bar (km) sits at the top
  with a marker at the cursor's height, and the elevation in metres shows next to latitude and longitude. The bar's colours
  are measured from the MOLA tiles themselves against MOLA heights (`scripts/fetch_mola_global.py`). Landmark labels and
  sector nodes. Arcadia Planitia is open; Jezero, Gale and Oxia Planum are previews with a short description, to be expanded
  later (sectors are listed in `src/hub.js`). Select a sector for its card, then "Enter sector" to fly in.
- Mission planner inside the sector: deploy from a landing site, then pick an objective:
  - Ice: the 8 strongest SWIM ice spots (score 0.3 or more, at least 50 km apart, picked in `src/targets.js`),
    or "nearest reachable ice" from A.
  - Minerals: the 8 strongest OMEGA pyroxene detections (index 0.02 or more, at least 25 km apart), plus any sites in
    `public/sites.json` with a `"mineral"` field. OMEGA finds pyroxene (exposed volcanic rock) only in the south-east of the
    sector, and no olivine or water-bearing minerals anywhere in it. The Ice and Minerals tabs also switch their map layer.
  - Sites: candidate landing sites and points of interest. Pin: click the map to drop B. Pins can be dragged.
- Cursor readout: latitude and longitude anywhere; elevation anywhere (≈ marks the 15 km world grid, no mark the 463 m sector
  grid); slope, ice score and pyroxene index inside the sector.
- Route between A and B, found by A* in a Web Worker on an 8-neighbour grid:
  step cost = distance × (1 + 0.1 × slope° + extra hazards). Slopes over the limit (default 15°) are blocked;
  cells with no data are high-cost "unknown", never treated as flat.
- Extra hazards, each with its own penalty slider and map overlay:
  - Loose or dusty ground: from TES thermal inertia and the TES Dust Cover Index (`src/hazards.js`).
  - Crater rims: distance to the rim crest of every crater 1 km or wider in the Robbins & Hynek catalog.
- Route to the nearest likely ice: from point A to the closest cell where the SWIM ice-consistency score (ice within 1 m) is 0.25 or more.
  Hidden when no cell in the region reaches that score. In this region the score peaks at 0.50, in the east near the AP sites.
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
- "3D view" of the local area: the terrain around the route (or the pins), cut from the grid at full 463 m resolution
  (`cropGrid` in `src/geo.js`), Three.js with low sun and shadows, real CTX imagery draped on top, route drawn as a smoothed tube.
  Vertical exaggeration is 3× or more, up to 12× on flat ground so relief is visible; the factor is shown on screen.
- Works offline (PWA): the app is cached on install, terrain grids the first time they load, map tiles as you view them.
- Speed: grids are packed Int16 (9.9 MB instead of 21 MB, about 1 cm height precision); overlays are drawn only when first
  shown; no per-tile CSS filters or blur.
- Shareable link: the URL hash stores `startLat,startLon,endLat,endLon` and opens the sector with that route.

## Run
    npm install
    npm run dev      # http://localhost:5173
    npm test         # unit tests: distance, slope, A*, hazards
    npm run build    # static site in dist/ (deploy to Vercel or GitHub Pages)

## Prepare data (one time, already done for the demo region)
    python -m venv .venv && .venv\Scripts\pip install -r scripts/requirements.txt
    .venv\Scripts\python scripts/prep_dem.py 37.5 41 -171 -156 --layer ice=data/raw/swim/SWIM2_c0_1.tif ^
        --layer ti=data/raw/ti/ti_arcadia_wide.tif --layer dci=data/raw/dci/dci_16ppd.tif --craters data/raw/craters/craters2020.csv.zip
    cd scripts && ..\.venv\Scripts\python fetch_omega.py ..\public\data && ..\.venv\Scripts\python fetch_mola_global.py ..\public\data && cd ..
    .venv\Scripts\python scripts/fetch_mcd.py 39.25 193
`prep_dem.py` reads `data/raw/mola.tif` (USGS DEM) and resamples every `--layer` raster onto the same grid, writing packed
Int16 grids `public/data/*.i16` and `dem.json` (with each grid's scale and offset; see `scripts/gridpack.py`).
`fetch_omega.py` downloads only the rows of the OMEGA pyroxene map that cover the box (about 6 MB) and adds `pyroxene.i16`.
`pack_bins.py` converts grids made by older versions (Float32 `.bin`). `fetch_mcd.py` writes `public/data/climate.json`.
Longitudes are -180..180 east (except `fetch_mcd.py`, which takes 0..360 east). Distances use Mars radius 3389.5 km.

## Data sources
- Elevation: USGS Astrogeology, Mars MGS MOLA DEM 463 m, https://astrogeology.usgs.gov/search/map/mars_mgs_mola_dem_463m
- Base map: NASA Mars Trek WMTS: Viking MDIM 2.1 colour mosaic (USGS), MOLA colour shaded relief (463 m) and CTX global mosaic
  (5 m, Caltech Murray Lab), https://trek.nasa.gov/mars/
- World elevation readout: MGS MOLA MEGDR, 4 pixels per degree (Smith et al. 2003), NASA PDS Geosciences Node,
  https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/
- SpaceX candidate sites and points of interest: HiRISE (University of Arizona) image centres of the "Candidate Landing Site for
  SpaceX Starship" and traverse-hazard images (2019-2026), https://www.uahirise.org (image IDs in `public/sites.json`)
- AP-1, AP-8, AP-9, EM-15, EM-16: Golombek, Williams, Wooster (SpaceX), McEwen et al. (2021), SpaceX Starship Landing Sites on
  Mars, 52nd LPSC, abstract 2420, Table 1, https://www.hou.usra.edu/meetings/lpsc2021/pdf/2420.pdf. AP-1, AP-8 and AP-9
  coordinates repeated in Luzzi et al. (2023), LPSC 54 abstract 2335, and studied in Luzzi, Heldmann et al. (2025), JGR Planets
  130(5), doi 10.1029/2024JE008724. The other AP sites (AP-2 to AP-5, AP-7, AP-10 to AP-13; there is no AP-6) appear only on the
  2021 abstract's map with no published coordinates, so they are not included.
- Minerals: OMEGA (Mars Express) global pyroxene map, BD2000 band depth, Ody et al. (2012), JGR 117, E00J14,
  doi 10.1029/2012JE004117; dataset MEX-M-OMEGA-5-DDR-GLOBAL-MAPS-V1.0 via the NASA PDS Geosciences Node,
  https://pds-geosciences.wustl.edu/mex/mex-m-omega-5-ddr-global-maps-v1/
- Ice: SWIM 2.0 combined ice consistency, 0-1 m (Planetary Science Institute / NASA), https://swim.psi.edu/SWIM2Products.php
- Thermal inertia: TES nighttime thermal inertia, Putzig & Mellon (2007), via the ASU JMARS map server, https://www.mars.asu.edu/data/tes_putzigti/nightside2007/
- Dust cover: TES Dust Cover Index, Ruff & Christensen (2002), https://www.mars.asu.edu/~ruff/DCI/dci.html
- Craters: Robbins & Hynek (2012) Mars crater database, 2020 release, https://craters.sjrdesign.net/
- Weather: Mars Climate Database v6.2 (LMD/OU/IAA/ESA/CNES) web interface, https://www-mars.lmd.jussieu.fr/mcd_python/
- Erebus Montes reference point: USGS Gazetteer of Planetary Nomenclature, https://planetarynames.wr.usgs.gov/Feature/1821

## Limitations
- OMEGA pixels are about 1.5 km and its pyroxene index marks where pyroxene is detected, not how much there is. Most of the
  sector is dust-covered, so "not detected" does not mean no minerals.
- TES thermal inertia has a north-south orbit-track stripe near 164°W (values above 300 in a narrow column), so it is not
  used to mark rock outcrops. It still feeds the loose-ground hazard, where the stripe only lowers the penalty locally.
- 463 m cells: boulders, small craters, cliffs and anything under ~460 m are invisible.
- Loose ground, ice and crater data are coarser than the grid (SWIM about 3 km, TES about 3 km); they mark zones, not exact spots.
- Ice scores here peak at 0.50 on a -1 to +1 scale: "likely" means the orbiter data is consistent with ice, not proof.
- The weather table is for one point (39.25°N, 193°E) in the western part of the map, not a forecast.
- Craters wider than 100 km are skipped as rims: these ancient basins are worn down and their relief is already in the slope grid.
- Weather is a climate model for one point at the region centre, not a forecast. Dust storm values exist only in storm season (Ls 180 to 360).
- Walk time assumes 1.5 to 3 km/h in a suit; it is an estimate, not a plan.
- SpaceX site positions are HiRISE image centres, not exact landing points.
- The CTX mosaic has gaps and brightness seams.
- The CTX map server sometimes returns one picture for several different tiles (one crater repeated across the terrain), or flat grey
  filler tiles. The 3D view fingerprints every tile it loads (`src/tiles.js`), drops repeats and filler, and shows imagery 8 times
  coarser of the right place there; the number of dropped tiles is shown on screen. The 2D CTX layer comes straight from the server.

## AI assistance
AI assistance (Claude Code) was used to write this code.
