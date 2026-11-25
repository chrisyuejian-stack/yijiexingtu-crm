SELECT type,name FROM sqlite_schema
WHERE name IN ('credit_income_entries','credit_income_legacy_estimates','credit_income_month','credit_income_reversal','credit_txn_participant_package','lesson_occurrence_range','credit_income_consume','credit_income_reverse','credit_income_price_completion','stage_has_payment_resolution')
ORDER BY type,name;
