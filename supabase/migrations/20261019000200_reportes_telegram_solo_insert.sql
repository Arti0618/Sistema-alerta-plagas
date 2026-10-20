-- ============================================================
-- Sistema de alerta de plagas
-- Permisos mínimos para guardar reportes de Telegram
-- ============================================================

-- El bot se ejecuta en el servidor y utiliza la clave secreta.
-- No se otorgan permisos a anon ni a authenticated.

grant insert on table public.reportes to service_role;

-- Evita duplicados cuando Telegram reintenta la misma actualización.
-- Los valores nulos siguen permitidos porque la columna es opcional.

alter table public.reportes
    add constraint reportes_canal_telegram_message_id_unico
    unique (canal, telegram_message_id);
