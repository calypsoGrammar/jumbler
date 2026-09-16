export const MIN_PUZZLE_SCALE = 0.1;
export const MAX_PUZZLE_SCALE = 2;
export const PUZZLE_SCALE_STEP = 0.1;

// These limits bound both canvas allocation and the per-tile pixel extraction work.
export const MAX_CANVAS_DIMENSION = 4096;
export const MAX_CANVAS_PIXELS = 4_194_304;
export const MAX_TILES_PER_AXIS = 64;
export const MAX_PUZZLE_TILES = 4096;

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

export function puzzleScaleControlState(scale)
{
  return {
    scaleDownDisabled: scale <= MIN_PUZZLE_SCALE,
    scaleUpDisabled: scale >= MAX_PUZZLE_SCALE,
    label: Math.round(scale * 100).toString() + "%",
  };
}

function pixelPartitions(length, count)
{
  return Array.from({ length: count }, (_, index) => {
    const start = Math.ceil(index * length / count);
    const end = Math.ceil((index + 1) * length / count);
    return { start, size: end - start };
  });
}

export function puzzleGeometry(imageWidth, imageHeight, tilesAcross, tilesDown, scale)
{
  if(!Number.isFinite(imageWidth) || !Number.isFinite(imageHeight)) return null;
  if(!Number.isInteger(tilesAcross) || !Number.isInteger(tilesDown)) return null;
  if(!Number.isFinite(scale) || scale < MIN_PUZZLE_SCALE || scale > MAX_PUZZLE_SCALE) return null;
  if(imageWidth <= 0 || imageHeight <= 0 || tilesAcross <= 0 || tilesDown <= 0) return null;
  if(tilesAcross > MAX_TILES_PER_AXIS || tilesDown > MAX_TILES_PER_AXIS) return null;

  const scaledWidth = Math.floor(imageWidth * scale);
  const scaledHeight = Math.floor(imageHeight * scale);
  if(scaledWidth < tilesAcross || scaledHeight < tilesDown) return null;

  // Equal integer tile sizes let raw ImageData move between every grid position safely.
  const canvasWidth = scaledWidth - scaledWidth % tilesAcross;
  const canvasHeight = scaledHeight - scaledHeight % tilesDown;
  const canvasPixels = canvasWidth * canvasHeight;
  const total = tilesAcross * tilesDown;

  if(canvasWidth > MAX_CANVAS_DIMENSION || canvasHeight > MAX_CANVAS_DIMENSION) return null;
  if(!Number.isSafeInteger(canvasPixels) || canvasPixels > MAX_CANVAS_PIXELS) return null;
  if(!Number.isSafeInteger(total) || total > MAX_PUZZLE_TILES) return null;

  return {
    canvasWidth,
    canvasHeight,
    tileWidth: canvasWidth / tilesAcross,
    tileHeight: canvasHeight / tilesDown,
    columns: pixelPartitions(canvasWidth, tilesAcross),
    rows: pixelPartitions(canvasHeight, tilesDown),
    total,
  };
}

export function drawPuzzleFragments(context, fragments)
{
  for(const fragment of fragments)
  {
    context.putImageData(fragment.frag, fragment.x, fragment.y);
  }
}

export function resizePuzzle({
  canvas,
  context,
  createCanvas,
  image,
  tilesAcross,
  tilesDown,
  scale,
  redraw,
  reportError = (message, error) => console.warn(message, error),
})
{
  const width = Number(image && image.width);
  const height = Number(image && image.height);
  const geometry = puzzleGeometry(width, height, tilesAcross, tilesDown, scale);
  if(geometry === null || typeof createCanvas !== 'function') return null;

  let stagingCanvas;
  let stagingContext;
  try
  {
    stagingCanvas = createCanvas();
    stagingCanvas.width = geometry.canvasWidth;
    stagingCanvas.height = geometry.canvasHeight;
    stagingContext = stagingCanvas.getContext('2d');
  }
  catch(error)
  {
    reportError('Unable to allocate puzzle canvas.', error);
    return null;
  }
  if(stagingContext === null) return null;

  const fragments = [];
  try
  {
    stagingContext.drawImage(image, 0, 0, geometry.canvasWidth, geometry.canvasHeight);
    for(let tileX = 0; tileX < tilesAcross; tileX++)
    {
      for(let tileY = 0; tileY < tilesDown; tileY++)
      {
        const horizontal = geometry.columns[tileX];
        const vertical = geometry.rows[tileY];
        const imgData = stagingContext.getImageData(
          horizontal.start,
          vertical.start,
          horizontal.size,
          vertical.size,
        );
        fragments.push({
          index: fragments.length,
          row: tileX,
          column: tileY,
          x: horizontal.start,
          y: vertical.start,
          width: horizontal.size,
          height: vertical.size,
          frag: imgData,
        });
      }
    }
  }
  catch(error)
  {
    reportError('Unable to resize puzzle canvas.', error);
    return null;
  }

  const previousWidth = canvas.width;
  const previousHeight = canvas.height;
  try
  {
    canvas.width = geometry.canvasWidth;
    canvas.height = geometry.canvasHeight;
    drawPuzzleFragments(context, fragments);
  }
  catch(error)
  {
    canvas.width = previousWidth;
    canvas.height = previousHeight;
    if(typeof redraw === 'function')
    {
      try
      {
        redraw();
      }
      catch(redrawError)
      {
        reportError('Unable to restore puzzle canvas.', redrawError);
      }
    }
    reportError('Unable to commit resized puzzle canvas.', error);
    return null;
  }

  return { geometry, width, height, fragments };
}
