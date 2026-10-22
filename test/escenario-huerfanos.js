/* Prueba puntual: reproduce el problema de la captura (gastos con categoría
   inexistente) y verifica que normalizar() los recupera. Sale con 1 si algo falla. */
const fs = require('fs'), os = require('os'), path = require('path');
const { crearMotor } = require('../motor');

let fallos = 0;
const chk = (c, m) => { console.log((c ? '   ✓ ' : '   ✗ ') + m); if(!c) fallos++; };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gg-escen-'));
const m = crearMotor({ archivo: path.join(dir, 'estado.json') });
m.api.cargar();
const S = m.api.estado();

/* 1) IDs de la semilla reproducibles entre instancias (tras un reinicio sin datos) */
const m2 = crearMotor({ archivo: undefined });
m2.api.cargar();
const a = S.cats.map(c => c.id).join(',');
const b = m2.api.estado().cats.map(c => c.id).join(',');
chk(a === b, 'los IDs de la semilla de categorías son reproducibles (ej. ' + S.cats[0].id + ')');

/* 2) Gasto huérfano pero con texto que SÍ permite reclasificar (caso Coto) */
S.exps.push({ id:'h1', date:'2026-10-05', cat:'xgeneracion2a', sub:'xsubgeneracion2',
  detail:'Compra en supermercado Coto', amount:38560, pay:'Débito', merchant:'Coto',
  notes:'Compra en supermercado Coto $38.560 con débito', src:'texto', _ts:Date.now() });

/* 3) Gasto huérfano sin ninguna pista */
S.exps.push({ id:'h2', date:'2026-10-06', cat:'xgeneracion2b', sub:null,
  detail:'Pago misterioso', amount:1000, pay:'', merchant:'', notes:'', src:'manual', _ts:Date.now() });

/* 4) Gasto con categoría válida NO debe tocarse */
const valida = S.cats[2].id;
S.exps.push({ id:'h3', date:'2026-10-07', cat:valida, sub:null, detail:'No me muevas',
  amount:500, pay:'', merchant:'', notes:'', src:'manual', _ts:Date.now(), _catn:'Supermercado' });

const out = m.api.normalizar(S);
const g = id => out.exps.find(e => e.id === id);

chk(g('h1').cat !== 'xgeneracion2a' && m.api.catName(g('h1').cat) === 'Supermercado',
  'el huérfano con pistas ("Coto") se recupera → ' + m.api.catName(g('h1').cat));
chk(m.api.catName(g('h2').cat) === 'Sin categoría',
  'el huérfano sin pistas queda visible en "Sin categoría" → ' + m.api.catName(g('h2').cat));
chk(g('h3').cat === valida, 'los gastos con categoría válida no se tocan');
chk(g('h1')._catn === 'Supermercado', 'recupera y guarda el nombre de la categoría (_catn)');

/* 5) Y una segunda normalización no debe crear más categorías ni cambiar nada */
const antes = JSON.stringify(out);
const out2 = m.api.normalizar(JSON.parse(antes));
chk(JSON.stringify(out2) === antes, 'reparar es idempotente (la 2ª pasada no cambia nada)');
chk(out.cats.length === 21, 'quedan 21 categorías (20 de la semilla + Sin categoría)');

fs.rmSync(dir, { recursive:true, force:true });
console.log(fallos ? `\n${fallos} fallo(s)\n` : '\nRESULTADO: ok\n');
process.exit(fallos ? 1 : 0);
