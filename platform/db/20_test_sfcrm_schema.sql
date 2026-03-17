-- ============================================================
-- SALESFORCE Test Schema
-- Generated from testdata/sfcrm_schema.csv
-- ============================================================

CREATE SCHEMA IF NOT EXISTS salesforce;

-- Salesforce standard Account object storing organizations or business customers.
CREATE TABLE IF NOT EXISTS salesforce."Account" (
    "Id" VARCHAR(18) NOT NULL PRIMARY KEY,
    "Name" VARCHAR(28) NOT NULL,
    "Type" VARCHAR(17) NOT NULL,
    "Industry" VARCHAR(14) NOT NULL,
    "AccountNumber" TEXT NOT NULL,
    "Ownership" VARCHAR(10) NOT NULL,
    "Phone" VARCHAR(14) NOT NULL,
    "Website" VARCHAR(41) NOT NULL,
    "BillingStreet" VARCHAR(19) NOT NULL,
    "BillingCity" VARCHAR(13) NOT NULL,
    "BillingState" VARCHAR(2) NOT NULL,
    "BillingPostalCode" TEXT NOT NULL,
    "BillingCountry" VARCHAR(3) NOT NULL,
    "AnnualRevenue" BIGINT NOT NULL,
    "NumberOfEmployees" BIGINT NOT NULL,
    "Rating" VARCHAR(4) NOT NULL
);

-- Salesforce standard Campaign object storing marketing initiatives and events.
CREATE TABLE IF NOT EXISTS salesforce."Campaign" (
    "Id" VARCHAR(18) NOT NULL PRIMARY KEY,
    "Name" VARCHAR(33) NOT NULL,
    "Type" VARCHAR(13) NOT NULL,
    "Status" VARCHAR(11) NOT NULL,
    "StartDate" DATE NOT NULL,
    "EndDate" DATE NOT NULL,
    "BudgetedCost" BIGINT NOT NULL,
    "ActualCost" BIGINT NOT NULL,
    "ExpectedRevenue" BIGINT NOT NULL,
    "IsActive" TEXT NOT NULL,
    "Description" VARCHAR(81) NOT NULL
);

-- Junction object linking leads or contacts to campaigns and response status.
CREATE TABLE IF NOT EXISTS salesforce."CampaignMember" (
    "Id" VARCHAR(18) NOT NULL PRIMARY KEY,
    "CampaignId" VARCHAR(18) NOT NULL,
    "ContactId" VARCHAR(18),
    "LeadId" VARCHAR(18),
    "Status" VARCHAR(10) NOT NULL,
    "HasResponded" TEXT NOT NULL
);

-- Salesforce standard Case object storing service issues, inquiries, or investigat
CREATE TABLE IF NOT EXISTS salesforce."Case" (
    "Id" VARCHAR(18) NOT NULL PRIMARY KEY,
    "AccountId" VARCHAR(18) NOT NULL,
    "ContactId" VARCHAR(18) NOT NULL,
    "CaseNumber" BIGINT NOT NULL,
    "Subject" VARCHAR(25) NOT NULL,
    "Description" VARCHAR(105) NOT NULL,
    "Status" VARCHAR(9) NOT NULL,
    "Priority" VARCHAR(8) NOT NULL,
    "Origin" VARCHAR(6) NOT NULL,
    "Type" VARCHAR(15) NOT NULL,
    "Reason" VARCHAR(27) NOT NULL,
    "SuppliedEmail" VARCHAR(38) NOT NULL,
    "SuppliedPhone" VARCHAR(14) NOT NULL,
    "CreatedDate" DATE NOT NULL,
    "ClosedDate" DATE
);

-- Salesforce standard Contact object storing person-level contacts linked to accou
CREATE TABLE IF NOT EXISTS salesforce."Contact" (
    "Id" VARCHAR(18) NOT NULL PRIMARY KEY,
    "AccountId" VARCHAR(18) NOT NULL,
    "FirstName" VARCHAR(8) NOT NULL,
    "LastName" VARCHAR(7) NOT NULL,
    "Email" VARCHAR(38) NOT NULL,
    "Phone" VARCHAR(14) NOT NULL,
    "Title" VARCHAR(20) NOT NULL,
    "Department" VARCHAR(8) NOT NULL,
    "MailingStreet" VARCHAR(19) NOT NULL,
    "MailingCity" VARCHAR(13) NOT NULL,
    "MailingState" VARCHAR(2) NOT NULL,
    "MailingPostalCode" TEXT NOT NULL,
    "MailingCountry" VARCHAR(3) NOT NULL,
    "LeadSource" VARCHAR(16) NOT NULL
);

-- Salesforce standard Contract object storing customer agreement terms and dates.
CREATE TABLE IF NOT EXISTS salesforce."Contract" (
    "Id" VARCHAR(18) NOT NULL PRIMARY KEY,
    "AccountId" VARCHAR(18) NOT NULL,
    "ContractNumber" VARCHAR(13) NOT NULL,
    "StartDate" DATE NOT NULL,
    "EndDate" DATE NOT NULL,
    "Status" VARCHAR(19) NOT NULL,
    "ContractTerm" BIGINT NOT NULL,
    "OwnerExpirationNotice" BIGINT NOT NULL,
    "SpecialTerms" VARCHAR(46) NOT NULL,
    "Description" VARCHAR(103) NOT NULL
);

-- Salesforce standard Event activity object storing meetings and calendar events.
CREATE TABLE IF NOT EXISTS salesforce."Event" (
    "Id" VARCHAR(18) NOT NULL PRIMARY KEY,
    "Subject" VARCHAR(25) NOT NULL,
    "StartDateTime" TIMESTAMP NOT NULL,
    "EndDateTime" TIMESTAMP NOT NULL,
    "IsAllDayEvent" TEXT NOT NULL,
    "Location" VARCHAR(14) NOT NULL,
    "WhoId" VARCHAR(18) NOT NULL,
    "WhatId" VARCHAR(18) NOT NULL,
    "Description" VARCHAR(90) NOT NULL,
    "Type" VARCHAR(12) NOT NULL
);

-- Salesforce standard Lead object storing pre-qualified prospects not yet converte
CREATE TABLE IF NOT EXISTS salesforce."Lead" (
    "Id" VARCHAR(18) NOT NULL PRIMARY KEY,
    "FirstName" VARCHAR(7) NOT NULL,
    "LastName" VARCHAR(6) NOT NULL,
    "Company" VARCHAR(31) NOT NULL,
    "Title" VARCHAR(19) NOT NULL,
    "Email" VARCHAR(45) NOT NULL,
    "Phone" VARCHAR(14) NOT NULL,
    "Street" VARCHAR(19) NOT NULL,
    "City" VARCHAR(13) NOT NULL,
    "State" VARCHAR(2) NOT NULL,
    "PostalCode" TEXT NOT NULL,
    "Country" VARCHAR(3) NOT NULL,
    "Status" VARCHAR(20) NOT NULL,
    "LeadSource" VARCHAR(16) NOT NULL,
    "Industry" VARCHAR(16) NOT NULL,
    "AnnualRevenue" BIGINT NOT NULL,
    "NumberOfEmployees" BIGINT NOT NULL,
    "Rating" VARCHAR(4) NOT NULL
);

-- Salesforce standard Opportunity object storing pipeline deals and expected reven
CREATE TABLE IF NOT EXISTS salesforce."Opportunity" (
    "Id" VARCHAR(18) NOT NULL PRIMARY KEY,
    "AccountId" VARCHAR(18) NOT NULL,
    "Pricebook2Id" VARCHAR(18) NOT NULL,
    "CampaignId" VARCHAR(18) NOT NULL,
    "Name" VARCHAR(55) NOT NULL,
    "StageName" VARCHAR(20) NOT NULL,
    "Amount" BIGINT NOT NULL,
    "CloseDate" DATE NOT NULL,
    "Type" VARCHAR(12) NOT NULL,
    "LeadSource" VARCHAR(16) NOT NULL,
    "Probability" BIGINT NOT NULL,
    "ForecastCategoryName" VARCHAR(9) NOT NULL,
    "NextStep" VARCHAR(40) NOT NULL,
    "Description" VARCHAR(127) NOT NULL
);

-- Junction object linking contacts to opportunities and their buying role.
CREATE TABLE IF NOT EXISTS salesforce."OpportunityContactRole" (
    "Id" VARCHAR(18) NOT NULL PRIMARY KEY,
    "OpportunityId" VARCHAR(18) NOT NULL,
    "ContactId" VARCHAR(18) NOT NULL,
    "Role" VARCHAR(15) NOT NULL,
    "IsPrimary" TEXT NOT NULL
);

-- Opportunity product line object storing deal-level product quantities and prices
CREATE TABLE IF NOT EXISTS salesforce."OpportunityLineItem" (
    "Id" VARCHAR(18) NOT NULL PRIMARY KEY,
    "OpportunityId" VARCHAR(18) NOT NULL,
    "PricebookEntryId" VARCHAR(18) NOT NULL,
    "Quantity" BIGINT NOT NULL,
    "UnitPrice" BIGINT NOT NULL,
    "TotalPrice" BIGINT NOT NULL,
    "ServiceDate" DATE NOT NULL,
    "Description" VARCHAR(61) NOT NULL
);

-- Salesforce standard Price Book object grouping product prices.
CREATE TABLE IF NOT EXISTS salesforce."Pricebook2" (
    "Id" VARCHAR(18) NOT NULL PRIMARY KEY,
    "Name" VARCHAR(37) NOT NULL,
    "IsActive" TEXT NOT NULL,
    "Description" VARCHAR(59) NOT NULL
);

-- Junction object linking products to price books with unit pricing.
CREATE TABLE IF NOT EXISTS salesforce."PricebookEntry" (
    "Id" VARCHAR(18) NOT NULL PRIMARY KEY,
    "Pricebook2Id" VARCHAR(18) NOT NULL,
    "Product2Id" VARCHAR(18) NOT NULL,
    "UnitPrice" BIGINT NOT NULL,
    "IsActive" TEXT NOT NULL,
    "UseStandardPrice" TEXT NOT NULL
);

-- Salesforce standard Product object storing sellable products and service offerin
CREATE TABLE IF NOT EXISTS salesforce."Product2" (
    "Id" VARCHAR(18) NOT NULL PRIMARY KEY,
    "Name" VARCHAR(25) NOT NULL,
    "ProductCode" VARCHAR(7) NOT NULL,
    "Family" VARCHAR(16) NOT NULL,
    "IsActive" TEXT NOT NULL,
    "Description" VARCHAR(74) NOT NULL
);

-- Salesforce standard Task activity object storing to-do and follow-up actions.
CREATE TABLE IF NOT EXISTS salesforce."Task" (
    "Id" VARCHAR(18) NOT NULL PRIMARY KEY,
    "Subject" VARCHAR(22) NOT NULL,
    "ActivityDate" DATE NOT NULL,
    "Status" VARCHAR(11) NOT NULL,
    "Priority" VARCHAR(6) NOT NULL,
    "WhoId" VARCHAR(18) NOT NULL,
    "WhatId" VARCHAR(18) NOT NULL,
    "Type" VARCHAR(9) NOT NULL,
    "Description" VARCHAR(88) NOT NULL
);
