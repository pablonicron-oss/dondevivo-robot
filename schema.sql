-- DóndeVivo · tablas del robot
-- Pegar todo en Supabase > SQL Editor > Run

create table if not exists avisos (
  id              text primary key,          -- ej. infocasas:194382407
  fuente          text not null,             -- infocasas | remax | buscodepto | century21
  url             text not null,
  titulo          text,
  descripcion     text,
  operacion       text,                      -- alquiler | venta
  tipo            text,                      -- casa | departamento | duplex | terreno | otro
  estado_obra     text,                      -- en_pozo | a_estrenar | usado | null
  precio          numeric,
  moneda          text,                      -- PYG | USD
  dormitorios     int,
  banos           int,
  m2              numeric,
  ciudad          text,
  barrio          text,                      -- null si el anunciante no lo menciona
  departamento    text,
  region          text,                      -- asuncion | central | cde | resto
  lat             double precision,
  lng             double precision,
  fotos           jsonb default '[]',        -- solo las fotos aprobadas
  fotos_total     int,
  comodidades     jsonb default '[]',
  garantia        text,
  mascotas        text,                      -- si | no | null (no lo menciona)
  activo          boolean default true,
  motivo_baja     text,
  publicado_en    date,
  primera_vez     timestamptz default now(),
  ultima_revision timestamptz default now()
);

create index if not exists avisos_busqueda on avisos (activo, operacion, region, ciudad, barrio);
create index if not exists avisos_revision on avisos (activo, ultima_revision);

-- páginas de listado por ciudad y barrio que el robot va recorriendo
create table if not exists cola_listados (
  url          text primary key,
  fuente       text not null,
  prioridad    int default 5,                -- 1 = primero
  ultima_vez   timestamptz
);

-- avisos descartados, para no volver a revisarlos cada noche
create table if not exists descartados (
  id      text primary key,
  motivo  text,
  fecha   timestamptz default now()
);

-- resumen de cada noche
create table if not exists corridas (
  id         bigserial primary key,
  fecha      timestamptz default now(),
  nuevos     int, bajas int, descartados int, revisados int,
  progreso   jsonb,
  notas      text
);

-- la web solo puede LEER avisos activos; escribir solo el robot
alter table avisos enable row level security;
drop policy if exists "lectura publica" on avisos;
create policy "lectura publica" on avisos for select using (activo = true);
alter table cola_listados enable row level security;
alter table descartados enable row level security;
alter table corridas enable row level security;
