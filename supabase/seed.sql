-- ============================================================
-- Sistema de alerta de plagas
-- Datos ficticios para desarrollo, pruebas y demostraciones
-- ============================================================

-- Todos los registros de este archivo son ficticios.
-- No corresponden a personas, teléfonos, ubicaciones o cuentas reales.

-- ============================================================
-- PRODUCTORES FICTICIOS
-- ============================================================

insert into public.productores (
    id,
    id_externo,
    nombre,
    telefono,
    telegram_chat_id,
    comunidad,
    municipio,
    estado,
    activo
)
values
(
    '10000000-0000-0000-0000-000000000001',
    'PROD-DEMO-001',
    'Productor de prueba 1',
    '0000000001',
    'demo_productor_001',
    'Comunidad demostrativa norte',
    'Municipio demostrativo',
    'Estado de México',
    true
),
(
    '10000000-0000-0000-0000-000000000002',
    'PROD-DEMO-002',
    'Productor de prueba 2',
    '0000000002',
    'demo_productor_002',
    'Comunidad demostrativa sur',
    'Municipio demostrativo',
    'Estado de México',
    true
),
(
    '10000000-0000-0000-0000-000000000003',
    'PROD-DEMO-003',
    'Productor de prueba 3',
    '0000000003',
    'demo_productor_003',
    'Comunidad demostrativa oriente',
    'Otro municipio demostrativo',
    'Estado de México',
    true
)
on conflict (id) do nothing;

-- ============================================================
-- PARCELAS FICTICIAS
-- ============================================================

insert into public.parcelas (
    id,
    productor_id,
    id_externo,
    nombre,
    cultivo_principal,
    superficie_hectareas,
    latitud,
    longitud,
    comunidad,
    municipio,
    estado,
    activa
)
values
(
    '20000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'PARC-DEMO-001',
    'Parcela demostrativa 1',
    'Maíz',
    3.50,
    null,
    null,
    'Comunidad demostrativa norte',
    'Municipio demostrativo',
    'Estado de México',
    true
),
(
    '20000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000002',
    'PARC-DEMO-002',
    'Parcela demostrativa 2',
    'Tomate',
    1.75,
    null,
    null,
    'Comunidad demostrativa sur',
    'Municipio demostrativo',
    'Estado de México',
    true
),
(
    '20000000-0000-0000-0000-000000000003',
    '10000000-0000-0000-0000-000000000003',
    'PARC-DEMO-003',
    'Parcela demostrativa 3',
    'Aguacate',
    5.00,
    null,
    null,
    'Comunidad demostrativa oriente',
    'Otro municipio demostrativo',
    'Estado de México',
    true
)
on conflict (id) do nothing;

-- ============================================================
-- TÉCNICOS FICTICIOS
-- ============================================================

insert into public.tecnicos (
    id,
    id_externo,
    nombre,
    telefono,
    correo,
    telegram_chat_id,
    especialidades,
    municipios_asignados,
    disponible,
    capacidad_maxima_casos,
    casos_activos
)
values
(
    '30000000-0000-0000-0000-000000000001',
    'TEC-DEMO-001',
    'Técnico de prueba 1',
    '0000000011',
    'tecnico1@example.com',
    'demo_tecnico_001',
    array[
        'maíz',
        'gusano cogollero',
        'pulgones'
    ],
    array[
        'Municipio demostrativo'
    ],
    true,
    10,
    2
),
(
    '30000000-0000-0000-0000-000000000002',
    'TEC-DEMO-002',
    'Técnico de prueba 2',
    '0000000012',
    'tecnico2@example.com',
    'demo_tecnico_002',
    array[
        'tomate',
        'mosca blanca',
        'tizón'
    ],
    array[
        'Municipio demostrativo'
    ],
    true,
    8,
    1
),
(
    '30000000-0000-0000-0000-000000000003',
    'TEC-DEMO-003',
    'Técnico de prueba 3',
    '0000000013',
    'tecnico3@example.com',
    'demo_tecnico_003',
    array[
        'aguacate',
        'trips',
        'ácaros'
    ],
    array[
        'Otro municipio demostrativo'
    ],
    true,
    6,
    0
)
on conflict (id) do nothing;