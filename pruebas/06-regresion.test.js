'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./ayudantes');

// Defectos ya corregidos que no deben volver a aparecer.
describe('06 · Pruebas de regresión', () => {
  let env;
  before(async () => { env = await h.preparar(); });
  after(async () => env.cerrar());

  it('repetir un nivel nunca suma más puntos ni rebaja la mejor marca', async () => {
    const { page, cerrar } = await h.nuevaPagina(env);
    await h.iniciarPartida(page);
    await h.jugarMision(page, 0);
    await page.click('#door-0');
    await page.click('#btn-show-hint');
    await h.resolver(page, true);
    const s = await h.estadoGuardado(page);
    assert.equal(s.missions[0].best[0], 30);
    assert.equal(await h.texto(page, '#hud-score'), 'Puntos: 100/500');
    await cerrar();
  });
  it('la pista no se cobra dos veces aunque se pulse varias veces', async () => {
    const { page, cerrar } = await h.nuevaPagina(env);
    await h.iniciarPartida(page);
    await page.click('#door-0');
    await page.click('#btn-show-hint');
    await page.evaluate(() => { const b = document.getElementById('btn-show-hint'); b.disabled = false; b.click(); b.click(); });
    await h.resolver(page, true);
    assert.equal((await h.estadoGuardado(page)).missions[0].best[0], 25);
    await cerrar();
  });
  it('doble clic en verificar no duplica intentos', async () => {
    const { page, cerrar } = await h.nuevaPagina(env);
    await h.iniciarPartida(page);
    await page.click('#door-0');
    await h.rellenar(page, true);
    await page.evaluate(() => { const b = document.getElementById('btn-submit-challenge'); b.click(); b.click(); });
    assert.equal((await h.estadoGuardado(page)).missions[0].attempts, 1);
    await cerrar();
  });
  it('"Volver a intentar" mantiene la misma pregunta y el mismo orden', async () => {
    const { page, cerrar } = await h.nuevaPagina(env);
    await h.iniciarPartida(page);
    await page.click('#door-0');
    const antes = await h.desafioActual(page);
    const ordenAntes = await page.$$eval('#challenge-mount input', (xs) => xs.map((x) => x.value).join(','));
    await h.resolver(page, false);
    await page.click('#btn-retry-challenge');
    assert.equal((await h.desafioActual(page)).v, antes.v);
    assert.equal(await page.$$eval('#challenge-mount input', (xs) => xs.map((x) => x.value).join(',')), ordenAntes);
    await cerrar();
  });
  it('el historial se limita a 200 entradas', async () => {
    const hist = Array.from({ length: 300 }, (_, i) => ({ ts: i, mission: 0, level: 0, result: 'fail', points: 0, timeSec: 0 }));
    const { page, cerrar } = await h.nuevaPagina(env, { antes: h.sembrarEstado({ history: hist }) });
    await page.click('#btn-start-game');
    await page.click('#door-0');
    await h.resolver(page, true);
    assert.equal((await h.estadoGuardado(page)).history.length, 200);
    await cerrar();
  });
});
