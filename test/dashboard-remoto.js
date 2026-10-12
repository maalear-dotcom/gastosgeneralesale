/* Prueba del dashboard en modo servidor: index.html servido por
   http, con fetch real contra /api/estado (nube como fuente de verdad). */
let JSDOM; try{ ({ JSDOM } = require('jsdom')); }catch(e){ console.log('Se omite (instalá jsdom con: npm i -D jsdom)'); process.exit(0); }
const fs = require('fs');
const path = require('path');
const { crearMotor } = require('../motor');

const HTML = fs.readFileSync(require('path').join(__dirname,'..','index.html'), 'utf8');

let ok = 0, mal = 0;
const chk = (c, m) => { if(c){ ok++; console.log('   ✓ ' + m); } else { mal++; console.log('   ✗ ' + m); } };
const dormir = ms => new Promise(r => setTimeout(r, ms));

/* Estado de prueba como lo devolvería el servidor */
const motor = crearMotor({});
motor.api.cargar();
const base = motor.api.defaults();
base._rev = 7;
base.exps = [
  { id:'a1', date:'2026-10-05', cat: base.cats.find(c=>c.name==='Supermercado').id, sub:null,
    detail:'Coto', amount:38560, pay:'Débito', merchant:'Coto', notes:'', src:'foto', _ts:Date.now() },
  { id:'a2', date:'2026-10-08', cat: base.cats.find(c=>c.name==='Transporte').id, sub:null,
    detail:'YPF', amount:61300, pay:'Débito', merchant:'YPF', notes:'', src:'texto', _ts:Date.now() }
];

function entorno(estado, modo){
  /* modo: 'ok' (servidor con datos) | 'sin' (sin servidor) | '401' (protegido) */
  const puts = [];
  const dom = new JSDOM(HTML, { url:'https://gastos.onrender.com/', runScripts:'dangerously' });
  const w = dom.window;
  w.fetch = async (url, o) => {
    if(modo === 'sin') throw new Error('ECONNREFUSED');
    const u = String(url), m = (o && o.method) || 'GET';
    const r = (j, status=200) => ({ ok:status>=200&&status<300, status, json:async()=>j });
    if(u === '/api/login') return r({ ok:true });
    if(u === '/api/estado' && m === 'GET') return modo==='ok' ? r(JSON.parse(JSON.stringify(estado))) : r({ error:'x' }, 401);
    if(u === '/api/estado' && m === 'PUT'){ puts.push(JSON.parse(o.body)); return r({ ok:true, _rev:99 }); }
    return r({}, 404);
  };
  return { dom, w, puts };
}

async function main(){
  console.log('\n1. Dashboard servido por la nube');
  const { w, puts } = entorno(base, 'ok');
  await dormir(400);
  chk(w.eval('MODO') === 'remoto', 'detectó el servidor y entró en modo remoto');
  chk(w.eval('S.exps.length') === 2, 'cargó los gastos que estaban en el servidor');
  chk(w.eval('S._rev') === 7, 'tomó el contador de revisiones');
  chk(/☁️/.test(w.document.getElementById('footCount').innerHTML), 'muestra el indicador de nube en el pie');
  chk(/99\.860|\$99\.860/.test(w.document.getElementById('view-dashboard').innerHTML), 'el dashboard suma los gastos del servidor');

  console.log('\n2. Sincronización de cambios');
  w.eval("S.exps.push({ id:'nuevo', date:'2026-10-12', cat:S.cats[0].id, sub:null, detail:'Manual', amount:5000, pay:'', merchant:'', notes:'', src:'manual', _ts:Date.now() }); save();");
  await dormir(1200);
  chk(puts.length === 1, 'al guardar manda el estado al servidor');
  chk(puts[0] && puts[0].exps.length === 3 && puts[0]._rev === 7, 'lo que manda tiene los 3 gastos y el _rev');
  chk(w.eval('S._rev') === 99, 'guarda el _rev que respondió el servidor');
  chk(w.eval("MODO") === 'remoto' && w.eval('S.exps.length') === 3, 'sigue en modo remoto con los datos locales');

  console.log('\n3. Borrado registrado para la fusión');
  w.eval("borrarGastos(['a1']);");
  chk(w.eval('S.exps.length') === 2, 'borra el gasto');
  chk(w.eval('JSON.stringify(S._borrados)').includes('a1'), 'registra el id en _borrados');

  console.log('\n4. Sin servidor → sigue funcionando igual (archivo local)');
  const solo = entorno(null, 'sin');
  await dormir(400);
  chk(solo.w.eval('MODO') === 'local', 'sin /api/estado queda en modo local');
  chk(solo.w.eval('S.cats.length') === 20, 'carga las 20 categorías por defecto');
  chk(solo.w.eval('S.exps.length') === 0, 'arranca sin gastos en el navegador');

  console.log('\n5. Servidor con contraseña → pide ingresar');
  const { w: w2 } = entorno(null, '401');
  await dormir(400);
  chk(w2.document.getElementById('loginOverlay') !== null, 'muestra la pantalla de contraseña');
  chk(w2.eval('MODO') === 'local', 'no carga datos del servidor mientras no haya sesión');

  console.log(`\nRESULTADO: ${ok} ok, ${mal} fallos\n`);
  process.exit(mal ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
