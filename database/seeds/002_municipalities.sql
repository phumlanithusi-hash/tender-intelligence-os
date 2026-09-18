-- Reference data: South Africa's 8 official metropolitan
-- municipalities (a stable, complete list), plus a small,
-- representative slice of district/local municipality structure
-- (Phase 2 §26: "municipality structure where practical" — not
-- claimed to be exhaustive; the full municipal structure is a much
-- larger, lower-priority dataset to complete in a later pass without
-- a schema change, since the tables already support it).

-- Metros (municipality_type = METRO, no parent).
insert into municipalities (province_id, name, code, municipality_type)
select provinces.id, m.name, m.code, 'METRO'::municipality_type from provinces, (values
  ('GP', 'City of Johannesburg Metropolitan Municipality', 'JHB'),
  ('GP', 'City of Tshwane Metropolitan Municipality', 'TSH'),
  ('GP', 'City of Ekurhuleni Metropolitan Municipality', 'EKU'),
  ('WC', 'City of Cape Town Metropolitan Municipality', 'CPT'),
  ('KZN', 'eThekwini Metropolitan Municipality', 'ETH'),
  ('EC', 'Nelson Mandela Bay Metropolitan Municipality', 'NMB'),
  ('EC', 'Buffalo City Metropolitan Municipality', 'BUF'),
  ('FS', 'Mangaung Metropolitan Municipality', 'MAN')
) as m(province_code, name, code)
where provinces.code = m.province_code
on conflict (code) do nothing;

-- A representative district + local municipality structure under it,
-- to exercise and demonstrate the parent/child relationship
-- (municipalities.parent_municipality_id).
insert into municipalities (province_id, name, code, municipality_type)
select id, 'Cape Winelands District Municipality', 'DC2', 'DISTRICT'::municipality_type
from provinces where code = 'WC'
on conflict (code) do nothing;

insert into municipalities (province_id, parent_municipality_id, name, code, municipality_type)
select p.id, d.id, l.name, l.code, 'LOCAL'::municipality_type
from provinces p
join municipalities d on d.code = 'DC2'
cross join (values
  ('Stellenbosch Local Municipality', 'WC024'),
  ('Drakenstein Local Municipality', 'WC023')
) as l(name, code)
where p.code = 'WC'
on conflict (code) do nothing;

insert into municipalities (province_id, name, code, municipality_type)
select id, 'West Rand District Municipality', 'DC48', 'DISTRICT'::municipality_type
from provinces where code = 'GP'
on conflict (code) do nothing;

insert into municipalities (province_id, parent_municipality_id, name, code, municipality_type)
select p.id, d.id, 'Mogale City Local Municipality', 'GT481', 'LOCAL'::municipality_type
from provinces p
join municipalities d on d.code = 'DC48'
where p.code = 'GP'
on conflict (code) do nothing;
