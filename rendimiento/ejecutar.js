#!/usr/bin/env node
/**
 * Orquestador de pruebas de rendimiento (Windows, Mac y Linux).
 *  1. Arranca el servidor de CyberShield con logs JSON en archivo.
 *  2. Muestrea las métricas internas del servidor cada segundo (observabilidad).
 *  3. Lanza k6 o JMeter contra el servidor.
 *  4. Guarda en rendimiento/resultados/: informe de la herramienta + informe de observabilidad HTML + logs.
 *
 * Uso:
 *   node rendimiento/ejecutar.js k6 [humo|carga|estres|pico|resistencia|capacidad] [args extra de k6]
 *   node rendimiento/ejecutar.js jmeter [usuarios] [duracion_s] [rampa_s]
 *   node rendimiento/ejecutar.js jmeter validacion          (usa los usuarios que alcanzó la prueba de capacidad)
 *   node rendimiento/ejecutar.js todo                       (batería completa + INFORME-CONSOLIDADO.html)
 *   node rendimiento/ejecutar.js informe                    (solo regenera el informe consolidado)
 * Variables: PUERTO (8080), HOST (127.0.0.1), K6_BIN (k6), JMETER_BIN (jmeter)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { iniciarServidor, resumen } = require('../servidor');

const RAIZ = __dirname;
const RES = path.join(RAIZ, 'resultados');
const [herramienta = 'k6', ...resto] = process.argv.slice(2);
const PUERTO = Number(process.env.PUERTO) || 8080;
const HOST = process.env.HOST || '127.0.0.1';
const sello = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

function svgLinea(serie, campo, color, unidad) {
  const W = 760, H = 180, P = 34;
  const ys = serie.map((m) => m[campo]);
  const max = Math.max(1, ...ys) * 1.1;
  const pts = serie.map((m, i) => `${(P + (i / Math.max(1, serie.length - 1)) * (W - P - 8)).toFixed(1)},${(H - 22 - (m[campo] / max) * (H - 40)).toFixed(1)}`).join(' ');
  const pico = Math.max(...ys, 0);
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${campo}"><line x1="${P}" y1="${H - 22}" x2="${W - 8}" y2="${H - 22}" stroke="#2d3f63"/>
<text x="4" y="16" fill="#8492b0" font-size="11">${max.toFixed(1)} ${unidad}</text><text x="4" y="${H - 24}" fill="#8492b0" font-size="11">0</text>
<text x="${W - 8}" y="${H - 6}" fill="#8492b0" font-size="11" text-anchor="end">${serie.length} s</text>
<polyline fill="none" stroke="${color}" stroke-width="2" points="${pts}"/></svg><p class="pico">Pico: <b>${pico.toFixed(2)} ${unidad}</b></p>`;
}

function informeObservabilidad(titulo, serie, final) {
  titulo = titulo || '';
  const graf = (t, c, col, u) => `<section><h2>${t}</h2>${svgLinea(serie, c, col, u)}</section>`;
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Observabilidad del servidor</title>
<style>body{margin:0;background:#070b14;color:#e8eefc;font:15px/1.5 system-ui,sans-serif}main{max-width:860px;margin:0 auto;padding:24px 16px}
h1{font-size:1.5rem;margin:0 0 4px}h2{font-size:1rem;margin:0 0 8px}section{background:#111a2e;border:1px solid #1f2c47;border-radius:12px;padding:16px;margin:14px 0}
svg{width:100%;height:auto}.pico{margin:6px 0 0;color:#b4c0da;font-size:.9rem}p{color:#8492b0}table{width:100%;border-collapse:collapse}th,td{border:1px solid #1f2c47;padding:7px;text-align:left}th{color:#22d3ee}</style></head>
<body><main><h1>Observabilidad del servidor · ${titulo}</h1><p>Métricas internas muestreadas cada segundo durante la prueba (${new Date().toLocaleString('es-ES')}).</p>
<section><h2>Resumen final</h2><table>
<tr><th>Peticiones atendidas</th><td>${final.total}</td></tr><tr><th>Errores 4xx / 5xx</th><td>${final.errores4xx} / ${final.errores5xx}</td></tr>
<tr><th>Latencia servidor p50 / p95 / p99</th><td>${final.p50} / ${final.p95} / ${final.p99} ms</td></tr>
<tr><th>Memoria residente máxima</th><td>${Math.max(...serie.map((m) => m.memoriaMB), 0)} MB</td></tr>
<tr><th>Retardo máximo del event loop</th><td>${Math.max(...serie.map((m) => m.lazoMaxMs), 0)} ms</td></tr></table>
${titulo.startsWith('JMeter') ? '<p>Los errores 4xx son esperados: el plan de JMeter envía peticiones POST para comprobar que se rechazan con 405.</p>' : ''}</section>
${graf('Peticiones por segundo', 'rps1s', '#22d3ee', 'req/s')}
${graf('Latencia p95 del servidor (últimas 2000 peticiones)', 'p95', '#f59e0b', 'ms')}
${graf('Peticiones en curso (instantánea por segundo)', 'enCurso', '#a78bfa', '')}
${graf('Memoria residente', 'memoriaMB', '#10b981', 'MB')}
${graf('Retardo medio del event loop (acumulado)', 'lazoMs', '#f43f5e', 'ms')}
</main></body></html>`;
}

/** Usuarios para el escenario de validación: USUARIOS, o los VUs máximos que necesitó la última prueba de capacidad. */
function usuariosValidacion() {
  if (process.env.USUARIOS) return Number(process.env.USUARIOS);
  try {
    const f = fs.readdirSync(RES).filter((x) => /^k6-capacidad-.*-resumen\.json$/.test(x)).sort().pop();
    // vus_max incluye 3 usuarios auxiliares (observador + auditor) que no son estudiantes
    if (f) return Math.max(1, JSON.parse(fs.readFileSync(path.join(RES, f), 'utf8')).metrics.vus_max.max - 3);
  } catch (e) { /* sin datos previos */ }
  return 1251;
}

/** Ejecuta la batería completa, una prueba tras otra, y genera el informe consolidado. */
function todo() {
  const { spawnSync } = require('child_process');
  const plan = [['k6', 'humo'], ['k6', 'carga'], ['k6', 'pico'], ['k6', 'estres'], ['k6', 'capacidad'], ['k6', 'validacion'],
    ['k6', 'resistencia'], ['jmeter', '100', '60', '15'], ['jmeter', 'validacion']];
  const rapido = process.argv.includes('--sin-resistencia');
  for (const paso of plan) {
    if (rapido && paso[1] === 'resistencia') continue;
    console.log(`\n================ ${paso.join(' ')} ================`);
    const r = spawnSync(process.execPath, [__filename, ...paso, ...(paso[0] === 'k6' ? ['--quiet'] : [])], { stdio: 'inherit', env: process.env });
    console.log(`>>> ${paso.join(' ')} terminó con código ${r.status}`);
  }
  require('./informe').generar();
}

function lanzar(cmd, args, env) {
  return new Promise((resolve) => {
    console.log('\n> ' + cmd + ' ' + args.join(' ') + '\n');
    const p = spawn(cmd, args, { stdio: 'inherit', env: { ...process.env, ...env }, shell: process.platform === 'win32' });
    p.on('error', (e) => { console.error(`\nNo se pudo ejecutar "${cmd}": ${e.message}\nInstálalo o indica su ruta con ${herramienta === 'k6' ? 'K6_BIN' : 'JMETER_BIN'}.`); resolve(127); });
    p.on('exit', (code) => resolve(code === null ? 1 : code));
  });
}

(async () => {
  fs.mkdirSync(RES, { recursive: true });
  if (herramienta === 'todo') { todo(); return; }
  if (herramienta === 'informe') { require('./informe').generar(); return; }
  const logFile = path.join(RES, `servidor-${herramienta}-${sello}.jsonl`);
  const srv = await iniciarServidor(PUERTO, { host: HOST, logFile });
  const base = `http://${HOST}:${PUERTO}`;
  console.log(`Servidor listo en ${base}  (panel en vivo: ${base}/observabilidad)`);

  const serie = [];
  let anterior = 0;
  const muestreo = setInterval(() => {
    const r = resumen(srv.metricas);
    r.rps1s = r.total - anterior; anterior = r.total;
    serie.push(r);
  }, 1000);

  let codigo, titulo;
  const meta = { herramienta, sello };
  if (herramienta === 'k6') {
    const esc = resto[0] || 'carga';
    meta.escenario = esc;
    const extra = [];
    if (esc === 'validacion') { meta.usuarios = usuariosValidacion(); extra.push('-e', `USUARIOS=${meta.usuarios}`); }
    titulo = `k6 · escenario ${esc}` + (meta.usuarios ? ` · ${meta.usuarios} usuarios` : '');
    meta.informe = `k6-${esc}-${sello}-informe.html`; meta.resumen = `k6-${esc}-${sello}-resumen.json`;
    codigo = await lanzar(process.env.K6_BIN || 'k6', ['run', '-e', `ESCENARIO=${esc}`, '-e', `BASE_URL=${base}`, ...extra,
      '--summary-export', path.join(RES, `k6-${esc}-${sello}-resumen.json`), ...resto.slice(1), path.join(RAIZ, 'k6', 'cybershield.js')],
      { K6_WEB_DASHBOARD: 'true', K6_WEB_DASHBOARD_EXPORT: path.join(RES, `k6-${esc}-${sello}-informe.html`) });
  } else if (herramienta === 'jmeter') {
    let [usuarios = '50', duracion = '90', rampa = '20'] = resto;
    if (usuarios === 'validacion') { usuarios = String(usuariosValidacion()); duracion = '180'; rampa = '60'; meta.escenario = 'validacion'; }
    else meta.escenario = 'carga';
    meta.usuarios = Number(usuarios); meta.duracion = Number(duracion);
    meta.informe = `jmeter-${sello}-informe/index.html`; meta.estadisticas = `jmeter-${sello}-informe/statistics.json`;
    titulo = `JMeter · ${usuarios} usuarios · ${duracion} s`;
    const salida = path.join(RES, `jmeter-${sello}`);
    codigo = await lanzar(process.env.JMETER_BIN || 'jmeter', ['-n', '-t', path.join(RAIZ, 'jmeter', 'cybershield.jmx'),
      `-Jhost=${HOST}`, `-Jpuerto=${PUERTO}`, `-Jusuarios=${usuarios}`, `-Jduracion=${duracion}`, `-Jrampa=${rampa}`,
      '-l', salida + '.jtl', '-j', salida + '.log', '-e', '-o', salida + '-informe']);
  } else {
    console.error('Herramienta desconocida. Usa "k6" o "jmeter".');
    codigo = 2;
  }

  clearInterval(muestreo);
  const final = resumen(srv.metricas);
  const htmlObs = path.join(RES, `observabilidad-${herramienta}-${sello}.html`);
  fs.writeFileSync(htmlObs, informeObservabilidad(titulo || herramienta, serie, final));
  fs.writeFileSync(htmlObs.replace(/\.html$/, '.json'), JSON.stringify({ titulo, final, serie }, null, 2));
  meta.codigo = codigo; meta.titulo = titulo; meta.observabilidad = path.basename(htmlObs);
  fs.writeFileSync(path.join(RES, `ejecucion-${herramienta}-${meta.escenario || 'x'}-${sello}.json`), JSON.stringify(meta, null, 2));
  await new Promise((r) => srv.close(r));
  console.log(`\nResultados en ${RES}\n  · Observabilidad del servidor: ${path.basename(htmlObs)}\n  · Logs JSON: ${path.basename(logFile)}`);
  if (global.__cybershieldTelemetria) { console.log('Enviando los últimos datos de telemetría…'); await global.__cybershieldTelemetria.cerrar(); }
  process.exit(codigo);
})();
