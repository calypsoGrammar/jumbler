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
  const index = tileY * tilesAcross + tileX;
  const total = tilesAcross * tilesDown;

  return index >= 0 && index < total ? index : null;
}

function fragmentIndexFromPoint(point, fragments)
{
  const index = fragments.findIndex(fragment => (
    Number.isInteger(fragment.x)
      && Number.isInteger(fragment.y)
      && Number.isInteger(fragment.width)
      && Number.isInteger(fragment.height)
      && point.x >= fragment.x
      && point.x < fragment.x + fragment.width
      && point.y >= fragment.y
      && point.y < fragment.y + fragment.height
  ));
  return index === -1 ? null : index;
}

export class PointerSwapSession
{
  constructor()
  {
    this.activePointerId = null;
    this.firstIndex = null;
  }

  begin(pointerId, point, puzzle)
  {
    if(this.activePointerId !== null || !point) return false;

    const index = this.indexForPoint(point, puzzle);
    if(!this.hasFragment(index, puzzle)) return false;

    this.activePointerId = pointerId;
    this.firstIndex = index;
    return true;
  }

  finish(pointerId, point, puzzle)
  {
    if(pointerId !== this.activePointerId) return { handled: false, valid: false, swapped: false };

    const secondIndex = point ? this.indexForPoint(point, puzzle) : null;
    const firstFragment = this.hasFragment(this.firstIndex, puzzle) ? puzzle.fragments[this.firstIndex] : null;
    const secondFragment = this.hasFragment(secondIndex, puzzle) ? puzzle.fragments[secondIndex] : null;

    this.clear();
    if(!firstFragment || !secondFragment) return { handled: true, valid: false, swapped: false };
    if(firstFragment === secondFragment) return { handled: true, valid: true, swapped: false };

    const firstImage = firstFragment.frag;
    firstFragment.frag = secondFragment.frag;
    secondFragment.frag = firstImage;
    return { handled: true, valid: true, swapped: true };
  }

  cancel(pointerId)
  {
    if(pointerId !== this.activePointerId) return false;
    this.clear();
    return true;
  }

  indexForPoint(point, puzzle)
  {
    const fragmentIndex = fragmentIndexFromPoint(point, puzzle.fragments);
    if(fragmentIndex !== null) return fragmentIndex;

    return tileIndexFromPoint(
      point.x,
      point.y,
      puzzle.canvasWidth,
      puzzle.canvasHeight,
      puzzle.tilesAcross,
      puzzle.tilesDown,
    );
  }

  hasFragment(index, puzzle)
  {
    return Number.isInteger(index)
      && index >= 0
      && index < puzzle.fragments.length
      && Boolean(puzzle.fragments[index]);
  }

  clear()
  {
    this.activePointerId = null;
    this.firstIndex = null;
  }
}
