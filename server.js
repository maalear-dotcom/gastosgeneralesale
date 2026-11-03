'use strict';
/* ============================================================
   server.js · Gastos Generales
   ------------------------------------------------------------
   • Sirve el dashboard (index.html)
   • API /api/estado protegida con contraseña  → la nube es la
     fuente de verdad y el navegador se sincroniza con ella
   • Recibe comprobantes desde el celular por Telegram
     (webhook si hay PUBLIC_URL, si no polling),
     los clasifica con el MISMO motor de la app y los guarda
   • Responde las alertas de presupuesto al celular
   ============================================================ */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { crearMotor } = require('./motor');

/* ---------------- Variables de entorno (.env opcional) ---------------- */
function cargarEnv(){
  const f = path.join(__dirname, '.env');
  if(!fs.existsSync(f)) return;
  fs.readFileSync(f, 'utf8').split(/\r?\n/).forEach(l=>{
    const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if(!m) return;
    let v = m[2].trim();
    if((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1,-1);
    if(!(m[1] in process.env)) process.env[m[1]] = v;
  });
}
cargarEnv();

const PUERTO       = Number(process.env.PORT) || 3000;
const CLAVE        = process.env.APP_PASSWORD || '';                 // vacío = sin contraseña (no recomendado en la nube)
const CLAVE_BOT    = process.env.BOT_CLAVE || CLAVE;                 // clave para /vincular
const TOKEN        = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
const URL_PUBLICA  = (process.env.PUBLIC_URL || '').trim().replace(/\/+$/,'');
const CHAT_ENV     = (process.env.TELEGRAM_CHAT_ID || '').trim();
const ARCHIVO      = process.env.DATA_FILE || path.join(__dirname, 'data', 'estado.json');
/* ¿El archivo de datos existía al arrancar? Si no, o el disco se borró (plan gratis)
   o es la primera vez: sirve para avisar por Telegram si faltan los datos. */
const HABIA_ARCHIVO = fs.existsSync(ARCHIVO);
const SECRETO_WEB  = process.env.TELEGRAM_WEBHOOK_SECRET ||
  (TOKEN ? crypto.createHash('sha256').update('webhook|' + TOKEN).digest('hex').slice(0,32) : '');
const CLAVE_SESS   = crypto.createHash('sha256').update('sesion|' + (CLAVE || 'gastos') + '|' + (TOKEN || '')).digest('hex');
/* Base de la API de Telegram (se puede apuntar a un mock en los tests) */
const API_BASE     = (process.env.TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/+$/,'');

/* ---------------- Estado de la app (mismo motor que el navegador) ------ */
const motor = crearMotor({ archivo: ARCHIVO });
motor.api.cargar();
/* contador de revisiones: el dashboard lo usa para detectar novedades del celular */
motor.api.setEstado(Object.assign(estado() || motor.api.defaults(), { _rev: (estado() && estado()._rev || 0) + 1 }));
motor.api.guardar();
motor.flush();

function estado(){ return motor.api.estado(); }
function tocar(){                                  // marca cambio y persiste
  const s = estado(); s._rev = (s._rev || 0) + 1;
  motor.api.setEstado(s); motor.api.guardar(); motor.flush();
  avisarFaltaDeDatos();
  programarRespaldo();
}

/* ============================================================
   RESPALDO AUTOMÁTICO POR TELEGRAM
   ------------------------------------------------------------
   El plan gratis de Render borra el disco en cada reinicio, así
   que el estado completo viaja a tu chat de Telegram como
   archivo .json:
     • con cada cambio, como mucho cada 6 h (programado)
     • al apagarse (redeploy/reinicio)
     • cuando pedís /respaldo
   Si un día faltan los datos, reenviás ese archivo al bot y él
   lo restaura. (La API de Telegram no deja leer los propios
     mensajes del bot, así que la restauración es con el archivo
     en la mano — el dashboard además se recarga solo desde la
     caché de cualquier navegador que ya tenga los datos.)
   ============================================================ */
const INTERVALO_RESPALDO = 6*3600e3;
let _tResp = null, _respaldoEnCurso = false, _avisadoFaltaDatos = false;

function programarRespaldo(){
  if(!TOKEN || _respaldoEnCurso || _tResp) return;
  if(!chatIdPropio()) return;
  if(Date.now() - (estado()._respaldoTs || 0) < INTERVALO_RESPALDO) return;
  _tResp = setTimeout(()=>{
    _tResp = null;
    respaldarPorTelegram('programado').catch(e=>console.error('[respaldo]', e.message));
  }, 3000);
}

async function respaldarPorTelegram(motivo){
  if(!TOKEN) return false;
  const chat = chatIdPropio();
  if(!chat) return false;
  const s = estado();
  if(motivo !== 'manual' && motivo !== 'apagado' &&
     Date.now() - (s._respaldoTs || 0) < INTERVALO_RESPALDO) return false;
  _respaldoEnCurso = true;
  try{
    const monto = (s.exps||[]).reduce((a,e)=>a + Number(e.amount||0), 0);
    const buf = Buffer.from(JSON.stringify(s), 'utf8');
    const d = new Date();
    const nombre = 'gastos-respaldo-' + d.toISOString().slice(0,10) + '-' +
      String(d.getHours()).padStart(2,'0') + String(d.getMinutes()).padStart(2,'0') + '.json';
    const pie = `💾 Respaldo (${motivo}) · ${(s.exps||[]).length} gasto${(s.exps||[]).length===1?'':'s'} · ${motor.api.money(monto)}\n` +
      'Si algún día faltan los datos, reenviame este archivo al bot y lo restauro.';
    const ok = await enviarArchivo(chat, buf, { mime:'application/json', nombre, pie });
    if(ok){
      const st = estado(); st._respaldoTs = Date.now();
      motor.api.setEstado(st); motor.api.guardar(); motor.flush();
      console.log('· Respaldo enviado a Telegram (' + motivo + ')');
    }
    return ok;
  }finally{ _respaldoEnCurso = false; }
}

async function enviarArchivo(chatId, buf, opcs){
  const { mime='', nombre='archivo', pie='' } = opcs || {};
  const esImagen = /^image\//.test(mime||'');
  const fd = new FormData();
  fd.append('chat_id', String(chatId));
  fd.append(esImagen ? 'photo' : 'document',
            new Blob([buf], { type: mime || 'application/octet-stream' }), nombre);
  if(pie) fd.append('caption', pie);
  const r = await fetch(API_BASE + '/bot' + TOKEN + '/' + (esImagen ? 'sendPhoto' : 'sendDocument'), {
    method:'POST', body: fd, signal: AbortSignal.timeout(20000)
  });
  let j = {};
  try{ j = await r.json(); }catch(e){}
  if(!j.ok) console.error('[telegram] enviarArchivo falló:', j.description || ('HTTP ' + r.status));
  return !!j.ok;
}

/* Restaura el estado desde un .json reenviado al bot (sólo para el chat vinculado) */
function restaurarEstado(b, chatId){
  const s = motor.api.normalizar(Object.assign({}, b, {
    _rev: (estado()._rev || 0) + 1,
    bot: Object.assign({}, estado().bot || {}, b.bot || {}, { chatId, vinculado: (b.bot && b.bot.vinculado) || Date.now() })
  }));
  motor.api.setEstado(s); motor.api.invalidarReglas(); motor.api.guardar(); motor.flush();
  _avisadoFaltaDatos = true;                    /* ya hay datos: no hace falta avisar */
  console.log('· Restaurado desde Telegram: ' + s.exps.length + ' gastos, ' + s.cats.length + ' categorías');
}

/* Aviso único si el servidor quedó sin datos y hay un chat al que avisarle */
function avisarFaltaDeDatos(){
  if(_avisadoFaltaDatos || !TOKEN || HABIA_ARCHIVO || estado().exps.length) return;
  const chat = chatIdPropio();
  if(!chat) return;
  _avisadoFaltaDatos = true;
  enviar(chat, '⚠️ <b>Arranqué sin datos guardados</b> (el disco del plan gratis se borró, o es el primer deploy).\n\n' +
    'Para recuperarlos: reenviame por acá el último archivo <code>.json</code> de respaldo y lo restauro. ' +
    'Si entrás al dashboard desde un navegador que ya tenga los datos, también se suben solos.')
    .catch(()=>{});
}

/* ---------------- Auth por cookie firmada ---------------- */
function firmar(v){ return crypto.createHmac('sha256', CLAVE_SESS).update(String(v)).digest('hex'); }
function sesionValida(sid){
  const p = String(sid || '').split('.');
  if(p.length !== 2) return false;
  if(Date.now() > Number(p[0])) return false;
  try{ return crypto.timingSafeEqual(Buffer.from(p[1]), Buffer.from(firmar(p[0]))); }catch(e){ return false; }
}
function cookieDe(req){
  const c = req.headers.cookie || '';
  const t = c.split(';').map(s=>s.trim()).find(s=>s.startsWith('gg_sid='));
  return t ? decodeURIComponent(t.slice(7)) : '';
}
function requiereAuth(req,res,next){
  if(!CLAVE) return next();
  if(sesionValida(cookieDe(req))) return next();
  res.status(401).json({ error:'no_autorizado' });
}
function igual(a,b){                                // comparación a tiempo constante
  const A = Buffer.from(String(a||'')), B = Buffer.from(String(b||''));
  return A.length === B.length && crypto.timingSafeEqual(A,B);
}

/* ---------------- Servidor HTTP ---------------- */
const app = express();
app.use(express.json({ limit:'15mb' }));

app.get(['/','/index.html'], (req,res)=> res.sendFile(path.join(__dirname,'index.html')));
app.get('/api/salud', (req,res)=> res.json({ ok:true, ts:Date.now() }));

app.post('/api/login', (req,res)=>{
  if(!CLAVE) return res.json({ ok:true });
  if(!igual(req.body && req.body.clave, CLAVE)) return res.status(401).json({ error:'clave_incorrecta' });
  const exp = Date.now() + 30*864e5;
  res.setHeader('Set-Cookie', `gg_sid=${exp}.${firmar(exp)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30*86400}${req.secure?'; Secure':''}`);
  res.json({ ok:true });
});
app.post('/api/logout', (req,res)=>{
  res.setHeader('Set-Cookie','gg_sid=; Path=/; HttpOnly; Max-Age=0');
  res.json({ ok:true });
});

/* ---- estado completo (el dashboard lo lee y lo escribe) ---- */
app.get('/api/estado', requiereAuth, (req,res)=> res.json(estado()));

app.put('/api/estado', requiereAuth, (req,res)=>{
  const entrante = req.body;
  if(!entrante || !Array.isArray(entrante.cats) || !Array.isArray(entrante.exps))
    return res.status(400).json({ error:'estado_invalido' });
  const actual = estado() || {};
  /* Fusión: no se pierden los comprobantes que haya agregado el celular
     ni se "resucitan" los que el navegador borró (S._borrados). */
  const borrados = new Set((entrante._borrados||[]).map(b=>b.id));
  const ids = new Set(entrante.exps.map(e=>e.id));
  const extras = (actual.exps||[]).filter(e => !ids.has(e.id) && !borrados.has(e.id));
  const corte = Date.now() - 14*864e5;
  /* S2 · Las categorías y sus ediciones se fusionan por ID y gana siempre la
     más reciente (_upd): un navegador desactualizado no pisa con un nombre
     viejo el cambio hecho en otro dispositivo (ni al revés). */
  const cats = motor.api.fusionarCats(entrante.cats, actual.cats||[]);
  const catEdits = motor.api.fusionarEdits(entrante._catEdits, actual._catEdits);
  const salida = motor.api.normalizar(Object.assign({}, entrante, {
    cats,
    _catEdits: catEdits,
    exps: entrante.exps.concat(extras),
    _borrados: (entrante._borrados||[]).filter(b=>b.ts>corte),
    _rev: Math.max(entrante._rev||0, actual._rev||0) + 1,
    _respaldoTs: Math.max(entrante._respaldoTs||0, actual._respaldoTs||0) || undefined
  }));
  motor.api.setEstado(salida); motor.api.invalidarReglas(); motor.api.guardar(); motor.flush();
  res.json({ ok:true, _rev: salida._rev, agregados: extras.length });
});

/* ---- backup / restauración ---- */
app.get('/api/backup', requiereAuth, (req,res)=>{
  res.setHeader('Content-Disposition','attachment; filename="gastos-generales-'+motor.api.hoyISO()+'.json"');
  res.json(estado());
});

/* ---- comprobante original: la foto/PDF vive en Telegram y se baja bajo demanda ---- */
app.get('/api/comprobante/:id', requiereAuth, async (req,res)=>{
  const e = (estado().exps||[]).find(x=>x.id===req.params.id);
  if(!e || !e._doc || !e._doc.fileId) return res.status(404).json({ error:'sin_comprobante' });
  if(!TOKEN) return res.status(503).json({ error:'sin_bot' });
  try{
    const buf = await descargar(e._doc.fileId);
    const mime = e._doc.mime || 'application/octet-stream';
    const nombre = String(e._doc.nombre||'comprobante').replace(/["\\]/g,'_');
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', 'inline; filename="'+nombre+'"');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    return res.send(buf);
  }catch(err){
    console.error('[comprobante] no se pudo descargar:', err.message || err);
    return res.status(502).json({ error:'no_se_pudo_descargar' });
  }
});
app.post('/api/restore', requiereAuth, (req,res)=>{
  const b = req.body;
  if(!b || !Array.isArray(b.cats) || !Array.isArray(b.exps)) return res.status(400).json({error:'archivo_invalido'});
  motor.api.setEstado(motor.api.normalizar(Object.assign({}, b, { _rev:(estado()._rev||0)+1 })));
  motor.api.invalidarReglas(); motor.api.guardar(); motor.flush();
  res.json({ ok:true, exps: estado().exps.length });
});

/* ---- estado del bot ---- */
let BOT = { username:null };
app.get('/api/bot', requiereAuth, (req,res)=>{
  const s = estado();
  res.json({
    activo: !!TOKEN,
    username: BOT.username,
    webhook: !!URL_PUBLICA,
    chatId: CHAT_ENV || (s.bot && s.bot.chatId) || null,
    vinculado: !!(CHAT_ENV || (s.bot && s.bot.chatId)),
    guardadoEn: path.relative(__dirname, ARCHIVO)
  });
});

/* ============================================================
   TELEGRAM
   ============================================================ */
const visos = new Set();      // update_id ya procesados
function visto(id){
  if(visos.has(id)) return true;
  visos.add(id);
  if(visos.size > 1500){ const p=visos.values(); for(let i=0;i<500;i++) visos.delete(p.next().value); }
  return false;
}

async function apiTelegram(metodo, params){
  const r = await fetch(API_BASE + '/bot' + TOKEN + '/' + metodo, {
    method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(params||{})
  });
  return r.json();
}
function trocear(t, max){
  const out=[]; let s='';
  String(t||'').split('\n').forEach(l=>{ if((s+l).length+1>max){ out.push(s); s=''; } s += (s?'\n':'') + l; });
  if(s) out.push(s);
  return out;
}
async function enviar(chatId, texto){
  if(!TOKEN) return;
  for(const trozo of trocear(texto)){
    try{ await apiTelegram('sendMessage', { chat_id:chatId, text:trozo, parse_mode:'HTML', disable_web_page_preview:true }); }
    catch(e){ console.error('[telegram] no se pudo enviar:', e.message); }
  }
}

function chatIdPropio(){
  const s = estado();
  return CHAT_ENV || (s.bot && s.bot.chatId) || null;
}
function chatAutorizado(id){
  const propio = chatIdPropio();
  return propio != null && String(propio) === String(id);
}
function mensajeVinculacion(chatId){
  return `🔒 Aún no hay ningún número vinculado a esta app.\n\n` +
    `Tu ID de chat es: <b>${chatId}</b>\n\n` +
    `Para recibir y clasificar comprobantes:\n` +
    `1) Definí la variable <b>BOT_CLAVE</b> en el servidor (o <b>TELEGRAM_CHAT_ID=${chatId}</b>).\n` +
    `2) Mandame <code>/vincular mi-clave</code>\n\n` +
    `Mientras tanto no se guarda nada de lo que llegue por acá.`;
}

function ayuda(){
  return `📱 <b>Gastos Generales</b> — comandos\n\n` +
    `Mandame un comprobante (texto, foto o PDF) y lo clasifico solo.\n` +
    `<code>Coto $38.560 con débito</code>\n\n` +
    `<b>/total</b> — gastos del mes\n` +
    `<b>/alertas</b> — límites y presupuestos\n` +
    `<b>/ultimos</b> — últimos comprobantes\n` +
    `<b>/comprobante [n]</b> — reenviar el original (foto/PDF) del n-ésimo gasto\n` +
    `<b>/respaldo</b> — mandar una copia de seguridad (.json)\n` +
    `<b>/ayuda</b> — esta lista\n` +
    `<b>/vincular &lt;clave&gt;</b> — vincular este número`;
}

function resumenTotal(){
  const s = estado();
  const mes = motor.api.hoyISO().slice(0,7);
  const [ini,fin] = motor.api.rangoMes(mes);
  const list = s.exps.filter(e=>e.date>=ini && e.date<=fin);
  if(!list.length) return `📊 No hay gastos cargados en ${motor.api.fechaCorta(ini).slice(3)} / ${ini.slice(5,7)}.`;
  const total = list.reduce((a,e)=>a+Number(e.amount||0),0);
  const porCat = {};
  list.forEach(e=>{ porCat[e.cat]=(porCat[e.cat]||0)+Number(e.amount||0); });
  const filas = Object.entries(porCat).sort((a,b)=>b[1]-a[1]).map(([id,v])=>
    `• ${motor.api.esc(motor.api.catName(id))}: <b>${motor.api.money(v)}</b> (${(v/total*100).toFixed(1)}%)`);
  return `📊 <b>Gastos de ${ini.slice(0,7)}</b>\n${filas.join('\n')}\n\nTotal: <b>${motor.api.money(total)}</b> · ${list.length} comprobante${list.length>1?'s':''}`;
}
function textoAlertas(desdeISO){
  const activas = motor.api.generarAlertas(desdeISO).filter(a=>a.lvl!=='ok');
  if(!activas.length) return '✅ Ninguna categoría superó el aviso del ' + motor.api.pct(estado().cfg.warnPct) + ' de su límite.';
  return '🔔 <b>Alertas de presupuesto</b>\n' + activas.map(a=>(a.lvl==='bad'?'⛔ ':'⚠️ ') + motor.api.esc(a.txt)).join('\n');
}

async function comando(chatId, texto){
  const c = texto.split(/\s+/)[0].replace('@'+(BOT.username||''), '').toLowerCase();
  if(c === '/start' || c === '/ayuda' || c === '/help'){
    if(!chatAutorizado(chatId)) return enviar(chatId, mensajeVinculacion(chatId));
    return enviar(chatId, ayuda());
  }
  if(c === '/vincular'){
    const clave = texto.split(/\s+/).slice(1).join(' ');
    if(!CLAVE_BOT) return enviar(chatId,'Definí la variable <b>BOT_CLAVE</b> en el servidor y volvé a mandar <code>/vincular la-clave</code>.');
    if(!igual(clave, CLAVE_BOT)) return enviar(chatId,'❌ Clave incorrecta.');
    const s = estado(); s.bot = Object.assign({}, s.bot, { chatId, vinculado:Date.now() });
    motor.api.setEstado(s); tocar();
    return enviar(chatId, '✅ ¡Listo! Tu número quedó vinculado.\n\nMandame un comprobante (texto, foto o PDF) y lo clasifico.\n\n' + ayuda());
  }
  if(!chatAutorizado(chatId)) return enviar(chatId, mensajeVinculacion(chatId));
  if(c === '/respaldo'){
    const ok = await respaldarPorTelegram('manual');
    return enviar(chatId, ok
      ? '✅ Te mandé el archivo de respaldo arriba ⬆️. Guardalo en un lugar seguro (Drive, correo, etc.).'
      : '❌ No pude generar el respaldo: hace falta TELEGRAM_BOT_TOKEN y un chat vinculado.');
  }
  if(c === '/comprobante' || c === '/comprobantes'){
    const lista = estado().exps.filter(e=>e && e._doc && e._doc.fileId)
      .sort((a,b)=>(b.date||'').localeCompare(a.date||'') || (b._ts||0)-(a._ts||0));
    if(!lista.length) return enviar(chatId,
      'Todavía no hay comprobantes originales guardados. A partir de ahora, cada foto o PDF que me mandes queda archivado con el gasto.');
    const arg = parseInt(texto.split(/\s+/)[1], 10);
    const n = (isNaN(arg) || arg < 1) ? 1 : Math.min(arg, lista.length);
    const g = lista[n-1];
    try{
      const buf = await descargar(g._doc.fileId);
      const pie = `🧾 ${motor.api.money(g.amount)} · ${motor.api.catName(g.cat)} · ${motor.api.fechaCorta(g.date)}\n` +
        `comprobante ${n} de ${lista.length} guardados`;
      const ok = await enviarArchivo(chatId, buf, { mime:g._doc.mime, nombre:g._doc.nombre||'comprobante', pie });
      if(!ok) return enviar(chatId, '❌ No pude reenviar el archivo a Telegram.');
      return;
    }catch(err){
      return enviar(chatId, '❌ No pude bajar el comprobante: ' + motor.api.esc(err.message||String(err)));
    }
  }
  if(c === '/total' || c === '/mes') return enviar(chatId, resumenTotal());
  if(c === '/alertas') return enviar(chatId, textoAlertas(motor.api.rangoMes(motor.api.hoyISO().slice(0,7))[0]));
  if(c === '/ultimos' || c === '/ultimo'){
    const ult = estado().exps.slice().sort((a,b)=>(b.date||'').localeCompare(a.date||'') || (b._ts||0)-(a._ts||0)).slice(0,5);
    if(!ult.length) return enviar(chatId,'Todavía no hay comprobantes guardados.');
    return enviar(chatId, '🧾 <b>Últimos comprobantes</b>\n' + ult.map(e=>
      `• ${motor.api.fechaCorta(e.date)} · <b>${motor.api.money(e.amount)}</b> · ${motor.api.esc(motor.api.catName(e.cat))}` +
      (e.merchant? ' · ' + motor.api.esc(e.merchant):'')).join('\n'));
  }
  return enviar(chatId, 'Comando no reconocido. Mandá /ayuda');
}

async function descargar(fileId){
  const j = await apiTelegram('getFile', { file_id:fileId });
  if(!j.ok) throw new Error('Telegram no dio el archivo');
  const r = await fetch(API_BASE + '/file/bot' + TOKEN + '/' + j.result.file_path);
  if(!r.ok) throw new Error('No se pudo bajar el archivo');
  return Buffer.from(await r.arrayBuffer());
}

let _worker = null;
/* Los modelos de OCR (~8 MB) se descargan la primera vez y se guardan en la caché */
function cacheOCR(){
  const dir = process.env.TESSERACT_CACHE || path.join(require('os').homedir(), '.cache', 'gastos-generales');
  try{ fs.mkdirSync(dir, { recursive:true }); }catch(e){ return undefined; }
  return dir;
}
async function ocr(buffer){
  const { createWorker } = require('tesseract.js');
  if(!_worker) _worker = await createWorker(['spa','eng'], 1, { cachePath: cacheOCR() });
  const { data } = await _worker.recognize(buffer);
  return (data && data.text) || '';
}
async function pdfATexto(buffer){
  const pdf = require('pdf-parse');
  const r = await pdf(buffer);
  return (r && r.text) || '';
}

/* Guarda los gastos analizados y contesta al celular.
   `doc` (opcional): el archivo original recibido, para archivarlo con el gasto. */
async function guardarYResponder(chatId, fuente, origen, doc){
  const { drafts, saltados } = motor.api.analizarTexto(fuente, origen);
  const guardados = motor.api.persistirDrafts(drafts, doc);
  tocar();

  const lineas = [];
  guardados.forEach(r=>{
    const c = motor.api.catById(r.cat);
    lineas.push(`✅ <b>${motor.api.money(r.amount)}</b> · ${motor.api.esc(c ? c.name : 'Sin categoría')}` +
      (r.sub ? ' → ' + motor.api.esc(motor.api.subName(r.cat, r.sub)) : '') +
      `\n📅 ${r.date} · 🏪 ${motor.api.esc(r.merchant || 'sin comercio')}` + (r.pay ? ' · 💳 ' + motor.api.esc(r.pay) : ''));
  });

  if(!guardados.length){
    const dups = drafts.filter(d=>d._st === 'dup').length;
    if(dups) lineas.push('♻️ Ya estaba cargado: no lo guardé de nuevo.');
    if(saltados.length) lineas.push('🚫 No lo incluí: ' + motor.api.esc(saltados.map(s=>s.motivo).join(' ')));
    if(!lineas.length) lineas.push('No pude identificar el importe. Probá con: <code>' + motor.api.esc(fuente.slice(0,120)) + ' $12.345</code>');
  }else{
    const tocadas = new Set(guardados.map(r=>r.cat));
    const [ini] = motor.api.rangoMes((guardados[guardados.length-1].date || motor.api.hoyISO()).slice(0,7));
    motor.api.generarAlertas(ini).filter(a=>a.lvl!=='ok' && tocadas.has(a.cat.id))
      .forEach(a=> lineas.push((a.lvl==='bad' ? '⛔ ' : '⚠️ ') + motor.api.esc(a.txt)));
    const total = guardados.reduce((a,r)=>a + Number(r.amount||0), 0);
    lineas.push(`💰 Sumado: <b>${motor.api.money(total)}</b> · total del mes: <b>${motor.api.money(
      estado().exps.filter(e=>e.date>=ini).reduce((a,e)=>a+Number(e.amount||0),0))}</b>`);
  }
  await enviar(chatId, lineas.join('\n'));
}

async function procesar(u){
  if(!u || visto(u.update_id)) return;
  const msg = u.message || u.edited_message;
  if(!msg || !msg.chat) return;
  const chatId = msg.chat.id;
  const texto = String(msg.text || msg.caption || '').trim();

  if(texto.startsWith('/')) return comando(chatId, texto);
  if(!chatAutorizado(chatId)) return enviar(chatId, mensajeVinculacion(chatId));

  let extra = '', origen = 'texto', aviso = '', doc = null;
  try{
    if(msg.photo && msg.photo.length){
      origen = 'foto'; aviso = '📷 Leyendo el comprobante…';
      const p = msg.photo[msg.photo.length - 1];
      doc = { fileId:p.file_id, mime:'image/jpeg', nombre:'comprobante-'+motor.api.hoyISO()+'.jpg' };
      const buf = await descargar(p.file_id);
      extra = motor.api.normalizarOCR(await ocr(buf));
    }else if(msg.document){
      const d = msg.document;
      /* Un .json es un respaldo: lo restaura (sólo el chat vinculado puede) */
      const esJson = /json/i.test(d.mime_type || '') || /\.json$/i.test(d.file_name || '');
      if(esJson){
        const buf = await descargar(d.file_id);
        let b = null;
        try{ b = JSON.parse(buf.toString('utf8')); }
        catch(e){ return enviar(chatId, '❌ Ese archivo no se pudo leer como JSON.'); }
        if(!b || !Array.isArray(b.cats) || !Array.isArray(b.exps))
          return enviar(chatId, '❌ Ese archivo no parece un respaldo de Gastos Generales.');
        restaurarEstado(b, chatId);
        const s = estado();
        return enviar(chatId, `✅ <b>Respaldo restaurado</b>: ${s.exps.length} gasto${s.exps.length===1?'':'s'} y ${s.cats.length} categorías.\n\n` +
          'Entrá al dashboard para verlo. Mandá /respaldo si querés una copia nueva.');
      }
      const esPdf = /pdf/i.test(d.mime_type || '') || /\.pdf$/i.test(d.file_name || '');
      const esImg = /^image\//.test(d.mime_type || '') || /\.(png|jpe?g|webp)$/i.test(d.file_name || '');
      if(esPdf){
        origen = 'pdf'; aviso = '📄 Leyendo el PDF…';
        doc = { fileId:d.file_id, mime:'application/pdf', nombre:d.file_name||('comprobante-'+motor.api.hoyISO()+'.pdf') };
        const t = await pdfATexto(await descargar(d.file_id));
        if(t.replace(/\s/g,'').length < 30)
          return enviar(chatId,'Ese PDF no tiene texto seleccionable 📄. Mandame una <b>foto</b> del comprobante y lo leo con OCR.');
        extra = motor.api.normalizarOCR(t);
      }else if(esImg){
        origen = 'foto'; aviso = '📷 Leyendo el comprobante…';
        doc = { fileId:d.file_id, mime:/^image\//.test(d.mime_type||'') ? d.mime_type : 'image/jpeg',
                nombre:d.file_name||('comprobante-'+motor.api.hoyISO()+'.jpg') };
        extra = motor.api.normalizarOCR(await ocr(await descargar(d.file_id)));
      }else{
        return enviar(chatId,'Solo puedo recibir <b>texto, fotos y PDF</b>.');
      }
    }
  }catch(e){
    console.error('[telegram] error al leer archivo:', e);
    return enviar(chatId,'No pude leer el archivo: ' + motor.api.esc(e.message || String(e)));
  }

  const fuente = [texto, extra].filter(Boolean).join('\n');
  if(!fuente) return enviar(chatId,'Mandame el comprobante como <b>texto</b>, <b>foto</b> o <b>PDF</b>.');
  if(aviso) await enviar(chatId, aviso);
  await guardarYResponder(chatId, fuente, origen, doc);
}

/* ---- webhook (nube) ---- */
app.post('/webhook/telegram', (req,res)=>{
  if(SECRETO_WEB && req.headers['x-telegram-bot-api-secret-token'] !== SECRETO_WEB){
    console.warn('[telegram] webhook con secreto inválido');
    return res.sendStatus(403);
  }
  res.sendStatus(200);                       // se responde de inmediato para que Telegram no reintente
  const u = req.body;
  procesar(u).catch(e=>console.error('[telegram] update:', e));
});

/* ---- polling (desarrollo local, sin URL pública) ---- */
let offset = 0;
async function poll(){
  try{
    const r = await fetch(API_BASE + '/bot' + TOKEN + '/getUpdates?timeout=25&offset=' + offset,
      { signal: AbortSignal.timeout(40000) });
    const j = await r.json();
    if(j.ok){
      for(const u of j.result){ offset = u.update_id + 1; }
      for(const u of j.result){ await procesar(u).catch(e=>console.error('[telegram] update:', e)); }
    }else if(/webhook/i.test(j.description||'')){
      console.warn('[telegram] hay un webhook activo: se desactiva para usar polling');
      await apiTelegram('deleteWebhook', {});
    }
  }catch(e){ /* se reintenta */ }
  setTimeout(poll, 400);
}

/* ---------------- Arranque ---------------- */
async function arrancar(){
  if(CLAVE) console.log('· Dashboard protegido con APP_PASSWORD');
  else console.log('⚠  APP_PASSWORD no definida: el dashboard queda abierto. Definila antes de publicarlo.');

  if(TOKEN){
    try{
      const me = await apiTelegram('getMe', {});
      if(me.ok) BOT.username = me.result.username;
      console.log('· Bot de Telegram: @' + BOT.username);
    }catch(e){ console.warn('· No se pudo consultar getMe:', e.message); }
    if(URL_PUBLICA){
      try{
        const j = await apiTelegram('setWebhook', {
          url: URL_PUBLICA + '/webhook/telegram', secret_token: SECRETO_WEB, allowed_updates:['message']
        });
        console.log('· Webhook:', j.ok ? URL_PUBLICA + '/webhook/telegram' : ('ERROR ' + (j.description||'')));
      }catch(e){ console.warn('· No se pudo fijar el webhook:', e.message); }
    }else{
      console.log('· Sin PUBLIC_URL: se reciben mensajes en modo polling (sirve para probar en local)');
      poll();
    }
  }else{
    console.log('· TELEGRAM_BOT_TOKEN no definida: solo se usa el dashboard.');
  }
  console.log('· Datos en ' + path.relative(__dirname, ARCHIVO) + (fs.existsSync(ARCHIVO) ? '' : ' (se crea al primer guardado)'));

  app.listen(PUERTO, ()=>{
    console.log('· Escuchando en http://localhost:' + PUERTO);
    setTimeout(avisarFaltaDeDatos, 4000);   /* si arrancó sin datos, avisa al chat */
    programarRespaldo();                    /* respaldo si el último tiene más de 6 h */
  });
}

if(require.main === module){
  let cerrando = false;
  function cerrar(){
    if(cerrando) return; cerrando = true;
    motor.flush();
    const fin = ()=>process.exit(0);
    if(!TOKEN) return fin();
    const tope = setTimeout(fin, 6000);           /* no quedarse colgado por la red */
    respaldarPorTelegram('apagado')                /* último respaldo antes de morir */
      .catch(()=>{}).finally(()=>{ clearTimeout(tope); fin(); });
  }
  process.on('SIGINT',  cerrar);
  process.on('SIGTERM', cerrar);
  arrancar().catch(e=>{ console.error(e); process.exit(1); });
}

module.exports = { app, motor, arrancar, tocar, procesar };
