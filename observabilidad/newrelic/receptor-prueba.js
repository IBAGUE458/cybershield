'use strict';
/**
 * Receptor OTLP de PRUEBA (imita a New Relic en tu equipo, sin enviar nada a Internet).
 * Acepta POST /v1/traces, /v1/metrics y /v1/logs en formato OTLP/HTTP JSON, exige la cabecera "api-key"
 * (igual que New Relic) y resume lo recibido en GET /resumen.
 *
 * Uso: node observabilidad/newrelic/receptor-prueba.js [puerto]   (por defecto 4318)
 */
const http = require('http');

function valor(v) {
  if (!v) return undefined;
  if ('stringValue' in v) return v.stringValue;
  if ('intValue' in v) return Number(v.intValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('boolValue' in v) return v.boolValue;
  return undefined;
}
const atributos = (lista = []) => Object.fromEntries(lista.map((a) => [a.key, valor(a.value)]));

function crearReceptor() {
  const datos = { peticiones: 0, sinClave: 0, clavesRecibidas: new Set(), recursos: {}, spans: [], metricas: new Map(), logs: [] };

  function procesar(senal, cuerpo) {
    if (senal === 'traces') {
      for (const rs of cuerpo.resourceSpans || []) {
        Object.assign(datos.recursos, atributos(rs.resource && rs.resource.attributes));
        for (const ss of rs.scopeSpans || []) for (const sp of ss.spans || []) {
          datos.spans.push({ nombre: sp.name, traceId: sp.traceId, spanId: sp.spanId, tipo: sp.kind, atributos: atributos(sp.attributes), inicio: Number(sp.startTimeUnixNano) / 1e6,
            ms: (Number(sp.endTimeUnixNano) - Number(sp.startTimeUnixNano)) / 1e6, eventos: (sp.events || []).map((e) => e.name) });
        }
      }
    } else if (senal === 'metrics') {
      for (const rm of cuerpo.resourceMetrics || []) for (const sm of rm.scopeMetrics || []) for (const mt of sm.metrics || []) {
        const tipo = ['gauge', 'sum', 'histogram', 'exponentialHistogram'].find((t) => mt[t]) || '?';
        const puntos = (mt[tipo] && mt[tipo].dataPoints) || [];
        const previo = datos.metricas.get(mt.name) || { tipo, unidad: mt.unit, exportaciones: 0, puntos: 0, temporalidad: mt[tipo] && mt[tipo].aggregationTemporality, ultimo: null, rutas: new Set() };
        previo.exportaciones += 1; previo.puntos += puntos.length;
        for (const p of puntos) {
          const a = atributos(p.attributes);
          if (a['http.route']) previo.rutas.add(`${a['http.request.method'] || ''} ${a['http.route']} ${a['http.response.status_code'] || ''}`.trim());
          previo.ultimo = p.asDouble ?? (p.asInt !== undefined ? Number(p.asInt) : (p.count !== undefined ? `count=${p.count}` : null));
        }
        datos.metricas.set(mt.name, previo);
      }
    } else if (senal === 'logs') {
      for (const rl of cuerpo.resourceLogs || []) for (const sl of rl.scopeLogs || []) for (const lr of sl.logRecords || []) {
        datos.logs.push({ severidad: lr.severityText, cuerpo: valor(lr.body), traceId: lr.traceId, spanId: lr.spanId, atributos: atributos(lr.attributes) });
      }
    }
  }

  const pct = (lista, p) => { if (!lista.length) return 0; const o = lista.slice().sort((a, b) => a - b); return o[Math.min(o.length - 1, Math.ceil((p / 100) * o.length) - 1)]; };

  /** Estadísticas por ruta y serie temporal (por segundo) calculadas a partir de las trazas recibidas. */
  function analisis() {
    const porRuta = {};
    for (const sp of datos.spans) {
      const r = porRuta[sp.nombre] || (porRuta[sp.nombre] = { duraciones: [], estados: {} });
      r.duraciones.push(sp.ms);
      const est = sp.atributos['http.response.status_code'] ?? sp.atributos['http.status_code'];
      if (est !== undefined) r.estados[est] = (r.estados[est] || 0) + 1;
    }
    const rutas = Object.fromEntries(Object.entries(porRuta).map(([k, v]) => [k, {
      peticiones: v.duraciones.length, media: v.duraciones.reduce((a, b) => a + b, 0) / v.duraciones.length,
      p50: pct(v.duraciones, 50), p95: pct(v.duraciones, 95), p99: pct(v.duraciones, 99), max: Math.max(...v.duraciones), estados: v.estados }]));
    const inicio = datos.spans.length ? Math.min(...datos.spans.map((x) => x.inicio)) : 0;
    const seg = new Map();
    for (const sp of datos.spans) {
      const t = Math.floor((sp.inicio - inicio) / 1000);
      const b = seg.get(t) || { t, peticiones: 0, duraciones: [] };
      b.peticiones += 1; b.duraciones.push(sp.ms); seg.set(t, b);
    }
    const ultimo = seg.size ? Math.max(...seg.keys()) : -1;
    const serie = [];
    for (let t = 0; t <= ultimo; t++) { const b = seg.get(t); serie.push({ t, peticiones: b ? b.peticiones : 0, p95: b ? pct(b.duraciones, 95) : 0 }); }
    const todas = datos.spans.map((x) => x.ms);
    return { rutas, serie, global: { peticiones: todas.length, media: todas.length ? todas.reduce((a, b) => a + b, 0) / todas.length : 0, p50: pct(todas, 50), p95: pct(todas, 95), p99: pct(todas, 99), max: todas.length ? Math.max(...todas) : 0 },
      trazaMasLenta: datos.spans.slice().sort((a, b) => b.ms - a.ms)[0] || null,
      logEnlazado: (() => { const l = datos.logs.find((x) => x.severidad === 'WARN') || datos.logs[0]; if (!l) return null; const s2 = datos.spans.find((x) => x.traceId === l.traceId); return { log: l, traza: s2 ? { nombre: s2.nombre, traceId: s2.traceId, ms: s2.ms, requestId: s2.atributos['cybershield.request_id'] } : null }; })() };
  }

  function resumen() {
    const porNombre = {};
    for (const s of datos.spans) porNombre[s.nombre] = (porNombre[s.nombre] || 0) + 1;
    const trazas = new Set(datos.spans.map((s) => s.traceId));
    const enlazados = datos.logs.filter((l) => l.traceId && trazas.has(l.traceId)).length;
    return {
      peticionesOtlp: datos.peticiones, rechazadasSinClave: datos.sinClave, clavePresente: datos.clavesRecibidas.size > 0,
      recurso: datos.recursos,
      trazas: { spans: datos.spans.length, porNombre, ejemplo: datos.spans.find((s) => s.nombre === 'GET /') || datos.spans[0] || null,
        conRequestId: datos.spans.filter((s) => s.atributos['cybershield.request_id']).length, eventos429: datos.spans.filter((s) => s.eventos.length).length },
      metricas: Object.fromEntries([...datos.metricas].map(([k, v]) => [k, { tipo: v.tipo, unidad: v.unidad, exportaciones: v.exportaciones, temporalidad: v.temporalidad, ultimo: v.ultimo, rutas: [...v.rutas].slice(0, 12) }])),
      logs: { total: datos.logs.length, porSeveridad: datos.logs.reduce((a, l) => { a[l.severidad] = (a[l.severidad] || 0) + 1; return a; }, {}),
        enlazadosConTraza: enlazados, ejemplo: datos.logs[0] || null },
      analisis: analisis()
    };
  }

  const srv = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/resumen') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(resumen(), null, 2));
    }
    const m = req.method === 'POST' && (req.url || '').match(/^\/v1\/(traces|metrics|logs)$/);
    if (!m) { res.writeHead(404); return res.end(); }
    const clave = req.headers['api-key'];
    if (!clave) { datos.sinClave += 1; res.writeHead(403); return res.end('{"error":"falta api-key"}'); }
    datos.clavesRecibidas.add(String(clave).length);
    const partes = [];
    req.on('data', (d) => partes.push(d));
    req.on('end', () => {
      datos.peticiones += 1;
      try { procesar(m[1], JSON.parse(Buffer.concat(partes).toString('utf8') || '{}')); } catch (e) { /* cuerpo no JSON */ }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
  });
  srv.resumen = resumen;
  return srv;
}

module.exports = { crearReceptor };

if (require.main === module) {
  const puerto = Number(process.argv[2]) || 4318;
  crearReceptor().listen(puerto, '127.0.0.1', () => console.log(`Receptor OTLP de prueba en http://127.0.0.1:${puerto} (resumen: /resumen)`));
}
