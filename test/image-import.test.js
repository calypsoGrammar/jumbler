import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

import { canvasPointFromClient, PointerSwapSession } from '../src/javascripts/puzzle-coordinates.js';
import { applyPuzzleResize, attemptPuzzleScale, drawPuzzleFragments, puzzleCompletionPercent, puzzleScaleControlState } from '../src/javascripts/puzzle-scaling.js';
import {
  MAX_FILE_BYTES, MAX_IMAGE_PIXELS, MAX_LIBRARY_IMAGES, MAX_LIBRARY_PIXELS,
  imageDimensionsFromHeader, readDecodedImage, validateDecodedImage, validateGrid,
  validateImageBeforeDecode, validateImport,
} from '../src/javascripts/image-import.js';

function header(type, width, height, variant = 'VP8X')
{
  if(type === 'image/png')
  {
    const bytes = new Uint8Array(33);
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
    new DataView(bytes.buffer).setUint32(16, width);
    new DataView(bytes.buffer).setUint32(20, height);
    return bytes;
  }
  if(type === 'image/gif')
  {
    const bytes = new Uint8Array(10);
    bytes.set([71, 73, 70, 56, 57, 97]);
    new DataView(bytes.buffer).setUint16(6, width, true);
    new DataView(bytes.buffer).setUint16(8, height, true);
    return bytes;
  }
  if(type === 'image/jpeg')
  {
    const bytes = new Uint8Array(21);
    bytes.set([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8]);
    new DataView(bytes.buffer).setUint16(7, height);
    new DataView(bytes.buffer).setUint16(9, width);
    bytes[11] = 3;
    return bytes;
  }
  if(type === 'image/webp')
  {
    const bytes = new Uint8Array(30);
    bytes.set([82, 73, 70, 70, 22, 0, 0, 0, 87, 69, 66, 80]);
    bytes.set(Array.from(variant, char => char.charCodeAt(0)), 12);
    bytes[16] = 10;
    if(variant === 'VP8X')
    {
      const put24 = (offset, value) => { bytes[offset] = value & 255; bytes[offset + 1] = value >> 8 & 255; bytes[offset + 2] = value >> 16 & 255; };
      put24(24, width - 1);
      put24(27, height - 1);
    }
    else if(variant === 'VP8L')
    {
      bytes[20] = 0x2f;
      bytes[21] = (width - 1) & 255;
      bytes[22] = ((width - 1) >> 8 & 0x3f) | (((height - 1) & 3) << 6);
      bytes[23] = (height - 1) >> 2 & 255;
      bytes[24] = (height - 1) >> 10 & 15;
    }
    else
    {
      bytes.set([0x9d, 0x01, 0x2a], 23);
      new DataView(bytes.buffer).setUint16(26, width, true);
      new DataView(bytes.buffer).setUint16(28, height, true);
    }
    return bytes;
  }
  return new Uint8Array(0);
}

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
      file.decodeReadCount = (file.decodeReadCount || 0) + 1;
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
    readDecodedImage: decode, validateDecodedImage, validateGrid, validateImageBeforeDecode, validateImport };
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
  const bytes = header(type, width, height);
  return {
    name, type, size, data: { width, height, bad },
    slice(start, end) { return { arrayBuffer: async () => bytes.slice(start, end).buffer }; },
  };
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

test('PNG, GIF, WebP variants, and JPEG dimensions are read from headers', () => {
  for(const [type, variant] of [
    ['image/png'], ['image/gif'], ['image/jpeg'],
    ['image/webp', 'VP8X'], ['image/webp', 'VP8L'], ['image/webp', 'VP8 '],
  ])
  {
    assert.deepEqual(imageDimensionsFromHeader(header(type, 1234, 567), type),
      { width: 1234, height: 567 }, `${type} ${variant || ''}`);
  }
  assert.equal(imageDimensionsFromHeader(header('image/png', 100, 100), 'image/jpeg'), null);
  assert.equal(imageDimensionsFromHeader(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0xff]), 'image/jpeg'), null);
  assert.equal(imageDimensionsFromHeader(new Uint8Array(0), 'image/png'), null);
});

test('oversized and unparseable headers are rejected before FileReader or decode', async () => {
  const { window, elements } = await loadPage();
  for(const [type, variant] of [
    ['image/png'], ['image/gif'], ['image/jpeg'],
    ['image/webp', 'VP8X'], ['image/webp', 'VP8L'], ['image/webp', 'VP8 '],
  ])
  {
    const oversized = file('huge', type, 100, 40_000, 40_000);
    if(variant)
    {
      const bytes = header(type, 40_000, 40_000, variant);
      oversized.slice = (start, end) => ({ arrayBuffer: async () => bytes.slice(start, end).buffer });
    }
    elements.get('IMPORT').files = [oversized];
    await window.jumbler.import();
    assert.match(elements.get('ERROR').textContent, /dimensions/);
    assert.equal(oversized.decodeReadCount || 0, 0);
    assert.equal(elements.get('UPLOADED').children.length, 0);
  }

  const unknown = file('unknown.png', 'image/png', 100);
  unknown.slice = () => ({ arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });
  elements.get('IMPORT').files = [unknown];
  await window.jumbler.import();
  assert.match(elements.get('ERROR').textContent, /identify image dimensions/);
  assert.equal(unknown.decodeReadCount || 0, 0);

  const tooManyPixels = file('many-pixels.png', 'image/png', 100, 3000, 3000);
  elements.get('IMPORT').files = [tooManyPixels];
  await window.jumbler.import();
  assert.match(elements.get('ERROR').textContent, /dimensions/);
  assert.equal(tooManyPixels.decodeReadCount || 0, 0);

  const fullLibrary = Array(4).fill({ naturalWidth: 2048, naturalHeight: 2048 });
  assert.match(await validateImageBeforeDecode(file('extra.png', 'image/png', 100, 100, 100), fullLibrary), /library/);
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
