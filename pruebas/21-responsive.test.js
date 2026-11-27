'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./ayudantes');

// Diseño adaptable: sin scroll horizontal y con disposición correcta en cada ancho.
describe('21 · Pruebas de diseño adaptable (responsive)', () => {
  let env;
  before(async () => { env = await h.preparar(); });
  after(async () => env.cerrar());

  const anchos = [320, 375, 768, 1024, 1440];
  for (const ancho of anchos) {
    it('sin desbordamiento horizontal a ' + ancho + ' px en todas las vistas', async () => {
      const { page, cerrar } = await h.nuevaPagina(env, { contexto: { viewport: { width: ancho, height: 800 } } });
      const desborda = () => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      assert.equal(await desborda(), false, 'menú');
      await h.iniciarPartida(page);
      assert.equal(await desborda(), false, 'sala');
      await page.click('#door-0');
      assert.equal(await desborda(), false, 'misión');
      await page.click('#btn-nav-hub'); await page.click('#btn-hub-scores');
      assert.equal(await desborda(), false, 'puntuaciones');
      await page.click('#btn-scores-report');
      assert.equal(await desborda(), false, 'informe');
      await cerrar();
    });
  }

  it('en móvil la misión apila terminal y panel lateral en una columna', async () => {
    const { page, cerrar } = await h.nuevaPagina(env, { contexto: { viewport: { width: 375, height: 800 } } });
    await h.iniciarPartida(page);
    await page.click('#door-0');
    const [a, b] = await page.evaluate(() => [document.querySelector('.computer-frame'), document.querySelector('.briefing-sidebar')].map((e) => e.getBoundingClientRect().top));
    assert.ok(b > a, 'el panel lateral debe quedar debajo');
    await cerrar();
  });
});
