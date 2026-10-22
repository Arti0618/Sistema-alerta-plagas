begin;

-- Lectura para el panel del coordinador
grant select on table public.casos            to service_role;
grant select on table public.reportes         to service_role;
grant select on table public.interpretaciones to service_role;
grant select on table public.asignaciones     to service_role;
grant select on table public.tecnicos         to service_role;
grant select on table public.productores      to service_role;
grant select on table public.parcelas         to service_role;

-- Aprobar casos
grant update on table public.casos        to service_role;
grant insert on table public.aprobaciones to service_role;

-- Reasignar técnicos
grant insert on table public.asignaciones to service_role;

commit;