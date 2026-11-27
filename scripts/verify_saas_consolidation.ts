import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ONBOARDING_STEPS,
  calculatePlanCyclePricing,
  computeTrialLicenseState,
  normalizeOnboardingProgress,
  resolveCanonicalLicenseStatus,
  sortPlansByCommercialOrder,
} from '../src/services/saasCommercialUtils';
import { validatePublicSupabaseKey } from '../src/services/supabaseClient';
import { Organization, Plan } from '../src/types';

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.signature`;
}

async function runTests() {
  // 1. Secret Key Protection Tests ("Forbidden use of secret API key in browser")
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

  // 2. Centralized Pricing Consistency Tests
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
  }

  // 3. 10-Day Trial Lifecycle & Write Blocking Tests
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

    const paidActive = computeTrialLicenseState(
      {
        ...baseOrg,
        status: 'active',
        licenseStatus: 'ATIVA',
        billingCycle: 'monthly',
        subscriptionRenewsAt: '2026-12-27T12:00:00.000Z',
      },
      now
    );
    assert.equal(paidActive.licenseStatus, 'ATIVA');
    assert.equal(paidActive.isActivePaid, true);
    assert.equal(paidActive.isBlockedForWrites, false);

    // PAGAMENTO_PENDENTE after trial expired must remain write-blocked until payment confirmed
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
  }

  // 4. 7-Step Onboarding Wizard Progress Tests
  {
    assert.equal(ONBOARDING_STEPS.length, 7);
    const norm = normalizeOnboardingProgress({
      completedSteps: ['clinic', 'branches_rooms'],
      skipped: false,
      currentStep: 3,
    });
    assert.deepEqual(norm.completedSteps, ['clinic', 'branches_rooms']);
    assert.equal(norm.currentStep, 3);
  }

  // 5. Static Security & SSOT Architecture Assertions
  {
    const root = process.cwd();
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
    assert.equal(checkoutModalCode.includes('INITIAL_PLANS'), false, 'Checkout modal must not fallback to INITIAL_PLANS');

    const platformAdminEdgeCode = fs.readFileSync(
      path.join(root, 'supabase/functions/saas-platform-admin/index.ts'),
      'utf8'
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

  console.log('ALL_SAAS_CONSOLIDATION_TESTS_PASSED');
}

runTests().catch((err) => {
  console.error('TEST_FAILURE:', err);
  process.exit(1);
});
