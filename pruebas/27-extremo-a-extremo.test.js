'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./ayudantes');

// E2E: recorrido real completo de un estudiante, desde el menú hasta el informe descargado.
describe('27 · Pruebas de extremo a extremo (E2E)', () => {
  let env;
  before(async () => { env = await h.preparar(); });
  after(async () => env.cerrar());

  it('partida perfecta: 5 puertas, calificación A e informe descargable', async () => {
    const { page, errores, cerrar } = await h.nuevaPagina(env);
    await page.click('#btn-open-instructions');
    await page.click('#btn-inst-back');
    await h.jugarTodo(page, 'Valentina Ríos');
    assert.equal(await h.texto(page, '#report-student-name'), 'Valentina Ríos');
    assert.equal(await h.texto(page, '#report-grade'), 'A');
    assert.equal(await h.texto(page, '#hud-progress'), 'Misiones: 5/5');
    assert.equal(await h.texto(page, '#hud-score'), 'Puntos: 500/500');

    const [descarga] = await Promise.all([page.waitForEvent('download'), page.click('#btn-download-report')]);
    const ruta = await descarga.path();
    const contenido = require('fs').readFileSync(ruta, 'utf8');
    assert.match(contenido, /Estudiante: Valentina Ríos/);
    assert.match(contenido, /Puntuación total: 500 \/ 500 \(100%\)/);
    assert.match(contenido, /Calificación: A — Sobresaliente/);

    await page.click('#btn-report-hub');
    await page.click('#btn-hub-scores');
    assert.equal(await page.locator('#scores-history-tbody tr').count(), 15);
    assert.deepEqual(errores, []);
    await cerrar();
  });

  it('partida con errores y pistas: temas a reforzar aparecen en el informe', async () => {
    const { page, cerrar } = await h.nuevaPagina(env);
    await h.iniciarPartida(page, 'Andrés');
    await page.click('#door-0');
    for (let li = 0; li < 3; li++) {
      await page.click('#btn-show-hint');
      for (let k = 0; k < 3; k++) { await h.resolver(page, false); await page.click('#btn-retry-challenge'); }
      await page.evaluate(() => { document.querySelectorAll('#challenge-mount input').forEach((i) => { i.checked = false; }); });
      await h.resolver(page, true);
      await page.click('#btn-next-challenge');
    }
    await page.click('#btn-hub-report');
    assert.match(await h.texto(page, '#report-reinforce-list'), /Phishing/);
    assert.match(await h.texto(page, '#report-header-card'), /Informe parcial/);
    await cerrar();
  });
});
