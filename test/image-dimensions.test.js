import test from 'node:test';
import assert from 'node:assert/strict';
import { imageDimensions } from '../src/javascripts/image-dimensions.js';

function dimensions(bytes, type)
{
  return imageDimensions(Uint8Array.from(bytes).buffer, type);
}

test('reads encoded dimensions for each supported image type without decoding pixels', () => {
  assert.deepEqual(dimensions([
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
    0, 0, 32, 0, 0, 0, 32, 0,
  ], 'image/png'), { width: 8192, height: 8192 });
  assert.deepEqual(dimensions([
    71, 73, 70, 56, 57, 97, 64, 0, 32, 0,
  ], 'image/gif'), { width: 64, height: 32 });
  assert.deepEqual(dimensions([
    255, 216, 255, 224, 0, 4, 0, 0,
    255, 192, 0, 8, 8, 0, 32, 0, 64, 1,
  ], 'image/jpeg'), { width: 64, height: 32 });
  assert.deepEqual(dimensions([
    82, 73, 70, 70, 22, 0, 0, 0, 87, 69, 66, 80,
    86, 80, 56, 88, 10, 0, 0, 0, 0, 0, 0, 0,
    63, 0, 0, 31, 0, 0,
  ], 'image/webp'), { width: 64, height: 32 });
});

test('rejects truncated and mismatched image headers', () => {
  assert.equal(dimensions([137, 80, 78], 'image/png'), null);
  assert.equal(dimensions([255, 216, 255, 218, 0, 2], 'image/jpeg'), null);
  assert.equal(dimensions([71, 73, 70, 56, 57, 97, 64, 0, 32, 0], 'image/png'), null);
  assert.equal(dimensions([82, 73, 70, 70], 'image/webp'), null);
});
