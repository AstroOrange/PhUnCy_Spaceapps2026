// World hub: sectors you can select on the global map, and big landmarks labelled for orientation.
// Only sectors with `open: true` have terrain data (public/data); the rest are previews with a short description.
// `facts` are shown on the preview card as [value, unit, label].
export const SECTORS = [
  { id: 'arcadia', open: true, name: 'Arcadia Planitia', sub: 'Shallow ice · ready', lat: 39.25, lon: -163.5,
    text: 'Flat northern plains with water ice tens of centimetres below the surface, and exposed volcanic rock in the south-east. NASA and SpaceX candidate landing sites for the first crewed missions.' },
  { id: 'jezero', name: 'Jezero Crater', sub: 'Perseverance · 2021', lat: 18.44, lon: 77.45,
    text: 'A crater that once held a lake, with a river delta spread across its western floor. NASA\'s Perseverance rover landed here in February 2021 and is collecting rock samples that could hold signs of ancient life; the Ingenuity helicopter flew here too.',
    facts: [['45', 'km', 'Crater width'], ['2021', '', 'Perseverance landed']] },
  { id: 'gale', name: 'Gale Crater', sub: 'Curiosity · 2012', lat: -4.59, lon: 137.44,
    text: 'A large impact crater near the equator with Mount Sharp, a layered mountain about 5 km high, at its centre. NASA\'s Curiosity rover has been climbing its layers since August 2012, reading billions of years of Mars\'s changing climate.',
    facts: [['154', 'km', 'Crater width'], ['2012', '', 'Curiosity landed']] },
  { id: 'oxia', name: 'Oxia Planum', sub: 'Rosalind Franklin · planned', lat: 18.2, lon: -24.55,
    text: 'A wide, low plain rich in clay minerals that formed in water about 4 billion years ago. It is the chosen landing site of ESA\'s Rosalind Franklin (ExoMars) rover, which will drill up to 2 m down to look for preserved signs of life.',
    facts: [['2 m', '', 'Rover drill depth'], ['~4', 'billion yr', 'Age of the clays']] },
];

// Landmarks (approximate centres, USGS Gazetteer of Planetary Nomenclature), labels only
export const FEATURES = [
  ['Olympus Mons', 18.65, -133.8], ['Valles Marineris', -13.9, -59.2], ['Hellas Planitia', -42.4, 70.5],
  ['Utopia Planitia', 49.7, 118], ['Elysium Mons', 25.0, 147.2], ['Argyre Planitia', -49.7, -44],
];
