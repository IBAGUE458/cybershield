'use strict';
// Snyk Code (HttpToHttps/test) — falso positivo aceptado: las pruebas se conectan al servidor local de CyberShield en 127.0.0.1 (el tráfico no sale del equipo); el modo HTTPS se prueba aparte en 03-sistema
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./ayudantes');
const http = require('http');

// Prueban el sistema completo desplegado (servidor + navegador + almacenamiento + descarga).
describe('03 · Pruebas de sistema', () => {
  let env;
  before(async () => { env = await h.preparar(); });
  after(async () => env.cerrar());

  it('el servidor entrega la aplicación con cabeceras de seguridad', async () => {
    const res = await new Promise((r) => http.get(env.url, r));
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['content-type'], /text\/html/);
    assert.match(res.headers['content-security-policy'], /frame-ancestors 'none'/);
    res.resume();
  });

  it('observabilidad: /health, /metrics, X-Request-Id, Server-Timing y gzip', async () => {
    const get = (ruta, cab = {}) => new Promise((r) => http.get(env.url.replace(/\/$/, '') + ruta, { headers: cab }, (res) => {
      const partes = []; res.on('data', (d) => partes.push(d)); res.on('end', () => r({ res, cuerpo: Buffer.concat(partes) }));
    }));
    const salud = await get('/health');
    assert.equal(JSON.parse(salud.cuerpo).estado, 'ok');
    const juego = await get('/', { 'Accept-Encoding': 'gzip' });
    assert.equal(juego.res.headers['content-encoding'], 'gzip');
    assert.match(juego.res.headers['x-request-id'], /^[0-9a-f-]{36}$/);
    assert.match(juego.res.headers['server-timing'], /^app;dur=[\d.]+$/);
    assert.ok(require('zlib').gunzipSync(juego.cuerpo).toString().includes('CyberShieldCore'));
    const met = (await get('/metrics')).cuerpo.toString();
    assert.match(met, /http_requests_total\{method="GET",route="\/",status="200"\} \d+/);
    assert.match(met, /http_request_duration_seconds_bucket\{route="\/",le="\+Inf"\}/);
    assert.match(met, /nodejs_eventloop_lag_seconds/);
    assert.match(met, /route="\/health"/);
  });

  it('observabilidad: /metrics exige token si se configura y no crea etiquetas por cada ruta', async () => {
    const { iniciarServidor } = require('../servidor');
    const srv = await iniciarServidor(0, { token: 'secreto-prueba' });
    const base = 'http://127.0.0.1:' + srv.address().port;
    const estado = (ruta, cab = {}) => new Promise((r) => http.get(base + ruta, { headers: cab }, (res) => { res.resume(); res.on('end', () => r(res.statusCode)); }));
    assert.equal(await estado('/metrics'), 401);
    assert.equal(await estado('/metrics', { Authorization: 'Bearer incorrecto' }), 401);
    assert.equal(await estado('/metrics', { Authorization: 'Bearer secreto-prueba' }), 200);
    for (let i = 0; i < 20; i++) await estado('/aleatoria-' + i);
    const met = await new Promise((r) => http.get(base + '/metrics', { headers: { Authorization: 'Bearer secreto-prueba' } }, (res) => { let t = ''; res.on('data', (d) => { t += d; }); res.on('end', () => r(t)); }));
    assert.doesNotMatch(met, /aleatoria/);
    assert.match(met, /route="otras",status="404"\} 20/);
    await new Promise((r) => srv.close(r));
  });

  it('observabilidad: detecta un bloqueo del event loop y no da falsos positivos en reposo', async () => {
    const { iniciarServidor, resumen } = require('../servidor');
    const srv = await iniciarServidor(0);
    await new Promise((r) => setTimeout(r, 300));
    assert.ok(resumen(srv.metricas).lazoMaxMs < 50, 'en reposo el retardo debe ser bajo');
    const t = Date.now(); while (Date.now() - t < 200) { /* bloqueo intencionado */ }
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(resumen(srv.metricas).lazoMaxMs >= 150, 'debe detectar el bloqueo de 200 ms');
    await new Promise((r) => srv.close(r));
  });

  it('anti-DoS: el limitador responde 429 al superar la ráfaga y lo cuenta en /metrics', async () => {
    const { iniciarServidor } = require('../servidor');
    const srv = await iniciarServidor(0, { limite: 5, rafaga: 5, limitarLocal: true });
    const base = 'http://127.0.0.1:' + srv.address().port;
    const pedir = (ruta) => new Promise((r) => http.get(base + ruta, (res) => { let t = ''; res.on('data', (d) => { t += d; }); res.on('end', () => r({ estado: res.statusCode, cab: res.headers, t })); }));
    const estados = [];
    for (let i = 0; i < 8; i++) estados.push((await pedir('/health')).estado);
    assert.deepEqual(estados, [200, 200, 200, 200, 200, 429, 429, 429]);
    const r = await pedir('/health');
    assert.equal(r.cab['retry-after'], '1');
    await new Promise((res) => setTimeout(res, 1100));
    const met = await pedir('/metrics');
    assert.equal(met.estado, 200, 'tras 1 s se recuperan fichas');
    assert.match(met.t, /http_requests_rate_limited_total [4-9]/);
    await new Promise((res) => srv.close(res));
  });

  it('anti-DoS: las IP locales están exentas por defecto (las pruebas de carga salen de localhost)', async () => {
    const { iniciarServidor } = require('../servidor');
    const srv = await iniciarServidor(0, { limite: 2, rafaga: 2 });
    const base = 'http://127.0.0.1:' + srv.address().port;
    const estados = await Promise.all(Array.from({ length: 20 }, () => new Promise((r) => http.get(base + '/health', (res) => { res.resume(); res.on('end', () => r(res.statusCode)); }))));
    assert.ok(estados.every((e) => e === 200));
    await new Promise((res) => srv.close(res));
  });

  it('HTTPS: con certificado sirve el juego cifrado con TLS 1.2 o superior', async (t) => {
    const { execFileSync } = require('child_process');
    const os = require('os'); const path = require('path'); const fs = require('fs');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-tls-'));
    try {
      execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem'), '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore' });
    } catch (e) { t.skip('openssl no disponible para crear un certificado de prueba'); return; }
    const { iniciarServidor } = require('../servidor');
    const srv = await iniciarServidor(0, { tls: { cert: fs.readFileSync(path.join(dir, 'c.pem')), key: fs.readFileSync(path.join(dir, 'k.pem')) } });
    assert.equal(srv.cifrado, true);
    // Se VERIFICA el certificado: se confía solo en el certificado de prueba recién creado (ca), sin desactivar la validación.
    const ca = fs.readFileSync(path.join(dir, 'c.pem'));
    const r = await new Promise((res) => require('https').get({ host: '127.0.0.1', port: srv.address().port, path: '/', ca, headers: { 'Accept-Encoding': 'gzip' } }, (x) => {
      const proto = x.socket.getProtocol(); x.resume(); x.on('end', () => res({ estado: x.statusCode, proto, csp: x.headers['content-security-policy'] }));
    }));
    assert.equal(r.estado, 200);
    assert.match(r.proto, /^TLSv1\.[23]$/);
    assert.match(r.csp, /frame-ancestors 'none'/);
    await new Promise((res) => srv.close(res));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('progreso sobrevive a recargar y el informe se descarga', async () => {
    const { page, cerrar } = await h.nuevaPagina(env);
    await h.iniciarPartida(page, 'Laura Gómez');
    await h.jugarMision(page, 0);
    await page.reload();
    await page.waitForSelector('html[data-ready="true"]');
    assert.equal(await h.texto(page, '#hud-progress'), 'Misiones: 1/5');
    await page.click('#btn-nav-hub');
    await page.click('#btn-hub-report');
    const [descarga] = await Promise.all([page.waitForEvent('download'), page.click('#btn-download-report')]);
    assert.equal(descarga.suggestedFilename(), 'informe-cybershield-laura-gomez.txt');
    await cerrar();
  });
});
