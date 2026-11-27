'use strict';
/**
 * DIAGNÓSTICO DE CLAVES DE NEW RELIC
 * Comprueba, sin enviar datos del juego, si tus claves son válidas y en qué región está tu cuenta.
 * Uso (Windows):  observabilidad\newrelic\diagnostico.bat
 *        o bien:  node observabilidad/newrelic/diagnostico.js   (con NEW_RELIC_LICENSE_KEY y, opcional, NEW_RELIC_USER_KEY)
 * Las claves nunca se muestran completas.
 */
const https = require('https');

const lic = (process.env.NEW_RELIC_LICENSE_KEY || '').trim();
const usr = (process.env.NEW_RELIC_USER_KEY || '').trim();
const oculto = (k) => (k ? `${k.slice(0, 4)}…${k.slice(-4)} (${k.length} caracteres)` : '(no indicada)');

function peticion(url, cabeceras, cuerpo) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const req = https.request({ hostname: u.hostname, path: u.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', ...cabeceras }, timeout: 15000 }, (res) => {
      let t = ''; res.on('data', (d) => { t += d; }); res.on('end', () => resolve({ estado: res.statusCode, cuerpo: t.slice(0, 300) }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ estado: 0, cuerpo: 'tiempo agotado' }); });
    req.on('error', (e) => resolve({ estado: 0, cuerpo: e.message }));
    req.end(cuerpo);
  });
}

(async () => {
  console.log('\nDIAGNÓSTICO DE NEW RELIC\n========================');
  console.log('License key:', oculto(lic));
  if (lic) {
    const avisos = [];
    if (lic.length !== 40) avisos.push(`tiene ${lic.length} caracteres y debería tener 40 (¿se copió incompleta o con espacios?)`);
    if (!/NRAL$/.test(lic)) avisos.push('no termina en "NRAL": puede que no sea una License key (INGEST - LICENSE)');
    if (/^NRAK-/.test(lic)) avisos.push('empieza por "NRAK-": eso es una User key, no una License key');
    if (/^NRJS-/.test(lic)) avisos.push('empieza por "NRJS-": eso es una Browser key, no una License key');
    console.log(avisos.length ? '  ⚠ Formato: ' + avisos.join(' · ') : '  ✔ Formato correcto (40 caracteres, termina en NRAL)');

    const log = JSON.stringify([{ message: 'Diagnóstico de CyberShield', service: { name: 'cybershield-diagnostico' } }]);
    const pruebas = [
      ['Logs  EE. UU.', 'https://log-api.newrelic.com/log/v1', { 'Api-Key': lic }, log],
      ['Logs  Europa ', 'https://log-api.eu.newrelic.com/log/v1', { 'Api-Key': lic }, log],
      ['OTLP  EE. UU.', 'https://otlp.nr-data.net/v1/logs', { 'api-key': lic }, '{"resourceLogs":[]}'],
      ['OTLP  Europa ', 'https://otlp.eu01.nr-data.net/v1/logs', { 'api-key': lic }, '{"resourceLogs":[]}']
    ];
    const ok = {}; let conectadas = 0;
    for (const [nombre, url, cab, cuerpo] of pruebas) {
      const r = await peticion(url, cab, cuerpo);
      const valido = r.estado >= 200 && r.estado < 300;
      ok[nombre.trim()] = valido; if (r.estado) conectadas += 1;
      console.log(`  ${valido ? '✔' : '✖'} ${nombre} → HTTP ${r.estado || 'sin conexión'}${valido ? ' (clave aceptada)' : r.estado === 403 ? ' (clave rechazada)' : ' ' + r.cuerpo}`);
    }
    console.log('\nConclusión (License key):');
    if (!conectadas) console.log('  ✖ No hay conexión con New Relic: revisa tu conexión a Internet o si un antivirus/proxy la bloquea.');
    else if (ok['Logs  EE. UU.'] || ok['OTLP  EE. UU.']) console.log('  ✔ La clave es válida y tu cuenta está en EE. UU. Usa NEW_RELIC_REGION=US.');
    else if (ok['Logs  Europa'] || ok['OTLP  Europa']) console.log('  ✔ La clave es válida y tu cuenta está en EUROPA. Antes de la prueba escribe:  set NEW_RELIC_REGION=EU');
    else console.log('  ✖ New Relic rechaza la clave en todas las regiones. Copia de nuevo la clave de la fila INGEST - LICENSE (icono de copiar) o\n    revisa si tu cuenta pide verificar el correo electrónico o tiene la ingesta de datos desactivada.');
  }

  if (usr) {
    console.log('\nUser key:', oculto(usr));
    for (const [nombre, url] of [['NerdGraph EE. UU.', 'https://api.newrelic.com/graphql'], ['NerdGraph Europa ', 'https://api.eu.newrelic.com/graphql']]) {
      const r = await peticion(url, { 'API-Key': usr }, JSON.stringify({ query: '{ actor { accounts { id name } } }' }));
      const cuentas = (r.cuerpo.match(/"id":(\d+)/g) || []).map((x) => x.replace('"id":', ''));
      const valido = r.estado === 200 && cuentas.length > 0;
      console.log(`  ${valido ? '✔' : '✖'} ${nombre} → HTTP ${r.estado}${valido ? ' · Account ID: ' + cuentas.join(', ') : ' (clave rechazada)'}`);
    }
  }
  console.log('');
})();
