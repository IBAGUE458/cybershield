'use strict';
/**
 * Verificación local de la integración con New Relic (sin cuenta ni Internet):
 *  1. Arranca el receptor OTLP de prueba (imita a New Relic).
 *  2. Arranca el servidor con la telemetría (node -r telemetria.js) apuntando a ese receptor.
 *  3. Genera tráfico: juego, salud, métricas, 404, 405 y una ráfaga que dispara el limitador (429).
 *  4. Detiene el servidor (vacía la telemetría) y comprueba trazas, métricas y logs recibidos.
 * Uso: node observabilidad/newrelic/verificar.js      → guarda observabilidad/newrelic/verificacion-local.json
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');
const { crearReceptor } = require('./receptor-prueba');

const RAIZ = path.join(__dirname, '..', '..');
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const pedir = (base, ruta, metodo = 'GET') => new Promise((resolve) => {
  const req = http.request(base + ruta, { method: metodo, headers: { 'Accept-Encoding': 'gzip' } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
  req.on('error', () => resolve(0)); req.end();
});

async function verificar({ silencioso = false } = {}) {
  const receptor = crearReceptor();
  await new Promise((r) => receptor.listen(0, '127.0.0.1', r));
  const destino = `http://127.0.0.1:${receptor.address().port}`;
  const puerto = 20000 + Math.floor(Math.random() * 20000);
  const base = `http://127.0.0.1:${puerto}`;

  const servidor = spawn(process.execPath, ['-r', './observabilidad/newrelic/telemetria.js', 'servidor.js', String(puerto)], {
    cwd: RAIZ,
    env: { ...process.env, OTEL_EXPORTER_OTLP_ENDPOINT: destino, OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json', NEW_RELIC_LICENSE_KEY: 'clave-de-prueba-local',
      OTEL_METRIC_EXPORT_INTERVAL: '1500', LOGS: '0', RATE_LIMIT: '5', RATE_LIMIT_LOCAL: '1' },
    stdio: silencioso ? 'ignore' : ['ignore', 'ignore', 'inherit']
  });
  for (let i = 0; i < 50; i++) { if (await pedir(base, '/health') === 200) break; await esperar(100); }
  await esperar(1100); // recupera las fichas del limitador gastadas al comprobar el arranque

  const estados = {};
  const anotar = (e) => { estados[e] = (estados[e] || 0) + 1; };
  // Tráfico normal, respetando el límite de 5 peticiones/s por IP
  const plan = ['/', '/health', '/metrics', '/no-existe', ['/', 'POST']];
  for (let ronda = 0; ronda < 4; ronda++) {
    for (const p of plan) { const [ruta, metodo] = Array.isArray(p) ? p : [p, 'GET']; anotar(await pedir(base, ruta, metodo)); }
    await esperar(1100);
  }
  // Ráfaga para disparar el limitador anti-DoS
  for (let i = 0; i < 12; i++) anotar(await pedir(base, '/health'));
  await esperar(3500); // al menos dos exportaciones de métricas

  servidor.kill('SIGTERM');
  await new Promise((r) => servidor.on('exit', r));
  await esperar(300);
  const r = receptor.resumen();
  await new Promise((res) => receptor.close(res));

  const nombres = Object.keys(r.trazas.porNombre);
  const comprobaciones = {
    'llega la cabecera api-key (autenticación de New Relic)': r.clavePresente && r.rechazadasSinClave === 0,
    'service.name = cybershield': r.recurso['service.name'] === 'cybershield',
    'trazas con nombre por ruta (GET /, GET /health, POST /, GET otras…)': ['GET /', 'GET /health', 'POST /', 'GET otras'].every((n) => nombres.includes(n)),
    'cada traza lleva el X-Request-Id': r.trazas.spans > 0 && r.trazas.conRequestId === r.trazas.spans,
    'las 429 del limitador quedan como evento en la traza': r.trazas.eventos429 > 0,
    'métrica de duración por ruta y estado': !!r.metricas['cybershield.http.server.duration'],
    'métricas del event loop, memoria y peticiones en curso': ['cybershield.eventloop.lag', 'cybershield.memory.rss', 'cybershield.http.in_flight'].every((k) => r.metricas[k]),
    'métrica del limitador (rate_limited)': !!r.metricas['cybershield.http.rate_limited'],
    'métricas con temporalidad DELTA (recomendada por New Relic)': r.metricas['cybershield.http.server.duration'] && r.metricas['cybershield.http.server.duration'].temporalidad === 1,
    'logs recibidos (WARN para 404/405/429)': r.logs.total > 0 && (r.logs.porSeveridad.WARN || 0) > 0,
    'logs enlazados con su traza (logs in context)': r.logs.total > 0 && r.logs.enlazadosConTraza === r.logs.total
  };
  const resultado = { fecha: new Date().toISOString(), trafico: estados, comprobaciones, superadas: Object.values(comprobaciones).filter(Boolean).length, total: Object.keys(comprobaciones).length, recibido: r };
  return resultado;
}

module.exports = { verificar };

if (require.main === module) {
  verificar().then((res) => {
    fs.writeFileSync(path.join(__dirname, 'verificacion-local.json'), JSON.stringify(res, null, 2));
    console.log('\nVERIFICACIÓN LOCAL DE LA TELEMETRÍA (New Relic / OpenTelemetry)');
    console.log('Tráfico generado (código HTTP → veces):', JSON.stringify(res.trafico));
    for (const [k, v] of Object.entries(res.comprobaciones)) console.log(`  ${v ? '✔' : '✖'} ${k}`);
    console.log(`\n${res.superadas}/${res.total} comprobaciones superadas · spans: ${res.recibido.trazas.spans} · métricas: ${Object.keys(res.recibido.metricas).length} · logs: ${res.recibido.logs.total}`);
    console.log('Detalle: observabilidad/newrelic/verificacion-local.json');
    process.exit(res.superadas === res.total ? 0 : 1);
  }).catch((e) => { console.error(e); process.exit(1); });
}
