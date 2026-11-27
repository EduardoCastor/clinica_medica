// Supabase Edge Function: saas-trial-signup
// Provisiona conta inicial + organização + clínica + matriz + licença TESTE_ATIVO (10 dias no servidor).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Método não permitido.' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Configuração do servidor de contas incompleta.' }, 500);
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: 'Corpo JSON inválido.' }, 400);
  }

  const clinicName = String(body.clinicName || '').trim();
  const responsibleName = String(body.responsibleName || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const phone = String(body.phone || '').trim();
  const password = String(body.password || '');
  const documentNumber = String(body.documentNumber || '').trim();
  const selectedPlanCode = String(body.selectedPlanCode || body.planCode || 'trial')
    .trim()
    .toLowerCase();

  if (clinicName.length < 2) {
    return jsonResponse({ error: 'Informe o nome da clínica (mínimo 2 caracteres).' }, 400);
  }
  if (responsibleName.length < 3) {
    return jsonResponse({ error: 'Informe o nome completo do responsável.' }, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonResponse({ error: 'Informe um endereço de e-mail válido.' }, 400);
  }
  if (password.length < 8) {
    return jsonResponse({ error: 'A senha deve possuir no mínimo 8 caracteres.' }, 400);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const emailHash = await sha256Hex(email);
  const docDigits = documentNumber.replace(/\D/g, '');

  const { data: existingEmailClaim } = await adminClient
    .from('saas_trial_claims')
    .select('id')
    .eq('email_hash', emailHash)
    .maybeSingle();

  if (existingEmailClaim) {
    return jsonResponse(
      {
        error:
          'Este e-mail já utilizou o período de teste gratuito de 10 dias. Acesse sua conta existente para continuar ou contratar um plano.',
        code: 'TRIAL_ALREADY_CLAIMED',
      },
      409
    );
  }

  if (docDigits.length >= 11) {
    const { data: existingDocClaim } = await adminClient
      .from('saas_trial_claims')
      .select('id')
      .eq('document_digits', docDigits)
      .maybeSingle();
    if (existingDocClaim) {
      return jsonResponse(
        {
          error:
            'Este CPF/CNPJ já utilizou o período de teste gratuito anteriormente.',
          code: 'TRIAL_DOCUMENT_ALREADY_CLAIMED',
        },
        409
      );
    }
  }

  const { data: existingProfile } = await adminClient
    .from('user_profiles')
    .select('id')
    .ilike('email', email)
    .maybeSingle();

  if (existingProfile) {
    return jsonResponse(
      {
        error:
          'Já existe uma clínica ou usuário cadastrado com este e-mail. Utilize a tela de login para acessar.',
        code: 'EMAIL_ALREADY_REGISTERED',
      },
      409
    );
  }

  const requireEmailConfirm =
    (Deno.env.get('REQUIRE_TRIAL_EMAIL_CONFIRMATION') || '').toLowerCase() === 'true';

  const { data: createdUserRes, error: createUserErr } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: !requireEmailConfirm,
    user_metadata: {
      full_name: responsibleName,
    },
  });

  if (createUserErr || !createdUserRes?.user) {
    const msg = createUserErr?.message || 'Não foi possível criar a conta de acesso.';
    const isDuplicate = msg.toLowerCase().includes('already') || msg.toLowerCase().includes('registered');
    return jsonResponse(
      {
        error: isDuplicate
          ? 'Já existe um usuário registrado com este e-mail. Faça login na plataforma.'
          : msg,
      },
      isDuplicate ? 409 : 400
    );
  }

  const authUserId = createdUserRes.user.id;

  const { data: provisionRes, error: provisionErr } = await adminClient.rpc(
    'medsync_provision_trial_organization',
    {
      p_auth_user_id: authUserId,
      p_clinic_name: clinicName,
      p_responsible_name: responsibleName,
      p_email: email,
      p_phone: phone,
      p_document_number: documentNumber || null,
      p_requested_plan_code: selectedPlanCode || 'trial',
    }
  );

  if (provisionErr) {
    // Rollback atômico da conta Auth recém-criada em caso de erro no provisionamento
    await adminClient.auth.admin.deleteUser(authUserId);
    const errMsg = provisionErr.message || 'Falha ao provisionar ambiente de avaliação gratuita.';
    return jsonResponse(
      {
        error: errMsg.includes('TRIAL_ALREADY_CLAIMED')
          ? 'Este e-mail já utilizou o teste gratuito de 10 dias.'
          : errMsg.includes('TRIAL_DOCUMENT_ALREADY_CLAIMED')
          ? 'Este CNPJ/CPF já utilizou o teste gratuito de 10 dias.'
          : errMsg,
      },
      errMsg.includes('TRIAL_') ? 409 : 500
    );
  }

  const resPayload = (provisionRes || {}) as Record<string, unknown>;

  return jsonResponse({
    success: true,
    requiresEmailConfirmation: requireEmailConfirm,
    organizationId: resPayload.organization_id,
    clinicId: resPayload.clinic_id,
    branchId: resPayload.branch_id,
    profileId: resPayload.profile_id,
    licenseStatus: resPayload.license_status || 'TESTE_ATIVO',
    trialStartedAt: resPayload.trial_started_at,
    trialEndsAt: resPayload.trial_ends_at,
    email,
  });
});
