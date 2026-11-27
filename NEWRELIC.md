# CyberShield — Prueba de observabilidad con New Relic (paso a paso)

## ¿Qué es New Relic y qué se prueba?

**New Relic** (https://newrelic.com) es una plataforma de **observabilidad en la nube**. Recibe en tiempo real los datos de una aplicación mientras funciona y los muestra en paneles, con búsquedas y alertas. Con ella se puede saber qué hace la aplicación por dentro: qué peticiones recibe, cuánto tardan, si hay errores, cuánta memoria usa…

La prueba consiste en **conectar el servidor de CyberShield a New Relic**, generar carga con **k6** (o jugar a mano) y comprobar en New Relic que se ven los **tres pilares de la observabilidad**:

| Pilar | Qué envía CyberShield | Dónde se ve en New Relic |
|---|---|---|
| **Trazas** | Una por cada petición: ruta, código de estado, duración, `X-Request-Id`, y un evento cuando el limitador rechaza una petición (429) | APM & Services → cybershield → *Distributed tracing* |
| **Métricas** | Duración de las peticiones por ruta y estado (`cybershield.http.server.duration`), retardo del event loop, memoria, peticiones en curso, rechazos del limitador y la métrica estándar `http.server.request.duration` | *Metrics explorer* y el dashboard |
| **Logs** | El registro de cada petición (INFO, y WARN para 404, 405 y 429), **enlazado con su traza** (*logs in context*) | APM & Services → cybershield → *Logs* |

### Cómo está hecho

- Se usa **OpenTelemetry**, el estándar abierto de observabilidad que New Relic recomienda. El archivo `observabilidad/newrelic/telemetria.js` se carga **antes** que el servidor con `node -r` y envía los datos por **OTLP** a `https://otlp.nr-data.net` (cuentas de EE. UU.) o `https://otlp.eu01.nr-data.net` (cuentas de Europa).
- New Relic se autentica con la cabecera `api-key`. **La clave solo se lee de la variable de entorno `NEW_RELIC_LICENSE_KEY`**: nunca se escribe en el código ni se sube a GitHub.
- Sin la variable, la telemetría queda **desactivada** y el servidor funciona exactamente igual que antes.
- Las métricas usan temporalidad **DELTA** y los atributos se limitan a 4095 caracteres, tal como recomienda New Relic para OTLP.

## Verificación ya realizada (sin cuenta)

Antes de usar tu cuenta se verificó todo con un **receptor OTLP local** (`observabilidad/newrelic/receptor-prueba.js`) que imita a New Relic: acepta los mismos datos, exige la misma cabecera `api-key` y resume lo recibido.

```bash
npm run newrelic:verificar
```

Resultado: **11 de 11 comprobaciones superadas**.

- ✔ Llega la cabecera `api-key`, la autenticación de New Relic.
- ✔ `service.name = cybershield`.
- ✔ Trazas con nombre por ruta (`GET /`, `GET /health`, `POST /`, `GET otras`…).
- ✔ Cada traza lleva su `X-Request-Id`.
- ✔ Las 429 del limitador quedan como evento en la traza.
- ✔ Métrica de duración por ruta y estado.
- ✔ Métricas del event loop, la memoria y las peticiones en curso.
- ✔ Métrica del limitador (`rate_limited`).
- ✔ Métricas con temporalidad DELTA.
- ✔ Logs recibidos (WARN para 404, 405 y 429).
- ✔ Logs enlazados con su traza.

Esta verificación también está en la suite 03 de pruebas automáticas, así que GitHub Actions la comprueba en cada `push`.

Además se hizo una prueba de extremo a extremo con **k6**: 97 peticiones generaron **97 trazas y 97 logs, todos enlazados**, más 7 métricas. La latencia de k6 fue la misma que sin telemetría, así que la sobrecarga es inapreciable.

> La verificación encontró y corrigió dos errores antes de llegar a tu cuenta: los procesadores por lotes del SDK 3.x se construyen ahora con `{ exporter }`, y el paquete protobuf no exporta la constante de temporalidad. Sin la verificación, el servidor no habría arrancado en modo New Relic.

## Paso 1. Crear la cuenta y obtener la License key

1. Crea una cuenta gratis en https://newrelic.com/signup. El plan gratuito incluye 100 GB al mes.
2. Entra en https://one.newrelic.com → abajo a la izquierda, tu nombre → **API Keys**.
3. Busca la clave de tipo **INGEST - LICENSE** (termina en `NRAL`) → "…" → **Copy key**.
4. Fíjate en la **región** de tu cuenta: si la URL es `one.eu.newrelic.com` o la clave empieza por `eu01`, es **EU**; si no, es **US**.

> La License key sirve para **enviar** datos. No la compartas ni la subas a GitHub.

## Paso 2. Preparar el proyecto (una sola vez)

En la carpeta del proyecto:

```bash
npm install
```

Para la prueba de carga necesitas también **k6** (https://grafana.com/docs/k6/latest/set-up/install-k6/; en Windows: `winget install k6`). Sin k6 también puedes hacer la prueba jugando a mano (ver paso 3, opción B).

## Paso 3. Ejecutar la prueba enviando datos a New Relic

**Opción A (recomendada): prueba de carga con k6 y telemetría.**

En Windows, doble clic en `observabilidad\newrelic\ejecutar-newrelic.bat`. Te pedirá la License key, que solo queda en esa ventana. O bien, en `cmd`:

```bash
set NEW_RELIC_LICENSE_KEY=tu_license_key
```

```bash
set NEW_RELIC_REGION=US
```

```bash
npm run newrelic:k6
```

En Mac/Linux:

```bash
NEW_RELIC_LICENSE_KEY=tu_license_key NEW_RELIC_REGION=US npm run newrelic:k6
```

Arranca el servidor con la telemetría, lanza el escenario `carga` de k6 (50 usuarios, unos 2 minutos) y al terminar envía los últimos datos pendientes. Para lanzar los 1 503 usuarios simultáneos usa `npm run newrelic:k6:validacion`.

**Opción B: jugando a mano.**

```bash
npm run newrelic:servidor
```

Abre http://127.0.0.1:8080, juega unas partidas y pulsa **Ctrl+C** para terminar. Así se envían los últimos datos.

Al arrancar verás: `[telemetría] Activa → New Relic (US) · servicio "cybershield" · trazas, métricas y logs`.

## Paso 4. Ver los resultados en New Relic

Los datos aparecen en 1–2 minutos. En https://one.newrelic.com:

1. **APM & Services** → **cybershield**: resumen con *throughput* (peticiones por minuto), tiempo de respuesta y tasa de errores.
2. **Distributed tracing**: cada petición es una traza. Abre una de `GET /` para ver su duración, su `cybershield.request_id` y sus logs.
3. **Logs**: el registro de cada petición. Pulsa un log y luego *Show in context* para saltar a su traza.
4. **Metrics explorer** (o *Query your data*): busca `cybershield.` para ver las métricas propias.

## Paso 5. Importar el dashboard de CyberShield

1. Copia tu **Account ID**: el número que aparece en la URL de New Relic o en el menú de tu cuenta.
2. Genera el dashboard con tu número de cuenta:

```bash
npm run newrelic:dashboard -- TU_ACCOUNT_ID
```

3. En New Relic: **Dashboards** → **Import dashboard** → pega el contenido de `observabilidad/newrelic/dashboard-listo.json` → **Import**.

El dashboard **"CyberShield · Rendimiento y observabilidad"** tiene 11 gráficos:

| Gráfico | Consulta NRQL (resumida) | Qué te dice |
|---|---|---|
| Peticiones por minuto | `rate(count(*), 1 minute) FROM Span` | El tráfico que recibe el servidor (sube durante la prueba de k6) |
| Latencia p50 / p95 / p99 | `percentile(cybershield.http.server.duration, 50, 95, 99)` | Cuánto tarda el servidor en procesar: la mitad, el 95 % y el 99 % de las peticiones |
| Tasa de errores 5xx | `filter(count(...), WHERE status >= 500) * 100 / count(...)` | Porcentaje de fallos del servidor (debe ser 0) |
| Rechazos del limitador | `sum(cybershield.http.rate_limited)` | Peticiones bloqueadas por el anti-DoS (429) |
| Peticiones por ruta y estado | `count(...) FACET http.route, http.response.status_code` | Qué rutas se usan y con qué resultado (200, 404, 405…) |
| Event loop | `average(cybershield.eventloop.lag)`, `max(...lag.max)` | Si el servidor se "congela"; sano por debajo de 50 ms |
| Memoria | `average(cybershield.memory.rss) / 1048576` | Memoria en MB: estable = sin fugas |
| Peticiones en curso | `max(cybershield.http.in_flight)` | Cuántas peticiones se atienden a la vez |
| Logs por severidad | `count(*) FROM Log FACET severity.text` | Proporción de INFO, WARN y ERROR |
| Trazas más lentas | `FROM Span ORDER BY duration.ms DESC` | Las 20 peticiones más lentas, con su `request_id` |
| Últimos avisos y errores | `FROM Log WHERE severity.text IN ('WARN','ERROR')` | Los últimos 404, 405 y 429, enlazados con su traza |

## Paso 6 (opcional). Crear alertas

En **Alerts** → **Alert conditions** → **New alert condition** → **NRQL**:

| Alerta | Consulta | Umbral |
|---|---|---|
| Latencia alta | `SELECT percentile(cybershield.http.server.duration, 95) FROM Metric WHERE service.name = 'cybershield'` | > 300 ms durante 5 min |
| Errores del servidor | `SELECT filter(count(cybershield.http.server.duration), WHERE http.response.status_code >= 500) * 100 / count(cybershield.http.server.duration) FROM Metric WHERE service.name = 'cybershield'` | > 1 % durante 5 min |
| Event loop bloqueado | `SELECT max(cybershield.eventloop.lag.max) FROM Metric WHERE service.name = 'cybershield'` | > 100 ms durante 5 min |
| Posible ataque (muchos 429) | `SELECT sum(cybershield.http.rate_limited) FROM Metric WHERE service.name = 'cybershield'` | > 100 en 5 min |

## Qué entregar como evidencia

1. Capturas de **APM & Services → cybershield** durante la prueba de k6: throughput, tiempo de respuesta y errores.
2. Captura de una **traza** (`GET /`) y de sus **logs en contexto**.
3. Captura del **dashboard importado**.
4. El informe de k6 (`rendimiento/resultados/k6-carga-…-informe.html`) para comparar lo que ve el cliente con lo que ve New Relic desde dentro.
5. La verificación local: `observabilidad/newrelic/verificacion-local.json`.

## Seguridad y decisiones de diseño

- **La clave nunca está en el código:** solo en la variable de entorno de tu terminal. Los scripts la piden sin guardarla.
- **No se usa el agente de navegador de New Relic (Browser monitoring) a propósito:** requeriría cargar un script externo (`js-agent.newrelic.com`) y enviar datos a `bam.nr-data.net` desde el juego, lo que obligaría a relajar la **CSP estricta** del juego (que solo permite su propio script con hash). Se prioriza la seguridad: la observabilidad se hace desde el servidor.
- **No se usa New Relic Synthetics:** sus monitores necesitan una URL pública, y el servidor de pruebas escucha solo en tu equipo (`127.0.0.1`).
- **Agente oficial de New Relic (`newrelic` en npm):** también serviría, pero OpenTelemetry es un estándar abierto. El mismo código sirve para New Relic, Grafana, Datadog, Jaeger… cambiando solo `OTEL_EXPORTER_OTLP_ENDPOINT`.

## Problemas frecuentes

| Problema | Solución |
|---|---|
| `[telemetría] Desactivada` | No está definida `NEW_RELIC_LICENSE_KEY` en esa ventana de terminal |
| No aparece nada en New Relic tras 5 minutos | Revisa la región (`NEW_RELIC_REGION=EU` si tu cuenta es europea) y que la clave sea de tipo **INGEST - LICENSE**, no la User key (`NRAK-…`) |
| Error 403 en la consola | Clave incorrecta o de otro tipo |
| `Cannot find module '@opentelemetry/sdk-node'` | Ejecuta `npm install` |
| El dashboard importado sale vacío | Ejecutaste `preparar-dashboard` con otro Account ID, o el intervalo de tiempo del dashboard no incluye la prueba (elige "Last 30 minutes") |
| Faltan los últimos segundos de datos | Termina siempre con Ctrl+C (no cerrando la ventana): así se envían los datos pendientes |
