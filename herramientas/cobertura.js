#!/usr/bin/env node
/**
 * COBERTURA DE CÓDIGO (para Coveralls)
 * Ejecuta las 27 suites de pruebas midiendo qué líneas del código de la aplicación se ejecutan:
 *   - servidor.js          → cobertura de Node.js con c8 (V8)
 *   - src/cybershield.js   → cobertura del navegador (Chromium/V8 vía Playwright), atribuida línea a línea al archivo fuente
 * y genera en coverage/:
 *   - lcov.info            → el archivo que se sube a Coveralls
 *   - index.html           → informe navegable (archivo a archivo, línea a línea)
 *   - coverage-summary.json y resumen en consola
 *
 * Uso: node herramientas/cobertura.js            (o npm run cobertura)
 *      node herramientas/cobertura.js --sin-pruebas   (solo regenera los informes a partir de los datos ya recogidos)
 * Umbrales mínimos (falla si no se alcanzan): líneas 80 %, funciones 80 %, ramas 70 %.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const v8toIstanbul = require('v8-to-istanbul');
const libCoverage = require('istanbul-lib-coverage');
const libReport = require('istanbul-lib-report');
const reports = require('istanbul-reports');

const RAIZ = path.join(__dirname, '..');
const DIR = path.join(RAIZ, 'coverage');
const DIR_NAV = path.join(DIR, 'tmp-navegador');
const DIR_NODE = path.join(DIR, 'tmp-node');
const FUENTE_JUEGO = path.join(RAIZ, 'src', 'cybershield.js');
const UMBRALES = { lines: 80, functions: 80, branches: 70 };

function ejecutarPruebas() {
  fs.rmSync(DIR, { recursive: true, force: true });
  fs.mkdirSync(DIR_NAV, { recursive: true });
  const c8 = require.resolve('c8/bin/c8.js');
  const args = [c8, '--reporter=json', `--report-dir=${DIR_NODE}`, `--temp-directory=${path.join(DIR, 'tmp-v8')}`,
    '--include=servidor.js', '--all=false', '--exclude-after-remap=false',
    process.execPath, '--test', '--test-concurrency=1', '--test-reporter=spec', 'pruebas/*.test.js'];
  console.log('Ejecutando las 27 suites con medición de cobertura…\n');
  const r = spawnSync(process.execPath, args, { cwd: RAIZ, stdio: 'inherit', env: { ...process.env, COBERTURA_DIR: DIR_NAV } });
  return r.status;
}

/** Convierte las coberturas V8 del navegador en cobertura Istanbul de src/cybershield.js. */
async function coberturaNavegador(mapa) {
  const fuente = fs.readFileSync(FUENTE_JUEGO, 'utf8').replace(/\n+$/, '');
  const archivos = fs.existsSync(DIR_NAV) ? fs.readdirSync(DIR_NAV).filter((f) => f.endsWith('.json')) : [];
  let usadas = 0; let descartadas = 0;
  for (const f of archivos) {
    for (const entrada of JSON.parse(fs.readFileSync(path.join(DIR_NAV, f), 'utf8'))) {
      const inicio = entrada.source.indexOf(fuente);
      if (inicio < 0) continue; // otra versión del script: se ignora
      // Solo se aceptan mediciones COMPLETAS: debe existir el rango del script entero. Si falta (p. ej. la medición
      // empezó después de cargar la página), v8-to-istanbul daría por ejecutadas las líneas sin datos e inflaría la cobertura.
      const completo = entrada.functions.some((fn) => fn.ranges.some((r) => r.startOffset <= inicio && r.endOffset >= inicio + fuente.length));
      if (!completo) { descartadas += 1; continue; }
      const conv = v8toIstanbul(FUENTE_JUEGO, inicio, { source: fuente });
      await conv.load();
      conv.applyCoverage(entrada.functions);
      mapa.merge(conv.toIstanbul());
      usadas += 1;
    }
  }
  return { paginas: usadas, descartadas, archivos: archivos.length };
}

function coberturaNode(mapa) {
  const f = path.join(DIR_NODE, 'coverage-final.json');
  if (fs.existsSync(f)) mapa.merge(JSON.parse(fs.readFileSync(f, 'utf8')));
}

async function main() {
  let codigo = 0;
  if (!process.argv.includes('--sin-pruebas')) codigo = ejecutarPruebas();

  const mapa = libCoverage.createCoverageMap({});
  coberturaNode(mapa);
  const nav = await coberturaNavegador(mapa);

  // Rutas relativas a la raíz (Coveralls las enlaza con los archivos del repositorio)
  const relativo = libCoverage.createCoverageMap({});
  for (const archivo of mapa.files()) {
    const datos = mapa.fileCoverageFor(archivo).toJSON();
    datos.path = path.relative(RAIZ, archivo).split(path.sep).join('/');
    relativo.addFileCoverage(datos);
  }

  const contexto = libReport.createContext({ dir: DIR, coverageMap: relativo, defaultSummarizer: 'flat', sourceFinder: (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8') });
  for (const tipo of ['lcovonly', 'html', 'json-summary', 'text']) reports.create(tipo, tipo === 'lcovonly' ? { file: 'lcov.info' } : {}).execute(contexto);
  fs.rmSync(path.join(DIR, 'tmp-v8'), { recursive: true, force: true });

  const t = relativo.getCoverageSummary().toJSON();
  console.log(`\nPáginas del navegador medidas: ${nav.paginas} (descartadas por medición incompleta: ${nav.descartadas})`);
  console.log(`Total · líneas ${t.lines.pct} % · sentencias ${t.statements.pct} % · funciones ${t.functions.pct} % · ramas ${t.branches.pct} %`);
  console.log('LCOV para Coveralls: coverage/lcov.info · Informe HTML: coverage/index.html');
  const fallos = Object.entries(UMBRALES).filter(([k, min]) => t[k].pct < min).map(([k, min]) => `${k} ${t[k].pct} % < ${min} %`);
  if (fallos.length) { console.error('\n✖ Cobertura por debajo del mínimo: ' + fallos.join(' · ')); codigo = codigo || 1; }
  if (!relativo.files().includes('src/cybershield.js') || !relativo.files().includes('servidor.js')) { console.error('✖ Falta cobertura de algún archivo de la aplicación'); codigo = codigo || 1; }
  process.exit(codigo);
}

main().catch((e) => { console.error(e); process.exit(1); });
