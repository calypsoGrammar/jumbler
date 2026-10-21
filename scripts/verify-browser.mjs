import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { deflateSync } from 'node:zlib';

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
  // The valid IHDR passes pre-decode dimension checks; IDAT is invalid zlib data.
  return grayscalePng(64, 64, Buffer.from([0, 1, 2, 3, 4]));
}

async function importFiles(page, files)
{
  await page.locator('#IMPORT').setInputFiles(files);
  await page.locator('#LOAD').click();
  await page.waitForFunction(() => !window.jumbler.importing, { timeout: 10000 });
  return page.locator('#STATUS').textContent();
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
