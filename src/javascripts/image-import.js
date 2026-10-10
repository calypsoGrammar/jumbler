export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
export const MAX_LIBRARY_IMAGES = 8;
export const MAX_IMAGE_DIMENSION = 4096;
export const MAX_IMAGE_PIXELS = 4_194_304;
export const MAX_LIBRARY_PIXELS = 16_777_216;

const SUPPORTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

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
