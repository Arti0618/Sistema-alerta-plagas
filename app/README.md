# Aplicación web del coordinador

Aplicación web local para que el coordinador revise y apruebe los casos
generados por el Sistema de Alerta de Plagas.

## Características del MVP

- Inicio de sesión con contraseña.
- Lista de casos pendientes, ordenada por prioridad.
- Detalle de cada caso con reporte original, interpretación de la IA,
  semáforo, prioridad y técnico recomendado.
- Aprobar el técnico recomendado.
- Cambiar el técnico por otro disponible.

## Requisitos

- `COORDINADOR_PASSWORD` definida en `.env`.
- `SUPABASE_URL` y `SUPABASE_SECRET_KEY` definidas en `.env`.
- Dependencias del proyecto instaladas en `.venv`.

## Cómo ejecutarla

Desde la raíz del repositorio:

```powershell
.\.venv\Scripts\python.exe -m app.server
```

Luego abrir en el navegador:

```
http://127.0.0.1:8000
```

## Variables de entorno adicionales

- `COORDINADOR_PASSWORD`: contraseña del coordinador (obligatoria).
- `APP_WEB_HOST`: host de escucha. Por defecto `127.0.0.1`.
- `APP_WEB_PUERTO`: puerto de escucha. Por defecto `8000`.

## Seguridad

- La clave secreta de Supabase **nunca** se envía al navegador.
- La contraseña del coordinador se compara en tiempo constante.
- Los tokens de sesión caducan después de 1 hora.
- El servidor escucha solo en `127.0.0.1` por defecto.

## Lo que NO incluye este MVP

- Solicitar información adicional al productor.
- Historial completo del caso.
- Diseño responsive para móvil.
- Detección visual de brotes y duplicados.
- Notificaciones automáticas.

Estas funciones forman parte de las Fases 6 y 7 pendientes.
