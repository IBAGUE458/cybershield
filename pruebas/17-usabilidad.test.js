'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./ayudantes');

// Facilidad de uso: retroalimentación clara, foco guiado, objetivos táctiles y textos comprensibles.
describe('17 · Pruebas de usabilidad', () => {
  let env, p;
  before(async () => { env = await h.preparar(); p = await h.nuevaPagina(env); });
  after(async () => env.cerrar());

  it('Enter en el campo de nombre inicia la partida', async () => {
    await p.page.fill('#student-name-input', 'Rápida');
    await p.page.press('#student-name-input', 'Enter');
    assert.equal(await p.page.isVisible('#view-hub'), true);
  });
  it('tras un error el foco va a "Volver a intentar" y se explica el motivo', async () => {
    await p.page.click('#door-0');
    await h.resolver(p.page, false);
    assert.equal(await p.page.evaluate(() => document.activeElement.id), 'btn-retry-challenge');
    const txt = await h.texto(p.page, '#feedback-box');
    assert.ok(txt.length > 40, 'la explicación debe ser descriptiva');
  });
  it('tras acertar el foco va a "Siguiente nivel"', async () => {
    await p.page.click('#btn-retry-challenge');
    await h.resolver(p.page, true);
    assert.equal(await p.page.evaluate(() => document.activeElement.id), 'btn-next-challenge');
  });
  it('todos los botones visibles tienen texto y miden al menos 36 px de alto', async () => {
    const malos = await p.page.$$eval('button', (bs) => bs.filter((b) => b.offsetParent)
      .filter((b) => !(b.textContent.trim() || b.getAttribute('aria-label')) || b.getBoundingClientRect().height < 36)
      .map((b) => b.id || b.textContent));
    assert.deepEqual(malos, []);
  });
  it('el usuario ve en todo momento su progreso (HUD)', async () => {
    assert.match(await h.texto(p.page, '#hud-score'), /Puntos: \d+\/500/);
    assert.match(await h.texto(p.page, '#hud-time'), /Tiempo: \d\d:\d\d/);
  });
});
