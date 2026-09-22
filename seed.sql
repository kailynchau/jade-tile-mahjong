-- Sample data for both boards, for trying the site locally.
-- Never run this against the live database.

INSERT INTO players (id, name, tier, active, created_at) VALUES
  ('a1', 'Marcus Leung',  'advanced', 1, '2026-09-01T00:00:00Z'),
  ('a2', 'Priya Nair',    'advanced', 1, '2026-09-01T00:00:00Z'),
  ('a3', 'Tomás Reyes',   'advanced', 1, '2026-09-01T00:00:00Z'),
  ('a4', 'Hannah Okafor', 'advanced', 1, '2026-09-01T00:00:00Z'),
  ('a5', 'Wei Zhang',     'advanced', 1, '2026-09-01T00:00:00Z'),
  ('a6', 'Sofia Duarte',  'advanced', 1, '2026-09-01T00:00:00Z'),
  ('b1', 'Anh Tran',      'beginner', 1, '2026-09-01T00:00:00Z'),
  ('b2', 'Jonas Weber',   'beginner', 1, '2026-09-01T00:00:00Z'),
  ('b3', 'Mei Lin',       'beginner', 1, '2026-09-01T00:00:00Z'),
  ('b4', 'Oscar Diaz',    'beginner', 1, '2026-09-01T00:00:00Z'),
  ('b5', 'Ruth Abebe',    'beginner', 1, '2026-09-01T00:00:00Z'),
  ('b6', 'Kailyn',        'beginner', 1, '2026-09-01T00:00:00Z');

INSERT INTO rounds (id, tier, played_on, note, created_at, created_by) VALUES
  ('ra1', 'advanced', '2026-09-03', 'Table 1',        '2026-09-03T02:00:00Z', 'seed'),
  ('ra2', 'advanced', '2026-09-10', 'Table 1',        '2026-09-10T02:00:00Z', 'seed'),
  ('ra3', 'advanced', '2026-09-17', 'Table 1',        '2026-09-17T02:00:00Z', 'seed'),
  ('rb1', 'beginner', '2026-09-03', 'Learners table', '2026-09-03T02:00:00Z', 'seed'),
  ('rb2', 'beginner', '2026-09-10', 'Learners table', '2026-09-10T02:00:00Z', 'seed'),
  ('rb3', 'beginner', '2026-09-17', 'Learners table', '2026-09-17T02:00:00Z', 'seed');

INSERT INTO scores (round_id, player_id, points) VALUES
  ('ra1', 'a1',  420), ('ra1', 'a2',  310), ('ra1', 'a3', -120), ('ra1', 'a4', -180),
  ('ra2', 'a1',  380), ('ra2', 'a2',  460), ('ra2', 'a5',  240), ('ra2', 'a6',  -90),
  ('ra3', 'a2',  520), ('ra3', 'a3',  340), ('ra3', 'a4',  110), ('ra3', 'a5',  -70),
  ('rb1', 'b1',  180), ('rb1', 'b3',   60), ('rb1', 'b5',  -40), ('rb1', 'b6',  -80),
  ('rb2', 'b2',  220), ('rb2', 'b1',   90), ('rb2', 'b4',  -30), ('rb2', 'b6',  120),
  ('rb3', 'b1',  150), ('rb3', 'b2',   90), ('rb3', 'b3',  200), ('rb3', 'b5',  -60);
