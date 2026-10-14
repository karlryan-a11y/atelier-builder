-- 043: Material and Care on every piece (Maegan, 2026-10-14: "we will need a garment care field on
-- Mr. C's site"; Karl: build it, the client can edit, show material too).
--
-- MATERIAL was already read off the tag at digitizing (intake extracted_material), but it only ever
-- landed inside `raw`, the import blob a GoodPix sync can rewrite, and nothing showed it. It gets its
-- own column so an edit survives a sync. The trigger keeps digitizing working unchanged: whenever a
-- row arrives or its raw changes and material is still empty, it is filled from raw->>'material'.
-- It never overwrites a material someone typed.
--
-- CARE is new: how to clean and look after the piece ("Dry clean only. Steam, don't iron.").
-- Both are plain text, shown to the client on her piece sheet only when filled, editable by her and
-- by the team. Table grants already cover new columns; RLS (client_id = jwt_client_id()) is unchanged.
alter table public.gp_closet_items
  add column if not exists material text,
  add column if not exists care text;

alter table public.gp_closet_items drop constraint if exists gp_closet_items_material_len;
alter table public.gp_closet_items add constraint gp_closet_items_material_len check (material is null or length(material) <= 300);
alter table public.gp_closet_items drop constraint if exists gp_closet_items_care_len;
alter table public.gp_closet_items add constraint gp_closet_items_care_len check (care is null or length(care) <= 2000);

update public.gp_closet_items
   set material = left(nullif(trim(raw->>'material'), ''), 300)
 where material is null and nullif(trim(raw->>'material'), '') is not null;

create or replace function public.gp_closet_items_fill_material() returns trigger
language plpgsql as $$
begin
  if new.material is null and new.raw is not null and nullif(trim(new.raw->>'material'), '') is not null then
    new.material := left(trim(new.raw->>'material'), 300);
  end if;
  return new;
end $$;

drop trigger if exists gp_closet_items_fill_material on public.gp_closet_items;
create trigger gp_closet_items_fill_material
  before insert or update of raw on public.gp_closet_items
  for each row execute function public.gp_closet_items_fill_material();

notify pgrst, 'reload schema';
