-- DóndeVivo · número de aviso, informes, visitas, códigos de descuento y lista de contactos

-- número corto de cada aviso propio (#1001, #1002...)
create sequence if not exists propios_numero_seq start 1001;
alter table propios add column if not exists numero int default nextval('propios_numero_seq');
update propios set numero = nextval('propios_numero_seq') where numero is null;
create unique index if not exists propios_numero_idx on propios (numero);

-- permiso para correos, baja, informes y avisos de fin de destacado
alter table propios add column if not exists informe boolean default false;
alter table propios add column if not exists baja boolean default false;
alter table propios add column if not exists publicado timestamptz;
alter table propios add column if not exists ultimo_informe timestamptz;
alter table propios add column if not exists avisos_destacado jsonb default '{}'::jsonb;
update propios set baja = false where baja is null;

-- visitas y clics de contacto por aviso y por día (privado; la web solo puede sumar)
create table if not exists visitas (
  aviso_id  text not null,
  dia       date not null,
  vistas    int  default 0,
  contactos int  default 0,
  primary key (aviso_id, dia)
);
alter table visitas enable row level security;

create or replace function sumar_visita(p_id text, p_tipo text) returns void
language sql security definer set search_path = public as $$
  insert into visitas (aviso_id, dia, vistas, contactos)
  select p_id, (now() at time zone 'America/Asuncion')::date,
         case when p_tipo = 'contacto' then 0 else 1 end,
         case when p_tipo = 'contacto' then 1 else 0 end
  where exists (select 1 from avisos where id = p_id)
  on conflict (aviso_id, dia) do update
    set vistas = visitas.vistas + excluded.vistas, contactos = visitas.contactos + excluded.contactos;
$$;
revoke all on function sumar_visita(text, text) from public;
grant execute on function sumar_visita(text, text) to anon, authenticated;

-- códigos de descuento. Ejemplo: insert into cupones (codigo, descuento_pct, usos_max, vence) values ('CASA241', 40, 50, '2026-12-31');
create table if not exists cupones (
  codigo        text primary key,
  descuento_pct int,          -- 40 = 40% menos
  descuento_gs  bigint,       -- o un monto fijo menos
  precio_final  bigint,       -- o un precio final directo
  dias          int,          -- si es solo para un plan (7, 15 o 30)
  usos_max      int,
  usos          int default 0,
  vence         date,
  activo        boolean default true,
  nota          text,
  creado        timestamptz default now()
);
alter table cupones enable row level security;
alter table pedidos add column if not exists cupon text;

-- lista de contactos para exportar (solo se ve desde el panel de Supabase)
create or replace view contactos with (security_invoker = true) as
select p.numero, p.email, p.whatsapp, p.informe as acepta_correos, p.baja, p.estado,
       p.creado, a.titulo, a.ciudad, a.operacion, a.destacado_hasta,
       coalesce((select sum(v.vistas) from visitas v where v.aviso_id = p.id), 0) as visitas
from propios p left join avisos a on a.id = p.id
order by p.creado desc;
revoke all on contactos from anon, authenticated;
