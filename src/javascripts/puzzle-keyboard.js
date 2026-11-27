export function tileLabel(index, tilesAcross)
{
  const row = Math.floor(index / tilesAcross) + 1;
  const column = index % tilesAcross + 1;
  return `row ${row}, column ${column}`;
}

export function swapFragmentImages(fragments, firstIndex, secondIndex)
{
  const first = fragments[firstIndex];
  const second = fragments[secondIndex];
  if(!first || !second || first === second) return false;

  const firstImage = first.frag;
  first.frag = second.frag;
  second.frag = firstImage;
  return true;
}

export class KeyboardSwapSession
{
  constructor()
  {
    this.cursor = 0;
    this.selected = null;
  }

  reset()
  {
    this.cursor = 0;
    this.selected = null;
  }

  // Returns true when the key is a navigation key, whether or not the cursor
  // moved; the cursor stops at the grid edges.
  move(key, tilesAcross, tilesDown)
  {
    if(!Number.isInteger(tilesAcross) || !Number.isInteger(tilesDown) || tilesAcross < 1 || tilesDown < 1) return false;

    const total = tilesAcross * tilesDown;
    const cursor = Math.min(Math.max(this.cursor, 0), total - 1);
    const row = Math.floor(cursor / tilesAcross);
    const column = cursor % tilesAcross;

    let next;
    switch(key)
    {
      case 'ArrowLeft': next = column > 0 ? cursor - 1 : cursor; break;
      case 'ArrowRight': next = column < tilesAcross - 1 ? cursor + 1 : cursor; break;
      case 'ArrowUp': next = row > 0 ? cursor - tilesAcross : cursor; break;
      case 'ArrowDown': next = row < tilesDown - 1 ? cursor + tilesAcross : cursor; break;
      case 'Home': next = row * tilesAcross; break;
      case 'End': next = row * tilesAcross + tilesAcross - 1; break;
      default: return false;
    }
    this.cursor = next;
    return true;
  }

  // Enter/Space: select the tile under the cursor, deselect it if it is
  // already selected, or swap it with the selected tile.
  activate(fragments)
  {
    const cursor = this.cursor;
    if(!fragments[cursor]) return { action: 'none', first: null, second: cursor };

    if(this.selected === null)
    {
      this.selected = cursor;
      return { action: 'selected', first: cursor, second: cursor };
    }

    const first = this.selected;
    this.selected = null;
    if(first === cursor) return { action: 'deselected', first, second: cursor };
    if(!swapFragmentImages(fragments, first, cursor)) return { action: 'none', first, second: cursor };
    return { action: 'swapped', first, second: cursor };
  }

  cancel()
  {
    if(this.selected === null) return false;
    this.selected = null;
    return true;
  }
}
