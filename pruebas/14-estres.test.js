'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./ayudantes');

// Llevan la aplicación más allá de su uso normal.
describe('14 · Pruebas de estrés', () => {
  let env;
  before(async () => { env = await h.preparar(); });
  after(async () => env.cerrar());

  it('1000 clics rápidos alternando el modo docente no rompen nada', async () => {
    const { page, errores, cerrar } = await h.nuevaPagina(env);
    await h.iniciarPartida(page);
    await page.evaluate(() => { const b = document.getElementById('btn-toggle-sandbox'); for (let i = 0; i < 1000; i++) b.click(); });
    assert.equal((await h.estadoGuardado(page)).sandbox, false);
    assert.deepEqual(errores, []);
    await cerrar();
  });
  it('historial de 1000 entradas se recorta a 200 al cargar', async () => {
    const hist = Array.from({ length: 1000 }, (_, i) => ({ ts: i, mission: 0, level: 0, result: 'ok', points: 1, timeSec: 1 }));
    const { page, cerrar } = await h.nuevaPagina(env, { antes: h.sembrarEstado({ history: hist }) });
    await page.click('#btn-open-scores');
    assert.equal(await page.locator('#scores-history-tbody tr').count(), 50);
    await page.click('#btn-sound-toggle');
    assert.equal((await h.estadoGuardado(page)).history.length, 200);
    await cerrar();
  });
  it('estado gigante (20 000 entradas, >200 KB) se descarta sin bloquear la app', async () => {
    const hist = Array.from({ length: 20000 }, (_, i) => ({ ts: i, mission: 0, level: 0, result: 'ok', points: 1, timeSec: 1 }));
    const { page, cerrar } = await h.nuevaPagina(env, { antes: h.sembrarEstado({ history: hist }) });
    // > 200 000 caracteres: se descarta por seguridad y la app arranca con estado limpio
    assert.equal(await h.texto(page, '#hud-score'), 'Puntos: 0/500');
    await cerrar();
  });
  it('un nombre de 100 000 caracteres se recorta a 48', async () => {
    const { page, cerrar } = await h.nuevaPagina(env);
    await page.evaluate(() => { const i = document.getElementById('student-name-input'); i.removeAttribute('maxlength'); i.value = 'A'.repeat(100000); });
    await page.click('#btn-start-game');
    assert.equal((await h.estadoGuardado(page)).studentName.length, 48);
    await cerrar();
  });
  it('100 envíos fallidos seguidos mantienen la puntuación mínima', async () => {
    const { page, cerrar } = await h.nuevaPagina(env);
    await h.iniciarPartida(page);
    await page.click('#door-0');
    await h.rellenar(page, false);
    await page.evaluate(() => {
      for (let i = 0; i < 100; i++) { document.getElementById('btn-submit-challenge').click(); document.getElementById('btn-retry-challenge').click(); }
    });
    await h.rellenar(page, true);
    await page.click('#btn-submit-challenge');
    const s = await h.estadoGuardado(page);
    assert.equal(s.missions[0].errors, 100);
    assert.equal(s.missions[0].best[0], 12);
    await cerrar();
  });
});
