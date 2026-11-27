#!/usr/bin/env node
/**
 * Servidor de CyberShield con seguridad y OBSERVABILIDAD.
 *
 * Seguridad:
 *  - Solo sirve CyberShield.html (sin acceso a otros archivos => sin path traversal).
 *  - Solo GET/HEAD; el resto responde 405.
 *  - Cabeceras: CSP (con frame-ancestors), X-Frame-Options, nosniff, Referrer-Policy,
 *    Permissions-Policy, COOP/CORP y no-store.
 *  - /metrics y /observabilidad pueden protegerse con un token (variable METRICS_TOKEN).
 *
 * Observabilidad (los 3 pilares):
 *  - LOGS:     una línea JSON por petición (hora, id, método, ruta, estado, duración, bytes).
 *  - MÉTRICAS: GET /metrics en formato Prometheus (contadores, histograma de latencias,
 *              peticiones en curso, memoria, CPU, retardo del event loop).
 *  - TRAZAS:   cabecera X-Request-Id por petición y Server-Timing con el tiempo de servidor.
 *  - SALUD:    GET /health (JSON) y panel en vivo GET /observabilidad (HTML sin JavaScript).
 *
 * Rendimiento:
 *  - El HTML se guarda en memoria (y comprimido con gzip) y se recarga solo si cambia el archivo.
 *
 * Uso:  node servidor.js [puerto]
 * Variables: HOST (defecto 127.0.0.1), LOGS=0 para silenciar, LOG_FILE=ruta.jsonl, METRICS_TOKEN=secreto
 */
'use strict';
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { monitorEventLoopDelay } = require('perf_hooks');

const ARCHIVO = path.join(__dirname, 'CyberShield.html');
const VERSION = '1.1.0';
const RUTAS_JUEGO = new Set(['/', '/index.html', '/CyberShield.html']);
const RESOLUCION_LAZO_MS = 10; // monitorEventLoopDelay incluye su propia resolución en cada muestra: se resta
const BUCKETS = [0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5];

/* ======================= CACHÉ DEL HTML ======================= */
const cache = { mtimeMs: -1, html: null, gzip: null, cabeceras: null, etiqueta: '' };

function cabecerasSeguridad(html) {
  const meta = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/);
  const csp = (meta ? meta[1] : "default-src 'none'") + "; frame-ancestors 'none'";
  return {
    'Content-Security-Policy': csp,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Cache-Control': 'no-store'
  };
}

/** Lee el HTML del disco y lo deja en memoria (normal y comprimido). Se llama al arrancar y cuando cambia el archivo. */
function cargarHtml() {
  try {
    const html = fs.readFileSync(ARCHIVO);
    cache.html = html;
    cache.gzip = zlib.gzipSync(html, { level: 9 });
    cache.cabeceras = cabecerasSeguridad(html.toString('utf8'));
  } catch (e) {
    cache.html = null;
  }
}
cargarHtml();
// Recarga automática si se reconstruye CyberShield.html. Se vigila FUERA del manejador de peticiones:
// ninguna petición toca el disco (evita que un atacante provoque operaciones costosas de E/S).
const vigilante = fs.watchFile(ARCHIVO, { interval: 1000 }, (actual, previo) => { if (actual.mtimeMs !== previo.mtimeMs) cargarHtml(); });
if (vigilante && typeof vigilante.unref === 'function') vigilante.unref();

function obtenerHtml() {
  if (!cache.html) throw new Error('CyberShield.html no disponible');
  return cache;
}

/* ======================= LIMITADOR DE PETICIONES (anti-DoS) ======================= */
const LOCALES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
/**
 * Limitador por IP con "cubeta de fichas" (token bucket): cada IP recibe `limite` fichas por segundo y puede
 * acumular hasta `rafaga`. Si se queda sin fichas, recibe 429 Too Many Requests.
 * Las IP locales están exentas por defecto (el servidor escucha en localhost y las pruebas de carga salen de ahí).
 */
function crearLimitador({ limite, rafaga, limitarLocal }) {
  const cubetas = new Map();
  const limpieza = setInterval(() => {
    const ahora = Date.now();
    for (const [ip, c] of cubetas) if (ahora - c.ultimo > 60000) cubetas.delete(ip);
  }, 30000);
  limpieza.unref();
  return {
    permitir(ip) {
      if (!limite || (!limitarLocal && LOCALES.has(ip))) return true;
      const ahora = Date.now();
      let c = cubetas.get(ip);
      if (!c) {
        if (cubetas.size >= 50000) return false; // protege la memoria ante miles de IP distintas
        c = { fichas: rafaga, ultimo: ahora };
        cubetas.set(ip, c);
      }
      c.fichas = Math.min(rafaga, c.fichas + ((ahora - c.ultimo) / 1000) * limite);
      c.ultimo = ahora;
      if (c.fichas < 1) return false;
      c.fichas -= 1;
      return true;
    },
    cerrar() { clearInterval(limpieza); cubetas.clear(); }
  };
}

/* ======================= MÉTRICAS ======================= */
function crearMetricas() {
  const m = {
    inicio: Date.now(),
    enCurso: 0,
    limitadas: 0,
    total: new Map(),        // "metodo|ruta|estado" -> n
    histograma: new Map(),   // ruta -> { buckets: [], suma, cuenta }
    bytes: 0,
    recientes: [],           // últimas 2000 duraciones (ms) para percentiles del panel
    porSegundo: new Map(),   // segundo -> peticiones (ventana de 60 s)
    lazo: monitorEventLoopDelay({ resolution: RESOLUCION_LAZO_MS })
  };
  m.lazo.enable();
  return m;
}

function normalizarRuta(ruta) {
  if (RUTAS_JUEGO.has(ruta)) return '/';
  if (ruta === '/health' || ruta === '/metrics' || ruta === '/observabilidad') return ruta;
  return 'otras'; // evita explosión de cardinalidad con rutas arbitrarias
}

function registrar(m, metodo, ruta, estado, segundos, bytes) {
  const clave = metodo + '|' + ruta + '|' + estado;
  m.total.set(clave, (m.total.get(clave) || 0) + 1);
  let h = m.histograma.get(ruta);
  if (!h) { h = { buckets: BUCKETS.map(() => 0), suma: 0, cuenta: 0 }; m.histograma.set(ruta, h); }
  BUCKETS.forEach((b, i) => { if (segundos <= b) h.buckets[i] += 1; });
  h.suma += segundos; h.cuenta += 1;
  m.bytes += bytes;
  m.recientes.push(segundos * 1000);
  if (m.recientes.length > 2000) m.recientes.splice(0, m.recientes.length - 2000);
  const s = Math.floor(Date.now() / 1000);
  m.porSegundo.set(s, (m.porSegundo.get(s) || 0) + 1);
  for (const k of m.porSegundo.keys()) if (k < s - 60) m.porSegundo.delete(k);
}

/** Retardo real del event loop en ms (sin la resolución del temporizador de muestreo). */
function lazoMs(h, campo) {
  const v = h[campo];
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.max(0, v / 1e6 - RESOLUCION_LAZO_MS);
}

function percentil(lista, p) {
  if (!lista.length) return 0;
  const o = lista.slice().sort((a, b) => a - b);
  return o[Math.min(o.length - 1, Math.ceil((p / 100) * o.length) - 1)];
}

function resumen(m) {
  let total = 0, e4 = 0, e5 = 0;
  for (const [k, v] of m.total) {
    total += v;
    const est = Number(k.split('|')[2]);
    if (est >= 400 && est < 500) e4 += v;
    if (est >= 500) e5 += v;
  }
  const ahora = Math.floor(Date.now() / 1000);
  let ult60 = 0;
  for (const [k, v] of m.porSegundo) if (k >= ahora - 60 && k < ahora) ult60 += v;
  const mem = process.memoryUsage();
  return {
    total, errores4xx: e4, errores5xx: e5, enCurso: m.enCurso,
    rps: +(ult60 / 60).toFixed(2),
    p50: +percentil(m.recientes, 50).toFixed(2), p95: +percentil(m.recientes, 95).toFixed(2), p99: +percentil(m.recientes, 99).toFixed(2),
    memoriaMB: +(mem.rss / 1048576).toFixed(1), heapMB: +(mem.heapUsed / 1048576).toFixed(1),
    lazoMs: +lazoMs(m.lazo, 'mean').toFixed(2), lazoMaxMs: +lazoMs(m.lazo, 'max').toFixed(2),
    uptimeS: Math.round((Date.now() - m.inicio) / 1000)
  };
}

function textoPrometheus(m) {
  const l = [];
  const mem = process.memoryUsage();
  const cpu = process.cpuUsage();
  l.push('# HELP cybershield_info Información de la aplicación.', '# TYPE cybershield_info gauge', `cybershield_info{version="${VERSION}"} 1`);
  l.push('# HELP http_requests_total Peticiones HTTP atendidas.', '# TYPE http_requests_total counter');
  for (const [k, v] of m.total) {
    const [metodo, ruta, estado] = k.split('|');
    l.push(`http_requests_total{method="${metodo}",route="${ruta}",status="${estado}"} ${v}`);
  }
  l.push('# HELP http_request_duration_seconds Duración de las peticiones HTTP.', '# TYPE http_request_duration_seconds histogram');
  for (const [ruta, h] of m.histograma) {
    BUCKETS.forEach((b, i) => l.push(`http_request_duration_seconds_bucket{route="${ruta}",le="${b}"} ${h.buckets[i]}`));
    l.push(`http_request_duration_seconds_bucket{route="${ruta}",le="+Inf"} ${h.cuenta}`);
    l.push(`http_request_duration_seconds_sum{route="${ruta}"} ${h.suma.toFixed(6)}`);
    l.push(`http_request_duration_seconds_count{route="${ruta}"} ${h.cuenta}`);
  }
  l.push('# HELP http_requests_in_flight Peticiones en curso.', '# TYPE http_requests_in_flight gauge', `http_requests_in_flight ${m.enCurso}`);
  l.push('# HELP http_requests_rate_limited_total Peticiones rechazadas por el limitador (429).', '# TYPE http_requests_rate_limited_total counter', `http_requests_rate_limited_total ${m.limitadas}`);
  l.push('# HELP http_response_bytes_total Bytes enviados en respuestas.', '# TYPE http_response_bytes_total counter', `http_response_bytes_total ${m.bytes}`);
  l.push('# HELP process_resident_memory_bytes Memoria residente.', '# TYPE process_resident_memory_bytes gauge', `process_resident_memory_bytes ${mem.rss}`);
  l.push('# HELP nodejs_heap_used_bytes Heap de V8 usado.', '# TYPE nodejs_heap_used_bytes gauge', `nodejs_heap_used_bytes ${mem.heapUsed}`);
  l.push('# HELP process_cpu_seconds_total CPU consumida.', '# TYPE process_cpu_seconds_total counter', `process_cpu_seconds_total ${((cpu.user + cpu.system) / 1e6).toFixed(3)}`);
  l.push('# HELP nodejs_eventloop_lag_seconds Retardo medio del event loop.', '# TYPE nodejs_eventloop_lag_seconds gauge', `nodejs_eventloop_lag_seconds ${(lazoMs(m.lazo, 'mean') / 1000).toFixed(6)}`);
  l.push('# HELP nodejs_eventloop_lag_max_seconds Retardo máximo del event loop.', '# TYPE nodejs_eventloop_lag_max_seconds gauge', `nodejs_eventloop_lag_max_seconds ${(lazoMs(m.lazo, 'max') / 1000).toFixed(6)}`);
  l.push('# HELP process_uptime_seconds Tiempo encendido.', '# TYPE process_uptime_seconds gauge', `process_uptime_seconds ${((Date.now() - m.inicio) / 1000).toFixed(0)}`);
  return l.join('\n') + '\n';
}

function panelHtml(m) {
  const r = resumen(m);
  const fila = (k, v) => `<tr><th>${k}</th><td>${v}</td></tr>`;
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="refresh" content="2"><title>CyberShield — Observabilidad</title>
<style>body{margin:0;background:#070b14;color:#e8eefc;font:15px/1.5 system-ui,sans-serif}main{max-width:860px;margin:0 auto;padding:24px 16px}
h1{font-size:1.5rem}.g{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:16px 0}
.k{background:#111a2e;border:1px solid #1f2c47;border-radius:12px;padding:14px}.k small{color:#8492b0;display:block}.k b{font:600 1.4rem ui-monospace,monospace}
table{width:100%;border-collapse:collapse;background:#111a2e}th,td{border:1px solid #1f2c47;padding:8px;text-align:left}th{color:#22d3ee;font-weight:600}p{color:#8492b0}</style></head>
<body><main><h1>Panel de observabilidad · CyberShield ${VERSION}</h1><p>Se actualiza cada 2 s. Métricas en bruto: <code>/metrics</code> · Salud: <code>/health</code></p>
<div class="g"><div class="k"><small>Peticiones/s (60 s)</small><b>${r.rps}</b></div><div class="k"><small>Latencia p95</small><b>${r.p95} ms</b></div>
<div class="k"><small>Errores 5xx</small><b>${r.errores5xx}</b></div><div class="k"><small>En curso</small><b>${r.enCurso}</b></div></div>
<table>${fila('Peticiones totales', r.total)}${fila('Latencia p50 / p95 / p99 (últimas 2000)', `${r.p50} / ${r.p95} / ${r.p99} ms`)}
${fila('Errores 4xx', r.errores4xx)}${fila('Errores 5xx', r.errores5xx)}${fila('Memoria residente / heap', `${r.memoriaMB} MB / ${r.heapMB} MB`)}
${fila('Retardo del event loop (medio / máx.)', `${r.lazoMs} ms / ${r.lazoMaxMs} ms`)}${fila('Tiempo encendido', `${r.uptimeS} s`)}</table></main></body></html>`;
}

/* ======================= SERVIDOR ======================= */
function crearServidor(opciones = {}) {
  const logs = opciones.logs === true;
  const token = opciones.token !== undefined ? opciones.token : process.env.METRICS_TOKEN || '';
  const flujoLog = opciones.logFile ? fs.createWriteStream(opciones.logFile, { flags: 'a' }) : null;
  const m = crearMetricas();
  const limite = opciones.limite !== undefined ? Number(opciones.limite) : Number(process.env.RATE_LIMIT || 30);
  const limitador = crearLimitador({
    limite,
    rafaga: opciones.rafaga !== undefined ? Number(opciones.rafaga) : Math.max(1, limite * 2),
    limitarLocal: opciones.limitarLocal !== undefined ? opciones.limitarLocal === true : process.env.RATE_LIMIT_LOCAL === '1'
  });

  function log(obj) {
    if (!logs && !flujoLog) return;
    const linea = JSON.stringify(obj);
    if (logs) process.stdout.write(linea + '\n');
    if (flujoLog) flujoLog.write(linea + '\n');
  }

  function autorizado(req) {
    if (!token) return true;
    const dado = Buffer.from(String(req.headers.authorization || ''));
    const esperado = Buffer.from('Bearer ' + token);
    return dado.length === esperado.length && crypto.timingSafeEqual(dado, esperado);
  }

  const manejador = (req, res) => {
    const t0 = process.hrtime.bigint();
    const id = crypto.randomUUID();
    const ruta = (req.url || '/').split('?')[0];
    const rutaMetrica = normalizarRuta(ruta);
    m.enCurso += 1;
    let bytes = 0;

    function responder(estado, cabeceras, cuerpo) {
      const dur = Number(process.hrtime.bigint() - t0) / 1e6;
      const buf = cuerpo === undefined || req.method === 'HEAD' ? null : (Buffer.isBuffer(cuerpo) ? cuerpo : Buffer.from(cuerpo));
      bytes = buf ? buf.length : 0;
      res.writeHead(estado, { ...cabeceras, 'X-Request-Id': id, 'Server-Timing': `app;dur=${dur.toFixed(2)}` });
      res.end(buf || undefined);
    }

    res.on('finish', () => {
      m.enCurso -= 1;
      const seg = Number(process.hrtime.bigint() - t0) / 1e9;
      registrar(m, req.method, rutaMetrica, res.statusCode, seg, bytes);
      log({ ts: new Date().toISOString(), nivel: res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'aviso' : 'info', id, metodo: req.method, ruta: rutaMetrica, estado: res.statusCode, ms: +(seg * 1000).toFixed(2), bytes });
    });

    if (!limitador.permitir(req.socket.remoteAddress)) {
      m.limitadas += 1;
      return responder(429, { 'Retry-After': '1', 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }, 'Demasiadas peticiones. Inténtalo de nuevo en un momento.');
    }

    let c;
    try { c = obtenerHtml(); } catch (e) {
      log({ ts: new Date().toISOString(), nivel: 'error', id, mensaje: 'No se pudo leer CyberShield.html' });
      return responder(500, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Error interno');
    }
    const base = c.cabeceras;

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return responder(405, { ...base, Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' }, 'Método no permitido');
    }
    if (ruta === '/health') {
      return responder(200, { ...base, 'Content-Type': 'application/json; charset=utf-8' },
        JSON.stringify({ estado: 'ok', version: VERSION, uptimeS: Math.round((Date.now() - m.inicio) / 1000) }));
    }
    if (ruta === '/metrics' || ruta === '/observabilidad') {
      if (!autorizado(req)) return responder(401, { ...base, 'WWW-Authenticate': 'Bearer', 'Content-Type': 'text/plain; charset=utf-8' }, 'No autorizado');
      if (ruta === '/metrics') return responder(200, { ...base, 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' }, textoPrometheus(m));
      return responder(200, { ...base, 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'", 'Content-Type': 'text/html; charset=utf-8' }, panelHtml(m));
    }
    if (!RUTAS_JUEGO.has(ruta)) {
      return responder(404, { ...base, 'Content-Type': 'text/plain; charset=utf-8' }, 'No encontrado');
    }
    const gzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''));
    return responder(200, { ...base, 'Content-Type': 'text/html; charset=utf-8', Vary: 'Accept-Encoding', ...(gzip ? { 'Content-Encoding': 'gzip' } : {}) },
      gzip ? c.gzip : c.html);
  };

  // HTTPS si se proporcionan certificado y clave (opciones.tls o variables TLS_CERT / TLS_KEY con las rutas).
  const tls = opciones.tls || (process.env.TLS_CERT && process.env.TLS_KEY
    ? { cert: fs.readFileSync(process.env.TLS_CERT), key: fs.readFileSync(process.env.TLS_KEY) } : null);
  let srv;
  if (tls) {
    srv = https.createServer({ cert: tls.cert, key: tls.key, minVersion: 'TLSv1.2' }, manejador);
  } else {
    // Sin certificado: HTTP solo para uso LOCAL (por defecto escucha en 127.0.0.1, el tráfico no sale del equipo).
    // En producción debe usarse TLS_CERT/TLS_KEY o un proxy inverso con HTTPS delante.
    // Snyk Code (HttpToHttps) — riesgo aceptado: modo local sin TLS (127.0.0.1); con TLS_CERT y TLS_KEY se usa https.createServer
    srv = http.createServer(manejador);
  }
  srv.metricas = m;
  srv.cifrado = Boolean(tls);
  srv.on('close', () => { m.lazo.disable(); limitador.cerrar(); if (flujoLog) flujoLog.end(); });
  return srv;
}

function iniciarServidor(puerto = 8080, opciones = {}) {
  return new Promise((resolve) => {
    const srv = crearServidor(opciones);
    srv.listen(puerto, opciones.host || '127.0.0.1', () => resolve(srv));
  });
}

module.exports = { iniciarServidor, crearServidor, resumen, textoPrometheus };

if (require.main === module) {
  const puerto = Number(process.argv[2]) || 8080;
  const host = process.env.HOST || '127.0.0.1';
  iniciarServidor(puerto, { host, logs: process.env.LOGS !== '0', logFile: process.env.LOG_FILE }).then(() => {
    const esquema = process.env.TLS_CERT && process.env.TLS_KEY ? 'https' : 'http';
    console.error(`CyberShield en ${esquema}://${host}:${puerto}/  ·  métricas: /metrics  ·  panel: /observabilidad  ·  salud: /health`);
    if (host !== '127.0.0.1' && !process.env.METRICS_TOKEN) console.error('AVISO: el servidor escucha fuera de localhost y /metrics no tiene token (define METRICS_TOKEN).');
  });
}
