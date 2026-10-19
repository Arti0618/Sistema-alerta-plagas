-- ============================================================
-- Sistema de alerta de plagas
-- Migración inicial de la base de datos
-- ============================================================

-- Extensión necesaria para generar identificadores UUID
create extension if not exists pgcrypto;

-- ============================================================
-- FUNCIÓN PARA ACTUALIZAR updated_at
-- ============================================================

create or replace function public.actualizar_fecha_modificacion()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

-- ============================================================
-- PRODUCTORES
-- ============================================================

create table if not exists public.productores (
    id uuid primary key default gen_random_uuid(),
    id_externo text unique,
    nombre text,
    telefono text,
    telegram_chat_id text unique,
    comunidad text,
    municipio text,
    estado text,
    activo boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

comment on table public.productores is
'Productores que envían reportes agrícolas mediante Telegram o la API del hackathon.';

-- ============================================================
-- PARCELAS
-- ============================================================

create table if not exists public.parcelas (
    id uuid primary key default gen_random_uuid(),
    productor_id uuid not null references public.productores(id)
        on update cascade
        on delete restrict,
    id_externo text unique,
    nombre text,
    cultivo_principal text,
    superficie_hectareas numeric(12,2),
    latitud numeric(10,7),
    longitud numeric(10,7),
    comunidad text,
    municipio text,
    estado text,
    activa boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint parcelas_superficie_valida
        check (
            superficie_hectareas is null
            or superficie_hectareas >= 0
        ),

    constraint parcelas_latitud_valida
        check (
            latitud is null
            or latitud between -90 and 90
        ),

    constraint parcelas_longitud_valida
        check (
            longitud is null
            or longitud between -180 and 180
        )
);

comment on table public.parcelas is
'Parcelas agrícolas asociadas con cada productor.';

-- ============================================================
-- TÉCNICOS
-- ============================================================

create table if not exists public.tecnicos (
    id uuid primary key default gen_random_uuid(),
    id_externo text unique,
    nombre text not null,
    telefono text,
    correo text,
    telegram_chat_id text unique,
    especialidades text[] not null default array[]::text[],
    municipios_asignados text[] not null default array[]::text[],
    disponible boolean not null default true,
    capacidad_maxima_casos integer not null default 10,
    casos_activos integer not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint tecnicos_capacidad_valida
        check (capacidad_maxima_casos >= 0),

    constraint tecnicos_casos_activos_validos
        check (casos_activos >= 0)
);

comment on table public.tecnicos is
'Técnicos disponibles para atender los casos agrícolas.';

-- ============================================================
-- REPORTES
-- ============================================================

create table if not exists public.reportes (
    id uuid primary key default gen_random_uuid(),
    id_externo text unique,
    productor_id uuid references public.productores(id)
        on update cascade
        on delete set null,
    parcela_id uuid references public.parcelas(id)
        on update cascade
        on delete set null,
    canal text not null default 'telegram',
    tipo_contenido text not null,
    mensaje_original text,
    archivo_url text,
    archivo_tipo text,
    telegram_message_id text,
    fecha_recepcion timestamptz not null default now(),
    estado text not null default 'recibido',
    metadatos jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint reportes_canal_valido
        check (
            canal in (
                'telegram',
                'api_hackathon',
                'aplicacion_web',
                'otro'
            )
        ),

    constraint reportes_tipo_contenido_valido
        check (
            tipo_contenido in (
                'texto',
                'fotografia',
                'audio',
                'mixto'
            )
        ),

    constraint reportes_estado_valido
        check (
            estado in (
                'recibido',
                'en_interpretacion',
                'interpretado',
                'descartado',
                'error'
            )
        )
);

comment on table public.reportes is
'Contenido original recibido del productor antes de ser interpretado.';

-- ============================================================
-- INTERPRETACIONES DE INTELIGENCIA ARTIFICIAL
-- ============================================================

create table if not exists public.interpretaciones (
    id uuid primary key default gen_random_uuid(),
    reporte_id uuid not null references public.reportes(id)
        on update cascade
        on delete cascade,
    es_reporte_agricola boolean,
    cultivo text,
    sintomas text[] not null default array[]::text[],
    posible_plaga text,
    nombre_local_plaga text,
    superficie_afectada_hectareas numeric(12,2),
    nivel_confianza numeric(5,4),
    datos_faltantes text[] not null default array[]::text[],
    transcripcion_audio text,
    descripcion_imagen text,
    resumen text,
    modelo_ia text,
    version_prompt text,
    respuesta_completa jsonb not null default '{}'::jsonb,
    requiere_revision boolean not null default false,
    created_at timestamptz not null default now(),

    constraint interpretaciones_superficie_valida
        check (
            superficie_afectada_hectareas is null
            or superficie_afectada_hectareas >= 0
        ),

    constraint interpretaciones_confianza_valida
        check (
            nivel_confianza is null
            or nivel_confianza between 0 and 1
        )
);

comment on table public.interpretaciones is
'Información estructurada extraída por inteligencia artificial a partir de cada reporte.';

-- ============================================================
-- CASOS EVALUADOS POR EL MOTOR DE REGLAS
-- ============================================================

create table if not exists public.casos (
    id uuid primary key default gen_random_uuid(),
    reporte_id uuid not null unique references public.reportes(id)
        on update cascade
        on delete restrict,
    interpretacion_id uuid references public.interpretaciones(id)
        on update cascade
        on delete set null,
    prioridad integer,
    color_semaforo text,
    es_posible_duplicado boolean not null default false,
    caso_duplicado_id uuid references public.casos(id)
        on update cascade
        on delete set null,
    es_posible_brote boolean not null default false,
    justificacion_prioridad text,
    reglas_aplicadas jsonb not null default '{}'::jsonb,
    tiempo_maximo_atencion_horas integer,
    estado text not null default 'pendiente_revision',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint casos_prioridad_valida
        check (
            prioridad is null
            or prioridad between 0 and 100
        ),

    constraint casos_semaforo_valido
        check (
            color_semaforo is null
            or color_semaforo in (
                'verde',
                'amarillo',
                'rojo'
            )
        ),

    constraint casos_tiempo_valido
        check (
            tiempo_maximo_atencion_horas is null
            or tiempo_maximo_atencion_horas >= 0
        ),

    constraint casos_estado_valido
        check (
            estado in (
                'pendiente_revision',
                'pendiente_aprobacion',
                'aprobado',
                'asignado',
                'en_atencion',
                'resuelto',
                'descartado',
                'cancelado'
            )
        )
);

comment on table public.casos is
'Resultado del motor de reglas aplicado a un reporte interpretado.';

-- ============================================================
-- ASIGNACIONES
-- ============================================================

create table if not exists public.asignaciones (
    id uuid primary key default gen_random_uuid(),
    caso_id uuid not null references public.casos(id)
        on update cascade
        on delete cascade,
    tecnico_id uuid not null references public.tecnicos(id)
        on update cascade
        on delete restrict,
    recomendada_por_reglas boolean not null default true,
    justificacion text,
    estado text not null default 'propuesta',
    fecha_propuesta timestamptz not null default now(),
    fecha_asignacion timestamptz,
    fecha_aceptacion timestamptz,
    fecha_finalizacion timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint asignaciones_estado_valido
        check (
            estado in (
                'propuesta',
                'aprobada',
                'notificada',
                'aceptada',
                'rechazada',
                'finalizada',
                'cancelada'
            )
        )
);

comment on table public.asignaciones is
'Propuestas y asignaciones de técnicos para atender los casos.';

-- ============================================================
-- APROBACIONES DEL COORDINADOR
-- ============================================================

create table if not exists public.aprobaciones (
    id uuid primary key default gen_random_uuid(),
    caso_id uuid not null references public.casos(id)
        on update cascade
        on delete cascade,
    asignacion_id uuid references public.asignaciones(id)
        on update cascade
        on delete set null,
    coordinador_id uuid references auth.users(id)
        on update cascade
        on delete set null,
    decision text not null,
    comentario text,
    tecnico_anterior_id uuid references public.tecnicos(id)
        on update cascade
        on delete set null,
    tecnico_aprobado_id uuid references public.tecnicos(id)
        on update cascade
        on delete set null,
    fecha_decision timestamptz not null default now(),
    created_at timestamptz not null default now(),

    constraint aprobaciones_decision_valida
        check (
            decision in (
                'aprobada',
                'cambio_tecnico',
                'solicitar_informacion',
                'rechazada'
            )
        )
);

comment on table public.aprobaciones is
'Decisiones tomadas por el coordinador antes de enviar notificaciones definitivas.';

-- ============================================================
-- ACCIONES Y NOTIFICACIONES
-- ============================================================

create table if not exists public.acciones (
    id uuid primary key default gen_random_uuid(),
    caso_id uuid references public.casos(id)
        on update cascade
        on delete cascade,
    asignacion_id uuid references public.asignaciones(id)
        on update cascade
        on delete set null,
    tipo text not null,
    destinatario_tipo text,
    destinatario_id text,
    canal text,
    contenido text,
    estado text not null default 'pendiente',
    respuesta_servicio jsonb not null default '{}'::jsonb,
    fecha_programada timestamptz,
    fecha_ejecucion timestamptz,
    created_at timestamptz not null default now(),

    constraint acciones_tipo_valido
        check (
            tipo in (
                'notificacion',
                'solicitud_informacion',
                'cambio_estado',
                'registro_manual',
                'error'
            )
        ),

    constraint acciones_destinatario_valido
        check (
            destinatario_tipo is null
            or destinatario_tipo in (
                'productor',
                'tecnico',
                'coordinador',
                'sistema'
            )
        ),

    constraint acciones_canal_valido
        check (
            canal is null
            or canal in (
                'telegram',
                'correo',
                'aplicacion_web',
                'interno'
            )
        ),

    constraint acciones_estado_valido
        check (
            estado in (
                'pendiente',
                'enviada',
                'entregada',
                'fallida',
                'cancelada'
            )
        )
);

comment on table public.acciones is
'Historial de notificaciones, solicitudes, cambios y errores de cada caso.';

-- ============================================================
-- ÍNDICES
-- ============================================================

create index if not exists idx_parcelas_productor
    on public.parcelas(productor_id);

create index if not exists idx_reportes_productor
    on public.reportes(productor_id);

create index if not exists idx_reportes_parcela
    on public.reportes(parcela_id);

create index if not exists idx_reportes_estado
    on public.reportes(estado);

create index if not exists idx_reportes_fecha_recepcion
    on public.reportes(fecha_recepcion desc);

create index if not exists idx_interpretaciones_reporte
    on public.interpretaciones(reporte_id);

create index if not exists idx_casos_estado
    on public.casos(estado);

create index if not exists idx_casos_prioridad
    on public.casos(prioridad desc);

create index if not exists idx_casos_semaforo
    on public.casos(color_semaforo);

create index if not exists idx_asignaciones_caso
    on public.asignaciones(caso_id);

create index if not exists idx_asignaciones_tecnico
    on public.asignaciones(tecnico_id);

create index if not exists idx_aprobaciones_caso
    on public.aprobaciones(caso_id);

create index if not exists idx_acciones_caso
    on public.acciones(caso_id);

create index if not exists idx_acciones_estado
    on public.acciones(estado);

-- ============================================================
-- TRIGGERS PARA updated_at
-- ============================================================

drop trigger if exists trg_productores_updated_at
on public.productores;

create trigger trg_productores_updated_at
before update on public.productores
for each row
execute function public.actualizar_fecha_modificacion();

drop trigger if exists trg_parcelas_updated_at
on public.parcelas;

create trigger trg_parcelas_updated_at
before update on public.parcelas
for each row
execute function public.actualizar_fecha_modificacion();

drop trigger if exists trg_tecnicos_updated_at
on public.tecnicos;

create trigger trg_tecnicos_updated_at
before update on public.tecnicos
for each row
execute function public.actualizar_fecha_modificacion();

drop trigger if exists trg_reportes_updated_at
on public.reportes;

create trigger trg_reportes_updated_at
before update on public.reportes
for each row
execute function public.actualizar_fecha_modificacion();

drop trigger if exists trg_casos_updated_at
on public.casos;

create trigger trg_casos_updated_at
before update on public.casos
for each row
execute function public.actualizar_fecha_modificacion();

drop trigger if exists trg_asignaciones_updated_at
on public.asignaciones;

create trigger trg_asignaciones_updated_at
before update on public.asignaciones
for each row
execute function public.actualizar_fecha_modificacion();

-- ============================================================
-- ROW LEVEL SECURITY
-- Se habilita RLS, pero todavía no se crean políticas públicas.
-- Sin políticas, la clave publicable no podrá acceder a estos datos.
-- ============================================================

alter table public.productores enable row level security;
alter table public.parcelas enable row level security;
alter table public.tecnicos enable row level security;
alter table public.reportes enable row level security;
alter table public.interpretaciones enable row level security;
alter table public.casos enable row level security;
alter table public.asignaciones enable row level security;
alter table public.aprobaciones enable row level security;
alter table public.acciones enable row level security;