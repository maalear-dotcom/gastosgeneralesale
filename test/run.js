'use strict';
/* ============================================================
   test/run.js
   Pruebas del servidor: motor, API con contraseña, fusión de
   estados (navegador ↔ celular), webhook y polling de Telegram,
   y el texto de las alertas que llegan al celular.
   ============================================================ */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { crearMotor } = require('../motor');

const PUERTO = 3877, PUERTO_MOCK = 3878;
const CLAVE = 'secreta123';
const TOKEN = '777999:TEST-TOKEN';
const DIR = '/tmp/gg-test-' + Date.now();
const DATA = path.join(DIR, 'estado.json');

let bien = 0, mal = 0;
const chk = (c, m) => { if(c){ bien++; console.log('   ✓ ' + m); } else { mal++; console.log('   ✗ ' + m); } };
const dormir = ms => new Promise(r => setTimeout(r, ms));
async function api(url, opts){
  const r = await fetch(url, opts);
  let j = null; try{ j = await r.json(); }catch(e){}
  return { status:r.status, body:j, headers:r.headers };
}

/* ---------------- Mock de la API de Telegram ---------------- */
function crearMock(){
  const mensajes = [];
  let updates = [];
  let archivo = { path:'photos/prueba.jpg', buf:Buffer.alloc(0), mime:'application/octet-stream' };
  const srv = http.createServer((req,res)=>{
    let data=''; req.on('data',c=>data+=c);
    req.on('end',()=>{
      const p = new URL(req.url,'http://x').pathname;
      const r = o => { res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify(o)); };
      if(p.startsWith('/file/bot')){ res.writeHead(200,{'Content-Type':archivo.mime}); return res.end(archivo.buf); }
      if(p.endsWith('/getMe')) return r({ ok:true, result:{ username:'gastos_de_prueba_bot' } });
      if(p.endsWith('/sendMessage')){ mensajes.push(JSON.parse(data||'{}')); return r({ ok:true, result:{ message_id:mensajes.length } }); }
      if(p.endsWith('/getUpdates')){ const u = updates; updates = []; return r({ ok:true, result:u }); }
      if(p.endsWith('/getFile')) return r({ ok:true, result:{ file_path: archivo.path } });
      if(p.endsWith('/setWebhook')) return r({ ok:true });
      return r({ ok:true, result:{} });
    });
  });
  return { srv, mensajes, setUpdates: u => { updates = u; },
           setArchivo: (buf, ruta, mime) => { archivo = { buf, path:ruta, mime }; } };
}

async function principal(){
  console.log('\n1. Motor (el mismo código que corre en el navegador)');
  fs.rmSync(DIR, { recursive:true, force:true });
  const motor = crearMotor({ archivo: DATA });
  motor.api.cargar();
  chk(motor.api.estado().cats.length === 20, 'carga las 20 categorías de index.html');
  let r = motor.api.analizarTexto('12/10/26, 09:12 - María: Compra en supermercado Coto $38.560 con tarjeta de débito', 'texto');
  chk(r.drafts.length === 1 && motor.api.catName(r.drafts[0].cat) === 'Supermercado', 'clasifica "Coto $38.560" → Supermercado');
  chk(r.drafts[0].amount === 38560, 'extrae el importe 38560');
  const g = motor.api.persistirDrafts(r.drafts);
  motor.flush();
  chk(g.length === 1 && fs.existsSync(DATA), 'persiste el gasto en disco');
  chk(JSON.parse(fs.readFileSync(DATA,'utf8')).exps.length === 1, 'el archivo JSON guarda el gasto');
  r = motor.api.analizarTexto('Una nota sobre otra cosa del patio', 'texto');
  chk(r.drafts.length === 0 && r.saltados.length === 1, 'descarta el mensaje que dice "otra cosa"');

  console.log('\n1b. Clasificación sólo con el nombre del comercio');
  const porComercio = [
    ['Coto $38.560 con débito', 'Supermercado'],
    ['Compra en Coto $38.560', 'Supermercado'],
    ['Carrefour $12.000 efectivo', 'Supermercado'],
    ['Jumbo $154.200', 'Supermercado'],
    ['Farmacity $9.800 con débito', 'Salud'],
    ['Zara $45.300', 'Ropa y calzado'],
    ['Netflix $11.999', 'Suscripciones'],
    ['Uber $3.200', 'Transporte'],
    ['Shell $60.000', 'Transporte'],
    ['Pedidos Ya $8.500', 'Alimentación'],
    ['Compra en Mercado Libre $23.400', 'Compras'],
    ['Gasto de nafta en YPF $45.000', 'Transporte']
  ];
  let aciertos = 0;
  const fallas = [];
  porComercio.forEach(([txt, esperado])=>{
    const d = motor.api.analizarTexto(txt, 'texto').drafts[0];
    const got = d ? motor.api.catName(d.cat) : '(nada)';
    if(got === esperado) aciertos++; else fallas.push(txt + ' → ' + got + ' (esperaba ' + esperado + ')');
  });
  chk(aciertos === porComercio.length,
      'clasifica por comercio ' + aciertos + '/' + porComercio.length + (fallas.length ? ' · fallas: ' + fallas.join(' | ') : ''));

  console.log('\n2. Mock de Telegram en :'+PUERTO_MOCK);
  const mock = crearMock();
  await new Promise(r=>mock.srv.listen(PUERTO_MOCK, r));
  chk(true, 'mock escuchando');

  console.log('\n3. Servidor :'+PUERTO);
  const hijo = spawn(process.execPath, [path.join(__dirname,'..','server.js')], {
    env: Object.assign({}, process.env, {
      PORT:String(PUERTO), APP_PASSWORD:CLAVE, BOT_CLAVE:'clave-bot',
      TELEGRAM_BOT_TOKEN:TOKEN, TELEGRAM_CHAT_ID:'777',
      TELEGRAM_WEBHOOK_SECRET:'whsec-test',
      TELEGRAM_API_BASE:'http://127.0.0.1:'+PUERTO_MOCK,
      DATA_FILE:DATA
    }),
    stdio:['ignore','pipe','pipe']
  });
  let log=''; hijo.stdout.on('data',d=>{log+=d}); hijo.stderr.on('data',d=>{log+=d});

  const base = 'http://127.0.0.1:'+PUERTO;
  let vivo=false;
  for(let i=0;i<60 && !vivo;i++){ await dormir(200); try{ vivo = (await api(base+'/api/salud')).status===200; }catch(e){} }
  if(!vivo){ console.log('   ✗ el servidor no arrancó\n'+log); process.exit(1); }
  chk(true, 'servidor arriba (' + (log.match(/Bot de Telegram: @\w+/)||['sin bot'])[0] + ')');

  try{
    console.log('\n4. Contraseña (APP_PASSWORD)');
    chk((await api(base+'/api/salud')).status === 200, '/api/salud responde sin contraseña');
    chk((await api(base+'/api/estado')).status === 401, '/api/estado devuelve 401 sin sesión');
    chk((await api(base+'/api/login', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clave:'mala'})})).status === 401, 'clave incorrecta → 401');
    const login = await api(base+'/api/login', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clave:CLAVE})});
    chk(login.status === 200 && /gg_sid=/.test(login.headers.get('set-cookie')||''), 'clave correcta → cookie de sesión');
    const cookie = (login.headers.get('set-cookie')||'').split(';')[0];
    const H = { 'Content-Type':'application/json', 'Cookie': cookie };
    /* helper: manda un update simulado al webhook (texto o archivo) */
    const enviarUpdate = (n, msg) => api(base+'/webhook/telegram', { method:'POST',
      headers:{'Content-Type':'application/json','x-telegram-bot-api-secret-token':'whsec-test'},
      body: JSON.stringify({ update_id:n, message: Object.assign({ chat:{id:777,type:'private'}, date:Date.now()/1000|0 }, msg) }) });

    console.log('\n5. API de estado (la nube es la fuente de verdad)');
    let est = await api(base+'/api/estado', {headers:H});
    chk(est.status===200 && Array.isArray(est.body.cats) && est.body.cats.length===20, 'GET /api/estado devuelve las categorías');
    chk(typeof est.body._rev === 'number', 'incluye el contador _rev');

    const conCoto = est.body;
    conCoto.exps = conCoto.exps.filter(e=>e.detail!=='nada');
    conCoto.exps.push({ id:'del-navegador', date:'2026-10-12', cat:conCoto.cats[0].id, sub:null, detail:'Editado en la web',
      amount:1111, pay:'Efectivo', merchant:'', notes:'', src:'manual', _ts:Date.now() });
    const put1 = await api(base+'/api/estado', {method:'PUT',headers:H,body:JSON.stringify(conCoto)});
    chk(put1.status===200 && put1.body._rev > est.body._rev, 'PUT sube los cambios y avanza _rev');

    /* El celular agrega un gasto por su cuenta */
    const servidor = (await api(base+'/api/estado',{headers:H})).body;
    servidor.exps.push({ id:'del-celular', date:'2026-10-12', cat:servidor.cats[1].id, sub:null, detail:'Desde Telegram',
      amount:2222, pay:'', merchant:'', notes:'', src:'foto', _ts:Date.now() });
    await api(base+'/api/estado', {method:'PUT',headers:H,body:JSON.stringify(servidor)});

    /* El navegador (que no lo sabe) vuelve a mandar su estado sin ese gasto */
    const navegador = (await api(base+'/api/estado',{headers:H})).body;
    navegador.exps = navegador.exps.filter(e=>e.id!=='del-celular');
    const put2 = await api(base+'/api/estado', {method:'PUT',headers:H,body:JSON.stringify(navegador)});
    const final = (await api(base+'/api/estado',{headers:H})).body;
    chk(final.exps.some(e=>e.id==='del-celular'), 'el gasto del celular NO se pierde al sincronizar');
    chk(final.exps.some(e=>e.id==='del-navegador'), 'el gasto del navegador se conserva');

    /* Borrado: se registra en _borrados y no vuelve */
    final._borrados = (final._borrados||[]).concat([{ id:'del-celular', ts:Date.now() }]);
    final.exps = final.exps.filter(e=>e.id!=='del-celular');
    await api(base+'/api/estado', {method:'PUT',headers:H,body:JSON.stringify(final)});
    const trasBorrar = (await api(base+'/api/estado',{headers:H})).body;
    chk(!trasBorrar.exps.some(e=>e.id==='del-celular'), 'lo que se borra en la web no se resucita');

    console.log('\n6. Backup');
    const bk = await api(base+'/api/backup', {headers:H});
    chk(bk.status===200 && Array.isArray(bk.body.exps), 'GET /api/backup descarga el estado');

    console.log('\n7. Webhook de Telegram');
    chk((await api(base+'/webhook/telegram', {method:'POST',headers:{'Content-Type':'application/json','x-telegram-bot-api-secret-token':'mal'},body:JSON.stringify({})})).status === 403, 'secreto incorrecto → 403');
    const upd = n => JSON.stringify({ update_id:n, message:{ chat:{id:777, type:'private'}, date:Date.now()/1000|0,
      text:{101:'Compra en supermercado Coto $38.560 con débito',102:'Una nota sobre otra cosa del patio',103:'Nafta YPF $61.300 con débito'}[n] } });
    const w1 = await api(base+'/webhook/telegram', {method:'POST',headers:{'Content-Type':'application/json','x-telegram-bot-api-secret-token':'whsec-test'},body:upd(101)});
    chk(w1.status === 200, 'secreto correcto → 200');
    await dormir(500);
    let s = (await api(base+'/api/estado',{headers:H})).body;
    chk(s.exps.some(e=>e.amount===38560 && e.src==='texto'), 'clasificó y guardó el mensaje del celular');
    chk(s.exps.some(e=>e.merchant==='Coto'), 'detectó el comercio');

    await api(base+'/webhook/telegram', {method:'POST',headers:{'Content-Type':'application/json','x-telegram-bot-api-secret-token':'whsec-test'},body:upd(101)});
    await api(base+'/webhook/telegram', {method:'POST',headers:{'Content-Type':'application/json','x-telegram-bot-api-secret-token':'whsec-test'},body:upd(102)});
    await dormir(500);
    s = (await api(base+'/api/estado',{headers:H})).body;
    chk(s.exps.filter(e=>e.amount===38560).length === 1, 'el update repetido no duplica');
    chk(!s.exps.some(e=>/otra cosa/i.test(e.detail||'')), 'el mensaje de "otra cosa" no se guarda');

    console.log('\n8. Alerta enviada al celular');
    s = (await api(base+'/api/estado',{headers:H})).body;
    const paseos = s.cats.find(c=>c.name==='Paseos y salidas');
    paseos.limit = 30000;
    await api(base+'/api/estado', {method:'PUT',headers:H,body:JSON.stringify(s)});
    mock.mensajes.length = 0;
    mock.setUpdates([{ update_id:201, message:{ chat:{id:777,type:'private'}, date:Date.now()/1000|0, text:'Entradas de cine $25.000 efectivo' } }]);
    await dormir(2500);
    s = (await api(base+'/api/estado',{headers:H})).body;
    chk(s.exps.some(e=>e.amount===25000), 'el mensaje llegó por polling y se guardó');
    const txts = mock.mensajes.map(m=>m.text).join('\n');
    chk(/Alerta: llevás consumido el [\d.,]+% del presupuesto de Paseos y salidas\./.test(txts), 'el celular recibió la alerta de presupuesto');
    chk(mock.mensajes.some(m=>/✅.*\$25\.000/.test(m.text)), 'el celular recibió el comprobante clasificado');
    chk(mock.mensajes.every(m=>m.chat_id===777), 'las respuestas van al número vinculado');

    console.log('\n8b. Enseñarle una palabra al bot desde el dashboard');
    await enviarUpdate(202, { text:'El Tigre $12.000' });
    await dormir(700);
    s = (await api(base+'/api/estado',{headers:H})).body;
    const caja = s.cats.find(c=>c.name==='Supermercado');
    chk(s.exps.some(e=>e.amount===12000 && e.cat!==caja.id), 'sin la palabra, "El Tigre" no va a Supermercado');
    caja.kw = (caja.kw||[]).concat(['tigre']);      /* lo que hace el dashboard al guardar */
    await api(base+'/api/estado', {method:'PUT',headers:H,body:JSON.stringify(s)});
    await enviarUpdate(203, { text:'El Tigre $9.900' });
    await dormir(700);
    s = (await api(base+'/api/estado',{headers:H})).body;
    chk(s.exps.some(e=>e.amount===9900 && e.cat===caja.id), 'al agregarla, el bot ya la usa en el próximo mensaje');

    console.log('\n9. Comprobante en PDF y en foto (OCR)');
    mock.setArchivo(fs.readFileSync(path.join(__dirname,'fixtures','ticket.pdf')), 'docs/ticket.pdf', 'application/pdf');
    await enviarUpdate(301, { document:{ file_id:'pdf1', mime_type:'application/pdf', file_name:'ticket.pdf' } });
    await dormir(1500);
    s = (await api(base+'/api/estado',{headers:H})).body;
    const superm = s.cats.find(c=>c.name==='Supermercado').id;
    chk(s.exps.some(e=>e.src==='pdf' && e.amount===38560 && e.cat===superm), 'leyó el PDF y lo clasificó en Supermercado');
    chk(mock.mensajes.some(m=>/✅.*38\.560/.test(m.text)), 'avisó al celular que el PDF se guardó');

    if(process.env.TEST_OCR === '0'){
      console.log('   ⏭ OCR omitido (TEST_OCR=0)');
    }else{
      try{
        mock.setArchivo(fs.readFileSync(path.join(__dirname,'fixtures','recibo2.png')), 'photos/recibo2.png', 'image/png');
        await enviarUpdate(302, { document:{ file_id:'img1', mime_type:'image/png', file_name:'recibo2.png' } });
        await dormir(6000);
        s = (await api(base+'/api/estado',{headers:H})).body;
        chk(s.exps.some(e=>e.src==='foto' && e.amount===52400 && e.cat===superm),
            'leyó la foto con OCR y la clasificó (Carrefour $52.400)');
      }catch(e){ console.log('   ⚠ no se pudo probar el OCR (¿sin internet?): ' + e.message); }
    }

    console.log('\n10. Archivo de datos');
    chk(fs.existsSync(DATA), 'existe ' + path.relative(process.cwd(), DATA));
    const json = JSON.parse(fs.readFileSync(DATA,'utf8'));
    chk(json.exps.length >= 3 && Array.isArray(json.cats),
        'el archivo tiene los gastos y las categorías (exps=' + (json.exps||[]).length + ', cats=' + (Array.isArray(json.cats)?json.cats.length:'?') + ')');
  } finally {
    hijo.kill('SIGTERM');
    mock.srv.close();
  }

  if(mal && process.env.DEBUG_LOG !== '0') console.log('\n--- log del servidor ---\n' + log.slice(-2500) + '\n------------------------');

  console.log(`\nRESULTADO: ${bien} ok, ${mal} fallos\n`);
  process.exit(mal ? 1 : 0);
}

principal().catch(e=>{ console.error(e); process.exit(1); });
