import test from 'node:test';
import assert from 'node:assert/strict';

import { PointerSwapSession } from '../src/javascripts/puzzle-coordinates.js';
import {
  attemptPuzzleScale,
  MAX_CANVAS_DIMENSION,
  MAX_CANVAS_PIXELS,
  MAX_PUZZLE_SCALE,
  MIN_PUZZLE_SCALE,
  puzzleGeometry,
} from '../src/javascripts/puzzle-scaling.js';

function repeatedlyScale(initialScale, direction, attempts)
{
  let scale = initialScale;
  let resizeCalls = 0;
  for(let index = 0; index < attempts; index++)
  {
    const result = attemptPuzzleScale(scale, direction, () => {
      resizeCalls++;
      return true;
    });
    scale = result.scale;
  }
  return { scale, resizeCalls };
}

test('repeated scale-down stops at the supported minimum without another resize', () => {
  const result = repeatedlyScale(0.6, -1, 100);

  assert.equal(result.scale, MIN_PUZZLE_SCALE);
  assert.equal(result.resizeCalls, 5);
  assert.deepEqual(puzzleGeometry(640, 480, 4, 4, result.scale), {
    canvasWidth: 64,
    canvasHeight: 48,
    tileWidth: 16,
    tileHeight: 12,
    total: 16,
  });
});

test('repeated scale-up stops at the documented safe maximum without another resize', () => {
  const result = repeatedlyScale(0.6, 1, 100);

  assert.equal(result.scale, MAX_PUZZLE_SCALE);
  assert.equal(result.resizeCalls, 14);
});

test('a boundary click cannot invoke resize or reset the current puzzle', () => {
  const fragments = [{ frag: 'first' }, { frag: 'second' }];
  const before = structuredClone(fragments);
  let resizeCalls = 0;

  const atMinimum = attemptPuzzleScale(MIN_PUZZLE_SCALE, -1, () => {
    resizeCalls++;
    fragments.reverse();
    return true;
  });
  const atMaximum = attemptPuzzleScale(MAX_PUZZLE_SCALE, 1, () => {
    resizeCalls++;
    fragments.reverse();
    return true;
  });

  assert.deepEqual(atMinimum, { scale: MIN_PUZZLE_SCALE, applied: false });
  assert.deepEqual(atMaximum, { scale: MAX_PUZZLE_SCALE, applied: false });
  assert.equal(resizeCalls, 0);
  assert.deepEqual(fragments, before);
});

test('a rejected resize preserves the prior scale and puzzle fragments', () => {
  const fragments = [{ frag: 'first' }, { frag: 'second' }];
  const before = structuredClone(fragments);
  const result = attemptPuzzleScale(0.6, 1, () => false);

  assert.deepEqual(result, { scale: 0.6, applied: false });
  assert.deepEqual(fragments, before);
});

test('invalid tile and canvas dimensions are rejected before canvas allocation', () => {
  assert.equal(puzzleGeometry(4, 4, 8, 8, MIN_PUZZLE_SCALE), null);
  assert.equal(puzzleGeometry(MAX_CANVAS_DIMENSION + 1, 100, 1, 1, 1), null);
  assert.equal(puzzleGeometry(4097, Math.floor(MAX_CANVAS_PIXELS / 4097) + 1, 1, 1, 1), null);
  assert.equal(puzzleGeometry(640, 480, 4, 4, MIN_PUZZLE_SCALE - 0.01), null);
  assert.equal(puzzleGeometry(640, 480, 4, 4, MAX_PUZZLE_SCALE + 0.01), null);
});

test('tiles remain interactive after successful scaling at both boundaries', () => {
  for(const scale of [MIN_PUZZLE_SCALE, MAX_PUZZLE_SCALE])
  {
    const geometry = puzzleGeometry(800, 600, 4, 3, scale);
    const fragments = Array.from({ length: geometry.total }, (_, index) => ({ frag: index }));
    const puzzle = {
      canvasWidth: geometry.canvasWidth,
      canvasHeight: geometry.canvasHeight,
      tilesAcross: 4,
      tilesDown: 3,
      fragments,
    };
    const session = new PointerSwapSession();

    assert.equal(session.begin(1, { x: geometry.tileWidth / 2, y: geometry.tileHeight / 2 }, puzzle), true);
    assert.deepEqual(
      session.finish(1, {
        x: geometry.canvasWidth - geometry.tileWidth / 2,
        y: geometry.canvasHeight - geometry.tileHeight / 2,
      }, puzzle),
      { handled: true, valid: true, swapped: true },
    );
    assert.equal(fragments[0].frag, fragments.length - 1);
    assert.equal(fragments[fragments.length - 1].frag, 0);
  }
});
