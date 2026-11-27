'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./ayudantes');

// Combinan acciones por la interfaz con conocimiento parcial de la estructura interna (localStorage).
describe('11 · Pruebas de caja gris', () => {
  let env;
  before(async () => { env = await h.preparar(); });
  after(async () => env.cerrar());

  it('acción en UI -> estructura de datos guardada correcta', async () => {
    const { page, cerrar } = await h.nuevaPagina(env);
    await h.iniciarPartida(page, 'Gris');
    await page.click('#door-0');
    await h.resolver(page, false);
    const s = await h.estadoGuardado(page);
    assert.equal(s.version, 1);
    assert.equal(s.studentName, 'Gris');
    assert.equal(s.missions.length, 5);
    assert.deepEqual({ a: s.missions[0].attempts, e: s.missions[0].errors }, { a: 1, e: 1 });
    assert.equal(s.history.at(-1).result, 'fail');
    await cerrar();
  });

  it('estado interno sembrado -> la UI lo refleja', async () => {
    const estado = { studentName: 'Docente', missions: [{ levels: [true, true, true], best: [30, 30, 40] }, { levels: [true, false, false], best: [30, 0, 0] }] };
    const { page, cerrar } = await h.nuevaPagina(env, { antes: h.sembrarEstado(estado) });
    assert.equal(await h.texto(page, '#hud-score'), 'Puntos: 130/500');
    assert.equal(await h.texto(page, '#menu-completion-tag'), '1 / 5');
    await page.click('#btn-start-game');
    assert.equal(await page.isEnabled('#door-1'), true);
    assert.equal(await page.isDisabled('#door-2'), true);
    await cerrar();
  });
});
