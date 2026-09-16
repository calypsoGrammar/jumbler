import test from 'node:test';
import assert from 'node:assert/strict';

import { PointerSwapSession } from '../src/javascripts/puzzle-coordinates.js';
import {
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

function canvasHarness({ failReadAt = null, failWriteAt = null } = {})
{
  const reads = [];
  const writes = [];
  let redraws = 0;
  const canvas = { width: 320, height: 240 };
  const context = {
    putImageData(image, x, y)
    {
      if(writes.length === failWriteAt) throw new Error('commit failed');
      writes.push({ image, x, y });
    },
  };
  const stagingContext = {
    drawImage() {},
    getImageData(x, y, width, height)
    {
      if(reads.length === failReadAt) throw new Error('read failed');
      const image = { x, y, width, height, id: reads.length };
      reads.push(image);
      return image;
    },
  };

  return {
    canvas,
    context,
    reads,
    writes,
    get redraws() { return redraws; },
    resize(image, tilesAcross, tilesDown, scale)
    {
      return resizePuzzle({
        canvas,
        context,
        createCanvas: () => ({ getContext: () => stagingContext }),
        image,
        tilesAcross,
        tilesDown,
        scale,
        redraw: () => { redraws++; },
        reportError: () => {},
      });
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
  assert.deepEqual(harness.writes.map(({ x, y }) => ({ x, y })), resized.fragments.map(({ x, y }) => ({ x, y })));

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

test('staging and commit failures preserve the prior puzzle, scale, and visible dimensions', () => {
  for(const failure of [{ failReadAt: 2 }, { failWriteAt: 2 }])
  {
    const harness = canvasHarness(failure);
    const previousPuzzle = { id: 'unchanged', fragments: [{ frag: 'old' }] };
    let puzzle = previousPuzzle;
    const result = attemptPuzzleScale(0.6, 1, candidate => {
      const resized = harness.resize({ width: 800, height: 600 }, 4, 3, candidate);
      if(resized === null) return false;
      puzzle = resized;
      return true;
    });

    assert.deepEqual(result, { scale: 0.6, applied: false });
    assert.equal(puzzle, previousPuzzle);
    assert.deepEqual(harness.canvas, { width: 320, height: 240 });
    assert.equal(harness.redraws, failure.failWriteAt === 2 ? 1 : 0);
  }
});
