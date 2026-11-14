import { astar } from './astar.js';

let grid;
onmessage = ({ data }) => {
  if (data.h) return void (grid = data);
  const { start, end, opts, iceMin } = data;
  const goal = iceMin == null ? null : grid.layers.ice.map(v => (v >= iceMin ? 1 : 0)); // any likely-ice cell is a finish
  postMessage(astar(grid.h, grid.s, grid.meta, start, end, { ...opts, goal }));
};
