# CyberShield — Cobertura de código con Coveralls (paso a paso)

## ¿Qué es la cobertura de código y qué es Coveralls?

La **cobertura de código** mide qué parte del código se ejecuta al pasar las pruebas automáticas. Si una línea nunca se ejecuta en ninguna prueba, un fallo en ella pasaría desapercibido.

**Coveralls** (https://coveralls.io) es un servicio en la nube que recibe el informe de cobertura cada vez que subes cambios a GitHub. Allí puedes:

- ver el porcentaje total y el de cada archivo, línea a línea (verde = probada, rojo = sin probar);
- ver cómo evoluciona con el tiempo y si un cambio la sube o la baja;
- mostrar una insignia (badge) con el porcentaje en tu repositorio.

Coveralls **no ejecuta las pruebas**: solo recibe el archivo `coverage/lcov.info` que generan tus pruebas.

## Qué código se mide

| Archivo | Qué es | Cómo se mide |
|---|---|---|
| `src/cybershield.js` | Toda la lógica del juego (se ejecuta en el navegador) | Cobertura V8 de Chromium, medida durante las 27 suites con Playwright y atribuida línea a línea al archivo fuente |
| `servidor.js` | El servidor con seguridad y observabilidad | Cobertura V8 de Node.js con **c8** |

No se miden las propias pruebas (`pruebas/`), los scripts de carga (`rendimiento/`), que ejecutan k6 y JMeter, ni las herramientas de documentación. Es la práctica estándar: se mide el código de la aplicación.

## Resultado obtenido

| Archivo | Líneas | Sentencias | Funciones | Ramas |
|---|---|---|---|---|
| `src/cybershield.js` | **99,7 %** | 99,7 % | 100 % | 99,3 % |
| `servidor.js` | **88,3 %** | 88,3 % | 95 % | 80,3 % |
| **Total** | **97,6 %** | 97,6 % | 98,9 % | 95,4 % |

Umbrales mínimos configurados (si no se alcanzan, el comando falla): líneas 80 %, funciones 80 %, ramas 70 %.

**Qué queda sin cubrir y por qué:**

- `src/cybershield.js`: el respaldo de `Math.random` (solo se usaría en un navegador sin `crypto`), dos `return null` para tipos de pregunta inexistentes y la sincronización entre pestañas, que ocurre en una segunda pestaña que no se mide.
- `servidor.js`: la parte que arranca el servidor desde la terminal (`node servidor.js`), la lectura de certificados desde variables de entorno y el error 500 cuando falta `CyberShield.html`.

**Qué significa cada columna:**

- **Líneas:** porcentaje de líneas ejecutadas al menos una vez.
- **Sentencias:** igual, contando instrucciones (una línea puede tener varias).
- **Funciones:** porcentaje de funciones llamadas al menos una vez.
- **Ramas:** porcentaje de caminos de cada `if`, `?:`, `||`… que se recorrieron. Es la medida más exigente: un `if` sin `else` probado deja una rama sin cubrir.

> **Diferencia con el 93,6 % de la suite 09:** aquel número mide solo una partida completa dentro de una prueba. Este mide las **27 suites juntas**: errores, almacenamiento roto, ataques XSS, pruebas aleatorias… Por eso es más alto.

## Paso 1. Ver la cobertura en tu PC

```bash
npm install
```

```bash
npx playwright install chromium
```

```bash
npm run cobertura
```

Ejecuta las 27 suites midiendo la cobertura (tarda unos 4 minutos) y genera:

- `coverage/index.html`: ábrelo con doble clic para navegar archivo a archivo y línea a línea.
- `coverage/lcov.info`: el archivo que se sube a Coveralls.

## Paso 2. Subir el proyecto a GitHub

Coveralls trabaja con repositorios de GitHub (también GitLab y Bitbucket).

1. Crea una cuenta en https://github.com si no la tienes.
2. Pulsa **New repository**, ponle el nombre `cybershield`, elige **Public** o **Private** y pulsa **Create repository**. No marques "Add a README".
3. En la carpeta del proyecto ejecuta, uno a uno (cambia `TU_USUARIO`):

```bash
git init
```

```bash
git add .
```

```bash
git commit -m "CyberShield con pruebas y cobertura"
```

```bash
git branch -M main
```

```bash
git remote add origin https://github.com/TU_USUARIO/cybershield.git
```

```bash
git push -u origin main
```

> El archivo `.gitignore` ya evita subir `node_modules/`, `coverage/`, los `.zip` y los resultados pesados de rendimiento.
> Si prefieres no usar la terminal, puedes usar **GitHub Desktop**: *Add local repository* → *Publish repository*.

## Paso 3. Activar el repositorio en Coveralls

1. Entra en https://coveralls.io y pulsa **Sign in** → **GitHub**. Autoriza a Coveralls.
2. En el menú, ve a **Add Repos**.
3. Busca `cybershield` y activa el interruptor (**ON**). Si no aparece, pulsa *Sync repos*. Si es privado, puede que tengas que conceder acceso a repositorios privados.

## Paso 4. Ejecutar el flujo automático (GitHub Actions)

El proyecto ya incluye `.github/workflows/cobertura.yml`. En cada `push`:

1. GitHub instala Node.js 22, las dependencias y Chromium.
2. Comprueba que `CyberShield.html` está construido desde `src/`.
3. Ejecuta `npm run cobertura`: las 27 suites con medición de cobertura.
4. **Sube `coverage/lcov.info` a Coveralls** con la acción oficial `coverallsapp/github-action@v2`. Usa el token automático de GitHub, así que **no necesitas configurar ningún secreto**.
5. Guarda el informe HTML como artefacto descargable.

Para lanzarlo:
- Haz cualquier `push`, o
- ve a la pestaña **Actions** del repositorio → **Pruebas y cobertura (Coveralls)** → **Run workflow**.

Cuando termine (unos 5–8 minutos), abre tu repositorio en https://coveralls.io y verás el porcentaje, el detalle por archivo y el historial.

## Paso 5. Añadir la insignia (badge) al README

En Coveralls, dentro de tu repositorio, pulsa **Badge URLs** y copia la versión Markdown. Tiene esta forma:

```text
[![Coverage Status](https://coveralls.io/repos/github/TU_USUARIO/cybershield/badge.svg?branch=main)](https://coveralls.io/github/TU_USUARIO/cybershield?branch=main)
```

Pégala al principio de `README.md` y haz `push`.

## Alternativa: subir la cobertura desde tu PC (sin GitHub Actions)

El repositorio tiene que estar igualmente activado en Coveralls (pasos 2 y 3).

1. En Coveralls, abre tu repositorio → **Settings** y copia el **Repo Token**. Es secreto: no lo subas a GitHub ni lo pegues en chats.
2. Descarga el *Coveralls Coverage Reporter* desde https://github.com/coverallsapp/coverage-reporter/releases (en Windows: `coveralls-windows.exe`).
3. En la carpeta del proyecto (Windows `cmd`, con tu token):

```bash
set COVERALLS_REPO_TOKEN=tu_repo_token
```

```bash
npm run cobertura
```

```bash
coveralls-windows.exe report coverage\lcov.info
```

## Problemas frecuentes

| Problema | Solución |
|---|---|
| El flujo falla en "Instalar dependencias" | Asegúrate de subir `package-lock.json` (no está en `.gitignore`) |
| Coveralls dice *"Couldn't find a repository matching this job"* | El repositorio no está activado en coveralls.io (paso 3) |
| `npm run cobertura` falla con "Cobertura por debajo del mínimo" | Alguna prueba dejó de ejecutar código. Revisa `coverage/index.html` para ver qué líneas quedan en rojo |
| Error de Playwright "Executable doesn't exist" | Ejecuta `npx playwright install chromium` |
| La cobertura de `src/cybershield.js` no aparece | Ejecuta `npm run construir`: `CyberShield.html` debe estar construido desde `src/` |
