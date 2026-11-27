'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./ayudantes');

// Monkey testing: cientos de acciones aleatorias (semilla fija, reproducible) sin errores.
function generador(semilla) {
  let s = semilla >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

describe('26 · Pruebas exploratorias / monkey testing', () => {
  let env;
  before(async () => { env = await h.preparar(); });
  after(async () => env.cerrar());

  for (const semilla of [7, 42, 2026]) {
    it('400 acciones aleatorias (semilla ' + semilla + ') sin errores ni estados imposibles', async () => {
      const azar = generador(semilla);
      const { page, errores, cerrar } = await h.nuevaPagina(env);
      for (let i = 0; i < 400; i++) {
        const accion = await page.evaluate((r) => {
          const el = [...document.querySelectorAll('button, input, select')].filter((e) => e.offsetParent && !e.disabled);
          if (!el.length) return 'nada';
          const e = el[Math.floor(r[0] * el.length)];
          if (e.id === 'btn-print-report' || e.id === 'btn-download-report') return 'omitido';
          if (e.tagName === 'SELECT') { e.selectedIndex = Math.floor(r[1] * e.options.length); e.dispatchEvent(new Event('change', { bubbles: true })); }
          else if (e.type === 'text' || e.type === 'password') { e.value = Math.random().toString(36).slice(2); e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }
          else e.click();
          return e.id || e.tagName;
        }, [azar(), azar()]);
        void accion;
      }
      const inv = await page.evaluate(() => {
        const s = JSON.parse(localStorage.getItem('cybershield.v1') || 'null');
        return s ? { total: window.CyberShieldCore.totalScore(s), vistas: document.querySelectorAll('.view.active').length } : { total: 0, vistas: document.querySelectorAll('.view.active').length };
      });
      assert.ok(inv.total >= 0 && inv.total <= 500);
      assert.equal(inv.vistas, 1, 'siempre hay exactamente una vista activa');
      assert.deepEqual(errores, []);
      await cerrar();
    });
  }
});
