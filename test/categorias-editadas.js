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
chk(conEditViejo._catEdits['cat-alquiler'] &&
    conEditViejo._catEdits['cat-alquiler']._cat.name === 'Casa' &&
    conEditViejo._catEdits['cat-alquiler']._upd === alq._upd,
    'y la protección se actualiza con el valor vigente (para que un reseed no lo deshaga)');

/* ---------- S1 + S2 para subcategorías (mismo criterio que las categorías) ---------- */
const expensasSub = alq.subs.find(s => s.name === 'Expensas');
const obraSub = { id: alq.id + '|obra', name:'Obra', kw:['obra','reforma'], ctx:null, _upd:Date.now() };
alq.subs.push(obraSub);                                   /* agregada */
m.api.registrarEdicion(alq);

expensasSub.name = 'Expensas y consorcio';                 /* modificada */
expensasSub.kw = ['expensa','expensas','consorcio'];
expensasSub._upd = Date.now();
m.api.registrarEdicion(alq);

const pinturaSub = alq.subs.find(s => s.name === 'Pintura');
m.api.borrarSub(alq, pinturaSub.id);                       /* borrada */
m.api.registrarEdicion(alq);

const reseed3 = m.api.defaults();
reseed3._catEdits = copia(S._catEdits);
const trasRedeploy3 = m.api.normalizar(reseed3);
const casa = trasRedeploy3.cats.find(c => c.id === alq.id);
chk(casa.subs.some(s => s.id === obraSub.id && s.name === 'Obra'),
    'S1: la subcategoría agregada vuelve a aparecer tras un reseed');
chk(casa.subs.some(s => s.id === expensasSub.id && s.name === 'Expensas y consorcio' && s.kw.includes('consorcio')),
    'S1: la subcategoría modificada conserva su nombre y sus palabras clave');
chk(!casa.subs.some(s => s.id === pinturaSub.id),
    'S1: la subcategoría borrada no vuelve con el reseed');
chk((casa._subsBorrados || {})[pinturaSub.id] > 0, 'el borrado queda registrado (_subsBorrados)');
chk(JSON.stringify(m.api.normalizar(copia(trasRedeploy3))) === JSON.stringify(trasRedeploy3),
    'volver a normalizar con subcategorías tampoco cambia nada (idempotente)');

/* Un dispositivo agregó una subcategoría; el otro, sin saberlo, tocó la
   categoría después: la subcategoría no se pierde y el campo sí se actualiza. */
const ladoA = { id:'cat-x1', name:'Una', icon:'x', color:'#000000', limit:0, alert:true, kw:[],
                subs:[{ id:'cat-x1|s1', name:'Agregada', kw:[], _upd:100 }], _upd:100 };
const ladoB = JSON.parse(JSON.stringify(ladoA));
ladoB.subs = []; ladoB.color = '#ffffff'; ladoB._upd = 200;
const subConservada = m.api.fusionarCats([ladoA], [ladoB], new Map());
chk(subConservada[0].subs.some(s => s.id === 'cat-x1|s1'),
    'S2: la subcategoría agregada no se pierde si el otro toca la categoría después');
chk(subConservada[0].color === '#ffffff', '...y los campos los toma la versión más reciente');

/* La subcategoría borrada en un lado no revive al fusionar con el que la tiene */
const conBorrado = { id:'cat-x2', name:'Dos', subs:[], _subsBorrados:{ 'cat-x2|s1':500 }, _upd:500 };
const sinBorrado = { id:'cat-x2', name:'Dos', subs:[{ id:'cat-x2|s1', name:'Vieja', _upd:0 }], _upd:100 };
const sinResucitar = m.api.fusionarCats([conBorrado], [sinBorrado], new Map());
chk(!sinResucitar[0].subs.some(s => s.id === 'cat-x2|s1'),
    'S2: la subcategoría borrada no vuelve al fusionar con otro dispositivo');

/* De la misma subcategoría gana la versión más reciente, de cualquier lado */
const v1 = { id:'cat-x3', name:'Tres', subs:[{ id:'cat-x3|s1', name:'Viejo', _upd:100 }], _upd:100 };
const v2 = { id:'cat-x3', name:'Tres', subs:[{ id:'cat-x3|s1', name:'Nuevo', _upd:200 }], _upd:200 };
chk(m.api.fusionarCats([v1], [v2], new Map())[0].subs[0].name === 'Nuevo' &&
    m.api.fusionarCats([v2], [v1], new Map())[0].subs[0].name === 'Nuevo',
    'S2: de la misma subcategoría gana la versión más reciente en los dos sentidos');

/* Las ediciones guardadas (_catEdits) también mezclan las subcategorías */
const edA = { _upd:100, _cat:{ id:'cat-x4', name:'Cua', color:'#000000', _upd:100,
                               subs:[{ id:'cat-x4|s1', name:'Sub', _upd:100 }] } };
const edB = { _upd:200, _cat:{ id:'cat-x4', name:'Cua', color:'#ffffff', _upd:200, subs:[] } };
const edMixta = m.api.fusionarEdits({ 'cat-x4': edA }, { 'cat-x4': edB });
chk(edMixta['cat-x4']._cat.subs.some(s => s.id === 'cat-x4|s1') &&
    edMixta['cat-x4']._cat.color === '#ffffff' && edMixta['cat-x4']._upd === 200,
    'S2: en _catEdits también se mezclan las subcategorías (protección de reseed)');

fs.rmSync(dir, { recursive:true, force:true });
console.log(fallos ? `\n${fallos} fallo(s)\n` : '\nRESULTADO: ok\n');
process.exit(fallos ? 1 : 0);
