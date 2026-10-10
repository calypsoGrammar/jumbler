import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

import { canvasPointFromClient, PointerSwapSession } from '../src/javascripts/puzzle-coordinates.js';
import { applyPuzzleResize, attemptPuzzleScale, drawPuzzleFragments, puzzleCompletionPercent, puzzleScaleControlState } from '../src/javascripts/puzzle-scaling.js';
import {
  MAX_FILE_BYTES, MAX_IMAGE_PIXELS, MAX_LIBRARY_IMAGES, MAX_LIBRARY_PIXELS,
  readDecodedImage, validateDecodedImage, validateGrid, validateImport,
} from '../src/javascripts/image-import.js';

function browserHarness()
{
  const elements = new Map();
  function element(id)
  {
    return {
      id, value: '', disabled: false, textContent: '', innerHTML: '', style: {}, children: [],
      classList: { add() {}, remove() {} },
      appendChild(child) { this.children.push(child); if(this.value === '') this.value = child.value; },
      addEventListener() {},
    };
  }
  for(const id of ['NAV', 'MENU', 'ORIGINAL', 'COMPLETED', 'JUMBLE', 'SCALE_DOWN', 'SCALE_UP',
    'SCALE_VALUE', 'UP', 'DOWN', 'ROWS', 'COLUMNS', 'THEME', 'UPLOADED', 'PLAY', 'SELECT',
    'IMPORT', 'LOAD', 'ERROR', 'CANVAS']) elements.set(id, element(id));
  const canvas = elements.get('CANVAS');
  canvas.width = 0;
  canvas.height = 0;
  canvas.getContext = () => ({ drawImage() {}, getImageData(x, y, width, height) { return { x, y, width, height }; } });
  elements.get('ROWS').value = '2';
  elements.get('COLUMNS').value = '2';
  elements.get('IMPORT').files = [];
  const document = {
    body: element('body'),
    getElementById: id => elements.get(id),
    createElement: id => id === 'canvas' ? {
      width: 0, height: 0,
      getContext: () => ({ drawImage() {}, getImageData(x, y, width, height) { return { x, y, width, height }; } }),
    } : element(id),
    addEventListener(name, callback) { if(name === 'DOMContentLoaded') callback(); },
  };
  class FileReader
  {
    readAsDataURL(file)
    {
      this.result = file.data;
      queueMicrotask(() => this.onload());
    }
  }
  class Image
  {
    set src(value) { this.data = value; }
    async decode()
    {
      if(this.data.wait) await this.data.wait;
      if(this.data.bad) throw new Error('bad image');
      this.naturalWidth = this.width = this.data.width;
      this.naturalHeight = this.height = this.data.height;
    }
  }
  const window = { innerWidth: 800, innerHeight: 600, confirm: () => true };
  const decode = file => readDecodedImage(file, FileReader, Image);
  const context = { window, document, Image, console, queueMicrotask,
    svg: { eye: '', dice: '', up: '', down: '', theme: '' }, Alpine: { start() {} },
    canvasPointFromClient, PointerSwapSession, applyPuzzleResize, attemptPuzzleScale,
    drawPuzzleFragments, puzzleCompletionPercent, puzzleScaleControlState,
    readDecodedImage: decode, validateDecodedImage, validateGrid, validateImport };
  return { context, elements, window };
}

async function loadPage()
{
  const harness = browserHarness();
  const source = await readFile(new URL('../src/javascripts/main.js', import.meta.url), 'utf8');
  const executable = source.replace(/^import[\s\S]*?;\n/gm, '');
  vm.runInNewContext(executable, harness.context);
  return harness;
}

function file(name, type, size, width = 100, height = 100, bad = false)
{
  return { name, type, size, data: { width, height, bad } };
}

test('the page rejects unsupported files and decode failures without adding selector entries or enabling play', async () => {
  const { window, elements } = await loadPage();
  assert.equal(elements.get('PLAY').disabled, true);
  elements.get('IMPORT').files = [file('notes.txt', 'text/plain', 10)];
  await window.jumbler.import();
  assert.match(elements.get('ERROR').textContent, /notes.txt.*JPEG/);
  assert.equal(elements.get('UPLOADED').children.length, 0);

  elements.get('IMPORT').files = [file('broken.png', 'image/png', 10, 100, 100, true)];
  await window.jumbler.import();
  assert.match(elements.get('ERROR').textContent, /broken.png.*decode failed/);
  assert.equal(elements.get('UPLOADED').children.length, 0);
  assert.equal(elements.get('PLAY').disabled, true);
});

test('valid imports remain playable and later bad imports and grids preserve the active puzzle', async () => {
  const { window, elements } = await loadPage();
  elements.get('IMPORT').files = [file('good.png', 'image/png', 100)];
  await window.jumbler.import();
  assert.equal(elements.get('UPLOADED').children.length, 1);
  assert.equal(elements.get('PLAY').disabled, false);
  elements.get('PLAY').onclick();
  const previousImage = window.jumbler.current_img;
  const previousFragments = window.jumbler.fragments;
  const previousWidth = elements.get('CANVAS').width;
  window.jumbler.playing = true;

  elements.get('IMPORT').files = [file('broken.jpg', 'image/jpeg', 100, 100, 100, true)];
  await window.jumbler.import();
  assert.equal(elements.get('UPLOADED').children.length, 1);
  assert.equal(elements.get('PLAY').disabled, false);
  assert.equal(elements.get('UPLOADED').value, '0');
  elements.get('ROWS').value = '100000';
  elements.get('PLAY').onclick();
  assert.match(elements.get('ERROR').textContent, /Rows and columns/);
  assert.equal(window.jumbler.current_img, previousImage);
  assert.equal(window.jumbler.fragments, previousFragments);
  assert.equal(elements.get('CANVAS').width, previousWidth);
  assert.equal(window.jumbler.playing, true);
});

test('play and the image selector remain unavailable until decode completes', async () => {
  const { window, elements } = await loadPage();
  let finishDecode;
  const wait = new Promise(resolve => { finishDecode = resolve; });
  const pending = file('slow.png', 'image/png', 100);
  pending.data.wait = wait;
  elements.get('IMPORT').files = [pending];
  const importing = window.jumbler.import();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(elements.get('PLAY').disabled, true);
  assert.equal(elements.get('UPLOADED').children.length, 0);
  assert.equal(elements.get('LOAD').disabled, true);
  finishDecode();
  await importing;
  assert.equal(elements.get('PLAY').disabled, false);
  assert.equal(elements.get('UPLOADED').children.length, 1);
});

test('file, batch, decoded size, library, and numeric grid limits are enforced', () => {
  assert.match(validateImport([file('a.svg', 'image/svg+xml', 10)], []), /JPEG/);
  assert.match(validateImport([file('large.png', 'image/png', MAX_FILE_BYTES + 1)], []), /8 MiB/);
  assert.match(validateImport(Array.from({ length: 3 }, (_, i) => file(`${i}.png`, 'image/png', MAX_FILE_BYTES)), []), /20 MiB/);
  assert.match(validateImport([file('extra.png', 'image/png', 1)], Array(MAX_LIBRARY_IMAGES)), /library/);
  assert.match(validateDecodedImage({ naturalWidth: 4096, naturalHeight: 4096 }, []), /dimensions/);
  assert.match(validateDecodedImage({ naturalWidth: 1024, naturalHeight: 1024 },
    Array(4).fill({ naturalWidth: 2048, naturalHeight: 2048 })), /library/);
  assert.ok(MAX_IMAGE_PIXELS < MAX_LIBRARY_PIXELS);
  for(const value of ['', '0', '1.5', '-1', '65', 'Infinity'])
  {
    assert.ok(validateGrid(value, '4').error);
  }
  assert.deepEqual(validateGrid('4', '4'), { rows: 4, columns: 4 });
});
