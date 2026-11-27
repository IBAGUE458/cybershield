'use strict';
/**
 * TELEMETRÍA DE CYBERSHIELD → NEW RELIC (OpenTelemetry)
 *
 * Se carga ANTES que el servidor con:   node -r ./observabilidad/newrelic/telemetria.js servidor.js
 * Envía a New Relic los tres pilares de la observabilidad:
 *   - TRAZAS:   una por cada petición HTTP (ruta, estado, duración, X-Request-Id)
 *   - MÉTRICAS: duración de peticiones (http.server), event loop, memoria, peticiones en curso, 429 del limitador
 *   - LOGS:     el registro JSON de cada petición, enlazado con su traza (logs in context)
 *
 * Configuración por variables de entorno (la clave NUNCA se escribe en el código):
 *   NEW_RELIC_LICENSE_KEY        License key de New Relic (tipo INGEST - LICENSE). Obligatoria para New Relic.
 *   NEW_RELIC_REGION             US (por defecto) o EU, según dónde esté tu cuenta.
 *   OTEL_SERVICE_NAME            Nombre del servicio en New Relic (por defecto: cybershield).
 *   OTEL_EXPORTER_OTLP_ENDPOINT  Para enviar a otro destino OTLP (p. ej. un receptor de prueba local).
 *   OTEL_EXPORTER_OTLP_PROTOCOL  http/protobuf (por defecto, el que recomienda New Relic) o http/json.
 *   CYBERSHIELD_ENTORNO          Valor de deployment.environment (por defecto: pruebas).
 * Si no hay ni NEW_RELIC_LICENSE_KEY ni OTEL_EXPORTER_OTLP_ENDPOINT, no hace nada.
 */
const ENDPOINTS = { US: 'https://otlp.nr-data.net', EU: 'https://otlp.eu01.nr-data.net' };

const clave = (process.env.NEW_RELIC_LICENSE_KEY || '').trim();
const region = (process.env.NEW_RELIC_REGION || (clave.startsWith('eu01') ? 'EU' : 'US')).toUpperCase();
const destino = (process.env.OTEL_EXPORTER_OTLP_ENDPOINT || (clave ? ENDPOINTS[region] || ENDPOINTS.US : '')).replace(/\/+$/, '');

if (!destino) {
  console.error('[telemetría] Desactivada: define NEW_RELIC_LICENSE_KEY para enviar datos a New Relic.');
} else {
  iniciar();
}

function iniciar() {
  const { NodeSDK } = require('@opentelemetry/sdk-node');
  const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http');
  const { BatchSpanProcessor } = require('@opentelemetry/sdk-trace');
  const { PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');
  const { BatchLogRecordProcessor } = require('@opentelemetry/sdk-logs');
  const { resourceFromAttributes } = require('@opentelemetry/resources');
  const api = require('@opentelemetry/api');

  const json = (process.env.OTEL_EXPORTER_OTLP_PROTOCOL || 'http/protobuf') === 'http/json';
  const tipo = json ? 'http' : 'proto';
  const { OTLPTraceExporter } = require(`@opentelemetry/exporter-trace-otlp-${tipo}`);
  const { OTLPMetricExporter } = require(`@opentelemetry/exporter-metrics-otlp-${tipo}`);
  // La constante de temporalidad solo la exporta el paquete HTTP (sirve para ambos protocolos)
  const { AggregationTemporalityPreference } = require('@opentelemetry/exporter-metrics-otlp-http');
  const { OTLPLogExporter } = require(`@opentelemetry/exporter-logs-otlp-${tipo}`);

  // New Relic autentica con la cabecera "api-key". La clave solo vive en la variable de entorno.
  const headers = clave ? { 'api-key': clave } : {};
  const opciones = (senal) => ({ url: `${destino}/v1/${senal}`, headers, timeoutMillis: 10000 });

  let version = '1.0.0';
  try { version = require('../../package.json').version; } catch (e) { /* sin versión */ }

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      'service.name': process.env.OTEL_SERVICE_NAME || 'cybershield',
      'service.version': version,
      'deployment.environment': process.env.CYBERSHIELD_ENTORNO || 'pruebas',
      'telemetry.distro': 'cybershield-otel'
    }),
    // New Relic acepta atributos de hasta 4095 caracteres
    spanLimits: { attributeValueLengthLimit: 4095 },
    spanProcessors: [new BatchSpanProcessor({ exporter: new OTLPTraceExporter(opciones('traces')) })],
    metricReaders: [new PeriodicExportingMetricReader({
      // New Relic recomienda temporalidad DELTA para las métricas OTLP
      exporter: new OTLPMetricExporter({ ...opciones('metrics'), temporalityPreference: AggregationTemporalityPreference.DELTA }),
      exportIntervalMillis: Number(process.env.OTEL_METRIC_EXPORT_INTERVAL || 10000)
    })],
    logRecordProcessors: [new BatchLogRecordProcessor({ exporter: new OTLPLogExporter(opciones('logs')) })],
    instrumentations: [new HttpInstrumentation({
      // Solo se instrumenta el servidor (peticiones entrantes); las salientes no interesan aquí
      ignoreOutgoingRequestHook: () => true
    })]
  });
  sdk.start();

  let cerrado = false;
  async function cerrar() {
    if (cerrado) return;
    cerrado = true;
    try { await sdk.shutdown(); } catch (e) { console.error('[telemetría] Error al vaciar los datos pendientes:', e.message); }
  }

  // Puente para servidor.js y rendimiento/ejecutar.js (sin dependencias duras: si no existe, no pasa nada)
  global.__cybershieldTelemetria = {
    activa: true,
    destino,
    api,
    logger: api.logs.getLogger('cybershield'),
    meter: api.metrics.getMeter('cybershield', version),
    cerrar
  };

  const salir = (senal) => { cerrar().finally(() => process.exit(senal === 'SIGINT' ? 130 : 0)); };
  process.once('SIGINT', () => salir('SIGINT'));
  process.once('SIGTERM', () => salir('SIGTERM'));
  process.once('beforeExit', () => { cerrar(); });

  const etiqueta = clave ? `New Relic (${region})` : destino;
  console.error(`[telemetría] Activa → ${etiqueta} · servicio "${process.env.OTEL_SERVICE_NAME || 'cybershield'}" · trazas, métricas y logs`);
}
