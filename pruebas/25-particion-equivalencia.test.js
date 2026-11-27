'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./ayudantes');

// Un representante de cada clase de equivalencia (válida e inválida).
describe('25 · Pruebas de partición de equivalencia', () => {
  let env, p, core;
  before(async () => {
    env = await h.preparar(); p = await h.nuevaPagina(env);
    core = (fn, ...args) => p.page.evaluate(([f, a]) => window.CyberShieldCore[f](...a), [fn, args]);
  });
  after(async () => env.cerrar());

  const clasesNombre = [
    ['válida: letras con tildes', 'Ñandú Pérez', 'Ñandú Pérez'],
    ['válida: con números', 'Grupo 7', 'Grupo 7'],
    ['válida: apóstrofo y guion', "O'Neil-Ruiz", "O'Neil-Ruiz"],
    ['inválida: etiquetas HTML', '<i>Leo</i>', 'iLeoi'],
    ['inválida: emojis', 'Leo 🚀', 'Leo'],
    ['inválida: solo espacios', '     ', ''],
    ['inválida: caracteres de control', 'A\u0000B‮', 'AB']
  ];
  for (const [clase, entrada, esperado] of clasesNombre) {
    it('nombre — ' + clase, async () => assert.equal(await core('sanitizeName', entrada), esperado));
  }

  const clasesPwd = [
    ['todas las reglas', h.PWD_VALIDA, 7],
    ['sin mayúsculas', 'tigre-nube-47-volcan!', 6],
    ['sin números', 'Tigre-Nube-Volcan!', 6],
    ['sin símbolos', 'TigreNube47Volcan', 6],
    ['palabra común', 'Password-2026-Xy', 6],
    ['vacía', '', 0]
  ];
  for (const [clase, pwd, score] of clasesPwd) {
    it('contraseña — ' + clase, async () => assert.equal((await core('evaluatePassword', pwd)).score, score));
  }

  it('respuesta de elección única — correcta / incorrecta / vacía / tipo erróneo', async () => {
    const lv = await p.page.evaluate(() => window.CyberShieldCore.getChallenge(3, 0, 0));
    const ca = (a) => p.page.evaluate(([l, x]) => window.CyberShieldCore.checkAnswer(l, x), [lv, a]);
    assert.equal((await ca(1)).ok, true);
    assert.equal((await ca(0)).ok, false);
    assert.equal((await ca(null)).incomplete, true);
    assert.equal((await ca('1')).incomplete, true);
  });
});
