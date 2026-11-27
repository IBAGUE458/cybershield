#!/usr/bin/env node
/**
 * Construye CyberShield.html (un solo archivo, se abre con doble clic) a partir del código fuente en src/:
 *   src/plantilla.html  → estructura HTML
 *   src/cybershield.css → estilos
 *   src/cybershield.js  → lógica del juego
 * y recalcula el hash SHA-256 de la CSP para que el navegador permita ejecutar el script.
 *
 * El código se mantiene en archivos separados para que herramientas de análisis como Snyk Code
 * analicen el JavaScript completo (no incrustado dentro de un HTML).
 *
 * Uso:  node herramientas/construir.js              → genera CyberShield.html
 *       node herramientas/construir.js --comprobar  → solo verifica que CyberShield.html está al día con src/
 */
'use strict';
const fs = require('fs');
const path = require('path');
const csp = require('./actualizar-csp');

const RAIZ = path.join(__dirname, '..');
const SRC = path.join(RAIZ, 'src');

function sangrar(texto, n) {
  const pre = ' '.repeat(n);
  return texto.replace(/\n+$/, '').split('\n').map((l) => (l.trim() ? pre + l : l)).join('\n');
}

function construir() {
  const plantilla = fs.readFileSync(path.join(SRC, 'plantilla.html'), 'utf8');
  const css = fs.readFileSync(path.join(SRC, 'cybershield.css'), 'utf8');
  const js = fs.readFileSync(path.join(SRC, 'cybershield.js'), 'utf8');
  if (!plantilla.includes('/*@@CSS@@*/') || !plantilla.includes('//@@JS@@')) throw new Error('La plantilla no tiene los marcadores /*@@CSS@@*/ y //@@JS@@');
  if (/<\/script/i.test(js)) throw new Error('src/cybershield.js no puede contener "</script" (rompería el HTML)');
  if (/<\/style/i.test(css)) throw new Error('src/cybershield.css no puede contener "</style"');
  let html = plantilla
    .replace('    /*@@CSS@@*/', () => sangrar(css, 4))
    // El JS se incrusta TAL CUAL (sin sangría) para que cada línea coincida con src/cybershield.js:
    // así la cobertura medida en el navegador se puede atribuir línea a línea al archivo fuente (LCOV / Coveralls).
    .replace('    //@@JS@@', () => js.replace(/\n+$/, ''));
  const hash = csp.calcularHash(csp.extraerScript(html));
  html = html.replace(/script-src '[^']+'/, () => `script-src '${hash}'`);
  return { html, hash };
}

module.exports = { construir };

if (require.main === module) {
  const { html, hash } = construir();
  const destino = path.join(RAIZ, 'CyberShield.html');
  if (process.argv.includes('--comprobar')) {
    const actual = fs.existsSync(destino) ? fs.readFileSync(destino, 'utf8') : '';
    if (actual === html) { console.log('CyberShield.html está al día con src/ ✔'); process.exit(0); }
    console.error('CyberShield.html NO coincide con src/. Ejecuta: npm run construir');
    process.exit(1);
  }
  fs.writeFileSync(destino, html);
  console.log(`CyberShield.html construido desde src/ (${(html.length / 1024).toFixed(1)} KB) · CSP ${hash}`);
}
