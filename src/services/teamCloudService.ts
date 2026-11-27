import { SupabaseClient } from '@supabase/supabase-js';
import {
  AuditLog,
  Branch,
  MenuKey,
  MenuPermissionSet,
  Organization,
  Professional,
  RolePermissionTemplate,
  Specialty,
  UserMenuPermissionRecord,
  UserProfile,
  UserRole,
} from '../types';
import { getSupabase, getSupabaseCredentials } from './supabaseClient';
import { StorageService } from './storage';
import {
  ALL_USER_ROLES,
  DEFAULT_ROLE_PERMISSIONS,
  MENU_DEFINITIONS,
  resolveEffectivePermissions,
} from './rbacConfig';
import { mapDbOrgRowToOrganization } from './saasCloudService';

export const isUuid = (val?: string | null): val is string =>
  Boolean(
    val && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val.trim())
  );

function formatPgError(err: unknown, fallback: string): string {
  if (!err || typeof err !== 'object') return fallback;
  const e = err as { code?: string; message?: string; details?: string; hint?: string };
  if (e.code === '23505') {
    return 'Registro duplicado detectado (verifique o e-mail ou registro no conselho).';
  }
  if (e.code === '42501') {
    return 'Acesso negado: você não possui permissão para realizar esta operação.';
  }
  if (e.message) {
    return e.details ? `${e.message} (${e.details})` : e.message;
  }
  return fallback;
}

export interface SessionContextPayload {
  authenticated: boolean;
  profileFound: boolean;
  profile?: UserProfile;
  organization?: Organization;
  branches?: Branch[];
  authorizedBranchIds?: string[];
  roleTemplates?: Partial<Record<UserRole, RolePermissionTemplate>>;
  effectivePermissions?: Record<MenuKey, UserMenuPermissionRecord>;
  error?: string;
}

export interface TeamBootstrapResult {
  source: 'cloud' | 'local';
  organizationId: string;
  organization?: Organization;
  branches: Branch[];
  specialties: Specialty[];
  professionals: Professional[];
  users: UserProfile[];
  roleTemplates: Record<UserRole, RolePermissionTemplate>;
  auditLogs: AuditLog[];
  error?: string;
}

export interface SuperAdminCandidateInfo {
  profileId: string;
  authUserId: string | null;
  organizationId: string;
  fullName: string;
  profileEmail: string;
  authEmail: string | null;
  pendingNewEmail?: string | null;
  emailConfirmedAt?: string | null;
  roleCode: string;
  isActive: boolean;
}

export interface BootstrapStatus {
  needsBootstrap: boolean;
  alreadyInitialized: boolean;
  organizationFound: boolean;
  organizationName: string;
  checkedFromCloud: boolean;
  error?: string;
}

function mapBranchRow(row: Record<string, unknown>): Branch {
  const hours =
    row.opening_hours && typeof row.opening_hours === 'object'
      ? (row.opening_hours as Record<string, unknown>)
      : {};
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    clinicId: String(row.clinic_id || ''),
    name: String(row.name || ''),
    code: String(row.code || ''),
    isHeadquarters: Boolean(row.is_headquarters),
    documentNumber: String(row.document_number || ''),
    phone: String(row.phone || ''),
    whatsapp: String(row.whatsapp || ''),
    email: String(row.email || ''),
    postalCode: String(row.postal_code || ''),
    street: String(row.street || ''),
    number: String(row.number || ''),
    complement: row.complement ? String(row.complement) : undefined,
    neighborhood: String(row.neighborhood || ''),
    city: String(row.city || ''),
    state: String(row.state || ''),
    openingHours: {
      weekday: String(hours.weekday || '08:00 às 19:00'),
      saturday: hours.saturday ? String(hours.saturday) : undefined,
      sunday: hours.sunday ? String(hours.sunday) : undefined,
    },
    patientSharingMode: (row.patient_sharing_mode as Branch['patientSharingMode']) || 'model_b',
    isActive: row.is_active !== false,
  };
}

function mapOrganizationRow(row: Record<string, unknown>): Organization {
  const localOrg = StorageService.getOrganization();
  return mapDbOrgRowToOrganization(row, localOrg);
}

function buildRoleTemplatesFromRows(
  rows: Array<Record<string, unknown>>
): Record<UserRole, RolePermissionTemplate> {
  const result = {} as Record<UserRole, RolePermissionTemplate>;
  for (const role of ALL_USER_ROLES) {
    result[role] = { ...DEFAULT_ROLE_PERMISSIONS[role] };
  }

  // Primeiro aplica globais (organization_id IS NULL), depois específicos da org
  const sorted = [...rows].sort((a, b) => {
    const aHasOrg = a.organization_id ? 1 : 0;
    const bHasOrg = b.organization_id ? 1 : 0;
    return aHasOrg - bHasOrg;
  });

  for (const row of sorted) {
    const roleCode = String(row.role_code || '') as UserRole;
    const menuKey = String(row.menu_key || '') as MenuKey;
    if (!ALL_USER_ROLES.includes(roleCode)) continue;
    if (!MENU_DEFINITIONS.some((m) => m.key === menuKey)) continue;

    result[roleCode] = {
      ...result[roleCode],
      [menuKey]: {
        canView: Boolean(row.can_view),
        canConsult: Boolean(row.can_consult),
        canCreate: Boolean(row.can_create),
        canEdit: Boolean(row.can_edit),
        canDelete: Boolean(row.can_delete),
        canAdmin: Boolean(row.can_admin),
      },
    };
  }

  return result;
}

function mapUserPermissionsRows(
  rows: Array<Record<string, unknown>>
): Partial<Record<MenuKey, UserMenuPermissionRecord>> {
  const map: Partial<Record<MenuKey, UserMenuPermissionRecord>> = {};
  for (const row of rows) {
    const menuKey = String(row.menu_key || '') as MenuKey;
    if (!MENU_DEFINITIONS.some((m) => m.key === menuKey)) continue;
    map[menuKey] = {
      menuKey,
      canView: Boolean(row.can_view),
      canConsult: Boolean(row.can_consult),
      canCreate: Boolean(row.can_create),
      canEdit: Boolean(row.can_edit),
      canDelete: Boolean(row.can_delete),
      canAdmin: Boolean(row.can_admin),
      isCustomOverride: row.is_custom_override !== false,
    };
  }
  return map;
}

function mapUserProfileRow(
  row: Record<string, unknown>,
  authorizedBranchIds: string[],
  userPermRows: Array<Record<string, unknown>>
): UserProfile {
  return {
    id: String(row.id),
    userId: row.user_id ? String(row.user_id) : undefined,
    organizationId: String(row.organization_id),
    defaultBranchId: row.default_branch_id ? String(row.default_branch_id) : undefined,
    authorizedBranchIds:
      authorizedBranchIds.length > 0
        ? authorizedBranchIds
        : row.default_branch_id
        ? [String(row.default_branch_id)]
        : [],
    fullName: String(row.full_name || ''),
    email: String(row.email || ''),
    phone: String(row.phone || ''),
    avatarUrl: row.avatar_url ? String(row.avatar_url) : undefined,
    role: (row.role_code as UserRole) || 'receptionist',
    isActive: row.is_active !== false,
    permissions: mapUserPermissionsRows(userPermRows),
    createdAt: row.created_at ? String(row.created_at) : undefined,
    updatedAt: row.updated_at ? String(row.updated_at) : undefined,
  };
}

async function resolveOrganizationUuid(
  supabase: SupabaseClient,
  orgHint?: string
): Promise<{ orgId?: string; organization?: Organization; error?: string }> {
  if (isUuid(orgHint)) {
    const { data, error } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', orgHint)
      .maybeSingle();
    if (error) return { error: formatPgError(error, 'Erro ao buscar organização.') };
    if (data) return { orgId: String(data.id), organization: mapOrganizationRow(data as Record<string, unknown>) };
  }

  const localOrg = StorageService.getOrganization();
  if (isUuid(localOrg.id)) {
    const { data } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', localOrg.id)
      .maybeSingle();
    if (data) return { orgId: String(data.id), organization: mapOrganizationRow(data as Record<string, unknown>) };
  }

  const slug = (localOrg.slug || 'dr-newton-mureb').trim().toLowerCase();
  const { data: bySlug } = await supabase
    .from('organizations')
    .select('*')
    .eq('slug', slug)
    .limit(1)
    .maybeSingle();

  if (bySlug?.id) {
    return { orgId: String(bySlug.id), organization: mapOrganizationRow(bySlug as Record<string, unknown>) };
  }

  const { data: firstOrg, error: firstErr } = await supabase
    .from('organizations')
    .select('*')
    .limit(1)
    .maybeSingle();

  if (firstErr) {
    return { error: formatPgError(firstErr, 'Não foi possível localizar os dados da organização.') };
  }
  if (!firstOrg?.id) {
    return { error: 'Nenhuma organização cadastrada foi encontrada.' };
  }
  return { orgId: String(firstOrg.id), organization: mapOrganizationRow(firstOrg as Record<string, unknown>) };
}

async function invokeAnonEdgeFunction<T = Record<string, unknown>>(
  body: Record<string, unknown>
): Promise<{ data?: T; error?: string; status?: number }> {
  const { url, anonKey } = getSupabaseCredentials();
  if (!url || !anonKey) {
    return { error: 'Conexão com o servidor de contas não configurada.' };
  }

  try {
    const response = await fetch(`${url}/functions/v1/admin-team-management`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
      body: JSON.stringify(body),
    });

    let parsed: Record<string, unknown> = {};
    try {
      parsed = (await response.json()) as Record<string, unknown>;
    } catch {
      // ignore non-json
    }

    if (!response.ok) {
      const msg =
        (parsed.error ? String(parsed.error) : '') ||
        `Não foi possível consultar o servidor (HTTP ${response.status}).`;
      return { data: parsed as T, error: msg, status: response.status };
    }

    return { data: parsed as T, status: response.status };
  } catch {
    return {
      error: 'Serviço de verificação temporariamente indisponível. Tente novamente em instantes.',
    };
  }
}

async function invokeAdminEdgeFunction<T = Record<string, unknown>>(
  supabase: SupabaseClient,
  body: Record<string, unknown>
): Promise<{ data?: T; error?: string; status?: number }> {
  const { data: sessionRes } = await supabase.auth.getSession();
  const accessToken = sessionRes?.session?.access_token;
  if (!accessToken) {
    return { error: 'Sessão expirada. Faça login novamente para continuar.', status: 401 };
  }

  const { url, anonKey } = getSupabaseCredentials();
  if (!url || !anonKey) {
    return { error: 'Conexão com o servidor de contas não configurada.' };
  }

  try {
    const response = await fetch(`${url}/functions/v1/admin-team-management`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    });

    let parsed: Record<string, unknown> = {};
    try {
      parsed = (await response.json()) as Record<string, unknown>;
    } catch {
      // ignore non-json
    }

    if (!response.ok) {
      const msg =
        (parsed.error ? String(parsed.error) : '') ||
        `Falha na operação administrativa (HTTP ${response.status}).`;
      return { data: parsed as T, error: msg, status: response.status };
    }

    return { data: parsed as T, status: response.status };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      error: `Serviço administrativo temporariamente indisponível (${msg}). Tente novamente em instantes.`,
    };
  }
}

export const TeamCloudService = {
  async fetchBootstrapStatus(): Promise<BootstrapStatus> {
    const supabase = getSupabase();
    if (!supabase) {
      return {
        needsBootstrap: false,
        alreadyInitialized: false,
        organizationFound: false,
        organizationName: 'Clínica Dr Newton Mureb',
        checkedFromCloud: false,
      };
    }

    try {
      const { data, error } = await supabase.rpc('medsync_get_bootstrap_status');
      if (!error && data && typeof data === 'object') {
        const d = data as Record<string, unknown>;
        return {
          needsBootstrap: Boolean(d.needs_bootstrap),
          alreadyInitialized: Boolean(d.already_initialized),
          organizationFound: Boolean(d.organization_found),
          organizationName: String(d.organization_name || 'Clínica Dr Newton Mureb'),
          checkedFromCloud: true,
        };
      }
    } catch {
      // fallback para verificação via serviço administrativo
    }

    const fnRes = await invokeAnonEdgeFunction<{
      success?: boolean;
      needsBootstrap?: boolean;
      alreadyInitialized?: boolean;
      organizationFound?: boolean;
      organizationName?: string;
    }>({ action: 'get_bootstrap_status' });

    if (fnRes.error || !fnRes.data?.success) {
      return {
        needsBootstrap: false,
        alreadyInitialized: false,
        organizationFound: false,
        organizationName: 'Clínica Dr Newton Mureb',
        checkedFromCloud: false,
        error: fnRes.error,
      };
    }

    return {
      needsBootstrap: Boolean(fnRes.data.needsBootstrap),
      alreadyInitialized: Boolean(fnRes.data.alreadyInitialized),
      organizationFound: Boolean(fnRes.data.organizationFound),
      organizationName: String(fnRes.data.organizationName || 'Clínica Dr Newton Mureb'),
      checkedFromCloud: true,
    };
  },

  async bootstrapFirstSuperAdmin(fullName: string): Promise<{
    success: boolean;
    idempotent?: boolean;
    profileId?: string;
    organizationId?: string;
    error?: string;
  }> {
    const supabase = getSupabase();
    if (!supabase) {
      return { success: false, error: 'Conexão com o servidor de autenticação indisponível.' };
    }

    const res = await invokeAdminEdgeFunction<{
      success?: boolean;
      idempotent?: boolean;
      profileId?: string;
      organizationId?: string;
      roleCode?: string;
    }>(supabase, {
      action: 'bootstrap_super_admin',
      fullName: fullName.trim(),
    });

    if (res.error || !res.data?.success) {
      return {
        success: false,
        error: res.error || 'Não foi possível concluir a inicialização do Super Administrador.',
      };
    }

    return {
      success: true,
      idempotent: Boolean(res.data.idempotent),
      profileId: res.data.profileId,
      organizationId: res.data.organizationId,
    };
  },

  async fetchCurrentUserSessionContext(): Promise<SessionContextPayload> {
    const supabase = getSupabase();
    if (!supabase) {
      return { authenticated: false, profileFound: false };
    }

    const { data: sessionData } = await supabase.auth.getSession();
    const session = sessionData?.session;
    if (!session?.user) {
      return { authenticated: false, profileFound: false };
    }

    try {
      const { data: rpcData, error: rpcErr } = await supabase.rpc('medsync_get_my_session_context');
      if (!rpcErr && rpcData && typeof rpcData === 'object') {
        const payload = rpcData as Record<string, unknown>;
        if (!payload.authenticated) {
          return { authenticated: false, profileFound: false };
        }
        if (!payload.profile_found || !payload.profile) {
          return {
            authenticated: true,
            profileFound: false,
            error: 'Sua conta ainda não possui perfil de acesso vinculado à clínica.',
          };
        }

        const profRow = payload.profile as Record<string, unknown>;
        const authBranches = Array.isArray(payload.authorized_branch_ids)
          ? payload.authorized_branch_ids.map(String)
          : [];
        const userPermRows = Array.isArray(payload.user_permissions)
          ? (payload.user_permissions as Array<Record<string, unknown>>)
          : [];
        const rolePermRows = Array.isArray(payload.role_permissions)
          ? (payload.role_permissions as Array<Record<string, unknown>>)
          : [];

        const profile = mapUserProfileRow(profRow, authBranches, userPermRows);
        profile.lastSignInAt = session.user.last_sign_in_at;
        profile.emailConfirmedAt = session.user.email_confirmed_at;

        const roleTemplates = buildRoleTemplatesFromRows(rolePermRows);
        const effectivePermissions = resolveEffectivePermissions(
          profile.role,
          roleTemplates,
          profile.permissions
        );

        const orgObj = payload.organization
          ? mapOrganizationRow(payload.organization as Record<string, unknown>)
          : undefined;
        const branchesList = Array.isArray(payload.branches)
          ? (payload.branches as Array<Record<string, unknown>>).map(mapBranchRow)
          : undefined;

        return {
          authenticated: true,
          profileFound: true,
          profile,
          organization: orgObj,
          branches: branchesList,
          authorizedBranchIds: profile.authorizedBranchIds,
          roleTemplates,
          effectivePermissions,
        };
      }
    } catch {
      // Fallback para queries diretas caso a migration da RPC ainda não esteja aplicada
    }

    // 2. Fallback por consultas diretas autenticadas
    const { data: profRow, error: profErr } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', session.user.id)
      .maybeSingle();

    if (profErr) {
      return {
        authenticated: true,
        profileFound: false,
        error: formatPgError(profErr, 'Erro ao carregar perfil do usuário autenticado.'),
      };
    }

    if (!profRow) {
      return {
        authenticated: true,
        profileFound: false,
        error: 'Perfil não encontrado para esta conta no banco de dados.',
      };
    }

    const orgId = String(profRow.organization_id);
    const [orgRes, branchRes, authBranchRes, rolePermRes, userPermRes] = await Promise.all([
      supabase.from('organizations').select('*').eq('id', orgId).maybeSingle(),
      supabase.from('branches').select('*').eq('organization_id', orgId).order('is_headquarters', { ascending: false }),
      supabase.from('user_branch_access').select('branch_id').eq('user_profile_id', profRow.id),
      supabase
        .from('role_permissions')
        .select('*')
        .or(`organization_id.is.null,organization_id.eq.${orgId}`),
      supabase.from('user_menu_permissions').select('*').eq('user_profile_id', profRow.id),
    ]);

    const authBranchIds = (authBranchRes.data || []).map((r) => String((r as Record<string, unknown>).branch_id));
    const userPermRows = (userPermRes.data || []) as Array<Record<string, unknown>>;
    const rolePermRows = (rolePermRes.data || []) as Array<Record<string, unknown>>;

    const profile = mapUserProfileRow(profRow as Record<string, unknown>, authBranchIds, userPermRows);
    profile.lastSignInAt = session.user.last_sign_in_at;
    profile.emailConfirmedAt = session.user.email_confirmed_at;

    const roleTemplates = buildRoleTemplatesFromRows(rolePermRows);
    const effectivePermissions = resolveEffectivePermissions(
      profile.role,
      roleTemplates,
      profile.permissions
    );

    return {
      authenticated: true,
      profileFound: true,
      profile,
      organization: orgRes.data ? mapOrganizationRow(orgRes.data as Record<string, unknown>) : undefined,
      branches: (branchRes.data || []).map((b) => mapBranchRow(b as Record<string, unknown>)),
      authorizedBranchIds: profile.authorizedBranchIds,
      roleTemplates,
      effectivePermissions,
    };
  },

  async fetchTeamBootstrap(organizationIdHint?: string): Promise<TeamBootstrapResult> {
    const localRoleTemplates = StorageService.getRolePermissions();
    const localResult: TeamBootstrapResult = {
      source: 'local',
      organizationId: StorageService.getOrganization().id,
      organization: StorageService.getOrganization(),
      branches: StorageService.getBranches(),
      specialties: StorageService.getSpecialties(),
      professionals: StorageService.getProfessionals(),
      users: StorageService.getUsers(),
      roleTemplates: localRoleTemplates,
      auditLogs: StorageService.getAuditLogs(),
    };

    const supabase = getSupabase();
    if (!supabase) return localResult;

    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData?.session) {
      return {
        ...localResult,
        error: 'Autenticação necessária para sincronizar equipe com a nuvem.',
      };
    }

    const { orgId, organization, error: orgErr } = await resolveOrganizationUuid(
      supabase,
      organizationIdHint
    );
    if (!orgId) {
      return { ...localResult, error: orgErr };
    }

    try {
      const [
        branchesRes,
        specsRes,
        profsRes,
        profBranchesRes,
        usersRes,
        userBranchesRes,
        userMenuPermsRes,
        rolePermsRes,
        auditRes,
      ] = await Promise.all([
        supabase
          .from('branches')
          .select('*')
          .eq('organization_id', orgId)
          .order('is_headquarters', { ascending: false }),
        supabase
          .from('specialties')
          .select('*')
          .eq('organization_id', orgId)
          .order('name', { ascending: true }),
        supabase
          .from('professionals')
          .select('*')
          .eq('organization_id', orgId)
          .order('created_at', { ascending: true }),
        supabase.from('professional_branches').select('*').eq('organization_id', orgId),
        supabase
          .from('user_profiles')
          .select('*')
          .eq('organization_id', orgId)
          .order('created_at', { ascending: true }),
        supabase.from('user_branch_access').select('*').eq('organization_id', orgId),
        supabase.from('user_menu_permissions').select('*').eq('organization_id', orgId),
        supabase
          .from('role_permissions')
          .select('*')
          .or(`organization_id.is.null,organization_id.eq.${orgId}`),
        supabase
          .from('audit_logs')
          .select('*')
          .eq('organization_id', orgId)
          .order('created_at', { ascending: false })
          .limit(50),
      ]);

      const branches = (branchesRes.data || []).map((r) => mapBranchRow(r as Record<string, unknown>));
      const specialties: Specialty[] = (specsRes.data || []).map((row) => {
        const r = row as Record<string, unknown>;
        return {
          id: String(r.id),
          organizationId: String(r.organization_id),
          name: String(r.name || ''),
          councilType: (r.council_type as Specialty['councilType']) || 'CRM',
          description: r.description ? String(r.description) : undefined,
          isActive: r.is_active !== false,
        };
      });

      const profBranchRows = (profBranchesRes.data || []) as Array<Record<string, unknown>>;
      const professionals: Professional[] = (profsRes.data || []).map((row) => {
        const r = row as Record<string, unknown>;
        const profId = String(r.id);
        const linkedBranchIds = profBranchRows
          .filter((pb) => String(pb.professional_id) === profId)
          .map((pb) => String(pb.branch_id));
        const spec = specialties.find((s) => s.id === String(r.specialty_id || ''));

        return {
          id: profId,
          organizationId: String(r.organization_id),
          userProfileId: r.user_profile_id ? String(r.user_profile_id) : undefined,
          fullName: String(r.full_name || ''),
          councilNumber: String(r.council_number || ''),
          specialtyId: String(r.specialty_id || specialties[0]?.id || ''),
          specialtyName: spec?.name,
          branchIds:
            linkedBranchIds.length > 0
              ? linkedBranchIds
              : branches[0]?.id
              ? [branches[0].id]
              : [],
          phone: String(r.phone || ''),
          email: String(r.email || ''),
          bio: String(r.bio || ''),
          color: String(r.color || '#0284c7'),
          avatarUrl: r.avatar_url ? String(r.avatar_url) : undefined,
          isActive: r.is_active !== false,
          createdAt: r.created_at ? String(r.created_at) : undefined,
          updatedAt: r.updated_at ? String(r.updated_at) : undefined,
        };
      });

      const userBranchRows = (userBranchesRes.data || []) as Array<Record<string, unknown>>;
      const userPermRows = (userMenuPermsRes.data || []) as Array<Record<string, unknown>>;
      const users: UserProfile[] = (usersRes.data || []).map((row) => {
        const r = row as Record<string, unknown>;
        const pid = String(r.id);
        const authBranches = userBranchRows
          .filter((ub) => String(ub.user_profile_id) === pid)
          .map((ub) => String(ub.branch_id));
        const perms = userPermRows.filter((up) => String(up.user_profile_id) === pid);
        return mapUserProfileRow(r, authBranches, perms);
      });

      const roleTemplates =
        rolePermsRes.data && rolePermsRes.data.length > 0
          ? buildRoleTemplatesFromRows(rolePermsRes.data as Array<Record<string, unknown>>)
          : localRoleTemplates;

      const auditLogs: AuditLog[] = (auditRes.data || []).map((row) => {
        const r = row as Record<string, unknown>;
        const detailsObj =
          r.details && typeof r.details === 'object'
            ? JSON.stringify(r.details)
            : String(r.details || '');
        const actorName =
          r.details &&
          typeof r.details === 'object' &&
          (r.details as Record<string, unknown>).actor_name
            ? String((r.details as Record<string, unknown>).actor_name)
            : String(r.user_role || 'Sistema');
        return {
          id: String(r.id),
          organizationId: String(r.organization_id),
          userId: String(r.user_id || ''),
          userName: actorName,
          userRole: String(r.user_role || ''),
          action: String(r.action || ''),
          entity: String(r.entity || ''),
          entityId: r.entity_id ? String(r.entity_id) : undefined,
          details: detailsObj,
          timestamp: String(r.created_at || new Date().toISOString()),
        };
      });

      // Atualiza cache em memória/localStorage para manter outros módulos síncronos (Agenda, PEP) com os UUIDs reais
      if (organization) StorageService.updateOrganizationCache(organization);
      if (branches.length > 0) StorageService.replaceBranchesCache(branches);
      if (specialties.length > 0) StorageService.replaceSpecialtiesCache(specialties);
      if (professionals.length > 0) StorageService.replaceProfessionalsCache(professionals);
      if (users.length > 0) StorageService.replaceUsersCache(users);
      StorageService.saveRolePermissions(roleTemplates);

      return {
        source: 'cloud',
        organizationId: orgId,
        organization,
        branches,
        specialties,
        professionals,
        users,
        roleTemplates,
        auditLogs,
      };
    } catch (err) {
      return {
        ...localResult,
        error: formatPgError(err, 'Erro ao carregar equipe e permissões do servidor.'),
      };
    }
  },

  async saveProfessionalToCloud(input: {
    id?: string;
    organizationId: string;
    userProfileId?: string;
    fullName: string;
    councilNumber: string;
    specialtyId: string;
    specialtyName?: string;
    branchIds: string[];
    phone: string;
    email: string;
    bio: string;
    color?: string;
    isActive: boolean;
  }): Promise<{ success: boolean; professional?: Professional; error?: string }> {
    const supabase = getSupabase();
    if (!supabase) {
      return {
        success: false,
        error: 'Conexão com o banco de dados não configurada neste ambiente.',
      };
    }

    const { orgId, error: orgErr } = await resolveOrganizationUuid(supabase, input.organizationId);
    if (!orgId) {
      return { success: false, error: orgErr || 'Organização não encontrada.' };
    }

    const normalizedCouncil = input.councilNumber.trim();
    if (!input.fullName.trim() || !normalizedCouncil) {
      return { success: false, error: 'Nome completo e número do conselho são obrigatórios.' };
    }

    // Impedir duplicidade de registro no conselho na mesma organização
    const { data: existingCouncil } = await supabase
      .from('professionals')
      .select('id, full_name, council_number')
      .eq('organization_id', orgId)
      .ilike('council_number', normalizedCouncil);

    const conflict = (existingCouncil || []).find((p) => String(p.id) !== input.id);
    if (conflict) {
      return {
        success: false,
        error: `Já existe um profissional cadastrado com o registro ${normalizedCouncil} (${conflict.full_name}).`,
      };
    }

    const resolvedSpecId = isUuid(input.specialtyId) ? input.specialtyId : null;
    const validBranchIds = input.branchIds.filter(isUuid);

    const dbPayload = {
      organization_id: orgId,
      user_profile_id: isUuid(input.userProfileId) ? input.userProfileId : null,
      full_name: input.fullName.trim(),
      council_number: normalizedCouncil,
      specialty_id: resolvedSpecId,
      phone: input.phone.trim() || null,
      email: input.email.trim().toLowerCase() || null,
      bio: input.bio.trim() || null,
      color: input.color || '#0284c7',
      is_active: input.isActive,
      updated_at: new Date().toISOString(),
    };

    try {
      let savedRow: Record<string, unknown> | null = null;
      if (isUuid(input.id)) {
        const { data, error } = await supabase
          .from('professionals')
          .update(dbPayload)
          .eq('id', input.id)
          .eq('organization_id', orgId)
          .select('*')
          .single();
        if (error) {
          return { success: false, error: formatPgError(error, 'Falha ao atualizar profissional.') };
        }
        savedRow = data as Record<string, unknown>;
      } else {
        const { data, error } = await supabase
          .from('professionals')
          .insert(dbPayload)
          .select('*')
          .single();
        if (error) {
          return { success: false, error: formatPgError(error, 'Falha ao cadastrar profissional.') };
        }
        savedRow = data as Record<string, unknown>;
      }

      const profId = String(savedRow.id);

      // Sincronizar filiais vinculadas (professional_branches)
      const { error: delErr } = await supabase
        .from('professional_branches')
        .delete()
        .eq('professional_id', profId);

      if (delErr) {
        return {
          success: false,
          error: formatPgError(delErr, 'Profissional salvo, mas houve erro ao atualizar vínculos de filial.'),
        };
      }

      if (validBranchIds.length > 0) {
        const { error: insErr } = await supabase.from('professional_branches').insert(
          validBranchIds.map((bid) => ({
            organization_id: orgId,
            professional_id: profId,
            branch_id: bid,
          }))
        );
        if (insErr) {
          return {
            success: false,
            error: formatPgError(insErr, 'Erro ao vincular filiais ao profissional.'),
          };
        }
      }

      const professional: Professional = {
        id: profId,
        organizationId: orgId,
        userProfileId: savedRow.user_profile_id ? String(savedRow.user_profile_id) : undefined,
        fullName: String(savedRow.full_name),
        councilNumber: String(savedRow.council_number),
        specialtyId: String(savedRow.specialty_id || input.specialtyId),
        specialtyName: input.specialtyName,
        branchIds: validBranchIds,
        phone: String(savedRow.phone || ''),
        email: String(savedRow.email || ''),
        bio: String(savedRow.bio || ''),
        color: String(savedRow.color || '#0284c7'),
        isActive: savedRow.is_active !== false,
        createdAt: savedRow.created_at ? String(savedRow.created_at) : undefined,
        updatedAt: savedRow.updated_at ? String(savedRow.updated_at) : undefined,
      };

      StorageService.saveProfessional(professional);
      return { success: true, professional };
    } catch (err) {
      return { success: false, error: formatPgError(err, 'Erro ao salvar profissional no banco de dados.') };
    }
  },

  async toggleProfessionalActiveInCloud(
    professionalId: string,
    organizationId: string,
    isActive: boolean
  ): Promise<{ success: boolean; error?: string }> {
    const supabase = getSupabase();
    if (!supabase || !isUuid(professionalId)) {
      return { success: false, error: 'Profissional inválido ou banco de dados não conectado.' };
    }

    const { error } = await supabase
      .from('professionals')
      .update({ is_active: isActive, updated_at: new Date().toISOString() })
      .eq('id', professionalId)
      .eq('organization_id', organizationId);

    if (error) {
      return { success: false, error: formatPgError(error, 'Erro ao atualizar status do profissional.') };
    }
    return { success: true };
  },

  async createUserViaAdminFunction(payload: {
    organizationId: string;
    fullName: string;
    email: string;
    phone: string;
    role: UserRole;
    defaultBranchId?: string | null;
    authorizedBranchIds: string[];
    isActive: boolean;
    authMode: 'invite' | 'password';
    password?: string;
    professionalId?: string | null;
    menuPermissions: UserMenuPermissionRecord[];
  }): Promise<{ success: boolean; error?: string; authMode?: string; reusedExistingAuth?: boolean }> {
    const supabase = getSupabase();
    if (!supabase) {
      return { success: false, error: 'Conexão com o servidor indisponível neste ambiente.' };
    }

    const { orgId, error: orgErr } = await resolveOrganizationUuid(supabase, payload.organizationId);
    if (!orgId) {
      return { success: false, error: orgErr || 'Organização não localizada.' };
    }

    const res = await invokeAdminEdgeFunction<{
      success?: boolean;
      authMode?: string;
      reusedExistingAuth?: boolean;
    }>(supabase, {
      action: 'create_user',
      organizationId: orgId,
      fullName: payload.fullName.trim(),
      email: payload.email.trim().toLowerCase(),
      phone: payload.phone.trim(),
      role: payload.role,
      defaultBranchId: isUuid(payload.defaultBranchId) ? payload.defaultBranchId : null,
      authorizedBranchIds: payload.authorizedBranchIds.filter(isUuid),
      isActive: payload.isActive,
      authMode: payload.authMode,
      password: payload.password || '',
      professionalId: isUuid(payload.professionalId) ? payload.professionalId : null,
      menuPermissions: payload.menuPermissions,
    });

    if (res.error) {
      return { success: false, error: res.error };
    }
    return {
      success: true,
      authMode: res.data?.authMode || payload.authMode,
      reusedExistingAuth: Boolean(res.data?.reusedExistingAuth),
    };
  },

  async saveUserAndPermissionsToCloud(payload: {
    targetProfileId: string;
    fullName: string;
    phone: string;
    role: UserRole;
    defaultBranchId?: string | null;
    authorizedBranchIds: string[];
    isActive: boolean;
    previousIsActive: boolean;
    menuPermissions: UserMenuPermissionRecord[];
  }): Promise<{ success: boolean; error?: string; warning?: string }> {
    const supabase = getSupabase();
    if (!supabase || !isUuid(payload.targetProfileId)) {
      return { success: false, error: 'Usuário inválido ou conexão com o servidor indisponível.' };
    }

    const { error } = await supabase.rpc('medsync_save_user_rbac', {
      p_target_profile_id: payload.targetProfileId,
      p_full_name: payload.fullName.trim(),
      p_phone: payload.phone.trim(),
      p_role_code: payload.role,
      p_default_branch_id: isUuid(payload.defaultBranchId) ? payload.defaultBranchId : null,
      p_is_active: payload.isActive,
      p_authorized_branch_ids: payload.authorizedBranchIds.filter(isUuid),
      p_menu_permissions: payload.menuPermissions,
    });

    if (error) {
      return {
        success: false,
        error: formatPgError(error, 'Falha ao salvar alterações do usuário e permissões.'),
      };
    }

    let warning: string | undefined;
    if (payload.isActive !== payload.previousIsActive) {
      const authRes = await invokeAdminEdgeFunction(supabase, {
        action: 'sync_auth_user_status',
        targetProfileId: payload.targetProfileId,
        isActive: payload.isActive,
      });
      if (authRes.error) {
        warning = `Perfil atualizado, mas a sincronização de bloqueio retornou aviso: ${authRes.error}`;
      }
    }

    return { success: true, warning };
  },

  async saveRolePermissionsToCloud(
    organizationId: string,
    roleCode: UserRole,
    permissions: RolePermissionTemplate
  ): Promise<{ success: boolean; error?: string }> {
    const supabase = getSupabase();
    if (!supabase) {
      return { success: false, error: 'Conexão com o servidor indisponível neste ambiente.' };
    }

    const { orgId, error: orgErr } = await resolveOrganizationUuid(supabase, organizationId);
    if (!orgId) {
      return { success: false, error: orgErr || 'Organização não localizada.' };
    }

    const permArray = MENU_DEFINITIONS.map((def) => {
      const set: MenuPermissionSet = permissions[def.key] || DEFAULT_ROLE_PERMISSIONS[roleCode][def.key];
      return {
        menuKey: def.key,
        canView: Boolean(set.canView),
        canConsult: Boolean(set.canConsult),
        canCreate: Boolean(set.canCreate),
        canEdit: Boolean(set.canEdit),
        canDelete: Boolean(def.supportsDelete && set.canDelete),
        canAdmin: Boolean(def.supportsAdmin && set.canAdmin),
      };
    });

    const { error } = await supabase.rpc('medsync_save_role_permissions', {
      p_organization_id: orgId,
      p_role_code: roleCode,
      p_permissions: permArray,
    });

    if (error) {
      return {
        success: false,
        error: formatPgError(error, 'Não foi possível salvar o modelo de permissões do papel.'),
      };
    }

    return { success: true };
  },

  async resendUserAccessLink(
    targetProfileId: string,
    email: string,
    mode: 'invite' | 'recovery'
  ): Promise<{ success: boolean; deliveredMode?: string; error?: string }> {
    const supabase = getSupabase();
    if (!supabase) {
      return { success: false, error: 'Conexão com o servidor indisponível neste ambiente.' };
    }

    if (isUuid(targetProfileId)) {
      const fnRes = await invokeAdminEdgeFunction<{ deliveredMode?: string }>(supabase, {
        action: 'resend_invite_or_recovery',
        targetProfileId,
        mode,
      });
      if (!fnRes.error) {
        return { success: true, deliveredMode: fnRes.data?.deliveredMode || mode };
      }
      if (mode === 'invite') {
        return { success: false, error: fnRes.error };
      }
    }

    if (mode === 'recovery') {
      const redirectTo = typeof window !== 'undefined' ? window.location.origin : undefined;
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
        redirectTo,
      });
      if (error) {
        return { success: false, error: error.message };
      }
      return { success: true, deliveredMode: 'recovery' };
    }

    return {
      success: false,
      error: 'Não foi possível reenviar o convite no momento. Tente novamente em instantes.',
    };
  },

  async auditSuperAdminAccount(): Promise<{
    success: boolean;
    candidateCount?: number;
    candidates?: SuperAdminCandidateInfo[];
    error?: string;
  }> {
    const supabase = getSupabase();
    if (!supabase) {
      return { success: false, error: 'Conexão com o servidor indisponível neste ambiente.' };
    }

    const res = await invokeAdminEdgeFunction<{
      success: boolean;
      candidateCount: number;
      candidates: SuperAdminCandidateInfo[];
    }>(supabase, { action: 'audit_super_admin_email' });

    if (res.error) {
      return { success: false, error: res.error };
    }
    return {
      success: true,
      candidateCount: res.data?.candidateCount ?? 0,
      candidates: res.data?.candidates ?? [],
    };
  },

  async updateSuperAdminEmailInCloud(
    newEmail: string,
    requireEmailConfirmation = false
  ): Promise<{
    success: boolean;
    previousEmail?: string;
    newEmail?: string;
    authUserId?: string;
    profileId?: string;
    pendingConfirmation?: boolean;
    ambiguous?: boolean;
    candidates?: SuperAdminCandidateInfo[];
    error?: string;
  }> {
    const supabase = getSupabase();
    if (!supabase) {
      return { success: false, error: 'Conexão com o servidor indisponível neste ambiente.' };
    }

    const res = await invokeAdminEdgeFunction<{
      success: boolean;
      previousEmail?: string;
      newEmail?: string;
      authUserId?: string;
      profileId?: string;
      pendingConfirmation?: boolean;
      ambiguous?: boolean;
      candidates?: SuperAdminCandidateInfo[];
    }>(supabase, {
      action: 'update_super_admin_email',
      newEmail: newEmail.trim().toLowerCase(),
      requireEmailConfirmation,
    });

    if (res.error) {
      return {
        success: false,
        ambiguous: res.data?.ambiguous,
        candidates: res.data?.candidates,
        error: res.error,
      };
    }

    return {
      success: true,
      previousEmail: res.data?.previousEmail,
      newEmail: res.data?.newEmail,
      authUserId: res.data?.authUserId,
      profileId: res.data?.profileId,
      pendingConfirmation: res.data?.pendingConfirmation,
    };
  },
};
