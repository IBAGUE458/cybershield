'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./ayudantes');

function luminancia(rgb) {
  const [r, g, b] = rgb.match(/\d+/g).slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contraste = (a, b) => { const [x, y] = [luminancia(a), luminancia(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

// WCAG 2.1: idioma, etiquetas, teclado, foco, diálogos y contraste.
describe('18 · Pruebas de accesibilidad', () => {
  let env, p;
  before(async () => { env = await h.preparar(); p = await h.nuevaPagina(env); });
  after(async () => env.cerrar());

  it('el documento declara idioma español', async () => {
    assert.equal(await p.page.getAttribute('html', 'lang'), 'es');
  });
  it('cada campo de formulario tiene etiqueta accesible', async () => {
    const sin = await p.page.$$eval('input, select', (els) => els.filter((e) => !(e.labels && e.labels.length) && !e.getAttribute('aria-label')).map((e) => e.id));
    assert.deepEqual(sin, []);
  });
  it('la partida se puede iniciar solo con teclado', async () => {
    await p.page.focus('#student-name-input');
    await p.page.keyboard.type('Teclado');
    await p.page.keyboard.press('Tab');
    assert.equal(await p.page.evaluate(() => document.activeElement.id), 'btn-start-game');
    await p.page.keyboard.press('Enter');
    assert.equal(await p.page.evaluate(() => document.activeElement.id), 'hub-heading');
  });
  it('hay exactamente un h1 visible por vista', async () => {
    assert.equal(await p.page.locator('h1:visible').count(), 1);
  });
  it('el diálogo: aria-modal, Escape cierra y el foco vuelve al botón', async () => {
    assert.equal(await p.page.getAttribute('#confirm-modal', 'aria-modal'), 'true');
    await p.page.click('#btn-hub-reset');
    assert.equal(await p.page.evaluate(() => document.activeElement.id), 'modal-cancel-btn');
    await p.page.keyboard.press('Tab'); await p.page.keyboard.press('Tab');
    assert.equal(await p.page.evaluate(() => document.activeElement.id), 'modal-cancel-btn', 'trampa de foco');
    await p.page.keyboard.press('Escape');
    assert.equal(await p.page.isVisible('#confirm-modal'), false);
    assert.equal(await p.page.evaluate(() => document.activeElement.id), 'btn-hub-reset');
  });
  it('la barra de progreso expone aria-valuenow', async () => {
    assert.equal(await p.page.getAttribute('#hub-progressbar', 'aria-valuenow'), '0');
  });
  it('contraste de texto >= 4.5:1 (WCAG AA)', async () => {
    const pares = await p.page.evaluate(() => {
      const c = (sel) => { const e = document.querySelector(sel); const s = getComputedStyle(e); return s.color; };
      const fondo = getComputedStyle(document.querySelector('.panel')).backgroundColor;
      return [[c('.section-subtitle'), fondo], [c('#hub-student-label'), fondo], [c('.meta-line'), fondo], [c('.door-topic'), fondo]];
    });
    for (const [t, f] of pares) assert.ok(contraste(t, f) >= 4.5, t + ' sobre ' + f + ' = ' + contraste(t, f).toFixed(2));
  });
  it('los iconos decorativos están ocultos a lectores de pantalla', async () => {
    const visibles = await p.page.$$eval('svg', (s) => s.filter((x) => x.getAttribute('aria-hidden') !== 'true').length);
    assert.equal(visibles, 0);
  });
});
