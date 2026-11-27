'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./ayudantes');

// Los datos se guardan, se restauran y se sincronizan correctamente.
describe('23 · Pruebas de persistencia de datos', () => {
  let env;
  before(async () => { env = await h.preparar(); });
  after(async () => env.cerrar());

  it('nombre, progreso, modo docente y sonido persisten tras recargar', async () => {
    const { page, cerrar } = await h.nuevaPagina(env);
    await h.iniciarPartida(page, 'Persistente');
    await h.jugarMision(page, 0);
    await page.click('#btn-toggle-sandbox');
    await page.click('#btn-sound-toggle');
    await page.reload();
    await page.waitForSelector('html[data-ready="true"]');
    assert.equal(await page.inputValue('#student-name-input'), 'Persistente');
    assert.equal(await h.texto(page, '#hud-score'), 'Puntos: 100/500');
    assert.equal(await h.texto(page, '#btn-sound-toggle'), 'Sonido: Silenciado');
    await page.click('#btn-start-game');
    assert.equal(await h.texto(page, '#hub-unlock-mode-label'), 'Modo: Acceso libre (docente)');
    await cerrar();
  });

  it('el historial registra cada intento con fecha y resultado', async () => {
    const { page, cerrar } = await h.nuevaPagina(env);
    await h.iniciarPartida(page);
    await page.click('#door-0');
    await h.resolver(page, false);
    await page.click('#btn-retry-challenge');
    await h.resolver(page, true);
    const s = await h.estadoGuardado(page);
    assert.deepEqual(s.history.map((x) => x.result), ['fail', 'ok']);
    assert.ok(s.history.every((x) => x.ts > 1700000000000));
    await cerrar();
  });

  it('dos pestañas se sincronizan mediante el evento storage', async () => {
    const { context, page, cerrar } = await h.nuevaPagina(env);
    const otra = await context.newPage();
    await otra.goto(env.url);
    await otra.waitForSelector('html[data-ready="true"]');
    await h.iniciarPartida(page);
    await h.jugarMision(page, 0);
    await otra.waitForFunction(() => document.getElementById('hud-score').textContent.includes('100'));
    assert.equal(await h.texto(otra, '#hud-score'), 'Puntos: 100/500');
    await cerrar();
  });

  it('el último escenario visto se guarda y tras recargar sale otro distinto', async () => {
    const { page, cerrar } = await h.nuevaPagina(env);
    await h.iniciarPartida(page);
    await page.click('#door-0');
    const { v } = await h.desafioActual(page);
    assert.equal((await h.estadoGuardado(page)).missions[0].lastVariant[0], v);
    await page.reload();
    await page.waitForSelector('html[data-ready="true"]');
    await page.click('#btn-start-game');
    await page.click('#door-0');
    assert.notEqual((await h.desafioActual(page)).v, v);
    await cerrar();
  });
  it('reiniciar elimina los datos guardados', async () => {
    const { page, cerrar } = await h.nuevaPagina(env);
    await h.iniciarPartida(page, 'Borrar');
    await page.click('#btn-hub-reset');
    await page.click('#modal-confirm-btn');
    const s = await h.estadoGuardado(page);
    assert.equal(s.studentName, '');
    assert.equal(s.history.length, 0);
    await cerrar();
  });
});
