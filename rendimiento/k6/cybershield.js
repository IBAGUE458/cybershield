/**
 * Pruebas de rendimiento de CyberShield con k6 (https://k6.io).
 *
 * Escenarios (elige con -e ESCENARIO=...):
 *   humo         1 usuario, 30 s                    → ¿funciona bajo carga mínima?
 *   carga        sube a 50 usuarios, mantiene 1 min → comportamiento con la carga esperada (una clase grande)
 *   estres       sube por escalones hasta 400       → ¿dónde empieza a degradarse?
 *   pico         salta de 10 a 500 en 10 s          → ¿aguanta una avalancha repentina (todos entran a la vez)?
 *   resistencia  30 usuarios durante 10 min         → ¿hay fugas de memoria o degradación con el tiempo? (soak)
 *   capacidad    llegada creciente hasta 3000 req/s → busca el punto de ruptura (se detiene si se incumplen umbrales)
 *   validacion   TODOS los usuarios que alcanzó "capacidad" (o -e USUARIOS=n) conectados a la vez durante 3 min
 *                → demuestra que el software aguanta esa cantidad de estudiantes simultáneos
 *
 * Además corre siempre en paralelo el escenario "auditor", que cubre el resto de rutas del servidor
 * (HEAD /, /observabilidad, POST → 405, ruta inexistente → 404) para tener cobertura completa de endpoints.
 *
 * En paralelo corre el escenario "observador", que consulta /metrics y /health como haría Prometheus.
 *
 * Ejemplo:  k6 run -e ESCENARIO=carga -e BASE_URL=http://127.0.0.1:8080 rendimiento/k6/cybershield.js
 */
import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://127.0.0.1:8080';
const ESCENARIO = __ENV.ESCENARIO || 'carga';
const TOKEN = __ENV.METRICS_TOKEN || '';
const USUARIOS = parseInt(__ENV.USUARIOS || '1251', 10);

// Métricas personalizadas
const tiempoJuego = new Trend('cs_tiempo_carga_juego', true);
const tiempoServidor = new Trend('cs_tiempo_servidor', true);   // leído de la cabecera Server-Timing
const cabecerasSeguridad = new Rate('cs_cabeceras_seguridad_ok');
const rutasOk = new Rate('cs_cobertura_rutas_ok');
const metricasOk = new Rate('cs_metricas_disponibles');
const partidas = new Counter('cs_partidas_iniciadas');

const ESCENARIOS = {
  humo: { executor: 'constant-vus', vus: 1, duration: '30s' },
  carga: { executor: 'ramping-vus', startVUs: 0, stages: [
    { duration: '30s', target: 50 }, { duration: '1m', target: 50 }, { duration: '20s', target: 0 }] },
  estres: { executor: 'ramping-vus', startVUs: 0, stages: [
    { duration: '30s', target: 100 }, { duration: '30s', target: 100 },
    { duration: '30s', target: 200 }, { duration: '30s', target: 200 },
    { duration: '30s', target: 400 }, { duration: '30s', target: 400 }, { duration: '30s', target: 0 }] },
  pico: { executor: 'ramping-vus', startVUs: 10, stages: [
    { duration: '10s', target: 10 }, { duration: '10s', target: 500 }, { duration: '30s', target: 500 },
    { duration: '10s', target: 10 }, { duration: '20s', target: 10 }] },
  resistencia: { executor: 'constant-vus', vus: 30, duration: __ENV.DURACION || '10m' },
  validacion: { executor: 'ramping-vus', startVUs: 0, stages: [
    { duration: '1m', target: USUARIOS }, { duration: '3m', target: USUARIOS }, { duration: '30s', target: 0 }] },
  capacidad: { executor: 'ramping-arrival-rate', startRate: 50, timeUnit: '1s', preAllocatedVUs: 200, maxVUs: 1500, stages: [
    { duration: '2m', target: 3000 }] }
};

export const options = {
  scenarios: {
    principal: { ...ESCENARIOS[ESCENARIO], exec: 'estudiante' },
    observador: { executor: 'constant-arrival-rate', rate: 1, timeUnit: '5s', duration: duracionTotal(ESCENARIOS[ESCENARIO]), preAllocatedVUs: 1, exec: 'observador' },
    auditor: { executor: 'constant-arrival-rate', rate: 1, timeUnit: '2s', duration: duracionTotal(ESCENARIOS[ESCENARIO]), preAllocatedVUs: 2, exec: 'auditor' }
  },
  thresholds: {
    http_req_failed: [{ threshold: 'rate<0.01', abortOnFail: ESCENARIO === 'capacidad' }],
    'http_req_duration{tipo:juego}': [{ threshold: 'p(95)<300', abortOnFail: ESCENARIO === 'capacidad', delayAbortEval: '10s' }, 'p(99)<800'],
    'http_req_duration{tipo:salud}': ['p(95)<100'],
    checks: ['rate>0.99'],
    cs_cabeceras_seguridad_ok: ['rate==1'],
    cs_metricas_disponibles: ['rate>0.95'],
    cs_cobertura_rutas_ok: ['rate==1']
  },
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)']
};

function duracionTotal(esc) {
  if (esc.duration) return esc.duration;
  const s = esc.stages.reduce((a, st) => a + parseInt(st.duration, 10) * (st.duration.endsWith('m') ? 60 : 1), 0);
  return s + 's';
}

/** Un estudiante: abre el juego, el navegador comprueba la salud y "juega" (tiempo de reflexión). */
export function estudiante() {
  group('01 Cargar el juego', () => {
    const r = http.get(`${BASE}/`, { headers: { 'Accept-Encoding': 'gzip, br' }, tags: { tipo: 'juego', name: 'GET /' } });
    tiempoJuego.add(r.timings.duration);
    const st = /dur=([\d.]+)/.exec(r.headers['Server-Timing'] || '');
    if (st) tiempoServidor.add(parseFloat(st[1]));
    check(r, {
      'estado 200': (x) => x.status === 200,
      'contiene el juego': (x) => typeof x.body === 'string' && x.body.includes('CyberShieldCore'),
      'llega comprimido (gzip)': (x) => x.headers['Content-Encoding'] === 'gzip',
      'tiene X-Request-Id (trazabilidad)': (x) => !!x.headers['X-Request-Id']
    });
    const seguro = (r.headers['Content-Security-Policy'] || '').includes("script-src 'sha256-") &&
      r.headers['X-Frame-Options'] === 'DENY' && r.headers['X-Content-Type-Options'] === 'nosniff';
    cabecerasSeguridad.add(seguro);
    partidas.add(1);
  });

  group('02 Comprobar salud', () => {
    const r = http.get(`${BASE}/health`, { tags: { tipo: 'salud', name: 'GET /health' } });
    check(r, { 'salud ok': (x) => x.status === 200 && x.json('estado') === 'ok' });
  });

  // Tiempo de reflexión: el estudiante lee y responde (1–3 s). En "capacidad" no hay pausa.
  if (ESCENARIO !== 'capacidad') sleep(1 + Math.random() * 2);
}

/** Simula a Prometheus/Grafana leyendo métricas mientras hay carga. */
export function observador() {
  const params = { tags: { tipo: 'observabilidad', name: 'GET /metrics' }, headers: TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {} };
  const r = http.get(`${BASE}/metrics`, params);
  // Se validan métricas que existen desde el arranque: el histograma de latencias no aparece
  // hasta que termina la primera petición, así que comprobarlo en el segundo 0 daría un falso negativo.
  metricasOk.add(r.status === 200 && ['# TYPE http_requests_total counter', 'http_requests_in_flight', 'process_resident_memory_bytes', 'nodejs_eventloop_lag_seconds']
    .every((m) => r.body.includes(m)));
}

/**
 * Cobertura de endpoints: recorre las rutas que no usa un estudiante normal y comprueba que
 * el servidor responde lo correcto también bajo carga (incluidos los casos de error esperados).
 * Los 404/405 se marcan como respuesta esperada para que no cuenten como fallo HTTP.
 */
const ESPERADO = http.expectedStatuses(200, 404, 405);
export function auditor() {
  const cab = TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {};
  const head = http.request('HEAD', `${BASE}/`, null, { tags: { tipo: 'cobertura', name: 'HEAD /' } });
  const panel = http.get(`${BASE}/observabilidad`, { headers: cab, tags: { tipo: 'cobertura', name: 'GET /observabilidad' } });
  const post = http.post(`${BASE}/`, 'x', { responseCallback: ESPERADO, tags: { tipo: 'cobertura', name: 'POST / (405)' } });
  const nf = http.get(`${BASE}/no-existe`, { responseCallback: ESPERADO, tags: { tipo: 'cobertura', name: 'GET /no-existe (404)' } });
  const ok = check(head, { 'HEAD / → 200 sin cuerpo': (r) => r.status === 200 && !r.body }) &
    check(panel, { 'GET /observabilidad → 200': (r) => r.status === 200 && r.body.includes('Panel de observabilidad') }) &
    check(post, { 'POST / → 405': (r) => r.status === 405 && r.headers['Allow'] === 'GET, HEAD' }) &
    check(nf, { 'GET /no-existe → 404': (r) => r.status === 404 });
  rutasOk.add(ok === 1);
}
