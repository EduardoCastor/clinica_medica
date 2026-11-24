// Supabase Edge Function: admin-team-management
// Executa operações administrativas seguras de Supabase Auth usando SUPABASE_SERVICE_ROLE_KEY
// exclusivamente no servidor (nunca exposta ao frontend).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';

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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
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
      { error: 'Variáveis de ambiente do Supabase Edge Function não configuradas.' },
      500
    );
  }

  const authHeader = req.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Cabeçalho Authorization Bearer obrigatório.' }, 401);
  }

  // Cliente autenticado com o JWT do solicitante
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  // Cliente administrativo (service_role exclusivo no servidor)
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const {
    data: { user: callerAuthUser },
    error: callerAuthErr,
  } = await userClient.auth.getUser();

  if (callerAuthErr || !callerAuthUser) {
    return jsonResponse({ error: 'Sessão inválida ou expirada.' }, 401);
  }

  const { data: callerProfile, error: callerProfileErr } = await adminClient
    .from('user_profiles')
    .select('*')
    .eq('user_id', callerAuthUser.id)
    .maybeSingle();

  if (callerProfileErr || !callerProfile || !callerProfile.is_active) {
    return jsonResponse({ error: 'Perfil do solicitante inativo ou não encontrado.' }, 403);
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: 'Corpo JSON inválido.' }, 400);
  }

  const action = String(payload.action || '');
  const callerRole = String(callerProfile.role_code);
  const callerOrgId = String(callerProfile.organization_id);

  // Verificar permissão para gerenciar equipe
  const canManageUsers = async (): Promise<boolean> => {
    if (callerRole === 'super_admin' || callerRole === 'clinic_admin') return true;
    const { data: hasPerm } = await userClient.rpc('medsync_has_menu_permission', {
      p_menu_key: 'users',
      p_action: 'create',
    });
    const { data: hasAdminPerm } = await userClient.rpc('medsync_has_menu_permission', {
      p_menu_key: 'users',
      p_action: 'admin',
    });
    return Boolean(hasPerm || hasAdminPerm);
  };

  try {
    // =========================================================================
    // AÇÃO 1: AUDITORIA DO SUPER ADMIN (SEM ALTERAÇÃO AUTOMÁTICA EM AMBIGUIDADE)
    // =========================================================================
    if (action === 'audit_super_admin_email' || action === 'update_super_admin_email') {
      if (callerRole !== 'super_admin') {
        return jsonResponse(
          { error: 'Apenas um Super Administrador autenticado pode auditar ou atualizar o e-mail do Super Admin.' },
          403
        );
      }

      const { data: superProfiles, error: spErr } = await adminClient
        .from('user_profiles')
        .select('id, user_id, organization_id, full_name, email, role_code, is_active, created_at')
        .eq('role_code', 'super_admin');

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
      interface AuthUserRow {
        id: string;
        email?: string;
        new_email?: string;
        email_confirmed_at?: string;
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

      // update_super_admin_email
      if (candidates.length === 0) {
        return jsonResponse(
          { error: 'Nenhum usuário com papel super_admin encontrado em public.user_profiles.' },
          404
        );
      }

      if (candidates.length > 1) {
        return jsonResponse(
          {
            error:
              'Mais de um candidato a Super Admin foi encontrado. Operação interrompida para identificação segura sem escolha arbitrária.',
            ambiguous: true,
            candidates,
          },
          409
        );
      }

      const target = candidates[0];
      if (!target.authUserId) {
        return jsonResponse(
          {
            error:
              'O registro super_admin em user_profiles não possui user_id vinculado ao Supabase Auth.',
            candidates,
          },
          409
        );
      }

      const desiredEmail = String(payload.newEmail || 'admin@drnewtonmureb.com.br')
        .trim()
        .toLowerCase();
      const requireEmailConfirmation = Boolean(payload.requireEmailConfirmation);

      // Verifica se o e-mail já está em uso por outro Auth user diferente
      const conflictingAuth = (authUsersList.users as AuthUserRow[]).find(
        (u) => u.email?.toLowerCase() === desiredEmail && u.id !== target.authUserId
      );
      if (conflictingAuth) {
        return jsonResponse(
          {
            error: `O e-mail ${desiredEmail} já pertence a outro usuário no Supabase Auth (UUID ${conflictingAuth.id}).`,
          },
          409
        );
      }

      // Atualiza exclusivamente via Supabase Admin API preservando UUID, senha e relacionamentos
      const { data: updatedAuth, error: updateAuthErr } =
        await adminClient.auth.admin.updateUserById(target.authUserId, {
          email: desiredEmail,
          email_confirm: !requireEmailConfirmation,
        });

      if (updateAuthErr || !updatedAuth?.user) {
        return jsonResponse(
          { error: updateAuthErr?.message || 'Falha ao atualizar e-mail no Supabase Auth.' },
          500
        );
      }

      // Atualiza o perfil mantendo papel super_admin e UUIDs intactos
      const { error: updateProfErr } = await adminClient
        .from('user_profiles')
        .update({
          email: desiredEmail,
          updated_at: new Date().toISOString(),
        })
        .eq('id', target.profileId)
        .eq('role_code', 'super_admin');

      if (updateProfErr) {
        return jsonResponse(
          {
            error: `E-mail atualizado no Auth, mas houve falha ao atualizar user_profiles: ${updateProfErr.message}`,
          },
          500
        );
      }

      await adminClient.from('audit_logs').insert({
        organization_id: target.organizationId,
        user_id: callerAuthUser.id,
        user_role: callerRole,
        action: 'update_super_admin_email',
        entity: 'user_profiles',
        entity_id: target.profileId,
        details: {
          auth_user_id: target.authUserId,
          previous_email: target.authEmail || target.profileEmail,
          new_email: desiredEmail,
          require_confirmation: requireEmailConfirmation,
          updated_at: new Date().toISOString(),
        },
      });

      return jsonResponse({
        success: true,
        authUserId: target.authUserId,
        profileId: target.profileId,
        previousEmail: target.authEmail || target.profileEmail,
        newEmail: desiredEmail,
        pendingConfirmation: requireEmailConfirmation,
      });
    }

    // =========================================================================
    // AÇÃO 2: CRIAR USUÁRIO REAL NO SUPABASE AUTH + PERFIL + FILIAIS + RBAC
    // =========================================================================
    if (action === 'create_user') {
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

      if (callerRole !== 'super_admin') {
        if (requestedOrgId !== callerOrgId) {
          return jsonResponse(
            { error: 'Isolamento multi-tenant: não é permitido criar usuário em outra organização.' },
            403
          );
        }
        if (roleCode === 'super_admin') {
          return jsonResponse(
            { error: 'Elevação de privilégio bloqueada: apenas super_admin pode criar super_admin.' },
            403
          );
        }
        if (callerRole === 'branch_admin' && (roleCode === 'clinic_admin' || roleCode === 'branch_admin')) {
          return jsonResponse(
            { error: 'Administrador de filial não pode cadastrar outros administradores.' },
            403
          );
        }
      }

      if (authMode === 'password' && initialPassword.length < 8) {
        return jsonResponse(
          { error: 'A senha inicial deve possuir no mínimo 8 caracteres.' },
          400
        );
      }

      // Verificar duplicidade na organização
      const { data: existingProfile } = await adminClient
        .from('user_profiles')
        .select('id')
        .eq('organization_id', requestedOrgId)
        .ilike('email', email)
        .maybeSingle();

      if (existingProfile) {
        return jsonResponse(
          { error: `Já existe um usuário cadastrado nesta clínica com o e-mail ${email}.` },
          409
        );
      }

      // 1) Criar ou convidar no Supabase Auth
      let authUserId: string | undefined;
      let accountCreatedMode: 'invited' | 'created_with_password' = 'invited';

      if (authMode === 'password') {
        const { data: createdAuth, error: createAuthErr } =
          await adminClient.auth.admin.createUser({
            email,
            password: initialPassword,
            email_confirm: true,
            user_metadata: { full_name: fullName, role_code: roleCode, organization_id: requestedOrgId },
          });
        if (createAuthErr || !createdAuth?.user) {
          return jsonResponse(
            { error: createAuthErr?.message || 'Erro ao criar conta no Supabase Auth.' },
            400
          );
        }
        authUserId = createdAuth.user.id;
        accountCreatedMode = 'created_with_password';
      } else {
        const { data: invitedAuth, error: inviteErr } =
          await adminClient.auth.admin.inviteUserByEmail(email, {
            data: { full_name: fullName, role_code: roleCode, organization_id: requestedOrgId },
          });
        if (inviteErr || !invitedAuth?.user) {
          return jsonResponse(
            { error: inviteErr?.message || 'Erro ao enviar convite pelo Supabase Auth.' },
            400
          );
        }
        authUserId = invitedAuth.user.id;
        accountCreatedMode = 'invited';
      }

      // Se conta nascer desativada, bloquear no Auth
      if (!isActive && authUserId) {
        await adminClient.auth.admin.updateUserById(authUserId, { ban_duration: '876000h' });
      }

      // 2) Criar perfil em public.user_profiles
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
        // Rollback do usuário criado no Auth para não deixar órfão
        if (authUserId) {
          await adminClient.auth.admin.deleteUser(authUserId);
        }
        return jsonResponse(
          { error: profErr?.message || 'Falha ao gravar perfil de usuário no banco de dados.' },
          500
        );
      }

      // 3) Filiais autorizadas
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

      // 4) Exceções individuais de menu
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

      // 5) Vincular profissional se informado
      if (professionalId) {
        await adminClient
          .from('professionals')
          .update({ user_profile_id: insertedProfile.id })
          .eq('id', professionalId)
          .eq('organization_id', requestedOrgId);
      }

      // 6) Auditoria
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
          authorized_branch_ids: uniqueBranches,
        },
      });

      return jsonResponse({
        success: true,
        profile: insertedProfile,
        authMode: accountCreatedMode,
      });
    }

    // =========================================================================
    // AÇÃO 3: ATUALIZAR STATUS/EMAIL NO AUTH + PERFIL
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

      if (callerRole !== 'super_admin') {
        if (targetProf.organization_id !== callerOrgId) {
          return jsonResponse({ error: 'Isolamento multi-tenant violado.' }, 403);
        }
        if (targetProf.role_code === 'super_admin') {
          return jsonResponse({ error: 'Não é permitido alterar um Super Admin.' }, 403);
        }
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

      if (callerRole !== 'super_admin' && targetProf.organization_id !== callerOrgId) {
        return jsonResponse({ error: 'Isolamento multi-tenant violado.' }, 403);
      }

      if (mode === 'invite') {
        const { error: invErr } = await adminClient.auth.admin.inviteUserByEmail(targetProf.email);
        if (invErr) {
          return jsonResponse({ error: invErr.message }, 500);
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
        action: mode === 'invite' ? 'resend_invite' : 'send_password_recovery',
        entity: 'user_profiles',
        entity_id: targetProf.id,
        details: { target_email: targetProf.email, actor_name: callerProfile.full_name },
      });

      return jsonResponse({ success: true });
    }

    return jsonResponse({ error: `Ação desconhecida: ${action}` }, 400);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: message }, 500);
  }
});
