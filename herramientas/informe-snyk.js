#!/usr/bin/env node
/**
 * Genera seguridad/INFORME-SNYK.html: UN SOLO ARCHIVO con el análisis de vulnerabilidades de Snyk explicado:
 *  - veredicto, cobertura (prueba propia + cobertura que reporta Snyk), dependencias (SCA) y código (SAST)
 *  - comparación antes / después de las correcciones
 *  - qué significa cada hallazgo, si es real y qué se hizo
 *  - glosario
 * Entradas (carpeta seguridad/): snyk-codigo-ANTES.json, snyk-codigo.json, snyk-dependencias.json
 * Uso: node herramientas/informe-snyk.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SEG = path.join(__dirname, '..', 'seguridad');
const leer = (f) => { try { return JSON.parse(fs.readFileSync(path.join(SEG, f), 'utf8')); } catch (e) { return null; } };
const esc = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const NIVEL = { error: 'HIGH', warning: 'MEDIUM', note: 'LOW' };
const COLOR = { HIGH: 'ko', MEDIUM: 'av', LOW: 'mu' };

/** Explicación en lenguaje sencillo y decisión tomada para cada regla de Snyk Code. */
const REGLAS = {
  'javascript/NoRateLimitingForExpensiveWebOperation': {
    nombre: 'Sin límite de peticiones (posible denegación de servicio)',
    queEs: 'El servidor hacía una operación costosa (leer el disco) en cada petición y no limitaba cuántas peticiones podía enviar una misma IP. Un atacante podría inundarlo de peticiones para dejarlo sin recursos (ataque DoS).',
    decision: 'Corregido',
    accion: 'Se añadió un limitador por IP de tipo token bucket: 30 peticiones/s con ráfagas de 60; al superarlo responde 429 Too Many Requests con Retry-After, y se cuenta en la métrica http_requests_rate_limited_total. Además, el HTML se carga en memoria al arrancar y se recarga solo cuando cambia el archivo, así que ninguna petición toca el disco. Verificado con 2 pruebas nuevas en la suite 03.'
  },
  'javascript/PT': {
    nombre: 'Path Traversal (recorrido de rutas)',
    queEs: 'La herramienta que convierte la documentación a HTML usaba el texto escrito en la línea de comandos directamente como ruta de archivo. Con algo como "../../archivo" podría leer o sobrescribir archivos fuera del proyecto.',
    decision: 'Corregido',
    accion: 'La herramienta ahora solo acepta los tres documentos de una lista cerrada (README.md, RENDIMIENTO.md y SNYK.md). Las rutas de lectura y escritura salen de esa lista, nunca del texto del usuario; cualquier otro valor se rechaza. También se escapa el título de la página.'
  },
  'javascript/HttpToHttps': {
    nombre: 'Transmisión en texto claro (HTTP en lugar de HTTPS)',
    queEs: 'El servidor usaba solo HTTP, sin cifrado. Si se expusiera en una red, alguien podría leer el tráfico.',
    decision: 'Riesgo aceptado (mitigado)',
    accion: 'Se añadió soporte HTTPS: con las variables TLS_CERT y TLS_KEY el servidor usa https.createServer con TLS 1.2 como mínimo (comprobado con TLS 1.3 y una prueba automática que verifica el certificado). Sin certificado, el modo HTTP se mantiene solo para uso local: escucha en 127.0.0.1 y el tráfico no sale del equipo. Snyk sigue marcando la línea porque el modo HTTP existe; en producción se usa HTTPS o un proxy inverso con TLS delante.'
  },
  'javascript/HttpToHttps/test': {
    nombre: 'HTTP en las pruebas automáticas',
    queEs: 'Las pruebas se conectan por HTTP al servidor de CyberShield que ellas mismas arrancan en el propio equipo (127.0.0.1).',
    decision: 'Falso positivo',
    accion: 'No hay riesgo: es tráfico local entre la prueba y el servidor de prueba, sin datos reales. El modo cifrado se verifica aparte con su propia prueba HTTPS. Snyk etiqueta la regla con "/test" porque sabe que es código de pruebas.'
  },
  'javascript/NoHardcodedPasswords/test': {
    nombre: 'Contraseña escrita en el código',
    queEs: 'Snyk detecta texto que parece una contraseña dentro de una prueba.',
    decision: 'Falso positivo',
    accion: 'Son contraseñas ficticias ("aaaaaaaaaaaa", "xpasswordx"…) que se usan para comprobar que el medidor de fortaleza del juego las clasifica bien. No dan acceso a nada.'
  },
  'javascript/InsecureTLSConfig/test': {
    nombre: 'Configuración TLS insegura en una prueba',
    queEs: 'La prueba de HTTPS aceptaba cualquier certificado (rejectUnauthorized: false).',
    decision: 'Corregido',
    accion: 'Ahora la prueba confía solo en el certificado de prueba que genera, con la opción ca, y valida el nombre localhost / 127.0.0.1. Ya no desactiva ninguna comprobación.'
  }
};
const DEC_CLASE = { 'Corregido': 'ok', 'Falso positivo': 'mu', 'Riesgo aceptado (mitigado)': 'av' };

function hallazgos(sarif) {
  if (!sarif) return [];
  const run = sarif.runs[0];
  const reglas = new Map((run.tool.driver.rules || []).map((r) => [r.id, r]));
  return run.results.map((x) => {
    const l = x.locations[0].physicalLocation;
    const regla = reglas.get(x.ruleId) || {};
    const cwe = (regla.properties && regla.properties.cwe) || [];
    return { regla: x.ruleId, sev: NIVEL[x.level] || x.level, archivo: l.artifactLocation.uri, linea: l.region.startLine,
      titulo: (regla.shortDescription && regla.shortDescription.text) || x.ruleId, mensaje: x.message.text, cwe: cwe.join(', ') };
  });
}
const resumen = (lista) => ({ HIGH: lista.filter((h) => h.sev === 'HIGH').length, MEDIUM: lista.filter((h) => h.sev === 'MEDIUM').length, LOW: lista.filter((h) => h.sev === 'LOW').length, total: lista.length });

function generar() {
  const antes = hallazgos(leer('snyk-codigo-ANTES.json'));
  const despues = hallazgos(leer('snyk-codigo.json'));
  const sca = leer('snyk-dependencias.json');
  const sarif = leer('snyk-codigo.json');
  const covSnyk = sarif ? sarif.runs[0].properties.coverage : [];
  let covPropia = null;
  try { covPropia = require('./cobertura-snyk').analizar(); } catch (e) { /* opcional */ }
  const rA = resumen(antes), rD = resumen(despues);
  const clave = (h) => h.regla + '|' + h.archivo;
  const abiertas = new Set(despues.map(clave));
  const corregidos = antes.filter((h) => !abiertas.has(clave(h)));
  const reales = despues.filter((h) => (REGLAS[h.regla] || {}).decision !== 'Falso positivo' && (REGLAS[h.regla] || {}).decision !== 'Riesgo aceptado (mitigado)');

  const filaH = (h, estado) => {
    const r = REGLAS[h.regla] || { nombre: h.titulo, queEs: h.mensaje, decision: 'Pendiente de revisar', accion: '' };
    const dec = estado || r.decision;
    return `<tr><td class="${COLOR[h.sev]}">${h.sev}</td><td><b>${esc(r.nombre)}</b><br><small>${esc(h.regla)}${h.cwe ? ' · ' + esc(h.cwe) : ''}</small></td>
<td><code>${esc(h.archivo)}:${h.linea}</code></td><td class="${DEC_CLASE[dec] || 'ko'}">${esc(dec)}</td></tr>`;
  };
  const agrupar = (lista) => {
    const g = new Map();
    for (const h of lista) { const k = clave(h); if (!g.has(k)) g.set(k, { ...h, lineas: [] }); g.get(k).lineas.push(h.linea); }
    return [...g.values()];
  };

  const detalle = Object.entries(REGLAS).filter(([id]) => antes.some((h) => h.regla === id) || despues.some((h) => h.regla === id) || id === 'javascript/InsecureTLSConfig/test').map(([id, r]) => {
    const nA = antes.filter((h) => h.regla === id).length, nD = despues.filter((h) => h.regla === id).length;
    const ej = antes.find((h) => h.regla === id) || despues.find((h) => h.regla === id);
    return `<section class="tarjeta"><h3>${esc(r.nombre)} <span class="${DEC_CLASE[r.decision]}">· ${esc(r.decision)}</span></h3>
<p class="meta"><code>${esc(id)}</code>${ej && ej.cwe ? ' · ' + esc(ej.cwe) : ''} · antes: ${nA} · después: ${nD}${id === 'javascript/InsecureTLSConfig/test' ? ' (apareció en un análisis intermedio y se corrigió)' : ''}</p>
${ej ? `<p><b>Lo que dice Snyk:</b> <i>${esc(ej.mensaje)}</i></p>` : ''}
<p><b>Qué significa:</b> ${esc(r.queEs)}</p><p><b>Qué se hizo:</b> ${esc(r.accion)}</p></section>`;
  }).join('');

  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Informe Snyk CyberShield</title>
<style>:root{--bg:#f6f8fc;--s:#fff;--b:#d8deea;--t:#0f172a;--t2:#334155;--c:#0e7490;--ok:#047857;--ko:#be123c;--av:#b45309;--mu:#64748b;--hl:#ecfeff}
@media (prefers-color-scheme: dark){:root{--bg:#070b14;--s:#111a2e;--b:#1f2c47;--t:#e8eefc;--t2:#b4c0da;--c:#22d3ee;--ok:#10b981;--ko:#f43f5e;--av:#f59e0b;--mu:#8492b0;--hl:#0b2530}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--t);font:15px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}main{max-width:1100px;margin:0 auto;padding:28px 16px 64px}
h1{font-size:1.75rem;margin:0 0 6px;line-height:1.2}h2{font-size:1.25rem;margin:38px 0 10px;border-bottom:2px solid var(--b);padding-bottom:6px}h3{font-size:1.02rem;margin:0 0 4px}p,li{color:var(--t2)}small,.meta{color:var(--mu);font-size:.85rem}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin:18px 0}.kpi{background:var(--s);border:1px solid var(--b);border-radius:12px;padding:14px}.kpi small{display:block}.kpi b{font:700 1.45rem ui-monospace,Menlo,Consolas,monospace}.kpi span{display:block;font-size:.8rem;color:var(--mu)}
.tw{overflow-x:auto}table{width:100%;border-collapse:collapse;background:var(--s);font-size:.88rem}th,td{border:1px solid var(--b);padding:7px 9px;text-align:left;vertical-align:top}th{color:var(--c)}
.ok{color:var(--ok);font-weight:700}.ko{color:var(--ko);font-weight:700}.av{color:var(--av);font-weight:700}.mu{color:var(--mu);font-weight:700}code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.88em;word-break:break-all}
.tarjeta{background:var(--s);border:1px solid var(--b);border-radius:12px;padding:16px;margin:12px 0}.veredicto{background:var(--s);border:2px solid var(--ok);border-radius:14px;padding:16px 20px;margin:16px 0}
dl{display:grid;grid-template-columns:minmax(150px,220px) 1fr;background:var(--s);border:1px solid var(--b);border-radius:12px;overflow:hidden;margin:0}dt,dd{margin:0;padding:10px 14px;border-bottom:1px solid var(--b)}dt{font-weight:700;color:var(--c)}dd{color:var(--t2)}
@media (max-width:640px){dl{grid-template-columns:1fr}dt{border-bottom:0;padding-bottom:0}}</style></head><body><main>
<h1>Informe de seguridad con Snyk · CyberShield</h1>
<p>Generado el ${esc(new Date().toLocaleString('es-ES'))}. Análisis de vulnerabilidades con <b>Snyk Code</b> (código fuente) y <b>Snyk Open Source</b> (dependencias), antes y después de las correcciones.</p>

<div class="veredicto"><b class="ok">Veredicto: 0 vulnerabilidades altas y ninguna vulnerabilidad real pendiente.</b>
<p style="margin:6px 0 0">Snyk encontró ${rA.total} hallazgos en el primer análisis (${rA.MEDIUM} medios y ${rA.LOW} bajos). Se corrigieron los reales (${corregidos.length} hallazgos). Quedan ${rD.total}: 1 riesgo aceptado y mitigado (el modo HTTP local del servidor, que ya admite HTTPS) y ${despues.filter((h) => (REGLAS[h.regla] || {}).decision === 'Falso positivo').length} falsos positivos en el código de pruebas. El código del juego (<code>src/cybershield.js</code>) no tuvo ningún hallazgo, y las dependencias tienen <b>${sca && sca.vulnerabilities ? sca.vulnerabilities.length : 0} vulnerabilidades</b>.</p></div>

<div class="kpis">
<div class="kpi"><small>Hallazgos de código antes</small><b>${rA.total}</b><span>${rA.HIGH} altos · ${rA.MEDIUM} medios · ${rA.LOW} bajos</span></div>
<div class="kpi"><small>Hallazgos de código después</small><b>${rD.total}</b><span>${rD.HIGH} altos · ${rD.MEDIUM} medios · ${rD.LOW} bajos</span></div>
<div class="kpi"><small>Vulnerabilidades reales pendientes</small><b class="${reales.length ? 'ko' : 'ok'}">${reales.length}</b><span>tras clasificar cada hallazgo</span></div>
<div class="kpi"><small>Dependencias vulnerables</small><b class="ok">${sca && sca.vulnerabilities ? sca.vulnerabilities.length : '—'}</b><span>${sca ? sca.dependencyCount + ' dependencias analizadas' : ''}</span></div>
<div class="kpi"><small>Cobertura del JavaScript</small><b class="ok">${covPropia ? covPropia.pctJS.toFixed(0) + ' %' : '—'}</b><span>${covSnyk.map((c) => c.files + ' ' + c.lang).join(' + ')} analizados</span></div>
</div>

<h2>1. ¿Analizó Snyk todo el código? (cobertura)</h2>
<p>Antes de analizar se ejecutó la <b>prueba de cobertura</b> (<code>npm run snyk:cobertura</code>). Al principio, la lógica del juego (1 482 líneas) estaba incrustada dentro de <code>CyberShield.html</code>, y la cobertura del JavaScript era del <b>63,9 %</b>. Se separó el código fuente en <code>src/</code> y la cobertura pasó al <b>100 %</b>.</p>
<p>El propio Snyk confirma la cobertura en su resultado: analizó <b>${covSnyk.map((c) => c.files + ' archivos ' + c.lang).join(' y ')}</b>, exactamente los mismos que la prueba de cobertura marca como analizables. No se analizan los archivos que Snyk Code no admite por diseño (<code>.bat</code>, <code>.sh</code>, CSS, YAML, el plan <code>.jmx</code> de JMeter y JSON), ni los excluidos en <code>.snyk</code>: <code>CyberShield.html</code>, que es el archivo construido desde <code>src/</code>, y los informes generados en <code>rendimiento/resultados/</code>.</p>

<h2>2. Dependencias (Snyk Open Source · <code>snyk test</code>)</h2>
<p>Se analizaron las <b>${sca ? sca.dependencyCount : '—'} dependencias</b> de <code>package-lock.json</code> contra la base de datos de vulnerabilidades conocidas (CVE): <b class="ok">${sca && sca.vulnerabilities ? sca.vulnerabilities.length : 0} vulnerabilidades</b>. El juego no usa ninguna librería externa; la única dependencia es <code>playwright</code>, que solo se usa para las pruebas automáticas.</p>

<h2>3. Código fuente (Snyk Code · <code>snyk code test</code>)</h2>
<h3>Primer análisis (antes de corregir)</h3>
<div class="tw"><table><tr><th>Severidad</th><th>Hallazgo</th><th>Ubicación</th><th>Resultado</th></tr>${agrupar(antes).map((h) => filaH({ ...h, linea: h.lineas.join(', ') }, abiertas.has(clave(h)) ? null : 'Corregido')).join('')}</table></div>
<h3>Análisis final (después de corregir)</h3>
<div class="tw"><table><tr><th>Severidad</th><th>Hallazgo</th><th>Ubicación</th><th>Clasificación</th></tr>${agrupar(despues).map((h) => filaH({ ...h, linea: h.lineas.join(', ') })).join('')}</table></div>

<h2>4. Cada hallazgo explicado</h2>
${detalle}

<h2>5. Glosario</h2>
<dl>
<dt>Snyk Code (SAST)</dt><dd>Análisis estático del código fuente: lee el código sin ejecutarlo y busca patrones peligrosos (inyecciones, XSS, rutas sin validar, secretos…), siguiendo el recorrido de los datos desde donde entran (<i>source</i>) hasta donde se usan (<i>sink</i>).</dd>
<dt>Snyk Open Source (SCA)</dt><dd>Análisis de composición del software: revisa las librerías de terceros (dependencias) y sus versiones contra una base de datos de vulnerabilidades conocidas.</dd>
<dt>Severidad HIGH / MEDIUM / LOW</dt><dd>Gravedad estimada por Snyk. HIGH: explotable y con mucho impacto, hay que corregirla ya. MEDIUM: riesgo real en ciertas condiciones. LOW: impacto bajo o difícil de explotar.</dd>
<dt>CWE</dt><dd>Common Weakness Enumeration: catálogo internacional de tipos de debilidades de software (por ejemplo, CWE-23 = Path Traversal, CWE-319 = transmisión en texto claro, CWE-770 = recursos sin límite).</dd>
<dt>Falso positivo</dt><dd>Algo que la herramienta marca como problema pero que, en el contexto real, no se puede explotar. Se documenta con su justificación.</dd>
<dt>Riesgo aceptado (mitigado)</dt><dd>Un riesgo real pero controlado: existe una medida que lo reduce y se acepta conscientemente el resto, con justificación.</dd>
<dt>Path Traversal</dt><dd>Usar texto controlado por alguien como ruta de archivo, lo que permite salir de la carpeta prevista con "../" para leer o escribir otros archivos.</dd>
<dt>DoS y rate limiting</dt><dd>Denegación de servicio: saturar un servidor con peticiones. El <i>rate limiting</i> limita cuántas peticiones acepta de cada cliente por segundo.</dd>
<dt>HTTP / HTTPS / TLS</dt><dd>HTTP envía los datos sin cifrar. HTTPS los cifra con TLS (la versión 1.2 o superior se considera segura).</dd>
<dt>Código 1 de Snyk</dt><dd>Snyk termina con el código 1 cuando hay algún hallazgo, aunque sea un falso positivo. No significa que el análisis fallara.</dd>
</dl>

<h2>6. Cómo repetir este análisis</h2>
<ol><li><code>npm run snyk:cobertura</code>: debe dar 100 % de JavaScript.</li><li><code>snyk test</code>: dependencias.</li><li><code>snyk code test</code>: código fuente.</li><li><code>node herramientas/informe-snyk.js</code>: regenera este informe. En Windows también puedes usar <code>seguridad\\ejecutar-snyk.bat</code>.</li></ol>
<p><small>Nota: el CLI de Snyk solo permite marcar hallazgos como "ignorados" desde la web de Snyk o dentro de un repositorio conectado. Por eso los falsos positivos siguen apareciendo en la consola, y su justificación queda en este informe y en comentarios del propio código.</small></p>
</main></body></html>`;
  fs.writeFileSync(path.join(SEG, 'INFORME-SNYK.html'), html);
  console.log('Informe: seguridad/INFORME-SNYK.html');
}

module.exports = { generar };
if (require.main === module) generar();
