'use strict';
/**
 * Utilidades compartidas por las 27 suites de prueba.
 * Requiere: npm install  (instala playwright)  y  npx playwright install chromium
 */
const { chromium } = require('playwright');
const { iniciarServidor } = require('../servidor');

// Modo cobertura (npm run cobertura): cada página guarda qué partes del JavaScript del juego se ejecutaron.
const COBERTURA_DIR = process.env.COBERTURA_DIR || '';
let contadorCobertura = 0;

/** Activa la cobertura V8 en una página y envuelve stopJSCoverage para guardar siempre el resultado en disco. */
async function activarCobertura(page) {
  await page.coverage.startJSCoverage({ resetOnNavigation: false });
  const original = page.coverage.stopJSCoverage.bind(page.coverage);
  let resultado = null;
  page.coverage.stopJSCoverage = async () => {
    if (resultado) return resultado;
    resultado = await original();
    if (COBERTURA_DIR) {
      const fs = require('fs'); const path = require('path');
      const propio = resultado.filter((e) => e.source && e.source.includes('CyberShieldCore'));
      if (propio.length) {
        fs.mkdirSync(COBERTURA_DIR, { recursive: true });
        fs.writeFileSync(path.join(COBERTURA_DIR, `v8-${process.pid}-${++contadorCobertura}.json`), JSON.stringify(propio));
      }
    }
    return resultado;
  };
  return page;
}

const RUIDO_CONSOLA = /fonts\.(googleapis|gstatic)|ERR_FAILED|net::|Failed to load resource/i;
const PWD_VALIDA = 'Tigre-Nube-47-Volcan!';

/** Arranca servidor (puerto libre) + navegador. */
async function preparar() {
  const srv = await iniciarServidor(0);
  const browser = await chromium.launch();
  const url = `http://127.0.0.1:${srv.address().port}/`;
  const paginas = [];
  return {
    srv, browser, url, paginas,
    async cerrar() {
      for (const p of paginas) { if (!p.isClosed()) await p.coverage.stopJSCoverage().catch(() => {}); }
      await browser.close(); await new Promise((r) => srv.close(r));
    }
  };
}

/**
 * Abre una página nueva con contexto aislado. Bloquea Google Fonts (pruebas deterministas, sin red)
 * y recoge errores de JavaScript y de consola.
 */
async function nuevaPagina(env, opciones = {}) {
  const context = await env.browser.newContext({ acceptDownloads: true, ...(opciones.contexto || {}) });
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const page = await context.newPage();
  const errores = [];
  page.on('pageerror', (e) => errores.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !RUIDO_CONSOLA.test(m.text())) errores.push('console: ' + m.text()); });
  if (opciones.reloj) await page.clock.install();
  if (opciones.cobertura || COBERTURA_DIR) { await activarCobertura(page); env.paginas.push(page); }
  if (opciones.antes) await page.addInitScript(opciones.antes.fn, opciones.antes.arg);
  await page.goto(opciones.url || env.url);
  await page.waitForSelector('html[data-ready="true"]');
  return {
    context, page, errores,
    async cerrar() {
      if (COBERTURA_DIR || opciones.cobertura) await page.coverage.stopJSCoverage().catch(() => {});
      await context.close();
    }
  };
}

/** Escribe el nombre y entra a la sala principal. */
async function iniciarPartida(page, nombre = 'Estudiante Prueba') {
  await page.fill('#student-name-input', nombre);
  await page.click('#btn-start-game');
  await page.waitForSelector('#view-hub.active');
}

/** Lee qué desafío está montado y sus datos desde la API de solo lectura. */
async function desafioActual(page) {
  return page.evaluate(() => {
    const m = document.getElementById('challenge-mount');
    const mi = Number(m.dataset.mission); const li = Number(m.dataset.level); const v = Number(m.dataset.variant);
    return { mi, li, v, nivel: JSON.parse(JSON.stringify(window.CyberShieldCore.getChallenge(mi, li, v))) };
  });
}

/** Rellena el desafío actual (correcta o incorrectamente) sin enviarlo. */
async function rellenar(page, correcto = true) {
  const { nivel } = await desafioActual(page);
  switch (nivel.type) {
    case 'choice': {
      const idx = correcto ? nivel.correct : (nivel.correct + 1) % nivel.options.length;
      await page.check(`#ans-opt-${idx}`);
      break;
    }
    case 'multi': {
      const marcar = correcto ? nivel.correct : [nivel.options.findIndex((_, i) => !nivel.correct.includes(i))];
      for (const i of marcar) await page.check(`#ans-opt-${i}`);
      break;
    }
    case 'classify': {
      for (let i = 0; i < nivel.items.length; i++) {
        const v = correcto || i > 0 ? nivel.answers[i] : 1 - nivel.answers[i];
        await page.selectOption(`#cls-${i}`, String(v));
      }
      break;
    }
    case 'password':
      await page.fill('#pwd-input', correcto ? PWD_VALIDA : 'abc123');
      break;
    default: throw new Error('Tipo desconocido ' + nivel.type);
  }
}

/** Resuelve y envía el desafío actual. */
async function resolver(page, correcto = true) {
  await rellenar(page, correcto);
  await page.click('#btn-submit-challenge');
  await page.waitForSelector('#feedback-box.show');
}

/** Juega una misión completa desde la sala principal (3 niveles correctos). */
async function jugarMision(page, mi) {
  await page.click(`#door-${mi}`);
  await page.waitForSelector('#view-mission.active');
  for (let li = 0; li < 3; li++) {
    await resolver(page, true);
    await page.click('#btn-next-challenge');
  }
}

/** Juega las 5 misiones con 100 % de aciertos. */
async function jugarTodo(page, nombre) {
  await iniciarPartida(page, nombre);
  for (let mi = 0; mi < 5; mi++) {
    if (mi > 0) await page.waitForSelector('#view-hub.active');
    await jugarMision(page, mi);
  }
  await page.waitForSelector('#view-report.active');
}

/** Estado guardado en localStorage (o null). */
async function estadoGuardado(page) {
  return page.evaluate(() => {
    const t = localStorage.getItem('cybershield.v1');
    return t ? JSON.parse(t) : null;
  });
}

/** Guarda un estado arbitrario antes de que cargue la app. */
function sembrarEstado(estado) {
  return { fn: (s) => { if (!sessionStorage.getItem('sembrado')) { localStorage.setItem('cybershield.v1', typeof s === 'string' ? s : JSON.stringify(s)); sessionStorage.setItem('sembrado', '1'); } }, arg: estado };
}

async function texto(page, sel) { return (await page.textContent(sel)).trim(); }

module.exports = { preparar, nuevaPagina, iniciarPartida, desafioActual, rellenar, resolver, jugarMision, jugarTodo, estadoGuardado, sembrarEstado, texto, PWD_VALIDA };
