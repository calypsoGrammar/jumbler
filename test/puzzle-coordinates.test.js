import test from 'node:test';
import assert from 'node:assert/strict';

import {
  canvasPointFromClient,
  tileIndexFromPoint,
} from '../src/javascripts/puzzle-coordinates.js';

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
    assert.equal(tileIndexFromPoint(width - 0.001, 0, width, height, 4, 3), 9);
    assert.equal(tileIndexFromPoint(0, height - 0.001, width, height, 4, 3), 2);
    assert.equal(tileIndexFromPoint(width - 0.001, height - 0.001, width, height, 4, 3), 11);
  }
});

test('tile mapping changes indexes at exact internal boundaries', () => {
  assert.equal(tileIndexFromPoint(199.999, 149.999, 800, 600, 4, 4), 0);
  assert.equal(tileIndexFromPoint(200, 149.999, 800, 600, 4, 4), 4);
  assert.equal(tileIndexFromPoint(199.999, 150, 800, 600, 4, 4), 1);
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
