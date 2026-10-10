export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
export const MAX_LIBRARY_IMAGES = 8;
export const MAX_IMAGE_DIMENSION = 4096;
export const MAX_IMAGE_PIXELS = 4_194_304;
export const MAX_LIBRARY_PIXELS = 16_777_216;

const SUPPORTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const HEADER_BYTES = 64 * 1024;

function sameBytes(bytes, offset, expected)
{
  return expected.every((value, index) => bytes[offset + index] === value);
}

function uint16(bytes, offset, littleEndian = false)
{
  return littleEndian ? bytes[offset] | bytes[offset + 1] << 8 : bytes[offset] << 8 | bytes[offset + 1];
}

function uint32(bytes, offset)
{
  return bytes[offset] * 0x1000000 + bytes[offset + 1] * 0x10000 + bytes[offset + 2] * 0x100 + bytes[offset + 3];
}

export function imageDimensionsFromHeader(bytes, type)
{
  if(type === 'image/png' && bytes.length >= 24 &&
    sameBytes(bytes, 0, [137, 80, 78, 71, 13, 10, 26, 10]) &&
    uint32(bytes, 8) === 13 && sameBytes(bytes, 12, [73, 72, 68, 82]))
  {
    return { width: uint32(bytes, 16), height: uint32(bytes, 20) };
  }

  if(type === 'image/gif' && bytes.length >= 10 &&
    (sameBytes(bytes, 0, [71, 73, 70, 56, 55, 97]) ||
      sameBytes(bytes, 0, [71, 73, 70, 56, 57, 97])))
  {
    return { width: uint16(bytes, 6, true), height: uint16(bytes, 8, true) };
  }

  if(type === 'image/webp' && bytes.length >= 25 &&
    sameBytes(bytes, 0, [82, 73, 70, 70]) && sameBytes(bytes, 8, [87, 69, 66, 80]))
  {
    const chunkLength = bytes[16] | bytes[17] << 8 | bytes[18] << 16 | bytes[19] << 24;
    if(bytes.length >= 30 && sameBytes(bytes, 12, [86, 80, 56, 88]) && chunkLength >= 10)
    {
      return {
        width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16),
        height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16),
      };
    }
    if(sameBytes(bytes, 12, [86, 80, 56, 76]) && chunkLength >= 5 && bytes[20] === 0x2f)
    {
      return {
        width: 1 + bytes[21] + ((bytes[22] & 0x3f) << 8),
        height: 1 + ((bytes[22] >> 6) | (bytes[23] << 2) | ((bytes[24] & 0x0f) << 10)),
      };
    }
    if(bytes.length >= 30 && sameBytes(bytes, 12, [86, 80, 56, 32]) && chunkLength >= 10 &&
      sameBytes(bytes, 23, [0x9d, 0x01, 0x2a]))
    {
      return { width: uint16(bytes, 26, true) & 0x3fff, height: uint16(bytes, 28, true) & 0x3fff };
    }
  }

  if(type === 'image/jpeg' && bytes.length >= 4 && sameBytes(bytes, 0, [0xff, 0xd8]))
  {
    let offset = 2;
    while(offset + 4 <= bytes.length)
    {
      if(bytes[offset++] !== 0xff) return null;
      while(bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if(marker === 0xd9 || marker === 0xda || marker === undefined) return null;
      if(marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
      if(offset + 2 > bytes.length) return null;
      const length = uint16(bytes, offset);
      if(length < 2 || offset + length > bytes.length) return null;
      if((marker >= 0xc0 && marker <= 0xcf) && ![0xc4, 0xc8, 0xcc].includes(marker))
      {
        if(length < 7) return null;
        return { width: uint16(bytes, offset + 5), height: uint16(bytes, offset + 3) };
      }
      offset += length;
    }
  }
  return null;
}

export async function validateImageBeforeDecode(file, existingImages)
{
  let dimensions;
  try
  {
    const bytes = new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer());
    dimensions = imageDimensionsFromHeader(bytes, file.type);
  }
  catch
  {
    return 'Could not read the image header.';
  }
  if(!dimensions) return 'Could not identify image dimensions from its header.';
  return validateDecodedImage({ naturalWidth: dimensions.width, naturalHeight: dimensions.height }, existingImages);
}

export function validateGrid(rowsValue, columnsValue)
{
  const parse = value => {
    if(String(value).trim() === '') return NaN;
    return Number(value);
  };
  const rows = parse(rowsValue);
  const columns = parse(columnsValue);
  if(!Number.isSafeInteger(rows) || !Number.isSafeInteger(columns) ||
    rows < 1 || columns < 1 || rows > MAX_TILES_PER_AXIS || columns > MAX_TILES_PER_AXIS ||
    rows * columns > MAX_PUZZLE_TILES)
  {
    return { error: 'Rows and columns must be whole numbers from 1 to 64 (at most 4,096 tiles).' };
  }
  return { rows, columns };
}

export function validateImport(files, existingImages)
{
  if(files.length === 0) return null;
  if(files.length + existingImages.length > MAX_LIBRARY_IMAGES)
  {
    return `The image library holds at most ${MAX_LIBRARY_IMAGES} images.`;
  }
  let bytes = 0;
  for(const file of files)
  {
    if(!SUPPORTED_TYPES.has(file.type)) return `${file.name}: choose a JPEG, PNG, WebP, or GIF image.`;
    if(!Number.isSafeInteger(file.size) || file.size < 1 || file.size > MAX_FILE_BYTES)
    {
      return `${file.name}: image files must be at most 8 MiB.`;
    }
    bytes += file.size;
  }
  if(bytes > MAX_IMPORT_BYTES) return 'Select at most 20 MiB of images at once.';
  return null;
}

export function validateDecodedImage(image, existingImages)
{
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  const pixels = width * height;
  if(!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
    width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION || pixels > MAX_IMAGE_PIXELS)
  {
    return 'Image dimensions must be at most 4,096 pixels per side and 4,194,304 pixels total.';
  }
  const usedPixels = existingImages.reduce((total, item) => total + item.naturalWidth * item.naturalHeight, 0);
  if(usedPixels + pixels > MAX_LIBRARY_PIXELS)
  {
    return 'The image library is full (16,777,216 decoded pixels maximum).';
  }
  return null;
}

export function readDecodedImage(file, Reader = FileReader, ImageConstructor = Image)
{
  return new Promise((resolve, reject) => {
    const reader = new Reader();
    reader.onerror = () => reject(new Error('Could not read the image file.'));
    reader.onabort = () => reject(new Error('Image file reading was cancelled.'));
    reader.onload = async () => {
      try
      {
        const image = new ImageConstructor();
        image.src = reader.result;
        await image.decode();
        resolve(image);
      }
      catch
      {
        reject(new Error('Image decode failed. Choose a valid image file.'));
      }
    };
    try { reader.readAsDataURL(file); }
    catch { reject(new Error('Could not read the image file.')); }
  });
}
import { MAX_PUZZLE_TILES, MAX_TILES_PER_AXIS } from './puzzle-scaling.js';
