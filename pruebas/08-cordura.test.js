'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./ayudantes');

// Sanity test: tras un cambio, el flujo básico sigue teniendo sentido.
describe('08 · Pruebas de cordura (sanity)', () => {
  let env, p;
  before(async () => { env = await h.preparar(); p = await h.nuevaPagina(env); });
  after(async () => env.cerrar());

  it('iniciar partida lleva a la sala principal', async () => {
    await h.iniciarPartida(p.page);
    assert.equal(await p.page.isVisible('#view-hub'), true);
  });
  it('se muestran 5 puertas', async () => {
    assert.equal(await p.page.locator('.door-card').count(), 5);
  });
  it('entrar en la Puerta 1 abre el nivel 1 de Phishing', async () => {
    await p.page.click('#door-0');
    assert.equal(await h.texto(p.page, '#mission-heading'), 'Puerta 1 · Phishing');
    assert.equal(await p.page.getAttribute('#level-tab-0', 'aria-current'), 'step');
  });
  it('una respuesta correcta da el desafío por superado', async () => {
    await h.resolver(p.page, true);
    assert.match(await h.texto(p.page, '#feedback-box'), /superado/);
  });
});
