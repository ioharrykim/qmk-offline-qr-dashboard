do $$
declare
  table_name text;
  sequence_name text;
begin
  foreach table_name in array array[
    'marts',
    'links',
    'order_qr_batches',
    'order_qr_batch_items',
    'shared_reports'
  ]
  loop
    sequence_name := pg_get_serial_sequence(format('public.%I', table_name), 'id');

    if sequence_name is not null then
      execute format(
        'select setval(%L, coalesce((select max(id) from public.%I), 0) + 1, false)',
        sequence_name,
        table_name
      );
    end if;
  end loop;
end $$;
