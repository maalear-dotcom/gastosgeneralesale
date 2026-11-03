/* Prueba de las ediciones de categorías (S1 / S2 / S3):
   S1 · una edición (renombrar "Alquiler" → "Casa", crear, borrar) queda en
        _catEdits y sobrevive a un reseed — p. ej. cuando Render borra el disco
        y el servidor vuelve a crear la semilla original.
   S2 · al fusionar dos estados, gana la categoría más reciente (_upd): ni el
        servidor ni un navegador desactualizado pisan el cambio más nuevo.
   S3 · al renombrar se actualiza el nombre que guarda cada gasto (_catn).
   Sale con 1 si algo falla. */
const fs = require('fs'), os = require('os'), path = require('path');
const { crearMotor } = require('../motor');

let fallos = 0;
const chk = (c, m) => { console.log((c ? '   ✓ ' : '   ✗ ') + m); if(!c) fallos++; };
const copia = o => JSON.parse(JSON.stringify(o));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gg-cats-'));
const m = crearMotor({ archivo: path.join(dir, 'estado.json') });
m.api.cargar();
const S = m.api.estado();

const alq = S.cats.find(c => c.name === 'Alquiler');
S.exps.push({ id:'g1', date:'2026-10-05', cat:alq.id, sub:null, detail:'Alquiler de octubre',
  amount:450000, pay:'Transferencia', merchant:'', notes:'', src:'manual', _ts:Date.now(), _catn:'Alquiler' });

/* ---------- S1 + S3: el renombre ---------- */
alq.name = 'Casa';
m.api.registrarEdicion(alq);
chk(S._catEdits[alq.id] && S._catEdits[alq.id]._cat.name === 'Casa',
    'registrarEdicion guarda la edición ("Casa") en _catEdits');
chk(S._catEdits[alq.id]._upd === alq._upd && alq._upd > 0,
    'la edición y la categoría quedan con la misma fecha (_upd)');
chk(S.exps[0]._catn === 'Casa',
    'S3: el gasto pasa a guardar el nombre nuevo (_catn)');

/* El servidor pierde el disco y vuelve a crear la semilla con los 20 nombres
   originales, pero recibe el estado del navegador (que trae las ediciones). */
const reseed = m.api.defaults();
reseed.exps = copia(S.exps);
reseed._catEdits = copia(S._catEdits);
const trasRedeploy = m.api.normalizar(reseed);
chk(trasRedeploy.cats.find(c => c.id === alq.id).name === 'Casa',
    'S1: un redeploy sin datos reaplica "Casa" sobre la semilla');
chk(trasRedeploy.exps[0].cat === alq.id && trasRedeploy.exps[0]._catn === 'Casa',
    'los gastos siguen apuntando a su categoría y a su nombre nuevo');

const otraPasada = m.api.normalizar(copia(trasRedeploy));
chk(JSON.stringify(otraPasada) === JSON.stringify(trasRedeploy),
    'volver a normalizar no cambia nada (idempotente)');

/* ---------- S1: crear y borrar categorías ---------- */
const exoticas = { id:'cat-mascotas-exoticas', name:'Mascotas exóticas', icon:'🦎',
  color:'#123456', limit:0, alert:true, kw:['gecko'], subs:[] };
S.cats.push(exoticas);
m.api.registrarEdicion(exoticas);

const sus = S.cats.find(c => c.name === 'Suscripciones');
S.cats = S.cats.filter(c => c.id !== sus.id);
m.api.registrarBorrado(sus.id);

const reseed2 = m.api.defaults();
reseed2._catEdits = copia(S._catEdits);
const trasRedeploy2 = m.api.normalizar(reseed2);
chk(trasRedeploy2.cats.some(c => c.id === exoticas.id),
    'S1: la categoría creada por el usuario vuelve a aparecer tras un reseed');
chk(!trasRedeploy2.cats.some(c => c.id === sus.id),
    'S1: la categoría que el usuario borró no revive con el reseed');
chk(trasRedeploy2.cats.length === 20, 'quedan las 20 de la semilla (se agregó una, no revivió otra)');

/* Los gastos que lleguen de otro dispositivo apuntando a la categoría borrada
   pasan a "Otros", igual que cuando se elimina desde el dashboard. */
const conHuerfanos = m.api.normalizar({
  cats: copia(m.api.defaults().cats),
  exps: [{ id:'g2', date:'2026-10-06', cat:sus.id, sub:null, detail:'Netflix', amount:11999,
           pay:'', merchant:'Netflix', notes:'', src:'manual', _ts:1, _catn:'Suscripciones' }],
  _catEdits: copia(S._catEdits)
});
const otrosCat = conHuerfanos.cats.find(c => c.name.toLowerCase() === 'otros');
chk(!conHuerfanos.cats.some(c => c.id === sus.id) && conHuerfanos.exps[0].cat === otrosCat.id,
    'los gastos de la categoría borrada quedan en "Otros" (no se pierden)');

/* ---------- S2: fusión por ID con _upd ---------- */
const servidor = copia(m.api.defaults().cats);      /* nombres originales, sin _upd */
const navegador = copia(S.cats);                    /* con la edición más nueva */
const mezcla = m.api.fusionarCats(servidor, navegador, new Map());
chk(mezcla.find(c => c.id === alq.id).name === 'Casa',
    'S2: el navegador recién editado le gana al servidor que quedó con la semilla');
chk(mezcla.some(c => c.id === exoticas.id),
    'S2: las categorías que sólo existen de un lado se agregan');

const servidorNuevo = copia(servidor);
const sc = servidorNuevo.find(c => c.id === alq.id);
sc.name = 'Hogar'; sc._upd = Date.now() + 60000;     /* el otro dispositivo editó después */
const mezcla2 = m.api.fusionarCats(navegador, servidorNuevo, new Map());
chk(mezcla2.find(c => c.id === alq.id).name === 'Hogar',
    'S2: un navegador desactualizado NO pisa el cambio más nuevo del servidor');

/* Mismo nombre con ID distinto → se trata como la misma categoría (alias) */
const alias = new Map();
const conDuplicado = m.api.fusionarCats(servidor, [{ id:'cat-otro-id', name:'Alquiler', kw:[] }], alias);
chk(alias.get('cat-otro-id') === 'cat-alquiler' && !conDuplicado.some(c => c.id === 'cat-otro-id'),
    'S2: una categoría con el mismo nombre pero otro ID no se duplica (y devuelve el alias)');

const editsA = { 'cat-alquiler': { _upd:100, _cat:{ id:'cat-alquiler', name:'Casa' } } };
const editsB = { 'cat-alquiler': { _upd:200, _cat:{ id:'cat-alquiler', name:'Hogar' } },
                 'cat-x':       { _upd:50,  _cat:{ id:'cat-x', name:'Otra' } } };
const editsFusionadas = m.api.fusionarEdits(editsA, editsB);
chk(editsFusionadas['cat-alquiler']._cat.name === 'Hogar', 'fusionarEdits gana la edición más reciente');
chk(editsFusionadas['cat-x']._cat.name === 'Otra', 'fusionarEdits conserva las ediciones de un solo lado');

/* Una edición vieja no revierte un cambio más nuevo */
const conEditViejo = m.api.normalizar({
  cats: copia(S.cats), exps: [],
  _catEdits: { 'cat-alquiler': { _upd:1, _cat:{ id:'cat-alquiler', name:'Alquiler' } } }
});
chk(conEditViejo.cats.find(c => c.id === alq.id).name === 'Casa',
    'una edición más vieja no revierte el renombre más nuevo');
chk(!conEditViejo._catEdits['cat-alquiler'], 'y la edición obsoleta se descarta');

fs.rmSync(dir, { recursive:true, force:true });
console.log(fallos ? `\n${fallos} fallo(s)\n` : '\nRESULTADO: ok\n');
process.exit(fallos ? 1 : 0);
