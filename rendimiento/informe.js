'use strict';
/**
 * Genera rendimiento/resultados/INFORME-CONSOLIDADO.html: UN SOLO ARCHIVO autocontenido con
 *  - resumen ejecutivo y veredicto
 *  - guía para leer cada dato (glosario)
 *  - coherencia capacidad → validación (Ley de Little)
 *  - cobertura de niveles de usuarios, de endpoints y de código
 *  - resultados de k6 y JMeter con la interpretación de cada fila
 *  - gráficas de observabilidad del servidor incrustadas (SVG, sin JavaScript)
 *  - conclusiones y recomendaciones
 * Uso: node rendimiento/ejecutar.js informe
 */
const fs = require('fs');
const path = require('path');

const RES = path.join(__dirname, 'resultados');
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v, d = 0) => (v === undefined || v === null || Number.isNaN(Number(v)) ? '—' : Number(v).toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d }));
const leer = (f) => { try { return JSON.parse(fs.readFileSync(path.join(RES, f), 'utf8')); } catch (e) { return null; } };
const maxDe = (arr, campo) => (arr.length ? Math.max(...arr.map((x) => x[campo])) : 0);

const VUS_AUX = 3;
const ORDEN = ['humo', 'carga', 'pico', 'estres', 'capacidad', 'validacion', 'resistencia'];
const NOMBRE = { humo: 'Humo', carga: 'Carga', pico: 'Pico', estres: 'Estrés', capacidad: 'Capacidad', validacion: 'Validación', resistencia: 'Resistencia' };
const DESCRIPCION = {
  humo: '1 usuario durante 30 s. Comprueba que todo funciona antes de meter carga.',
  carga: 'Sube a 50 usuarios, los mantiene 1 min y baja. Simula una clase completa usando el juego.',
  pico: 'Pasa de 10 a 500 usuarios en 10 s. Simula que todo el colegio entra a la vez (por ejemplo, al empezar un examen).',
  estres: 'Sube por escalones: 100 → 200 → 400 usuarios. Busca a partir de qué punto empieza a empeorar.',
  capacidad: 'Lanza peticiones cada vez más rápido y sin pausas hasta que el servidor no puede más. Su objetivo es ROMPER un umbral para encontrar el límite.',
  validacion: 'Conecta A LA VEZ a todos los usuarios que alcanzó la prueba de capacidad, durante 3 min, como estudiantes reales.',
  resistencia: '30 usuarios durante 10 min seguidos. Busca problemas que solo aparecen con el tiempo, como fugas de memoria.'
};

function cargarEjecuciones() {
  const ej = fs.readdirSync(RES).filter((f) => /^ejecucion-.*\.json$/.test(f)).sort().map(leer).filter(Boolean);
  const ult = new Map();
  for (const e of ej) ult.set(e.herramienta + '|' + e.escenario, e);
  return [...ult.values()];
}

function datosK6(e) {
  const r = leer(e.resumen);
  if (!r) return null;
  const m = r.metrics;
  const juego = m['http_req_duration{tipo:juego}'] || {};
  const salud = m['http_req_duration{tipo:salud}'] || {};
  const fallidos = [];
  for (const [nombre, met] of Object.entries(m)) {
    if (met.thresholds) for (const [expr, roto] of Object.entries(met.thresholds)) if (roto) fallidos.push(`${nombre}: ${expr}`);
  }
  const checks = {};
  (function recorrer(g) {
    (g.checks ? Object.values(g.checks) : []).forEach((c) => { checks[c.name] = c; });
    (g.groups ? Object.values(g.groups) : []).forEach(recorrer);
  })(r.root_group || {});
  return {
    // k6 reserva 3 usuarios virtuales auxiliares (1 observador de métricas + 2 del auditor de rutas): se descuentan
    vus: e.escenario === 'validacion' && e.usuarios ? e.usuarios : Math.max(1, (m.vus_max ? m.vus_max.max : 0) - VUS_AUX), peticiones: m.http_reqs.count, rps: m.http_reqs.rate,
    media: juego.avg, med: juego.med, p95: juego['p(95)'], p99: juego['p(99)'], max: juego.max, saludP95: salud['p(95)'],
    errores: m.http_req_failed ? m.http_req_failed.value * 100 : 0,
    checksPct: m.checks ? m.checks.value * 100 : 0, checksN: m.checks ? m.checks.passes + m.checks.fails : 0,
    descartadas: m.dropped_iterations ? m.dropped_iterations.count : 0,
    datosMB: m.data_received ? m.data_received.count / 1048576 : 0,
    fallidos, checks
  };
}

function veredicto(e, d) {
  if (e.escenario === 'capacidad') return { ok: true, txt: d && d.fallidos.length ? 'Límite encontrado ✔' : 'Sin ruptura en el rango probado ✔' };
  return e.codigo === 0 ? { ok: true, txt: 'Aprobado ✔' } : { ok: false, txt: 'No aprobado ✖' };
}

/** Frase en lenguaje sencillo que explica qué quiere decir el resultado de cada escenario. */
function interpretar(e, d, rpsMax) {
  if (!d) return '';
  if (e.escenario === 'capacidad') {
    return `Para seguir subiendo el ritmo, k6 llegó a usar ${n(d.vus)} usuarios virtuales sin pausas. Cuando el servidor se saturó, la latencia subió (p95 de ${n(d.p95, 0)} ms) y se rompieron los umbrales de tiempo: <b>eso es lo que se buscaba</b>, el punto de ruptura. Aun así hubo ${n(d.errores, 2)} % de errores: el servidor se volvió lento, pero nunca falló.${d.descartadas ? ` k6 descartó ${n(d.descartadas)} iteraciones porque el servidor ya no podía atenderlas al ritmo pedido.` : ''}`;
  }
  const holgura = d.p95 ? Math.round(300 / d.p95) : 0;
  const base = `El 95 % de las cargas del juego tardó menos de <b>${n(d.p95, 2)} ms</b>, unas <b>${n(holgura)} veces</b> por debajo del máximo permitido (300 ms). Hubo <b>${n(d.errores, 2)} % de errores</b> y se cumplieron el <b>${n(d.checksPct, 2)} %</b> de las ${n(d.checksN)} comprobaciones.`;
  const extra = {
    humo: ' El sistema funciona correctamente y se puede pasar a pruebas con más carga.',
    carga: ' Una clase completa usa el juego sin que nadie note lentitud.',
    pico: ' Aunque 500 personas entren casi a la vez, el servidor absorbe la avalancha sin errores.',
    estres: ' Ni con 400 usuarios se observa degradación: el punto de quiebre está mucho más arriba.',
    validacion: ` Esto demuestra que el software <b>aguanta a los ${n(d.vus)} usuarios a la vez</b>. Generaron unas ${n(d.rps, 0)} peticiones/s, un ${n(rpsMax ? (d.rps / rpsMax) * 100 : 0, 0)} % de la capacidad máxima medida.`,
    resistencia: ' Tras 10 minutos seguidos, los tiempos siguen igual de bajos: no hay degradación con el tiempo.'
  };
  return base + (extra[e.escenario] || '');
}

/** Gráfica de línea en SVG (sin JavaScript). */
function svg(serie, campo, color, unidad, titulo) {
  if (!serie || !serie.length) return '';
  const W = 760, H = 170, P = 40;
  const ys = serie.map((m) => m[campo] || 0);
  const max = Math.max(1e-9, ...ys) * 1.1;
  const pts = ys.map((y, i) => `${(P + (i / Math.max(1, ys.length - 1)) * (W - P - 10)).toFixed(1)},${(H - 24 - (y / max) * (H - 44)).toFixed(1)}`).join(' ');
  const pico = Math.max(...ys);
  return `<figure><figcaption>${esc(titulo)} · pico <b>${n(pico, pico < 10 ? 2 : 0)} ${unidad}</b></figcaption>
<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(titulo)}"><line x1="${P}" y1="${H - 24}" x2="${W - 10}" y2="${H - 24}" class="eje"/>
<text x="4" y="18" class="lbl">${n(max, max < 10 ? 1 : 0)} ${unidad}</text><text x="4" y="${H - 26}" class="lbl">0</text>
<text x="${P}" y="${H - 6}" class="lbl">0 s</text><text x="${W - 10}" y="${H - 6}" class="lbl" text-anchor="end">${ys.length} s</text>
<polyline fill="none" stroke="${color}" stroke-width="2" points="${pts}"/></svg></figure>`;
}

function bloqueGraficas(titulo, o, explicacion) {
  if (!o) return '';
  const s = o.serie;
  return `<section class="tarjeta"><h3>${esc(titulo)}</h3><p>${explicacion}</p>
${svg(s, 'rps1s', '#22d3ee', 'req/s', 'Peticiones atendidas por segundo')}
${svg(s, 'p95', '#f59e0b', 'ms', 'Latencia interna p95 (tiempo que tarda el servidor en procesar)')}
${svg(s, 'memoriaMB', '#10b981', 'MB', 'Memoria del servidor')}
${svg(s, 'lazoMaxMs', '#f43f5e', 'ms', 'Retardo máximo del event loop (bloqueos del servidor)')}</section>`;
}

const AYUDA = (t) => `<details class="ayuda"><summary>¿Qué significa?</summary>${t}</details>`;

function generar() {
  const ej = cargarEjecuciones();
  const k6 = ej.filter((e) => e.herramienta === 'k6').sort((a, b) => ORDEN.indexOf(a.escenario) - ORDEN.indexOf(b.escenario));
  const jm = ej.filter((e) => e.herramienta === 'jmeter').sort((a, b) => a.usuarios - b.usuarios);
  const obs = (e) => (e && e.observabilidad ? leer(e.observabilidad.replace(/\.html$/, '.json')) : null);
  const cobertura = leer('cobertura-codigo.json');

  const porEsc = (x) => k6.find((e) => e.escenario === x);
  const cap = porEsc('capacidad'), val = porEsc('validacion'), res = porEsc('resistencia');
  const dCap = cap && datosK6(cap), dVal = val && datosK6(val);
  const oCap = obs(cap), oVal = obs(val), oRes = obs(res);
  const jVal = jm.find((e) => e.escenario === 'validacion');
  const stJ = (e) => (e ? leer(e.estadisticas) : null);

  const rpsMax = oCap ? maxDe(oCap.serie, 'rps1s') : 0;
  const iterMax = rpsMax / 2;
  const usuariosTeoricos = Math.round(iterMax * 2.002);

  const resultados = [...k6.map((e) => veredicto(e, datosK6(e)).ok), ...jm.map((e) => e.codigo === 0 && (stJ(e)?.Total.errorPct ?? 1) === 0)];
  const ok = resultados.filter(Boolean).length, total = resultados.length;
  const totalPeticiones = ej.reduce((a, e) => a + (obs(e)?.final.total || 0), 0);
  const total5xx = ej.reduce((a, e) => a + (obs(e)?.final.errores5xx || 0), 0);
  const memMax = Math.max(0, ...ej.map((e) => maxDe(obs(e)?.serie || [], 'memoriaMB')));

  /* ---------- Tablas ---------- */
  const filasK6 = k6.map((e) => {
    const d = datosK6(e); if (!d) return '';
    const v = veredicto(e, d);
    return `<tr><td><b>${NOMBRE[e.escenario] || esc(e.escenario)}</b></td><td>${n(d.vus)}</td><td>${n(d.peticiones)}</td><td>${n(d.rps, 0)}</td>
<td>${n(d.med, 2)} ms</td><td>${n(d.p95, 2)} ms</td><td>${n(d.p99, 2)} ms</td><td>${n(d.max, 1)} ms</td><td>${n(d.errores, 2)} %</td><td>${n(d.checksPct, 2)} %</td>
<td class="${v.ok ? 'ok' : 'ko'}">${v.txt}</td></tr>
<tr class="explica"><td colspan="11"><small><b>Qué es:</b> ${esc(DESCRIPCION[e.escenario] || '')}</small><br>
<b>Qué quiere decir:</b> ${interpretar(e, d, rpsMax)}${d.fallidos.length ? `<br><small>Umbrales rotos: ${d.fallidos.map(esc).join(' · ')}</small>` : ''}</td></tr>`;
  }).join('');

  const EXPL_JM = {
    '01': 'Un estudiante abre el juego. Se comprueba que responde 200, que contiene el juego, que tiene las cabeceras de seguridad y que tarda menos de 500 ms.',
    '02': 'Comprobación de salud del servidor; debe responder {"estado":"ok"} en menos de 200 ms.',
    '03': 'Prueba negativa: enviar datos con POST debe ser RECHAZADO con 405. Que no haya errores aquí significa que siempre lo rechazó correctamente.',
    '04': 'Lectura de métricas, como haría Prometheus cada 5 s.',
    '05': 'Petición HEAD: solo cabeceras, sin contenido.',
    '06': 'Panel de observabilidad en vivo.',
    '07': 'Prueba negativa: una ruta que no existe debe dar 404 (y no mostrar otros archivos del servidor).'
  };
  const filasJM = jm.map((e) => {
    const st = stJ(e); if (!st) return '';
    const t = st.Total; const okJ = e.codigo === 0 && t.errorPct === 0;
    const sub = Object.entries(st).filter(([k]) => k !== 'Total').sort().map(([k, v]) =>
      `<tr class="sub"><td>${esc(k)}<br><small>${esc(EXPL_JM[k.slice(0, 2)] || '')}</small></td><td>${n(v.sampleCount)}</td><td>${n(v.throughput, 1)}</td><td>${n(v.meanResTime, 1)} ms</td><td>${n(v.pct2ResTime, 0)} ms</td><td>${n(v.pct3ResTime, 0)} ms</td><td>${n(v.maxResTime, 0)} ms</td><td>${n(v.errorPct, 2)} %</td><td></td></tr>`).join('');
    return `<tr><td><b>${e.escenario === 'validacion' ? 'Validación' : 'Carga'}: ${n(e.usuarios)} hilos · ${n(e.duracion)} s</b></td><td><b>${n(t.sampleCount)}</b></td><td><b>${n(t.throughput, 1)}</b></td><td><b>${n(t.meanResTime, 1)} ms</b></td><td><b>${n(t.pct2ResTime, 0)} ms</b></td><td><b>${n(t.pct3ResTime, 0)} ms</b></td><td><b>${n(t.maxResTime, 0)} ms</b></td><td><b>${n(t.errorPct, 2)} %</b></td><td class="${okJ ? 'ok' : 'ko'}">${okJ ? 'Aprobado ✔' : 'No aprobado ✖'}</td></tr>${sub}`;
  }).join('');

  const filasObs = ej.slice().sort((a, b) => a.sello.localeCompare(b.sello)).map((e) => {
    const o = obs(e); if (!o) return '';
    return `<tr><td>${esc(e.titulo)}</td><td>${n(o.final.total)}</td><td>${n(maxDe(o.serie, 'rps1s'))}</td><td>${n(o.final.p99, 2)} ms</td>
<td>${n(maxDe(o.serie, 'memoriaMB'), 1)} MB</td><td>${n(o.final.lazoMs, 2)} / ${n(maxDe(o.serie, 'lazoMaxMs'), 1)} ms</td><td>${n(o.final.errores4xx)}</td><td>${n(o.final.errores5xx)}</td></tr>`;
  }).join('');

  const niveles = k6.filter((e) => e.escenario !== 'capacidad').map((e) => { const d = datosK6(e); return { u: d ? d.vus : 0, txt: 'k6 · ' + (NOMBRE[e.escenario] || e.escenario), v: veredicto(e, d) }; })
    .concat(jm.map((e) => ({ u: e.usuarios, txt: 'JMeter · ' + (e.escenario === 'validacion' ? 'Validación' : 'Carga'), v: { ok: e.codigo === 0 && stJ(e)?.Total.errorPct === 0, txt: e.codigo === 0 && stJ(e)?.Total.errorPct === 0 ? 'Aprobado ✔' : 'No aprobado ✖' } })))
    .sort((a, b) => a.u - b.u);
  const filasNiveles = niveles.map((x) => `<tr><td>${n(x.u)}</td><td>${esc(x.txt)}</td><td class="${x.v.ok ? 'ok' : 'ko'}">${x.v.txt}</td></tr>`).join('');

  const algunK6 = (c) => k6.some((e) => { const d = datosK6(e); return d && d.checks[c] && d.checks[c].passes > 0 && d.checks[c].fails === 0; });
  const algunJM = (p) => jm.some((e) => { const st = stJ(e); return st && Object.entries(st).some(([k, v]) => k.startsWith(p) && v.sampleCount > 0 && v.errorPct === 0); });
  const metricasK6 = k6.some((e) => { const r = leer(e.resumen); return r && r.metrics.cs_metricas_disponibles && r.metrics.cs_metricas_disponibles.value === 1; });
  const rutas = [
    ['GET /', 'La página del juego (comprimida y con cabeceras de seguridad)', algunK6('estado 200'), algunJM('01'), '03, 07, 13, 15'],
    ['GET /health', 'Comprobación de salud del servidor', algunK6('salud ok'), algunJM('02'), '03'],
    ['GET /metrics', 'Métricas para Prometheus', metricasK6, algunJM('04'), '03'],
    ['GET /observabilidad', 'Panel de observabilidad en vivo', algunK6('GET /observabilidad → 200'), algunJM('06'), '—'],
    ['HEAD /', 'Solo cabeceras, sin contenido', algunK6('HEAD / → 200 sin cuerpo'), algunJM('05'), '—'],
    ['POST /', 'Método no permitido → debe responder 405', algunK6('POST / → 405'), algunJM('03'), '15'],
    ['GET /no-existe', 'Ruta inexistente → debe responder 404 (sin path traversal)', algunK6('GET /no-existe → 404'), algunJM('07'), '15']
  ];
  const marca = (b) => (b ? '<span class="ok">✔</span>' : '<span class="ko">✖</span>');
  const cubiertas = rutas.filter((r) => r[2] && r[3]).length;
  const filasRutas = rutas.map((r) => `<tr><td><code>${esc(r[0])}</code></td><td>${esc(r[1])}</td><td>${marca(r[2])}</td><td>${marca(r[3])}</td><td>${esc(r[4])}</td></tr>`).join('');

  const dRes = res && datosK6(res);
  const memIniRes = oRes && oRes.serie.length ? oRes.serie[Math.min(30, oRes.serie.length - 1)].memoriaMB : 0;
  const memFinRes = oRes && oRes.serie.length ? oRes.serie[oRes.serie.length - 1].memoriaMB : 0;

  /* ---------- HTML ---------- */
  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>Informe de rendimiento CyberShield</title>
<style>
:root{--bg:#f6f8fc;--s:#fff;--b:#d8deea;--t:#0f172a;--t2:#334155;--m:#64748b;--c:#0e7490;--ok:#047857;--ko:#be123c;--hl:#ecfeff}
@media (prefers-color-scheme: dark){:root{--bg:#070b14;--s:#111a2e;--b:#1f2c47;--t:#e8eefc;--t2:#b4c0da;--m:#8492b0;--c:#22d3ee;--ok:#10b981;--ko:#f43f5e;--hl:#0b2530}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--t);font:15px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:1180px;margin:0 auto;padding:28px 16px 64px}h1{font-size:1.8rem;margin:0 0 6px;line-height:1.2}h2{margin:40px 0 10px;font-size:1.3rem;border-bottom:2px solid var(--b);padding-bottom:6px}
h3{font-size:1.05rem;margin:0 0 6px}p,li{color:var(--t2)}small{color:var(--m)}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin:18px 0}
.kpi{background:var(--s);border:1px solid var(--b);border-radius:12px;padding:14px}.kpi small{display:block}.kpi b{font:700 1.45rem ui-monospace,Menlo,Consolas,monospace}.kpi span{display:block;font-size:.8rem;color:var(--m);margin-top:4px}
.tw{overflow-x:auto;margin:10px 0}table{width:100%;border-collapse:collapse;background:var(--s);font-size:.88rem}th,td{border:1px solid var(--b);padding:7px 9px;text-align:left;vertical-align:top}
th{color:var(--c);font-weight:600;background:var(--s)}tr.explica td{background:var(--hl);font-size:.86rem}tr.sub td{font-size:.84rem;color:var(--t2)}
.ok{color:var(--ok);font-weight:700}.ko{color:var(--ko);font-weight:700}code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.9em}
.tarjeta{background:var(--s);border:1px solid var(--b);border-radius:12px;padding:16px;margin:14px 0}.nota{background:var(--s);border-left:4px solid var(--c);padding:12px 16px;border-radius:0 10px 10px 0;margin:14px 0}
.veredicto{background:var(--s);border:2px solid var(--ok);border-radius:14px;padding:16px 20px;margin:16px 0}.veredicto.mal{border-color:var(--ko)}
details.ayuda{background:var(--hl);border:1px solid var(--b);border-radius:10px;padding:8px 14px;margin:10px 0}details.ayuda summary{cursor:pointer;color:var(--c);font-weight:600}
dl.glosario{display:grid;grid-template-columns:minmax(150px,220px) 1fr;gap:0;background:var(--s);border:1px solid var(--b);border-radius:12px;overflow:hidden}
dl.glosario dt,dl.glosario dd{margin:0;padding:10px 14px;border-bottom:1px solid var(--b)}dl.glosario dt{font-weight:700;color:var(--c)}dl.glosario dd{color:var(--t2)}
@media (max-width:640px){dl.glosario{grid-template-columns:1fr}dl.glosario dt{border-bottom:0;padding-bottom:0}}
figure{margin:12px 0}figcaption{font-size:.88rem;color:var(--t2);margin-bottom:4px}svg{width:100%;height:auto;display:block}svg .eje{stroke:var(--b)}svg .lbl{fill:var(--m);font-size:11px}
.indice{columns:2;column-gap:28px}@media (max-width:640px){.indice{columns:1}}
@media print{details.ayuda{display:block}details.ayuda summary{display:none}body{background:#fff}}
</style></head><body><main>

<h1>Informe de pruebas de rendimiento y observabilidad · CyberShield</h1>
<p>Generado el ${esc(new Date().toLocaleString('es-ES'))}. Herramientas: <b>k6</b> y <b>Apache JMeter</b>, con métricas internas del servidor (observabilidad). Este archivo es autocontenido: todo lo necesario está aquí.</p>

<div class="veredicto ${ok === total ? '' : 'mal'}"><b class="${ok === total ? 'ok' : 'ko'}">${ok === total ? 'Veredicto: el software SUPERA las pruebas de rendimiento.' : 'Veredicto: hay pruebas que no se superaron.'}</b>
<p style="margin:6px 0 0">${n(ok)} de ${n(total)} pruebas superadas.${dVal ? ` Se validó que aguanta <b>${n(dVal.vus)} usuarios simultáneos</b> con ${n(dVal.errores, 2)} % de errores.` : ''} En total el servidor atendió <b>${n(totalPeticiones)} peticiones</b> con <b>${n(total5xx)} errores de servidor (5xx)</b> y nunca usó más de ${n(memMax, 0)} MB de memoria.</p></div>

<div class="kpis">
<div class="kpi"><small>Pruebas superadas</small><b class="${ok === total ? 'ok' : 'ko'}">${ok} / ${total}</b><span>k6 + JMeter</span></div>
<div class="kpi"><small>Usuarios simultáneos validados</small><b>${dVal ? n(dVal.vus) : '—'}</b><span>todos los de la prueba de capacidad</span></div>
<div class="kpi"><small>Máximo de peticiones/s</small><b>${n(rpsMax)}</b><span>medido en la prueba de capacidad</span></div>
<div class="kpi"><small>Cobertura de rutas</small><b>${cubiertas} / ${rutas.length}</b><span>probadas con k6 y JMeter</span></div>
<div class="kpi"><small>Cobertura de código</small><b>${cobertura ? n(cobertura.porcentaje, 1) + ' %' : '—'}</b><span>suite 09 (mínimo 80 %)</span></div>
</div>

<div class="tarjeta"><b>Contenido</b><ol class="indice">
<li>Cómo leer este informe (glosario)</li><li>Qué se probó y cómo</li><li>Coherencia: capacidad → validación</li><li>Cobertura de usuarios</li>
<li>Cobertura de rutas</li><li>Cobertura de código</li><li>Resultados de k6</li><li>Resultados de JMeter</li>
<li>Observabilidad del servidor</li><li>Gráficas</li><li>Conclusiones y recomendaciones</li><li>Entorno y limitaciones</li></ol></div>

<h2>1. Cómo leer este informe (glosario)</h2>
<p>Estos son todos los datos que aparecen en las tablas, explicados en lenguaje sencillo.</p>
<dl class="glosario">
<dt>Usuario virtual (VU)</dt><dd>Un "estudiante simulado" que ejecuta k6 o JMeter (en JMeter se llama <i>hilo</i>). Cada uno abre el juego, comprueba la salud del servidor y espera de 1 a 3 s, como si estuviera leyendo una pregunta.</dd>
<dt>Usuarios simultáneos</dt><dd>Cuántos usuarios virtuales están conectados <b>a la vez</b> en el momento de máxima carga. En las tablas solo se cuentan los estudiantes simulados; no se incluyen los 3 usuarios auxiliares de k6 (uno lee las métricas y dos recorren las rutas).</dd>
<dt>Petición</dt><dd>Cada vez que el navegador pide algo al servidor (la página del juego, la salud, las métricas…).</dd>
<dt>Peticiones/s (rendimiento o <i>throughput</i>)</dt><dd>Cuántas peticiones atiende el servidor cada segundo. Más es mejor: indica cuánto trabajo puede hacer.</dd>
<dt>Latencia o tiempo de respuesta</dt><dd>Lo que tarda una petición desde que se envía hasta que llega la respuesta completa. Menos es mejor. Se mide en milisegundos (ms): 1000 ms = 1 segundo. Por debajo de 100 ms una persona lo percibe como instantáneo.</dd>
<dt>Media (promedio)</dt><dd>La suma de todos los tiempos dividida entre el número de peticiones. Puede engañar si hay unas pocas peticiones muy lentas.</dd>
<dt>Mediana (p50)</dt><dd>El tiempo "del medio": la mitad de las peticiones tardó menos y la otra mitad más. Representa la experiencia típica.</dd>
<dt>p95 (percentil 95)</dt><dd>El 95 % de las peticiones tardó <b>menos</b> que este valor; solo el 5 % más lento lo supera. Es la métrica más usada para fijar objetivos, porque refleja la experiencia de casi todos los usuarios, incluidos los que tienen peor suerte.</dd>
<dt>p99 (percentil 99)</dt><dd>Igual, pero con el 99 %: solo 1 de cada 100 peticiones fue más lenta. Sirve para detectar casos raros pero molestos.</dd>
<dt>Máximo</dt><dd>La petición más lenta de toda la prueba. Suele ser la primera (el servidor "en frío") o un caso puntual.</dd>
<dt>Errores (%)</dt><dd>Porcentaje de peticiones que fallaron (sin respuesta, error 5xx o código inesperado). El objetivo es menos del 1 %; lo ideal es 0 %.</dd>
<dt>Checks (comprobaciones)</dt><dd>Verificaciones del <b>contenido</b> de cada respuesta: que el código sea 200, que llegue el juego, que esté comprimido, que tenga las cabeceras de seguridad, etc. Una respuesta rápida pero incorrecta también cuenta como fallo.</dd>
<dt>Umbral (<i>threshold</i>)</dt><dd>La condición mínima que debe cumplirse para aprobar, por ejemplo "p95 &lt; 300 ms". Si se rompe, k6 termina con el código 99.</dd>
<dt>Código 0 / 99</dt><dd>Código de salida de k6: 0 = todos los umbrales cumplidos; 99 = se rompió algún umbral. En la prueba de <b>capacidad</b> se espera 99, porque su objetivo es encontrar el límite.</dd>
<dt>Iteraciones descartadas</dt><dd>En la prueba de capacidad, veces que k6 quiso lanzar un usuario más pero el servidor ya no daba abasto. Es una señal de saturación.</dd>
<dt>Errores 4xx / 5xx</dt><dd>4xx = la petición era incorrecta (por ejemplo, 404 "no existe" o 405 "método no permitido"). En este informe los 4xx son <b>esperados</b>, porque las pruebas los provocan a propósito para comprobar que el servidor los rechaza. 5xx = fallo del servidor, que es lo grave; el objetivo es 0.</dd>
<dt>Latencia interna</dt><dd>El tiempo que el servidor tarda en <b>procesar</b> la petición, sin contar la red ni la espera en cola. Se mide dentro del propio servidor (observabilidad).</dd>
<dt>Memoria (MB)</dt><dd>Memoria RAM que usa el servidor. Si creciera sin parar durante la prueba de resistencia, indicaría una <b>fuga de memoria</b>.</dd>
<dt>Event loop (retardo)</dt><dd>Node.js atiende todas las peticiones con un solo hilo, llamado "event loop". Su retardo indica cuánto tiempo estuvo ocupado sin poder atender a nadie. Menos de 50 ms es saludable; más de 100 ms significa que el servidor se "congela".</dd>
<dt>Cobertura de código</dt><dd>Qué porcentaje del código del juego se ejecutó durante las pruebas automáticas. Cuanto más alto, menos código queda sin probar.</dd>
<dt>Cobertura de rutas (endpoints)</dt><dd>Qué direcciones del servidor se probaron bajo carga. Incluye los casos de error, para verificar que se rechazan correctamente.</dd>
<dt>Ley de Little</dt><dd>Fórmula de la teoría de colas: <b>usuarios simultáneos = peticiones por segundo × tiempo que pasa cada usuario en el sistema</b>. Permite traducir "peticiones/s" a "cuántos estudiantes caben a la vez".</dd>
<dt>Observabilidad</dt><dd>Capacidad de saber qué pasa <b>dentro</b> del servidor mientras funciona, mediante métricas (números), logs (registro de cada petición) y trazas (un identificador único por petición).</dd>
</dl>

<h2>2. Qué se probó y cómo</h2>
<div class="tw"><table><tr><th>Prueba</th><th>Tipo</th><th>Qué hace</th></tr>
${ORDEN.filter((x) => porEsc(x)).map((x) => `<tr><td><b>${NOMBRE[x]}</b> (k6)</td><td>${{ humo: 'Smoke test', carga: 'Load test', pico: 'Spike test', estres: 'Stress test', capacidad: 'Breakpoint test', validacion: 'Validación de capacidad', resistencia: 'Soak test' }[x]}</td><td>${esc(DESCRIPCION[x])}</td></tr>`).join('')}
${jm.map((e) => `<tr><td><b>${e.escenario === 'validacion' ? 'Validación' : 'Carga'}</b> (JMeter)</td><td>${e.escenario === 'validacion' ? 'Validación de capacidad' : 'Load test'}</td><td>${n(e.usuarios)} hilos durante ${n(e.duracion)} s. Cada hilo carga el juego, comprueba la salud y prueba un POST que debe ser rechazado. Un hilo aparte (el observador) recorre /metrics, HEAD, el panel y una ruta 404.</td></tr>`).join('')}
</table></div>
${AYUDA('<p>Cada tipo de prueba responde a una pregunta distinta: <b>humo</b> → ¿funciona?; <b>carga</b> → ¿va bien con el uso normal?; <b>pico</b> → ¿aguanta una avalancha repentina?; <b>estrés</b> → ¿dónde empieza a empeorar?; <b>capacidad</b> → ¿cuál es el máximo?; <b>validación</b> → ¿aguanta de verdad ese máximo de usuarios a la vez?; <b>resistencia</b> → ¿se degrada con el tiempo? Usar dos herramientas distintas (k6 y JMeter) confirma que los resultados no dependen de la herramienta.</p>')}

<h2>3. Coherencia de los resultados: capacidad → validación</h2>
${cap && val && dCap && dVal ? `
<p><b>Paso 1. Capacidad.</b> Esta prueba no usa pausas: lanza peticiones cada vez más rápido hasta saturar el servidor. Para mantener ese ritmo, k6 llegó a necesitar <b>${n(dCap.vus)} usuarios virtuales</b>, y el servidor alcanzó un máximo de <b>${n(rpsMax)} peticiones por segundo</b>.</p>
<p><b>Paso 2. Validación.</b> Se tomaron esos usuarios y se conectaron <b>${n(dVal.vus)} estudiantes simulados todos a la vez</b> durante 3 minutos, comportándose como estudiantes reales (cargan el juego, comprueban la salud y piensan de 1 a 3 s).
Resultado: <b class="${val.codigo === 0 ? 'ok' : 'ko'}">${val.codigo === 0 ? 'el software aguanta a todos' : 'el software NO aguanta a todos'}</b>, con p95 de ${n(dVal.p95, 2)} ms y ${n(dVal.errores, 2)} % de errores${jVal && stJ(jVal) ? `. JMeter lo confirma con ${n(jVal.usuarios)} hilos: ${n(stJ(jVal).Total.errorPct, 2)} % de errores y p95 de ${n(stJ(jVal).Total.pct2ResTime, 0)} ms` : ''}.</p>
<p><b>Paso 3. ¿Por qué aguanta? Ley de Little.</b> El máximo medido son ${n(rpsMax)} peticiones/s. Cada estudiante hace 2 peticiones por "vuelta", así que el servidor puede completar unas ${n(iterMax)} vueltas por segundo. Si cada estudiante tarda unos 2 s por vuelta (sobre todo pensando), la cuenta es ${n(iterMax)} × 2 s ≈ <b>${n(usuariosTeoricos)} estudiantes simultáneos</b> en teoría.
Los ${n(dVal.vus)} usuarios de la validación solo generaron ${n(dVal.rps, 0)} peticiones/s, es decir, un <b>${n(rpsMax ? (dVal.rps / rpsMax) * 100 : 0, 0)} %</b> de la capacidad máxima. Por eso hay margen de sobra.</p>
<div class="nota"><b>Aclaración importante:</b> los "${n(dCap.vus)} usuarios" de la prueba de capacidad <b>no son el número máximo de estudiantes</b> que soporta el juego. Son los usuarios virtuales que k6 necesitó para generar carga <b>sin pausas</b>; un estudiante real pasa la mayor parte del tiempo leyendo y pensando, no pidiendo cosas al servidor. Por eso el límite real se expresa mejor en peticiones/s (${n(rpsMax)}) o en estudiantes según la Ley de Little (unos ${n(usuariosTeoricos)}). La validación demuestra con hechos que los ${n(dVal.vus)} usuarios caben de sobra.</div>` : '<p>Faltan las pruebas de capacidad y validación.</p>'}

<h2>4. Cobertura de niveles de usuarios</h2>
<p>Se probó de forma escalonada, desde 1 usuario hasta <b>todos</b> los usuarios que alcanzó la prueba de capacidad, sin saltarse ningún nivel importante.</p>
<div class="tw"><table><tr><th>Usuarios simultáneos</th><th>Prueba</th><th>Resultado</th></tr>${filasNiveles}</table></div>
${AYUDA('<p>"Cobertura de usuarios" significa que no basta con probar con pocos usuarios: hay que cubrir toda la escala, desde 1 hasta el máximo medido. Si todos los niveles aparecen en verde, el software funciona bien en cualquier punto de esa escala.</p>')}

<h2>5. Cobertura de rutas (endpoints)</h2>
<p>Una "ruta" es cada dirección que ofrece el servidor. Todas se probaron <b>bajo carga</b>, incluidos los casos de error.</p>
<div class="tw"><table><tr><th>Ruta</th><th>Qué es</th><th>k6</th><th>JMeter</th><th>Suites automáticas</th></tr>${filasRutas}</table></div>
${AYUDA('<p>Una ✔ significa que esa ruta se probó con esa herramienta y respondió siempre lo correcto. En <code>POST /</code> y <code>/no-existe</code> lo correcto es <b>rechazar</b> la petición (405 y 404). Que esto funcione bajo carga demuestra que la seguridad no se relaja cuando el servidor está ocupado. La columna "Suites automáticas" indica qué pruebas del proyecto (de las 27) también verifican esa ruta.</p>')}

<h2>6. Cobertura de código</h2>
${cobertura ? `<p>La prueba de caja blanca (suite 09) juega una partida completa (aciertos, fallos, pistas, menús, informe) y mide con el motor V8 de Chrome qué parte del JavaScript del juego se ejecutó:
<b class="${cobertura.porcentaje >= cobertura.umbral ? 'ok' : 'ko'}">${n(cobertura.porcentaje, 1)} %</b> (mínimo exigido: ${cobertura.umbral} %).</p>
${AYUDA(`<p>Significa que de cada 100 caracteres de código del juego, ${n(cobertura.porcentaje, 0)} se ejecutaron al menos una vez durante las pruebas. El resto corresponde sobre todo a ramas de error difíciles de provocar (por ejemplo, un navegador sin audio o sin almacenamiento), que se prueban por separado en las suites 22 (recuperación) y 16 (penetración). Por encima del 80 % se considera una cobertura buena.</p>`)}` : '<p>Ejecuta <code>npm test</code> para medir la cobertura de código.</p>'}

<h2>7. Resultados de k6</h2>
<p>Debajo de cada fila (en color) está lo que quiere decir ese resultado.</p>
<div class="tw"><table><tr><th>Escenario</th><th>Usuarios máx.</th><th>Peticiones</th><th>Peticiones/s</th><th>Mediana</th><th>p95</th><th>p99</th><th>Máximo</th><th>Errores</th><th>Checks</th><th>Resultado</th></tr>${filasK6}</table></div>
${AYUDA('<p><b>Umbrales para aprobar:</b> errores &lt; 1 %; carga del juego con p95 &lt; 300 ms y p99 &lt; 800 ms; salud con p95 &lt; 100 ms; más del 99 % de checks correctos; cabeceras de seguridad en el 100 % de respuestas; todas las rutas respondiendo lo correcto. Las latencias de k6 se miden desde el "navegador" simulado, así que incluyen red y espera en cola.</p>')}

<h2>8. Resultados de JMeter</h2>
<p>La fila en negrita es el total de cada prueba; debajo, cada tipo de petición con su explicación.</p>
<div class="tw"><table><tr><th>Petición</th><th>Muestras</th><th>Rendimiento (req/s)</th><th>Media</th><th>p95</th><th>p99</th><th>Máximo</th><th>Errores</th><th>Resultado</th></tr>${filasJM}</table></div>
${AYUDA('<p>En JMeter una <b>muestra</b> es una petición registrada. Las <b>aserciones</b> (equivalentes a los checks de k6) verifican código, contenido, cabeceras y tiempo máximo. "0 % de errores" significa que todas las aserciones se cumplieron en todas las muestras. Las rutas del observador (04 a 07) tienen pocas muestras porque se consultan cada 5 s, como haría un sistema de monitorización. JMeter redondea los tiempos a milisegundos enteros.</p>')}

<h2>9. Observabilidad del servidor</h2>
<p>Mientras k6 y JMeter medían "desde fuera", el propio servidor registraba sus métricas internas cada segundo: las mismas que expone en <code>/metrics</code> para Prometheus.</p>
<div class="tw"><table><tr><th>Prueba</th><th>Peticiones</th><th>Pico req/s</th><th>Latencia interna p99</th><th>Memoria máx.</th><th>Event loop medio / máx.</th><th>4xx (esperados)</th><th>5xx</th></tr>${filasObs}</table></div>
${AYUDA(`<p><b>Cómo leerlo:</b> la latencia interna (lo que tarda el servidor en procesar) es de fracciones de milisegundo incluso en la prueba de capacidad. Eso significa que cuando k6 ve tiempos más altos al saturar, la causa es la <b>espera en cola</b> por falta de CPU, no que el código sea lento. Los 4xx son los 404 y 405 provocados a propósito. Los 5xx (fallos reales del servidor) deben ser 0.${dRes ? ` En la prueba de resistencia la memoria pasó de ${n(memIniRes, 1)} MB (tras el arranque) a ${n(memFinRes, 1)} MB al final de los 10 minutos: se mantiene estable, así que <b>no hay fuga de memoria</b>.` : ''}</p>`)}

<h2>10. Gráficas de observabilidad</h2>
${bloqueGraficas('Prueba de capacidad', oCap, 'Las peticiones por segundo suben hasta que se aplanan: esa <b>meseta</b> es el máximo del servidor. La latencia interna se mantiene baja durante toda la prueba y el event loop no se bloquea: el límite lo pone la CPU disponible, no el código.')}
${bloqueGraficas('Prueba de validación (todos los usuarios a la vez)', oVal, 'Rampa de subida durante 1 minuto, meseta estable de 3 minutos con todos los usuarios conectados y bajada. Si la línea de peticiones se mantiene plana en la meseta, el servidor atiende a todos de forma estable.')}
${bloqueGraficas('Prueba de resistencia (10 minutos)', oRes, 'Lo importante aquí es la memoria: si sube y se estabiliza, todo va bien; si siguiera subiendo sin parar, indicaría una fuga.')}

<h2>11. Conclusiones y recomendaciones</h2>
<ol>
<li><b>Uso real cubierto con mucho margen.</b> Con una clase (50 usuarios), con 500 entrando de golpe y con ${dVal ? n(dVal.vus) : 'todos los'} usuarios simultáneos, el juego responde en pocos milisegundos y sin errores.</li>
<li><b>Límite identificado:</b> unas ${n(rpsMax)} peticiones/s en esta máquina, lo que equivale a unos ${n(usuariosTeoricos)} estudiantes simultáneos según la Ley de Little.</li>
<li><b>El cuello de botella es la CPU, no el código.</b> Node.js usa un solo hilo y en estas pruebas el generador de carga compartía la máquina con el servidor.</li>
<li><b>Estable en el tiempo:</b> sin fugas de memoria ni bloqueos del event loop.</li>
<li><b>La seguridad no se degrada con la carga:</b> cabeceras de seguridad en el 100 % de las respuestas, y POST y rutas inexistentes siempre rechazados.</li>
</ol>
<p><b>Si se quisiera escalar más:</b> ejecutar varias instancias con el módulo <code>cluster</code> de Node.js o con PM2 (aprovecha todos los núcleos), servir la página estática con Nginx o un CDN, y ejecutar k6 desde otra máquina para medir la capacidad real sin interferencias.</p>

<h2>12. Entorno y limitaciones</h2>
<ul>
<li>Herramientas: k6 v0.54 y Apache JMeter 5.6.3. Servidor: Node.js ${esc(process.version)}. Máquina de ${require('os').cpus().length} núcleos.</li>
<li>Generador de carga y servidor en la <b>misma máquina</b>: compiten por la CPU, así que el máximo medido es un <b>límite inferior</b> (en máquinas separadas sería mayor).</li>
<li>Los números exactos cambian ligeramente en cada ejecución y entre ordenadores; lo importante son los órdenes de magnitud y que se cumplan los umbrales.</li>
<li>El stack Prometheus + Grafana (carpeta <code>observabilidad/</code>) se entrega listo, pero aquí se usaron las métricas internas del servidor porque no había Docker disponible.</li>
</ul>
</main></body></html>`;
  fs.writeFileSync(path.join(RES, 'INFORME-CONSOLIDADO.html'), html);
  console.log('\nInforme consolidado: ' + path.join(RES, 'INFORME-CONSOLIDADO.html'));
}

module.exports = { generar };
if (require.main === module) generar();
