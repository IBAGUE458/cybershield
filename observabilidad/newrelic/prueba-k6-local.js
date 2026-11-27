'use strict';
/**
 * Prueba de carga con k6 + telemetría, capturada por el receptor OTLP local que imita a New Relic.
 * Sirve para ver EXACTAMENTE qué recibiría New Relic, sin cuenta ni Internet.
 * Uso: node observabilidad/newrelic/prueba-k6-local.js [escenario]    (por defecto: carga)
 * Variables: K6_BIN (ruta de k6, por defecto "k6")
 * Resultado: observabilidad/newrelic/prueba-k6-local.json  → luego: node observabilidad/newrelic/informe.js
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const { crearReceptor } = require('./receptor-prueba');

const RAIZ = path.join(__dirname, '..', '..');
const escenario = process.argv[2] || 'carga';
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (u) => new Promise((ok) => http.get(u, (x) => { x.resume(); x.on('end', () => ok(x.statusCode)); }).on('error', () => ok(0)));

(async () => {
  const receptor = crearReceptor();
  await new Promise((r) => receptor.listen(0, '127.0.0.1', r));
  const puerto = 20000 + Math.floor(Math.random() * 20000);
  const base = `http://127.0.0.1:${puerto}`;
  const servidor = spawn(process.execPath, ['-r', './observabilidad/newrelic/telemetria.js', 'servidor.js', String(puerto)], {
    cwd: RAIZ, stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...process.env, OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${receptor.address().port}`, OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
      NEW_RELIC_LICENSE_KEY: 'clave-de-prueba-local', OTEL_METRIC_EXPORT_INTERVAL: '5000', LOGS: '0' }
  });
  for (let i = 0; i < 80 && (await get(base + '/health')) !== 200; i++) await esperar(100);

  const resumenK6 = path.join(__dirname, `.k6-${escenario}.json`);
  console.log(`k6 · escenario ${escenario} contra ${base} (telemetría → receptor local)…`);
  const codigoK6 = await new Promise((resolve) => {
    const k = spawn(process.env.K6_BIN || 'k6', ['run', '--quiet', '-e', `ESCENARIO=${escenario}`, '-e', `BASE_URL=${base}`, '--summary-export', resumenK6,
      path.join(RAIZ, 'rendimiento', 'k6', 'cybershield.js')], { stdio: 'inherit', shell: process.platform === 'win32' });
    k.on('error', (e) => { console.error('No se pudo ejecutar k6:', e.message); resolve(127); });
    k.on('exit', (c) => resolve(c === null ? 1 : c));
  });
  await esperar(6000); // última exportación de métricas
  const fin = new Promise((r) => servidor.on('exit', r));
  servidor.kill('SIGTERM');
  await Promise.race([fin, esperar(10000)]);
  await esperar(500);

  const recibido = receptor.resumen();
  await new Promise((r) => receptor.close(r));
  let k6 = null;
  try { k6 = JSON.parse(fs.readFileSync(resumenK6, 'utf8')).metrics; fs.unlinkSync(resumenK6); } catch (e) { /* sin resumen */ }
  const salida = { fecha: new Date().toISOString(), escenario, codigoK6, k6, recibido };
  fs.writeFileSync(path.join(__dirname, 'prueba-k6-local.json'), JSON.stringify(salida, null, 2));
  console.log(`\nRecibido por el "New Relic" local: ${recibido.trazas.spans} trazas · ${Object.keys(recibido.metricas).length} métricas · ${recibido.logs.total} logs (${recibido.logs.enlazadosConTraza} enlazados)`);
  console.log('Guardado en observabilidad/newrelic/prueba-k6-local.json');
  process.exit(codigoK6 === 0 ? 0 : 1);
})();
