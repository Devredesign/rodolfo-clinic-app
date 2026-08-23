# Frontend

React + Vite + MUI client for Rodolfo Clinic App.

## Estado actual

Primer vertical slice funcional:
- login con Supabase Auth,
- sesión persistente,
- carga de organización/rol mediante RLS,
- listado de clientes,
- búsqueda por nombre, identificación, teléfono o correo,
- creación de clientes,
- logout,
- layout responsive para móvil y escritorio.

## Desarrollo local

1. Entrar a `frontend/`.
2. Ejecutar `npm install`.
3. Copiar `.env.example` a `.env.local`.
4. Completar las variables públicas del proyecto Supabase:
   - `VITE_SB_URL`
   - `VITE_SB_PUBLIC`
5. Ejecutar `npm run dev`.

No guardar contraseñas ni claves privadas/service-role en este repositorio.

## Build

```bash
npm run build
```

## Próximos pasos

- probar login real desde navegador,
- validar creación y búsqueda del primer cliente,
- desplegar preview en Vercel,
- continuar con navegación principal y módulos siguientes.
