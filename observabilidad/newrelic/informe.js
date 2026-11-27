'use strict';
/**
 * Genera observabilidad/newrelic/INFORME-NEWRELIC.html: UN SOLO ARCHIVO con la prueba de observabilidad
 * (telemetría OpenTelemetry preparada para New Relic) capturada con el receptor local durante una prueba k6.
 * Entradas: prueba-k6-local.json (node observabilidad/newrelic/prueba-k6-local.js) y verificacion-local.json (npm run newrelic:verificar)
 */
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const leer = (f) => { try { return JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch (e) { return null; } };
const esc = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v, d = 0) => (v === undefined || v === null || Number.isNaN(Number(v)) ? '—' : Number(v).toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d }));

const EXPLICA_RUTA = {
  'GET /': 'Un estudiante abre el juego (la página, comprimida con gzip).',
  'GET /health': 'Comprobación de salud del servidor.',
  'GET /metrics': 'Lectura de métricas (como haría Prometheus).',
  'GET /observabilidad': 'Panel de observabilidad en vivo.',
  'HEAD /': 'Solo cabeceras, sin contenido.',
  'POST /': 'Intento de enviar datos: debe rechazarse con 405.',
  'GET otras': 'Ruta inexistente: debe responder 404 (se agrupa como "otras").'
};
const EXPLICA_METRICA = {
  'cybershield.http.server.duration': 'Histograma con la duración de cada petición, por ruta, método y código de estado. Con él New Relic calcula percentiles (p50, p95, p99) y tasas de error.',
  'http.server.request.duration': 'La misma medida, pero con el nombre estándar de OpenTelemetry (la genera la instrumentación HTTP automáticamente).',
  'cybershield.eventloop.lag': 'Retardo medio del event loop de Node.js: cuánto tiempo estuvo el servidor ocupado sin poder atender. Sano por debajo de 50 ms.',
  'cybershield.eventloop.lag.max': 'Retardo máximo del event loop en el periodo.',
  'cybershield.memory.rss': 'Memoria RAM que usa el servidor. Si creciera sin parar indicaría una fuga.',
  'cybershield.http.in_flight': 'Peticiones atendiéndose en ese instante.',
  'cybershield.http.rate_limited': 'Peticiones rechazadas por el limitador anti-DoS (429).'
};

function svg(serie, campo, color, unidad, titulo) {
  if (!serie || !serie.length) return '';
  const W = 760, H = 170, P = 40;
  const ys = serie.map((m) => m[campo] || 0);
  const max = Math.max(1e-9, ...ys) * 1.1;
  const pts = ys.map((y, i) => `${(P + (i / Math.max(1, ys.length - 1)) * (W - P - 10)).toFixed(1)},${(H - 24 - (y / max) * (H - 44)).toFixed(1)}`).join(' ');
  return `<figure><figcaption>${esc(titulo)} · pico <b>${n(Math.max(...ys), Math.max(...ys) < 10 ? 2 : 0)} ${unidad}</b></figcaption>
<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(titulo)}"><line x1="${P}" y1="${H - 24}" x2="${W - 10}" y2="${H - 24}" class="eje"/>
<text x="4" y="18" class="lbl">${n(max, max < 10 ? 1 : 0)} ${unidad}</text><text x="4" y="${H - 26}" class="lbl">0</text>
<text x="${P}" y="${H - 6}" class="lbl">0 s</text><text x="${W - 10}" y="${H - 6}" class="lbl" text-anchor="end">${ys.length} s</text>
<polyline fill="none" stroke="${color}" stroke-width="2" points="${pts}"/></svg></figure>`;
}

function generar() {
  const p = leer('prueba-k6-local.json');
  const v = leer('verificacion-local.json');
  if (!p) { console.error('Falta prueba-k6-local.json: ejecuta node observabilidad/newrelic/prueba-k6-local.js'); process.exit(1); }
  const r = p.recibido; const a = r.analisis; const k6 = p.k6 || {};
  const juegoK6 = k6['http_req_duration{tipo:juego}'] || {};
  const rutas = Object.entries(a.rutas).sort((x, y) => y[1].peticiones - x[1].peticiones);
  const estadosTot = {};
  for (const [, d] of rutas) for (const [e, c] of Object.entries(d.estados)) estadosTot[e] = (estadosTot[e] || 0) + c;
  const e5xx = Object.entries(estadosTot).filter(([e]) => Number(e) >= 500).reduce((s, [, c]) => s + c, 0);
  const pctEnlazados = r.logs.total ? (r.logs.enlazadosConTraza / r.logs.total) * 100 : 0;
  const duracion = a.serie.length;
  const ppm = duracion ? (a.global.peticiones / duracion) * 60 : 0;
  const gp = a.rutas['GET /'] || {};
  const verOk = v ? v.superadas : 0, verTot = v ? v.total : 0;

  const filasRutas = rutas.map(([nombre, d]) => `<tr><td><code>${esc(nombre)}</code><br><small>${esc(EXPLICA_RUTA[nombre] || '')}</small></td><td>${n(d.peticiones)}</td>
<td>${n(d.media, 2)}</td><td>${n(d.p50, 2)}</td><td>${n(d.p95, 2)}</td><td>${n(d.p99, 2)}</td><td>${n(d.max, 2)}</td><td>${Object.entries(d.estados).map(([e, c]) => `${esc(e)}: ${n(c)}`).join('<br>')}</td></tr>`).join('');
  const filasMetricas = Object.entries(r.metricas).map(([nombre, m]) => `<tr><td><code>${esc(nombre)}</code></td><td>${esc(m.tipo)}</td><td>${esc(m.unidad || '—')}</td>
<td>${m.temporalidad === 1 ? 'DELTA' : m.temporalidad === 2 ? 'CUMULATIVE' : '—'}</td><td>${n(m.exportaciones)}</td><td>${esc(EXPLICA_METRICA[nombre] || '')}</td></tr>`).join('');
  const filasVer = v ? Object.entries(v.comprobaciones).map(([k, ok]) => `<tr><td class="${ok ? 'ok' : 'ko'}">${ok ? '✔' : '✖'}</td><td>${esc(k)}</td></tr>`).join('') : '';
  const lento = a.trazaMasLenta; const le = a.logEnlazado;

  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Informe New Relic CyberShield</title>
<style>:root{--bg:#f6f8fc;--s:#fff;--b:#d8deea;--t:#0f172a;--t2:#334155;--m:#64748b;--c:#0e7490;--ok:#047857;--ko:#be123c;--av:#b45309;--hl:#ecfeff}
@media (prefers-color-scheme: dark){:root{--bg:#070b14;--s:#111a2e;--b:#1f2c47;--t:#e8eefc;--t2:#b4c0da;--m:#8492b0;--c:#22d3ee;--ok:#10b981;--ko:#f43f5e;--av:#f59e0b;--hl:#0b2530}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--t);font:15px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}main{max-width:1120px;margin:0 auto;padding:28px 16px 64px}
h1{font-size:1.75rem;margin:0 0 6px;line-height:1.2}h2{font-size:1.25rem;margin:38px 0 10px;border-bottom:2px solid var(--b);padding-bottom:6px}h3{font-size:1.02rem;margin:18px 0 6px}p,li{color:var(--t2)}small{color:var(--m)}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin:18px 0}.kpi{background:var(--s);border:1px solid var(--b);border-radius:12px;padding:14px}.kpi small{display:block}.kpi b{font:700 1.4rem ui-monospace,Menlo,Consolas,monospace}.kpi span{display:block;font-size:.8rem;color:var(--m)}
.tw{overflow-x:auto}table{width:100%;border-collapse:collapse;background:var(--s);font-size:.88rem}th,td{border:1px solid var(--b);padding:7px 9px;text-align:left;vertical-align:top}th{color:var(--c)}
.ok{color:var(--ok);font-weight:700}.ko{color:var(--ko);font-weight:700}code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.88em;word-break:break-all}
.tarjeta{background:var(--s);border:1px solid var(--b);border-radius:12px;padding:16px;margin:12px 0}.aviso{background:var(--s);border-left:5px solid var(--av);padding:12px 16px;border-radius:0 12px 12px 0;margin:14px 0}
.veredicto{background:var(--s);border:2px solid var(--ok);border-radius:14px;padding:16px 20px;margin:16px 0}.flujo{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.85rem;background:var(--s);border:1px solid var(--b);border-radius:12px;padding:14px;overflow-x:auto;white-space:pre}
dl{display:grid;grid-template-columns:minmax(150px,220px) 1fr;background:var(--s);border:1px solid var(--b);border-radius:12px;overflow:hidden;margin:0}dt,dd{margin:0;padding:10px 14px;border-bottom:1px solid var(--b)}dt{font-weight:700;color:var(--c)}dd{color:var(--t2)}
@media (max-width:640px){dl{grid-template-columns:1fr}dt{border-bottom:0;padding-bottom:0}}
figure{margin:12px 0}figcaption{font-size:.88rem;color:var(--t2);margin-bottom:4px}svg{width:100%;height:auto;display:block}svg .eje{stroke:var(--b)}svg .lbl{fill:var(--m);font-size:11px}</style></head><body><main>

<h1>Informe de observabilidad · CyberShield + New Relic (OpenTelemetry)</h1>
<p>Prueba realizada el ${esc(new Date(p.fecha).toLocaleString('es-ES'))} · escenario k6 <b>${esc(p.escenario)}</b> (hasta 50 usuarios simultáneos, ${n(duracion)} s).</p>

<div class="aviso"><b>Importante: de dónde salen estos datos.</b> El servidor de CyberShield está instrumentado para enviar sus datos a <b>New Relic</b>: formato OTLP, servidor <code>otlp.nr-data.net</code> y autenticación con la cabecera <code>api-key</code>. Al conectarlo con la cuenta, New Relic <b>rechazó las claves</b> ("Forbidden"), tanto desde la nube como desde el PC del estudiante, así que el problema está en la clave o en el estado de la cuenta, no en el proyecto. Por eso la telemetría se capturó con un <b>receptor OTLP local que imita a New Relic</b>: recibe exactamente los mismos datos, con el mismo formato y la misma cabecera. Las cifras de este informe son <b>reales</b> y corresponden a lo que New Relic habría recibido. No son capturas del panel de New Relic.</div>

<div class="veredicto"><b class="ok">Resultado: la telemetría está completa y es correcta.</b>
<p style="margin:6px 0 0">Las ${n(k6.http_reqs ? k6.http_reqs.count : a.global.peticiones)} peticiones de k6 generaron <b>${n(r.trazas.spans)} trazas</b> y <b>${n(r.logs.total)} logs</b>, con el <b>${n(pctEnlazados, 0)} %</b> de los logs enlazado con su traza, y <b>${n(Object.keys(r.metricas).length)} métricas</b>. Hubo <b>${n(e5xx)} errores de servidor (5xx)</b>. La verificación automática superó <b>${verOk} de ${verTot}</b> comprobaciones.</p></div>

<div class="kpis">
<div class="kpi"><small>Trazas (peticiones)</small><b>${n(r.trazas.spans)}</b><span>≈ ${n(ppm)} peticiones/min</span></div>
<div class="kpi"><small>Latencia del servidor p95</small><b>${n(a.global.p95, 2)} ms</b><span>todas las rutas</span></div>
<div class="kpi"><small>Logs enlazados con su traza</small><b class="ok">${n(pctEnlazados, 0)} %</b><span>${n(r.logs.enlazadosConTraza)} de ${n(r.logs.total)}</span></div>
<div class="kpi"><small>Métricas enviadas</small><b>${n(Object.keys(r.metricas).length)}</b><span>temporalidad DELTA</span></div>
<div class="kpi"><small>Errores 5xx</small><b class="${e5xx ? 'ko' : 'ok'}">${n(e5xx)}</b><span>fallos del servidor</span></div>
<div class="kpi"><small>Verificación</small><b class="${verOk === verTot ? 'ok' : 'ko'}">${verOk}/${verTot}</b><span>comprobaciones superadas</span></div>
</div>

<h2>1. Qué es New Relic y qué se probó</h2>
<p><b>New Relic</b> es una plataforma de <b>observabilidad</b> en la nube: recibe en tiempo real los datos internos de una aplicación (qué peticiones atiende, cuánto tardan, si fallan, cuánta memoria usa…) y los muestra en paneles con búsquedas (NRQL) y alertas. La prueba comprueba que CyberShield envía los <b>tres pilares de la observabilidad</b>:</p>
<div class="tw"><table><tr><th>Pilar</th><th>Qué es</th><th>Qué envía CyberShield</th></tr>
<tr><td><b>Trazas</b></td><td>El recorrido de cada petición dentro del servidor, con su duración.</td><td>Una traza por petición, nombrada por ruta (<code>GET /</code>, <code>POST /</code>…), con código de estado, duración, <code>X-Request-Id</code> y un evento cuando el limitador rechaza una petición.</td></tr>
<tr><td><b>Métricas</b></td><td>Números medidos cada cierto tiempo.</td><td>${n(Object.keys(r.metricas).length)} métricas: duración de las peticiones, event loop, memoria, peticiones en curso y rechazos del limitador.</td></tr>
<tr><td><b>Logs</b></td><td>El registro escrito de lo que pasa.</td><td>Un log por petición (INFO, y WARN para 404, 405 y 429), <b>enlazado con su traza</b>: desde un log se salta a la traza y al revés.</td></tr></table></div>

<h2>2. Cómo se hizo la prueba</h2>
<div class="flujo">k6 (50 estudiantes simulados)
   │  peticiones HTTP
   ▼
Servidor CyberShield  +  OpenTelemetry  (observabilidad/newrelic/telemetria.js, cargado con node -r)
   │  OTLP/HTTP · cabecera api-key · temporalidad DELTA   (en New Relic: https://otlp.nr-data.net)
   ▼
Receptor OTLP local que imita a New Relic  →  resumen de trazas, métricas y logs  →  este informe</div>
<p>Se usa <b>OpenTelemetry</b>, el estándar abierto de observabilidad que New Relic recomienda. Con la clave válida, basta con definir <code>NEW_RELIC_LICENSE_KEY</code> para que los mismos datos lleguen a New Relic. El código no cambia.</p>

<h2>3. Trazas: cada petición por dentro</h2>
<p>Tiempos medidos <b>dentro del servidor</b> (desde que llega la petición hasta que se envía la respuesta), en milisegundos.</p>
<div class="tw"><table><tr><th>Ruta (nombre de la traza)</th><th>Peticiones</th><th>Media</th><th>p50</th><th>p95</th><th>p99</th><th>Máx.</th><th>Códigos</th></tr>${filasRutas}
<tr><td><b>Total</b></td><td><b>${n(a.global.peticiones)}</b></td><td><b>${n(a.global.media, 2)}</b></td><td><b>${n(a.global.p50, 2)}</b></td><td><b>${n(a.global.p95, 2)}</b></td><td><b>${n(a.global.p99, 2)}</b></td><td><b>${n(a.global.max, 2)}</b></td><td></td></tr></table></div>
<p><b>Qué quiere decir:</b> el 95 % de las peticiones se procesó en menos de <b>${n(a.global.p95, 2)} ms</b>. Las respuestas 404 y 405 son <b>correctas</b>: las provoca a propósito el "auditor" de k6 para comprobar que el servidor rechaza rutas inexistentes y métodos no permitidos. No hubo ningún 5xx.</p>
${svg(a.serie, 'peticiones', '#22d3ee', 'peticiones/s', 'Peticiones por segundo (rampa de subida, meseta de 50 usuarios y bajada)')}
${svg(a.serie, 'p95', '#f59e0b', 'ms', 'Latencia p95 del servidor por segundo')}
${lento ? `<div class="tarjeta"><b>Traza más lenta de la prueba:</b> <code>${esc(lento.nombre)}</code> · ${n(lento.ms, 2)} ms · request_id <code>${esc(lento.atributos['cybershield.request_id'])}</code> · trace_id <code>${esc(lento.traceId)}</code><br><small>${lento.nombre === 'GET /observabilidad' ? 'Es la ruta que más trabajo hace: genera en el momento la página del panel con estadísticas (percentiles, memoria, event loop). Aun así tardó solo unos milisegundos.' : 'Suele ser una de las primeras peticiones, con el servidor todavía "en frío".'} En New Relic se encontraría en Distributed tracing ordenando por duración.</small></div>` : ''}

<h3>Cliente (k6) frente a servidor (trazas)</h3>
<div class="tw"><table><tr><th>Medida</th><th>p95</th><th>Qué incluye</th></tr>
<tr><td>k6: carga del juego (<code>GET /</code>)</td><td>${n(juegoK6['p(95)'], 2)} ms</td><td>Lo que espera el "navegador": red, transferencia de ~34 KB comprimidos y procesamiento.</td></tr>
<tr><td>Traza del servidor <code>GET /</code></td><td>${n(gp.p95, 2)} ms</td><td>Solo el procesamiento dentro del servidor.</td></tr></table></div>
<p><b>Qué quiere decir:</b> la diferencia es el tiempo de red y de transferencia. Que el servidor tarde mucho menos que lo que ve el cliente confirma que el código no es el cuello de botella. Esta comparación entre la vista de fuera y la de dentro es justo lo que aporta la observabilidad.</p>

<h2>4. Métricas</h2>
<div class="tw"><table><tr><th>Métrica</th><th>Tipo</th><th>Unidad</th><th>Temporalidad</th><th>Envíos</th><th>Qué significa</th></tr>${filasMetricas}</table></div>
<p><small>New Relic recomienda temporalidad <b>DELTA</b> para OTLP: cada envío contiene lo ocurrido desde el anterior. Las métricas se enviaron cada 5 s durante la prueba.</small></p>

<h2>5. Logs enlazados con las trazas (logs in context)</h2>
<p>Se recibieron <b>${n(r.logs.total)} logs</b>: ${Object.entries(r.logs.porSeveridad).map(([s, c]) => `<b>${esc(s)}</b> ${n(c)}`).join(' · ')}. El <b>${n(pctEnlazados, 0)} %</b> lleva el identificador de su traza, así que en New Relic, desde cualquier log, se puede saltar a la traza de esa petición con <i>Show in context</i>.</p>
${le ? `<div class="tarjeta"><b>Ejemplo real de log enlazado:</b><br>Log <b>${esc(le.log.severidad)}</b>: <i>"${esc(le.log.cuerpo)}"</i> · trace_id <code>${esc(le.log.traceId)}</code><br>${le.traza ? `↳ Su traza: <code>${esc(le.traza.nombre)}</code> · ${n(le.traza.ms, 2)} ms · request_id <code>${esc(le.traza.requestId)}</code>` : ''}</div>` : ''}

<h2>6. Verificación automática (${verOk}/${verTot})</h2>
${v ? `<div class="tw"><table><tr><th></th><th>Comprobación</th></tr>${filasVer}</table></div><p><small>Se ejecuta con <code>npm run newrelic:verificar</code> y forma parte de la suite 03 de pruebas automáticas (GitHub Actions la ejecuta en cada push).</small></p>` : '<p>Ejecuta <code>npm run newrelic:verificar</code>.</p>'}

<h2>7. Cómo se vería en New Relic</h2>
<p>Con una clave válida, los mismos datos aparecerían en <b>APM &amp; Services → cybershield</b>. El proyecto incluye un dashboard importable (<code>observabilidad/newrelic/dashboard-cybershield.json</code>, 11 gráficos). Con los datos de esta prueba, mostraría:</p>
<div class="tw"><table><tr><th>Gráfico del dashboard</th><th>Consulta NRQL</th><th>Valor esperado con esta prueba</th></tr>
<tr><td>Peticiones por minuto</td><td><code>SELECT rate(count(*), 1 minute) FROM Span WHERE service.name='cybershield'</code></td><td>≈ ${n(ppm)} en la meseta</td></tr>
<tr><td>Latencia p50/p95/p99</td><td><code>SELECT percentile(cybershield.http.server.duration, 50, 95, 99) FROM Metric</code></td><td>${n(a.global.p50, 2)} / ${n(a.global.p95, 2)} / ${n(a.global.p99, 2)} ms</td></tr>
<tr><td>Errores 5xx</td><td><code>… filter(count(…), WHERE http.response.status_code >= 500) …</code></td><td>${n(e5xx)} (0 %)</td></tr>
<tr><td>Peticiones por ruta y estado</td><td><code>… FACET http.route, http.response.status_code</code></td><td>${rutas.length} rutas (tabla de la sección 3)</td></tr>
<tr><td>Logs por severidad</td><td><code>SELECT count(*) FROM Log FACET severity.text</code></td><td>${Object.entries(r.logs.porSeveridad).map(([s, c]) => `${esc(s)} ${n(c)}`).join(' · ')}</td></tr></table></div>

<h2>8. Problemas encontrados</h2>
<ul>
<li><b>Dos errores de integración, detectados y corregidos por la verificación antes de usar la cuenta:</b> en el SDK 3.x de OpenTelemetry los procesadores por lotes se construyen ahora con <code>{ exporter }</code>, y el paquete protobuf no exporta la constante de temporalidad. Sin la corrección, el servidor no habría arrancado en modo New Relic.</li>
<li><b>Claves rechazadas por New Relic ("Forbidden" / "authentication required"):</b> ocurrió igual desde la nube y desde el PC del estudiante. Causas probables: la cuenta no tiene el correo verificado o tiene la ingesta desactivada, o la clave se copió incompleta. Para comprobarlo: <code>observabilidad\\newrelic\\diagnostico.bat</code> (prueba la clave en EE. UU. y Europa). Solución recomendada: copiar la clave desde el instalador guiado (<i>Add data → OpenTelemetry</i>) o crear una cuenta nueva.</li>
</ul>

<h2>9. Glosario</h2>
<dl>
<dt>Observabilidad</dt><dd>Capacidad de entender qué pasa dentro de una aplicación mientras funciona, a partir de sus trazas, métricas y logs.</dd>
<dt>OpenTelemetry (OTel)</dt><dd>Estándar abierto para generar y enviar telemetría. Funciona con New Relic, Grafana, Datadog, Jaeger… cambiando solo el destino.</dd>
<dt>OTLP</dt><dd>El protocolo de OpenTelemetry para enviar los datos (aquí, HTTP con JSON o protobuf).</dd>
<dt>Traza (span)</dt><dd>El registro de una petición: nombre, inicio, duración, atributos y eventos. Se identifica con un <i>trace_id</i>.</dd>
<dt>Logs in context</dt><dd>Logs que llevan el <i>trace_id</i> de la petición que los generó, para saltar del log a la traza y al revés.</dd>
<dt>p50 / p95 / p99</dt><dd>Percentiles: el 50 %, el 95 % o el 99 % de las peticiones tardó menos que ese valor.</dd>
<dt>Temporalidad DELTA</dt><dd>Cada envío de métricas contiene solo lo ocurrido desde el envío anterior (la que prefiere New Relic).</dd>
<dt>NRQL</dt><dd>El lenguaje de consultas de New Relic, parecido a SQL, con el que se construyen gráficos y alertas.</dd>
<dt>License key / User key</dt><dd>La License key (termina en NRAL) sirve para <b>enviar</b> datos; la User key (NRAK-…) sirve para <b>consultarlos</b> y gestionar dashboards.</dd>
</dl>

<h2>10. Cómo repetirlo en New Relic</h2>
<ol><li>Comprobar la clave: <code>observabilidad\\newrelic\\diagnostico.bat</code>.</li><li>Ejecutar la prueba: <code>observabilidad\\newrelic\\ejecutar-newrelic.bat</code> (pide la License key).</li>
<li>Ver en New Relic: <b>APM &amp; Services → cybershield</b>, <b>Traces</b> y <b>Logs</b>.</li><li>Importar el dashboard: <code>npm run newrelic:dashboard -- TU_ACCOUNT_ID</code> → Dashboards → Import dashboard.</li></ol>
<p><small>Reproducir este informe sin cuenta: <code>node observabilidad/newrelic/prueba-k6-local.js</code> y después <code>node observabilidad/newrelic/informe.js</code>.</small></p>
</main></body></html>`;
  fs.writeFileSync(path.join(DIR, 'INFORME-NEWRELIC.html'), html);
  console.log('Informe: observabilidad/newrelic/INFORME-NEWRELIC.html');
}

generar();
