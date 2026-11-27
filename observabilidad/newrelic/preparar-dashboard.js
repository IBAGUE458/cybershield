'use strict';
/**
 * Pone tu número de cuenta (Account ID) de New Relic en el dashboard para poder importarlo.
 * Uso: node observabilidad/newrelic/preparar-dashboard.js 1234567
 * Genera observabilidad/newrelic/dashboard-listo.json → New Relic: Dashboards → Import dashboard → pegar el JSON.
 * (El Account ID no es secreto: aparece en la URL de one.newrelic.com y en el menú de tu cuenta.)
 */
const fs = require('fs');
const path = require('path');
const id = Number(process.argv[2]);
if (!Number.isInteger(id) || id <= 0) { console.error('Indica tu Account ID numérico. Ejemplo: node observabilidad/newrelic/preparar-dashboard.js 1234567'); process.exit(1); }
const dash = JSON.parse(fs.readFileSync(path.join(__dirname, 'dashboard-cybershield.json'), 'utf8'));
for (const p of dash.pages) for (const w of p.widgets) for (const q of w.rawConfiguration.nrqlQueries) q.accountIds = [id];
fs.writeFileSync(path.join(__dirname, 'dashboard-listo.json'), JSON.stringify(dash, null, 2) + '\n');
console.log('Listo: observabilidad/newrelic/dashboard-listo.json (cuenta ' + id + '). Impórtalo en New Relic → Dashboards → Import dashboard.');
