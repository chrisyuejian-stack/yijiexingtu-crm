UPDATE packages SET purchase_date=COALESCE(valid_from,date(created_at/1000,'unixepoch','+8 hours'));
