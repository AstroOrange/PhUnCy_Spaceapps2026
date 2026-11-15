# Arcadia Pathfinder: project notes

Source notes for a slide deck. Everything here is taken from the code, the git history and the team's working sessions
(14 to 15 November 2026). Numbers are measured from the app's own data unless marked otherwise.

---

## 1. One-line pitch

**Arcadia Pathfinder is a route planner for Mars.** It finds safe routes for astronauts between landing sites, buried ice
and science targets, steering around steep, loose or unknown ground, using only real measurements from NASA and ESA orbiters.

Shorter: *Google Maps for the first crewed mission to Mars, built on measured data only.*

## 2. The basics

| | |
|---|---|
| Event | NASA Space Apps Challenge 2026 |
| Challenge | Interplanetary Survival Guide: Martian Map |
| Project name | Arcadia Pathfinder (first called "Martian Map"; renamed 14 Nov) |
| Team | **PhUnCy**, Western University |
| Members | Jacob Athavale, Tamanna Lather, Emma Harmos, Kayla Banasco, Ewan Raine, Jonathan Ishak |
| Repo | github.com/AstroOrange/PhUnCy_Spaceapps2026 (private), `main` branch |
| Built | 14 to 15 November 2026, 37 commits on `main` so far |
| Type | Static web app: no server, no database, works offline, runs on a laptop or phone |

## 3. The problem we chose

Landing sites are chosen before astronauts ever leave Earth. But once a crew is on the ground they still have to move:
to water ice, to science targets, to other sites, to supplies. Some ground is too steep, too soft or simply unmapped.
On Mars a wrong turn is not an inconvenience.

Our framing, decided on day one: **hazard-aware pathfinding**. The landing sites are already known; our job is the route
between them and to the places worth visiting.

Who it is for: an astronaut on the first crewed mission, planning a traverse. We kept asking "would a real astronaut use
this, and could a scientist trust it?"

## 4. The journey: how we chose where on Mars

This took hours and several reversals. It is the best story in the project, because every turn was settled with data.

### 4.1 Starting point: Arcadia
- Started in southern Arcadia Planitia, near Erebus Montes, because SpaceX had HiRISE photos taken there titled
  "Candidate Landing Site for SpaceX Starship".
- First map box: 37.5 to 41°N, 171 to 163°W, about 207 × 370 km, with 7 SpaceX sites (S1 to S7).

### 4.2 "Are there other sites we could use?"
We compared five candidates and measured each one with the same data the app uses (a box of about 60 km around each site):

| | Arcadia | Phlegra Montes | Gale crater | Jezero crater | Deuteronilus Mensae |
|---|---|---|---|---|---|
| SpaceX candidate sites (HiRISE) | 7 | 1 | 0 | 0 | 0 |
| Rover on the ground | none | none | Curiosity (2012) | Perseverance (2021) | none |
| Average elevation | −3,969 m | −3,067 m | −2,263 m | −2,301 m | −3,002 m |
| Average slope | 0.3° | 2.1° | 6.0° | 3.1° | 2.9° |
| Ground steeper than 15° | 0% | 1.1% | 6.8% | 1.1% | 1.9% |
| Craters 1 km or wider | 0 | 10 | 5 | 6 | 3 |
| Dust cover index (lower = dustier) | 0.935 | 0.944 | 0.956 | 0.969 | 0.952 |
| Shallow ice score, highest (−1 to +1) | 0.25 | −0.06 | 0.20 | −0.18 | 0.13 |

Ideas we weighed and dropped:
- **Cover everything between Gale and Phlegra:** about 2,500 km apart, about 19 million grid cells. Too big for a browser, and no
  astronaut walks that.
- **Map the whole planet at full detail:** about 1 billion cells, 25+ GB. At low detail (15 km cells) hazards blur away and
  routes would look safe when they are not. This later became the world map with detailed "sectors".
- **A multi-region picker (Arcadia, Phlegra, Gale):** considered; later replaced by the world hub.

### 4.3 "We are not planning a colony. Be realistic for NASA."
This changed the question from "best base" to "most realistic first mission". Gale and Jezero ranked higher for a while
because real rover drives could check our routes. But a first *crewed* landing needs safety and water more than a rover to compare against.

Asked directly, "if you were a NASA astronaut landing for the very first time, where would you go?", the data answered
**Arcadia, site S4** (40.03°N, 167.97°W): ice score 0.21 right under the site, nothing steeper than 3.4° within about
10 km, low dust, and site S3 only about 12 km away with even more ice. We went "all in on Arcadia".

### 4.4 The NASA paper that matched our map
A teammate found a peer-reviewed paper: Luzzi, Heldmann et al. (2025), JGR Planets, from NASA Ames, on sites AP-1, AP-8 and
AP-9 just east of our box, with ice estimated only tens of centimetres below the surface. AP-9 turned out to be the same spot
as a SpaceX candidate site. NASA scientists and SpaceX were pointing at the same ground.

### 4.5 The astrobiology detour: Oxia Planum
- Worry: Arcadia has little astrobiology. We looked at Mawrth Vallis, Oxia Planum, Jezero and Nili Fossae.
- Oxia Planum won that round: ancient clays about 4 billion years old, the flattest astrobiology site we measured
  (1.0° average slope), and already chosen by ESA for the Rosalind Franklin rover.
- **We switched the whole app to Oxia Planum** (commit 8704b26): new box, new sites, all data rebuilt.
- What our own data then showed about Oxia: 259 craters in the box (Arcadia had 25), firm ground, but **no shallow ice**.
  The nearest likely ice was about 1,200 km away.
- The honest conclusion: at Oxia, water would have to be baked out of clay (tens of tonnes of soil per tonne of water).
  Oxygen can be made from the air anywhere (Perseverance's MOXIE did it), but methane fuel needs hydrogen, which needs water.
- We also checked **Hellas basin**: the lowest and best landing ground on Mars (−6,291 m), but its ice sits on the rim about
  1,000 km from the flat floor, and it is where big dust storms start.

### 4.6 Back to Arcadia, wider
"Let's say we can't get water from clay. Then where?" Back to Arcadia, this time widened east into Amazonis Planitia to take
in the NASA sites (commit b331d00):
- **Final box: 37.5 to 41°N, 171 to 156°W, about 207 × 690 km, 142,000 km².**
- Added SpaceX sites S8 and S9 and the study sites AP-1, AP-8, AP-9, EM-15, EM-16.
- The Oxia version is still in the git history.

### 4.7 What the journey taught us (good slide material)
- **Science versus resources** is the real trade-off mission planners face: Oxia for ancient life, Arcadia for water and fuel.
- **Lower ground is about landing, not breathing:** more air to slow a lander down.
- We corrected ourselves in the open: a distance of 23 km became 12 km, a region size of 360 km became 207 km, and site
  coordinates we could not verify were removed until we found the primary source.
- Every reversal was decided by measuring, not by opinion.

## 5. Why Arcadia, in four lines
1. **Water you can reach:** the strongest shallow-ice signal of everywhere we measured (score peaks at 0.50 in the east, near AP-9).
2. **Safe to land:** flat, few craters, and low (about −3,900 m), so a lander has more air to brake in.
3. **Real, vetted sites:** 9 SpaceX candidate sites photographed by HiRISE, plus 5 sites ranked by NASA JPL with SpaceX.
4. **Complete data:** every layer we use covers it.

## 6. The places on our map (all with sources)
- **S1 to S9:** SpaceX Starship candidate sites, at the centres of HiRISE image pairs (2019; S4 re-imaged August 2026).
- **AP-1, AP-8, AP-9, EM-16, EM-15:** from Golombek et al. (2021), "SpaceX Starship Landing Sites on Mars", 52nd LPSC,
  abstract 2420, Table 1 (NASA JPL with SpaceX). AP-1 rated safest; AP-9 has the thickest ice; AP-1, AP-9, EM-16 are prime
  sites, AP-8 and EM-15 secondary.
- **P1, P2:** HiRISE images taken in 2026 to study whether the ground near S3 and S5 can be crossed. That is our app's exact purpose.
- **I1 to I8:** the eight strongest ice spots, picked by the app from the SWIM map.
- **M1 to M8:** the eight strongest pyroxene (volcanic rock) detections from the OMEGA map.
- **Erebus Montes:** landmark only (USGS Gazetteer).
- Rule we kept: **never invent a coordinate.** Sites with no published position were left out.

## 7. The data: what it is and how we use it

| What | Instrument and mission | How the app uses it |
|---|---|---|
| Heights and slopes, 463 m grid | MOLA laser altimeter, Mars Global Surveyor (USGS DEM) | The routing grid, slopes, profile, 3D land, Terrain map |
| World heights, 15 km grid | MOLA MEGDR (NASA PDS) | Height under the cursor anywhere, world Terrain map |
| Shallow ice, top 1 m | SWIM 2.0: radar, neutron, thermal and landform data from several orbiters | Ice layer, ice targets, "nearest reachable ice" |
| Thermal inertia | TES, Mars Global Surveyor (Putzig & Mellon 2007) | Loose ground: fine powder versus firm ground |
| Dust Cover Index | TES (Ruff & Christensen 2002) | Loose ground: dust |
| Craters 1 km and wider | Robbins & Hynek catalog (2020 release) | Crater-rim hazard |
| Pyroxene | OMEGA, ESA Mars Express (Ody et al. 2012) | Mineral targets |
| Real colour | Viking orbiter colour mosaic, MDIM 2.1 (USGS) | Colour base map; all our Mars colours |
| Close-up photos | CTX and HiRISE, Mars Reconnaissance Orbiter | 3D ground texture; site positions and photo links |

Nice fact for a slide: the core of the app (heights, slopes, loose ground) comes from **Mars Global Surveyor, a mission that
ended in 2006**. Old data, new use.

### How the ice score works
SWIM gives each place a score from −1 (data says no ice) to +1 (all data agrees with ice). In our region it peaks at 0.50.
We call 0.25 or more "ice likely". We always say "likely", never "confirmed".

### How loose ground works (thermal inertia in simple words)
Thermal inertia is how slowly the ground heats and cools. Dust changes temperature fast (low number); rock holds its heat
(high number). We turn it into a 0 to 1 score: 150 or more is firm (0), 60 or less is powder (1). We do the same with the dust
index and keep the worse of the two. Those cut-offs are our own choice and we say so.

## 8. The algorithm

- The region is a grid of 448 × 1,920 cells (about 860,000), each 1/128 of a degree: about 462 m north to south.
- **A\* search** over 8 neighbours, running in a background thread so the page never freezes.

**Step cost = distance × (1 + k × slope° + penalty × hazard score)**

- Any step steeper than the limit (15° by default) is blocked.
- Cells with no data are scored like a 75° slope: never treated as flat.
- Loose ground and crater rims each add cost (score 0 to 1, slider default ×2).
- Three routes from the same search: **Safest** (k = 0.1, full penalties), **Balanced** (k = 0.05, half), **Shortest** (k = 0.01, none).
- Example, S1 to S7: Safest 341 km with 29% on loose ground; Shortest 318 km with 55%. Twenty-three km longer, half the loose ground.
- "Nearest ice": every likely-ice cell counts as a finish; the search stops at the cheapest one to reach.

## 9. What the app does (feature list)

- **World map** of all Mars; Arcadia Planitia is open, Jezero, Gale and Oxia Planum are previews.
- **Planner in three steps:** 1 Start, 2 Destination (Ice, Minerals, Sites or a map pin), 3 Routes appear on their own.
- **Three route cards** to compare, then **Summary**, **Directions** and **Profile** tabs.
- **Directions with true bearings:** "Head east (092°) for 35.7 km", plus hazard notes. Mars has no global magnetic field,
  so a magnetic compass does not work; bearings are from true north.
- **"What's here?":** right-click any point for height, slope, ice, minerals, loose ground and crater rims.
- **Go:** plays the route back with distance left, heading and hazards in the next kilometre.
- **3D view** of the land around the route, with real CTX photos and a follow camera.
- **Base maps:** Colour (default), Elevation, Terrain. Collapsible map key that also switches the data layers.
- **Works offline** once opened. **13 automatic tests** on `main`.

### The Terrain map (a proud engineering moment)
NASA's map pictures stop at about 325 m per pixel and sometimes fail to load; zoomed in they looked jagged or went missing.
We tested the servers tile by tile, then solved it at the root: **the app draws its own map** from the measured MOLA heights,
shaded relief plus contour lines, for whatever zoom is on screen. No gaps, sharp at every zoom, and it needs no connection.
It always sits under the other maps, so a missing picture shows real terrain instead of a hole.

### POV mode (the "VR mode"), newest branch
- Branch `pov-mode`, built by Jonathan; **not merged into `main` yet**.
- A first-person ride along the chosen route with a head-up display: compass, mini map, distance to the next stop and to B,
  elevation, slope, climb left, hazards in the next kilometre.
- Look around by dragging, by keyboard, or by **turning your phone** (motion sensors), so the phone becomes a window onto Mars.
- Two heights: **Hover** (30 m up, heights drawn 3× taller) and **Eye level** (1.7 m, true scale).
- Floating arrows show the way and a beacon marks the next stop. Pause and speed controls.
- Honest notes: it is a phone-and-screen view, not a headset app. Its "time left" uses an **assumed 10 km/h**, labelled as
  assumed on screen; it is the one deliberate exception to the measured-only rule. At eye level the view is flat and blurred
  because heights are one sample every 463 m. The branch has 19 tests.

## 10. The principle that shaped everything: measured data only

Midway through, we set one hard rule: **only real, reliable, measured data.**

What we removed because of it:
- Walking and driving times (nobody has walked on Mars; there is no measured speed).
- Radiation dose estimates and the EVA time budget.
- Seasonal weather from a climate model.
- Site coordinates we could not trace to a primary source (later restored from Golombek et al. 2021, Table 1).
- Mars colours we had picked by eye.

What we added because of it:
- Colours measured from Viking data.
- A source line on every site.
- "What this map can't see" stated in the app: nothing smaller than about 460 m, no weather, ice is "likely" not "proven".

This is the science heart of the project: **a tool an astronaut bets a traverse on should show what was measured, say where
it came from, and admit what it cannot see.**

## 11. Design: theme, type, colour, logo

### How the look evolved
1. First version looked generic. The brief from the team: it must not look machine-made.
2. **Swiss technical style:** black on white, strict grid, oversized figures, one accent colour.
3. **"Mars toned":** tints added. Then the question "where did those colours come from?" The answer was "picked by eye",
   so we replaced them with **measured** colours.
4. Final redesign: planner docked beside the map, step-by-step flow, information shown only when it is needed.

### Typeface
- **Archivo** (400, 500, 700) for all text.
- **Archivo Narrow Bold** for headings and the big numbers.
- System monospace only for the coordinate readout.
- Tabular figures everywhere so numbers line up.

### Interface colours
| Role | Hex |
|---|---|
| Ink (text, rules, primary buttons) | `#000000` |
| Paper (background) | `#ffffff` |
| Accent orange (selected route, step numbers, warnings) | `#f04e23` |
| Selected tint | `#fff3ef` |
| Secondary text | `#666666` |
| Hairlines | `#d9d9d9` |
| Soft background | `#f4f4f2` |
| Alternative route | `#6b6b6b` |

### Data colours
| Layer | Hex |
|---|---|
| Ice | `#2f6fd6` |
| Minerals (pyroxene) | `#e0a020` |
| Loose or dusty ground | `#b06828` |
| Crater rims | `#000000` |

### Mars colours (all measured)
| What | Hex | Measured from |
|---|---|---|
| Ground, average | `#755a57` | Viking colour mosaic over our exact region (434,070 pixels) |
| Ground, dark | `#584649` | same |
| Ground, light | `#886965` | same |
| Sky, high | `#d0bdae` | Viking Lander 2 true-colour photo, Utopia Planitia (NASA PIA01522) |
| Sky, middle and haze | `#e4cbbd` | same |
| Sky, horizon | `#ffe8d5` | same |

The real Martian sky is a pale dusty salmon, not the dark butterscotch people expect.

### Logo
- A front-facing **astronaut helmet in flat red** on white.
- The visor reflects a **winding path across a Martian plain** toward low hills and a small sun: the route, seen through
  the astronaut's eyes.
- Reds, sampled from the file: about `#b82808` (main), `#d83818` (light), `#a81808` (dark).
- Used as the app icon, header mark, on the documents and the team brief.

### Rules of the style
Square corners. No gradients except real data. Orange means "the route" or "pay attention". Big numbers, small labels.

## 12. How it was built

- **JavaScript** (Vite) for everything in the browser; **Leaflet** for the map on Mars's own latitude and longitude;
  **Three.js** for 3D; **Chart.js** for the profile; a service worker for offline use; **Vitest** for tests.
- **Python** (rasterio, NumPy) to cut each NASA dataset to our box and line it up on one grid.
- Data is packed as 16-bit numbers: about 10 MB instead of 21 MB.
- Claude Code, a coding assistant by Anthropic, helped write the code. The team chose the idea, the region and the design,
  and checked the results. This is stated in the README.

### Team contributions visible in the history
- World hub with sectors, objectives and the pyroxene layer (branch `world-hub`), merged with the measured-only planner
  as a **union**: keep everything from both sides that passes the measured-only rule.
- POV mode (branch `pov-mode`).
- Three Word documents in `docs/`: the explainer, the route formula explained, and a field guide to every site.

## 13. Honest limits (say these out loud)

- Cells are about 462 m: boulders, small craters and cliffs are invisible.
- Ice, dust and thermal data are about 3 km coarse: they mark zones, not spots.
- No lander or rover has ever visited Arcadia: there is no ground truth and no ground-level photo.
- Routes are plans, not live positions. Mars has no GPS.
- No weather, no travel times.

## 14. What comes next

- Merge POV mode. Deploy a public link.
- Open the preview sectors (Jezero, Gale, Oxia Planum) by running the same data scripts there. At Gale and Jezero our routes
  could be compared with the drives Curiosity and Perseverance really made.
- Finer height data from HiRISE stereo for small areas; rock abundance and THEMIS thermal data as extra hazards.

## 15. Lines worth putting on slides

- "Landing sites are picked on Earth. The route between them is picked on Mars."
- "Every number is measured. Every site has a source."
- "We changed planets' worth of plans twice, and the data brought us back to Arcadia."
- "Twenty-three kilometres longer. Half the loose ground."
- "A mission that ended in 2006 still tells astronauts where the ground is soft."
- "The map draws itself from the heights, so it never goes missing."
- "Ice likely. Never ice confirmed."

## 16. Suggested deck outline

1. Title: logo, name, team PhUnCy, Western University
2. The problem: moving safely once you have landed
3. Who it is for: the first crew
4. The site search: five candidates, one table
5. The Oxia detour and why we came back
6. Why Arcadia: water, safety, vetted sites
7. The data: nine sources, one grid
8. The algorithm: one formula, three routes
9. Demo: plan a route to ice
10. Directions, Go, 3D and POV mode
11. The Terrain map: fixing the map at its root
12. Measured data only: what we cut and why
13. Design: Swiss style, measured Mars colours, the helmet
14. Honest limits
15. What comes next
16. Thank you and sources

## 17. Check before presenting

- Luzzi et al. (2025) details beyond the site names and "ice tens of centimetres deep" were taken from a summary, not re-read.
- The site-comparison table was measured during the decision, on about 60 km boxes; Arcadia's best ice score there (0.25)
  was for the first, narrower box. The widened region peaks at 0.50.
- POV figures are from the `pov-mode` branch's README, not tested here.
