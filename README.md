# jumbler

Jumbler is a browser image puzzle, live at <https://jumbler.calypsogrammar.com/>. The `main` branch is the canonical source: `index.html` is the page, `src/` holds its scripts and styles, and `favicon.ico` is the site icon. Icons are inline SVG in `src/javascripts/svg.js`.

## Development

Install dependencies with `npm ci`. Run `npm run dev` to start the Vite development server at <http://localhost:5173/>. Run `npm test` for the puzzle interaction, scaling and production build tests, and `npm run build` for the production build in `dist/`, which `npm run preview` serves. The build's base is `/`, matching the root of the live site. `dist/` is generated output and is not committed.

`npm test` runs the Node unit tests and then `scripts/verify-browser.mjs`, which starts Vite and drives real Chromium through Playwright. Playwright is not a project dependency: the script imports the host's global install from `/usr/local/lib/node_modules/playwright/index.mjs` and uses the Chromium build in `/usr/local/share/ms-playwright` (`PLAYWRIGHT_BROWSERS_PATH`), as Archon's verify environment provides. To run it elsewhere, install Playwright globally there with `npm install --global playwright`, and install Chromium to that path with `PLAYWRIGHT_BROWSERS_PATH=/usr/local/share/ms-playwright npx playwright install chromium`. The browser checks cover image import limits, plus accessible names, roles and state taken from Playwright's accessibility snapshot, tab order, focus visibility, and keyboard play. They are not a full automated accessibility audit (axe-core is not installed).

Puzzle interaction uses Pointer Events for mouse, touch, and pen input.

The puzzle canvas is also keyboard-operable. Tab to it, then use the arrow keys to move the tile cursor (Home and End jump to the start or end of the row). Press Enter or Space to select a tile, move to another tile, and press Enter or Space again to swap them. Escape cancels a selection. Each move, selection, and swap is announced through a polite status region, which also announces the completion percentage when a swap changes it and says when the puzzle is complete. The tile cursor only appears when the canvas has keyboard focus. Settings open and close with one persistent toggle, so focus stays put. Focusing the canvas closes the settings panel, which would otherwise cover the puzzle. Focus outlines use a colour that contrasts at least 3:1 with the light and dark theme backgrounds. Client coordinates are converted to canvas-local coordinates without page scroll offsets; interactions outside the canvas are ignored before fragment lookup or swapping.

Columns run horizontally and rows run vertically. Tile indices are row-major: `index = row * columns + column`, starting at the top left. When canvas dimensions do not divide evenly, every pixel belongs to exactly one tile; tiles at the edges may differ by one pixel.

Puzzle scaling is supported from 10% through 200% in 10% steps. The controls stop at those limits. Resizes are also rejected if a tile would be smaller than one canvas pixel, either canvas side would exceed 4,096 pixels, the canvas would exceed 4,194,304 pixels, either grid axis would exceed 32 tiles, or the grid would exceed 256 tiles in total. A rejected resize leaves the current scale and puzzle state unchanged.

Imports accept PNG, JPEG, WebP, and GIF files up to 10 MiB each. A selection may contain at most 8 files and 20 MiB, and the library holds at most 8 images and 16,777,216 decoded pixels. Each image must decode to no more than 4,096 pixels on either side and 8,388,608 pixels total. Invalid selections leave the current library and puzzle intact.

## Deployment

The site is published to Cloudflare Pages at <https://jumbler.calypsogrammar.com/> by hand: Actions → **deploy** → Run workflow, with **Dry run** unticked (a dry run builds and checks without publishing). `.github/workflows/deploy.yml` uses the shared Cloudflare Pages deploy in `calypsoGrammar/deploy-workflows`: it builds a fresh `dist/` with `npm ci` and `npm run build` from a commit on `main` whose CI `build` job passed, and uploads it. Merging to `main` does not publish. To roll back, run the same workflow with an earlier commit as `ref`, or tick **rollback** to publish the `stable` tag (maintained by `stable.yml`); a rollback holds later deploys until cleared (Actions → stable → Run workflow → `clear-hold`). The repository needs the `CLOUDFLARE_API_TOKEN` secret and the `CLOUDFLARE_ACCOUNT_ID` variable.
