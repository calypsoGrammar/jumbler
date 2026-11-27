import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { deflateSync } from 'node:zlib';
import { imageDimensions } from '../src/javascripts/image-dimensions.js';

process.env.PLAYWRIGHT_BROWSERS_PATH = '/usr/local/share/ms-playwright';
const { chromium } = await import('/usr/local/lib/node_modules/playwright/index.mjs');

const port = 4175;
const url = `http://127.0.0.1:${port}/jumbler/`;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
  cwd: new URL('..', import.meta.url),
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
for(const stream of [server.stdout, server.stderr]) stream.on('data', chunk => { serverLog += chunk.toString(); });
let browser;

async function waitForServer()
{
  for(let attempt = 0; attempt < 80; attempt++)
  {
    if(server.exitCode !== null) throw new Error(`Vite exited with code ${server.exitCode}:\n${serverLog}`);
    try
    {
      const response = await fetch(url, { signal: AbortSignal.timeout(500) });
      if(response.ok) return;
    }
    catch { /* Vite is still starting. */ }
    await delay(100);
  }
  throw new Error(`Vite did not become healthy:\n${serverLog}`);
}

async function fixture(page, width = 64, height = 64)
{
  const dataUrl = await page.evaluate(([w, h]) => {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const context = canvas.getContext('2d');
    context.fillStyle = '#3166b1';
    context.fillRect(0, 0, w, h);
    return canvas.toDataURL('image/png');
  }, [width, height]);
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

function crc32(bytes)
{
  let crc = 0xffffffff;
  for(const byte of bytes)
  {
    crc ^= byte;
    for(let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(name, data)
{
  const type = Buffer.from(name);
  const result = Buffer.alloc(12 + data.length);
  result.writeUInt32BE(data.length, 0);
  type.copy(result, 4);
  data.copy(result, 8);
  result.writeUInt32BE(crc32(result.subarray(4, 8 + data.length)), 8 + data.length);
  return result;
}

function grayscalePng(width, height, imageData)
{
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header), pngChunk('IDAT', imageData), pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function oversizedCompressedPng()
{
  const width = 8192;
  const height = 8192;
  // Eight-bit grayscale; zero-filled scanlines compress well.
  const pixels = Buffer.alloc((width + 1) * height);
  const compressed = deflateSync(pixels);
  const png = grayscalePng(width, height, compressed);
  assert.ok(png.length < 10 * 1024 * 1024);
  return png;
}

function corruptDecodedPng()
{
  // Readable IHDR dimensions pass the app's parser. An invalid grayscale bit
  // depth and critical-chunk CRC force Chromium's PNG decoder to reject the
  // file instead of showing a partially decoded blank image.
  const png = grayscalePng(64, 64, Buffer.from([0, 1, 2, 3, 4]));
  png[24] = 3; // Grayscale PNG only permits bit depths 1, 2, 4, 8, or 16.
  png[29] ^= 0xff; // First byte of the IHDR CRC, after its 13 data bytes.
  assert.deepEqual(imageDimensions(Uint8Array.from(png).buffer, 'image/png'), { width: 64, height: 64 });
  return png;
}

async function importFiles(page, files)
{
  await page.locator('#IMPORT').setInputFiles(files);
  await page.locator('#LOAD').click();
  await page.waitForFunction(() => !window.jumbler.importing, { timeout: 10000 });
  return page.locator('#STATUS').textContent();
}

function luminance(color)
{
  const [r, g, b] = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(first, second)
{
  const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

async function focusRing(page)
{
  return page.evaluate(() => {
    const element = document.activeElement;
    const style = getComputedStyle(element);
    return {
      id: element.id,
      focusVisible: element.matches(':focus-visible'),
      outlineStyle: style.outlineStyle,
      outlineWidth: parseFloat(style.outlineWidth),
      outlineColor: style.outlineColor,
      background: getComputedStyle(document.getElementById('NAV')).backgroundColor,
    };
  });
}

async function assertVisibleFocus(page, id)
{
  const ring = await focusRing(page);
  assert.equal(ring.id, id);
  assert.equal(ring.focusVisible, true, `${id} matches :focus-visible`);
  assert.equal(ring.outlineStyle, 'solid');
  assert.ok(ring.outlineWidth >= 2, `${id} focus outline is at least 2px`);
  assert.ok(contrast(ring.outlineColor, ring.background) >= 3,
    `${id} focus outline ${ring.outlineColor} contrasts with ${ring.background}`);
}

// Reads the rendered screenshot, not computed style, so a clipped or covered
// outline fails. Samples a one-pixel strip 4px outside each edge, inside the
// 3px outline drawn 2px from the element.
async function assertRenderedFocusRing(page, selector)
{
  const box = await page.locator(selector).boundingBox();
  const ring = (await focusRing(page)).outlineColor.match(/[\d.]+/g).slice(0, 3).map(Number);
  const middleX = Math.round(box.x + box.width / 2) - 10;
  const middleY = Math.round(box.y + box.height / 2) - 10;
  const edges = {
    top: { x: middleX, y: Math.floor(box.y) - 4, width: 20, height: 1 },
    bottom: { x: middleX, y: Math.ceil(box.y + box.height) + 3, width: 20, height: 1 },
    left: { x: Math.floor(box.x) - 4, y: middleY, width: 1, height: 20 },
    right: { x: Math.ceil(box.x + box.width) + 3, y: middleY, width: 1, height: 20 },
  };
  for(const [edge, clip] of Object.entries(edges))
  {
    const png = await page.screenshot({ clip });
    const pixels = await page.evaluate(async base64 => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      return Array.from(context.getImageData(0, 0, image.width, image.height).data);
    }, png.toString('base64'));
    for(let offset = 0; offset < pixels.length; offset += 4)
    {
      const pixel = pixels.slice(offset, offset + 3);
      assert.ok(pixel.every((value, channel) => Math.abs(value - ring[channel]) <= 10),
        `${selector} focus ring is rendered on its ${edge} edge (pixel ${pixel}, ring ${ring})`);
    }
  }
}

async function tabTo(page, id, limit = 20)
{
  for(let presses = 0; presses < limit; presses++)
  {
    await page.keyboard.press('Tab');
    if(await page.evaluate(() => document.activeElement.id) === id) return;
  }
  throw new Error(`Tab did not reach #${id}`);
}

async function canvasPixel(page, x, y)
{
  return page.evaluate(([px, py]) => Array.from(
    document.getElementById('CANVAS').getContext('2d').getImageData(px, py, 1, 1).data.slice(0, 3),
  ), [x, y]);
}

async function moveCursorTo(page, target)
{
  const columns = await page.evaluate(() => Number(window.jumbler.stored_columns));
  for(;;)
  {
    const cursor = await page.evaluate(() => window.jumbler.keyboardSession.cursor);
    if(cursor === target) return;
    const [row, column] = [Math.floor(cursor / columns), cursor % columns];
    const [targetRow, targetColumn] = [Math.floor(target / columns), target % columns];
    if(row !== targetRow) await page.keyboard.press(row < targetRow ? 'ArrowDown' : 'ArrowUp');
    else await page.keyboard.press(column < targetColumn ? 'ArrowRight' : 'ArrowLeft');
  }
}

async function verifyAccessibility(browser)
{
  const page = await browser.newPage();
  page.setDefaultTimeout(10000);
  const dialogs = [];
  page.on('dialog', dialog => {
    dialogs.push(dialog.type());
    dialog.accept();
  });
  await page.goto(url);
  await page.waitForFunction(() => Boolean(window.jumbler));

  // Accessible names, roles, and state in the rendered accessibility tree.
  const snapshot = await page.locator('body').ariaSnapshot();
  for(const line of [
    '- button "Show original image" [pressed]',
    '- button "Jumble tiles"',
    '- button "Decrease puzzle scale"',
    '- button "Increase puzzle scale"',
    '- button "Settings" [expanded]',
    '- spinbutton "rows"',
    '- spinbutton "columns"',
    '- button "Dark theme"',
    '- combobox "current"',
    '- button "play" [disabled]',
    '- group "import"',
    '- button "Select images"',
    '- button "Load selected images"',
    '- application "Jumbler puzzle"',
  ]) assert.ok(snapshot.includes(line), `accessibility snapshot includes ${line}:\n${snapshot}`);
  assert.doesNotMatch(snapshot, /- (button|spinbutton|combobox|textbox|application)(\s*\[[^\]]*\])*\s*(:|$)/m,
    `every control has an accessible name:\n${snapshot}`);
  assert.doesNotMatch(snapshot, /- img/, 'decorative icons are hidden from the accessibility tree');
  assert.equal(await page.locator('svg:not([aria-hidden="true"])').count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Dark theme', pressed: false }).count(), 1);
  assert.equal(await page.locator('#MENU_TOGGLE').getAttribute('aria-controls'), 'MENU');
  assert.equal(await page.locator('#CANVAS').getAttribute('tabindex'), '0');
  assert.match(await page.evaluate(() => {
    const ids = document.getElementById('CANVAS').getAttribute('aria-describedby');
    return document.getElementById(ids).textContent;
  }), /arrow keys.*Enter or Space to select.*swap/s);
  assert.equal(await page.locator('#PUZZLE_STATUS[role="status"][aria-live="polite"]').count(), 1);
  console.log('Chromium: controls expose names, roles, pressed/expanded state, and hide decorative icons');

  // Tab order and a visible focus ring with 3:1 contrast in the light theme.
  const order = [];
  for(let presses = 0; presses < 12; presses++)
  {
    await page.keyboard.press('Tab');
    order.push(await page.evaluate(() => document.activeElement.id));
  }
  assert.deepEqual(order, [
    'ORIGINAL', 'JUMBLE', 'SCALE_DOWN', 'SCALE_UP', 'MENU_TOGGLE', 'ROWS', 'COLUMNS', 'THEME', 'UPLOADED',
    'SELECT', 'LOAD', 'CANVAS',
  ]);
  await page.keyboard.press('Shift+Tab');
  await assertVisibleFocus(page, 'LOAD');

  await page.locator('#ORIGINAL').focus();
  await tabTo(page, 'MENU_TOGGLE');
  await assertVisibleFocus(page, 'MENU_TOGGLE');
  await page.keyboard.press('Enter');
  await page.locator('#MENU').waitFor({ state: 'hidden' });
  assert.equal(await page.getByRole('button', { name: 'Settings', expanded: false }).count(), 1);
  await assertVisibleFocus(page, 'MENU_TOGGLE');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'CANVAS');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Space');
  await page.locator('#MENU').waitFor({ state: 'visible' });
  assert.equal(await page.getByRole('button', { name: 'Settings', expanded: true }).count(), 1);
  await assertVisibleFocus(page, 'MENU_TOGGLE');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'ROWS');
  console.log('Chromium: tab order is stable and focus stays on the settings toggle as it collapses and expands');

  // The theme toggle keeps focus and the ring keeps its contrast in the dark theme.
  await tabTo(page, 'THEME');
  await page.keyboard.press('Enter');
  assert.equal(await page.getByRole('button', { name: 'Dark theme', pressed: true }).count(), 1);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  await assertVisibleFocus(page, 'THEME');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+Tab');
  await assertVisibleFocus(page, 'ROWS');
  await tabTo(page, 'THEME');
  await page.keyboard.press('Space');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light');
  await assertVisibleFocus(page, 'THEME');
  console.log('Chromium: focus ring contrasts in light and dark themes and theme toggling keeps focus');

  // With settings collapsed, the empty canvas shows its whole focus ring.
  await page.locator('#MENU_TOGGLE').focus();
  await page.keyboard.press('Enter');
  await page.locator('#MENU').waitFor({ state: 'hidden' });
  await page.keyboard.press('Tab');
  await assertVisibleFocus(page, 'CANVAS');
  await assertRenderedFocusRing(page, '#CANVAS');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Enter');
  await page.locator('#MENU').waitFor({ state: 'visible' });
  console.log('Chromium: the empty canvas focus ring is rendered on every edge, unclipped');

  // Keyboard-only play: import, play, focus the canvas, select and swap tiles.
  await page.locator('#CANVAS').focus();
  await page.keyboard.press('ArrowRight');
  assert.match(await page.locator('#PUZZLE_STATUS').textContent(), /^No puzzle yet/);
  await page.locator('#IMPORT').setInputFiles([{ name: 'keyboard.png', mimeType: 'image/png', buffer: await fixture(page, 256, 256) }]);
  await tabTo(page, 'LOAD');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !window.jumbler.importing && !document.getElementById('PLAY').disabled);
  await page.locator('#UPLOADED').focus();
  await tabTo(page, 'PLAY');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => window.jumbler.fragments.length), 16);
  assert.match(await page.locator('#PUZZLE_STATUS').textContent(), /Puzzle ready/);

  const blue = [49, 102, 177];
  assert.deepEqual(await canvasPixel(page, 1, 1), blue);
  await tabTo(page, 'CANVAS');
  await assertVisibleFocus(page, 'CANVAS');
  assert.deepEqual(await canvasPixel(page, 1, 1), [0, 0, 0], 'the virtual cursor is drawn on the focused canvas');
  assert.deepEqual(await canvasPixel(page, 19, 19), blue);

  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#PUZZLE_STATUS').textContent(), 'row 1, column 2.');
  const tile1 = await page.evaluate(() => window.jumbler.fragments[1]);
  assert.deepEqual(await canvasPixel(page, tile1.x + 1, tile1.y + 1), [0, 0, 0]);
  assert.deepEqual(await canvasPixel(page, 1, 1), blue, 'the cursor moves off the first tile');
  assert.equal(await page.evaluate(() => window.scrollY), 0, 'arrow keys do not scroll the page');

  await page.keyboard.press('Enter');
  assert.match(await page.locator('#PUZZLE_STATUS').textContent(), /Showing the original image/);
  assert.equal(await page.evaluate(() => window.jumbler.keyboardSession.selected), null);

  await page.locator('#ORIGINAL').click();
  assert.equal(await page.getByRole('button', { name: 'Show original image', pressed: false }).count(), 1);
  await page.locator('#CANVAS').focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Enter');
  assert.match(await page.locator('#PUZZLE_STATUS').textContent(), /^Selected row 1, column 1\./);
  assert.notDeepEqual(await canvasPixel(page, 19, 19), blue, 'the selected tile is highlighted');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Space');
  assert.equal(await page.locator('#PUZZLE_STATUS').textContent(),
    'Swapped row 1, column 1 with row 2, column 2. 87% complete.');
  assert.equal(await page.locator('#COMPLETED').textContent(), '87%');
  assert.equal(await page.evaluate(() => {
    const { fragments, original } = window.jumbler;
    return fragments[0].frag === original[5].frag && fragments[5].frag === original[0].frag;
  }), true);

  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#PUZZLE_STATUS').textContent(), 'Selection cancelled.');
  assert.equal(await page.evaluate(() => window.jumbler.keyboardSession.selected), null);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#PUZZLE_STATUS').textContent(), 'Deselected row 2, column 2.');
  console.log('Chromium: keyboard selects, swaps, cancels, and deselects tiles with a drawn cursor and status');

  // Pointer swaps still work alongside the keyboard once settings no longer cover the canvas.
  await page.locator('#MENU_TOGGLE').click();
  await page.locator('#MENU').waitFor({ state: 'hidden' });
  const box = await page.locator('#CANVAS').boundingBox();
  const [first, second] = await page.evaluate(() => window.jumbler.fragments.slice(0, 2).map(tile => ({
    x: tile.x + tile.width / 2, y: tile.y + tile.height / 2,
  })));
  await page.mouse.move(box.x + first.x, box.y + first.y);
  await page.mouse.down();
  await page.mouse.move(box.x + second.x, box.y + second.y);
  await page.mouse.up();
  assert.equal(await page.evaluate(() => {
    const { fragments, original } = window.jumbler;
    return fragments[0].frag === original[1].frag && fragments[1].frag === original[5].frag;
  }), true);
  assert.deepEqual(await canvasPixel(page, 1, 1), blue, 'a pointer swap does not draw the keyboard cursor');
  await page.locator('#MENU_TOGGLE').focus();
  await page.keyboard.press('Tab');
  await assertVisibleFocus(page, 'CANVAS');
  await assertRenderedFocusRing(page, '#CANVAS');
  console.log('Chromium: pointer swaps are preserved');

  // Solve a jumbled puzzle by keyboard; completion is announced, not alerted.
  await page.locator('#JUMBLE').click();
  assert.deepEqual(dialogs, ['confirm']);
  assert.match(await page.locator('#PUZZLE_STATUS').textContent(), /^Tiles jumbled\. \d+% complete\.$/);
  await page.locator('#CANVAS').focus();
  let announcements = 0;
  for(let target = 0; target < 16; target++)
  {
    const source = await page.evaluate(index => {
      const { fragments, original } = window.jumbler;
      return fragments.findIndex(tile => tile.frag === original[index].frag);
    }, target);
    if(source === target) continue;
    await moveCursorTo(page, source);
    await page.keyboard.press('Enter');
    await moveCursorTo(page, target);
    await page.keyboard.press('Enter');
    assert.match(await page.locator('#PUZZLE_STATUS').textContent(), /^Swapped row \d+, column \d+ with row \d+, column \d+\./);
    announcements++;
  }
  assert.ok(announcements > 0);
  assert.equal(await page.locator('#PUZZLE_STATUS').textContent().then(text => text.endsWith('Puzzle complete. Well done!')), true);
  assert.equal(await page.locator('#COMPLETED').textContent(), '100%');
  assert.deepEqual(dialogs, ['confirm'], 'completion does not open an alert');
  console.log('Chromium: a jumbled puzzle can be solved by keyboard and completion is announced politely');

  await page.close();
}

try
{
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(10000);
  await page.goto(url);
  await page.waitForFunction(() => Boolean(window.jumbler));
  assert.equal(await page.locator('#PLAY').isDisabled(), true);
  assert.equal(await page.locator('#IMPORT').getAttribute('accept'), 'image/png,image/jpeg,image/webp,image/gif');

  let status = await importFiles(page, [{ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') }]);
  assert.match(status, /Choose PNG/);
  assert.equal(await page.locator('#UPLOADED option').count(), 0);
  assert.equal(await page.locator('#PLAY').isDisabled(), true);
  console.log('Chromium: unsupported file rejected before selector or play changes');

  await page.evaluate(() => {
    window.__decodeCalls = 0;
    const decode = Image.prototype.decode;
    Image.prototype.decode = function(...args) {
      window.__decodeCalls++;
      return decode.apply(this, args);
    };
  });
  status = await importFiles(page, [{ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not a png') }]);
  assert.match(status, /could not be decoded/);
  assert.equal(await page.evaluate(() => window.__decodeCalls), 0);
  status = await importFiles(page, [{ name: 'corrupt-idat.png', mimeType: 'image/png', buffer: corruptDecodedPng() }]);
  assert.match(status, /could not be decoded/);
  assert.equal(await page.evaluate(() => window.__decodeCalls), 1);
  assert.equal(await page.locator('#UPLOADED option').count(), 0);
  assert.equal(await page.locator('#PLAY').isDisabled(), true);
  console.log('Chromium: header rejection skips decode; corrupt image data fails in Chromium decode and leaves play disabled');

  const valid = await fixture(page);
  await page.evaluate(() => { window.__decodeCalls = 0; });
  status = await importFiles(page, [
    { name: 'good.png', mimeType: 'image/png', buffer: valid },
    { name: 'bad.png', mimeType: 'image/png', buffer: corruptDecodedPng() },
  ]);
  assert.match(status, /could not be decoded/);
  assert.equal(await page.evaluate(() => window.__decodeCalls), 2);
  assert.equal(await page.locator('#UPLOADED option').count(), 0);
  assert.equal(await page.locator('#PLAY').isDisabled(), true);
  console.log('Chromium: a decode failure after a valid image leaves a multi-file batch uncommitted');

  status = await importFiles(page, [{ name: 'valid.png', mimeType: 'image/png', buffer: valid }]);
  assert.match(status, /ready to play/);
  assert.equal(await page.locator('#PLAY').isEnabled(), true);
  assert.deepEqual(await page.locator('#UPLOADED option').allTextContents(), ['valid.png']);
  await page.locator('#PLAY').click();
  assert.equal(await page.evaluate(() => window.jumbler.fragments.length), 16);
  await page.evaluate(() => {
    window.__prior = {
      image: window.jumbler.current_img,
      fragments: window.jumbler.fragments,
      width: document.getElementById('CANVAS').width,
      height: document.getElementById('CANVAS').height,
    };
  });
  console.log('Chromium: decoded image appears in selector and plays');

  await page.evaluate(() => { window.__decodeCalls = 0; });
  status = await importFiles(page, [
    { name: 'another-good.png', mimeType: 'image/png', buffer: valid },
    { name: 'another-bad.png', mimeType: 'image/png', buffer: corruptDecodedPng() },
  ]);
  assert.match(status, /could not be decoded/);
  assert.equal(await page.evaluate(() => window.__decodeCalls), 2);
  assert.deepEqual(await page.locator('#UPLOADED option').allTextContents(), ['valid.png']);
  assert.equal(await page.locator('#PLAY').isEnabled(), true);
  assert.equal(await page.evaluate(() => {
    const puzzle = window.jumbler;
    const canvas = document.getElementById('CANVAS');
    return puzzle.current_img === window.__prior.image && puzzle.fragments === window.__prior.fragments &&
      canvas.width === window.__prior.width && canvas.height === window.__prior.height;
  }), true);
  console.log('Chromium: failed decode preserves the selector, play control, and prior playable puzzle');

  status = await importFiles(page, [{ name: 'too-big.png', mimeType: 'image/png', buffer: Buffer.alloc(10 * 1024 * 1024 + 1) }]);
  assert.match(status, /at most 10 MiB/);
  status = await importFiles(page, Array.from({ length: 3 }, (_, index) => ({
    name: `batch-bytes-${index}.png`, mimeType: 'image/png', buffer: Buffer.alloc(7 * 1024 * 1024),
  })));
  assert.match(status, /at most 20 MiB/);
  const oversized = await fixture(page, 4097, 1);
  status = await importFiles(page, [{ name: 'wide.png', mimeType: 'image/png', buffer: oversized }]);
  assert.match(status, /dimension or pixel limit/);
  await page.evaluate(() => { window.__decodeCalls = 0; });
  status = await importFiles(page, [{ name: 'compressed-8192.png', mimeType: 'image/png', buffer: oversizedCompressedPng() }]);
  assert.match(status, /dimension or pixel limit/);
  assert.equal(await page.evaluate(() => window.__decodeCalls), 0);
  assert.deepEqual(await page.locator('#UPLOADED option').allTextContents(), ['valid.png']);
  status = await importFiles(page, Array.from({ length: 8 }, (_, index) => ({ name: `batch-${index}.png`, mimeType: 'image/png', buffer: valid })));
  assert.match(status, /at most 8 images/);
  assert.deepEqual(await page.locator('#UPLOADED option').allTextContents(), ['valid.png']);
  assert.equal(await page.evaluate(() => {
    const puzzle = window.jumbler;
    return puzzle.current_img === window.__prior.image && puzzle.fragments === window.__prior.fragments;
  }), true);
  console.log('Chromium: file, compressed image dimensions, batch-size, and image-count limits preserve the puzzle before decode');

  for(const [rows, columns] of [['0', '4'], ['33', '4'], ['17', '16'], ['1.5', '4'], ['1e2', '4']])
  {
    await page.evaluate(([r, c]) => {
      document.getElementById('ROWS').value = r;
      document.getElementById('COLUMNS').value = c;
    }, [rows, columns]);
    await page.locator('#PLAY').click();
    assert.match(await page.locator('#STATUS').textContent(), /Enter whole rows and columns/);
    assert.equal(await page.evaluate(() => {
      const puzzle = window.jumbler;
      const canvas = document.getElementById('CANVAS');
      return puzzle.current_img === window.__prior.image && puzzle.fragments === window.__prior.fragments &&
        canvas.width === window.__prior.width && canvas.height === window.__prior.height;
    }), true);
  }
  assert.equal(await page.locator('#PLAY').isEnabled(), true);
  console.log('Chromium: invalid grids preserve the previous playable puzzle');

  await page.locator('#ROWS').fill('4');
  await page.locator('#COLUMNS').fill('4');
  await page.locator('#PLAY').click();
  assert.equal(await page.evaluate(() => window.jumbler.fragments.length), 16);
  console.log('Chromium: valid play continues after rejected inputs');

  await page.reload();
  await page.waitForFunction(() => Boolean(window.jumbler));
  const large = await fixture(page, 4096, 2048);
  status = await importFiles(page, [
    { name: 'large-a.png', mimeType: 'image/png', buffer: large },
    { name: 'large-b.png', mimeType: 'image/png', buffer: large },
  ]);
  assert.match(status, /2 images ready/);
  status = await importFiles(page, [{ name: 'large-c.png', mimeType: 'image/png', buffer: large }]);
  assert.match(status, /decoded pixel limit/);
  assert.equal(await page.locator('#UPLOADED option').count(), 2);
  console.log('Chromium: decoded-image library pixel budget is enforced');

  await verifyAccessibility(browser);
}
catch(error)
{
  console.error('Browser verification failed:', error);
  console.error('Vite output:', serverLog);
  process.exitCode = 1;
}
finally
{
  await browser?.close();
  server.kill('SIGTERM');
  await Promise.race([new Promise(resolve => server.once('exit', resolve)), delay(2000)]);
  if(server.exitCode === null) server.kill('SIGKILL');
}
