import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ONBOARDING_STEPS,
  calculatePlanCyclePricing,
  computeTrialLicenseState,
  deriveQuarterlyDiscount,
  deriveYearlyDiscount,
  normalizeOnboardingProgress,
  resolveCanonicalLicenseStatus,
  sortPlansByCommercialOrder,
} from '../src/services/saasCommercialUtils';
import {
  PRODUCTION_DOMAINS,
  isClinicLoginPath,
  resolveTenantFromInputs,
} from '../src/services/domainResolver';
import { INITIAL_PLANS } from '../src/services/mockData';
import { validatePublicSupabaseKey } from '../src/services/supabaseClient';
import {
  computeHmacSha256Hex,
  extractWebhookEventFields,
  isPaymentWebhookIntegrationReady,
  validateInvoiceSettlementCandidate,
  verifyWebhookHmacSignature,
} from '../supabase/functions/_shared/paymentWebhookSecurity';
import { Organization, Plan } from '../src/types';

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.signature`;
}

async function runTests() {
  const root = process.cwd();
  const migrationBasePath = path.join(
    root,
    'supabase/migrations/20261127000000_saas_commercial_trials_licenses_billing.sql'
  );
  const hardeningMigrationPath = path.join(
    root,
    'supabase/migrations/20261127010000_saas_commercial_audit_hardening.sql'
  );
  assert.equal(fs.existsSync(migrationBasePath), true, 'Original migration 20261127000000 must be preserved');
  assert.equal(fs.existsSync(hardeningMigrationPath), true, 'Hardening migration 20261127010000 must exist');

  const hardeningSql = fs.readFileSync(hardeningMigrationPath, 'utf8');
  const webhookEdgeCode = fs.readFileSync(
    path.join(root, 'supabase/functions/saas-payment-webhook/index.ts'),
    'utf8'
  );
  const trialSignupEdgeCode = fs.readFileSync(
    path.join(root, 'supabase/functions/saas-trial-signup/index.ts'),
    'utf8'
  );
  const billingEdgeCode = fs.readFileSync(
    path.join(root, 'supabase/functions/saas-billing/index.ts'),
    'utf8'
  );
  const platformAdminEdgeCode = fs.readFileSync(
    path.join(root, 'supabase/functions/saas-platform-admin/index.ts'),
    'utf8'
  );

  // 1. Secret Key Protection Tests (Browser key guard)
  {
    const secretPrefixRes = validatePublicSupabaseKey('sb_secret_1234567890abcdef');
    assert.equal(secretPrefixRes.valid, false);
    assert.equal(secretPrefixRes.isSecretKey, true);

    const serviceRoleJwt = makeJwt({ role: 'service_role', iss: 'supabase' });
    const serviceRoleRes = validatePublicSupabaseKey(serviceRoleJwt);
    assert.equal(serviceRoleRes.valid, false);
    assert.equal(serviceRoleRes.isSecretKey, true);

    const supabaseAdminJwt = makeJwt({ role: 'supabase_admin', iss: 'supabase' });
    const adminJwtRes = validatePublicSupabaseKey(supabaseAdminJwt);
    assert.equal(adminJwtRes.valid, false);
    assert.equal(adminJwtRes.isSecretKey, true);

    const anonJwt = makeJwt({ role: 'anon', iss: 'supabase' });
    const anonRes = validatePublicSupabaseKey(anonJwt);
    assert.equal(anonRes.valid, true);
    assert.equal(anonRes.isSecretKey, false);

    const publishableRes = validatePublicSupabaseKey('sb_publishable_valid_key_example');
    assert.equal(publishableRes.valid, true);
    assert.equal(publishableRes.isSecretKey, false);
  }

  // 2. Centralized Pricing Consistency & Server DB Pricing RPC Check
  {
    const paidPlan: Plan = {
      id: 'plan_advanced',
      code: 'advanced',
      name: 'Avançado',
      description: 'Multiunidade',
      priceMonthly: 500,
      priceYearly: 0,
      quarterlyDiscountPercent: 10,
      yearlyDiscountPercent: 20,
      displayOrder: 3,
      trialDays: 0,
      maxBranches: 10,
      maxUsers: 25,
      maxPatients: 10000,
      hasPatientSharing: true,
      hasWhatsAppAutomation: true,
      hasCustomWebsite: true,
      hasFinancialModule: true,
      hasAdvancedReports: true,
      isActive: true,
    };

    const monthly = calculatePlanCyclePricing(paidPlan, 'monthly');
    assert.equal(monthly.finalPeriodAmount, 500);
    assert.equal(monthly.effectiveMonthly, 500);
    assert.equal(monthly.discountPercent, 0);

    const quarterly = calculatePlanCyclePricing(paidPlan, 'quarterly');
    assert.equal(quarterly.fullPeriodAmount, 1500);
    assert.equal(quarterly.discountPercent, 10);
    assert.equal(quarterly.finalPeriodAmount, 1350);
    assert.equal(quarterly.effectiveMonthly, 450);

    const yearly = calculatePlanCyclePricing(paidPlan, 'yearly');
    assert.equal(yearly.fullPeriodAmount, 6000);
    assert.equal(yearly.discountPercent, 20);
    assert.equal(yearly.finalPeriodAmount, 4800);
    assert.equal(yearly.effectiveMonthly, 400);

    const ordered = sortPlansByCommercialOrder([
      { ...paidPlan, id: '3', code: 'advanced', displayOrder: 3 },
      { ...paidPlan, id: '1', code: 'trial', priceMonthly: 0, displayOrder: 1 },
      { ...paidPlan, id: '2', code: 'basic', priceMonthly: 200, displayOrder: 2 },
    ]);
    assert.deepEqual(
      ordered.map((p) => p.code),
      ['trial', 'basic', 'advanced']
    );

    assert.equal(
      billingEdgeCode.includes("'medsync_compute_plan_pricing'"),
      true,
      'saas-billing must compute checkout amount via SQL medsync_compute_plan_pricing'
    );
    assert.equal(
      platformAdminEdgeCode.includes("'medsync_compute_plan_pricing'"),
      true,
      'saas-platform-admin must compute manual invoice pricing via SQL medsync_compute_plan_pricing'
    );
  }

  // 3. Super Admin DB Verification, Zero Clinical Access & SQL Grants
  {
    assert.equal(
      platformAdminEdgeCode.includes("callerProfile.role_code !== 'super_admin'"),
      true,
      'saas-platform-admin must verify super_admin role in user_profiles DB'
    );
    assert.equal(
      /user\.user_metadata|authUser\.user_metadata|app_metadata/.test(platformAdminEdgeCode),
      false,
      'saas-platform-admin must not trust auth user_metadata or app_metadata for admin role'
    );
    assert.equal(
      hardeningSql.includes(
        'REVOKE ALL ON FUNCTION public.medsync_is_saas_platform_admin() FROM PUBLIC, anon;'
      ),
      true,
      'medsync_is_saas_platform_admin must revoke EXECUTE from PUBLIC and anon'
    );
    assert.equal(
      hardeningSql.includes('CREATE POLICY "Plans super admin read" ON public.plans'),
      true,
      'public.plans must isolate super admin read policy to authenticated callers'
    );

    const forbiddenClinicalTables = [
      "from('medical_records')",
      "from('patient_anamnesis_records')",
      "from('prescriptions')",
      "from('medical_certificates')",
      "from('lab_orders')",
      "from('exam_results')",
      "from('medical_documents')",
    ];
    for (const tbl of forbiddenClinicalTables) {
      assert.equal(
        platformAdminEdgeCode.includes(tbl),
        false,
        `saas-platform-admin must NEVER query clinical table: ${tbl}`
      );
    }

    const saasDashboardCode = fs.readFileSync(
      path.join(root, 'src/modules/saas-admin/SaasAdminDashboard.tsx'),
      'utf8'
    );
    for (const tbl of forbiddenClinicalTables) {
      assert.equal(
        saasDashboardCode.includes(tbl),
        false,
        `SaasAdminDashboard must NEVER query clinical table: ${tbl}`
      );
    }
  }

  // 4. Cross-Tenant Isolation & Privileged Function Hardening in SQL
  {
    assert.equal(
      hardeningSql.includes('public.medsync_can_access_org(target_org_id)'),
      true,
      'medsync_org_has_active_write_access must validate caller membership via medsync_can_access_org'
    );
    assert.equal(
      hardeningSql.includes(
        'REVOKE ALL ON FUNCTION public.medsync_org_has_active_write_access(UUID) FROM PUBLIC, anon;'
      ),
      true,
      'medsync_org_has_active_write_access must revoke EXECUTE from PUBLIC and anon'
    );
    assert.equal(
      hardeningSql.includes(
        'REVOKE ALL ON FUNCTION public.medsync_sync_expired_trials() FROM PUBLIC, anon, authenticated;'
      ),
      true,
      'medsync_sync_expired_trials must be restricted exclusively to service_role'
    );
    assert.equal(
      hardeningSql.includes(
        'REVOKE ALL ON FUNCTION public.medsync_provision_trial_organization(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;'
      ),
      true,
      'medsync_provision_trial_organization must be restricted exclusively to service_role'
    );
    assert.equal(
      hardeningSql.includes(
        'REVOKE ALL ON FUNCTION public.medsync_process_payment_webhook_event(TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, JSONB) FROM PUBLIC, anon, authenticated;'
      ),
      true,
      'medsync_process_payment_webhook_event must be restricted exclusively to service_role'
    );
    assert.equal(
      /CREATE OR REPLACE FUNCTION public\.medsync_compute_plan_pricing[\s\S]*?LANGUAGE plpgsql\s+IMMUTABLE\s+SET search_path = public/i.test(
        hardeningSql
      ),
      true,
      'medsync_compute_plan_pricing must not use SECURITY DEFINER and must pin search_path'
    );
    assert.equal(
      /CREATE OR REPLACE FUNCTION public\.medsync_prevent_saas_audit_mutation[\s\S]*?LANGUAGE plpgsql\s+SET search_path = public/i.test(
        hardeningSql
      ),
      true,
      'medsync_prevent_saas_audit_mutation must not use SECURITY DEFINER and must pin search_path'
    );
  }

  // 5. Legacy Organizations Preservation (no unsafe ELSE 'TESTE_ATIVO')
  {
    assert.equal(
      hardeningSql.includes("WHEN lower(trim(COALESCE(o.status, ''))) IN ('cancelled', 'canceled') THEN 'CANCELADA'"),
      true,
      'Legacy cancelled organizations must map to CANCELADA'
    );
    assert.equal(
      hardeningSql.includes("WHEN lower(trim(COALESCE(o.status, ''))) = 'expired' THEN 'TESTE_EXPIRADO'"),
      true,
      'Legacy expired organizations must map to TESTE_EXPIRADO'
    );
    assert.equal(
      hardeningSql.includes("ELSE 'SUSPENSA'"),
      true,
      'Unrecognized legacy statuses must fail-closed to SUSPENSA (never TESTE_ATIVO)'
    );
  }

  // 6. 10-Day Trial Lifecycle, Write Blocking, SELECT Preservation & Addendums Coverage
  {
    const now = new Date('2026-11-27T12:00:00.000Z');
    const baseOrg: Organization = {
      id: 'org-1',
      name: 'Clínica Exemplo',
      slug: 'clinica-exemplo',
      planId: 'plan_trial',
      status: 'trial',
      licenseStatus: 'TESTE_ATIVO',
      billingCycle: 'trial',
      trialEndsAt: '2026-12-07T12:00:00.000Z',
      subscriptionRenewsAt: '',
      createdAt: '2026-11-27T12:00:00.000Z',
    };

    const activeTrial = computeTrialLicenseState(baseOrg, now);
    assert.equal(activeTrial.licenseStatus, 'TESTE_ATIVO');
    assert.equal(activeTrial.isTrialActive, true);
    assert.equal(activeTrial.isBlockedForWrites, false);
    assert.equal(activeTrial.daysRemaining, 10);

    const expiredTrial = computeTrialLicenseState(
      { ...baseOrg, trialEndsAt: '2026-11-26T12:00:00.000Z' },
      now
    );
    assert.equal(expiredTrial.licenseStatus, 'TESTE_EXPIRADO');
    assert.equal(expiredTrial.isTrialExpired, true);
    assert.equal(expiredTrial.isBlockedForWrites, true);
    assert.equal(expiredTrial.daysRemaining, 0);

    const pendingAfterExpiry = computeTrialLicenseState(
      {
        ...baseOrg,
        status: 'overdue',
        licenseStatus: 'PAGAMENTO_PENDENTE',
        trialEndsAt: '2026-11-20T12:00:00.000Z',
        subscriptionRenewsAt: '',
      },
      now
    );
    assert.equal(pendingAfterExpiry.isBlockedForWrites, true);

    assert.equal(
      resolveCanonicalLicenseStatus({
        status: 'suspended',
        trialEndsAt: '',
        subscriptionRenewsAt: '',
      }),
      'SUSPENSA'
    );

    // SQL RLS write guards + SELECT intact + medical_record_addendums INSERT/UPDATE/DELETE
    assert.equal(
      hardeningSql.includes("AND column_name = 'organization_id'"),
      true,
      'Dynamic RLS loop must verify organization_id column existence before applying policy'
    );
    assert.equal(
      hardeningSql.includes('AS RESTRICTIVE FOR INSERT') &&
        hardeningSql.includes('AS RESTRICTIVE FOR UPDATE') &&
        hardeningSql.includes('AS RESTRICTIVE FOR DELETE'),
      true,
      'Operational tables must enforce AS RESTRICTIVE write guards for INSERT/UPDATE/DELETE'
    );
    assert.equal(
      /AS RESTRICTIVE\s+FOR SELECT/i.test(hardeningSql),
      false,
      'Hardening migration must NOT add AS RESTRICTIVE FOR SELECT (read access preserved)'
    );
    assert.equal(
      hardeningSql.includes('CREATE POLICY "License write guard insert" ON public.medical_record_addendums') &&
        hardeningSql.includes('CREATE POLICY "License write guard update" ON public.medical_record_addendums') &&
        hardeningSql.includes('CREATE POLICY "License write guard delete" ON public.medical_record_addendums'),
      true,
      'medical_record_addendums must enforce INSERT, UPDATE and DELETE write guards via medical_records'
    );
    assert.equal(
      hardeningSql.includes('CREATE POLICY "License write guard insert" ON public.prescription_items') &&
        hardeningSql.includes('CREATE POLICY "License write guard insert" ON public.lab_order_items'),
      true,
      'Child clinical tables (prescription_items, lab_order_items) must enforce parent-org write guards'
    );
    assert.equal(
      hardeningSql.includes("IF NOT public.medsync_org_has_active_write_access(p_org_id)"),
      true,
      'medsync_assert_call_panel_actor RPC must enforce active write license'
    );
    assert.equal(
      hardeningSql.includes("IF v_org_id IS NULL OR NOT public.medsync_org_has_active_write_access(v_org_id)"),
      true,
      'medsync_public_book_appointment RPC must enforce active write license'
    );
  }

  // 7. Payment Webhook Security Runtime Tests (fail-closed, no raw secret, HMAC, amount/currency/order_id/idempotency)
  {
    const notConfigured = isPaymentWebhookIntegrationReady({
      webhookSecret: '',
      signatureFormatConfirmed: 'false',
    });
    assert.equal(notConfigured.ready, false);

    const unconfirmedFormat = isPaymentWebhookIntegrationReady({
      webhookSecret: 'super-secret-value',
      signatureFormatConfirmed: 'false',
    });
    assert.equal(unconfirmedFormat.ready, false);

    const readyCheck = isPaymentWebhookIntegrationReady({
      webhookSecret: 'super-secret-value',
      signatureFormatConfirmed: 'true',
    });
    assert.equal(readyCheck.ready, true);

    const sampleSecret = 'whsec_test_audit_999111';
    const sampleBody = JSON.stringify({
      event_id: 'evt_123',
      webhook_event_type: 'order_approved',
      order_id: 'ord_987',
      reference_code: 'MED-ORG12345-1000',
      paid_amount: 589.0,
      currency: 'BRL',
    });

    // Reject raw secret passed directly as signature
    const rawSecretAttempt = await verifyWebhookHmacSignature({
      rawBody: sampleBody,
      providedSignature: sampleSecret,
      secret: sampleSecret,
    });
    assert.equal(rawSecretAttempt.valid, false);

    // Reject forged/random hex signature
    const wrongSigAttempt = await verifyWebhookHmacSignature({
      rawBody: sampleBody,
      providedSignature: 'a'.repeat(64),
      secret: sampleSecret,
    });
    assert.equal(wrongSigAttempt.valid, false);

    // Accept valid HMAC-SHA256 hex signature
    const validHmac = await computeHmacSha256Hex(sampleSecret, sampleBody);
    const validSigResult = await verifyWebhookHmacSignature({
      rawBody: sampleBody,
      providedSignature: validHmac,
      secret: sampleSecret,
    });
    assert.equal(validSigResult.valid, true);

    // Reject tampered body against valid HMAC
    const tamperedSigResult = await verifyWebhookHmacSignature({
      rawBody: sampleBody.replace('589', '1'),
      providedSignature: validHmac,
      secret: sampleSecret,
    });
    assert.equal(tamperedSigResult.valid, false);

    // Reject missing event_id (no Date.now() fallback allowed)
    const missingEventId = extractWebhookEventFields({
      webhook_event_type: 'order_approved',
      order_id: 'ord_1',
      reference_code: 'MED-1',
    });
    assert.equal(missingEventId.valid, false);

    // Reject amount mismatch, currency mismatch, missing order_id, already paid invoice
    const parsedEvent = extractWebhookEventFields(JSON.parse(sampleBody) as Record<string, unknown>);
    assert.equal(parsedEvent.valid, true);
    assert.ok(parsedEvent.event);

    const baseInvoice = {
      id: 'inv-1',
      organization_id: 'org-1',
      plan_id: 'plan-1',
      billing_cycle: 'monthly',
      final_amount: 589.0,
      currency: 'BRL',
      status: 'pending',
    };

    assert.equal(validateInvoiceSettlementCandidate(parsedEvent.event, baseInvoice).valid, true);
    assert.equal(
      validateInvoiceSettlementCandidate({ ...parsedEvent.event, paidAmount: 100.0 }, baseInvoice).code,
      'AMOUNT_MISMATCH'
    );
    assert.equal(
      validateInvoiceSettlementCandidate({ ...parsedEvent.event, currency: 'USD' }, baseInvoice).code,
      'CURRENCY_MISMATCH'
    );
    assert.equal(
      validateInvoiceSettlementCandidate({ ...parsedEvent.event, externalOrderId: '' }, baseInvoice).code,
      'MISSING_ORDER_ID'
    );
    assert.equal(
      validateInvoiceSettlementCandidate(parsedEvent.event, { ...baseInvoice, status: 'paid' }).code,
      'INVOICE_NOT_PAYABLE_STATUS'
    );

    assert.equal(
      webhookEdgeCode.includes("url.searchParams.get('signature')"),
      false,
      'saas-payment-webhook must not accept signature in querystring'
    );
    assert.equal(
      webhookEdgeCode.includes("'medsync_process_payment_webhook_event'"),
      true,
      'saas-payment-webhook must delegate to atomic transactional SQL RPC'
    );
    assert.equal(
      hardeningSql.includes('FOR UPDATE') &&
        hardeningSql.includes('saas_payment_webhook_events') &&
        hardeningSql.includes("pg_advisory_xact_lock(hashtext('webhook_evt:'"),
      true,
      'Webhook SQL RPC must enforce row locks, advisory lock and event idempotency'
    );
  }

  // 8. Trial Anti-Abuse, 10-Day Rule & No Silent Paid-Plan Fallback
  {
    assert.equal(
      hardeningSql.includes("RAISE EXCEPTION 'TRIAL_PLAN_UNAVAILABLE"),
      true,
      'medsync_provision_trial_organization must fail explicitly when trial plan is missing/inactive'
    );
    assert.equal(
      hardeningSql.includes("ORDER BY price_monthly ASC"),
      false,
      'medsync_provision_trial_organization must NOT fallback silently to a paid plan'
    );
    assert.equal(
      hardeningSql.includes("pg_advisory_xact_lock(hashtext('medsync_trial_doc_' || v_doc_digits))"),
      true,
      'medsync_provision_trial_organization must lock document_digits against concurrent signups'
    );
    assert.equal(
      hardeningSql.includes("now() + interval '10 days'"),
      true,
      '10-day calendar trial rule must be computed on PostgreSQL server'
    );
    assert.equal(
      trialSignupEdgeCode.includes("TRIAL_PLAN_UNAVAILABLE") &&
        trialSignupEdgeCode.includes('deleteUser(authUserId)'),
      true,
      'saas-trial-signup must rollback auth user and return HTTP 503 on TRIAL_PLAN_UNAVAILABLE'
    );
  }

  // 9. 7-Step Onboarding Wizard & No Hardcoded Commercial Fallback on UI
  {
    assert.equal(ONBOARDING_STEPS.length, 7);
    const norm = normalizeOnboardingProgress({
      completedSteps: ['clinic', 'branches_rooms'],
      skipped: false,
      currentStep: 3,
    });
    assert.deepEqual(norm.completedSteps, ['clinic', 'branches_rooms']);
    assert.equal(norm.currentStep, 3);

    const landingCode = fs.readFileSync(
      path.join(root, 'src/modules/landing/LandingPage.tsx'),
      'utf8'
    );
    assert.equal(landingCode.includes('INITIAL_PLANS'), false, 'LandingPage must not use INITIAL_PLANS');
    assert.equal(landingCode.includes('medsync_saas_plans'), false, 'LandingPage must not read localStorage plans');
    assert.equal(landingCode.includes('window.alert'), false, 'LandingPage must not call window.alert');
    assert.equal(/\balert\s*\(/.test(landingCode), false, 'LandingPage must not call alert()');

    const checkoutModalCode = fs.readFileSync(
      path.join(root, 'src/components/ClinicSubscriptionModal.tsx'),
      'utf8'
    );
    assert.equal(
      checkoutModalCode.includes('INITIAL_PLANS'),
      false,
      'Checkout modal must not fallback to INITIAL_PLANS'
    );
  }

  // 10. Official 3-Plan Reorganization, Pricing Persistence & Idempotent Delete/Archive Protection
  {
    const plansMigrationPath = path.join(
      root,
      'supabase/migrations/20261127020000_saas_plans_reorg_delete_guard.sql'
    );
    assert.equal(fs.existsSync(plansMigrationPath), true, 'Migration 20261127020000 must exist');
    const plansMigrationSql = fs.readFileSync(plansMigrationPath, 'utf8');

    // Teste 1: Official 3 plans baseline (Grátis, Básico, Avançado)
    assert.deepEqual(
      sortPlansByCommercialOrder(INITIAL_PLANS).map((p) => p.code),
      ['trial', 'basic', 'advanced']
    );

    const trialPlan = INITIAL_PLANS.find((p) => p.code === 'trial')!;
    const basicPlan = INITIAL_PLANS.find((p) => p.code === 'basic')!;
    const advancedPlan = INITIAL_PLANS.find((p) => p.code === 'advanced')!;

    assert.equal(trialPlan.name, 'Grátis');
    assert.equal(trialPlan.priceMonthly, 0);
    assert.equal(trialPlan.trialDays, 10);
    assert.equal(calculatePlanCyclePricing(trialPlan, 'quarterly').isApplicable, false);
    assert.equal(calculatePlanCyclePricing(trialPlan, 'yearly').isApplicable, false);
    assert.equal(deriveQuarterlyDiscount(trialPlan), 0);
    assert.equal(deriveYearlyDiscount(trialPlan), 0);

    assert.equal(basicPlan.name, 'Básico');
    assert.equal(basicPlan.priceMonthly, 399);
    const basicQuarterly = calculatePlanCyclePricing(basicPlan, 'quarterly');
    const basicYearly = calculatePlanCyclePricing(basicPlan, 'yearly');
    assert.equal(basicQuarterly.isApplicable, true);
    assert.equal(basicQuarterly.discountPercent, 10);
    assert.equal(basicQuarterly.finalPeriodAmount, 1077.3);
    assert.equal(basicYearly.isApplicable, true);
    assert.equal(basicYearly.discountPercent, 20);
    assert.equal(basicYearly.finalPeriodAmount, 3830.4);

    assert.equal(advancedPlan.name, 'Avançado');
    assert.equal(advancedPlan.priceMonthly, 799);
    const advQuarterly = calculatePlanCyclePricing(advancedPlan, 'quarterly');
    const advYearly = calculatePlanCyclePricing(advancedPlan, 'yearly');
    assert.equal(advQuarterly.isApplicable, true);
    assert.equal(advQuarterly.discountPercent, 10);
    assert.equal(advQuarterly.finalPeriodAmount, 2157.3);
    assert.equal(advYearly.isApplicable, true);
    assert.equal(advYearly.discountPercent, 20);
    assert.equal(advYearly.finalPeriodAmount, 7670.4);

    assert.equal(
      plansMigrationSql.includes('trg_plans_prevent_referenced_delete') &&
        plansMigrationSql.includes('medsync_prevent_referenced_plan_delete'),
      true,
      'Migration 20261127020000 must enforce SQL delete protection trigger on public.plans'
    );
    assert.equal(
      plansMigrationSql.includes('archived_at') && plansMigrationSql.includes('archived_reason'),
      true,
      'Migration 20261127020000 must support non-destructive plan archiving'
    );

    // Teste 2 & Teste 3: Edge Function + Cloud Service + Admin Modals/Dashboard persistence & delete/archive
    const saasCloudCode = fs.readFileSync(path.join(root, 'src/services/saasCloudService.ts'), 'utf8');
    const saasModalsCode = fs.readFileSync(
      path.join(root, 'src/modules/saas-admin/SaasAdminModals.tsx'),
      'utf8'
    );
    const saasDashboardCode = fs.readFileSync(
      path.join(root, 'src/modules/saas-admin/SaasAdminDashboard.tsx'),
      'utf8'
    );

    assert.equal(
      platformAdminEdgeCode.includes("action === 'upsert_plan'") &&
        platformAdminEdgeCode.includes("action === 'delete_plan'") &&
        platformAdminEdgeCode.includes("action === 'archive_plan'"),
      true,
      'saas-platform-admin must expose upsert_plan, delete_plan, and archive_plan'
    );
    assert.equal(
      platformAdminEdgeCode.includes('blocked_system_plan') &&
        platformAdminEdgeCode.includes('blocked_in_use') &&
        platformAdminEdgeCode.includes("status: 'not_found'"),
      true,
      'delete_plan must handle missing rows idempotently and block system/referenced plans'
    );
    assert.equal(
      saasCloudCode.includes("action: 'delete_plan'") &&
        saasCloudCode.includes("action: 'archive_plan'") &&
        saasCloudCode.includes('id: plan.id ? plan.id : undefined'),
      true,
      'SaasAdminCloudService must pass plan id on upsert and expose deletePlan/archivePlan'
    );
    assert.equal(
      saasModalsCode.includes('PlanDeleteConfirmModal') &&
        saasModalsCode.includes('PlanEditorModal') &&
        saasModalsCode.includes('onRefreshList'),
      true,
      'SaasAdminModals must provide PlanEditorModal with DB refresh and PlanDeleteConfirmModal'
    );
    assert.equal(
      saasDashboardCode.includes('await loadSaasData()') &&
        saasDashboardCode.includes('PlanDeleteConfirmModal'),
      true,
      'SaasAdminDashboard must await Supabase reload before confirming actions and wire PlanDeleteConfirmModal'
    );
  }

  // 11. Teste 4: Institutional Landing Clinic Access Buttons & Domain/Route Navigation Isolation
  {
    assert.equal(isClinicLoginPath('/login'), true);
    assert.equal(isClinicLoginPath('/'), false);

    // Production Landing Root -> SAAS_LANDING
    const prodLanding = resolveTenantFromInputs({
      realHostname: PRODUCTION_DOMAINS.SAAS_LANDING,
      pathname: '/',
      simulationAllowed: false,
      simulatedDomain: null,
    });
    assert.equal(prodLanding.mode, 'SAAS_LANDING');

    // Production Landing /login -> CLINIC_APP (ClinicLoginScreen)
    const prodLogin = resolveTenantFromInputs({
      realHostname: PRODUCTION_DOMAINS.SAAS_LANDING,
      pathname: '/login',
      simulationAllowed: false,
      simulatedDomain: null,
    });
    assert.equal(prodLogin.mode, 'CLINIC_APP');

    // Production SAAS_ADMIN strict isolation even on /login
    const prodAdminLogin = resolveTenantFromInputs({
      realHostname: PRODUCTION_DOMAINS.SAAS_ADMIN,
      pathname: '/login',
      simulationAllowed: false,
      simulatedDomain: null,
    });
    assert.equal(prodAdminLogin.mode, 'SAAS_ADMIN');

    // Preview/Simulation environment: switching from SAAS_LANDING to CLINIC_APP
    const simClinic = resolveTenantFromInputs({
      realHostname: 'preview.vercel.app',
      pathname: '/',
      simulationAllowed: true,
      simulatedDomain: PRODUCTION_DOMAINS.CLINIC_APP,
    });
    assert.equal(simClinic.mode, 'CLINIC_APP');

    const landingCode = fs.readFileSync(
      path.join(root, 'src/modules/landing/LandingPage.tsx'),
      'utf8'
    );
    const accessClinicMatches = landingCode.match(/onAccessClinic/g) || [];
    assert.equal(
      accessClinicMatches.length >= 5,
      true,
      'LandingPage must wire onAccessClinic across desktop header, mobile header, hero CTA, footer, and trial success CTA'
    );
    assert.equal(
      landingCode.includes('onAccessSuperAdmin') &&
        landingCode.includes('Administração Geral SaaS'),
      true,
      'LandingPage must preserve separate Super Admin entry point'
    );
  }

  console.log('ALL_SAAS_CONSOLIDATION_TESTS_PASSED');
}

runTests().catch((err) => {
  console.error('TEST_FAILURE:', err);
  process.exit(1);
});
