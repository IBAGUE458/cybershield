'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./ayudantes');

// Smoke test: ¿arranca la aplicación y lo esencial está ahí?
describe('07 · Pruebas de humo (smoke)', () => {
  let env, p;
  before(async () => { env = await h.preparar(); p = await h.nuevaPagina(env); });
  after(async () => env.cerrar());

  it('la página carga con el título correcto', async () => {
    assert.match(await p.page.title(), /CyberShield/);
  });
  it('el menú principal está visible con sus botones', async () => {
    for (const id of ['#btn-start-game', '#btn-open-instructions', '#btn-open-scores', '#btn-reset-menu']) {
      assert.equal(await p.page.isVisible(id), true, id);
    }
  });
  it('el núcleo del juego está cargado con 5 misiones', async () => {
    assert.equal(await p.page.evaluate(() => window.CyberShieldCore.MISSIONS.length), 5);
  });
  it('no hay errores de JavaScript al arrancar', async () => {
    assert.deepEqual(p.errores, []);
  });
});
