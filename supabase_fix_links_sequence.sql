select setval(
  pg_get_serial_sequence('public.links', 'id'),
  coalesce((select max(id) from public.links), 0) + 1,
  false
);
