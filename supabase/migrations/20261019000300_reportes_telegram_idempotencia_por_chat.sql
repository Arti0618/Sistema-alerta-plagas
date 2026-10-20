-- ============================================================
-- Sistema de alerta de plagas
-- Idempotencia de reportes de Telegram por chat
-- ============================================================

-- El message_id de Telegram es único por chat, no global.
-- La restricción anterior (canal, telegram_message_id) rechazaba
-- mensajes legítimos de chats distintos con el mismo identificador.

alter table public.reportes
    drop constraint if exists reportes_canal_telegram_message_id_unico;

-- La clave de idempotencia incluye el chat, que se guarda en
-- metadatos. No se agregan columnas nuevas.
-- Los valores nulos siguen permitidos: si falta el chat o el
-- mensaje, PostgreSQL no considera la fila duplicada.

create unique index if not exists reportes_canal_chat_mensaje_unico
    on public.reportes (
        canal,
        (metadatos ->> 'telegram_chat_id'),
        telegram_message_id
    );
