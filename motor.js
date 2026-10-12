'use strict';
/* ============================================================
   motor.js
   Ejecuta el motor de la propia index.html (clasificación,
   parsing de importes/fechas, categorías, alertas) dentro de
   un entorno controlado, para que el servidor use EXACTAMENTE
   el mismo código que la app del navegador.
   Así no hay dos clasificadoras que se puedan desincronizar.
   ============================================================ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RUTA_INDEX = path.join(__dirname, 'index.html');
const KEY = 'gastosGenerales.v1';

/* Documento falso: la app solo lo toca al renderizar (acá no se renderiza nada) */
function crearDocumento(){
  const el = () => {
    const e = {
      innerHTML:'', textContent:'', value:'', title:'', checked:false, hidden:false,
      style:{}, dataset:{}, files:[], cookie:'', nextElementSibling:null,
      classList:{ add(){}, remove(){}, toggle(){}, contains:()=>false },
      appendChild(){}, remove(){}, insertAdjacentHTML(){}, focus(){}, blur(){},
      setSelectionRange(){}, addEventListener(){}, removeEventListener(){},
      querySelector:()=>el(), querySelectorAll:()=>[],
      onclick:null, onchange:null, oninput:null, onsubmit:null
    };
    return e;
  };
  return {
    addEventListener(){}, removeEventListener(){},
    querySelector:()=>el(), querySelectorAll:()=>[],
    getElementById:()=>null, createElement:()=>el(), createTextNode:()=>el(),
    head:el(), body:el(), documentElement:el(), hidden:false, cookie:''
  };
}

function crearMotor({ archivo } = {}){
  const html = fs.readFileSync(RUTA_INDEX, 'utf8');
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  if(!m) throw new Error('No se encontró el <script> principal de index.html');

  /* --- persistencia: el "localStorage" del servidor --- */
  let memoria = {};
  if(archivo && fs.existsSync(archivo)){
    try{ memoria[KEY] = fs.readFileSync(archivo, 'utf8'); }catch(e){ console.warn('[motor] no se pudo leer', archivo, e.message); }
  }
  let timer = null;
  const escribir = () => {
    if(!archivo) return;
    try{
      fs.mkdirSync(path.dirname(archivo), { recursive:true });
      const tmp = archivo + '.tmp';
      fs.writeFileSync(tmp, memoria[KEY] || '{}', 'utf8');
      fs.renameSync(tmp, archivo);
    }catch(e){ console.error('[motor] error al escribir', archivo, e.message); }
  };
  const persistir = () => { if(!archivo) return; clearTimeout(timer); timer = setTimeout(escribir, 150); };

  const localStorage = {
    getItem: k => Object.prototype.hasOwnProperty.call(memoria, k) ? memoria[k] : null,
    setItem: (k,v) => { memoria[k] = String(v); persistir(); },
    removeItem: k => { delete memoria[k]; persistir(); },
    clear: () => { memoria = {}; persistir(); }
  };

  /* --- sandbox --- */
  const sandbox = {
    console, Intl, Date, Math, JSON, URL, parseInt, parseFloat, isNaN, isFinite, Buffer,
    setTimeout, clearTimeout, setInterval, clearInterval,
    localStorage,
    document: crearDocumento(),
    navigator: { userAgent: 'gastos-generales-servidor' },
    location: { protocol:'file:', hostname:'', href:'' },
    AbortController: function(){ this.signal = {}; this.abort = () => {}; }
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  try{
    vm.runInContext(m[1], sandbox, { filename:'index.html#app', timeout:15000 });
  }catch(e){
    throw new Error('No se pudo arrancar el motor de index.html: ' + e.message);
  }

  /* Referencias a funciones/estado dentro del contexto */
  const api = vm.runInContext(`({
    estado:      () => S,
    setEstado:   o => { S = o; },
    cargar:      () => load(),
    guardar:     () => save(),
    defaults:    () => defaults(),
    normalizar:  o => normalizar(o),
    analizarTexto:   (t, f) => analizarTexto(t, f),
    persistirDrafts: d => persistirDrafts(d),
    generarAlertas:  d => generarAlertas(d),
    consumoCat:      (c, d) => consumoCat(c, d),
    estadoLimite:    (c, t) => estadoLimite(c, t),
    rangoMes:        m => rangoMes(m),
    hoyISO:          () => hoyISO(),
    money:           n => money(n),
    pct:             n => pct(n),
    esc:             s => esc(s),
    clasificar:      (t,c) => clasificar(t,c),
    normalizarOCR:   t => normalizarOCR(t),
    invalidarReglas: () => invalidarReglas(),
    parseImporte:    t => parseImporte(t),
    dividirMensajes: t => dividirMensajes(t),
    seedCategorias:  () => seedCategorias(),
    catById:     id => catById(id),
    catName:     id => catName(id),
    subName:     (c,s) => subName(c,s),
    catColor:    id => catColor(id),
    fechaCorta:  i => fechaCorta(i)
  })`, sandbox);

  return {
    api,
    /* Fuerza la escritura a disco (antes de responder / al cerrar) */
    flush(){ if(timer){ clearTimeout(timer); timer=null; } escribir(); },
    archivo
  };
}

module.exports = { crearMotor, RUTA_INDEX };
