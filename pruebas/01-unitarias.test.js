'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./ayudantes');

// Prueban cada función pura del núcleo de forma aislada (window.CyberShieldCore).
describe('01 · Pruebas unitarias', () => {
  let env, p, core;
  before(async () => {
    env = await h.preparar(); p = await h.nuevaPagina(env);
    core = (fn, ...args) => p.page.evaluate(([f, a]) => window.CyberShieldCore[f](...a), [fn, args]);
  });
  after(async () => env.cerrar());

  it('sanitizeName limpia caracteres peligrosos y espacios', async () => {
    assert.equal(await core('sanitizeName', '  Sofía   Martínez  '), 'Sofía Martínez');
    assert.equal(await core('sanitizeName', '<b>Ana</b>'), 'bAnab');
    assert.equal(await core('sanitizeName', 123), '');
  });
  it('formatTime da formato mm:ss y hh:mm:ss', async () => {
    assert.equal(await core('formatTime', 0), '00:00');
    assert.equal(await core('formatTime', 65), '01:05');
    assert.equal(await core('formatTime', 3725), '01:02:05');
    assert.equal(await core('formatTime', -10), '00:00');
  });
  it('evaluatePassword puntúa de 0 a 7', async () => {
    assert.equal((await core('evaluatePassword', '')).score, 0);
    assert.equal((await core('evaluatePassword', h.PWD_VALIDA)).score, 7);
    assert.equal((await core('evaluatePassword', h.PWD_VALIDA)).label, 'Muy fuerte');
  });
  it('computeLevelScore aplica penalizaciones con mínimo del 40 %', async () => {
    assert.equal(await core('computeLevelScore', 30, 0, 0), 30);
    assert.equal(await core('computeLevelScore', 30, 1, 1), 20);
    assert.equal(await core('computeLevelScore', 40, 1, 50), 16);
  });
  it('computeGrade asigna letra y etiqueta', async () => {
    assert.deepEqual(await core('computeGrade', 95), { letter: 'A', label: 'Sobresaliente' });
    assert.deepEqual(await core('computeGrade', 10), { letter: 'F', label: 'Insuficiente' });
  });
  it('pickVariant nunca repite el escenario anterior', async () => {
    const r = await p.page.evaluate(() => {
      const c = window.CyberShieldCore; let last = -1; let repetidos = 0;
      for (let i = 0; i < 500; i++) { const v = c.pickVariant(3, last); if (v === last || v < 0 || v > 2) repetidos++; last = v; }
      return repetidos;
    });
    assert.equal(r, 0);
  });
  it('shuffle conserva todos los elementos', async () => {
    const r = await p.page.evaluate(() => window.CyberShieldCore.shuffle([0, 1, 2, 3, 4, 5]).sort());
    assert.deepEqual(r, [0, 1, 2, 3, 4, 5]);
  });
  it('getChallenge combina nivel y escenario', async () => {
    const c = await core('getChallenge', 0, 0, 1);
    assert.equal(c.type, 'choice'); assert.equal(c.variant, 1); assert.equal(c.variantCount, 3);
    assert.match(c.prompt, /delata/);
  });
  it('slugify genera nombres de archivo seguros', async () => {
    assert.equal(await core('slugify', 'José Pérez/../x'), 'jose-perez-x');
    assert.equal(await core('slugify', ''), 'invitado');
  });
});
