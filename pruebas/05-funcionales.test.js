'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./ayudantes');

// Comprueban cada requisito funcional del juego.
describe('05 · Pruebas funcionales', () => {
  let env, p;
  before(async () => { env = await h.preparar(); p = await h.nuevaPagina(env); await h.iniciarPartida(p.page); await p.page.click('#door-0'); });
  after(async () => env.cerrar());

  it('una respuesta incompleta avisa y no cuenta como intento', async () => {
    await p.page.click('#btn-submit-challenge');
    assert.match(await h.texto(p.page, '#feedback-box'), /incompleta/);
    assert.equal(await h.texto(p.page, '#side-attempts'), '0');
  });
  it('la pista se muestra y el botón queda deshabilitado', async () => {
    await p.page.click('#btn-show-hint');
    assert.equal(await p.page.isVisible('#hint-box'), true);
    assert.equal(await p.page.isDisabled('#btn-show-hint'), true);
  });
  it('el cronómetro no aparece en el nivel 1 y sí en el nivel 2', async () => {
    assert.equal(await p.page.isVisible('#mission-timer-box'), false);
    await h.resolver(p.page, true);
    await p.page.click('#btn-next-challenge');
    assert.equal(await p.page.isVisible('#mission-timer-box'), true);
    assert.equal(await h.texto(p.page, '#mission-timer-value'), '01:30');
  });
  it('el botón de sonido alterna su estado', async () => {
    await p.page.click('#btn-sound-toggle');
    assert.equal(await h.texto(p.page, '#btn-sound-toggle'), 'Sonido: Silenciado');
    await p.page.click('#btn-sound-toggle');
    assert.equal(await h.texto(p.page, '#btn-sound-toggle'), 'Sonido: Activo');
  });
  it('al volver a entrar a un nivel la pregunta es distinta (10 repeticiones)', async () => {
    let anterior = null;
    for (let i = 0; i < 10; i++) {
      await p.page.click('#btn-nav-hub');
      await p.page.click('#door-0');
      await p.page.click('#level-tab-0');
      const { v, nivel } = await h.desafioActual(p.page);
      assert.notEqual(v, anterior, 'repetición ' + i);
      assert.equal(await h.texto(p.page, '#challenge-prompt'), nivel.prompt);
      anterior = v;
    }
  });
  it('a lo largo de varias partidas aparecen los 3 escenarios de cada nivel', async () => {
    const vistos = new Set();
    for (let i = 0; i < 20; i++) {
      await p.page.click('#level-tab-0');
      vistos.add((await h.desafioActual(p.page)).v);
    }
    assert.deepEqual([...vistos].sort(), [0, 1, 2]);
  });
  it('las opciones se barajan pero la respuesta correcta sigue funcionando', async () => {
    const ordenes = new Set();
    for (let i = 0; i < 8; i++) {
      await p.page.click('#level-tab-0');
      ordenes.add(await p.page.$$eval('#challenge-mount input', (xs) => xs.map((x) => x.value).join(',')));
    }
    assert.ok(ordenes.size > 1, 'el orden de las opciones debe variar');
    await h.resolver(p.page, true);
    assert.match(await h.texto(p.page, '#feedback-box'), /superado/);
  });
  it('reiniciar partida borra todo el progreso tras confirmar', async () => {
    await p.page.click('#btn-nav-hub');
    await p.page.click('#btn-hub-reset');
    await p.page.click('#modal-confirm-btn');
    assert.equal(await p.page.isVisible('#view-menu'), true);
    assert.equal(await h.texto(p.page, '#hud-score'), 'Puntos: 0/500');
    assert.equal(await p.page.inputValue('#student-name-input'), '');
  });
});
