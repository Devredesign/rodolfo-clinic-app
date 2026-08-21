# 11 — Repositorio y continuidad

## Recomendación de repositorio

Crear repositorio Git privado.

Nombre sugerido:
`rodolfo-clinic-app`

Estructura futura sugerida:

rodolfo-clinic-app/
├── README.md
├── START_HERE.md
├── docs/
├── mockup/
├── frontend/
├── backend/
├── .env.example
├── .gitignore
└── CHANGELOG.md

## Reglas

- Nunca guardar `.env` real.
- Nunca subir credenciales.
- Documentar migraciones de DB.
- Cada cambio de regla de negocio debe actualizar `docs/03-business-rules.md`.
- Cada cambio financiero debe actualizar `docs/06-finance.md`.
- Mantener `CHANGELOG.md`.

## Para comenzar un nuevo chat

Subir o compartir:
- `START_HERE.md`
- opcionalmente todo el ZIP del repositorio de referencia.

Prompt recomendado:

“Este archivo contiene la fuente de verdad del proyecto de la app de Rodolfo Cabezas. Léelo primero y usa sus reglas como base. No cambies reglas de negocio sin señalarlo explícitamente.”
