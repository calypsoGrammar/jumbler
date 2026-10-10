import test from 'node:test';
import assert from 'node:assert/strict';

import {
  canvasPointFromClient,
  PointerSwapSession,
  tileIndexFromPoint,
} from '../src/javascripts/puzzle-coordinates.js';

function puzzle(width, height)
{
  return {
    canvasWidth: width,
    canvasHeight: height,
    tilesAcross: 4,
    tilesDown: 3,
    fragments: Array.from({ length: 12 }, (_, index) => ({ frag: index })),
  };
}

test('client coordinates map to the same canvas point at any page scroll position', () => {
  const canvasWidth = 800;
  const canvasHeight = 600;
  const unscrolledRect = { left: 100, top: 200, width: 800, height: 600 };
  const scrolledRect = { left: 40, top: 25, width: 800, height: 600 };

  const unscrolled = canvasPointFromClient(350, 350, unscrolledRect, canvasWidth, canvasHeight);
  const scrolled = canvasPointFromClient(290, 175, scrolledRect, canvasWidth, canvasHeight);

  assert.deepEqual(unscrolled, { x: 250, y: 150 });
  assert.deepEqual(scrolled, unscrolled);
});

test('client coordinates account for CSS scaling', () => {
  const rect = { left: 10, top: 20, width: 400, height: 300 };

  assert.deepEqual(
    canvasPointFromClient(210, 170, rect, 800, 600),
    { x: 400, y: 300 },
  );
});

test('tile mapping reaches all four canvas corners at desktop and mobile sizes', () => {
  const viewports = [
    { width: 1200, height: 800 },
    { width: 320, height: 568 },
  ];

  for(const { width, height } of viewports)
  {
    assert.equal(tileIndexFromPoint(0, 0, width, height, 4, 3), 0);
    assert.equal(tileIndexFromPoint(width - 0.001, 0, width, height, 4, 3), 3);
    assert.equal(tileIndexFromPoint(0, height - 0.001, width, height, 4, 3), 8);
    assert.equal(tileIndexFromPoint(width - 0.001, height - 0.001, width, height, 4, 3), 11);
  }
});

test('tile mapping changes indexes at exact internal boundaries', () => {
  assert.equal(tileIndexFromPoint(199.999, 149.999, 800, 600, 4, 4), 0);
  assert.equal(tileIndexFromPoint(200, 149.999, 800, 600, 4, 4), 1);
  assert.equal(tileIndexFromPoint(199.999, 150, 800, 600, 4, 4), 4);
});

test('coordinates on or beyond every outside edge are rejected', () => {
  const rect = { left: 50, top: 75, width: 320, height: 240 };
  const points = [
    [49.999, 100],
    [100, 74.999],
    [370, 100],
    [100, 315],
  ];

  for(const [clientX, clientY] of points)
  {
    assert.equal(canvasPointFromClient(clientX, clientY, rect, 640, 480), null);
  }

  assert.equal(tileIndexFromPoint(-0.001, 10, 640, 480, 4, 4), null);
  assert.equal(tileIndexFromPoint(10, -0.001, 640, 480, 4, 4), null);
  assert.equal(tileIndexFromPoint(640, 10, 640, 480, 4, 4), null);
  assert.equal(tileIndexFromPoint(10, 480, 640, 480, 4, 4), null);
});

test('invalid puzzle dimensions cannot produce a fragment index', () => {
  assert.equal(tileIndexFromPoint(10, 10, 0, 100, 4, 4), null);
  assert.equal(tileIndexFromPoint(10, 10, 100, 100, 0, 4), null);
  assert.equal(tileIndexFromPoint(10, 10, 100, 100, 4.5, 4), null);
});

test('pointer sequences swap fragments at all four canvas edges on desktop and mobile sizes', () => {
  const viewports = [
    { width: 1200, height: 800 },
    { width: 320, height: 568 },
  ];

  for(const { width, height } of viewports)
  {
    const edgePoints = [
      { x: 0, y: 0 },
      { x: width - 0.001, y: 0 },
      { x: 0, y: height - 0.001 },
      { x: width - 0.001, y: height - 0.001 },
    ];

    for(const edgePoint of edgePoints)
    {
      const state = puzzle(width, height);
      const session = new PointerSwapSession();
      const edgeIndex = tileIndexFromPoint(edgePoint.x, edgePoint.y, width, height, 4, 3);
      const startIndex = edgeIndex === 5 ? 6 : 5;
      const startPoint = {
        x: (startIndex % 4 + 0.5) * width / 4,
        y: (Math.floor(startIndex / 4) + 0.5) * height / 3,
      };

      assert.equal(session.begin(1, startPoint, state), true);
      assert.deepEqual(session.finish(1, edgePoint, state), { handled: true, valid: true, swapped: true });
      assert.equal(state.fragments[startIndex].frag, edgeIndex);
      assert.equal(state.fragments[edgeIndex].frag, startIndex);
    }
  }
});

test('releases outside each canvas edge clear selection without reading or swapping a fragment', () => {
  const state = puzzle(320, 240);
  const original = state.fragments.map(fragment => fragment.frag);
  const outsidePoints = [
    { x: -0.001, y: 120 },
    { x: 160, y: -0.001 },
    { x: 320, y: 120 },
    { x: 160, y: 240 },
  ];

  for(const point of outsidePoints)
  {
    const session = new PointerSwapSession();
    assert.equal(session.begin(7, { x: 40, y: 40 }, state), true);
    assert.deepEqual(session.finish(7, point, state), { handled: true, valid: false, swapped: false });
    assert.equal(session.activePointerId, null);
    assert.deepEqual(state.fragments.map(fragment => fragment.frag), original);
  }
});

test('pointer cancellation clears selection and mismatched pointer IDs cannot finish or cancel it', () => {
  const state = puzzle(320, 240);
  const original = state.fragments.map(fragment => fragment.frag);
  const session = new PointerSwapSession();

  assert.equal(session.begin(11, { x: 40, y: 40 }, state), true);
  assert.equal(session.begin(12, { x: 280, y: 200 }, state), false);
  assert.deepEqual(
    session.finish(12, { x: 280, y: 200 }, state),
    { handled: false, valid: false, swapped: false },
  );
  assert.equal(session.cancel(12), false);
  assert.equal(session.activePointerId, 11);
  assert.deepEqual(state.fragments.map(fragment => fragment.frag), original);

  assert.equal(session.cancel(11), true);
  assert.equal(session.activePointerId, null);
  assert.deepEqual(state.fragments.map(fragment => fragment.frag), original);
});
