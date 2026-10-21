"use strict"

import svg from './svg.js';
import Alpine from 'alpinejs';
import { canvasPointFromClient, PointerSwapSession } from './puzzle-coordinates.js';
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

ORIGINAL.innerHTML = svg.eye.trim();
JUMBLE.innerHTML = svg.dice.trim();

UP.innerHTML = svg.up.trim();
DOWN.innerHTML = svg.down.trim();

THEME.innerHTML = svg.theme.trim();

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
    this.draw();
  }

  update_menus()
  {
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
    let pendingPixels = 0;
    try
    {
      for(const file of files)
      {
        const image = new Image();
        image.src = await readFile(file);
        try { await image.decode(); }
        catch { throw new Error(`${file.name} could not be decoded as an image.`); }

        const width = image.naturalWidth;
        const height = image.naturalHeight;
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

    this.show_original = true;
    ORIGINAL.style.transform = 'rotate(90deg)';
    return true;
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
    
    this.show_original = false;
    ORIGINAL.style.transform = '';
    this.draw();
    this.playing = true;
    this.complete();
  }

  is_original()
  {
    if(this.uploaded_files.length == 0) return;
    this.show_original = !this.show_original;
    if(this.show_original === true) ORIGINAL.style.transform = 'rotate(90deg)';
    else ORIGINAL.style.transform = '';
    this.draw();
  }

  complete()
  {
    const percent = puzzleCompletionPercent(this.fragments, this.original);
    COMPLETED.innerHTML = percent.toString() + "%";
    if(percent === 100)
    {
      window.alert('well done xd');
      this.playing = false;
    }
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
  CANVAS.width = window.innerWidth;
  CANVAS.height = window.innerHeight;
  window.jumbler = new Jumbler();
}

document.addEventListener("DOMContentLoaded", start);
