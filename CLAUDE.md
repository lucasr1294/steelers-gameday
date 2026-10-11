# Steelers Gameday — Contexto del proyecto

## Qué es
Una web en español con todo lo que un hincha de los Pittsburgh Steelers necesita saber **de cara al próximo partido**: cómo llega el equipo, lesiones, rival, noticias y lo que se dice en X. Se actualiza sola, entre una y varias veces por día, con un bot que usa la API de Grok (xAI) más fuentes de datos estructuradas.

El dueño del proyecto vive en Argentina: **todas las horas se muestran en hora argentina (UTC-3)**.

## Principio de arquitectura (no negociable)
**Los datos van separados del diseño.** El bot NUNCA edita HTML. Genera `data/gameday.json`, y la página es estática y solo lee ese JSON.
- Si el bot falla o el JSON no valida contra el esquema, se conserva el último JSON válido y la página sigue funcionando.
- Cada dato muestra su fuente y la hora de última actualización.

## Fuentes de datos (híbrido)
1. **Datos duros → API pública de ESPN (no oficial, sin key).** Incluye calendario, resultados, récord, posiciones y reporte de lesiones. Ejemplo de base: `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/pit`. Verificar los endpoints exactos (schedule, injuries, standings, scoreboard) antes de usarlos. Estos números **no** se le piden a Grok, para evitar datos inventados.
2. **Contexto y noticias → API de xAI (Grok) con búsqueda en web y en X.** Se usa para:
   - resumir las noticias de la semana;
   - recoger declaraciones de Mike Tomlin y de los jugadores;
   - informar movimientos de roster;
   - medir el clima de la previa en X;
   - describir los duelos clave del partido.
   La respuesta debe ser **JSON estructurado** (structured outputs / response_format), con URL de la fuente en cada ítem. Consultar la documentación actual de xAI para elegir el modelo y la herramienta de búsqueda vigentes.
3. **Fuentes que el prompt de Grok debe priorizar:**
   - Portales: steelers.com, ESPN, NFL.com, Pittsburgh Post-Gazette, TribLive, Steelers Depot y Behind the Steel Curtain.
   - X: la cuenta oficial @steelers y los periodistas que cubren al equipo día a día. La lista se guarda en `config/sources.json`, y el dueño la va a verificar y editar.
   - Las fuentes del rival de turno, para traer sus lesiones y su contexto.

## Secciones de la página
1. **Próximo partido (hero):**
   - rival, fecha, cuenta regresiva y hora en Argentina;
   - local o visitante, estadio y clima;
   - dónde verlo y línea de apuestas, si está disponible.
2. **Cómo llegamos:** récord, posición en la AFC Norte, racha y un "termómetro" de una línea generado por Grok.
3. **Últimos resultados:** los últimos 3 a 5 partidos, con marcador y una línea de resumen.
4. **Lesiones:** las de Steelers y las del rival, cada jugador con su estado (Out / Doubtful / Questionable / Full).
5. **Comparativa:** rankings de ofensiva y defensiva de ambos equipos y duelos clave.
6. **Noticias y X:** titulares con fuente, fecha y link.
7. **Historial vs. el rival:** últimos enfrentamientos.

Diseño: mobile-first, colores Steelers (negro carbón #1c1c1e, sin tinte azul, y dorado #FFB612), modo oscuro por defecto y rápido de cargar. Sin logos oficiales de la NFL ni del equipo, por derechos de marca: usar tipografía y colores.

## Stack
- **Frontend:** HTML, CSS y JS vanilla (o Astro si suma), estático y sin backend.
- **Bot:** script en Node o Python dentro de `scripts/update.(js|py)`, con estos pasos:
  1. traer los datos de ESPN;
  2. llamar a Grok;
  3. hacer el merge de ambos resultados;
  4. validar el resultado con el esquema JSON (`data/schema.json`);
  5. escribir `data/gameday.json`.
- **Automatización:** GitHub Actions con cron, que corre el script, commitea el JSON y despliega.
- **Hosting:** GitHub Pages (o Vercel).
- **Secretos:** `XAI_API_KEY` como GitHub Secret. Nunca debe estar en el código.

## Frecuencia de actualización (cron en UTC; Argentina = UTC-3)
- **Diario:** a las 12:00 UTC (9:00 en Argentina).
- **De miércoles a viernes:** una corrida extra por la tarde, cuando salen los reportes de práctica y lesiones.
- **Día de partido:** corridas cada 2 o 3 horas. El script detecta si falta poco para el kickoff y, unos 90 minutos antes, prioriza la lista de inactivos.
- Después de cada partido, el script detecta el resultado y pasa automáticamente al siguiente rival.
- Detalle de control de costos: si ni los datos de ESPN ni las noticias cambiaron, no se llama a Grok de más.

## Orden de trabajo sugerido
1. Definir `data/schema.json` y armar un `gameday.json` de ejemplo con datos ficticios.
2. Maquetar la página contra ese JSON de ejemplo y revisar el diseño con el dueño.
3. Script de ESPN (datos duros).
4. Integración con Grok (noticias y X).
5. GitHub Actions, cron y deploy.
6. Manejo de errores, fallback al último JSON válido y logs.

## Supuestos a confirmar con el dueño
- Que tiene, o va a sacar, una API key de xAI.
- Su nivel técnico. Hay que explicar cada paso de configuración (GitHub, Secrets, Pages) de forma simple.
- Si la página es solo personal o se va a compartir públicamente.
- La lista final de cuentas de X a seguir.

## Estado
- [x] 1. `data/schema.json` + `data/gameday.json` de ejemplo (`meta.is_sample: true`). Validar con `npm run validate`.
- [x] 2. Página (`index.html`, `assets/`) armada contra el JSON de ejemplo. Ver en local: `npm run dev` → http://localhost:4321
- [x] 3. Script de ESPN: `npm run update` (`scripts/update.js` + `scripts/espn.js`). `--dry` imprime sin escribir. Los datos de ejemplo quedan en `data/gameday.sample.json` (verlos con `?ejemplo`).
- [ ] 4. Grok · [ ] 5. Actions/deploy · [ ] 6. Fallback y logs (ya hay: escritura atómica, no se toca el JSON si falla o no valida, `meta.espn_hash` para no llamar a Grok si ESPN no cambió)

## Particularidades de ESPN (verificadas en oct. 2026)
- Responde 403 si el user-agent contiene "bot".
- `teams/pit` → `nextEvent` sigue apuntando al último partido varias horas después del final: el próximo partido sale del calendario.
- `summary?event=` trae lesiones de ambos equipos, pero mezcla a los que quedaron afuera por "Coach's Decision" (se filtran). No trae participación en prácticas.
- Clima: llega unos 8 días antes, en °F y con `conditionId` de AccuWeather (se traduce). Solo informa ráfagas, no viento sostenido.
- Línea de apuestas (`pickcenter`): vacía hasta que se publica en la semana.
- Ranking de ofensiva y defensiva = puntos por partido entre los 32 equipos (sale de las posiciones). No hay yardas permitidas ni historial total contra el rival.
- `config/sources.json`: cuentas de X con `verificado: false` pendientes de revisión del dueño.
