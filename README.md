# jumbler

## Development

Run `npm run dev` to start the Vite development server. Run `npm test` for the rendering-independent puzzle coordinate tests and `npm run build` for the production build.

Puzzle interaction uses Pointer Events for mouse, touch, and pen input. Client coordinates are converted to canvas-local coordinates without page scroll offsets; interactions outside the canvas are ignored before fragment lookup or swapping.
