'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./ayudantes');
const fs = require('fs');
const path = require('path');
const CAPTURAS = path.join(__dirname, 'capturas');

// Estado visual de los componentes (GUI) y capturas de referencia.
describe('20 · Pruebas de interfaz gráfica (GUI)', () => {
  let env, p;
  before(async () => { fs.mkdirSync(CAPTURAS, { recursive: true }); env = await h.preparar(); p = await h.nuevaPagina(env, { reloj: true }); });
  after(async () => env.cerrar());

  it('menú: muestra las 5 puertas con su estado', async () => {
    assert.equal(await p.page.locator('.door-preview').count(), 5);
    assert.match(await h.texto(p.page, '.door-preview:nth-child(1)'), /Disponible/);
    assert.match(await h.texto(p.page, '.door-preview:nth-child(2)'), /Bloqueada/);
    await p.page.screenshot({ path: path.join(CAPTURAS, '01-menu.png'), animations: 'disabled' });
  });
  it('sala: puertas bloqueadas muestran candado y están deshabilitadas', async () => {
    await h.iniciarPartida(p.page);
    assert.match(await h.texto(p.page, '#door-1'), /🔒 Bloqueada/);
    assert.equal(await p.page.isDisabled('#door-1'), true);
    await p.page.screenshot({ path: path.join(CAPTURAS, '02-sala.png'), animations: 'disabled' });
  });
  it('misión: pestaña activa marcada y niveles futuros deshabilitados', async () => {
    await p.page.click('#door-0');
    assert.equal(await p.page.getAttribute('#level-tab-0', 'aria-current'), 'step');
    assert.equal(await p.page.isDisabled('#level-tab-1'), true);
    await p.page.screenshot({ path: path.join(CAPTURAS, '03-mision.png'), animations: 'disabled' });
  });
  it('cronómetro cambia a estado crítico en los últimos 15 s', async () => {
    await h.resolver(p.page, true);
    await p.page.click('#btn-next-challenge');
    await p.page.clock.runFor(74000);
    assert.equal(await p.page.evaluate(() => document.getElementById('mission-timer-box').classList.contains('critical')), false);
    await p.page.clock.runFor(2000);
    assert.equal(await p.page.evaluate(() => document.getElementById('mission-timer-box').classList.contains('critical')), true);
  });
  it('nivel superado muestra ✓ en la pestaña y la puerta completada se resalta', async () => {
    assert.match(await h.texto(p.page, '#level-tab-0'), /✓/);
    await p.page.click('#btn-mission-back');
    await p.page.click('#btn-toggle-sandbox');
    await p.page.screenshot({ path: path.join(CAPTURAS, '04-sala-modo-docente.png'), animations: 'disabled' });
    assert.equal(await h.texto(p.page, '#hub-unlock-mode-label'), 'Modo: Acceso libre (docente)');
  });
});
