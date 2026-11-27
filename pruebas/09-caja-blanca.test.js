'use strict';
// Snyk Code (NoHardcodedPasswords/test) — falso positivo aceptado: son contraseñas FICTICIAS para probar el medidor de fortaleza del juego; no dan acceso a nada
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./ayudantes');

// Conocen la estructura interna: recorren ramas concretas y miden cobertura de código real (V8).
describe('09 · Pruebas de caja blanca', () => {
  let env, p, core;
  before(async () => {
    env = await h.preparar(); p = await h.nuevaPagina(env, { cobertura: true });
    core = (fn, ...args) => p.page.evaluate(([f, a]) => window.CyberShieldCore[f](...a), [fn, args]);
  });
  after(async () => env.cerrar());

  it('validateState: rama de entrada no-objeto y array', async () => {
    const def = await core('defaultState');
    assert.deepEqual(await core('validateState', null), def);
    assert.deepEqual(await core('validateState', [1, 2]), def);
    assert.deepEqual(await core('validateState', 'texto'), def);
  });
  it('validateState: puntos de niveles no superados se anulan y se acotan', async () => {
    const s = await core('validateState', { missions: [{ levels: [true, false, 'si'], best: [999, 30, 40] }] });
    assert.deepEqual(s.missions[0].levels, [true, false, false]);
    assert.deepEqual(s.missions[0].best, [30, 0, 0]);
  });
  it('validateState: historial con resultado inválido se descarta', async () => {
    const s = await core('validateState', { history: [{ result: 'hack' }, { result: 'ok', points: 99 }, null] });
    assert.equal(s.history.length, 1);
    assert.equal(s.history[0].points, 40);
  });
  it('validateState: lastVariant fuera de rango se corrige a -1..2', async () => {
    const s = await core('validateState', { missions: [{ lastVariant: [9, -7, 1] }] });
    assert.deepEqual(s.missions[0].lastVariant, [2, -1, 1]);
  });
  it('pickVariant: rama sin historial, con historial y con una sola variante', async () => {
    const r = (n, last, fijo) => p.page.evaluate(([a, b, f]) => window.CyberShieldCore.pickVariant(a, b, () => f), [n, last, fijo]);
    assert.equal(await r(3, -1, 2), 2);
    assert.equal(await r(3, 0, 0), 1);
    assert.equal(await r(3, 2, 1), 1);
    assert.equal(await r(1, 0, 0), 0);
  });
  it('evaluatePassword: cada comprobación se activa por separado', async () => {
    const c = async (pw) => (await core('evaluatePassword', pw)).checks;
    assert.equal((await c('aaaaaaaaaaaa')).length, true);
    assert.equal((await c('A')).upper, true);
    assert.equal((await c('1')).digit, true);
    assert.equal((await c('-')).symbol, true);
    assert.equal((await c('xpasswordx')).notCommon, false);
    assert.equal((await c('aaa')).noRepeat, false);
  });
  it('checkAnswer: todas las ramas por tipo', async () => {
    const lv = (mi, li) => p.page.evaluate(([a, b]) => window.CyberShieldCore.getChallenge(a, b, 0), [mi, li]);
    const ca = (l, a) => p.page.evaluate(([x, y]) => window.CyberShieldCore.checkAnswer(x, y), [l, a]);
    assert.equal((await ca(await lv(0, 0), 0)).ok, true);
    assert.equal((await ca(await lv(0, 1), [3, 2, 1, 0, 0])).ok, true);
    assert.equal((await ca(await lv(0, 2), [0, 1, 1, 0, null])).incomplete, true);
    assert.equal((await ca(await lv(1, 1), 'abc')).ok, false);
    assert.equal((await ca({ type: 'raro' }, 1)).incomplete, true);
    assert.equal((await ca(null, 1)).incomplete, true);
  });
  it('banco de preguntas: 45 escenarios bien formados y resolubles', async () => {
    const problemas = await p.page.evaluate(() => {
      const c = window.CyberShieldCore; const err = []; let total = 0;
      c.MISSIONS.forEach((m, mi) => m.levels.forEach((l, li) => {
        if (l.variants.length !== 3) err.push(mi + '.' + li + ' no tiene 3 escenarios');
        const prompts = new Set();
        l.variants.forEach((_, v) => {
          total++;
          const ch = c.getChallenge(mi, li, v); const id = mi + '.' + li + '.' + v;
          if (!ch.prompt || !ch.hint || !ch.explainOk || !ch.explainFail) err.push(id + ' faltan textos');
          prompts.add(JSON.stringify([ch.prompt, ch.options, ch.items, ch.context]));
          let respuesta;
          if (ch.type === 'choice') { if (!(ch.correct >= 0 && ch.correct < ch.options.length)) err.push(id + ' correct fuera de rango'); respuesta = ch.correct; }
          if (ch.type === 'multi') { if (!ch.correct.length || ch.correct.some((x) => x >= ch.options.length)) err.push(id + ' multi inválido'); respuesta = ch.correct.slice(); }
          if (ch.type === 'classify') { if (ch.answers.length !== ch.items.length || ch.answers.some((x) => x >= ch.categories.length)) err.push(id + ' classify inválido'); respuesta = ch.answers.slice(); }
          if (ch.type === 'password') respuesta = 'Tigre-Nube-47-Volcan!';
          if (!c.checkAnswer(ch, respuesta).ok) err.push(id + ' su propia respuesta no es aceptada');
        });
        if (prompts.size !== l.variants.length) err.push(mi + '.' + li + ' tiene escenarios repetidos');
      }));
      if (total !== 45) err.push('total ' + total);
      return err;
    });
    assert.deepEqual(problemas, []);
  });
  it('cobertura de sentencias del script >= 80 % tras una sesión completa', async () => {
    const page = p.page;
    await h.iniciarPartida(page);
    await page.click('#btn-toggle-sandbox'); await page.click('#btn-toggle-sandbox');
    await page.click('#door-0');
    await page.click('#btn-show-hint');
    await h.resolver(page, false); await page.click('#btn-retry-challenge');
    await page.click('#btn-submit-challenge');
    await page.click('#btn-mission-back');
    await h.jugarMision(page, 0);
    for (let mi = 1; mi < 5; mi++) await h.jugarMision(page, mi);
    await page.click('#pwd-toggle').catch(() => {});
    await page.click('#btn-report-hub');
    await page.click('#btn-hub-scores');
    await page.click('#btn-nav-menu');
    await page.click('#btn-open-instructions'); await page.click('#btn-inst-back');
    await page.click('#btn-reset-menu'); await page.keyboard.press('Tab'); await page.keyboard.press('Escape');
    await page.click('#btn-sound-toggle');
    const cov = await page.coverage.stopJSCoverage();
    const entrada = cov.find((e) => e.source && e.source.includes('CyberShieldCore'));
    const cubierto = new Uint8Array(entrada.source.length);
    for (const f of entrada.functions) for (const r of f.ranges) cubierto.fill(r.count > 0 ? 1 : 0, r.startOffset, r.endOffset);
    const porcentaje = (cubierto.reduce((a, b) => a + b, 0) / cubierto.length) * 100;
    console.log('   cobertura del script: ' + porcentaje.toFixed(1) + ' %');
    require('fs').writeFileSync(require('path').join(__dirname, '..', 'rendimiento', 'resultados', 'cobertura-codigo.json'),
      JSON.stringify({ fecha: new Date().toISOString(), porcentaje: +porcentaje.toFixed(1), bytesTotales: cubierto.length, umbral: 80 }, null, 2));
    assert.ok(porcentaje >= 80, 'cobertura ' + porcentaje.toFixed(1));
  });
});
