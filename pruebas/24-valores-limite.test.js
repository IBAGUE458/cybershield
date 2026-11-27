'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./ayudantes');

// Análisis de valores límite: justo en el borde, uno por debajo y uno por encima.
describe('24 · Pruebas de valores límite', () => {
  let env, p, core;
  before(async () => {
    env = await h.preparar(); p = await h.nuevaPagina(env);
    core = (fn, ...args) => p.page.evaluate(([f, a]) => window.CyberShieldCore[f](...a), [fn, args]);
  });
  after(async () => env.cerrar());

  it('nombre: 0, 1, 47, 48 y 49 caracteres', async () => {
    for (const [n, esperado] of [[0, 0], [1, 1], [47, 47], [48, 48], [49, 48]]) {
      assert.equal((await core('sanitizeName', 'a'.repeat(n))).length, esperado, 'longitud ' + n);
    }
  });
  it('el campo de nombre en la UI corta en 48 (maxlength)', async () => {
    await p.page.fill('#student-name-input', 'b'.repeat(60));
    assert.equal((await p.page.inputValue('#student-name-input')).length, 48);
  });
  it('contraseña: 11 caracteres no cumple longitud, 12 sí', async () => {
    assert.equal((await core('evaluatePassword', 'Ab1-cdefghi')).checks.length, false);
    assert.equal((await core('evaluatePassword', 'Ab1-cdefghij')).checks.length, true);
  });
  it('contraseña: 2 repetidos consecutivos válido, 3 no', async () => {
    assert.equal((await core('evaluatePassword', 'xaay')).checks.noRepeat, true);
    assert.equal((await core('evaluatePassword', 'xaaay')).checks.noRepeat, false);
  });
  it('calificación en las fronteras 59/60, 69/70, 79/80, 89/90', async () => {
    const l = async (v) => (await core('computeGrade', v)).letter;
    assert.deepEqual([await l(59.9), await l(60), await l(69), await l(70), await l(79), await l(80), await l(89), await l(90), await l(100)],
      ['F', 'D', 'D', 'C', 'C', 'B', 'B', 'A', 'A']);
  });
  it('puntuación por nivel acotada a su máximo y mínimo', async () => {
    const s = await core('validateState', { missions: [{ levels: [true, true, true], best: [31, -1, 40] }] });
    assert.deepEqual(s.missions[0].best, [30, 0, 40]);
    assert.equal(await core('computeLevelScore', 30, 0, 3), 15);
    assert.equal(await core('computeLevelScore', 30, 0, 4), 12);
    assert.equal(await core('computeLevelScore', 30, 0, 5), 12);
  });
  it('cronómetro: a los 89 s sigue activo, a los 90 s se agota', async () => {
    const q = await h.nuevaPagina(env, { reloj: true });
    await h.iniciarPartida(q.page);
    await q.page.click('#btn-toggle-sandbox');
    await q.page.click('#door-0');
    await q.page.click('#level-tab-1');
    await q.page.clock.runFor(89000);
    assert.equal(await h.texto(q.page, '#mission-timer-value'), '00:01');
    assert.equal(await q.page.isVisible('#btn-submit-challenge'), true);
    await q.page.clock.runFor(1000);
    assert.equal(await q.page.isVisible('#btn-retry-challenge'), true);
    await q.cerrar();
  });
});
