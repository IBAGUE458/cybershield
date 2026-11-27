'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./ayudantes');
const fs = require('fs');
const path = require('path');

// Tiempos de respuesta y peso de la aplicación.
describe('12 · Pruebas de rendimiento', () => {
  let env, p;
  before(async () => { env = await h.preparar(); p = await h.nuevaPagina(env); });
  after(async () => env.cerrar());

  it('el archivo HTML pesa menos de 200 KB', () => {
    const kb = fs.statSync(path.join(__dirname, '..', 'CyberShield.html')).size / 1024;
    console.log('   tamaño: ' + kb.toFixed(1) + ' KB');
    assert.ok(kb < 200, kb.toFixed(1) + ' KB');
  });
  it('DOMContentLoaded en menos de 1500 ms', async () => {
    const t = await p.page.evaluate(() => performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd);
    console.log('   DOMContentLoaded: ' + t.toFixed(0) + ' ms');
    assert.ok(t < 1500);
  });
  it('abrir la sala y una misión tarda menos de 200 ms', async () => {
    const t = await p.page.evaluate(() => {
      const t0 = performance.now();
      document.getElementById('btn-start-game').click();
      document.getElementById('door-0').click();
      return performance.now() - t0;
    });
    console.log('   render sala+misión: ' + t.toFixed(1) + ' ms');
    assert.ok(t < 200);
  });
  it('una partida completa automatizada termina en menos de 30 s', async () => {
    const q = await h.nuevaPagina(env);
    const t0 = Date.now();
    await h.jugarTodo(q.page);
    const s = (Date.now() - t0) / 1000;
    console.log('   partida completa: ' + s.toFixed(1) + ' s');
    assert.ok(s < 30);
    await q.cerrar();
  });
});
