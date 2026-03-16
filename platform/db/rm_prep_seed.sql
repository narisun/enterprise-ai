-- ============================================================
-- platform/db/rm_prep_seed.sql
--
-- Realistic test data for RM Prep Agent Phase 1 MVP.
-- Four companies across different industries, each with
-- distinct relationship signals to validate brief generation.
--
-- Companies:
--   ACME001  Acme Manufacturing      — Growing, treasury opportunity
--   ABCL001  ABC Logistics           — Stable, cash management RFP pending
--   GTCH001  GlobalTech Corp         — At-risk, CFO departure, declining volumes
--   MHLT001  Meridian Healthcare     — Expanding, FX / international opportunity
--
-- Run order: after rm_prep_schema.sql
-- ============================================================

-- ============================================================
-- sf_accounts
-- ============================================================
INSERT INTO sf_accounts (account_id, account_name, industry, sub_industry, annual_revenue, employee_count, segment, account_owner, phone, website, hq_city, hq_country, description) VALUES
('0015f00001ACME001', 'Acme Manufacturing',  'Manufacturing',   'Industrial Equipment',    500000000,  3200, 'enterprise',   'Sarah Chen',   '+1-312-555-0101', 'www.acme-mfg.com',         'Chicago',       'USA', 'Leading Midwest manufacturer of industrial equipment and precision components. Founded 1985. Strong export business to EU and Asia.'),
('0015f00001ABCL001', 'ABC Logistics',       'Transportation',  'Freight & Logistics',     200000000,  1400, 'mid-market',   'James Okafor', '+1-404-555-0202', 'www.abclogistics.com',     'Atlanta',       'USA', 'Regional logistics and freight company operating across the Southeast. Recently expanded to Midwest corridor.'),
('0015f00001GTCH001', 'GlobalTech Corp',     'Technology',      'Enterprise Software',    2000000000, 12000, 'enterprise',   'Sarah Chen',   '+1-415-555-0303', 'www.globaltechcorp.com',   'San Francisco', 'USA', 'Enterprise SaaS company, B2B focus. IPO 2019. Heavy international presence with entities in UK, Germany, Singapore, Canada.'),
('0015f00001MHLT001', 'Meridian Healthcare', 'Healthcare',      'Hospitals & Health Sys',  300000000,  2100, 'mid-market',   'James Okafor', '+1-617-555-0404', 'www.meridianhealthcare.com','Boston',        'USA', 'Regional healthcare network with 4 hospitals and 22 outpatient clinics. Acquired a Canadian imaging company in Q4 2025.');

-- ============================================================
-- sf_contacts
-- ============================================================
INSERT INTO sf_contacts (contact_id, account_id, first_name, last_name, title, email, phone, is_primary, last_contacted_date) VALUES
-- Acme Manufacturing
('0035f00001ACME001', '0015f00001ACME001', 'Robert',  'Harrington', 'CFO',                         'r.harrington@acme-mfg.com',    '+1-312-555-0111', TRUE,  '2026-02-25'),
('0035f00001ACME002', '0015f00001ACME001', 'Linda',   'Park',       'VP Finance',                  'l.park@acme-mfg.com',          '+1-312-555-0112', FALSE, '2026-01-15'),
('0035f00001ACME003', '0015f00001ACME001', 'Marcus',  'Webb',       'Treasurer',                   'm.webb@acme-mfg.com',          '+1-312-555-0113', FALSE, '2025-12-10'),

-- ABC Logistics
('0035f00001ABCL001', '0015f00001ABCL001', 'Diana',   'Torres',     'CFO',                         'd.torres@abclogistics.com',    '+1-404-555-0211', TRUE,  '2026-03-01'),
('0035f00001ABCL002', '0015f00001ABCL001', 'Kevin',   'Marsh',      'Controller',                  'k.marsh@abclogistics.com',     '+1-404-555-0212', FALSE, '2026-02-10'),

-- GlobalTech Corp
('0035f00001GTCH001', '0015f00001GTCH001', 'Angela',  'Novak',      'CFO',                         'a.novak@globaltechcorp.com',   '+1-415-555-0311', TRUE,  '2026-01-20'),
('0035f00001GTCH002', '0015f00001GTCH001', 'David',   'Kim',        'VP Treasury',                 'd.kim@globaltechcorp.com',     '+1-415-555-0312', FALSE, '2025-11-30'),
('0035f00001GTCH003', '0015f00001GTCH001', 'Rachel',  'Stone',      'Head of Banking Relations',   'r.stone@globaltechcorp.com',   '+1-415-555-0313', FALSE, '2026-02-28'),

-- Meridian Healthcare
('0035f00001MHLT001', '0015f00001MHLT001', 'Thomas',  'Nguyen',     'CFO',                         't.nguyen@meridianhealthcare.com','+1-617-555-0411', TRUE,  '2026-03-05'),
('0035f00001MHLT002', '0015f00001MHLT001', 'Patricia','Osei',       'Director of Finance',         'p.osei@meridianhealthcare.com','+1-617-555-0412', FALSE, '2026-02-20');

-- ============================================================
-- sf_activities  (last 6 months of relationship history)
-- ============================================================
INSERT INTO sf_activities (activity_id, account_id, contact_id, activity_type, subject, description, activity_date, duration_minutes, created_by) VALUES
-- Acme Manufacturing activities
('0055f00001ACME001', '0015f00001ACME001', '0035f00001ACME001', 'meeting', 'Q4 Business Review — Treasury Services', 'Annual review with CFO Robert Harrington. Discussed current wire volume growth to EU suppliers. Robert mentioned they are adding two new German and Dutch vendors in Q2. Expressed interest in FX hedging for EUR exposure ($8-10M annually). Asked for treasury services deck.', '2026-02-25', 60, 'Sarah Chen'),
('0055f00001ACME002', '0015f00001ACME001', '0035f00001ACME001', 'call',    'Follow-up: Treasury Services Deck', 'Called Robert to confirm receipt of treasury deck. He has shared with his team. Confirmed a follow-up meeting in mid-March. Linda Park (VP Finance) will also join.', '2026-03-05', 20, 'Sarah Chen'),
('0055f00001ACME003', '0015f00001ACME001', '0035f00001ACME002', 'email',   'Cash Management Pricing — Q1 Refresh', 'Sent updated cash management pricing to Linda Park at her request. She compared against current provider (Wells). Our ACH pricing is 15% lower. She will include in Q2 vendor review.', '2026-01-15', 10, 'Sarah Chen'),
('0055f00001ACME004', '0015f00001ACME001', '0035f00001ACME003', 'meeting', 'International Payments Deep-Dive', 'Met with Treasurer Marcus Webb to map out current international payment corridors. Currently sending $2.5M/month in EUR wires manually. Opportunity to automate via FX forward contracts and batch wire program.', '2025-12-10', 45, 'Sarah Chen'),
('0055f00001ACME005', '0015f00001ACME001', '0035f00001ACME001', 'note',    'Internal: Acme Strategic Account Plan 2026', 'Account plan filed. Priority 1: Close treasury services ($1.2M AUM). Priority 2: Expand FX hedging. Robert Harrington is a champion but needs board approval for new banking products over $500K.', '2026-01-05',  0, 'Sarah Chen'),

-- ABC Logistics activities
('0055f00001ABCL001', '0015f00001ABCL001', '0035f00001ABCL001', 'meeting', 'Cash Management RFP Kickoff', 'Diana Torres (CFO) invited us to participate in their cash management RFP. They are unhappy with current bank (Chase) due to slow ACH settlement and poor online portal. RFP due April 15. Key requirements: same-day ACH, integrated AP automation, real-time balance visibility.', '2026-03-01', 90, 'James Okafor'),
('0055f00001ABCL002', '0015f00001ABCL001', '0035f00001ABCL002', 'email',   'RFP Requirements Clarification', 'Email exchange with Kevin Marsh (Controller) to clarify RFP technical requirements. Confirmed they need SFTP-based file integration for their TMS system. Our treasury API connector supports this natively.', '2026-02-10', 15, 'James Okafor'),
('0055f00001ABCL003', '0015f00001ABCL001', '0035f00001ABCL001', 'call',    'Q3 Relationship Check-In', 'Routine quarterly call. Diana mentioned they completed the Midwest expansion — now running 18 distribution centers. Payment volumes to vendors have increased ~30% YoY. May need credit facility expansion.', '2025-11-20', 30, 'James Okafor'),

-- GlobalTech Corp activities
('0055f00001GTCH001', '0015f00001GTCH001', '0035f00001GTCH001', 'meeting', 'CFO Transition Meeting — Angela Novak Onboarding', 'First meeting with new CFO Angela Novak (started Jan 2026). She replaced Michael Chen who left for a competitor. Angela comes from JPMorgan background. She is conducting a full banking relationship review for Q2. Seemed neutral about our relationship — no strong preference stated.', '2026-01-20', 60, 'Sarah Chen'),
('0055f00001GTCH002', '0015f00001GTCH001', '0035f00001GTCH003', 'email',   'Banking Relationship Review — Data Request', 'Rachel Stone requested 24-month transaction history and fee summary for banking review. Sent report. Our total fees: $340K/year. JP Morgan quoting at ~$280K (from intel). Need to demonstrate value-add services.', '2026-02-28', 10, 'Sarah Chen'),
('0055f00001GTCH003', '0015f00001GTCH001', '0035f00001GTCH002', 'meeting', 'International Treasury Structure Review', 'Met with David Kim (VP Treasury) to discuss their current intercompany payment structure. They run $15M/month in inter-entity wires (US to UK, Singapore, Germany). Using 3 banks currently. Opportunity to consolidate under our global payments platform.', '2025-11-30', 75, 'Sarah Chen'),
('0055f00001GTCH004', '0015f00001GTCH001', '0035f00001GTCH001', 'note',    'Risk Alert: CFO Change + Banking Review in Progress', 'RISK: CFO Michael Chen was our main champion. Angela Novak is new and unknown. Q2 banking review could result in wallet share loss. Recommend: executive sponsor engagement (MD-level intro), prepare comprehensive value-add case, accelerate global payments demo.', '2026-01-22',  0, 'Sarah Chen'),

-- Meridian Healthcare activities
('0055f00001MHLT001', '0015f00001MHLT001', '0035f00001MHLT001', 'meeting', 'Q1 Business Review — International Expansion Support', 'CFO Thomas Nguyen discussed the recent acquisition of MedImage Canada (closed Nov 2025). They now have CAD cash flows of ~$2M/month. Currently using inefficient spot FX at poor rates. Interested in FX forward contracts for CAD/USD exposure. Also need cross-border payroll solution for 80 Canadian employees.', '2026-03-05', 75, 'James Okafor'),
('0055f00001MHLT002', '0015f00001MHLT001', '0035f00001MHLT002', 'call',    'Accounts Payable Automation Discussion', 'Call with Patricia Osei (Director of Finance) on AP automation. Currently processing 2,200 vendor invoices/month manually. Interested in our AP automation platform. Pilot with one hospital would take 60 days. Decision maker is Thomas Nguyen.', '2026-02-20', 40, 'James Okafor'),
('0055f00001MHLT003', '0015f00001MHLT001', '0035f00001MHLT001', 'email',   'Healthcare Banking Compliance Update', 'Sent Thomas updated documentation on our healthcare-specific banking compliance (HIPAA payment data handling, BAA templates). He forwarded to their legal team. Legal review estimated 2-3 weeks.', '2026-01-30', 10, 'James Okafor');

-- ============================================================
-- sf_opportunities
-- ============================================================
INSERT INTO sf_opportunities (opportunity_id, account_id, opportunity_name, stage, amount, close_date, probability, product_category, next_steps, description) VALUES
-- Acme Manufacturing
('0065f00001ACME001', '0015f00001ACME001', 'Acme — Treasury Services & FX Hedging',         'Proposal',       1200000.00, '2026-04-30',  60, 'treasury',  'Deliver formal treasury proposal by March 20. Follow-up meeting with CFO + VP Finance scheduled. Confirm EUR notional for FX program.',                              'Comprehensive treasury management solution including FX forward contracts for EUR exposure ($8-10M annually), automated international wire program to EU suppliers, and upgraded cash management.'),
('0065f00001ACME002', '0015f00001ACME001', 'Acme — Cash Management Upgrade',                 'Qualification',   350000.00, '2026-06-30',  40, 'deposits',  'Send competitive pricing comparison vs Wells. Schedule demo of online banking portal.',                                                                              'Cash management upgrade including same-day ACH, improved portal, and automated reconciliation feeds.'),

-- ABC Logistics
('0065f00001ABCL001', '0015f00001ABCL001', 'ABC Logistics — Cash Management RFP',           'Negotiation',     480000.00, '2026-04-15',  75, 'deposits',  'Submit final RFP response by April 1. Confirm SFTP integration demo date with IT team. Prepare reference from similar logistics client.',                          'Full cash management replacement. Same-day ACH, API-based TMS integration, real-time balance visibility. Competing against Chase and PNC.'),
('0065f00001ABCL002', '0015f00001ABCL001', 'ABC Logistics — Working Capital Credit Line',   'Prospecting',     750000.00, '2026-09-30',  20, 'lending',   'Mention in next call — Diana indicated credit expansion possible after expansion stabilizes.',                                                                   'Expansion of existing $5M revolver to $15M to support Midwest distribution network growth.'),

-- GlobalTech Corp
('0065f00001GTCH001', '0015f00001GTCH001', 'GlobalTech — Global Payments Consolidation',    'Qualification',  2800000.00, '2026-07-31',  25, 'payments',  'Secure MD-level sponsor meeting before Q2 banking review. Prepare global payments consolidation ROI analysis. Counter JPM proposal.',                            'Consolidation of multi-bank international payment structure. $15M/month inter-entity wires across 4 countries. Opportunity to become primary global payments bank.'),
('0065f00001GTCH002', '0015f00001GTCH001', 'GlobalTech — FX Risk Management Program',       'Prospecting',     600000.00, '2026-10-31',  15, 'fx',        'Include in global payments consolidation pitch as bundled offering.',                                                                                             'FX hedging program for EUR, GBP, SGD exposure. Estimated $45M annual FX volume.'),

-- Meridian Healthcare
('0065f00001MHLT001', '0015f00001MHLT001', 'Meridian — FX Forwards CAD/USD',                'Proposal',        180000.00, '2026-04-30',  70, 'fx',        'Send FX forward program term sheet by March 15. Follow up with Thomas after legal BAA review complete.',                                                         'FX forward contracts for CAD/USD exposure from MedImage Canada acquisition. ~$2M/month CAD cash flows.'),
('0065f00001MHLT002', '0015f00001MHLT001', 'Meridian — AP Automation Platform',             'Qualification',   260000.00, '2026-06-30',  45, 'payments',  'Propose 60-day pilot with one hospital. Get Thomas approval. Patricia Osei as project lead.',                                                                    'AP automation for 2,200 invoices/month. Electronic payments, workflow routing, GL integration.');

-- ============================================================
-- sf_tasks
-- ============================================================
INSERT INTO sf_tasks (task_id, account_id, contact_id, subject, status, priority, due_date, description, assigned_to) VALUES
('00T5f00001ACME001', '0015f00001ACME001', '0035f00001ACME001', 'Send Treasury Services formal proposal', 'Open', 'High',   '2026-03-20', 'Formal proposal doc including FX hedging program, wire automation, pricing. CFO is expecting by March 20.',         'Sarah Chen'),
('00T5f00001ACME002', '0015f00001ACME001', '0035f00001ACME002', 'Schedule portal demo for Linda Park',    'Open', 'Normal', '2026-03-25', 'Linda requested a demo of the upgraded online banking portal. Schedule 30 min Zoom.',                                 'Sarah Chen'),
('00T5f00001ABCL001', '0015f00001ABCL001', '0035f00001ABCL001', 'Submit ABC Logistics RFP response',      'Open', 'High',   '2026-04-01', 'Final RFP response due April 1. Include SFTP integration specs and reference contacts.',                              'James Okafor'),
('00T5f00001ABCL002', '0015f00001ABCL001', '0035f00001ABCL001', 'Arrange SFTP integration demo with IT', 'Open', 'High',   '2026-03-18', 'Diana confirmed IT team available week of March 18. Coordinate with our integration team.',                           'James Okafor'),
('00T5f00001GTCH001', '0015f00001GTCH001', '0035f00001GTCH001', 'Arrange MD intro meeting with Angela Novak', 'Open', 'High', '2026-03-31', 'Critical: new CFO onboarding. Need MD-level sponsor engagement before Q2 banking review. Escalate to regional head.', 'Sarah Chen'),
('00T5f00001GTCH002', '0015f00001GTCH001', '0035f00001GTCH003', 'Prepare global payments ROI analysis',   'Open', 'High',   '2026-03-28', 'Rachel Stone contact for data. Compare current multi-bank cost vs our consolidated solution.',                        'Sarah Chen'),
('00T5f00001MHLT001', '0015f00001MHLT001', '0035f00001MHLT001', 'Send FX forward term sheet',             'Open', 'High',   '2026-03-15', 'Thomas waiting for CAD/USD FX forward term sheet. Send by March 15.',                                               'James Okafor'),
('00T5f00001MHLT002', '0015f00001MHLT001', '0035f00001MHLT001', 'Follow up on legal BAA review',          'Open', 'Normal', '2026-03-25', 'Legal team reviewing BAA. Check status around March 20-25.',                                                        'James Okafor');

-- ============================================================
-- payment_transactions  (90+ days of history)
--
-- ACME001: growing international wires (+15% QoQ trend)
-- ABCL001: stable domestic ACH, small SWIFT
-- GTCH001: declining volumes (-12% QoQ, risk signal)
-- MHLT001: new CAD corridors from Nov 2025 acquisition
-- ============================================================

-- ---- ACME MANUFACTURING ----
-- January 2026
INSERT INTO payment_transactions (account_id, transaction_date, value_date, payment_type, direction, amount, currency, counterparty_name, counterparty_bank, counterparty_country, reference, purpose_code) VALUES
('0015f00001ACME001', '2026-01-05', '2026-01-06', 'wire',  'outbound', 850000.00, 'USD', 'Schultz Precision GmbH',     'Deutsche Bank AG',         'Germany',     'INV-2026-0105-DE', 'vendor'),
('0015f00001ACME001', '2026-01-08', '2026-01-09', 'wire',  'outbound', 420000.00, 'USD', 'Van den Berg Metals BV',     'ING Bank NV',              'Netherlands', 'INV-2026-0108-NL', 'vendor'),
('0015f00001ACME001', '2026-01-12', '2026-01-12', 'ach',   'outbound', 1240000.00,'USD', 'Acme Payroll Services',      'Wells Fargo Bank NA',       'USA',         'PAY-2026-0112',    'payroll'),
('0015f00001ACME001', '2026-01-15', '2026-01-16', 'wire',  'outbound', 310000.00, 'USD', 'Tanaka Industrial Japan KK', 'Mizuho Bank Ltd',           'Japan',       'INV-2026-0115-JP', 'vendor'),
('0015f00001ACME001', '2026-01-20', '2026-01-20', 'ach',   'inbound',  2100000.00,'USD', 'Midwest Industrial Supply',  'JPMorgan Chase Bank NA',   'USA',         'REC-2026-0120',    'vendor'),
('0015f00001ACME001', '2026-01-26', '2026-01-26', 'ach',   'outbound',  180000.00,'USD', 'Acme 401k Trust',            'Fidelity Investments',      'USA',         'RET-2026-0126',    'payroll'),
('0015f00001ACME001', '2026-01-28', '2026-01-29', 'wire',  'outbound', 750000.00, 'USD', 'Schultz Precision GmbH',     'Deutsche Bank AG',          'Germany',     'INV-2026-0128-DE', 'vendor'),
-- February 2026
('0015f00001ACME001', '2026-02-03', '2026-02-04', 'wire',  'outbound', 490000.00, 'USD', 'Van den Berg Metals BV',     'ING Bank NV',               'Netherlands', 'INV-2026-0203-NL', 'vendor'),
('0015f00001ACME001', '2026-02-10', '2026-02-10', 'ach',   'outbound', 1260000.00,'USD', 'Acme Payroll Services',      'Wells Fargo Bank NA',        'USA',         'PAY-2026-0210',    'payroll'),
('0015f00001ACME001', '2026-02-14', '2026-02-15', 'wire',  'outbound', 920000.00, 'USD', 'Schultz Precision GmbH',     'Deutsche Bank AG',           'Germany',     'INV-2026-0214-DE', 'vendor'),
('0015f00001ACME001', '2026-02-18', '2026-02-18', 'ach',   'inbound',  2350000.00,'USD', 'Midwest Industrial Supply',  'JPMorgan Chase Bank NA',    'USA',         'REC-2026-0218',    'vendor'),
('0015f00001ACME001', '2026-02-21', '2026-02-22', 'wire',  'outbound', 380000.00, 'USD', 'AutoParts Korea Ltd',        'KB Financial Group',        'South Korea', 'INV-2026-0221-KR', 'vendor'),
('0015f00001ACME001', '2026-02-26', '2026-02-26', 'ach',   'outbound',  185000.00,'USD', 'Acme 401k Trust',            'Fidelity Investments',       'USA',         'RET-2026-0226',    'payroll'),
-- March 2026 (partial — through March 15)
('0015f00001ACME001', '2026-03-03', '2026-03-04', 'wire',  'outbound', 560000.00, 'USD', 'Schultz Precision GmbH',     'Deutsche Bank AG',           'Germany',     'INV-2026-0303-DE', 'vendor'),
('0015f00001ACME001', '2026-03-07', '2026-03-08', 'wire',  'outbound', 430000.00, 'USD', 'Van den Berg Metals BV',     'ING Bank NV',                'Netherlands', 'INV-2026-0307-NL', 'vendor'),
('0015f00001ACME001', '2026-03-10', '2026-03-10', 'ach',   'outbound', 1275000.00,'USD', 'Acme Payroll Services',      'Wells Fargo Bank NA',         'USA',         'PAY-2026-0310',    'payroll'),
('0015f00001ACME001', '2026-03-12', '2026-03-12', 'ach',   'inbound',  2500000.00,'USD', 'Midwest Industrial Supply',  'JPMorgan Chase Bank NA',     'USA',         'REC-2026-0312',    'vendor'),
-- Q4 2025 baseline (prior quarter for trend comparison)
('0015f00001ACME001', '2025-12-05', '2025-12-06', 'wire',  'outbound', 700000.00, 'USD', 'Schultz Precision GmbH',     'Deutsche Bank AG',           'Germany',     'INV-2025-1205-DE', 'vendor'),
('0015f00001ACME001', '2025-12-10', '2025-12-10', 'ach',   'outbound', 1220000.00,'USD', 'Acme Payroll Services',      'Wells Fargo Bank NA',         'USA',         'PAY-2025-1210',    'payroll'),
('0015f00001ACME001', '2025-12-15', '2025-12-16', 'wire',  'outbound', 360000.00, 'USD', 'Van den Berg Metals BV',     'ING Bank NV',                'Netherlands', 'INV-2025-1215-NL', 'vendor'),
('0015f00001ACME001', '2025-12-20', '2025-12-20', 'ach',   'inbound',  1900000.00,'USD', 'Midwest Industrial Supply',  'JPMorgan Chase Bank NA',     'USA',         'REC-2025-1220',    'vendor');

-- ---- ABC LOGISTICS ----
INSERT INTO payment_transactions (account_id, transaction_date, value_date, payment_type, direction, amount, currency, counterparty_name, counterparty_bank, counterparty_country, reference, purpose_code) VALUES
-- January 2026
('0015f00001ABCL001', '2026-01-07', '2026-01-07', 'ach',  'outbound',  620000.00, 'USD', 'Southeast Fleet Management',  'Bank of America NA',         'USA', 'AP-2026-0107-FL', 'vendor'),
('0015f00001ABCL001', '2026-01-10', '2026-01-10', 'ach',  'outbound',  890000.00, 'USD', 'ABC Logistics Payroll',       'SunTrust Banks Inc',         'USA', 'PAY-2026-0110',   'payroll'),
('0015f00001ABCL001', '2026-01-14', '2026-01-14', 'ach',  'inbound',  1400000.00, 'USD', 'Home Depot Distribution',     'JPMorgan Chase Bank NA',     'USA', 'REC-2026-0114',   'vendor'),
('0015f00001ABCL001', '2026-01-21', '2026-01-21', 'ach',  'outbound',  310000.00, 'USD', 'Fuel & Maintenance Depot',    'Regions Bank',               'USA', 'AP-2026-0121-FL', 'vendor'),
('0015f00001ABCL001', '2026-01-28', '2026-01-28', 'ach',  'inbound',  1250000.00, 'USD', 'Amazon Fulfillment Corp',     'JPMorgan Chase Bank NA',     'USA', 'REC-2026-0128',   'vendor'),
-- February 2026
('0015f00001ABCL001', '2026-02-04', '2026-02-04', 'ach',  'outbound',  640000.00, 'USD', 'Southeast Fleet Management',  'Bank of America NA',         'USA', 'AP-2026-0204-FL', 'vendor'),
('0015f00001ABCL001', '2026-02-10', '2026-02-10', 'ach',  'outbound',  905000.00, 'USD', 'ABC Logistics Payroll',       'SunTrust Banks Inc',         'USA', 'PAY-2026-0210',   'payroll'),
('0015f00001ABCL001', '2026-02-14', '2026-02-14', 'ach',  'inbound',  1450000.00, 'USD', 'Home Depot Distribution',     'JPMorgan Chase Bank NA',     'USA', 'REC-2026-0214',   'vendor'),
('0015f00001ABCL001', '2026-02-25', '2026-02-25', 'wire', 'outbound',  125000.00, 'USD', 'Heidelberg Logistics DE',     'Commerzbank AG',             'Germany', 'AP-2026-0225-DE','vendor'),
-- March 2026
('0015f00001ABCL001', '2026-03-05', '2026-03-05', 'ach',  'outbound',  655000.00, 'USD', 'Southeast Fleet Management',  'Bank of America NA',         'USA', 'AP-2026-0305-FL', 'vendor'),
('0015f00001ABCL001', '2026-03-10', '2026-03-10', 'ach',  'outbound',  920000.00, 'USD', 'ABC Logistics Payroll',       'SunTrust Banks Inc',         'USA', 'PAY-2026-0310',   'payroll'),
('0015f00001ABCL001', '2026-03-12', '2026-03-12', 'ach',  'inbound',  1500000.00, 'USD', 'Amazon Fulfillment Corp',     'JPMorgan Chase Bank NA',     'USA', 'REC-2026-0312',   'vendor');

-- ---- GLOBALTECH CORP (declining volumes) ----
INSERT INTO payment_transactions (account_id, transaction_date, value_date, payment_type, direction, amount, currency, counterparty_name, counterparty_bank, counterparty_country, reference, purpose_code) VALUES
-- January 2026 (reduced vs prior year)
('0015f00001GTCH001', '2026-01-05', '2026-01-06', 'swift', 'outbound', 2100000.00, 'USD', 'GlobalTech UK Ltd',           'Barclays Bank PLC',          'UK',          'IC-2026-0105-UK', 'intercompany'),
('0015f00001GTCH001', '2026-01-05', '2026-01-06', 'swift', 'outbound',  980000.00, 'USD', 'GlobalTech Singapore Pte',    'DBS Bank Ltd',               'Singapore',   'IC-2026-0105-SG', 'intercompany'),
('0015f00001GTCH001', '2026-01-07', '2026-01-07', 'ach',   'outbound', 4200000.00, 'USD', 'GlobalTech US Payroll',       'ADP TotalSource',            'USA',         'PAY-2026-0107',   'payroll'),
('0015f00001GTCH001', '2026-01-12', '2026-01-13', 'swift', 'outbound',  720000.00, 'USD', 'GlobalTech GmbH Berlin',      'Deutsche Bank AG',           'Germany',     'IC-2026-0112-DE', 'intercompany'),
('0015f00001GTCH001', '2026-01-20', '2026-01-20', 'ach',   'inbound', 18500000.00, 'USD', 'Enterprise Customer Revenue', 'Bank of America NA',         'USA',         'REV-2026-0120',   'vendor'),
-- February 2026 (further decline)
('0015f00001GTCH001', '2026-02-05', '2026-02-06', 'swift', 'outbound', 1800000.00, 'USD', 'GlobalTech UK Ltd',           'Barclays Bank PLC',          'UK',          'IC-2026-0205-UK', 'intercompany'),
('0015f00001GTCH001', '2026-02-05', '2026-02-06', 'swift', 'outbound',  750000.00, 'USD', 'GlobalTech Singapore Pte',    'DBS Bank Ltd',               'Singapore',   'IC-2026-0205-SG', 'intercompany'),
('0015f00001GTCH001', '2026-02-07', '2026-02-07', 'ach',   'outbound', 4100000.00, 'USD', 'GlobalTech US Payroll',       'ADP TotalSource',            'USA',         'PAY-2026-0207',   'payroll'),
('0015f00001GTCH001', '2026-02-18', '2026-02-18', 'ach',   'inbound', 15200000.00, 'USD', 'Enterprise Customer Revenue', 'Bank of America NA',         'USA',         'REV-2026-0218',   'vendor'),
-- March 2026
('0015f00001GTCH001', '2026-03-05', '2026-03-06', 'swift', 'outbound', 1650000.00, 'USD', 'GlobalTech UK Ltd',           'Barclays Bank PLC',          'UK',          'IC-2026-0305-UK', 'intercompany'),
('0015f00001GTCH001', '2026-03-07', '2026-03-07', 'ach',   'outbound', 4050000.00, 'USD', 'GlobalTech US Payroll',       'ADP TotalSource',            'USA',         'PAY-2026-0307',   'payroll'),
-- Q4 2025 baseline (higher, to demonstrate decline)
('0015f00001GTCH001', '2025-12-05', '2025-12-06', 'swift', 'outbound', 2800000.00, 'USD', 'GlobalTech UK Ltd',           'Barclays Bank PLC',          'UK',          'IC-2025-1205-UK', 'intercompany'),
('0015f00001GTCH001', '2025-12-05', '2025-12-06', 'swift', 'outbound', 1200000.00, 'USD', 'GlobalTech Singapore Pte',    'DBS Bank Ltd',               'Singapore',   'IC-2025-1205-SG', 'intercompany'),
('0015f00001GTCH001', '2025-12-07', '2025-12-07', 'ach',   'outbound', 4500000.00, 'USD', 'GlobalTech US Payroll',       'ADP TotalSource',            'USA',         'PAY-2025-1207',   'payroll'),
('0015f00001GTCH001', '2025-12-20', '2025-12-20', 'ach',   'inbound', 22000000.00, 'USD', 'Enterprise Customer Revenue', 'Bank of America NA',         'USA',         'REV-2025-1220',   'vendor');

-- ---- MERIDIAN HEALTHCARE (new CAD corridor from Nov acquisition) ----
INSERT INTO payment_transactions (account_id, transaction_date, value_date, payment_type, direction, amount, currency, counterparty_name, counterparty_bank, counterparty_country, reference, purpose_code) VALUES
-- January 2026
('0015f00001MHLT001', '2026-01-07', '2026-01-07', 'ach',   'outbound',  980000.00, 'USD', 'Meridian Healthcare Payroll', 'Fidelity National Bank',     'USA',         'PAY-2026-0107',   'payroll'),
('0015f00001MHLT001', '2026-01-09', '2026-01-10', 'wire',  'outbound', 2050000.00, 'USD', 'MedImage Canada Inc',         'Royal Bank of Canada',       'Canada',      'IC-2026-0109-CA', 'intercompany'),
('0015f00001MHLT001', '2026-01-15', '2026-01-15', 'ach',   'outbound',  420000.00, 'USD', 'Medical Supplies Corp',       'Citibank NA',                'USA',         'AP-2026-0115-MED','vendor'),
('0015f00001MHLT001', '2026-01-22', '2026-01-22', 'ach',   'inbound',  3400000.00, 'USD', 'Medicare/Medicaid Reimb',     'US Dept of Treasury',        'USA',         'REC-2026-0122',   'vendor'),
('0015f00001MHLT001', '2026-01-28', '2026-01-29', 'wire',  'outbound',  195000.00, 'USD', 'MedImage Canada Payroll',     'Royal Bank of Canada',       'Canada',      'PR-2026-0128-CA', 'payroll'),
-- February 2026
('0015f00001MHLT001', '2026-02-07', '2026-02-07', 'ach',   'outbound',  990000.00, 'USD', 'Meridian Healthcare Payroll', 'Fidelity National Bank',     'USA',         'PAY-2026-0207',   'payroll'),
('0015f00001MHLT001', '2026-02-10', '2026-02-11', 'wire',  'outbound', 2100000.00, 'USD', 'MedImage Canada Inc',         'Royal Bank of Canada',       'Canada',      'IC-2026-0210-CA', 'intercompany'),
('0015f00001MHLT001', '2026-02-18', '2026-02-18', 'ach',   'outbound',  430000.00, 'USD', 'Medical Supplies Corp',       'Citibank NA',                'USA',         'AP-2026-0218-MED','vendor'),
('0015f00001MHLT001', '2026-02-24', '2026-02-24', 'ach',   'inbound',  3550000.00, 'USD', 'Medicare/Medicaid Reimb',     'US Dept of Treasury',        'USA',         'REC-2026-0224',   'vendor'),
('0015f00001MHLT001', '2026-02-26', '2026-02-27', 'wire',  'outbound',  200000.00, 'USD', 'MedImage Canada Payroll',     'Royal Bank of Canada',       'Canada',      'PR-2026-0226-CA', 'payroll'),
-- March 2026
('0015f00001MHLT001', '2026-03-07', '2026-03-07', 'ach',   'outbound', 1005000.00, 'USD', 'Meridian Healthcare Payroll', 'Fidelity National Bank',     'USA',         'PAY-2026-0307',   'payroll'),
('0015f00001MHLT001', '2026-03-10', '2026-03-11', 'wire',  'outbound', 2150000.00, 'USD', 'MedImage Canada Inc',         'Royal Bank of Canada',       'Canada',      'IC-2026-0310-CA', 'intercompany'),
('0015f00001MHLT001', '2026-03-12', '2026-03-12', 'ach',   'inbound',  1800000.00, 'USD', 'Insurance Reimbursements',    'UnitedHealth Group',         'USA',         'REC-2026-0312',   'vendor'),
-- Q4 2025 baseline (pre-acquisition, no Canada corridor)
('0015f00001MHLT001', '2025-12-05', '2025-12-05', 'ach',   'outbound',  960000.00, 'USD', 'Meridian Healthcare Payroll', 'Fidelity National Bank',     'USA',         'PAY-2025-1205',   'payroll'),
('0015f00001MHLT001', '2025-12-10', '2025-12-10', 'ach',   'outbound',  410000.00, 'USD', 'Medical Supplies Corp',       'Citibank NA',                'USA',         'AP-2025-1210-MED','vendor'),
('0015f00001MHLT001', '2025-12-22', '2025-12-22', 'ach',   'inbound',  3200000.00, 'USD', 'Medicare/Medicaid Reimb',     'US Dept of Treasury',        'USA',         'REC-2025-1222',   'vendor');
