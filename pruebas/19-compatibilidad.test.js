'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./ayudantes');
const { devices, firefox, webkit } = require('playwright');

// Distintos dispositivos, idiomas, zonas horarias y (si están instalados) otros motores.
describe('19 · Pruebas de compatibilidad', () => {
  let env;
  before(async () => { env = await h.preparar(); });
  after(async () => env.cerrar());

  const perfiles = {
    'Escritorio Chrome': devices['Desktop Chrome'],
    'Pixel 7 (Android)': devices['Pixel 7'],
    'iPhone 13 (viewport iOS)': { ...devices['iPhone 13'], defaultBrowserType: undefined },
    'iPad Mini (tableta)': { ...devices['iPad Mini'], defaultBrowserType: undefined },
    'Inglés / Nueva York': { locale: 'en-US', timezoneId: 'America/New_York' },
    'Español / Bogotá': { locale: 'es-CO', timezoneId: 'America/Bogota' }
  };
  for (const [nombre, contexto] of Object.entries(perfiles)) {
    it('funciona en ' + nombre, async () => {
      const { defaultBrowserType, ...ctx } = contexto;
      const { page, errores, cerrar } = await h.nuevaPagina(env, { contexto: ctx });
      await h.iniciarPartida(page);
      await h.jugarMision(page, 0);
      assert.equal(await h.texto(page, '#hud-score'), 'Puntos: 100/500');
      assert.deepEqual(errores, []);
      await cerrar();
    });
  }

  for (const [nombre, motor] of [['Firefox', firefox], ['WebKit (Safari)', webkit]]) {
    it('motor ' + nombre + ' (se omite si no está instalado)', async (t) => {
      let browser;
      try { browser = await motor.launch(); } catch { t.skip(nombre + ' no instalado: npx playwright install ' + motor.name()); return; }
      const page = await browser.newPage();
      await page.route(/fonts\./, (r) => r.abort());
      await page.goto(env.url);
      await page.waitForSelector('html[data-ready="true"]');
      await h.iniciarPartida(page);
      await h.jugarMision(page, 0);
      assert.equal(await h.texto(page, '#hud-score'), 'Puntos: 100/500');
      await browser.close();
    });
  }
});
