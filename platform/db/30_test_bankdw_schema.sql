-- ============================================================
-- BANKDW Test Schema
-- Generated from testdata/bankdw_schema.csv
-- ============================================================

CREATE SCHEMA IF NOT EXISTS bankdw;

-- Bridge table linking parties to bank accounts and related bank attributes.
CREATE TABLE IF NOT EXISTS bankdw."bridge_party_account" (
    "PartyAccountKey" BIGINT NOT NULL PRIMARY KEY,
    "PartyName" VARCHAR(28) NOT NULL,
    "AccountNumber" TEXT NOT NULL,
    "BankName" VARCHAR(20) NOT NULL,
    "RoutingNumber" TEXT NOT NULL,
    "PartyID" VARCHAR(13) NOT NULL,
    "BankID" VARCHAR(13) NOT NULL,
    "AccountType" VARCHAR(10) NOT NULL,
    "AccountStatus" VARCHAR(10) NOT NULL,
    "CurrencyCode" VARCHAR(3) NOT NULL
);

-- Conformed payments bank dimension representing originating and receiving banks.
CREATE TABLE IF NOT EXISTS bankdw."dim_bank" (
    "BankKey" BIGINT NOT NULL,
    "BankID" VARCHAR(13) NOT NULL,
    "BankName" VARCHAR(20) NOT NULL,
    "BankRoleType" VARCHAR(19) NOT NULL,
    "RoutingNumber" TEXT NOT NULL,
    "SWIFTBIC" TEXT NOT NULL,
    "BankType" VARCHAR(15) NOT NULL,
    "OwnershipType" VARCHAR(7) NOT NULL,
    "CountryCode" VARCHAR(2) NOT NULL,
    "HeadquartersState" VARCHAR(2) NOT NULL,
    "HeadquartersCity" VARCHAR(8) NOT NULL,
    "Regulator" VARCHAR(15) NOT NULL,
    "ClearingNetworksSupported" VARCHAR(17) NOT NULL,
    "CorrespondentBankFlag" TEXT NOT NULL,
    "SettlementCurrency" VARCHAR(3) NOT NULL,
    "LiquidityTier" VARCHAR(6) NOT NULL,
    "BSAAMLProgramRating" VARCHAR(12) NOT NULL,
    "SanctionsComplianceStatus" VARCHAR(9) NOT NULL,
    "BankStatus" VARCHAR(6) NOT NULL,
    "EstablishedDate" DATE NOT NULL,
    "SourceSystem" VARCHAR(13) NOT NULL,
    "SourceNaturalKey" VARCHAR(20) NOT NULL,
    "CreatedDate" DATE NOT NULL,
    "UpdatedDate" DATE NOT NULL,
    PRIMARY KEY ("BankKey"),
    UNIQUE ("SourceNaturalKey")
);

-- Conformed payments party dimension representing payors and payees.
CREATE TABLE IF NOT EXISTS bankdw."dim_party" (
    "PartyKey" BIGINT NOT NULL,
    "PartyID" VARCHAR(13) NOT NULL,
    "PartyName" VARCHAR(28) NOT NULL,
    "PartyRoleType" VARCHAR(11) NOT NULL,
    "PartyType" VARCHAR(10) NOT NULL,
    "CustomerSegment" VARCHAR(13) NOT NULL,
    "KYCStatus" VARCHAR(22) NOT NULL,
    "RiskRating" VARCHAR(8) NOT NULL,
    "AMLRiskCategory" VARCHAR(6) NOT NULL,
    "SanctionsScreeningStatus" VARCHAR(15) NOT NULL,
    "PEPFlag" TEXT NOT NULL,
    "IndustrySector" VARCHAR(21) NOT NULL,
    "TaxIDType" TEXT NOT NULL,
    "CountryCode" VARCHAR(2) NOT NULL,
    "StateProvinceCode" VARCHAR(2) NOT NULL,
    "City" VARCHAR(13) NOT NULL,
    "PostalCode" TEXT NOT NULL,
    "PreferredChannel" VARCHAR(15) NOT NULL,
    "FraudMonitoringSegment" VARCHAR(21) NOT NULL,
    "CustomerStatus" VARCHAR(10) NOT NULL,
    "OnboardingDate" DATE NOT NULL,
    "RelationshipStartDate" DATE NOT NULL,
    "SourceSystem" VARCHAR(13) NOT NULL,
    "SourceNaturalKey" VARCHAR(28) NOT NULL,
    "CreatedDate" DATE NOT NULL,
    "UpdatedDate" DATE NOT NULL,
    PRIMARY KEY ("PartyKey"),
    UNIQUE ("SourceNaturalKey")
);

-- Payment transactions fact table (not in schema CSV — derived from CSV header).
-- AccountNumber and RoutingNumber columns are kept as TEXT to preserve leading zeros.
CREATE TABLE IF NOT EXISTS bankdw."fact_payments" (
    "TransactionID"        VARCHAR(13)    NOT NULL PRIMARY KEY,
    "TransactionDate"      DATE           NOT NULL,
    "PayorName"            VARCHAR(28)    NOT NULL,
    "PayorAccountNumber"   TEXT           NOT NULL,
    "PayorBank"            VARCHAR(20)    NOT NULL,
    "PayorRoutingNumber"   TEXT           NOT NULL,
    "PayeeName"            VARCHAR(28)    NOT NULL,
    "PayeeAccountNumber"   TEXT           NOT NULL,
    "PayeeBank"            VARCHAR(20)    NOT NULL,
    "PayeeRoutingNumber"   TEXT           NOT NULL,
    "TransactionType"      VARCHAR(25)    NOT NULL,
    "Amount"               NUMERIC(15,2)  NOT NULL,
    "Currency"             VARCHAR(3)     NOT NULL,
    "Status"               VARCHAR(10)    NOT NULL
);

-- Payments product dimension representing transaction types and payment rails.
CREATE TABLE IF NOT EXISTS bankdw."dim_product" (
    "ProductKey" BIGINT NOT NULL,
    "ProductID" VARCHAR(13) NOT NULL,
    "ProductName" VARCHAR(23) NOT NULL,
    "ProductCategory" VARCHAR(15) NOT NULL,
    "ProductFamily" VARCHAR(18) NOT NULL,
    "PaymentRail" VARCHAR(23) NOT NULL,
    "Directionality" VARCHAR(12) NOT NULL,
    "SettlementMethod" VARCHAR(5) NOT NULL,
    "SettlementSpeed" VARCHAR(10) NOT NULL,
    "TypicalUseCase" VARCHAR(36) NOT NULL,
    "RiskLevel" VARCHAR(6) NOT NULL,
    "ChargebackReturnExposure" VARCHAR(6) NOT NULL,
    "Reversibility" VARCHAR(20) NOT NULL,
    "CrossBorderCapability" VARCHAR(1) NOT NULL,
    "DefaultCurrency" VARCHAR(3) NOT NULL,
    "GeographyScope" VARCHAR(8) NOT NULL,
    "ComplianceConsiderations" VARCHAR(50) NOT NULL,
    "GLMappingCategory" VARCHAR(23) NOT NULL,
    "ProductStatus" VARCHAR(6) NOT NULL,
    "SourceSystem" VARCHAR(13) NOT NULL,
    "SourceNaturalKey" VARCHAR(23) NOT NULL,
    "CreatedDate" DATE NOT NULL,
    "UpdatedDate" DATE NOT NULL,
    PRIMARY KEY ("ProductKey"),
    UNIQUE ("SourceNaturalKey")
);
