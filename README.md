# jumbler

## Development

Run `npm run dev` to start the Vite development server. Run `npm test` for the rendering-independent puzzle interaction and scaling tests and `npm run build` for the production build.

Puzzle interaction uses Pointer Events for mouse, touch, and pen input. Client coordinates are converted to canvas-local coordinates without page scroll offsets; interactions outside the canvas are ignored before fragment lookup or swapping.

Columns run horizontally and rows run vertically. Tile indices are row-major: `index = row * columns + column`, starting at the top left. When canvas dimensions do not divide evenly, every pixel belongs to exactly one tile; tiles at the edges may differ by one pixel.

Puzzle scaling is supported from 10% through 200% in 10% steps. The controls stop at those limits. Resizes are also rejected if a tile would be smaller than one canvas pixel, either canvas side would exceed 4,096 pixels, the canvas would exceed 4,194,304 pixels, either grid axis would exceed 32 tiles, or the grid would exceed 256 tiles in total. A rejected resize leaves the current scale and puzzle state unchanged.

Imports accept PNG, JPEG, WebP, and GIF files up to 10 MiB each. A selection may contain at most 8 files and 20 MiB, and the library holds at most 8 images and 16,777,216 decoded pixels. Each image must decode to no more than 4,096 pixels on either side and 8,388,608 pixels total. Invalid selections leave the current library and puzzle intact.

## Deployment

The site is published to GitHub Pages at <https://calypsogrammar.github.io/jumbler/> by hand: Actions → **deploy** → Run workflow, with **Dry run** unticked (a dry run builds and checks without publishing). `.github/workflows/deploy.yml` uses the shared Pages deploy in `calypsoGrammar/deploy-workflows`: it builds `dist/` with `npm ci` and `npm run build` from a commit on `main` whose CI `build` job passed, and publishes it. Merging to `main` does not publish. To roll back, run the same workflow with an earlier commit as `ref`, or tick **rollback** to publish the `stable` tag (maintained by `stable.yml`); a rollback holds later deploys until cleared (Actions → stable → Run workflow → `clear-hold`). The Pages source must be "GitHub Actions".
The committed `dist/` folder is not what is published: the deploy builds a fresh `dist/` from source.
