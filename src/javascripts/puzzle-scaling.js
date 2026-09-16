export const MIN_PUZZLE_SCALE = 0.1;
export const MAX_PUZZLE_SCALE = 2;
export const PUZZLE_SCALE_STEP = 0.1;

export const MAX_CANVAS_DIMENSION = 8192;
export const MAX_CANVAS_PIXELS = 16_777_216;

function roundedScale(value)
{
  return Number(value.toFixed(2));
}

export function nextPuzzleScale(currentScale, direction)
{
  if(!Number.isFinite(currentScale)) return null;
  if(currentScale < MIN_PUZZLE_SCALE || currentScale > MAX_PUZZLE_SCALE) return null;
  if(direction !== -1 && direction !== 1) return null;

  const requested = roundedScale(currentScale + direction * PUZZLE_SCALE_STEP);
  return Math.min(MAX_PUZZLE_SCALE, Math.max(MIN_PUZZLE_SCALE, requested));
}

export function attemptPuzzleScale(currentScale, direction, resize)
{
  const candidate = nextPuzzleScale(currentScale, direction);
  if(candidate === null || candidate === currentScale)
  {
    return { scale: currentScale, applied: false };
  }

  if(typeof resize !== 'function' || resize(candidate) !== true)
  {
    return { scale: currentScale, applied: false };
  }

  return { scale: candidate, applied: true };
}

export function puzzleGeometry(imageWidth, imageHeight, tilesAcross, tilesDown, scale)
{
  if(!Number.isFinite(imageWidth) || !Number.isFinite(imageHeight)) return null;
  if(!Number.isInteger(tilesAcross) || !Number.isInteger(tilesDown)) return null;
  if(!Number.isFinite(scale) || scale < MIN_PUZZLE_SCALE || scale > MAX_PUZZLE_SCALE) return null;
  if(imageWidth <= 0 || imageHeight <= 0 || tilesAcross <= 0 || tilesDown <= 0) return null;

  const canvasWidth = Math.floor(imageWidth * scale);
  const canvasHeight = Math.floor(imageHeight * scale);
  const canvasPixels = canvasWidth * canvasHeight;

  if(canvasWidth < tilesAcross || canvasHeight < tilesDown) return null;
  if(canvasWidth > MAX_CANVAS_DIMENSION || canvasHeight > MAX_CANVAS_DIMENSION) return null;
  if(!Number.isSafeInteger(canvasPixels) || canvasPixels > MAX_CANVAS_PIXELS) return null;

  return {
    canvasWidth,
    canvasHeight,
    tileWidth: canvasWidth / tilesAcross,
    tileHeight: canvasHeight / tilesDown,
    total: tilesAcross * tilesDown,
  };
}
