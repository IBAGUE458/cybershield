// Convierte los documentos Markdown del proyecto en páginas HTML estáticas (sin scripts) para verlas en el navegador.
// Uso: node herramientas/md-a-html.js [README.md | RENDIMIENTO.md | SNYK.md | COVERALLS.md | NEWRELIC.md | todas]
// Seguridad: solo se aceptan los documentos de la lista DOCUMENTOS. Las rutas de lectura y escritura salen de esa
// lista fija y nunca del texto que se escribe en la línea de comandos (evita path traversal).
'use strict';
const fs = require('fs');
const path = require('path');
const RAIZ = path.join(__dirname, '..');
const DOCUMENTOS = [
  { md: 'README.md', html: 'GUIA.html', titulo: 'CyberShield — Guía y 27 pruebas' },
  { md: 'RENDIMIENTO.md', html: 'GUIA-RENDIMIENTO.html', titulo: 'CyberShield — Rendimiento y observabilidad' },
  { md: 'SNYK.md', html: 'GUIA-SNYK.html', titulo: 'CyberShield — Pruebas con Snyk' },
  { md: 'COVERALLS.md', html: 'GUIA-COVERALLS.html', titulo: 'CyberShield — Cobertura con Coveralls' },
  { md: 'NEWRELIC.md', html: 'GUIA-NEWRELIC.html', titulo: 'CyberShield — Observabilidad con New Relic' }
];
const pedido = process.argv[2] || 'README.md';
const elegidos = pedido === 'todas' ? DOCUMENTOS : DOCUMENTOS.filter((d) => d.md === pedido);
if (!elegidos.length) {
  console.error('Documento no permitido. Opciones: ' + DOCUMENTOS.map((d) => d.md).join(', ') + ', todas');
  process.exit(1);
}
for (const doc of elegidos) convertir(doc);

function convertir(doc) {
const entrada = doc.md;
const salidaHtml = doc.html;
const md = fs.readFileSync(path.join(RAIZ, entrada), 'utf8');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const tituloPagina = esc(doc.titulo);
const inline = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/(https?:\/\/[^\s)]+)/g, '<a href="$1">$1</a>');
const lines = md.split('\n'); let out = []; let i = 0;
while (i < lines.length) {
  const l = lines[i];
  if (l.startsWith('```')) { const buf = []; i++; while (i < lines.length && !lines[i].startsWith('```')) buf.push(lines[i++]); out.push('<pre><code>' + esc(buf.join('\n')) + '</code></pre>'); i++; continue; }
  if (l.startsWith('|')) {
    const rows = []; while (i < lines.length && lines[i].startsWith('|')) rows.push(lines[i++]);
    const cells = (r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    out.push('<div class="tw"><table><thead><tr>' + cells(rows[0]).map((c) => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>' +
      rows.slice(2).map((r) => '<tr>' + cells(r).map((c) => '<td>' + inline(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>');
    continue;
  }
  if (l.startsWith('> ')) { const buf = []; while (i < lines.length && lines[i].startsWith('>')) buf.push(lines[i++].replace(/^>\s?/, '')); out.push('<blockquote>' + inline(buf.join(' ')) + '</blockquote>'); continue; }
  const h = l.match(/^(#{1,3}) (.*)/); if (h) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }
  if (/^\s*- /.test(l)) { const buf = []; while (i < lines.length && /^\s*- /.test(lines[i])) buf.push(lines[i++].replace(/^\s*- /, '')); out.push('<ul>' + buf.map((x) => '<li>' + inline(x) + '</li>').join('') + '</ul>'); continue; }
  if (/^\d+\. /.test(l)) { const buf = []; while (i < lines.length && /^\d+\. /.test(lines[i])) buf.push(lines[i++].replace(/^\d+\. /, '')); out.push('<ol>' + buf.map((x) => '<li>' + inline(x) + '</li>').join('') + '</ol>'); continue; }
  if (l.trim()) out.push('<p>' + inline(l) + '</p>');
  i++;
}
const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${tituloPagina}</title>
<style>
:root{--bg:#070b14;--s:#111a2e;--b:#1f2c47;--t:#e8eefc;--t2:#b4c0da;--c:#22d3ee}
@media (prefers-color-scheme: light){:root{--bg:#f6f8fc;--s:#fff;--b:#d8deea;--t:#0f172a;--t2:#334155;--c:#0e7490}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--t);font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:1000px;margin:0 auto;padding:32px 16px 64px}h1{font-size:1.9rem;margin:0 0 16px}h2{margin-top:36px;border-bottom:1px solid var(--b);padding-bottom:6px}
p,blockquote,li{color:var(--t2)}code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.88em;background:var(--s);border:1px solid var(--b);padding:1px 5px;border-radius:5px}
pre{background:var(--s);border:1px solid var(--b);border-radius:10px;padding:14px;overflow-x:auto}pre code{border:0;padding:0;background:none}
blockquote{margin:16px 0;padding:12px 16px;border-left:4px solid var(--c);background:var(--s);border-radius:0 10px 10px 0}
.tw{overflow-x:auto;margin:12px 0}table{border-collapse:collapse;width:100%;font-size:.92rem;background:var(--s)}th,td{border:1px solid var(--b);padding:8px 10px;text-align:left;vertical-align:top}th{color:var(--c)}a{color:var(--c)}
</style></head><body><main>
${out.join('\n')}
</main></body></html>`;
fs.writeFileSync(path.join(RAIZ, salidaHtml), html);
console.log(salidaHtml + ' generado');
}
