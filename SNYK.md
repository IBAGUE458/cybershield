# CyberShield — Pruebas de seguridad con Snyk (paso a paso)

## ¿Qué es Snyk y qué analiza?

Snyk es una herramienta de **pruebas de seguridad** que busca vulnerabilidades. En CyberShield usaremos dos de sus análisis:

| Análisis | Comando | Tipo de prueba | Qué revisa en CyberShield |
|---|---|---|---|
| **Snyk Open Source** | `snyk test` | SCA (análisis de composición del software) | Las librerías del `package.json` / `package-lock.json`, comparadas con una base de datos de vulnerabilidades conocidas (CVE) |
| **Snyk Code** | `snyk code test` | SAST (análisis estático del código) | El código fuente: `src/cybershield.js` (el juego), `servidor.js`, `rendimiento/`, `pruebas/`, `herramientas/`. Busca XSS, inyecciones, secretos, criptografía débil, etc. |

## Paso 0. Prueba de cobertura: que Snyk analice TODO el código

Antes de pasar Snyk hay que comprobar **qué código va a ver**. Al principio, toda la lógica del juego (1 482 líneas de JavaScript) estaba metida dentro de `CyberShield.html`, y Snyk no la trataba como código JavaScript completo.

**Solución aplicada:** el código fuente se separó en la carpeta `src/`:

| Archivo | Contenido |
|---|---|
| `src/cybershield.js` | Toda la lógica del juego (lo que Snyk Code analiza) |
| `src/cybershield.css` | Los estilos |
| `src/plantilla.html` | La estructura HTML |

El comando `npm run construir` vuelve a juntarlos en `CyberShield.html`, de un solo archivo, y recalcula el hash de la CSP. El juego funciona igual que antes.

**Ejecuta la prueba de cobertura:**

```bash
npm run snyk:cobertura
```

Genera `seguridad/cobertura-snyk.html` con el inventario de todos los archivos: cuáles analiza Snyk Code, cuáles Snyk Open Source, cuáles otro producto, cuáles no son soportados y por qué. La prueba falla si la cobertura del JavaScript baja del 100 %.

| Medición | Antes | Después |
|---|---|---|
| Cobertura del código JavaScript | **63,9 %** (1 482 líneas solo dentro de HTML) | **100 %** (todo en archivos `.js`) |
| Líneas de JavaScript analizadas por Snyk Code | 2 623 | 4 158 |

En la carpeta `seguridad` quedan los dos informes: `cobertura-snyk-ANTES.html` y `cobertura-snyk.html` (después).

**¿Por qué algunos archivos aparecen como "no soportado"?** Snyk Code solo analiza código de programación (JavaScript, TypeScript, Java, Python…). No analiza:

- Scripts `.bat` y `.sh`: solo lanzan comandos del proyecto.
- CSS: no tiene lógica ejecutable.
- Configuración YAML de Prometheus y Grafana, y el plan `.jmx` de JMeter.
- El JSON del panel de Grafana.

No es un fallo de cobertura: son tipos de archivo que esa herramienta no cubre. Las imágenes Docker del `docker-compose.yml` se analizan con `snyk container test` (ver "Opciones útiles").

**`CyberShield.html` aparece como "excluido" en `.snyk`** porque es el archivo construido: su código ya se analiza en `src/`. Así no salen los mismos hallazgos dos veces.

## Resultado del análisis de vulnerabilidades (27/11/2026)

El informe completo y explicado está en **`seguridad/INFORME-SNYK.html`**.

| | Primer análisis | Tras corregir |
|---|---|---|
| Dependencias (`snyk test --dev`, 2 paquetes) | 0 vulnerabilidades | 0 vulnerabilidades |
| Código (`snyk code test`, 37 `.js` + 7 `.html`) | 11 hallazgos (0 altos, 2 medios, 9 bajos) | 10 hallazgos (0 altos, 1 medio, 9 bajos) |
| Vulnerabilidades reales pendientes | 3 | **0** |
| Hallazgos en el código del juego (`src/cybershield.js`) | 0 | 0 |

Correcciones aplicadas:

- **Sin límite de peticiones (DoS), MEDIUM:** limitador por IP (30 peticiones/s, ráfagas de 60, respuesta 429) y HTML en memoria; ninguna petición lee el disco. Se configura con las variables `RATE_LIMIT` y `RATE_LIMIT_LOCAL`.
- **Path traversal (×2), LOW:** la herramienta `md-a-html.js` solo acepta una lista cerrada de documentos.
- **TLS inseguro en una prueba, LOW:** apareció en un análisis intermedio; ahora la prueba verifica el certificado.
- **HTTP en lugar de HTTPS, MEDIUM:** el servidor admite HTTPS con `TLS_CERT` y `TLS_KEY`. El modo HTTP queda solo para uso local, como **riesgo aceptado y mitigado**.

Los 9 hallazgos LOW restantes son **falsos positivos** en el código de pruebas (conexiones al servidor local y contraseñas ficticias del medidor de fortaleza).

## Opción rápida (todo automático)

Si ya tienes Node.js instalado:

- **Windows:** doble clic en `seguridad\ejecutar-snyk.bat`
- **Mac/Linux:** `sh seguridad/ejecutar-snyk.sh`

El script primero ejecuta la **prueba de cobertura** (paso 0); después instala Snyk si no lo tienes, te pide iniciar sesión, ejecuta los dos análisis y abre los informes HTML. Aun así, **antes tienes que hacer los pasos 1 y 4** (crear la cuenta y activar Snyk Code).

A continuación está el paso a paso manual, que conviene conocer para explicarlo en tu trabajo.

## Paso 1. Crear una cuenta gratuita

1. Entra en https://app.snyk.io/login
2. Regístrate con **GitHub**, **Google** o tu correo. El plan **Free** es suficiente.
3. Si te pregunta qué quieres integrar, puedes elegir **CLI** u omitir ese paso.

> El plan gratuito tiene un número limitado de análisis al mes, más que suficiente para este proyecto.

## Paso 2. Comprobar que tienes Node.js

Abre una terminal (en Windows: tecla Windows → escribe **cmd** → Enter) y escribe:

```bash
node --version
```

Debe mostrar `v18` o superior. Si no, instálalo desde https://nodejs.org (versión LTS).

## Paso 3. Instalar Snyk CLI y conectarlo a tu cuenta

```bash
npm install -g snyk snyk-to-html
```

```bash
snyk --version
```

```bash
snyk auth
```

`snyk auth` abre el navegador: pulsa **Authenticate** y vuelve a la terminal. Debe aparecer *"Your account has been authenticated"*.

> **Windows PowerShell:** si sale un error de "ejecución de scripts deshabilitada", usa **cmd** en lugar de PowerShell o ejecuta `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

## Paso 4. Activar Snyk Code (solo la primera vez)

Snyk Code viene desactivado en las cuentas nuevas:

1. Entra en https://app.snyk.io
2. Abajo a la izquierda: **Settings** (⚙) → **Snyk Code**.
3. Activa **Enable Snyk Code** y pulsa **Save changes**.

Si te lo saltas, `snyk code test` mostrará: *"Snyk Code is not enabled for your organization"*.

## Paso 5. Ir a la carpeta del proyecto

Descomprime `CyberShield-proyecto.zip` y entra en la carpeta `cybershield`:

```bash
cd ruta/donde/descomprimiste/cybershield
```

Debes estar en la carpeta donde están `package.json` y `package-lock.json`. En Windows, un truco: abre la carpeta en el Explorador, escribe `cmd` en la barra de direcciones y pulsa Enter.

## Paso 6. Prueba 1: dependencias (Snyk Open Source)

```bash
snyk test --dev
```

(`--dev` incluye también las dependencias de desarrollo; sin él Snyk solo mira las de producción, y CyberShield no tiene ninguna.)

Qué hace: lee `package-lock.json`, identifica cada librería y su versión exacta (incluidas las dependencias de las dependencias) y las compara con la base de datos de vulnerabilidades de Snyk.

Resultado esperado para CyberShield:

```
✔ Tested 2 dependencies for known issues, no vulnerable paths found.
```

El juego **no usa ninguna librería externa**. La única dependencia es `playwright`, y solo se usa para las pruebas automáticas (es `devDependency`). Para analizar únicamente lo que llega a producción:

```bash
snyk test --dev=false
```

## Paso 7. Prueba 2: código fuente (Snyk Code)

```bash
snyk code test
```

Qué hace: sube el código de forma cifrada a Snyk, lo analiza con reglas de seguridad y muestra cada hallazgo con su severidad, archivo, línea y explicación. Los hallazgos del juego aparecerán en **`src/cybershield.js`**.

El archivo `.snyk` del proyecto excluye `CyberShield.html` (es el archivo construido; su código está en `src/`) y `rendimiento/resultados/`. Esa carpeta contiene los informes generados por k6 y JMeter, que traen librerías de terceros minificadas (jQuery, Bootstrap…) que no son código del juego. **El juego, el servidor y las pruebas sí se analizan.**

## Paso 8. Generar los informes HTML (evidencia para tu trabajo)

```bash
snyk test --json-file-output=seguridad/snyk-dependencias.json
```

```bash
snyk code test --json-file-output=seguridad/snyk-codigo.json
```

```bash
snyk-to-html -i seguridad/snyk-dependencias.json -o seguridad/snyk-dependencias.html
```

```bash
snyk-to-html -i seguridad/snyk-codigo.json -o seguridad/snyk-codigo.html
```

Abre los `.html` de la carpeta `seguridad` con doble clic.

> Usa `-i archivo.json` en lugar de `snyk ... --json | snyk-to-html`: en PowerShell la tubería cambia la codificación y el informe sale vacío o con error.

Atajos ya configurados en el proyecto:

```bash
npm run snyk:dependencias
```

```bash
npm run snyk:codigo
```

```bash
npm run snyk:informes
```

> Si al terminar un análisis ves `npm ERR!` o `exit code 1`, **es normal**: Snyk devuelve código 1 cuando encuentra algún hallazgo, aunque sea de severidad baja. Revisa el informe.

## Paso 9 (opcional). Monitorización continua en la web de Snyk

```bash
snyk monitor --project-name=cybershield
```

Sube una "foto" de las dependencias a tu panel en https://app.snyk.io. Snyk te avisará por correo si en el futuro se descubre una vulnerabilidad nueva en alguna de ellas. Es el equivalente en seguridad a la observabilidad.

## Paso 10 (opcional). Analizar el repositorio desde GitHub

Si subes el proyecto a GitHub:

1. En https://app.snyk.io pulsa **Add project** → **GitHub**.
2. Autoriza a Snyk y elige el repositorio.
3. Snyk analizará dependencias y código automáticamente en cada cambio y puede abrir *pull requests* con las correcciones.

## Opciones útiles

| Opción | Qué hace |
|---|---|
| `--severity-threshold=high` | Muestra solo hallazgos altos o críticos |
| `--sarif-file-output=archivo.sarif` | Formato SARIF (lo entienden GitHub, VS Code y SonarQube) |
| `snyk ignore --id=ID --reason="motivo" --expiry=2027-01-01` | Marca un hallazgo de dependencias como aceptado y lo justifica en `.snyk` |
| `snyk container test prom/prometheus:v2.54.1` | Analiza las imágenes Docker de Prometheus/Grafana usadas en la observabilidad |

## Cómo interpretar los resultados

Cada hallazgo indica:

- **Severidad:** Critical, High, Medium o Low.
- **Tipo:** por ejemplo *Cross-site Scripting (XSS)* o *Cleartext Transmission*.
- **Ubicación:** archivo y línea.
- **Flujo de datos:** de dónde viene el dato peligroso (*source*) y dónde se usa (*sink*).

Para cada uno, decide:

1. **¿Es real?** ¿Un atacante podría explotarlo en el contexto de CyberShield?
2. **Si es real:** corrígelo y vuelve a ejecutar el análisis.
3. **Si es un falso positivo:** documenta por qué. En Snyk Code puedes ignorarlo desde la web (*Ignore* → motivo).

### Hallazgos que podrían aparecer en CyberShield y cómo justificarlos

| Posible hallazgo | Dónde | ¿Es real? | Justificación |
|---|---|---|---|
| *Cleartext Transmission of Sensitive Information* (HTTP sin TLS) | `servidor.js` | Bajo riesgo | El servidor escucha solo en `127.0.0.1` (tu propio equipo). En producción iría detrás de un proxy con HTTPS. |
| *Use of Insecure Random Values* (`Math.random`) | `src/cybershield.js`, `rendimiento/k6` | No | En el juego es solo un respaldo si el navegador no tiene `crypto.getRandomValues`, y sirve para barajar preguntas. En k6 simula tiempos de espera. Nada de seguridad depende de ello. |
| *Cross-site Scripting* / *DOM XSS* | `pruebas/16-penetracion.test.js` | No | Son **cargas de ataque intencionadas** de las pruebas de penetración (`<script>`, `onerror=`). Se usan para atacar el juego y demostrar que está protegido. |
| *Hardcoded Credentials* / *Hardcoded Secret* | `pruebas/03-sistema.test.js`, `docker-compose.yml` | No | `secreto-prueba` es un token de prueba, y `admin/admin` es la contraseña inicial de Grafana en local (Grafana obliga a cambiarla en el primer acceso). |
| *Path Traversal* | `rendimiento/ejecutar.js`, `herramientas/` | No | Las rutas se construyen con valores fijos o argumentos del propio usuario en su terminal, no con datos de la red. El servidor solo sirve un archivo fijo. |
| *Information Exposure* (`X-Powered-By` u otras) | `servidor.js` | No | El servidor no envía `X-Powered-By`. `/metrics` puede protegerse con `METRICS_TOKEN`. |

Si te sale algún hallazgo distinto, o alguno que no sepas justificar, copia el resultado y lo revisamos.

## Qué controles de seguridad del proyecto respaldan el resultado

- CSP estricta con hash SHA-256 (sin `unsafe-inline` para scripts).
- Sin `innerHTML`, `eval`, `document.write` ni `new Function`: todo el DOM se construye con `textContent`. Lo verifica la prueba 15.
- Validación de esquema de todo lo que se lee de `localStorage`, inmune a `__proto__`. Lo verifica la prueba 16.
- Servidor sin path traversal, que solo acepta GET/HEAD, con cabeceras de seguridad y token opcional en `/metrics`.
- `npm audit`: **0 vulnerabilidades**.

## Problemas frecuentes

| Mensaje | Solución |
|---|---|
| `'snyk' no se reconoce como un comando` | Cierra y vuelve a abrir la terminal tras instalar, o usa `npx snyk test` |
| `Authentication failed` / `401` | Ejecuta `snyk auth` de nuevo |
| `Snyk Code is not enabled for your organization` | Paso 4: Settings → Snyk Code → Enable |
| `Could not detect supported target files` | No estás en la carpeta del proyecto (Paso 5) |
| `Missing node_modules folder` | Asegúrate de que existe `package-lock.json` o ejecuta `npm install` |
| El informe HTML sale vacío | Usa `snyk-to-html -i archivo.json` en lugar de la tubería `|` |
| Detrás de un proxy (red del colegio o la empresa) | Define `HTTPS_PROXY=http://proxy:puerto` antes de ejecutar Snyk |

## Qué entregar como evidencia

1. Captura de la terminal con `snyk test` y `snyk code test`.
2. Los informes `seguridad/snyk-dependencias.html` y `seguridad/snyk-codigo.html`.
3. La tabla de hallazgos con tu análisis: real o falso positivo, y la justificación.
4. Opcional: captura del proyecto en el panel de https://app.snyk.io tras `snyk monitor`.
