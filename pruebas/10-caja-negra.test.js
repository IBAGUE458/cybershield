'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./ayudantes');

// Solo entradas y salidas observables por la interfaz, sin mirar el código.
describe('10 · Pruebas de caja negra', () => {
  let env;
  before(async () => { env = await h.preparar(); });
  after(async () => env.cerrar());

  const casosNombre = [
    ['Sofía', 'Estudiante: Sofía'],
    ['', 'Estudiante: Invitado'],
    ['   ', 'Estudiante: Invitado'],
    ['Ana<script>', 'Estudiante: Anascript']
  ];
  for (const [entrada, esperado] of casosNombre) {
    it('nombre "' + entrada + '" se muestra como "' + esperado + '"', async () => {
      const { page, cerrar } = await h.nuevaPagina(env);
      await h.iniciarPartida(page, entrada);
      assert.equal(await h.texto(page, '#hub-student-label'), esperado);
      await cerrar();
    });
  }

  it('contraseña débil -> rechazada; fuerte -> aceptada', async () => {
    const { page, cerrar } = await h.nuevaPagina(env);
    await h.iniciarPartida(page);
    await page.click('#btn-toggle-sandbox');
    await page.click('#door-1');
    await page.click('#level-tab-1');
    await page.fill('#pwd-input', 'hola');
    await page.click('#btn-submit-challenge');
    assert.match(await h.texto(page, '#feedback-box'), /incorrecta/);
    await page.click('#btn-retry-challenge');
    await page.fill('#pwd-input', h.PWD_VALIDA);
    assert.match(await h.texto(page, '#pwd-label'), /Muy fuerte \(7\/7\)/);
    // Botón Mostrar / Ocultar: entrada "pulsar" -> salida "se ve el texto" y viceversa
    assert.equal(await page.getAttribute('#pwd-input', 'type'), 'password');
    await page.click('#pwd-toggle');
    assert.equal(await page.getAttribute('#pwd-input', 'type'), 'text');
    assert.equal(await h.texto(page, '#pwd-toggle'), 'Ocultar');
    assert.equal(await page.getAttribute('#pwd-toggle', 'aria-pressed'), 'true');
    await page.click('#pwd-toggle');
    assert.equal(await page.getAttribute('#pwd-input', 'type'), 'password');
    assert.equal(await h.texto(page, '#pwd-toggle'), 'Mostrar');
    await page.click('#btn-submit-challenge');
    assert.match(await h.texto(page, '#feedback-box'), /superado/);
    await cerrar();
  });
});
