'use strict';
// Snyk Code (HttpToHttps/test) — falso positivo aceptado: las pruebas se conectan al servidor local de CyberShield en 127.0.0.1 (el tráfico no sale del equipo); el modo HTTPS se prueba aparte en 03-sistema
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./ayudantes');
const fs = require('fs');
const http = require('http');
const csp = require('../herramientas/actualizar-csp');

const html = fs.readFileSync(csp.ARCHIVO, 'utf8');
const script = csp.extraerScript(html);

function pedir(url, metodo = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: metodo }, (res) => { res.resume(); res.on('end', () => resolve(res)); });
    req.on('error', reject); req.end();
  });
}

// Controles de seguridad del código, del navegador y del servidor.
describe('15 · Pruebas de seguridad', () => {
  let env;
  before(async () => { env = await h.preparar(); });
  after(async () => env.cerrar());

  it('la CSP existe, es restrictiva y su hash coincide con el script', () => {
    assert.match(html, /http-equiv="Content-Security-Policy"/);
    assert.match(html, /default-src 'none'/);
    assert.match(html, /object-src 'none'/);
    assert.match(html, /base-uri 'none'/);
    assert.doesNotMatch(html, /script-src[^;]*'unsafe-inline'/);
    assert.equal(csp.hashActual(html), csp.calcularHash(script));
  });
  it('CyberShield.html está construido a partir de src/ (no hay cambios sin construir)', () => {
    const { construir } = require('../herramientas/construir');
    assert.equal(html, construir().html, 'Ejecuta "npm run construir" después de modificar src/');
  });
  it('Snyk Code puede analizar el 100 % del JavaScript (nada incrustado solo en HTML)', () => {
    const r = require('../herramientas/cobertura-snyk').analizar();
    assert.equal(r.jsParcial, 0, 'hay JavaScript que solo existe dentro de un HTML');
    assert.equal(r.pctJS, 100);
    assert.ok(r.filas.some((f) => f.rel === 'src/cybershield.js' && f.estado === 'analizado'));
  });
  it('el código no usa sumideros peligrosos (innerHTML, eval, document.write, new Function)', () => {
    const codigo = fs.readFileSync(require('path').join(__dirname, '..', 'src', 'cybershield.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const patron of [/\.innerHTML\s*=/, /\.outerHTML\s*=/, /insertAdjacentHTML/, /\beval\s*\(/, /document\.write/, /new Function/, /setTimeout\(\s*['"]/]) {
      assert.doesNotMatch(codigo, patron, patron.toString());
    }
    assert.match(codigo, /'use strict'/);
  });
  it('la contraseña escrita en el simulador NUNCA se guarda', async () => {
    const { page, cerrar } = await h.nuevaPagina(env);
    await h.iniciarPartida(page);
    await page.click('#btn-toggle-sandbox');
    await page.click('#door-1');
    await page.click('#level-tab-1');
    await page.fill('#pwd-input', 'SecretoUnico-99!xyz');
    await page.click('#btn-submit-challenge');
    const todo = await page.evaluate(() => JSON.stringify(localStorage) + JSON.stringify(sessionStorage) + document.cookie);
    assert.doesNotMatch(todo, /SecretoUnico/);
    assert.equal(await page.getAttribute('#pwd-input', 'autocomplete'), 'off');
    await cerrar();
  });
  it('la API pública es inmutable', async () => {
    const { page, cerrar } = await h.nuevaPagina(env);
    const r = await page.evaluate(() => {
      const c = window.CyberShieldCore;
      try { window.CyberShieldCore = {}; } catch (e) {}
      try { c.computeGrade = () => ({ letter: 'A' }); } catch (e) {}
      try { c.MISSIONS[0].levels[0].variants[0].correct = 3; } catch (e) {}
      try { c.MISSIONS[0].levels[0].variants.push({}); } catch (e) {}
      return { mismo: window.CyberShieldCore === c, grado: c.computeGrade(0).letter, correcta: c.MISSIONS[0].levels[0].variants[0].correct + c.MISSIONS[0].levels[0].variants.length };
    });
    assert.deepEqual(r, { mismo: true, grado: 'F', correcta: 3 });
    await cerrar();
  });
  it('el servidor envía cabeceras de seguridad', async () => {
    const res = await pedir(env.url);
    assert.equal(res.headers['x-frame-options'], 'DENY');
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['referrer-policy'], 'no-referrer');
    assert.match(res.headers['permissions-policy'], /camera=\(\)/);
  });
  it('el servidor rechaza métodos no permitidos y path traversal', async () => {
    assert.equal((await pedir(env.url, 'POST')).statusCode, 405);
    assert.equal((await pedir(env.url, 'DELETE')).statusCode, 405);
    assert.equal((await pedir(env.url + '../servidor.js')).statusCode, 404);
    assert.equal((await pedir(env.url + '%2e%2e/package.json')).statusCode, 404);
  });
});
