-- DóndeVivo · avisos publicados en la web y destacados pagos

alter table avisos add column if not exists destacado_hasta timestamptz;
alter table avisos add column if not exists contacto text;          -- WhatsApp público del anunciante (solo avisos propios)

-- datos privados de quien publica: solo los ve el script de Augusto (sin acceso público)
create table if not exists propios (
  id         text primary key references avisos(id) on delete cascade,
  email      text,
  whatsapp   text,
  ia         text,
  quien      text,
  direccion  text,
  ubic       text,
  extras     jsonb default '{}'::jsonb,
  estado     text default 'pendiente',
  creado     timestamptz default now()
);
alter table propios enable row level security;

-- pedidos de destacado pagados por transferencia
create table if not exists pedidos (
  codigo          text primary key,
  aviso_id        text references avisos(id) on delete cascade,
  plan_dias       int,
  monto           bigint,
  estado          text default 'pendiente',
  lectura         jsonb,
  comprobante_url text,
  creado          timestamptz default now(),
  resuelto        timestamptz
);
alter table pedidos enable row level security;

-- fotos de los avisos propios, públicas para que se vean en la web
insert into storage.buckets (id, name, public) values ('fotos', 'fotos', true)
on conflict (id) do update set public = true;

-- regla nueva de En pozo y A estrenar para lo que ya está guardado
update avisos set estado_obra = 'a_estrenar'
 where operacion = 'alquiler' and estado_obra = 'en_pozo';
update avisos set estado_obra = 'a_estrenar'
 where operacion = 'venta' and estado_obra = 'en_pozo'
   and titulo ~* '(a estrenar|para estrenar|sin estrenar)';
update avisos set estado_obra = case
     when (titulo || ' ' || coalesce(descripcion, '')) ~* '(a estrenar|para estrenar|sin estrenar)' then 'a_estrenar'
     else null end
 where operacion = 'venta' and estado_obra = 'en_pozo'
   and url not like '%/proyecto%'
   and not ((titulo || ' ' || coalesce(descripcion, '')) ~* '(en pozo|pre-?venta|en construcci)');
