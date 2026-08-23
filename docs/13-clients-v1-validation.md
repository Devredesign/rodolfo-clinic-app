# Clients v1 — Validación y cierre

Fecha: 2026-08-23

El primer vertical slice real de la aplicación quedó validado localmente y fusionado a `main` mediante PR #1.

## Funcionalidad validada

- Login real con Supabase Auth.
- Recuperación de sesión.
- Identificación de organización y rol mediante `organization_members`.
- Listado real de clientes protegido por RLS.
- Búsqueda por nombre, cédula/identificación, teléfono y correo.
- Creación de clientes.
- Fecha de nacimiento con calendario y formato visible `DD/MM/YYYY`.
- Ficha completa de cliente.
- Edición de cliente.
- Archivo/reactivación mediante `active` (no borrado físico).
- Filtros Activos / Archivados / Todos.
- Logout.
- Interfaz responsive para celular y escritorio.

## Validación técnica

- `npm install` completado correctamente.
- Conexión a Supabase validada con credenciales públicas en `.env.local`.
- RLS validado previamente para el tenant de Rodolfo.
- `npm run build` ejecutado localmente sin errores.

## Decisión de datos

Los clientes no se eliminan físicamente. Se archivan con `active = false` para preservar futuros vínculos con procedimientos, pagos, historial y remarketing.

## Configuración frontend actual

Variables esperadas en `.env.local`:

```env
VITE_SUPABASE_URL=<project-url>
VITE_SUPABASE_ANON_KEY=<publishable-key>
```

## Próxima fase

Construir **Productos + Servicios** como datos maestros antes de Procedimientos.

Productos deberá cubrir, como mínimo:
- nombre,
- marca,
- proveedor por defecto,
- tipo de uso (`single_use` / `multi_use`),
- costo actual en USD,
- umbral de inventario,
- activo/inactivo,
- historial de cambios de precio.

Servicios deberá cubrir, como mínimo:
- nombre,
- precio fijo en USD,
- intervalo de remarketing,
- activo/inactivo,
- uno o varios productos asociados,
- cantidad estándar de cada producto por servicio.
