#!/usr/bin/env node
/**
 * Recalcula el hash SHA-256 del <script> en línea de CyberShield.html y lo escribe en la
 * meta Content-Security-Policy. Ejecútalo SIEMPRE después de modificar el JavaScript:
 *   node herramientas/actualizar-csp.js
 * Con --comprobar solo verifica (sale con código 1 si el hash no coincide).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ARCHIVO = path.join(__dirname, '..', 'CyberShield.html');

function extraerScript(html) {
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('No se encontró el <script> en línea');
  return m[1];
}
function calcularHash(script) {
  return 'sha256-' + crypto.createHash('sha256').update(script, 'utf8').digest('base64');
}
function hashActual(html) {
  const m = html.match(/script-src '([^']+)'/);
  return m ? m[1] : null;
}

module.exports = { extraerScript, calcularHash, hashActual, ARCHIVO };

if (require.main === module) {
  const html = fs.readFileSync(ARCHIVO, 'utf8');
  const esperado = calcularHash(extraerScript(html));
  if (process.argv.includes('--comprobar')) {
    const ok = hashActual(html) === esperado;
    console.log(ok ? 'CSP correcta: ' + esperado : 'CSP DESACTUALIZADA. Esperado ' + esperado);
    process.exit(ok ? 0 : 1);
  }
  const nuevo = html.replace(/script-src '[^']+'/, "script-src '" + esperado + "'");
  fs.writeFileSync(ARCHIVO, nuevo);
  console.log('CSP actualizada: ' + esperado);
}
