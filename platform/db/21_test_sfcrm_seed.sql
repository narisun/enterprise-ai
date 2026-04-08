-- ============================================================
-- SFCRM Test Seed Data
-- Copies CSV fixtures into salesforce.* tables.
-- CSV files must be mounted at /testdata/sfcrm/ in the container.
-- Run after test_sfcrm_schema.sql.
-- ============================================================

SET search_path TO salesforce, public;

-- Pricebook2: 1 rows
COPY salesforce."Pricebook2"
FROM '/testdata/sfcrm/Pricebook2.csv'
WITH (FORMAT csv, HEADER true, NULL '');

-- Product2: 6 rows
COPY salesforce."Product2"
FROM '/testdata/sfcrm/Product2.csv'
WITH (FORMAT csv, HEADER true, NULL '');

-- Campaign: 6 rows
COPY salesforce."Campaign"
FROM '/testdata/sfcrm/Campaign.csv'
WITH (FORMAT csv, HEADER true, NULL '');

-- Account: 45 rows
COPY salesforce."Account"
FROM '/testdata/sfcrm/Account.csv'
WITH (FORMAT csv, HEADER true, NULL '');

-- Contact: 45 rows
COPY salesforce."Contact"
FROM '/testdata/sfcrm/Contact.csv'
WITH (FORMAT csv, HEADER true, NULL '');

-- Lead: 36 rows
COPY salesforce."Lead"
FROM '/testdata/sfcrm/Lead.csv'
WITH (FORMAT csv, HEADER true, NULL '');

-- Opportunity: 95 rows
COPY salesforce."Opportunity"
FROM '/testdata/sfcrm/Opportunity.csv'
WITH (FORMAT csv, HEADER true, NULL '');

-- OpportunityContactRole: 95 rows
COPY salesforce."OpportunityContactRole"
FROM '/testdata/sfcrm/OpportunityContactRole.csv'
WITH (FORMAT csv, HEADER true, NULL '');

-- OpportunityLineItem: 206 rows
COPY salesforce."OpportunityLineItem"
FROM '/testdata/sfcrm/OpportunityLineItem.csv'
WITH (FORMAT csv, HEADER true, NULL '');

-- PricebookEntry: 6 rows
COPY salesforce."PricebookEntry"
FROM '/testdata/sfcrm/PricebookEntry.csv'
WITH (FORMAT csv, HEADER true, NULL '');

-- CampaignMember: 81 rows
COPY salesforce."CampaignMember"
FROM '/testdata/sfcrm/CampaignMember.csv'
WITH (FORMAT csv, HEADER true, NULL '');

-- Task: 120 rows
COPY salesforce."Task"
FROM '/testdata/sfcrm/Task.csv'
WITH (FORMAT csv, HEADER true, NULL '');

-- Event: 86 rows
COPY salesforce."Event"
FROM '/testdata/sfcrm/Event.csv'
WITH (FORMAT csv, HEADER true, NULL '');

-- Case: 47 rows
COPY salesforce."Case"
FROM '/testdata/sfcrm/Case.csv'
WITH (FORMAT csv, HEADER true, NULL '');

-- ----------------------------------------------------------------
-- Roll Case dates forward so the most recent case aligns with today.
--
-- Anchor: the latest CreatedDate in the CSV is 2026-03-04.
-- Both CreatedDate and ClosedDate are shifted by the same delta so
-- case duration (open → closed) is preserved exactly.
-- NULL ClosedDate (open cases) are left unchanged.
--
-- Other sfcrm tables (Opportunity, Task, Event, Campaign) already
-- have dates extending well into late 2026 and need no adjustment.
-- ----------------------------------------------------------------
UPDATE salesforce."Case"
SET
    "CreatedDate" = "CreatedDate" + (CURRENT_DATE - DATE '2026-03-04'),
    "ClosedDate"  = CASE
                     WHEN "ClosedDate" IS NOT NULL
                     THEN "ClosedDate" + (CURRENT_DATE - DATE '2026-03-04')
                     ELSE NULL
                   END;

-- Contract: 26 rows
COPY salesforce."Contract"
FROM '/testdata/sfcrm/Contract.csv'
WITH (FORMAT csv, HEADER true, NULL '');
