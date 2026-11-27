#!/usr/bin/env node
/**
 * PRUEBA DE COBERTURA DE SNYK
 * Hace un inventario de todo el código del proyecto y calcula qué parte puede analizar cada producto de Snyk:
 *   - Snyk Code (SAST)        → archivos de código fuente (JavaScript/TypeScript/HTML…)
 *   - Snyk Open Source (SCA)  → manifiestos de dependencias (package.json + package-lock.json)
 *   - Snyk Container          → imágenes Docker referenciadas en docker-compose.yml
 * y señala lo que queda FUERA (por tipo de archivo no soportado, por exclusión en .snyk o por
 * estar el JavaScript incrustado dentro de un HTML).
 *
 * Uso:  node herramientas/cobertura-snyk.js            → muestra el resumen y genera seguridad/cobertura-snyk.html
 *       node herramientas/cobertura-snyk.js --minimo 100 → además sale con código 1 si la cobertura JS es menor
 */
'use strict';
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const SALIDA = path.join(RAIZ, 'seguridad', 'cobertura-snyk.html');

// Extensiones que Snyk Code analiza para JavaScript (docs.snyk.io → Supported languages → JavaScript)
const SNYK_CODE = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.cts', '.mts', '.vue', '.ejs', '.es', '.es6', '.htm', '.html']);
const IGNORAR_DIRS = new Set(['node_modules', '.git']);
const TIPOS = {
  '.js': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript', '.html': 'HTML', '.htm': 'HTML', '.css': 'CSS',
  '.sh': 'Shell', '.bat': 'Batch (Windows)', '.yml': 'YAML', '.yaml': 'YAML', '.jmx': 'Plan JMeter (XML)', '.json': 'JSON'
};
const NO_CODIGO = new Set(['.md', '.txt', '.png', '.jpg', '.zip', '.gz', '.jtl', '.log', '.jsonl', '.svg', '.ico', '.woff2']);

/* ---------- .snyk: patrones de exclusión ---------- */
function leerExclusiones() {
  const f = path.join(RAIZ, '.snyk');
  if (!fs.existsSync(f)) return [];
  const lineas = fs.readFileSync(f, 'utf8').split('\n');
  const pat = [];
  let dentro = false;
  for (const l of lineas) {
    if (/^exclude:/.test(l)) { dentro = true; continue; }
    if (dentro && /^\S/.test(l)) dentro = false;
    const m = dentro && l.match(/^\s+-\s+(.+?)\s*$/);
    if (m) pat.push(m[1].replace(/^['"]|['"]$/g, ''));
  }
  return pat;
}
function globARegex(g) {
  const r = g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\/?/g, '§').replace(/\*/g, '[^/]*').replace(/§/g, '.*');
  return new RegExp('^' + r + '$');
}

/* ---------- Inventario ---------- */
function recorrer(dir, lista = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORAR_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) recorrer(p, lista);
    else lista.push(p);
  }
  return lista;
}
const contarLineas = (t) => t.split('\n').filter((l) => l.trim() !== '').length;

/** Líneas de JavaScript incrustado en <script> dentro de un HTML. */
function jsIncrustado(texto) {
  let total = 0;
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(texto))) total += contarLineas(m[1]);
  return total;
}

function analizar() {
  const excl = leerExclusiones();
  const regex = excl.map(globARegex);
  const archivos = recorrer(RAIZ).map((abs) => {
    const rel = path.relative(RAIZ, abs).split(path.sep).join('/');
    const ext = path.extname(abs).toLowerCase();
    return { rel, ext, abs };
  }).filter((a) => !NO_CODIGO.has(a.ext) && a.rel !== '.snyk');

  const filas = archivos.map((a) => {
    const texto = fs.readFileSync(a.abs, 'utf8');
    const lineas = contarLineas(texto);
    const excluido = regex.some((r) => r.test(a.rel));
    const generado = /^rendimiento\/resultados\//.test(a.rel);
    const fila = { ...a, lineas, tipo: TIPOS[a.ext] || a.ext, lineasJS: 0, estado: '', producto: '', motivo: '' };
    if (a.ext === '.js' || a.ext === '.mjs' || a.ext === '.cjs') fila.lineasJS = lineas;
    if (a.ext === '.html' || a.ext === '.htm') fila.lineasJS = jsIncrustado(texto);

    if (excluido) {
      fila.estado = 'excluido';
      fila.producto = '—';
      fila.motivo = generado ? 'Informe generado automáticamente (excluido en .snyk)' : 'Excluido en .snyk';
      if (/^CyberShield\.html$/.test(a.rel)) fila.motivo = 'Archivo construido a partir de src/: su código se analiza en src/ (excluido en .snyk para no duplicar hallazgos)';
    } else if (SNYK_CODE.has(a.ext)) {
      if ((a.ext === '.html' || a.ext === '.htm') && fila.lineasJS > 50) {
        fila.estado = 'parcial';
        fila.producto = 'Snyk Code';
        fila.motivo = `Contiene ${fila.lineasJS} líneas de JavaScript incrustado en <script>. Se recomienda moverlo a un archivo .js para que el análisis SAST lo trate como JavaScript completo (flujo de datos entre funciones).`;
      } else {
        fila.estado = 'analizado';
        fila.producto = 'Snyk Code';
        fila.motivo = 'Código fuente analizado por Snyk Code (SAST)';
      }
    } else if (a.rel === 'package.json' || a.rel === 'package-lock.json') {
      fila.estado = 'analizado'; fila.producto = 'Snyk Open Source'; fila.motivo = 'Manifiesto de dependencias analizado con snyk test (SCA)';
    } else if (/docker-compose\.ya?ml$/.test(a.rel)) {
      fila.estado = 'otro'; fila.producto = 'Snyk Container';
      fila.motivo = 'Snyk Code no lee YAML. Sus imágenes se analizan con: ' + (texto.match(/image:\s*(\S+)/g) || []).map((x) => 'snyk container test ' + x.replace(/image:\s*/, '')).join(' · ');
    } else {
      fila.estado = 'no-soportado'; fila.producto = '—';
      fila.motivo = {
        '.css': 'Hojas de estilo: Snyk Code no analiza CSS (no contiene lógica ejecutable; la CSP impide inyectar estilos externos)',
        '.sh': 'Script de terminal: Snyk Code no analiza Shell (solo lanza comandos del proyecto)',
        '.bat': 'Script de Windows: Snyk Code no analiza Batch (solo lanza comandos del proyecto)',
        '.yml': 'Configuración YAML (Prometheus / Grafana): Snyk Code no la analiza',
        '.yaml': 'Configuración YAML: Snyk Code no la analiza',
        '.jmx': 'Plan de pruebas de JMeter (XML de configuración, no código de la aplicación)',
        '.json': 'Datos/configuración JSON (panel de Grafana): no es código ejecutable'
      }[a.ext] || 'Tipo de archivo no soportado por Snyk Code';
    }
    return fila;
  }).sort((x, y) => x.rel.localeCompare(y.rel));

  // Cobertura del código JavaScript (la lógica): líneas JS en archivos que Snyk Code analiza como JS completo
  const jsTotal = filas.filter((f) => f.estado !== 'excluido' || /^CyberShield\.html$/.test(f.rel)).reduce((a, f) => a + f.lineasJS, 0);
  const jsPropias = filas.filter((f) => !/^CyberShield\.html$/.test(f.rel) && f.estado !== 'excluido');
  const jsAnalizado = jsPropias.filter((f) => f.estado === 'analizado').reduce((a, f) => a + f.lineasJS, 0);
  const jsParcial = filas.filter((f) => f.estado === 'parcial').reduce((a, f) => a + f.lineasJS, 0);
  const jsDuplicado = filas.filter((f) => /^CyberShield\.html$/.test(f.rel) && f.estado === 'excluido').reduce((a, f) => a + f.lineasJS, 0);
  const baseJS = jsAnalizado + jsParcial;
  const pctJS = baseJS ? (jsAnalizado / baseJS) * 100 : 0;

  // Cobertura de archivos de código (sin excluidos)
  const considerados = filas.filter((f) => f.estado !== 'excluido');
  const cubiertos = considerados.filter((f) => f.estado === 'analizado' || f.estado === 'otro');
  const pctArchivos = considerados.length ? (cubiertos.length / considerados.length) * 100 : 0;

  return { filas, excl, jsTotal, jsAnalizado, jsParcial, jsDuplicado, pctJS, pctArchivos, considerados: considerados.length, cubiertos: cubiertos.length };
}

/** Agrupa los archivos excluidos de una misma carpeta raíz en una sola fila. */
function agrupar(filas) {
  const salida = []; const grupos = new Map();
  for (const f of filas) {
    if (f.estado !== 'excluido' || /^CyberShield\.html$/.test(f.rel)) { salida.push(f); continue; }
    const clave = f.rel.split('/').slice(0, 2).join('/') + '/**';
    const g = grupos.get(clave) || { rel: clave, tipo: 'Varios', lineas: 0, lineasJS: 0, estado: 'excluido', producto: '—', motivo: f.motivo, n: 0 };
    g.lineas += f.lineas; g.lineasJS += f.lineasJS; g.n += 1; grupos.set(clave, g);
  }
  for (const g of grupos.values()) { g.motivo += ` (${g.n} archivos)`; salida.push(g); }
  return salida.sort((x, y) => x.rel.localeCompare(y.rel));
}

function html(r) {
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const ETIQ = { analizado: ['✔ Analizado', 'ok'], parcial: ['⚠ Parcial', 'av'], otro: ['✔ Otro producto', 'ok'], 'no-soportado': ['ℹ No aplica', 'mu'], excluido: ['— Excluido', 'mu'] };
  const visibles = agrupar(r.filas);
  const filas = visibles.map((f) => `<tr><td><code>${esc(f.rel)}</code></td><td>${esc(f.tipo)}</td><td>${f.lineas}</td><td>${f.lineasJS || ''}</td>
<td class="${ETIQ[f.estado][1]}">${ETIQ[f.estado][0]}</td><td>${esc(f.producto)}</td><td>${esc(f.motivo)}</td></tr>`).join('');
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Cobertura de Snyk</title>
<style>:root{--bg:#f6f8fc;--s:#fff;--b:#d8deea;--t:#0f172a;--t2:#334155;--c:#0e7490;--ok:#047857;--ko:#be123c;--av:#b45309;--mu:#64748b}
@media (prefers-color-scheme: dark){:root{--bg:#070b14;--s:#111a2e;--b:#1f2c47;--t:#e8eefc;--t2:#b4c0da;--c:#22d3ee;--ok:#10b981;--ko:#f43f5e;--av:#f59e0b;--mu:#8492b0}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--t);font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}main{max-width:1180px;margin:0 auto;padding:28px 16px 60px}
h1{font-size:1.6rem;margin:0 0 6px}h2{font-size:1.15rem;margin:30px 0 10px;border-bottom:2px solid var(--b);padding-bottom:5px}p,li{color:var(--t2)}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin:16px 0}.kpi{background:var(--s);border:1px solid var(--b);border-radius:12px;padding:14px}.kpi small{display:block;color:var(--mu)}.kpi b{font:700 1.5rem ui-monospace,Menlo,Consolas,monospace}
.tw{overflow-x:auto}table{width:100%;border-collapse:collapse;background:var(--s);font-size:.86rem}th,td{border:1px solid var(--b);padding:7px 9px;text-align:left;vertical-align:top}th{color:var(--c)}
.ok{color:var(--ok);font-weight:700}.ko{color:var(--ko);font-weight:700}.av{color:var(--av);font-weight:700}.mu{color:var(--mu);font-weight:700}code{font-family:ui-monospace,Menlo,Consolas,monospace;word-break:break-all}td:last-child{min-width:240px}</style></head>
<body><main><h1>Prueba de cobertura de Snyk · CyberShield</h1><p>Generado el ${esc(new Date().toLocaleString('es-ES'))}. Inventario de todo el código del proyecto y qué parte analiza cada producto de Snyk.</p>
<div class="kpis"><div class="kpi"><small>Cobertura del código JavaScript (lógica)</small><b class="${r.pctJS >= 100 ? 'ok' : 'av'}">${r.pctJS.toFixed(1)} %</b></div>
<div class="kpi"><small>Líneas JS analizadas por Snyk Code</small><b>${r.jsAnalizado}</b></div>
<div class="kpi"><small>Líneas JS solo en HTML (parcial)</small><b class="${r.jsParcial ? 'av' : 'ok'}">${r.jsParcial}</b></div>
<div class="kpi"><small>Archivos de código cubiertos</small><b>${r.cubiertos} / ${r.considerados}</b></div></div>
<h2>Cómo se calcula</h2><ul>
<li><b>Cobertura del código JavaScript:</b> líneas de JavaScript que están en archivos <code>.js</code> analizados por Snyk Code, divididas entre todas las líneas de JavaScript del proyecto (incluido el que está incrustado en <code>&lt;script&gt;</code> dentro de HTML). Es la cifra importante, porque ahí está la lógica que puede tener vulnerabilidades.</li>
<li><b>Archivos de código cubiertos:</b> archivos analizados por algún producto de Snyk, divididos entre todos los archivos de código no excluidos. Los scripts <code>.bat</code>/<code>.sh</code>, la configuración YAML, el plan de JMeter y el CSS no son tipos que Snyk Code analice.</li>
<li><b>ℹ No aplica:</b> tipos de archivo que Snyk Code no analiza por diseño (no son código de la aplicación). No es un fallo de seguridad ni de cobertura.</li>
<li><b>Excluidos (.snyk):</b> ${r.excl.map((e) => '<code>' + esc(e) + '</code>').join(', ') || 'ninguno'}.</li></ul>
<h2>Detalle por archivo</h2><div class="tw"><table><tr><th>Archivo</th><th>Tipo</th><th>Líneas</th><th>Líneas JS</th><th>Estado</th><th>Producto Snyk</th><th>Motivo</th></tr>${filas}</table></div>
</main></body></html>`;
}

if (require.main === module) {
  const r = analizar();
  fs.mkdirSync(path.dirname(SALIDA), { recursive: true });
  fs.writeFileSync(SALIDA, html(r));
  const vis = agrupar(r.filas);
  const ancho = Math.min(52, Math.max(...vis.map((f) => f.rel.length)));
  console.log('\nPRUEBA DE COBERTURA DE SNYK\n' + '='.repeat(27));
  console.log(`${'ARCHIVO'.padEnd(ancho)}  ${'ESTADO'.padEnd(12)}  ${'L. JS'.padStart(5)}  PRODUCTO`);
  for (const f of vis) console.log(`${f.rel.padEnd(ancho)}  ${f.estado.padEnd(12)}  ${String(f.lineasJS || '').padStart(5)}  ${f.producto}`);
  console.log(`\nCobertura del código JavaScript: ${r.pctJS.toFixed(1)} %  (${r.jsAnalizado} líneas analizadas, ${r.jsParcial} solo dentro de HTML)`);
  console.log(`Archivos de código cubiertos:    ${r.cubiertos} / ${r.considerados} (${r.pctArchivos.toFixed(1)} %)`);
  console.log(`Informe: ${path.relative(process.cwd(), SALIDA)}`);
  const i = process.argv.indexOf('--minimo');
  if (i !== -1 && r.pctJS < Number(process.argv[i + 1])) { console.error(`\n✖ La cobertura JS (${r.pctJS.toFixed(1)} %) es menor que el mínimo (${process.argv[i + 1]} %)`); process.exit(1); }
}

module.exports = { analizar };
