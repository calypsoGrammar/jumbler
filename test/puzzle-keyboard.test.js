import test from 'node:test';
import assert from 'node:assert/strict';

import { KeyboardSwapSession, tileLabel } from '../src/javascripts/puzzle-keyboard.js';

function fragments(total)
{
  return Array.from({ length: total }, (_, index) => ({ frag: index }));
}

test('tile labels are one-based row and column positions in row-major order', () => {
  assert.equal(tileLabel(0, 4), 'row 1, column 1');
  assert.equal(tileLabel(3, 4), 'row 1, column 4');
  assert.equal(tileLabel(4, 4), 'row 2, column 1');
  assert.equal(tileLabel(11, 4), 'row 3, column 4');
});

test('arrow keys move the cursor across a non-square grid and stop at its edges', () => {
  const session = new KeyboardSwapSession();
  const across = 4;
  const down = 3;

  assert.equal(session.move('ArrowLeft', across, down), true);
  assert.equal(session.cursor, 0);
  assert.equal(session.move('ArrowUp', across, down), true);
  assert.equal(session.cursor, 0);

  for(let step = 0; step < 6; step++) session.move('ArrowRight', across, down);
  assert.equal(session.cursor, 3);
  for(let step = 0; step < 6; step++) session.move('ArrowDown', across, down);
  assert.equal(session.cursor, 11);

  session.move('Home', across, down);
  assert.equal(session.cursor, 8);
  session.move('End', across, down);
  assert.equal(session.cursor, 11);
  session.move('ArrowUp', across, down);
  assert.equal(session.cursor, 7);
});

test('non-navigation keys and invalid grids leave the cursor alone', () => {
  const session = new KeyboardSwapSession();
  session.cursor = 5;
  assert.equal(session.move('Tab', 4, 3), false);
  assert.equal(session.move('ArrowRight', 0, 3), false);
  assert.equal(session.cursor, 5);
});

test('a cursor beyond a smaller grid is clamped before moving', () => {
  const session = new KeyboardSwapSession();
  session.cursor = 15;
  session.move('ArrowLeft', 2, 2);
  assert.equal(session.cursor, 2);
});

test('Enter or Space selects, then swaps with the tile under the cursor', () => {
  const session = new KeyboardSwapSession();
  const tiles = fragments(12);

  assert.deepEqual(session.activate(tiles), { action: 'selected', first: 0, second: 0 });
  assert.equal(session.selected, 0);
  session.move('ArrowDown', 4, 3);
  session.move('ArrowRight', 4, 3);

  assert.deepEqual(session.activate(tiles), { action: 'swapped', first: 0, second: 5 });
  assert.equal(session.selected, null);
  assert.equal(tiles[0].frag, 5);
  assert.equal(tiles[5].frag, 0);
});

test('activating the selected tile again deselects it without swapping', () => {
  const session = new KeyboardSwapSession();
  const tiles = fragments(4);
  session.activate(tiles);
  assert.deepEqual(session.activate(tiles), { action: 'deselected', first: 0, second: 0 });
  assert.deepEqual(tiles.map(tile => tile.frag), [0, 1, 2, 3]);
});

test('cancel clears a selection and reports whether there was one', () => {
  const session = new KeyboardSwapSession();
  assert.equal(session.cancel(), false);
  session.activate(fragments(4));
  assert.equal(session.cancel(), true);
  assert.equal(session.selected, null);
});

test('activating without a puzzle does nothing', () => {
  const session = new KeyboardSwapSession();
  assert.deepEqual(session.activate([]), { action: 'none', first: null, second: 0 });
  assert.equal(session.selected, null);
});
