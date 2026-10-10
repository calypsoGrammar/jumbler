# jumbler

## Development

Run `npm run dev` to start the Vite development server. Run `npm test` for the rendering-independent puzzle interaction and scaling tests and `npm run build` for the production build.

Puzzle interaction uses Pointer Events for mouse, touch, and pen input. Client coordinates are converted to canvas-local coordinates without page scroll offsets; interactions outside the canvas are ignored before fragment lookup or swapping.

Columns run horizontally and rows run vertically. Tile indices are row-major: `index = row * columns + column`, starting at the top left. When canvas dimensions do not divide evenly, every pixel belongs to exactly one tile; tiles at the edges may differ by one pixel.

Puzzle scaling is supported from 10% through 200% in 10% steps. The controls stop at those limits. Resizes are also rejected if a tile would be smaller than one canvas pixel, either canvas side would exceed 4,096 pixels, the canvas would exceed 4,194,304 pixels, either grid axis would exceed 64 tiles, or the grid would exceed 4,096 tiles in total. A rejected resize leaves the current scale and puzzle state unchanged.
