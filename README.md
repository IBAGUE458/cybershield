# CyberShield — Escape Room de Ciberseguridad + 27 pruebas de software

## Estructura

```
cybershield/
├── src/                        ← CÓDIGO FUENTE del juego: cybershield.js, cybershield.css, plantilla.html
├── CyberShield.html            ← el juego construido en un solo archivo (npm run construir)
├── servidor.js                 ← servidor seguro con observabilidad (/metrics, /health, /observabilidad, logs JSON)
├── rendimiento/                ← pruebas k6 y JMeter + orquestador + resultados
├── observabilidad/             ← Prometheus + Grafana + alertas (docker compose)
├── herramientas/actualizar-csp.js  ← recalcula el hash CSP del script
├── package.json
└── pruebas/
    ├── ayudantes.js            ← utilidades compartidas (navegador, jugar niveles, etc.)
    ├── 01-unitarias.test.js … 27-extremo-a-extremo.test.js
    └── capturas/               ← capturas generadas por la prueba de GUI
```

## Cómo ejecutar

```bash
npm install
```

```bash
npx playwright install chromium
```

```bash
npm test
```

Una sola suite:

```bash
npm run test:una -- pruebas/16-penetracion.test.js
```

Jugar en el navegador:

```bash
npm start
```

y abre http://127.0.0.1:8080/ (también funciona abriendo `CyberShield.html` directamente).

> **Importante:** el código fuente está en `src/` (`cybershield.js`, `cybershield.css`, `plantilla.html`).
> `CyberShield.html` se **construye** a partir de ahí: si modificas algo en `src/`, ejecuta `npm run construir`.
> Así el juego sigue siendo un solo archivo y herramientas como Snyk analizan el JavaScript completo.
> La CSP solo permite el script cuyo hash SHA-256 coincide; si no lo actualizas, el juego no arrancará
> (la prueba 15 lo detecta).

## Cobertura de código (Coveralls)

`npm run cobertura` ejecuta las 27 suites midiendo la cobertura de `src/cybershield.js` y de `servidor.js` (97,6 % de líneas) y genera `coverage/lcov.info` e informe HTML. El flujo `.github/workflows/cobertura.yml` la sube a Coveralls. Todo explicado en **GUIA-COVERALLS.html**.

## Rendimiento y observabilidad

Pruebas con **k6** y **Apache JMeter**, métricas **Prometheus**, paneles **Grafana**, logs JSON y trazas con `X-Request-Id`.
Todo está explicado, con los resultados obtenidos, en **GUIA-RENDIMIENTO.html**.

## Preguntas variables

- Cada uno de los 15 niveles tiene **3 escenarios distintos** (45 preguntas en total).
- Al volver a entrar a un nivel siempre aparece un escenario **diferente al último visto** (se recuerda aunque recargues la página).
- Las opciones y los elementos a clasificar se **barajan** cada vez, para que la respuesta correcta no esté siempre en el mismo sitio.
- Si fallas y pulsas «Volver a intentar», se mantiene la misma pregunta para que puedas corregirla.
- La elección es aleatoria con `crypto.getRandomValues` (generador criptográfico del navegador).
- Para añadir más escenarios, agrega objetos al arreglo `variants` del nivel en `src/cybershield.js` y ejecuta `npm run construir`.

## Seguridad implementada

| Control | Dónde |
|---|---|
| Content-Security-Policy con hash SHA-256 (sin `unsafe-inline` para scripts), `default-src 'none'`, `connect-src 'none'`, `object-src 'none'`, `base-uri 'none'`, `form-action 'none'` | `<meta>` en el HTML + cabecera en `servidor.js` |
| Anti-XSS: el DOM se construye solo con `createElement` + `textContent`; nunca `innerHTML`, `eval`, `document.write`, `new Function` | Función `el()` del script |
| Bloqueo de atributos `on*` en el creador de elementos | `el()` |
| Saneamiento del nombre (Unicode, máx. 48, sin `< > " { }`, sin caracteres de control) | `sanitizeName()` |
| Validación de esquema y acotado (clamp) de todo lo leído de `localStorage`; inmune a `__proto__` | `validateState()` |
| Límite de tamaño del almacenamiento (200 KB) e historial (200 entradas) | `Store.load()` |
| La contraseña del simulador nunca se guarda; `autocomplete="off"` | Nivel de contraseñas |
| API de pruebas congelada (`Object.freeze` profundo, no reconfigurable) | `window.CyberShieldCore` |
| Puntuación recalculada y acotada; repetir niveles no infla la nota | `computeLevelScore`, `best[]` |
| Servidor: solo GET/HEAD, un único archivo servible (sin path traversal), `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, COOP/CORP, `no-store` | `servidor.js` |
| `referrer` desactivado, `<noscript>`, modo estricto, IIFE sin variables globales | HTML/JS |

> El juego es 100 % del lado del cliente: un usuario con DevTools puede ver las respuestas.
> Es aceptable en un entorno educativo; si la nota tuviera valor oficial, la validación debería ir a un servidor.

## Las 27 pruebas

| # | Tipo de prueba | Qué verifica en CyberShield |
|---|---|---|
| 01 | Unitarias | Cada función pura: `sanitizeName`, `formatTime`, `evaluatePassword`, `computeLevelScore`, `computeGrade`, `slugify`, `pickVariant`, `shuffle`, `getChallenge` |
| 02 | Integración | Completar una misión actualiza almacenamiento, HUD, sala, puntuaciones e informe; pista + error se combinan en la nota |
| 03 | Sistema | App desplegada en el servidor: cabeceras, persistencia tras recargar, descarga del informe |
| 04 | Aceptación (UAT) | 5 historias de usuario (nombre en informe, solo Puerta 1, explicación al fallar, calificación final, modo docente) |
| 05 | Funcionales | Respuesta incompleta, pistas, cronómetro, sonido, reinicio; **pregunta distinta al repetir, aparecen los 3 escenarios, opciones barajadas** |
| 06 | Regresión | Repetir nivel no infla puntos, pista no se cobra dos veces, doble clic, historial ≤ 200, «Volver a intentar» conserva la pregunta |
| 07 | Humo (smoke) | Carga, título, botones principales, núcleo cargado, sin errores JS |
| 08 | Cordura (sanity) | Flujo mínimo: iniciar → sala → Puerta 1 → acertar |
| 09 | Caja blanca | Ramas internas de `validateState`, `pickVariant`, `evaluatePassword`, `checkAnswer`, **validación de los 45 escenarios** + cobertura real de código V8 ≥ 80 % |
| 10 | Caja negra | Tabla de entradas/salidas por la interfaz (nombres, contraseñas) |
| 11 | Caja gris | Acción en la UI → estructura en `localStorage`; estado sembrado → UI |
| 12 | Rendimiento | Peso < 200 KB, DOMContentLoaded < 1,5 s, render < 200 ms, partida completa < 30 s |
| 13 | Carga | 8 estudiantes simultáneos; 300 peticiones HTTP concurrentes |
| 14 | Estrés | 1000 clics, historial de 1000 y 20 000 entradas, nombre de 100 000 caracteres, 100 fallos seguidos |
| 15 | Seguridad | CSP + hash, ausencia de sumideros peligrosos, contraseña no guardada, API inmutable, cabeceras, 405/404 |
| 16 | Penetración | 5 cargas XSS, `localStorage` malicioso con `__proto__`, CSP bloquea scripts inyectados, exfiltración con `fetch`, clickjacking |
| 17 | Usabilidad | Enter inicia, foco guiado tras acertar/fallar, explicaciones, botones ≥ 36 px con texto |
| 18 | Accesibilidad | `lang="es"`, etiquetas, solo teclado, un h1 por vista, diálogo con trampa de foco y Escape, contraste WCAG AA, iconos ocultos |
| 19 | Compatibilidad | Escritorio, Android, iOS, tableta, otros idiomas/zonas horarias; Firefox y WebKit si están instalados |
| 20 | Interfaz gráfica (GUI) | Estados visuales (candado, pestaña activa, ✓, cronómetro crítico) + capturas en `pruebas/capturas` |
| 21 | Diseño adaptable | 320–1440 px sin scroll horizontal en todas las vistas; apilado en móvil |
| 22 | Recuperación | 5 tipos de `localStorage` corrupto, almacenamiento bloqueado, recarga a mitad de misión, tiempo agotado |
| 23 | Persistencia | Nombre/progreso/modo/sonido tras recargar, último escenario visto, historial con fechas, sincronización entre pestañas, borrado |
| 24 | Valores límite | Nombre 0/1/47/48/49, contraseña 11/12, repeticiones 2/3, notas 59/60…89/90, cronómetro 89 s/90 s |
| 25 | Partición de equivalencia | Clases válidas/inválidas de nombre, contraseña y respuestas |
| 26 | Exploratorias / monkey | 3 × 400 acciones aleatorias reproducibles sin errores ni estados imposibles |
| 27 | Extremo a extremo (E2E) | Partida perfecta hasta el informe descargado; partida con errores y temas a reforzar |
