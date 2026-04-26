-- ============================================================
-- platform/db/40_metadata_comments.sql
--
-- Business semantics on tables and columns. Surfaces via PostgreSQL
-- pg_catalog.obj_description() / col_description() so any tool that
-- introspects information_schema sees the same descriptions —
-- including the analytics agent's startup schema-context loader.
--
-- Convention: keep comments factual and join-relevant. Don't repeat
-- the column type — that's already in the catalog.
-- ============================================================

-- ============================================================
-- bankdw — banking data warehouse
-- ============================================================

COMMENT ON SCHEMA bankdw IS
  'Banking data warehouse: fact_payments + party / bank / product dimensions.';

-- ---- fact_payments ----------------------------------------------
COMMENT ON TABLE bankdw."fact_payments" IS
  'Payment transactions fact. Each row is one payment between two parties (Payor/Payee), facilitated by two banks (PayorBank/PayeeBank), using one payment product (TransactionType). All three perspectives — party, bank, product — are reachable from this table.';

COMMENT ON COLUMN bankdw."fact_payments"."TransactionDate" IS
  'Settlement date.';
COMMENT ON COLUMN bankdw."fact_payments"."PayorName" IS
  'Sender party name (corporate counterparty, NOT a bank). Joins by text equality to dim_party."PartyName" and salesforce."Account"."Name".';
COMMENT ON COLUMN bankdw."fact_payments"."PayeeName" IS
  'Receiver party name (corporate counterparty, NOT a bank). Joins by text equality to dim_party."PartyName" and salesforce."Account"."Name".';
COMMENT ON COLUMN bankdw."fact_payments"."PayorBank" IS
  'Sending bank (originating financial institution). Joins by text equality to dim_bank."BankName".';
COMMENT ON COLUMN bankdw."fact_payments"."PayeeBank" IS
  'Receiving bank (beneficiary financial institution). Joins by text equality to dim_bank."BankName".';
COMMENT ON COLUMN bankdw."fact_payments"."Amount" IS
  'Settled amount in USD (Currency is always USD).';
COMMENT ON COLUMN bankdw."fact_payments"."TransactionType" IS
  'Payment rail used for this transaction. Joins by direct equality to dim_product."PaymentRail" — values are identical across both tables.';
COMMENT ON COLUMN bankdw."fact_payments"."Status" IS
  'Settlement state. Failed/Returned/Reversed are exception statuses; Completed is the success terminal state.';

-- ---- dim_party --------------------------------------------------
COMMENT ON TABLE bankdw."dim_party" IS
  'Party master: corporate counterparties (clients, vendors, customers) that appear as Payor or Payee on payment transactions. NON-FINANCIAL entities. Compliance attributes (KYC, AML, sanctions) are point-in-time only — there is NO history table.';
COMMENT ON COLUMN bankdw."dim_party"."PartyName" IS
  'Display name. Joins by text equality to fact_payments."PayorName"/"PayeeName" and to salesforce."Account"."Name" (cross-schema bridge).';
COMMENT ON COLUMN bankdw."dim_party"."CustomerSegment" IS
  'Commercial banking segment (Retail / Commercial / Corporate / Institutional).';
COMMENT ON COLUMN bankdw."dim_party"."RiskRating" IS
  'Current risk rating only — no history. To analyse rating changes you must add a SCD2 history table.';
COMMENT ON COLUMN bankdw."dim_party"."AMLRiskCategory" IS
  'AML risk classification (Low / Medium / High). Current state, no history.';
COMMENT ON COLUMN bankdw."dim_party"."KYCStatus" IS
  'Know-Your-Customer state (Approved, Under Review, etc.). Current state, no history.';
COMMENT ON COLUMN bankdw."dim_party"."PEPFlag" IS
  'Politically Exposed Person flag.';

-- ---- dim_bank ---------------------------------------------------
COMMENT ON TABLE bankdw."dim_bank" IS
  'Bank master: financial institutions that facilitate payments by providing rails (ACH origination, wire clearing, RTP settlement, check processing). Banks are NOT clients — they appear as PayorBank/PayeeBank on fact_payments, never as parties.';
COMMENT ON COLUMN bankdw."dim_bank"."BankName" IS
  'Display name. Joins by text equality to fact_payments."PayorBank"/"PayeeBank".';
COMMENT ON COLUMN bankdw."dim_bank"."BankRoleType" IS
  'Role in the network (Originator, Beneficiary, Correspondent, etc.).';
COMMENT ON COLUMN bankdw."dim_bank"."ClearingNetworksSupported" IS
  'Comma-separated list of clearing networks the bank participates in (ACH, Fedwire, RTP, etc.).';

-- ---- dim_product ------------------------------------------------
COMMENT ON TABLE bankdw."dim_product" IS
  'Payment product / rail dimension. Each row is a product banks offer (RTP, Fedwire, ACH Credit, …). PaymentRail is the wire-format identifier; ProductName is human-readable.';
COMMENT ON COLUMN bankdw."dim_product"."ProductName" IS
  'Human-readable product name (e.g. "RTP (Real-Time Payment)", "Domestic Wire").';
COMMENT ON COLUMN bankdw."dim_product"."PaymentRail" IS
  'Wire-format rail identifier. Joins by direct equality to fact_payments."TransactionType" — values are identical across both tables.';
COMMENT ON COLUMN bankdw."dim_product"."Reversibility" IS
  'Whether the rail supports return / reversal (relevant for fraud / dispute analysis).';

-- ---- bridge_party_account ---------------------------------------
COMMENT ON TABLE bankdw."bridge_party_account" IS
  'Many-to-many bridge between parties and the bank accounts they hold. Use to find which bank(s) a party transacts through, or to count account counts per party.';

-- ============================================================
-- salesforce — CRM source schema
-- ============================================================

COMMENT ON SCHEMA salesforce IS
  'Salesforce CRM source schema. Account is the company-level entity; bridges to bankdw via Account."Name" ↔ dim_party."PartyName".';

-- ---- Account ----------------------------------------------------
COMMENT ON TABLE salesforce."Account" IS
  'Salesforce Account: company-level CRM record. Bridges the CRM view to the banking-warehouse view via Name ↔ bankdw.dim_party.PartyName.';
COMMENT ON COLUMN salesforce."Account"."Name" IS
  'Company name. Joins by text equality to bankdw.dim_party."PartyName" and to fact_payments."PayorName"/"PayeeName".';
COMMENT ON COLUMN salesforce."Account"."AnnualRevenue" IS
  'Reported annual revenue. CURRENT SNAPSHOT ONLY — no history. There is NO PreviousAnnualRevenue / RevenueGrowth / LastYearRevenue column. Revenue trend questions require a history table or a payment-volume proxy.';
COMMENT ON COLUMN salesforce."Account"."Rating" IS
  'Sales-team color coding (Hot / Warm / Cold). NOT a financial-health indicator — do not use as a revenue proxy.';
COMMENT ON COLUMN salesforce."Account"."Industry" IS
  'CRM industry vocabulary. NOT identical to bankdw.dim_party."IndustrySector" — values may differ across schemas.';

-- ---- Opportunity ------------------------------------------------
COMMENT ON TABLE salesforce."Opportunity" IS
  'Sales pipeline opportunity for an Account. Amount is deal value (pipeline) — NOT realized revenue or payment volume.';
COMMENT ON COLUMN salesforce."Opportunity"."Amount" IS
  'Deal value in USD. Pipeline only — does not mean money has moved.';
COMMENT ON COLUMN salesforce."Opportunity"."StageName" IS
  'Sales stage. "Closed Won" is the won terminal; "Closed Lost" is the lost terminal; everything else is open pipeline.';

-- ---- Contact / Lead ---------------------------------------------
COMMENT ON TABLE salesforce."Contact" IS
  'Individual person within an Account. PII columns (Email, Phone) are masked unless caller has rm/senior_rm/manager/compliance_officer role.';
COMMENT ON TABLE salesforce."Lead" IS
  'Sales lead — a prospect not yet converted to an Account. Distinct from Contact.';

-- ---- Case / Contract -------------------------------------------
COMMENT ON TABLE salesforce."Case" IS
  'Customer support case linked to an Account.';
COMMENT ON TABLE salesforce."Contract" IS
  'Active or pending Account contract.';

-- ---- Campaign / Task / Event -----------------------------------
COMMENT ON TABLE salesforce."Campaign" IS
  'Marketing campaign (events, drips, conferences).';
COMMENT ON TABLE salesforce."Task" IS
  'Activity task (to-do for an account / lead / opportunity).';
COMMENT ON TABLE salesforce."Event" IS
  'Calendared activity event (meeting, call).';

-- ---- Product2 ---------------------------------------------------
COMMENT ON TABLE salesforce."Product2" IS
  'Salesforce product catalog entry (CRM-side product). Distinct from bankdw.dim_product (banking-side product / rail).';
