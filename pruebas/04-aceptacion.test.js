'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./ayudantes');

// Criterios de aceptación expresados como historias de usuario (Dado / Cuando / Entonces).
describe('04 · Pruebas de aceptación (UAT)', () => {
  let env;
  before(async () => { env = await h.preparar(); });
  after(async () => env.cerrar());

  it('HU1: como estudiante quiero que mi nombre aparezca en el informe', async () => {
    const { page, cerrar } = await h.nuevaPagina(env);
    await h.iniciarPartida(page, 'Sofía Martínez');
    await page.click('#btn-hub-report');
    assert.equal(await h.texto(page, '#report-student-name'), 'Sofía Martínez');
    await cerrar();
  });
  it('HU2: al empezar solo la Puerta 1 está disponible', async () => {
    const { page, cerrar } = await h.nuevaPagina(env);
    await h.iniciarPartida(page);
    const estados = await page.$$eval('.door-card', (c) => c.map((b) => b.disabled));
    assert.deepEqual(estados, [false, true, true, true, true]);
    await cerrar();
  });
  it('HU3: si fallo recibo una explicación y puedo reintentar', async () => {
    const { page, cerrar } = await h.nuevaPagina(env);
    await h.iniciarPartida(page);
    await page.click('#door-0');
    const { nivel } = await h.desafioActual(page);
    await h.resolver(page, false);
    assert.ok((await h.texto(page, '#feedback-box')).includes(nivel.explainFail));
    assert.equal(await page.isVisible('#btn-retry-challenge'), true);
    await cerrar();
  });
  it('HU4: al completar las 5 puertas obtengo calificación final', async () => {
    const { page, cerrar } = await h.nuevaPagina(env);
    await h.jugarTodo(page, 'Mateo');
    assert.equal(await h.texto(page, '#report-grade'), 'A');
    assert.match(await h.texto(page, '#report-header-card'), /Informe definitivo/);
    await cerrar();
  });
  it('HU5: como docente puedo desbloquear todas las puertas', async () => {
    const { page, cerrar } = await h.nuevaPagina(env);
    await h.iniciarPartida(page);
    await page.click('#btn-toggle-sandbox');
    assert.equal(await page.isEnabled('#door-4'), true);
    await cerrar();
  });
});
