import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

import { PointerSwapSession } from '../src/javascripts/puzzle-coordinates.js';
import {
  applyPuzzleResize,
  attemptPuzzleScale,
  MAX_CANVAS_DIMENSION,
  MAX_CANVAS_PIXELS,
  MAX_PUZZLE_SCALE,
  MAX_PUZZLE_TILES,
  MAX_TILES_PER_AXIS,
  MIN_PUZZLE_SCALE,
  puzzleGeometry,
  puzzleScaleControlState,
  resizePuzzle,
} from '../src/javascripts/puzzle-scaling.js';

function canvasHarness({ failReadAt = null, failSnapshot = false, failCommit = false, failRestore = false } = {})
{
  const reads = [];
  const visibleDraws = [];
  let visiblePixels = ['previous-left', 'previous-right'];
  let visibleWidth = 320;
  let visibleHeight = 240;
  let visibleDrawAttempts = 0;
  let canvasCreations = 0;

  function memoryCanvas(width = 0, height = 0, pixels = [])
  {
    let canvasWidth = width;
    let canvasHeight = height;
    const canvas = {
      pixels: structuredClone(pixels),
      get width() { return canvasWidth; },
      set width(value)
      {
        canvasWidth = value;
        canvas.pixels = [];
      },
      get height() { return canvasHeight; },
      set height(value)
      {
        canvasHeight = value;
        canvas.pixels = [];
      },
      getContext()
      {
        return {
          drawImage(source)
          {
            canvas.pixels = structuredClone(source.pixels || ['source-image']);
          },
          getImageData(x, y, tileWidth, tileHeight)
          {
            if(reads.length === failReadAt) throw new Error('read failed');
            const image = { x, y, width: tileWidth, height: tileHeight, id: reads.length };
            reads.push(image);
            return image;
          },
        };
      },
    };
    return canvas;
  }

  const canvas = {
    pixels: visiblePixels,
    get width() { return visibleWidth; },
    set width(value)
    {
      visibleWidth = value;
      visiblePixels = [];
      canvas.pixels = visiblePixels;
    },
    get height() { return visibleHeight; },
    set height(value)
    {
      visibleHeight = value;
      visiblePixels = [];
      canvas.pixels = visiblePixels;
    },
  };
  const context = {
    drawImage(source)
    {
      visibleDrawAttempts++;
      if(failCommit && visibleDrawAttempts === 1) throw new Error('commit failed');
      if(failRestore && visibleDrawAttempts === 2) throw new Error('restore failed');
      visiblePixels = structuredClone(source.pixels);
      canvas.pixels = visiblePixels;
      visibleDraws.push(structuredClone(visiblePixels));
    },
  };

  return {
    canvas,
    context,
    reads,
    visibleDraws,
    get pixels() { return visiblePixels; },
    options(image, tilesAcross, tilesDown, scale)
    {
      return {
        canvas,
        context,
        createCanvas: () => {
          canvasCreations++;
          if(failSnapshot && canvasCreations === 2) throw new Error('snapshot failed');
          return memoryCanvas();
        },
        image,
        tilesAcross,
        tilesDown,
        scale,
        reportError: () => {},
      };
    },
    resize(image, tilesAcross, tilesDown, scale)
    {
      return resizePuzzle(this.options(image, tilesAcross, tilesDown, scale));
    },
  };
}

function repeatedlyScale(initialScale, direction, attempts, resize)
{
  let scale = initialScale;
  let applied = 0;
  for(let index = 0; index < attempts; index++)
  {
    const result = attemptPuzzleScale(scale, direction, candidate => {
      const accepted = resize(candidate);
      if(accepted) applied++;
      return accepted;
    });
    scale = result.scale;
  }
  return { scale, applied };
}

test('real resizes reach each scale boundary and boundary controls become no-ops', () => {
  for(const [direction, boundary, expectedApplied] of [
    [-1, MIN_PUZZLE_SCALE, 5],
    [1, MAX_PUZZLE_SCALE, 14],
  ])
  {
    let latestPuzzle = null;
    let resizeCalls = 0;
    const result = repeatedlyScale(0.6, direction, 100, candidate => {
      resizeCalls++;
      const harness = canvasHarness();
      latestPuzzle = harness.resize({ width: 800, height: 600 }, 4, 3, candidate);
      return latestPuzzle !== null;
    });

    assert.equal(result.scale, boundary);
    assert.equal(result.applied, expectedApplied);
    assert.equal(resizeCalls, expectedApplied);
    assert.equal(latestPuzzle.fragments.length, 12);

    const session = new PointerSwapSession();
    const first = latestPuzzle.fragments[0];
    const last = latestPuzzle.fragments.at(-1);
    const puzzle = {
      canvasWidth: latestPuzzle.geometry.canvasWidth,
      canvasHeight: latestPuzzle.geometry.canvasHeight,
      tilesAcross: 4,
      tilesDown: 3,
      fragments: latestPuzzle.fragments,
    };
    assert.equal(session.begin(1, { x: first.x + 0.5, y: first.y + 0.5 }, puzzle), true);
    assert.deepEqual(
      session.finish(1, { x: last.x + 0.5, y: last.y + 0.5 }, puzzle),
      { handled: true, valid: true, swapped: true },
    );

    const controls = puzzleScaleControlState(boundary);
    assert.equal(controls.scaleDownDisabled, boundary === MIN_PUZZLE_SCALE);
    assert.equal(controls.scaleUpDisabled, boundary === MAX_PUZZLE_SCALE);
    assert.equal(controls.label, Math.round(boundary * 100).toString() + '%');
  }
});

test('geometry bounds canvas allocation and per-tile work before creating a canvas', () => {
  assert.equal(puzzleGeometry(4, 4, 8, 8, MIN_PUZZLE_SCALE), null);
  assert.equal(puzzleGeometry(MAX_CANVAS_DIMENSION + 1, 100, 1, 1, 1), null);
  assert.equal(puzzleGeometry(2049, Math.floor(MAX_CANVAS_PIXELS / 2049) + 1, 1, 1, 1), null);
  assert.equal(puzzleGeometry(1000, 1000, MAX_TILES_PER_AXIS + 1, 1, 1), null);
  assert.equal(puzzleGeometry(1000, 1000, 1, MAX_PUZZLE_TILES + 1, 1), null);
  assert.equal(puzzleGeometry(640, 480, 4, 4, MIN_PUZZLE_SCALE - 0.01), null);
  assert.equal(puzzleGeometry(640, 480, 4, 4, MAX_PUZZLE_SCALE + 0.01), null);

  let canvasCreations = 0;
  const result = resizePuzzle({
    canvas: { width: 10, height: 10 },
    context: {},
    createCanvas: () => { canvasCreations++; },
    image: { width: 4096, height: 4096 },
    tilesAcross: MAX_TILES_PER_AXIS + 1,
    tilesDown: 1,
    scale: 1,
  });
  assert.equal(result, null);
  assert.equal(canvasCreations, 0);
});

test('a non-divisible resize uses equal integer tiles and its produced tiles remain interactive', () => {
  const harness = canvasHarness();
  const resized = harness.resize({ width: 50, height: 50 }, 3, 3, MIN_PUZZLE_SCALE);

  assert.ok(resized);
  assert.deepEqual(
    resized.fragments.map(({ x, y, width, height }) => ({ x, y, width, height })),
    [
      { x: 0, y: 0, width: 1, height: 1 },
      { x: 0, y: 1, width: 1, height: 1 },
      { x: 0, y: 2, width: 1, height: 1 },
      { x: 1, y: 0, width: 1, height: 1 },
      { x: 1, y: 1, width: 1, height: 1 },
      { x: 1, y: 2, width: 1, height: 1 },
      { x: 2, y: 0, width: 1, height: 1 },
      { x: 2, y: 1, width: 1, height: 1 },
      { x: 2, y: 2, width: 1, height: 1 },
    ],
  );
  assert.deepEqual(
    { width: resized.geometry.canvasWidth, height: resized.geometry.canvasHeight },
    { width: 3, height: 3 },
  );
  assert.equal(harness.reads.reduce((area, tile) => area + tile.width * tile.height, 0), 9);
  assert.deepEqual(harness.pixels, ['source-image']);

  const session = new PointerSwapSession();
  const puzzle = {
    canvasWidth: resized.geometry.canvasWidth,
    canvasHeight: resized.geometry.canvasHeight,
    tilesAcross: 3,
    tilesDown: 3,
    fragments: resized.fragments,
  };
  const firstImage = resized.fragments[0].frag;
  const lastImage = resized.fragments[8].frag;
  assert.equal(session.begin(7, { x: 0.9, y: 0.9 }, puzzle), true);
  assert.deepEqual(session.finish(7, { x: 2.5, y: 2.5 }, puzzle), { handled: true, valid: true, swapped: true });
  assert.equal(resized.fragments[0].frag, lastImage);
  assert.equal(resized.fragments[8].frag, firstImage);
});

test('staging, snapshot, and commit failures preserve the prior model and exact visible puzzle', () => {
  for(const failure of [{ failReadAt: 2 }, { failSnapshot: true }, { failCommit: true }])
  {
    const harness = canvasHarness(failure);
    const puzzle = {
      current_img: { id: 'old-image' },
      stored_width: 320,
      stored_height: 240,
      stored_rows: 2,
      stored_columns: 1,
      total: 2,
      fragments: [{ frag: 'previous-left' }, { frag: 'previous-right' }],
      original: [{ frag: 'original-left' }, { frag: 'original-right' }],
    };
    const previousPuzzle = structuredClone(puzzle);
    const previousPixels = structuredClone(harness.pixels);
    const result = attemptPuzzleScale(0.6, 1, candidate => {
      const image = { width: 800, height: 600, pixels: ['new-image'] };
      return applyPuzzleResize(puzzle, harness.options(image, 4, 3, candidate));
    });

    assert.deepEqual(result, { scale: 0.6, applied: false });
    assert.deepEqual(puzzle, previousPuzzle);
    assert.deepEqual(
      { width: harness.canvas.width, height: harness.canvas.height, pixels: harness.pixels },
      { width: 320, height: 240, pixels: previousPixels },
    );
    assert.deepEqual(harness.visibleDraws, failure.failCommit ? [previousPixels] : []);
  }
});

test('a failed canvas restoration is surfaced instead of being reported as preserved', () => {
  const harness = canvasHarness({ failCommit: true, failRestore: true });

  assert.throws(
    () => harness.resize({ width: 800, height: 600, pixels: ['new-image'] }, 4, 3, 0.7),
    error => error instanceof AggregateError && error.errors.length === 2,
  );
});

test('documented safety limits stay synchronized with the enforced constants', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');

  for(const limit of [MAX_CANVAS_DIMENSION, MAX_CANVAS_PIXELS, MAX_TILES_PER_AXIS, MAX_PUZZLE_TILES])
  {
    assert.match(readme, new RegExp(limit.toLocaleString('en-US')));
  }
});

test('the production page references only committed local assets', async () => {
  const productionPage = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
  const assetPaths = Array.from(
    productionPage.matchAll(/(?:href|src)="\/jumbler\/(assets\/[^"?]+)"/g),
    match => match[1],
  );

  assert.ok(assetPaths.length > 0);
  await Promise.all(assetPaths.map(assetPath => access(new URL(`../dist/${assetPath}`, import.meta.url))));
});
