# CyberShield — Pruebas de rendimiento y observabilidad (k6 · JMeter · Prometheus · Grafana)

## 0. La forma más rápida: batería completa + informe en un solo archivo

```bash
node rendimiento/ejecutar.js todo
```

Ejecuta las 9 pruebas, una tras otra (unos 30 minutos):

1. k6: humo, carga, pico, estrés, capacidad, **validación** y resistencia.
2. JMeter: 100 usuarios y **validación**.

Al terminar genera **`rendimiento/resultados/INFORME-CONSOLIDADO.html`**: un único archivo con todos los resultados, gráficas, cobertura y la explicación de cada dato. En Windows también puedes hacer doble clic en `rendimiento\ejecutar-todo.bat`. Para saltarte la prueba de resistencia de 10 minutos, añade `--sin-resistencia`.

La prueba de **validación** lee cuántos usuarios alcanzó la prueba de capacidad y lanza a **todos esos usuarios a la vez** durante 3 minutos, para demostrar que el software los aguanta. Para elegir otro número de usuarios: `set USUARIOS=2000` (Windows) o `USUARIOS=2000` (Mac/Linux) antes del comando.

## 1. Qué se añadió

| Pieza | Archivo | Para qué sirve |
|---|---|---|
| Servidor observable | `servidor.js` | Expone métricas, salud, logs JSON y trazas por petición |
| Script k6 | `rendimiento/k6/cybershield.js` | 6 escenarios de rendimiento con umbrales de aprobación |
| Plan JMeter | `rendimiento/jmeter/cybershield.jmx` | Estudiantes + monitor con aserciones; genera informe HTML |
| Orquestador | `rendimiento/ejecutar.js` | Arranca el servidor, lanza k6 o JMeter, muestrea métricas y genera el informe de observabilidad |
| Lanzadores | `rendimiento/ejecutar-k6.bat/.sh`, `ejecutar-jmeter.bat/.sh` | Doble clic en Windows o `sh` en Mac/Linux |
| Stack de observabilidad | `observabilidad/` | Prometheus + Grafana + 5 alertas con `docker compose` |
| Resultados | `rendimiento/resultados/` | Informes HTML de k6, JMeter y observabilidad + logs JSON |

## 2. Observabilidad: los tres pilares

| Pilar | Implementación en CyberShield |
|---|---|
| **Métricas** | `GET /metrics` en formato Prometheus: `http_requests_total`, histograma `http_request_duration_seconds`, `http_requests_in_flight`, `http_response_bytes_total`, memoria, CPU, retardo del event loop, tiempo encendido |
| **Logs** | Una línea JSON por petición: hora, id, método, ruta, estado, duración (ms) y bytes. Se guardan en `rendimiento/resultados/servidor-*.jsonl` |
| **Trazas** | Cabecera `X-Request-Id` (UUID) en cada respuesta, que también aparece en el log, y `Server-Timing: app;dur=…` con el tiempo de procesamiento |
| **Salud** | `GET /health` → `{"estado":"ok","version":"1.1.0","uptimeS":…}` |
| **Panel en vivo** | `GET /observabilidad`: página sin JavaScript que se refresca cada 2 s mientras corre una prueba |

Detalles de diseño:

- Las rutas desconocidas se agrupan en la etiqueta `route="otras"`, para que un atacante no pueda crear miles de series de métricas distintas (explosión de cardinalidad).
- Si defines la variable `METRICS_TOKEN`, `/metrics` y `/observabilidad` exigen `Authorization: Bearer <token>` (comparación en tiempo constante).
- El retardo del event loop se mide con `perf_hooks.monitorEventLoopDelay` restando su resolución de muestreo. Una prueba automática verifica que detecta un bloqueo de 200 ms y no da falsos positivos en reposo.

## 3. Cómo ejecutar

### Requisitos

- Node.js 18 o superior.
- **k6**: https://grafana.com/docs/k6/latest/set-up/install-k6/ (en Windows: `winget install k6`).
- **JMeter**: Java 8 o superior y JMeter 5.6 desde https://jmeter.apache.org/download_jmeter.cgi. Añade su carpeta `bin` al PATH o indica la ruta con la variable `JMETER_BIN`.

### k6

```bash
node rendimiento/ejecutar.js k6 carga
```

Escenarios disponibles: `humo`, `carga`, `estres`, `pico`, `resistencia`, `capacidad`. En Windows también puedes usar `rendimiento\ejecutar-k6.bat carga`.

### JMeter (usuarios, duración en s, rampa en s)

```bash
node rendimiento/ejecutar.js jmeter 100 60 15
```

Para ver o editar el plan con la interfaz gráfica de JMeter, abre `rendimiento/jmeter/cybershield.jmx` desde JMeter (File → Open). Para pruebas grandes usa siempre el modo sin interfaz (`-n`), que es lo que hace el orquestador.

### Panel en vivo

Mientras corre cualquier prueba, abre http://127.0.0.1:8080/observabilidad

### Prometheus + Grafana (opcional, requiere Docker Desktop)

1. Arranca el servidor accesible desde Docker. En Mac/Linux: `HOST=0.0.0.0 node servidor.js 8080`. En Windows PowerShell: `$env:HOST="0.0.0.0"; node servidor.js 8080`
2. `docker compose -f observabilidad/docker-compose.yml up -d`
3. Abre Grafana en http://localhost:3000 (usuario admin / admin). El panel **CyberShield · Rendimiento y observabilidad** ya viene cargado, con 11 gráficos.
4. Para ver también las métricas de k6 en Grafana:

```bash
K6_PROMETHEUS_RW_SERVER_URL=http://localhost:9090/api/v1/write K6_PROMETHEUS_RW_TREND_STATS="p(95),p(99),avg" k6 run -o experimental-prometheus-rw -e ESCENARIO=carga rendimiento/k6/cybershield.js
```

Alertas configuradas en Prometheus (`observabilidad/alertas.yml`):

| Alerta | Condición |
|---|---|
| CyberShieldCaido | El servidor no responde durante 15 s |
| LatenciaAltaP95 | p95 de la página del juego > 300 ms durante 30 s |
| TasaErrores5xx | Más del 1 % de errores 5xx durante 30 s |
| EventLoopBloqueado | Retardo del event loop > 100 ms durante 30 s |
| MemoriaAlta | Memoria > 512 MB durante 2 min (posible fuga) |

## 4. Escenarios de k6 y criterios de aceptación

| Escenario | Tipo de prueba | Perfil de carga |
|---|---|---|
| humo | Smoke | 1 usuario, 30 s |
| carga | Carga (load) | Sube a 50 usuarios en 30 s, mantiene 1 min, baja |
| estres | Estrés (stress) | Escalones de 100 → 200 → 400 usuarios |
| pico | Picos (spike) | Salta de 10 a 500 usuarios en 10 s (toda una institución entra a la vez) |
| resistencia | Resistencia (soak) | 30 usuarios durante 10 min (busca fugas de memoria) |
| capacidad | Capacidad (breakpoint) | Llegada creciente hasta 3000 iteraciones/s; se detiene al romperse un umbral |
| validacion | Validación de capacidad | Todos los usuarios que alcanzó *capacidad* conectados a la vez durante 3 min |

Cada usuario virtual simula a un estudiante: carga el juego (`GET /` con gzip), comprueba la salud (`GET /health`) y "piensa" de 1 a 3 s. En paralelo, un usuario **observador** consulta `/metrics` cada 5 s, como haría Prometheus.

**Umbrales** (si alguno falla, k6 termina con código 99):

- Errores HTTP < 1 %
- Página del juego: p95 < 300 ms y p99 < 800 ms
- `/health`: p95 < 100 ms
- Comprobaciones superadas > 99 %
- Cabeceras de seguridad presentes en el 100 % de las respuestas (CSP con hash, X-Frame-Options, nosniff)
- Métricas disponibles en más del 95 % de las lecturas

## 5. Resultados obtenidos

> Los resultados más recientes y completos (27/11/2026, con validación de 1 503 usuarios simultáneos, resistencia de 10 min y cobertura de rutas) están en **`rendimiento/resultados/INFORME-CONSOLIDADO.html`**. Las tablas de abajo corresponden a la primera ronda de pruebas.

Las pruebas se ejecutaron el 24/11/2026 con k6 0.54 y JMeter 5.6.3 en una máquina de 4 vCPU, con el generador de carga y el servidor en la **misma máquina**.

### k6

| Escenario | Usuarios máx. | Peticiones | Peticiones/s | Juego: media | Juego: p95 | Juego: p99 | Errores | Resultado |
|---|---|---|---|---|---|---|---|---|
| humo | 1 | 40 | 1 | 2,0 ms | 3,9 ms | 9,6 ms | 0 % | ✔ Aprobado |
| carga | 50 | 4 300 | 38 | 1,1 ms | 1,5 ms | 2,3 ms | 0 % | ✔ Aprobado |
| pico | 500 | 20 923 | 254 | 1,0 ms | 1,5 ms | 3,4 ms | 0 % | ✔ Aprobado |
| estres | 400 | 42 395 | 200 | 1,1 ms | 1,5 ms | 2,7 ms | 0 % | ✔ Aprobado |
| capacidad | 1 251 | 344 064 | 2 860 | 32 ms | 149 ms | 285 ms | 0 % | ✖ Umbral roto (es lo esperado: encontró el límite) |

### JMeter (100 usuarios, rampa 15 s, 60 s)

| Muestra | Peticiones | Errores | Media | p95 | p99 | Rendimiento |
|---|---|---|---|---|---|---|
| 01 Cargar el juego (GET /) | 895 | 0 % | 1,7 ms | 2 ms | 5 ms | 15,4 req/s |
| 02 Salud (GET /health) | 861 | 0 % | 0,7 ms | 1 ms | 2 ms | 15,2 req/s |
| 03 Método no permitido (POST → 405) | 823 | 0 % | 0,8 ms | 1 ms | 2 ms | 15,1 req/s |
| 04 Métricas Prometheus (GET /metrics) | 11 | 0 % | 1,4 ms | 2 ms | 2 ms | 0,2 req/s |
| **Total** | **2 590** | **0 %** | **1,1 ms** | **2 ms** | **3 ms** | **44,6 req/s** |

### Observabilidad del servidor (métricas internas durante cada prueba)

| Prueba | Pico de req/s | Memoria máx. | Event loop: medio / máx. | Errores 5xx |
|---|---|---|---|---|
| k6 carga | 72 | 57,9 MB | 0,11 / 5,2 ms | 0 |
| k6 pico | 538 | 68,3 MB | 0,12 / 18,2 ms | 0 |
| k6 estrés | 456 | 68,4 MB | 0,11 / 14,4 ms | 0 |
| k6 capacidad | 5 039 | 87,5 MB | 0,32 / 10,1 ms | 0 |
| JMeter 100 usuarios | 59 | 53,9 MB | 0,13 / 18,2 ms | 0 |

## 6. Análisis y hallazgos

1. **Rendimiento muy holgado con la carga real.** Con 50 estudiantes (una clase) o 500 entrando a la vez, el juego responde con p95 por debajo de 2 ms y 0 errores. Los umbrales de 300 ms se cumplen con un margen de más de 100 veces.
2. **Punto de ruptura: unas 4 000–5 000 peticiones/s.** En el escenario de capacidad el rendimiento se estanca hacia el segundo 85. A partir de ahí, la latencia del cliente sube (p95 de 149 ms y p95 de `/health` de 124 ms, que rompe su umbral de 100 ms) y k6 descarta 10 426 iteraciones porque el servidor ya no da más.
3. **El cuello de botella es la CPU, no el código.** El tiempo de procesamiento medido dentro del servidor sigue siendo de 0,07 ms (p99) en plena saturación, y el event loop nunca se bloquea más de 18 ms. La latencia sube porque las peticiones esperan en cola: Node.js atiende con un solo hilo y aquí k6 compartía las 4 CPU con el servidor.
4. **Sin fugas de memoria.** La memoria se estabiliza entre 54 y 88 MB incluso tras 344 000 peticiones.
5. **La seguridad no se degrada con la carga.** Las cabeceras de seguridad estuvieron presentes en el 100 % de las respuestas en todos los escenarios.

### Problemas encontrados y corregidos durante las pruebas

| Problema | Cómo se detectó | Corrección |
|---|---|---|
| El servidor leía el HTML del disco en **cada** petición (bloquea el event loop) | Revisión antes de las pruebas de carga | Caché en memoria + versión gzip precalculada; se recarga solo si cambia el archivo |
| Sin compresión: se enviaban 135 KB por visita | Revisión de `data_received` en k6 | Compresión gzip (unos 33 KB por visita, un 75 % menos) |
| Falso negativo en la comprobación de `/metrics` en el segundo 0 | Escenario pico: 1 de 16 lecturas fallaba | Validar métricas que existen desde el arranque (el histograma no existe hasta la primera petición) |
| El retardo del event loop salía siempre en unos 20 ms | Gráfica plana en el informe de observabilidad | Restar la resolución de `monitorEventLoopDelay` + prueba automática de detección de bloqueos |

### Recomendaciones si el juego se usara a gran escala

- Ejecutar varias instancias (módulo `cluster` de Node.js o PM2) para usar todas las CPU, o poner un CDN o servidor estático (Nginx) delante, ya que la página es estática.
- Para medir la capacidad real, ejecutar k6 en una máquina distinta a la del servidor.
- Ejecutar el escenario `resistencia` durante 1 hora antes de una puesta en producción.
- Servir con HTTPS (TLS) detrás de un proxy inverso.

### Limitaciones de esta ejecución

- k6, JMeter y el servidor compartieron la misma máquina, así que los números de capacidad son un **límite inferior**.
- El stack Prometheus + Grafana se entrega listo y con la sintaxis validada, pero **no se ejecutó en este entorno** porque no había Docker. Pruébalo en tu equipo con Docker Desktop.
- El escenario `resistencia` (10 min) no se ejecutó en esta ronda; puedes lanzarlo con `node rendimiento/ejecutar.js k6 resistencia`.

## 7. Dónde ver los resultados

En `rendimiento/resultados/`:

- `k6-<escenario>-*-informe.html`: panel web de k6 con gráficas de usuarios, latencias y rendimiento.
- `k6-<escenario>-*-resumen.json`: todas las métricas de k6 en JSON.
- `jmeter-*-informe/index.html`: Dashboard Report de JMeter (APDEX, percentiles, rendimiento por segundo, errores).
- `observabilidad-*.html`: métricas internas del servidor segundo a segundo (peticiones/s, latencia, memoria, event loop).
- `servidor-*.jsonl(.gz)`: logs JSON de cada petición, con su `X-Request-Id`.
