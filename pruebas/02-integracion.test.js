'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./ayudantes');

// Verifican que los módulos (juego, almacenamiento, HUD, sala, puntuaciones, informe) colaboran bien.
describe('02 · Pruebas de integración', () => {
  let env;
  before(async () => { env = await h.preparar(); });
  after(async () => env.cerrar());

  it('completar una misión actualiza almacenamiento, HUD, sala, puntuaciones e informe', async () => {
    const { page, cerrar } = await h.nuevaPagina(env);
    await h.iniciarPartida(page);
    await h.jugarMision(page, 0);
    const s = await h.estadoGuardado(page);
    assert.deepEqual(s.missions[0].levels, [true, true, true]);
    assert.equal(await h.texto(page, '#hud-score'), 'Puntos: 100/500');
    assert.equal(await page.isEnabled('#door-1'), true);
    await page.click('#btn-hub-scores');
    assert.match(await h.texto(page, '#scores-mission-tbody tr:first-child'), /Completada/);
    await page.click('#btn-scores-report');
    assert.match(await h.texto(page, '#report-tbody tr:first-child'), /100 \/ 100/);
    await cerrar();
  });

  it('pista + error se integran en la puntuación del nivel (30 - 5 - 5 = 20)', async () => {
    const { page, cerrar } = await h.nuevaPagina(env);
    await h.iniciarPartida(page);
    await page.click('#door-0');
    await page.click('#btn-show-hint');
    await h.resolver(page, false);
    await page.click('#btn-retry-challenge');
    await h.resolver(page, true);
    assert.match(await h.texto(page, '#feedback-box'), /\+20 pts/);
    assert.equal((await h.estadoGuardado(page)).missions[0].best[0], 20);
    await cerrar();
  });
});
