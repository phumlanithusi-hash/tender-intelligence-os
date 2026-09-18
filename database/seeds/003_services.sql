-- Reference data: initial service taxonomy (master spec §6). This is
-- a starting point, not a hardcoded ceiling — an administrator can
-- add services/subcategories through the application without a
-- schema or code change (the taxonomy tables, not an enum, are the
-- source of truth).
insert into services (name, slug, sort_order) values
  ('Graphic Design', 'graphic-design', 1),
  ('Print', 'print', 2),
  ('Digital', 'digital', 3),
  ('Video', 'video', 4),
  ('Photography', 'photography', 5),
  ('Branding', 'branding', 6),
  ('Advertising', 'advertising', 7),
  ('Media Buying', 'media-buying', 8),
  ('Media Planning', 'media-planning', 9),
  ('Social Media', 'social-media', 10),
  ('Content', 'content', 11),
  ('Publishing', 'publishing', 12),
  ('Web Design', 'web-design', 13),
  ('Web Development', 'web-development', 14),
  ('Animation', 'animation', 15),
  ('Motion Graphics', 'motion-graphics', 16),
  ('Events', 'events', 17),
  ('Communications', 'communications', 18),
  ('Marketing', 'marketing', 19),
  ('PR', 'pr', 20),
  ('Creative Services', 'creative-services', 21)
on conflict (slug) do nothing;
