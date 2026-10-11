# Steelers Gameday

Todo lo que un hincha de los Pittsburgh Steelers necesita saber antes del próximo partido, en español y en hora argentina. Se actualiza solo varias veces por semana.

Sitio no oficial, hecho por un hincha. No está afiliado a la NFL ni a los Pittsburgh Steelers.

## Cómo funciona

- **La página** (`index.html`, `assets/`) es estática: solo lee `data/gameday.json` y lo dibuja.
- **El bot** (`scripts/update.js`) trae los datos de la API pública de ESPN, los valida contra `data/schema.json` y escribe `data/gameday.json`. Si algo falla, el JSON anterior queda intacto y la página sigue funcionando.

## Uso local

Requiere Node 20 o superior y Python 3.

```bash
npm install
npm run update     # trae datos nuevos de ESPN
npm run dev        # sirve la página en http://localhost:4321
```

- `http://localhost:4321/?ejemplo` muestra los datos ficticios de `data/gameday.sample.json`.
- `npm run validate` controla que `data/gameday.json` cumpla el esquema.

## Configuración

- `config/site.json`: equipo, dónde ver los partidos en Argentina e historial.
- `config/sources.json`: sitios y cuentas de X a seguir.
