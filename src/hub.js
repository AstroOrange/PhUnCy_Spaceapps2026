// World hub: sectors you can select on the global map, and big landmarks labelled for orientation.
// Only sectors with `open: true` have terrain data (public/data); the rest show as locked.
export const SECTORS = [
  { id: 'arcadia', open: true, name: 'Arcadia Planitia', sub: 'Shallow ice · ready', lat: 39.25, lon: -163.5,
    text: 'Flat northern plains with water ice tens of centimetres below the surface. SpaceX and NASA Ames candidate landing sites for the first crewed missions.' },
  { id: 'jezero', name: 'Jezero Crater', sub: 'Perseverance · 2021', lat: 18.44, lon: 77.45,
    text: 'An ancient lake with a river delta, where the Perseverance rover is collecting rock samples.' },
  { id: 'gale', name: 'Gale Crater', sub: 'Curiosity · 2012', lat: -4.59, lon: 137.44,
    text: 'A 154 km crater with Mount Sharp at its centre, explored by the Curiosity rover since 2012.' },
  { id: 'oxia', name: 'Oxia Planum', sub: 'Rosalind Franklin · planned', lat: 18.2, lon: -24.55,
    text: 'A clay-rich plain chosen as the landing site of ESA\'s Rosalind Franklin (ExoMars) rover.' },
];

// Landmarks (approximate centres, USGS Gazetteer of Planetary Nomenclature), labels only
export const FEATURES = [
  ['Olympus Mons', 18.65, -133.8], ['Valles Marineris', -13.9, -59.2], ['Hellas Planitia', -42.4, 70.5],
  ['Utopia Planitia', 49.7, 118], ['Elysium Mons', 25.0, 147.2], ['Argyre Planitia', -49.7, -44],
];
