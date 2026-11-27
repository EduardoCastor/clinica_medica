// Supabase Edge Function: admin-team-management
// Executa operações administrativas seguras de Supabase Auth usando SUPABASE_SERVICE_ROLE_KEY
// exclusivamente no servidor (nunca exposta ao frontend).

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';

const AUTHORIZED_BOOTSTRAP_EMAIL = 'admin@drnewtonmureb.com.br';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface MenuPermInput {
  menuKey: string;
  canView: boolean;
  canConsult: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canAdmin: boolean;
  isCustomOverride: boolean;
}

interface AuthUserRow {
  id: string;
  email?: string;
  new_email?: string;
  email_confirmed_at?: string;
  user_metadata?: Record<string, unknown>;
}

interface SuperProfileRow {
  id: string;
  user_id: string | null;
  organization_id: string;
  full_name: string;
  email: string;
  role_code: string;
  is_active: boolean;
  created_at: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function findAuthUserByEmail(
  adminClient: SupabaseClient,
  targetEmail: string
): Promise<{ user: AuthUserRow | null; error?: string }> {
  const clean = targetEmail.trim().toLowerCase();
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await adminClient.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) {
      return { user: null, error: error.message };
    }
    const users = (data?.users || []) as AuthUserRow[];
    const match = users.find((u) => u.email?.toLowerCase() === clean);
    if (match) {
      return { user: match };
    }
    if (users.length < 1000) {
      break;
    }
  }
  return { user: null };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Método não permitido.' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse(
      { error: 'Configuração do servidor de contas incompleta.' },
      500
    );
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: 'Corpo JSON inválido.' }, 400);
  }

  const action = String(payload.action || '');

  // Cliente administrativo (service_role exclusivo no servidor)
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ===========================================================================
  // AÇÃO 0A: CONSULTA SEGURA DO STATUS DE PRIMEIRO ACESSO (SEM EXPOR PII)
  // ===========================================================================
  if (action === 'get_bootstrap_status') {
    const { data: statusData, error: statusErr } = await adminClient.rpc('medsync_get_bootstrap_status');
    if (statusErr) {
      return jsonResponse({ error: 'Não foi possível verificar o status de inicialização.' }, 500);
    }
    const status = (statusData || {}) as Record<string, unknown>;
    return jsonResponse({
      success: true,
      needsBootstrap: Boolean(status.needs_bootstrap),
      alreadyInitialized: Boolean(status.already_initialized),
      organizationFound: Boolean(status.organization_found),
      organizationName: String(status.organization_name || 'Clínica Dr Newton Mureb'),
      platformInitialized: Boolean(status.platform_initialized),
      platformNeedsActivation: Boolean(status.platform_needs_activation),
    });
  }

  const authHeader = req.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Autenticação obrigatória.' }, 401);
  }

  // Cliente autenticado com o JWT do solicitante
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user: callerAuthUser },
    error: callerAuthErr,
  } = await userClient.auth.getUser();

  if (callerAuthErr || !callerAuthUser) {
    return jsonResponse({ error: 'Sessão inválida ou expirada.' }, 401);
  }

  // ===========================================================================
  // AÇÃO 0B: BOOTSTRAP DO PRIMEIRO SUPER ADMIN (CLÍNICA DR NEWTON MUREB)
  // ===========================================================================
  if (action === 'bootstrap_super_admin') {
    const callerEmail = (callerAuthUser.email || '').trim().toLowerCase();
    if (callerEmail !== AUTHORIZED_BOOTSTRAP_EMAIL) {
      return jsonResponse(
        {
          error:
            'Apenas o e-mail autorizado admin@drnewtonmureb.com.br pode realizar o primeiro acesso administrativo.',
        },
        403
      );
    }

    if (!callerAuthUser.email_confirmed_at) {
      return jsonResponse(
        {
          error:
            'Confirme a propriedade do e-mail admin@drnewtonmureb.com.br antes de concluir a inicialização.',
        },
        403
      );
    }

    const metaFullName =
      callerAuthUser.user_metadata && typeof callerAuthUser.user_metadata.full_name === 'string'
        ? callerAuthUser.user_metadata.full_name
        : '';
    const requestedFullName = String(payload.fullName || metaFullName || '').trim();
    const effectiveFullName =
      requestedFullName.length >= 3 ? requestedFullName : 'Administrador Clínica Dr Newton Mureb';

    const { data: bootstrapRes, error: bootstrapErr } = await adminClient.rpc(
      'medsync_bootstrap_first_super_admin',
      {
        p_auth_user_id: callerAuthUser.id,
        p_auth_email: callerEmail,
        p_full_name: effectiveFullName,
        p_email_confirmed_at: callerAuthUser.email_confirmed_at,
      }
    );

    if (bootstrapErr) {
      const errMsg = bootstrapErr.message || 'Não foi possível concluir o primeiro acesso.';
      if (errMsg.includes('BOOTSTRAP_ALREADY_COMPLETED') || errMsg.includes('BOOTSTRAP_CONFLICT')) {
        return jsonResponse(
          {
            error: 'O primeiro acesso já foi concluído anteriormente. Utilize o login padrão.',
          },
          409
        );
      }
      if (errMsg.includes('BOOTSTRAP_FORBIDDEN_EMAIL') || errMsg.includes('BOOTSTRAP_EMAIL_UNCONFIRMED')) {
        return jsonResponse({ error: errMsg }, 403);
      }
      return jsonResponse({ error: errMsg }, 500);
    }

    const result = (bootstrapRes || {}) as Record<string, unknown>;
    const resolvedOrgId = String(result.organization_id || '');
    const resolvedRoleCode = String(result.role_code || 'clinic_admin');

    // Atualiza metadados da conta autenticada sem alterar senha nem exigir confirmação extra
    await adminClient.auth.admin.updateUserById(callerAuthUser.id, {
      user_metadata: {
        ...(callerAuthUser.user_metadata || {}),
        full_name: effectiveFullName,
        role_code: resolvedRoleCode,
        organization_id: resolvedOrgId,
      },
    });

    return jsonResponse({
      success: true,
      idempotent: Boolean(result.idempotent),
      profileId: result.profile_id,
      organizationId: resolvedOrgId,
      roleCode: resolvedRoleCode,
    });
  }

  // Para todas as demais operações administrativas, exigir perfil ativo vinculado
  const { data: callerProfile, error: callerProfileErr } = await adminClient
    .from('user_profiles')
    .select('*')
    .eq('user_id', callerAuthUser.id)
    .maybeSingle();

  if (callerProfileErr || !callerProfile || !callerProfile.is_active) {
    return jsonResponse({ error: 'Perfil do solicitante inativo ou não encontrado.' }, 403);
  }

  const callerRole = String(callerProfile.role_code);
  const callerOrgId = callerProfile.organization_id ? String(callerProfile.organization_id) : null;

  // Verificar permissão para gerenciar equipe
  const canManageUsers = async (): Promise<boolean> => {
    if (callerRole === 'super_admin' || callerRole === 'clinic_admin') return true;
    const { data: hasCreatePerm } = await userClient.rpc('medsync_has_menu_permission', {
      p_menu_key: 'users',
      p_action: 'create',
    });
    const { data: hasEditPerm } = await userClient.rpc('medsync_has_menu_permission', {
      p_menu_key: 'users',
      p_action: 'edit',
    });
    const { data: hasAdminPerm } = await userClient.rpc('medsync_has_menu_permission', {
      p_menu_key: 'users',
      p_action: 'admin',
    });
    return Boolean(hasCreatePerm || hasEditPerm || hasAdminPerm);
  };

  try {
    // =========================================================================
    // AÇÃO 1: AUDITORIA DO SUPER ADMIN (NO ESCOPO DA ORGANIZAÇÃO AUTORIZADA)
    // =========================================================================
    if (action === 'audit_super_admin_email' || action === 'update_super_admin_email') {
      if (callerRole !== 'super_admin') {
        return jsonResponse(
          { error: 'Apenas o Super Administrador autenticado pode realizar esta operação.' },
          403
        );
      }

      let spQuery = adminClient
        .from('user_profiles')
        .select('id, user_id, organization_id, full_name, email, role_code, is_active, created_at')
        .eq('role_code', 'super_admin');
      if (callerOrgId) {
        spQuery = spQuery.eq('organization_id', callerOrgId);
      }
      const { data: superProfiles, error: spErr } = await spQuery;

      if (spErr) {
        return jsonResponse({ error: spErr.message }, 500);
      }

      const { data: authUsersList, error: listUsersErr } = await adminClient.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      });

      if (listUsersErr) {
        return jsonResponse({ error: listUsersErr.message }, 500);
      }

      const candidates = ((superProfiles || []) as SuperProfileRow[]).map((prof) => {
        const matchedAuth = (authUsersList.users as AuthUserRow[]).find((u) => u.id === prof.user_id);
        return {
          profileId: prof.id,
          authUserId: prof.user_id,
          organizationId: prof.organization_id,
          fullName: prof.full_name,
          profileEmail: prof.email,
          authEmail: matchedAuth?.email || null,
          pendingNewEmail: matchedAuth?.new_email || null,
          emailConfirmedAt: matchedAuth?.email_confirmed_at || null,
          roleCode: prof.role_code,
          isActive: prof.is_active,
        };
      });

      if (action === 'audit_super_admin_email') {
        return jsonResponse({
          success: true,
          candidateCount: candidates.length,
          candidates,
        });
      }

      // update_super_admin_email foi desativada definitivamente para evitar sobrescrita
      // do administrador da Clínica Dr. Newton Mureb ao separar a plataforma SaaS.
      return jsonResponse(
        {
          error:
            'Operação desativada por segurança: não altere o e-mail do administrador da clínica. Utilize a transferência oficial da Administração Geral SaaS.',
        },
        403
      );
    }

    // =========================================================================
    // AÇÃO 2: CRIAR USUÁRIO REAL + PERFIL + FILIAIS + RBAC (REUTILIZANDO AUTH SE NECESSÁRIO)
    // =========================================================================
    if (action === 'create_user') {
      if (!callerOrgId) {
        return jsonResponse(
          { error: 'Gestão operacional de usuários pertence ao administrador de cada clínica.' },
          403
        );
      }
      if (!(await canManageUsers())) {
        return jsonResponse({ error: 'Permissão negada para cadastrar usuários.' }, 403);
      }

      const fullName = String(payload.fullName || '').trim();
      const email = String(payload.email || '').trim().toLowerCase();
      const phone = String(payload.phone || '').trim();
      const roleCode = String(payload.role || 'receptionist');
      const requestedOrgId = String(payload.organizationId || callerOrgId);
      const defaultBranchId = payload.defaultBranchId ? String(payload.defaultBranchId) : null;
      const authorizedBranchIds = Array.isArray(payload.authorizedBranchIds)
        ? payload.authorizedBranchIds.map(String)
        : [];
      const isActive = payload.isActive !== false;
      const authMode = String(payload.authMode || 'invite'); // 'invite' | 'password'
      const initialPassword = String(payload.password || '');
      const professionalId = payload.professionalId ? String(payload.professionalId) : null;
      const menuPermissions = Array.isArray(payload.menuPermissions)
        ? (payload.menuPermissions as MenuPermInput[])
        : [];

      if (!fullName || !email) {
        return jsonResponse({ error: 'Nome completo e e-mail são obrigatórios.' }, 400);
      }

      // Isolamento multi-tenant estrito: todo usuário autenticado opera apenas na sua organização autorizada
      if (requestedOrgId !== callerOrgId) {
        return jsonResponse(
          { error: 'Isolamento multi-tenant: não é permitido criar usuário em outra organização.' },
          403
        );
      }

      if (roleCode === 'super_admin') {
        return jsonResponse(
          { error: 'Elevação de privilégio bloqueada: papel super_admin é exclusivo da plataforma SaaS.' },
          403
        );
      }
      if (callerRole === 'branch_admin' && (roleCode === 'clinic_admin' || roleCode === 'branch_admin')) {
        return jsonResponse(
          { error: 'Administrador de filial não pode cadastrar outros administradores.' },
          403
        );
      }

      if (authMode === 'password' && initialPassword.length < 8) {
        return jsonResponse(
          { error: 'A senha inicial deve possuir no mínimo 8 caracteres.' },
          400
        );
      }

      // 1) Verificar duplicidade na mesma organização
      const { data: existingProfile } = await adminClient
        .from('user_profiles')
        .select('id')
        .eq('organization_id', requestedOrgId)
        .ilike('email', email)
        .maybeSingle();

      if (existingProfile) {
        return jsonResponse(
          { error: `Já existe um usuário cadastrado nesta organização com o e-mail ${email}.` },
          409
        );
      }

      // 2) Verificar se a identidade já existe no sistema de autenticação antes de criar
      const { user: existingAuthUser, error: lookupErr } = await findAuthUserByEmail(
        adminClient,
        email
      );
      if (lookupErr) {
        return jsonResponse({ error: lookupErr }, 500);
      }

      let authUserId: string | undefined;
      let createdNewAuthUser = false;
      let accountCreatedMode: 'invited' | 'created_with_password' | 'reused_existing_auth' = 'invited';

      if (existingAuthUser) {
        // Verificar se essa conta já está vinculada a algum perfil
        const { data: linkedProfile } = await adminClient
          .from('user_profiles')
          .select('id, organization_id')
          .eq('user_id', existingAuthUser.id)
          .maybeSingle();

        if (linkedProfile) {
          return jsonResponse(
            {
              error:
                'Este e-mail já possui conta ativa vinculada a outro perfil no sistema.',
            },
            409
          );
        }

        // Identidade órfã no Auth: reutiliza o UUID existente com segurança
        authUserId = existingAuthUser.id;
        accountCreatedMode = 'reused_existing_auth';

        const updateAttrs: Record<string, unknown> = {
          user_metadata: {
            ...(existingAuthUser.user_metadata || {}),
            full_name: fullName,
            role_code: roleCode,
            organization_id: requestedOrgId,
          },
          ban_duration: isActive ? 'none' : '876000h',
        };
        if (authMode === 'password' && !existingAuthUser.email_confirmed_at) {
          updateAttrs.password = initialPassword;
          updateAttrs.email_confirm = true;
        }

        const { error: reuseUpdateErr } = await adminClient.auth.admin.updateUserById(
          authUserId,
          updateAttrs
        );
        if (reuseUpdateErr) {
          return jsonResponse({ error: reuseUpdateErr.message }, 400);
        }

        if (authMode === 'invite' && !existingAuthUser.email_confirmed_at) {
          await adminClient.auth.admin.inviteUserByEmail(email, {
            data: { full_name: fullName, role_code: roleCode, organization_id: requestedOrgId },
          });
        }
      } else if (authMode === 'password') {
        const { data: createdAuth, error: createAuthErr } =
          await adminClient.auth.admin.createUser({
            email,
            password: initialPassword,
            email_confirm: true,
            user_metadata: { full_name: fullName, role_code: roleCode, organization_id: requestedOrgId },
          });
        if (createAuthErr || !createdAuth?.user) {
          return jsonResponse(
            { error: createAuthErr?.message || 'Erro ao criar conta de acesso.' },
            400
          );
        }
        authUserId = createdAuth.user.id;
        createdNewAuthUser = true;
        accountCreatedMode = 'created_with_password';
      } else {
        const { data: invitedAuth, error: inviteErr } =
          await adminClient.auth.admin.inviteUserByEmail(email, {
            data: { full_name: fullName, role_code: roleCode, organization_id: requestedOrgId },
          });
        if (inviteErr || !invitedAuth?.user) {
          return jsonResponse(
            { error: inviteErr?.message || 'Erro ao enviar convite por e-mail.' },
            400
          );
        }
        authUserId = invitedAuth.user.id;
        createdNewAuthUser = true;
        accountCreatedMode = 'invited';
      }

      // Se conta nova nascer desativada, bloquear no Auth
      if (!isActive && authUserId && createdNewAuthUser) {
        await adminClient.auth.admin.updateUserById(authUserId, { ban_duration: '876000h' });
      }

      // 3) Criar perfil em public.user_profiles
      const { data: insertedProfile, error: profErr } = await adminClient
        .from('user_profiles')
        .insert({
          user_id: authUserId,
          organization_id: requestedOrgId,
          default_branch_id: defaultBranchId,
          full_name: fullName,
          email,
          phone: phone || null,
          role_code: roleCode,
          is_active: isActive,
        })
        .select('*')
        .single();

      if (profErr || !insertedProfile) {
        // Rollback apenas se uma nova conta de Auth acabou de ser criada nesta requisição
        if (authUserId && createdNewAuthUser) {
          await adminClient.auth.admin.deleteUser(authUserId);
        }
        return jsonResponse(
          { error: profErr?.message || 'Falha ao gravar perfil de usuário no banco de dados.' },
          500
        );
      }

      // 4) Filiais autorizadas
      const uniqueBranches = Array.from(
        new Set([...authorizedBranchIds, ...(defaultBranchId ? [defaultBranchId] : [])])
      );
      if (uniqueBranches.length > 0) {
        await adminClient.from('user_branch_access').insert(
          uniqueBranches.map((bid) => ({
            organization_id: requestedOrgId,
            user_profile_id: insertedProfile.id,
            branch_id: bid,
            is_default: bid === defaultBranchId,
          }))
        );
      }

      // 5) Exceções individuais de menu
      const customPerms = menuPermissions.filter((p) => p.isCustomOverride);
      if (customPerms.length > 0) {
        await adminClient.from('user_menu_permissions').insert(
          customPerms.map((p) => ({
            organization_id: requestedOrgId,
            user_profile_id: insertedProfile.id,
            menu_key: p.menuKey,
            can_view: p.canView,
            can_consult: p.canConsult,
            can_create: p.canCreate,
            can_edit: p.canEdit,
            can_delete: p.canDelete,
            can_admin: p.canAdmin,
            is_custom_override: true,
            updated_by: callerProfile.id,
          }))
        );
      }

      // 6) Vincular profissional se informado
      if (professionalId) {
        await adminClient
          .from('professionals')
          .update({ user_profile_id: insertedProfile.id })
          .eq('id', professionalId)
          .eq('organization_id', requestedOrgId);
      }

      // 7) Auditoria
      await adminClient.from('audit_logs').insert({
        organization_id: requestedOrgId,
        user_id: callerAuthUser.id,
        user_role: callerRole,
        action: 'create_user',
        entity: 'user_profiles',
        entity_id: insertedProfile.id,
        details: {
          actor_name: callerProfile.full_name,
          created_email: email,
          role_code: roleCode,
          auth_mode: accountCreatedMode,
          reused_existing_auth: !createdNewAuthUser,
          authorized_branch_ids: uniqueBranches,
        },
      });

      return jsonResponse({
        success: true,
        profile: insertedProfile,
        authMode: accountCreatedMode,
        reusedExistingAuth: !createdNewAuthUser,
      });
    }

    // =========================================================================
    // AÇÃO 3: ATUALIZAR STATUS NO AUTH + PERFIL (BLOQUEIO / REATIVAÇÃO)
    // =========================================================================
    if (action === 'sync_auth_user_status') {
      if (!(await canManageUsers())) {
        return jsonResponse({ error: 'Permissão negada.' }, 403);
      }

      const targetProfileId = String(payload.targetProfileId || '');
      const isActive = Boolean(payload.isActive);

      const { data: targetProf } = await adminClient
        .from('user_profiles')
        .select('*')
        .eq('id', targetProfileId)
        .maybeSingle();

      if (!targetProf) {
        return jsonResponse({ error: 'Perfil não encontrado.' }, 404);
      }

      if (targetProf.organization_id !== callerOrgId) {
        return jsonResponse({ error: 'Isolamento multi-tenant violado.' }, 403);
      }

      if (callerRole !== 'super_admin' && targetProf.role_code === 'super_admin') {
        return jsonResponse({ error: 'Não é permitido alterar o Super Administrador.' }, 403);
      }

      if (targetProf.user_id) {
        const { error: banErr } = await adminClient.auth.admin.updateUserById(
          targetProf.user_id,
          { ban_duration: isActive ? 'none' : '876000h' }
        );
        if (banErr) {
          return jsonResponse({ error: banErr.message }, 500);
        }
      }

      return jsonResponse({ success: true });
    }

    // =========================================================================
    // AÇÃO 4: REENVIAR CONVITE OU LINK DE RECUPERAÇÃO DE ACESSO
    // =========================================================================
    if (action === 'resend_invite_or_recovery') {
      if (!(await canManageUsers())) {
        return jsonResponse({ error: 'Permissão negada.' }, 403);
      }

      const targetProfileId = String(payload.targetProfileId || '');
      const mode = String(payload.mode || 'recovery'); // 'invite' | 'recovery'

      const { data: targetProf } = await adminClient
        .from('user_profiles')
        .select('*')
        .eq('id', targetProfileId)
        .maybeSingle();

      if (!targetProf) {
        return jsonResponse({ error: 'Usuário não encontrado.' }, 404);
      }

      if (targetProf.organization_id !== callerOrgId) {
        return jsonResponse({ error: 'Isolamento multi-tenant violado.' }, 403);
      }

      let deliveredMode = mode;

      if (mode === 'invite') {
        let alreadyConfirmed = false;
        if (targetProf.user_id) {
          const { data: targetAuthData } = await adminClient.auth.admin.getUserById(targetProf.user_id);
          alreadyConfirmed = Boolean(targetAuthData?.user?.email_confirmed_at);
        }

        if (!alreadyConfirmed) {
          const { error: invErr } = await adminClient.auth.admin.inviteUserByEmail(targetProf.email);
          if (invErr) {
            // Se já registrado, envia link de definição/redefinição de senha como alternativa segura
            const { error: recFallbackErr } = await adminClient.auth.resetPasswordForEmail(
              targetProf.email
            );
            if (recFallbackErr) {
              return jsonResponse({ error: invErr.message }, 500);
            }
            deliveredMode = 'recovery';
          }
        } else {
          const { error: recErr } = await adminClient.auth.resetPasswordForEmail(targetProf.email);
          if (recErr) {
            return jsonResponse({ error: recErr.message }, 500);
          }
          deliveredMode = 'recovery';
        }
      } else {
        const { error: recErr } = await adminClient.auth.resetPasswordForEmail(targetProf.email);
        if (recErr) {
          return jsonResponse({ error: recErr.message }, 500);
        }
      }

      await adminClient.from('audit_logs').insert({
        organization_id: targetProf.organization_id,
        user_id: callerAuthUser.id,
        user_role: callerRole,
        action: deliveredMode === 'invite' ? 'resend_invite' : 'send_password_recovery',
        entity: 'user_profiles',
        entity_id: targetProf.id,
        details: { target_email: targetProf.email, actor_name: callerProfile.full_name },
      });

      return jsonResponse({ success: true, deliveredMode });
    }

    return jsonResponse({ error: `Ação desconhecida: ${action}` }, 400);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: message }, 500);
  }
});
