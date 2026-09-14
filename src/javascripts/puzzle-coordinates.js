export function canvasPointFromClient(clientX, clientY, rect, canvasWidth, canvasHeight)
{
  if(!Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
  if(!rect || !Number.isFinite(rect.left) || !Number.isFinite(rect.top)) return null;
  if(!Number.isFinite(rect.width) || !Number.isFinite(rect.height)) return null;
  if(rect.width <= 0 || rect.height <= 0) return null;
  if(!Number.isFinite(canvasWidth) || !Number.isFinite(canvasHeight)) return null;
  if(canvasWidth <= 0 || canvasHeight <= 0) return null;

  const localX = clientX - rect.left;
  const localY = clientY - rect.top;

  if(localX < 0 || localY < 0 || localX >= rect.width || localY >= rect.height) return null;

  return {
    x: localX * canvasWidth / rect.width,
    y: localY * canvasHeight / rect.height,
  };
}

export function tileIndexFromPoint(x, y, canvasWidth, canvasHeight, tilesAcross, tilesDown)
{
  if(!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if(!Number.isFinite(canvasWidth) || !Number.isFinite(canvasHeight)) return null;
  if(canvasWidth <= 0 || canvasHeight <= 0) return null;
  if(!Number.isInteger(tilesAcross) || !Number.isInteger(tilesDown)) return null;
  if(tilesAcross <= 0 || tilesDown <= 0) return null;
  if(x < 0 || y < 0 || x >= canvasWidth || y >= canvasHeight) return null;

  const tileX = Math.floor(x / canvasWidth * tilesAcross);
  const tileY = Math.floor(y / canvasHeight * tilesDown);
  const index = tileX * tilesDown + tileY;
  const total = tilesAcross * tilesDown;

  return index >= 0 && index < total ? index : null;
}
