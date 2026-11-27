'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./ayudantes');

// Capacidad de recuperarse ante datos corruptos, almacenamiento caído, recargas y tiempo agotado.
describe('22 · Pruebas de recuperación', () => {
  let env;
  before(async () => { env = await h.preparar(); });
  after(async () => env.cerrar());

  for (const corrupto of ['{no es json', 'null', '[]', '"texto"', '{"missions":"x","history":7}']) {
    it('arranca limpio con localStorage corrupto: ' + corrupto, async () => {
      const { page, errores, cerrar } = await h.nuevaPagina(env, { antes: h.sembrarEstado(corrupto) });
      assert.equal(await h.texto(page, '#hud-score'), 'Puntos: 0/500');
      assert.deepEqual(errores, []);
      await cerrar();
    });
  }

  it('funciona aunque localStorage lance excepciones (modo privado / bloqueado)', async () => {
    const roto = { fn: () => {
      const err = () => { throw new DOMException('bloqueado', 'SecurityError'); };
      Storage.prototype.getItem = err; Storage.prototype.setItem = err; Storage.prototype.removeItem = err;
    } };
    const { page, errores, cerrar } = await h.nuevaPagina(env, { antes: roto });
    await h.iniciarPartida(page);
    await h.jugarMision(page, 0);
    assert.equal(await h.texto(page, '#hud-score'), 'Puntos: 100/500');
    assert.deepEqual(errores, []);
    await cerrar();
  });

  it('recargar a mitad de misión conserva los niveles superados', async () => {
    const { page, cerrar } = await h.nuevaPagina(env);
    await h.iniciarPartida(page);
    await page.click('#door-0');
    await h.resolver(page, true);
    await page.reload();
    await page.waitForSelector('html[data-ready="true"]');
    await page.click('#btn-start-game');
    await page.click('#door-0');
    assert.equal(await page.getAttribute('#level-tab-1', 'aria-current'), 'step', 'retoma en el nivel pendiente');
    await cerrar();
  });

  it('tras agotarse el tiempo se puede reintentar con el cronómetro reiniciado', async () => {
    const { page, cerrar } = await h.nuevaPagina(env, { reloj: true });
    await h.iniciarPartida(page);
    await page.click('#btn-toggle-sandbox');
    await page.click('#door-0');
    await page.click('#level-tab-1');
    await page.clock.runFor(91000);
    assert.match(await h.texto(page, '#feedback-box'), /Se agotó el tiempo/);
    await page.click('#btn-retry-challenge');
    assert.equal(await h.texto(page, '#mission-timer-value'), '01:30');
    await h.resolver(page, true);
    assert.match(await h.texto(page, '#feedback-box'), /superado/);
    await cerrar();
  });
});
