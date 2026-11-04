/* Prueba de la restauración por FUSIÓN (B1):
   reenviar un respaldo —por Telegram, desde el dashboard o por /api/restore—
   sólo aporta lo que falta y nunca pisa los datos actuales.
   Sale con 1 si algo falla. */
const fs = require('fs'), os = require('os'), path = require('path');
const { crearMotor } = require('../motor');

let fallos = 0;
const chk = (c, m) => { console.log((c ? '   ✓ ' : '   ✗ ') + m); if(!c) fallos++; };
const copia = o => JSON.parse(JSON.stringify(o));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gg-rest-'));
const m = crearMotor({ archivo: path.join(dir, 'estado.json') });
m.api.cargar();

const gasto = (id, cat, amount, extra) => Object.assign({
  id, date:'2026-10-10', cat, sub:null, detail:'Gasto ' + id, amount,
  pay:'', merchant:'', notes:'', src:'manual', _ts:1000, _catn:''
}, extra || {});

/* Estado actual: semilla + dos gastos */
const actual = m.api.normalizar(m.api.defaults());
actual.exps = [ gasto('posterior', actual.cats[0].id, 100), gasto('comun', actual.cats[1].id, 999) ];

/* Respaldo viejo: sólo trae "comun" (con otro importe) y uno que acá no está */
const respaldo = copia(actual);
respaldo.exps = [ gasto('comun', actual.cats[1].id, 111), gasto('faltante', actual.cats[2].id, 555) ];

console.log('\n1. La restauración no pisa lo que ya hay');
const r = m.api.normalizar(m.api.fusionarEstado(actual, respaldo));
chk(r.exps.length === 3, 'quedan los 3 gastos (2 actuales + 1 del respaldo)');
chk(r.exps.some(e => e.id === 'posterior'), 'el gasto posterior al respaldo se conserva');
chk(r.exps.find(e => e.id === 'comun').amount === 999,
    'el gasto en común conserva SU versión, no la del archivo');
chk(r.exps.some(e => e.id === 'faltante'), 'el gasto del respaldo que faltaba se agrega');
chk(typeof r._rev === 'number' && r._rev >= (actual._rev || 0), 'el contador _rev avanza');
chk(JSON.stringify(m.api.normalizar(copia(r))) === JSON.stringify(r),
    'volver a normalizar no cambia nada (idempotente)');

console.log('\n2. Lo que se borró en la app no vuelve con el respaldo');
const conBorrado = copia(actual);
conBorrado.exps = conBorrado.exps.filter(e => e.id !== 'comun');
conBorrado._borrados = [{ id:'comun', ts:Date.now() }];
const r2 = m.api.normalizar(m.api.fusionarEstado(conBorrado, respaldo));
chk(!r2.exps.some(e => e.id === 'comun'), 'el gasto borrado no se resucita');
chk(r2.exps.some(e => e.id === 'posterior') && r2.exps.some(e => e.id === 'faltante'),
    'los demás siguen intactos');

console.log('\n3. Servidor vacío (disco borrado): el respaldo entra completo');
const vacio = m.api.normalizar(m.api.defaults());
chk(vacio.exps.length === 0, 'el estado de arranque no tiene gastos');
vacio._borrados = [{ id:'faltante', ts:Date.now() }];   /* no debe tapar la recuperación */
const r3 = m.api.normalizar(m.api.fusionarEstado(vacio, respaldo));
chk(r3.exps.length === 2, 'los 2 gastos del respaldo se recuperan');
chk(r3.exps.some(e => e.id === 'faltante'),
    'incluido el que este lado tenía registrado como borrado');

console.log('\n4. Un gasto que quedó sin categoría se arregla con el respaldo');
const roto = copia(actual);
roto.exps = [ gasto('comun', 'cat-sin-categoria', 999, { _catn:'Sin categoría' }) ];
const r4 = m.api.normalizar(m.api.fusionarEstado(roto, respaldo));
chk(r4.exps.find(e => e.id === 'comun').cat === actual.cats[1].id,
    'recupera la categoría que le da el respaldo');
chk(r4.exps.find(e => e.id === 'comun').amount === 999,
    'y conserva sus propios datos, no los del archivo');

console.log('\n5. Categoría del respaldo con otro ID (alias)');
const conAlias = m.api.normalizar(m.api.defaults());
const bk = m.api.normalizar(m.api.defaults());
bk.cats[0] = Object.assign({}, bk.cats[0], { id:'id-viejo-aleatorio', name:conAlias.cats[0].name, _upd:1 });
bk.exps = [ gasto('g-alias', 'id-viejo-aleatorio', 333) ];
const r5 = m.api.normalizar(m.api.fusionarEstado(conAlias, bk));
chk(!r5.cats.some(c => c.id === 'id-viejo-aleatorio'),
    'la categoría con el mismo nombre no se duplica');
const expAlias = r5.exps.find(e => e.id === 'g-alias');
chk(!!expAlias && expAlias.cat === conAlias.cats[0].id,
    'el gasto del respaldo se reubica en la categoría existente');

console.log('\n6. Renombres y ediciones: el respaldo no los revierte');
const conRename = m.api.normalizar(m.api.defaults());
const c0 = conRename.cats[0];
c0.name = 'Casa'; c0._upd = Date.now();
conRename._catEdits = {};
conRename._catEdits[c0.id] = { _upd:c0._upd, _cat:copia(c0) };
const r6 = m.api.normalizar(m.api.fusionarEstado(conRename, m.api.normalizar(m.api.defaults())));
chk(r6.cats[0].name === 'Casa', 'un respaldo viejo no vuelve a poner el nombre anterior');
chk((r6.cats[0]._nombresPrevios || []).includes('Alquiler'),
    'y el nombre del respaldo queda guardado como histórico (A2)');
chk(r6._catEdits && r6._catEdits[c0.id] && r6._catEdits[c0.id]._cat.name === 'Casa',
    'la edición sigue en _catEdits para sobrevivir a un deploy');

console.log('\n7. Vinculación del bot');
const conBot = m.api.normalizar(m.api.defaults());
conBot.bot = { chatId:'777', vinculado:12345 };
const crudo = m.api.fusionarEstado(conBot, m.api.normalizar(m.api.defaults()));
chk(crudo.bot && crudo.bot.chatId === '777',
    'la restauración conserva el chat vinculado que ya tenía el servidor');

fs.rmSync(dir, { recursive:true, force:true });
console.log(fallos ? `\n${fallos} fallo(s)\n` : '\nRESULTADO: ok\n');
process.exit(fallos ? 1 : 0);
