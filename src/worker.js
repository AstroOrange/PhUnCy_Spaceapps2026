import { astar } from './astar.js';

let grid;
onmessage = ({ data }) => {
  if (data.h) grid = data;
  else postMessage(astar(grid.h, grid.s, grid.meta, data.start, data.end, data.opts));
};
