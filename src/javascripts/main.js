"use strict"

import svg from './svg.js';
import { imageDimensions } from './image-dimensions.js';
import Alpine from 'alpinejs';
import { canvasPointFromClient, PointerSwapSession } from './puzzle-coordinates.js';
import { KeyboardSwapSession, tileLabel } from './puzzle-keyboard.js';
import {
  applyPuzzleResize,
  attemptPuzzleScale,
  drawPuzzleFragments,
  puzzleCompletionPercent,
  puzzleScaleControlState,
  MAX_PUZZLE_TILES,
  MAX_TILES_PER_AXIS,
} from './puzzle-scaling.js';

const SUPPORTED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_BATCH_BYTES = 20 * 1024 * 1024;
const MAX_LIBRARY_IMAGES = 8;
const MAX_IMAGE_DIMENSION = 4096;
const MAX_IMAGE_PIXELS = 8_388_608;
const MAX_LIBRARY_PIXELS = 16_777_216;
const NAVIGATION_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']);

function readFile(file)
{
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.onabort = () => reject(new Error(`Reading ${file.name} was cancelled.`));
    reader.readAsDataURL(file);
  });
}

window.Alpine = Alpine;
Alpine.start();

const NAV = document.getElementById("NAV");
const MENU = document.getElementById("MENU");

const ORIGINAL = document.getElementById("ORIGINAL");
const COMPLETED = document.getElementById("COMPLETED");
const JUMBLE = document.getElementById("JUMBLE");

const SCALE_DOWN = document.getElementById("SCALE_DOWN");
const SCALE_UP = document.getElementById("SCALE_UP");
const SCALE_VALUE = document.getElementById("SCALE_VALUE");

const UP = document.getElementById("UP");
const DOWN = document.getElementById("DOWN");

const ROWS = document.getElementById("ROWS");
const COLUMNS = document.getElementById("COLUMNS");
const THEME = document.getElementById("THEME");

const UPLOADED = document.getElementById("UPLOADED");
const PLAY = document.getElementById("PLAY");
const SELECT = document.getElementById("SELECT");
const IMPORT = document.getElementById("IMPORT");
const LOAD = document.getElementById("LOAD");
const STATUS = document.getElementById("STATUS");
const PUZZLE_STATUS = document.getElementById("PUZZLE_STATUS");

ORIGINAL.innerHTML = svg.eye.trim();
JUMBLE.innerHTML = svg.dice.trim();

UP.innerHTML = svg.up.trim();
DOWN.innerHTML = svg.down.trim();

THEME.innerHTML = svg.theme.trim();

const BOARD = document.getElementById("BOARD");
const CANVAS = document.getElementById("CANVAS");
const c = CANVAS.getContext("2d");

ORIGINAL.onclick = function(){ window.jumbler.is_original() };
JUMBLE.onclick = function(){ window.jumbler.jumble() };

SCALE_DOWN.onclick = function(){ window.jumbler.scale_down() };
SCALE_UP.onclick = function(){ window.jumbler.scale_up() };

THEME.onclick = function(){ window.jumbler.toggle_dark() };

PLAY.onclick = function(){ window.jumbler.reload() };
SELECT.onclick = function(){ IMPORT.click() };
LOAD.onclick = function(){ window.jumbler.import() };

class Jumbler
{
  constructor(

    )
  {
    this.debug = false;
    this.dark = false;
    this.show_original = true;

    this.w = 0;
    this.h = 0;
    this.tW = 0;
    this.tH = 0;
    this.total = 0;
    this.pointerSession = new PointerSwapSession();
    this.keyboardSession = new KeyboardSwapSession();
    this.keyboard_cursor = false;
    this.completed_percent = null;

    this.scale = 0.6;
    this.original = [];
    this.fragments = [];
    this.uploaded_files = [];
    this.library_pixels = 0;
    this.importing = false;

    this.stored_width = 0;
    this.stored_height = 0;
    this.stored_rows = 0;
    this.stored_columns = 0;

    this.playing = false;

    this.current_img = new Image();
    this.update_scale_controls();
  }

  toggle_dark()
  {
    this.dark = !this.dark;
    THEME.setAttribute('aria-pressed', String(this.dark));
    this.update_menus();
    this.draw();
  }

  update_menus()
  {
    document.documentElement.dataset.theme = this.dark ? 'dark' : 'light';
    if(this.dark)
    {
      document.body.classList.remove('bg-mod_light');
      document.body.classList.add('bg-mod_dark');
      document.body.classList.remove('text-mod_dark');
      document.body.classList.add('text-mod_light');

      NAV.classList.remove('bg-mod_light');
      MENU.classList.remove('bg-mod_light');

      NAV.classList.add('bg-mod_dark');
      MENU.classList.add('bg-mod_dark');

      NAV.classList.remove('text-mod_dark');
      MENU.classList.remove('text-mod_dark');

      NAV.classList.add('text-mod_light');
      MENU.classList.add('text-mod_light');
    }
    else
    {
      document.body.classList.remove('bg-mod_dark');
      document.body.classList.add('bg-mod_light');
      document.body.classList.remove('text-mod_light');
      document.body.classList.add('text-mod_dark');

      NAV.classList.remove('bg-mod_dark');
      MENU.classList.remove('bg-mod_dark');

      NAV.classList.add('bg-mod_light');
      MENU.classList.add('bg-mod_light');

      NAV.classList.remove('text-mod_light');
      MENU.classList.remove('text-mod_light');

      NAV.classList.add('text-mod_dark');
      MENU.classList.add('text-mod_dark');
    }
  }

  async import()
  {
    if(this.importing) return;
    const files = Array.from(IMPORT.files);
    IMPORT.value = '';
    if(files.length === 0) return;

    if(files.length + this.uploaded_files.length > MAX_LIBRARY_IMAGES)
    {
      STATUS.textContent = `The image library holds at most ${MAX_LIBRARY_IMAGES} images.`;
      return;
    }
    if(files.some(file => !SUPPORTED_TYPES.has(file.type)))
    {
      STATUS.textContent = 'Choose PNG, JPEG, WebP, or GIF image files.';
      return;
    }
    if(files.some(file => file.size === 0 || file.size > MAX_FILE_BYTES))
    {
      STATUS.textContent = 'Each image must be nonempty and at most 10 MiB.';
      return;
    }
    if(files.reduce((bytes, file) => bytes + file.size, 0) > MAX_BATCH_BYTES)
    {
      STATUS.textContent = 'A selection may contain at most 20 MiB of images.';
      return;
    }

    this.importing = true;
    LOAD.disabled = true;
    STATUS.textContent = 'Checking images…';
    const pending = [];
    const checked = [];
    let pendingPixels = 0;
    try
    {
      for(const file of files)
      {
        let dimensions;
        try { dimensions = imageDimensions(await file.arrayBuffer(), file.type); }
        catch { throw new Error(`Could not read ${file.name}.`); }
        if(!dimensions) throw new Error(`${file.name} could not be decoded as an image.`);
        const { width, height } = dimensions;
        const pixels = width * height;
        if(width === 0 || height === 0 || width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION || pixels > MAX_IMAGE_PIXELS)
        {
          throw new Error(`${file.name} exceeds the image dimension or pixel limit.`);
        }
        pendingPixels += pixels;
        if(this.library_pixels + pendingPixels > MAX_LIBRARY_PIXELS)
        {
          throw new Error('The image library exceeds its decoded pixel limit.');
        }
        checked.push(file);
      }

      for(const file of checked)
      {
        const image = new Image();
        image.src = await readFile(file);
        try { await image.decode(); }
        catch { throw new Error(`${file.name} could not be decoded as an image.`); }
        const width = image.naturalWidth;
        const height = image.naturalHeight;
        if(width === 0 || height === 0 || width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION ||
           width * height > MAX_IMAGE_PIXELS)
        {
          throw new Error(`${file.name} exceeds the image dimension or pixel limit.`);
        }
        pending.push({ image, name: file.name });
      }

      for(const { image, name } of pending)
      {
        const option = document.createElement('option');
        option.value = this.uploaded_files.length;
        option.textContent = name;
        this.uploaded_files.push(image);
        UPLOADED.appendChild(option);
      }
      this.library_pixels += pendingPixels;
      PLAY.disabled = false;
      STATUS.textContent = `${pending.length} image${pending.length === 1 ? '' : 's'} ready to play.`;
    }
    catch(error)
    {
      STATUS.textContent = error.message || 'Unable to import images.';
    }
    finally
    {
      this.importing = false;
      LOAD.disabled = false;
    }
  }

  reload()
  {
    if(this.uploaded_files.length == 0) return;
    const nextImage = this.uploaded_files[UPLOADED.value];
    if(!nextImage) return;
    if(this.init(this.scale, nextImage))
    {
      this.playing = false;
      this.pointerSession.clear();
      STATUS.textContent = '';
      this.announce('Puzzle ready. Showing the original image; jumble the tiles to play.');
    }
  }

  scale_up()
  {
    this.change_scale(1);
  }

  scale_down()
  {
    this.change_scale(-1);
  }

  change_scale(direction)
  {
    const result = attemptPuzzleScale(this.scale, direction, candidate => {
      if(this.playing && !window.confirm('rescaling the image will reset the game')) return false;
      return this.init(candidate, this.current_img);
    });

    if(result.applied)
    {
      this.scale = result.scale;
      this.playing = false;
      this.pointerSession.clear();
    }
    this.update_scale_controls();
    return result.applied;
  }

  update_scale_controls()
  {
    const controls = puzzleScaleControlState(this.scale);
    SCALE_DOWN.disabled = controls.scaleDownDisabled;
    SCALE_UP.disabled = controls.scaleUpDisabled;
    SCALE_VALUE.textContent = controls.label;
  }

  init(targetScale = this.scale, image = this.current_img)
  {
    const rows = Number(ROWS.value);
    const columns = Number(COLUMNS.value);
    if(!/^[1-9]\d*$/.test(ROWS.value) || !/^[1-9]\d*$/.test(COLUMNS.value) ||
       !Number.isInteger(rows) || !Number.isInteger(columns) ||
       rows < 1 || columns < 1 || rows > MAX_TILES_PER_AXIS || columns > MAX_TILES_PER_AXIS ||
       rows * columns > MAX_PUZZLE_TILES)
    {
      STATUS.textContent = `Enter whole rows and columns from 1 to ${MAX_TILES_PER_AXIS}, with at most ${MAX_PUZZLE_TILES} tiles.`;
      return false;
    }
    const applied = applyPuzzleResize(this, {
      canvas: CANVAS,
      context: c,
      createCanvas: () => document.createElement('canvas'),
      image,
      tilesAcross: columns,
      tilesDown: rows,
      scale: targetScale,
    });
    if(!applied)
    {
      STATUS.textContent = 'This image and grid cannot fit within the puzzle canvas limits.';
      return false;
    }

    this.keyboardSession.reset();
    this.completed_percent = null;
    COMPLETED.textContent = '';
    this.set_show_original(true);
    if(document.activeElement === CANVAS) this.draw();
    return true;
  }

  set_show_original(show)
  {
    this.show_original = show;
    ORIGINAL.style.transform = show ? 'rotate(90deg)' : '';
    ORIGINAL.setAttribute('aria-pressed', String(show));
  }

  draw()
  {
    if(this.show_original === true)
    {
      drawPuzzleFragments(c, this.original, () => document.createElement('canvas'));
    } 
    else
    {
      drawPuzzleFragments(c, this.fragments, () => document.createElement('canvas'));
    }
    if(this.cursor_visible()) this.draw_cursor();
  }

  // The tile cursor shows while the canvas has keyboard focus, not after a
  // pointer press focuses it.
  cursor_visible()
  {
    return document.activeElement === CANVAS && (this.keyboard_cursor || CANVAS.matches(':focus-visible'));
  }

  draw_cursor()
  {
    const { cursor, selected } = this.keyboardSession;
    const selectedTile = selected === null ? null : this.fragments[selected];
    const cursorTile = this.fragments[cursor];

    if(selectedTile && selected !== cursor) this.outline_tile(selectedTile, true, false);
    if(cursorTile) this.outline_tile(cursorTile, selected === cursor, true);
  }

  outline_tile(tile, selected, current)
  {
    // Dark and light strokes together stay visible over any image.
    const line = Math.max(1, Math.min(4, Math.floor(Math.min(tile.width, tile.height) / 8)));
    c.save();
    if(selected)
    {
      c.fillStyle = 'rgba(255, 214, 10, 0.4)';
      c.fillRect(tile.x, tile.y, tile.width, tile.height);
    }
    c.lineWidth = line * 2;
    c.strokeStyle = 'rgb(0, 0, 0)';
    c.strokeRect(tile.x + line, tile.y + line, tile.width - line * 2, tile.height - line * 2);
    c.lineWidth = line;
    c.strokeStyle = current ? 'rgb(255, 255, 255)' : 'rgb(255, 214, 10)';
    if(!current) c.setLineDash([line * 3, line * 2]);
    c.strokeRect(tile.x + line, tile.y + line, tile.width - line * 2, tile.height - line * 2);
    c.restore();
  }

  announce(message)
  {
    PUZZLE_STATUS.textContent = message;
  }

  key_down(key)
  {
    const across = Number(this.stored_columns);
    const down = Number(this.stored_rows);
    const keys = this.keyboardSession;
    const isActivate = key === 'Enter' || key === ' ';
    if(!isActivate && key !== 'Escape' && !NAVIGATION_KEYS.has(key)) return false;
    this.keyboard_cursor = true;

    if(this.fragments.length === 0)
    {
      this.announce('No puzzle yet. Import an image and press play in the settings.');
      return true;
    }

    if(key === 'Escape')
    {
      if(keys.cancel())
      {
        this.draw();
        this.announce('Selection cancelled.');
      }
      return true;
    }

    if(!isActivate)
    {
      keys.move(key, across, down);
      this.draw();
      const selected = keys.selected === keys.cursor ? ', selected' : '';
      this.announce(`${tileLabel(keys.cursor, across)}${selected}.`);
      return true;
    }

    if(this.show_original === true)
    {
      this.announce('Showing the original image. Turn off Show original image, or jumble the tiles, to swap tiles.');
      return true;
    }

    const result = keys.activate(this.fragments);
    this.draw();
    if(result.action === 'selected')
    {
      this.announce(`Selected ${tileLabel(result.first, across)}. Move to another tile and press Enter or Space to swap.`);
    }
    else if(result.action === 'deselected')
    {
      this.announce(`Deselected ${tileLabel(result.first, across)}.`);
    }
    else if(result.action === 'swapped')
    {
      this.complete(`Swapped ${tileLabel(result.first, across)} with ${tileLabel(result.second, across)}.`);
    }
    return true;
  }

  jumble()
  {
    if(this.uploaded_files.length == 0) return;
    if(this.fragments.length == 0) return;

    let check = window.confirm('reset the current game?');
    if(check === false) return;

    let temp = [];
    let tempImg = [];

    for(let i = 0; i < this.total; i++) temp.push(i);

    for(let i = 0; i < this.total; i++)
    {
      let rndImg = Math.floor(Math.random() * temp.length);
      tempImg.push(this.fragments[temp[rndImg]].frag);
      temp.splice(rndImg, 1);
    }
    for(let i = 0; i < tempImg.length; i++)
    {
      this.fragments[i].frag = tempImg[i];
    }
    
    this.set_show_original(false);
    this.keyboardSession.cancel();
    this.completed_percent = null;
    this.draw();
    this.playing = true;
    this.complete('Tiles jumbled.');
  }

  is_original()
  {
    if(this.uploaded_files.length == 0) return;
    this.set_show_original(!this.show_original);
    this.draw();
  }

  // Announces the action, plus the completion percentage only when it changed.
  complete(action = '')
  {
    const percent = puzzleCompletionPercent(this.fragments, this.original);
    COMPLETED.textContent = percent.toString() + "%";
    let progress = '';
    if(percent === 100 && this.playing)
    {
      progress = 'Puzzle complete. Well done!';
      this.playing = false;
    }
    else if(percent !== this.completed_percent)
    {
      progress = `${percent}% complete.`;
    }
    this.completed_percent = percent;
    const message = [action, progress].filter(Boolean).join(' ');
    if(message) this.announce(message);
  }

  puzzleState()
  {
    return {
      canvasWidth: CANVAS.width,
      canvasHeight: CANVAS.height,
      tilesAcross: Number(this.stored_columns),
      tilesDown: Number(this.stored_rows),
      fragments: this.fragments,
    };
  }

  pointer_down(pointerId, point)
  {
    if(this.show_original === true) return false;
    return this.pointerSession.begin(pointerId, point, this.puzzleState());
  }

  pointer_up(pointerId, point)
  {
    if(this.show_original === true) return this.pointerSession.cancel(pointerId);

    const result = this.pointerSession.finish(pointerId, point, this.puzzleState());
    if(result.valid)
    {
      this.keyboardSession.cancel();
      this.draw();
      this.complete();
    }
    return result.handled;
  }

  pointer_cancel(pointerId)
  {
    return this.pointerSession.cancel(pointerId);
  }
}

function canvasPointForPointer(event)
{
  return canvasPointFromClient(
    event.clientX,
    event.clientY,
    CANVAS.getBoundingClientRect(),
    CANVAS.width,
    CANVAS.height,
  );
}

CANVAS.addEventListener('pointerdown', function(event)
{
  event.preventDefault();
  window.jumbler.keyboard_cursor = false;
  const point = canvasPointForPointer(event);
  if(window.jumbler.pointer_down(event.pointerId, point))
  {
    CANVAS.setPointerCapture(event.pointerId);
  }
});

CANVAS.addEventListener('pointerup', function(event)
{
  event.preventDefault();
  const point = canvasPointForPointer(event);
  if(!window.jumbler.pointer_up(event.pointerId, point)) return;

  if(CANVAS.hasPointerCapture(event.pointerId)) CANVAS.releasePointerCapture(event.pointerId);
});

CANVAS.addEventListener('keydown', function(event)
{
  if(event.altKey || event.ctrlKey || event.metaKey) return;
  if(window.jumbler.key_down(event.key)) event.preventDefault();
});

CANVAS.addEventListener('focus', function()
{
  // The open settings panel covers the canvas, so close it to keep the focused
  // puzzle visible; the settings toggle stays in place to reopen it.
  Alpine.$data(document.body).menu = false;
  window.jumbler.draw();
});

CANVAS.addEventListener('blur', function()
{
  window.jumbler.keyboard_cursor = false;
  window.jumbler.draw();
});

CANVAS.addEventListener('pointercancel', function(event)
{
  window.jumbler.pointer_cancel(event.pointerId);
});

CANVAS.addEventListener('lostpointercapture', function(event)
{
  window.jumbler.pointer_cancel(event.pointerId);
});

function start()
{
  // The blank canvas fits inside the board's padding, where the board's
  // overflow does not clip the canvas focus outline.
  const padding = parseFloat(getComputedStyle(BOARD).paddingLeft);
  CANVAS.width = Math.max(1, Math.floor(BOARD.clientWidth - padding * 2));
  CANVAS.height = Math.max(1, Math.floor(window.innerHeight - BOARD.getBoundingClientRect().top - padding * 2));
  window.jumbler = new Jumbler();
}

document.addEventListener("DOMContentLoaded", start);
