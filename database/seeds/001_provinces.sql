-- Reference data: South Africa's 9 provinces. Stable, official, and
-- extremely unlikely to change — safe to seed outright.
insert into provinces (name, code) values
  ('Eastern Cape', 'EC'),
  ('Free State', 'FS'),
  ('Gauteng', 'GP'),
  ('KwaZulu-Natal', 'KZN'),
  ('Limpopo', 'LP'),
  ('Mpumalanga', 'MP'),
  ('Northern Cape', 'NC'),
  ('North West', 'NW'),
  ('Western Cape', 'WC')
on conflict (code) do nothing;
