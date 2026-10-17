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

  console.log('\n6. Medio de pago "Código QR"');
  chk(w.eval("parseMedio('Pagué con QR en Coto $38.560')") === 'Código QR', 'reconoce "QR" como medio de pago');
  chk(w.eval("parseMedio('Coto $38.560 con código QR')") === 'Código QR', 'reconoce "código QR"');
  chk(w.eval("parseMedio('pagué con mercado pago $5.000')") === 'Mercado Pago', 'Mercado Pago sigue ganando si dice "mercado pago"');
  chk(w.eval("MEDIOS_LISTA.indexOf('Código QR') > MEDIOS_LISTA.indexOf('Mercado Pago')"), 'figura después de Mercado Pago en la lista');
  w.eval("go('gastos')");
  chk(/Código QR/.test(w.document.getElementById('fMedio').innerHTML), 'aparece en el filtro de medio de pago');
  w.eval("modalGasto(null)");
  chk(/Código QR/.test(w.document.getElementById('gPay').innerHTML), 'aparece en el formulario de alta');
  w.eval("closeModal()");
  chk(w.document.getElementById('gPay') === null, 'el formulario se puede cerrar');

  console.log('\n7. Gráfico del dashboard con % e importe');
  w.eval("go('dashboard')");
  await dormir(60);
  const dash = w.document.getElementById('view-dashboard').innerHTML;
  const svg  = (dash.match(/<svg[\s\S]*?<\/svg>/) || [''])[0];
  chk(/<text[^>]*>\d+%<\/text>/.test(svg), 'la torta escribe el porcentaje dentro de cada porción');
  chk(/<title>[^<]*\$[^<]*·[^<]*%/.test(svg), 'al tocar un segmento se ven importe y porcentaje');
  const leg = w.document.querySelector('#view-dashboard .legend .legrow');
  chk(leg !== null, 'la leyenda lista cada categoría');
  chk(leg && /%/.test(leg.textContent) && /\$/.test(leg.textContent), 'cada fila muestra el % y el importe');
  chk(leg && leg.querySelector('.share i') !== null, 'y una barra proporcional al peso de la categoría');
  const pag = w.document.querySelector('#view-dashboard .legrow[style*="cursor:default"]');
  chk(pag && /%/.test(pag.textContent) && /\$/.test(pag.textContent), 'por medio de pago también muestra % e importe');

  console.log('\n7b. Visual: volumen 3D, animaciones e iluminación');
  chk(w.document.getElementById('view-dashboard').classList.contains('enter'), 'al entrar a una vista se reproduce la animación de entrada');
  const cssB = (HTML.match(/<style>([\s\S]*?)<\/style>/) || ['',''])[1];
  chk(/@keyframes fadeUp/.test(cssB) && /@keyframes donutIn/.test(cssB) && /@keyframes barraIn/.test(cssB),
      'las animaciones de entrada están definidas');
  chk(/prefers-reduced-motion/.test(cssB), 'se respeta a quien pide menos movimiento en pantalla');
  chk(w.document.querySelector('#view-dashboard .donut3d') !== null, 'la torta se dibuja en 3D');
  chk(w.document.querySelectorAll('#view-dashboard .donut3d .dlayer').length === 3, 'con tres capas de profundidad debajo de la cara superior');
  const dtop = w.document.querySelector('#view-dashboard .donut3d .dtop');
  chk(dtop !== null && dtop.querySelectorAll('.dseg').length > 0, 'los segmentos de la cara superior son los interactivos');
  chk(dtop !== null && dtop.querySelector('.dpct') !== null, 'el % va pintado sobre la banda del anillo');
  const bars = w.document.querySelectorAll('#view-dashboard .barg');
  chk(bars.length >= 6, 'cada barra del gráfico mensual es un grupo animable');
  chk(bars[0] !== null && bars[0].querySelectorAll('polygon').length === 2, 'y tiene cara superior y lateral (3D)');
  chk(bars[0] !== null && bars[0].querySelector('ellipse') !== null, 'con su sombra en el piso');

  const leg0 = w.document.querySelector('#view-dashboard .legend .legrow[data-cat]');
  const seg0 = leg0 ? w.document.querySelector(`#donut3d .dtop .dseg[data-cat="${leg0.dataset.cat}"]`) : null;
  chk(leg0 !== null && seg0 !== null, 'la leyenda y la torta comparten la clave de categoría');
  if(leg0 && seg0){
    const centro = w.document.getElementById('dCenter');
    const totalAntes = centro.textContent;
    leg0.dispatchEvent(new w.Event('mouseenter'));
    chk(seg0.classList.contains('hov'), 'al pasar el mouse por la leyenda se ilumina su segmento');
    chk(w.document.getElementById('donut3d').classList.contains('ilum'), 'y los demás segmentos se atenúan');
    chk(centro.textContent !== totalAntes && /%/.test(centro.textContent),
        'el centro deja el total y muestra ese renglón con su %');
    leg0.dispatchEvent(new w.Event('mouseleave'));
    chk(!seg0.classList.contains('hov'), 'al salir vuelve a la normalidad');
    chk(centro.textContent === totalAntes, 'y el centro recupera el total');
    seg0.dispatchEvent(new w.Event('mouseenter'));
    chk(seg0.classList.contains('hov'), 'pasar el mouse por un segmento también lo ilumina');
    chk(centro.textContent.indexOf(leg0.querySelector('.nm').textContent) >= 0, 'con su nombre en el centro');
    seg0.dispatchEvent(new w.Event('mouseleave'));
    chk(!seg0.classList.contains('hov'), 'al irse se apaga');
  }

  console.log('\n7c. Detalle por categoría: el contador coincide con lo desplegado');
  w.eval("UI.periodo='todo';");
  w.eval(`
    var sup = S.cats.find(c=>c.name==='Supermercado');
    S.exps = [
      { id:'d1', date:'2026-10-01', cat:sup.id, sub:sup.subs[0].id, detail:'Yerba', amount:1000, pay:'Efectivo', merchant:'Coto', notes:'', src:'manual', _ts:1 },
      { id:'d2', date:'2026-10-02', cat:sup.id, sub:null,           detail:'Regalo', amount:2000, pay:'',        merchant:'',     notes:'', src:'manual', _ts:2 }
    ];
    UI.open = {}; UI.open[sup.id] = true;
    go('dashboard');
  `);
  await dormir(60);
  let dashC = w.document.getElementById('view-dashboard').innerHTML;
  chk(/2 gastos/.test(dashC), 'la categoría con 2 gastos avisa "2 gastos"');
  let filasC = Array.from(w.document.querySelectorAll('#view-dashboard tbody tr.subrow')).map(f=>f.textContent);
  chk(filasC.some(t=>/Sin subcategoría/.test(t)), 'el gasto sin subcategoría se lista igual ("Sin subcategoría")');
  chk(filasC.some(t=>/Yerba/.test(t)) && filasC.some(t=>/Regalo/.test(t)), 'los 2 gastos aparecen desplegados, uno por renglón');
  chk(filasC.filter(t=>/· 1 gasto\b/.test(t)).length===2, 'cada subcategoría agrupada indica cuántos gastos suma');
  w.eval(`
    var sup2 = S.cats.find(c=>c.name==='Supermercado');
    S.exps[1].sub = sup2.subs[0].id;      /* los 2 gastos caen en la MISMA subcategoría */
    save(); render();
  `);
  await dormir(60);
  filasC = Array.from(w.document.querySelectorAll('#view-dashboard tbody tr.subrow')).map(f=>f.textContent);
  chk(filasC.filter(t=>/Yerba/.test(t)).length===1 && filasC.filter(t=>/Regalo/.test(t)).length===1,
      'dos gastos en la misma subcategoría se listan los dos (no se agrupan en uno)');
  chk(filasC.some(t=>/2 gastos/.test(t)), 'el subtotal de la subcategoría suma los 2 gastos');

  console.log('\n8. Celular (responsive)');
  const css = (HTML.match(/<style>([\s\S]*?)<\/style>/) || ['',''])[1];
  chk(/@media \(max-width:860px\)/.test(css), 'existe la media query para celular');
  chk(/@media \(max-width:560px\)/.test(css), 'existe la media query para celulares chicos');
  chk(/\.c-medio/.test(css) && /\.c-obs/.test(css) && /\.c-estado/.test(css), 'las columnas secundarias se ocultan en pantalla chica');
  chk(/grid-template-areas:"exp nm nm acts" "lim lim pill pill"/.test(css),
      'en celular la fila de Categorías se apila en dos renglones (no se pisan ícono, nombre y botones)');
  chk(/\.catrow \.nm input\{[^}]*max-width:100%!important/.test(css), 'el campo del nombre de la categoría se encoge hasta el ancho disponible');
  chk(/\.catrow \.lim\{[^}]*white-space:normal/.test(css), 'el texto del límite se parte en varias líneas en vez de desbordar');
  chk(/input\.ctl,select\.ctl,textarea\.ctl\{font-size:16px\}/.test(css), 'los campos evitan el zoom automático de iOS');
  chk(/only-mob/.test(css) && /only-desk/.test(css), 'hay contenido distinto para celular y escritorio');
  chk(w.document.getElementById('navscrim') !== null, 'tiene el fondo para cerrar el menú lateral');
  chk(w.document.querySelector('.mobilebar') !== null, 'tiene la barra superior del celular');
  chk(/viewport-fit=cover/.test(HTML), 'la vista respeta la zona segura del iPhone');

  chk(w.eval('pantallaChica()') === false, 'en escritorio no usa el modo compacto');
  w.eval("go('gastos')");
  chk(/only-mob/.test(w.document.getElementById('view-gastos').innerHTML), 'en la tabla de gastos, comercio y medio pasan a una línea para el celular');
  chk(/c-medio/.test(w.document.getElementById('view-gastos').innerHTML), 'la columna de medio de pago se puede ocultar en el celular');
  const filaG = w.document.querySelector('#view-gastos tbody tr');
  chk(filaG && /\$/.test(filaG.querySelectorAll('td')[3].textContent) && /%/.test(filaG.querySelectorAll('td')[3].textContent),
      'cada gasto de la lista muestra el importe y su % del total');

  w.eval("document.getElementById('mmenu').click()");
  chk(w.document.getElementById('sidebar').classList.contains('open'), 'el botón ☰ abre el menú');
  chk(w.document.getElementById('navscrim').classList.contains('on'), 'muestra el fondo detrás del menú');
  w.document.querySelector('.navbtn[data-view="dashboard"]').click();
  chk(!w.document.getElementById('sidebar').classList.contains('open'), 'al elegir una opción el menú se cierra');
  chk(!w.document.getElementById('navscrim').classList.contains('on'), 'y el fondo también');

  Object.defineProperty(w, 'innerWidth', { value:390, configurable:true, writable:true });
  chk(w.eval('pantallaChica()') === true, 'detecta pantalla de celular');
  chk(w.eval('mesesGrafico()') === 6, 'en el celular dibuja 6 meses en vez de 12');
  chk(w.eval('anchoGrafico()') === 340, 'y un gráfico más angosto para que se lea');
  w.eval("render()");
  await dormir(60);
  chk(/últimos 6 meses/.test(w.document.getElementById('view-dashboard').innerHTML), 'el dashboard se redibuja para el celular');

  w.eval("document.getElementById('mmenu').click()");
  chk(w.document.getElementById('sidebar').classList.contains('open'), 'abre el menú estando en el celular');
  Object.defineProperty(w, 'innerWidth', { value:1200, configurable:true, writable:true });
  w.dispatchEvent(new w.Event('resize'));
  await dormir(400);
  chk(!w.document.getElementById('sidebar').classList.contains('open'), 'al pasar a escritorio se cierra el menú solo');
  chk(!w.document.getElementById('navscrim').classList.contains('on'), 'y el fondo oscuro desaparece');

  console.log(`\nRESULTADO: ${ok} ok, ${mal} fallos\n`);
  process.exit(mal ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
