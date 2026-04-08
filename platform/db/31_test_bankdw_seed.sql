-- ============================================================
-- BankDW Test Seed Data
-- Copies CSV fixtures into bankdw.* tables.
-- CSV files must be mounted at /testdata/bankdw/ in the container.
-- Run after test_bankdw_schema.sql.
-- ============================================================

SET search_path TO bankdw, public;

-- dim_bank: 8 rows
COPY bankdw."dim_bank"
FROM '/testdata/bankdw/dim_bank.csv'
WITH (FORMAT csv, HEADER true, NULL '');

-- dim_party: 45 rows
COPY bankdw."dim_party"
FROM '/testdata/bankdw/dim_party.csv'
WITH (FORMAT csv, HEADER true, NULL '');

-- dim_product: 4 rows
COPY bankdw."dim_product"
FROM '/testdata/bankdw/dim_product.csv'
WITH (FORMAT csv, HEADER true, NULL '');

-- bridge_party_account: 2000 rows
COPY bankdw."bridge_party_account"
FROM '/testdata/bankdw/bridge_party_account.csv'
WITH (FORMAT csv, HEADER true, NULL '');

-- fact_payments: 1000 rows
COPY bankdw."fact_payments"
FROM '/testdata/bankdw/fact_payments.csv'
WITH (FORMAT csv, HEADER true, NULL '');

-- ----------------------------------------------------------------
-- Roll transaction dates forward so the dataset always ends at
-- today's date, regardless of when infra-reset is run.
--
-- Anchor: the latest TransactionDate in the CSV is 2025-12-28.
-- Shift  = CURRENT_DATE - anchor
--   e.g. on 2026-04-07: shift = +100 days
--        on 2026-07-01: shift = +185 days  (self-heals over time)
--
-- After the shift the dataset spans roughly 12 months ending today,
-- so "last quarter", "last 30 days", "last 10 days", etc. all
-- return live data on every fresh infra-reset.
-- ----------------------------------------------------------------
UPDATE bankdw.fact_payments
SET "TransactionDate" = "TransactionDate" + (CURRENT_DATE - DATE '2025-12-28');
