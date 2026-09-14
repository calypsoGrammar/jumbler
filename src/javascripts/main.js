"use strict"

import svg from './svg.js';
import Alpine from 'alpinejs';
import { canvasPointFromClient, PointerSwapSession } from './puzzle-coordinates.js';

window.Alpine = Alpine;
Alpine.start();

const NAV = document.getElementById("NAV");
const MENU = document.getElementById("MENU");

const ORIGINAL = document.getElementById("ORIGINAL");
const COMPLETED = document.getElementById("COMPLETED");
const JUMBLE = document.getElementById("JUMBLE");

const SCALE_DOWN = document.getElementById("SCALE_DOWN");
const SCALE_UP = document.getElementById("SCALE_UP");

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

class Fragment
{
  constructor(
    index,
    row,
    column,
    img_data,
  )
  {
    this.index = index;
    this.row = row;
    this.column = column;
    this.frag = img_data;
  }
}

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

    this.stored_width = 0;
    this.stored_height = 0;
    this.stored_rows = 0;
    this.stored_columns = 0;

    this.playing = false;

    this.current_img = new Image();
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

  import() 
  {
    let files = IMPORT.files;

    function read_this_file(file)
    {
      if(window.File && window.FileReader && window.FileList && window.Blob)
      {
        let reader = new FileReader();
    
        reader.addEventListener("load", function ()
        {
          let list_img = document.createElement("img");
          list_img.src = this.result;
          window.jumbler.uploaded_files.push(list_img);
          let new_option = document.createElement('option');
          new_option.value = window.jumbler.uploaded_files.length - 1;
          new_option.innerHTML = file.name;
          UPLOADED.appendChild(new_option);
        }, 
        false);

        reader.readAsDataURL(file);
      }
    }

    if(files.length > 0)
    {
      for(let f = 0; f < files.length; f++)
      {
        read_this_file(files[f]);
      }
    }
  }

  reload()
  {
    if(this.uploaded_files.length == 0) return;
    this.current_img.src = this.uploaded_files[UPLOADED.value].src;
    this.stored_width = this.current_img.width;
    this.stored_height = this.current_img.height;
    this.init();
    // this.dimensions();
    this.draw();
  }

  scale_up()
  {
    if(this.playing)
    {
      let confirm = window.confirm('rescaling the image will reset the game');
      if(!confirm) return;
    }
    this.playing = false;
    this.scale += 0.1;
    this.scale = parseFloat(this.scale.toFixed(2));
    this.init();
    this.draw();
  }

  scale_down()
  {
    if(this.playing)
    {
      let confirm = window.confirm('rescaling the image will reset the game');
      if(!confirm) return;
    }
    this.playing = false;
    this.scale -= 0.1;
    this.scale = parseFloat(this.scale.toFixed(2));
    this.init();
    this.draw();
  }

  init()
  {
    CANVAS.width = (this.stored_width * this.scale);
    CANVAS.height = (this.stored_height * this.scale);

    this.stored_rows = ROWS.value;
    this.stored_columns = COLUMNS.value;

    c.drawImage(this.current_img, 0, 0, CANVAS.width, CANVAS.height);

    this.tW = CANVAS.width / this.stored_rows;
    this.tH = CANVAS.height / this.stored_columns;

    this.total = this.stored_rows * this.stored_columns;

    this.fragments.length = 0;
    this.original.length = 0;

    for(let i = 0; i < this.stored_rows; i++)
    {
      for(let p = 0; p < this.stored_columns; p++)
      {
        let img_data = c.getImageData(i * this.tW, p * this.tH, this.tW, this.tH);

        let f = new Fragment(
          this.fragments.length,
          i,
          p,
          img_data,
        );

        this.fragments.push(f);

        let f1 = new Fragment(
          this.fragments.length,
          i,
          p,
          img_data,
        );

        this.original.push(f1);
      }
    }
  }

  // dimensions()
  // {
  //   CANVAS.width = (this.stored_width * this.scale);
  //   CANVAS.height = (this.stored_height * this.scale);

  //   if(this.current_img === null) return;
  //   if(CANVAS.width === 0) return;
  //   if(CANVAS.height === 0) return;
  //   if(c.width === 0) return;
  //   if(c.height === 0) return;

  //   c.drawImage(this.current_img, 0, 0, CANVAS.width, CANVAS.height);

  //   this.tW = CANVAS.width / this.stored_rows;
  //   this.tH = CANVAS.height / this.stored_columns;

  //   let counter = 0;

  //   for(let i = 0; i < this.stored_rows; i++)
  //   {
  //     for(let p = 0; p < this.stored_columns; p++)
  //     {
  //       let img_data = c.getImageData(i * this.tW, p * this.tH, this.tW, this.tH);
  //       this.original[counter].frag = img_data;

  //       for(let f = 0; f < this.fragments.length; f++)
  //       {
  //         if(this.fragments[f].frag === img_data)
  //         {
  //           this.fragments[f].frag = img_data;
  //           break;
  //         }
  //       }
  //       counter++;
  //     }
  //   }
  // }

  draw()
  {
    if(this.show_original === true)
    {
      for(let i = 0; i < this.original.length; i++)
      {
        c.putImageData(this.original[i].frag, this.original[i].row * this.tW, this.original[i].column * this.tH);
      }
    } 
    else
    {
      for(let i = 0; i < this.fragments.length; i++)
      {
        c.putImageData(this.fragments[i].frag, this.fragments[i].row * this.tW, this.fragments[i].column * this.tH);
      }
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

    for(let i = 0; i < this.stored_rows; i++)
    {
      for(let p = 0; p < this.stored_columns; p++)
      {
        let rndImg = Math.floor(Math.random() * temp.length);
        tempImg.push(this.fragments[temp[rndImg]].frag);
        temp.splice(rndImg, 1);
      }
    }
    for(let i = 0; i < tempImg.length; i++)
    {
      this.fragments[i].frag = tempImg[i];
      c.putImageData(this.fragments[i].frag, this.fragments[i].row * this.tW, this.fragments[i].column * this.tH);
    }
    
    this.show_original = false;
    ORIGINAL.style.transform = '';
    this.complete();
    this.playing = true;
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
    let score = 0;
    for(let i = 0; i < this.fragments.length; i++)
    {
      if(this.fragments[i].frag === this.original[i].frag) score++;
    }
    let percent = Math.floor(100 / this.fragments.length * score);
    if(isNaN(percent)) percent = 0;
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
      tilesAcross: Number(this.stored_rows),
      tilesDown: Number(this.stored_columns),
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
