'use strict';
// Snyk Code (HttpToHttps/test) — falso positivo aceptado: las pruebas se conectan al servidor local de CyberShield en 127.0.0.1 (el tráfico no sale del equipo); el modo HTTPS se prueba aparte en 03-sistema
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./ayudantes');
const http = require('http');

// Comportamiento con muchos usuarios / peticiones simultáneas.
describe('13 · Pruebas de carga', () => {
  let env;
  before(async () => { env = await h.preparar(); });
  after(async () => env.cerrar());

  it('8 estudiantes juegan a la vez sin interferirse', async () => {
    const N = 8;
    const resultados = await Promise.all(Array.from({ length: N }, async (_, i) => {
      const p = await h.nuevaPagina(env);
      await h.jugarTodo(p.page, 'Estudiante ' + i);
      const r = { nombre: await h.texto(p.page, '#report-student-name'), puntos: await h.texto(p.page, '#hud-score'), errores: p.errores.length };
      await p.cerrar();
      return r;
    }));
    resultados.forEach((r, i) => {
      assert.equal(r.nombre, 'Estudiante ' + i);
      assert.equal(r.puntos, 'Puntos: 500/500');
      assert.equal(r.errores, 0);
    });
  });

  it('el servidor responde 300 peticiones concurrentes con 200 OK', async () => {
    const pedir = () => new Promise((resolve, reject) => {
      http.get(env.url, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); }).on('error', reject);
    });
    const t0 = Date.now();
    const codigos = await Promise.all(Array.from({ length: 300 }, pedir));
    console.log('   300 peticiones en ' + (Date.now() - t0) + ' ms');
    assert.ok(codigos.every((c) => c === 200));
  });
});
