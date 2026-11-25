import {
  MenuKey,
  MenuPermissionSet,
  RolePermissionTemplate,
  UserMenuPermissionRecord,
  UserRole,
} from '../types';

export type PermissionAction =
  | 'canView'
  | 'canConsult'
  | 'canCreate'
  | 'canEdit'
  | 'canDelete'
  | 'canAdmin';

export interface MenuDefinition {
  key: MenuKey;
  label: string;
  description: string;
  supportsDelete: boolean;
  supportsAdmin: boolean;
  sensitiveClinical?: boolean;
}

export const MENU_DEFINITIONS: MenuDefinition[] = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    description: 'Visão operacional da clínica, indicadores do dia e fila de atendimento.',
    supportsDelete: false,
    supportsAdmin: false,
  },
  {
    key: 'appointments',
    label: 'Agenda de Consultas',
    description: 'Agendamentos, confirmações, sala de espera e lista de espera.',
    supportsDelete: true,
    supportsAdmin: true,
  },
  {
    key: 'call_panel',
    label: 'Painel de Chamada',
    description: 'Chamada visual e sonora de pacientes, controle de atendimentos e tempos em sala.',
    supportsDelete: true,
    supportsAdmin: true,
  },
  {
    key: 'patients',
    label: 'Gestão de Pacientes',
    description: 'Cadastro completo, dados administrativos, convênios e consentimento LGPD.',
    supportsDelete: false,
    supportsAdmin: true,
  },
  {
    key: 'medical_records',
    label: 'Prontuário Eletrônico',
    description: 'Evoluções SOAP, receitas, atestados, pedidos de exames, laudos e anexos.',
    supportsDelete: false,
    supportsAdmin: true,
    sensitiveClinical: true,
  },
  {
    key: 'communication',
    label: 'Central WhatsApp',
    description: 'Modelos de mensagens, disparos, histórico e automações inteligentes.',
    supportsDelete: true,
    supportsAdmin: true,
  },
  {
    key: 'financial',
    label: 'Módulo Financeiro',
    description: 'Contas a receber, contas a pagar, categorias, recibos e exportação Excel.',
    supportsDelete: true,
    supportsAdmin: true,
  },
  {
    key: 'users',
    label: 'Equipe & Permissões',
    description: 'Profissionais de saúde, usuários do sistema, papéis e permissões individuais.',
    supportsDelete: false,
    supportsAdmin: true,
  },
  {
    key: 'settings',
    label: 'Clínica & Filiais',
    description: 'Dados institucionais, CNPJ, filiais, consultórios e integrações.',
    supportsDelete: false,
    supportsAdmin: true,
  },
  {
    key: 'website_builder',
    label: 'Site Institucional',
    description: 'Editor visual do site público e identidade digital da clínica.',
    supportsDelete: false,
    supportsAdmin: true,
  },
];

export interface RoleMetadata {
  code: UserRole;
  label: string;
  shortLabel: string;
  description: string;
  rank: number;
  badgeClass: string;
}

export const ROLE_METADATA: Record<UserRole, RoleMetadata> = {
  super_admin: {
    code: 'super_admin',
    label: 'Super Administrador (SaaS)',
    shortLabel: 'Super Admin',
    description: 'Administração geral da plataforma SaaS, organizações, planos e suporte.',
    rank: 100,
    badgeClass: 'bg-purple-50 text-purple-700 border-purple-200',
  },
  clinic_admin: {
    code: 'clinic_admin',
    label: 'Administrador da Clínica',
    shortLabel: 'Admin Clínica',
    description: 'Gestão operacional da organização, usuários, permissões e filiais.',
    rank: 80,
    badgeClass: 'bg-sky-50 text-sky-700 border-sky-200',
  },
  branch_admin: {
    code: 'branch_admin',
    label: 'Administrador de Filial',
    shortLabel: 'Admin Filial',
    description: 'Gestão operacional restrita às filiais autorizadas.',
    rank: 60,
    badgeClass: 'bg-teal-50 text-teal-700 border-teal-200',
  },
  doctor: {
    code: 'doctor',
    label: 'Médico(a)',
    shortLabel: 'Médico',
    description: 'Agenda, pacientes autorizados, prontuário eletrônico e documentos clínicos.',
    rank: 50,
    badgeClass: 'bg-blue-50 text-blue-700 border-blue-200',
  },
  physiotherapist: {
    code: 'physiotherapist',
    label: 'Fisioterapeuta / Especialista',
    shortLabel: 'Fisioterapeuta',
    description: 'Agenda, pacientes autorizados e evoluções clínicas dentro das atribuições.',
    rank: 40,
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  receptionist: {
    code: 'receptionist',
    label: 'Recepção / Secretaria',
    shortLabel: 'Recepção',
    description: 'Agenda, cadastro de pacientes e atendimento administrativo sem acesso clínico restrito.',
    rank: 30,
    badgeClass: 'bg-amber-50 text-amber-700 border-amber-200',
  },
  financial: {
    code: 'financial',
    label: 'Financeiro',
    shortLabel: 'Financeiro',
    description: 'Acesso preservado ao módulo financeiro sem permissões clínicas ou administrativas.',
    rank: 20,
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  patient: {
    code: 'patient',
    label: 'Paciente (Portal)',
    shortLabel: 'Paciente',
    description: 'Acesso exclusivo ao portal do paciente, sem acesso aos menus internos da clínica.',
    rank: 10,
    badgeClass: 'bg-slate-100 text-slate-700 border-slate-200',
  },
};

export const ALL_USER_ROLES: UserRole[] = [
  'super_admin',
  'clinic_admin',
  'branch_admin',
  'doctor',
  'physiotherapist',
  'receptionist',
  'financial',
  'patient',
];

const NONE: MenuPermissionSet = {
  canView: false,
  canConsult: false,
  canCreate: false,
  canEdit: false,
  canDelete: false,
  canAdmin: false,
};

const perm = (partial: Partial<MenuPermissionSet>): MenuPermissionSet => ({
  ...NONE,
  ...partial,
});

const FULL_ACCESS: MenuPermissionSet = {
  canView: true,
  canConsult: true,
  canCreate: true,
  canEdit: true,
  canDelete: true,
  canAdmin: true,
};

export const DEFAULT_ROLE_PERMISSIONS: Record<UserRole, RolePermissionTemplate> = {
  super_admin: {
    dashboard: perm({ canView: true, canConsult: true, canCreate: true, canEdit: true }),
    appointments: FULL_ACCESS,
    call_panel: FULL_ACCESS,
    patients: perm({ canView: true, canConsult: true, canCreate: true, canEdit: true, canAdmin: true }),
    medical_records: perm({ canView: true, canConsult: true, canAdmin: true }),
    communication: FULL_ACCESS,
    financial: perm({ canView: true, canConsult: true, canCreate: true, canEdit: true, canAdmin: true }),
    users: FULL_ACCESS,
    settings: FULL_ACCESS,
    website_builder: FULL_ACCESS,
  },
  clinic_admin: {
    dashboard: perm({ canView: true, canConsult: true, canCreate: true, canEdit: true }),
    appointments: FULL_ACCESS,
    call_panel: FULL_ACCESS,
    patients: perm({ canView: true, canConsult: true, canCreate: true, canEdit: true, canAdmin: true }),
    medical_records: perm({ canView: true, canConsult: true }),
    communication: FULL_ACCESS,
    financial: perm({ canView: true, canConsult: true, canCreate: true, canEdit: true, canAdmin: true }),
    users: perm({ canView: true, canConsult: true, canCreate: true, canEdit: true, canAdmin: true }),
    settings: perm({ canView: true, canConsult: true, canCreate: true, canEdit: true, canAdmin: true }),
    website_builder: perm({ canView: true, canConsult: true, canCreate: true, canEdit: true, canAdmin: true }),
  },
  branch_admin: {
    dashboard: perm({ canView: true, canConsult: true, canCreate: true, canEdit: true }),
    appointments: perm({ canView: true, canConsult: true, canCreate: true, canEdit: true, canDelete: true }),
    call_panel: perm({ canView: true, canConsult: true, canCreate: true, canEdit: true }),
    patients: perm({ canView: true, canConsult: true, canCreate: true, canEdit: true }),
    medical_records: perm({ canView: false, canConsult: false }),
    communication: perm({ canView: true, canConsult: true, canCreate: true, canEdit: true }),
    financial: perm({ canView: true, canConsult: true, canCreate: true }),
    users: perm({ canView: true, canConsult: true, canCreate: true, canEdit: true }),
    settings: perm({ canView: false, canConsult: false }),
    website_builder: perm({ canView: false, canConsult: false }),
  },
  doctor: {
    dashboard: perm({ canView: true, canConsult: true, canEdit: true }),
    appointments: perm({ canView: true, canConsult: true, canCreate: true, canEdit: true }),
    call_panel: perm({ canView: true, canConsult: true, canCreate: true, canEdit: true }),
    patients: perm({ canView: true, canConsult: true, canCreate: true, canEdit: true }),
    medical_records: perm({ canView: true, canConsult: true, canCreate: true, canEdit: true }),
    communication: perm({ canView: true, canConsult: true }),
    financial: NONE,
    users: NONE,
    settings: NONE,
    website_builder: NONE,
  },
  physiotherapist: {
    dashboard: perm({ canView: true, canConsult: true, canEdit: true }),
    appointments: perm({ canView: true, canConsult: true, canCreate: true, canEdit: true }),
    call_panel: perm({ canView: true, canConsult: true, canCreate: true, canEdit: true }),
    patients: perm({ canView: true, canConsult: true, canCreate: true, canEdit: true }),
    medical_records: perm({ canView: true, canConsult: true, canCreate: true, canEdit: true }),
    communication: perm({ canView: true, canConsult: true }),
    financial: NONE,
    users: NONE,
    settings: NONE,
    website_builder: NONE,
  },
  receptionist: {
    dashboard: perm({ canView: true, canConsult: true, canEdit: true }),
    appointments: perm({ canView: true, canConsult: true, canCreate: true, canEdit: true }),
    call_panel: perm({ canView: true, canConsult: true, canCreate: true, canEdit: true }),
    patients: perm({ canView: true, canConsult: true, canCreate: true, canEdit: true }),
    medical_records: NONE,
    communication: perm({ canView: true, canConsult: true, canCreate: true }),
    financial: NONE,
    users: NONE,
    settings: NONE,
    website_builder: NONE,
  },
  financial: {
    dashboard: perm({ canView: true, canConsult: true }),
    appointments: perm({ canView: false, canConsult: false }),
    call_panel: NONE,
    patients: perm({ canView: false, canConsult: false }),
    medical_records: NONE,
    communication: NONE,
    financial: perm({ canView: true, canConsult: true, canCreate: true, canEdit: true, canAdmin: true }),
    users: NONE,
    settings: NONE,
    website_builder: NONE,
  },
  patient: {
    dashboard: NONE,
    appointments: NONE,
    call_panel: NONE,
    patients: NONE,
    medical_records: NONE,
    communication: NONE,
    financial: NONE,
    users: NONE,
    settings: NONE,
    website_builder: NONE,
  },
};

export function buildEmptyPermissionsMap(): Record<MenuKey, UserMenuPermissionRecord> {
  const result = {} as Record<MenuKey, UserMenuPermissionRecord>;
  for (const def of MENU_DEFINITIONS) {
    result[def.key] = {
      menuKey: def.key,
      ...NONE,
      isCustomOverride: false,
    };
  }
  return result;
}

export function resolveEffectivePermissions(
  role: UserRole,
  roleTemplates?: Partial<Record<UserRole, RolePermissionTemplate>>,
  userOverrides?: Partial<Record<MenuKey, UserMenuPermissionRecord>>
): Record<MenuKey, UserMenuPermissionRecord> {
  const baseTemplate = roleTemplates?.[role] || DEFAULT_ROLE_PERMISSIONS[role] || DEFAULT_ROLE_PERMISSIONS.patient;
  const result = {} as Record<MenuKey, UserMenuPermissionRecord>;

  for (const def of MENU_DEFINITIONS) {
    const baseSet = baseTemplate[def.key] || NONE;
    const override = userOverrides?.[def.key];

    if (override && override.isCustomOverride) {
      result[def.key] = {
        menuKey: def.key,
        canView: Boolean(override.canView),
        canConsult: Boolean(override.canConsult),
        canCreate: Boolean(override.canCreate),
        canEdit: Boolean(override.canEdit),
        canDelete: def.supportsDelete ? Boolean(override.canDelete) : false,
        canAdmin: def.supportsAdmin ? Boolean(override.canAdmin) : false,
        isCustomOverride: true,
      };
    } else {
      result[def.key] = {
        menuKey: def.key,
        canView: Boolean(baseSet.canView),
        canConsult: Boolean(baseSet.canConsult),
        canCreate: Boolean(baseSet.canCreate),
        canEdit: Boolean(baseSet.canEdit),
        canDelete: def.supportsDelete ? Boolean(baseSet.canDelete) : false,
        canAdmin: def.supportsAdmin ? Boolean(baseSet.canAdmin) : false,
        isCustomOverride: false,
      };
    }
  }

  // Salvaguarda arquitetural: Super Admin nunca perde acesso administrativo ao SaaS e equipe
  if (role === 'super_admin') {
    result.dashboard = {
      ...result.dashboard,
      canView: true,
      canConsult: true,
    };
    result.users = {
      ...result.users,
      canView: true,
      canConsult: true,
      canCreate: true,
      canEdit: true,
      canAdmin: true,
    };
    result.settings = {
      ...result.settings,
      canView: true,
      canConsult: true,
      canCreate: true,
      canEdit: true,
      canAdmin: true,
    };
  }

  return result;
}

/**
 * Ao alterar o papel de um usuário, aplica as permissões padrão do novo papel
 * preservando apenas as exceções individuais explicitamente configuradas (isCustomOverride === true).
 */
export function applyRoleChangePreservingOverrides(
  newRole: UserRole,
  currentPermissions: Partial<Record<MenuKey, UserMenuPermissionRecord>> | undefined,
  roleTemplates?: Partial<Record<UserRole, RolePermissionTemplate>>
): Record<MenuKey, UserMenuPermissionRecord> {
  const newTemplate = roleTemplates?.[newRole] || DEFAULT_ROLE_PERMISSIONS[newRole];
  const next = {} as Record<MenuKey, UserMenuPermissionRecord>;

  for (const def of MENU_DEFINITIONS) {
    const existing = currentPermissions?.[def.key];
    if (existing?.isCustomOverride) {
      next[def.key] = {
        ...existing,
        menuKey: def.key,
        isCustomOverride: true,
      };
    } else {
      const baseSet = newTemplate[def.key] || NONE;
      next[def.key] = {
        menuKey: def.key,
        canView: Boolean(baseSet.canView),
        canConsult: Boolean(baseSet.canConsult),
        canCreate: Boolean(baseSet.canCreate),
        canEdit: Boolean(baseSet.canEdit),
        canDelete: def.supportsDelete ? Boolean(baseSet.canDelete) : false,
        canAdmin: def.supportsAdmin ? Boolean(baseSet.canAdmin) : false,
        isCustomOverride: false,
      };
    }
  }

  return resolveEffectivePermissions(newRole, roleTemplates, next);
}

export function canActorAssignRole(actorRole: UserRole, targetRole: UserRole): boolean {
  if (actorRole === 'super_admin') return true;
  if (actorRole === 'clinic_admin') return targetRole !== 'super_admin';
  if (actorRole === 'branch_admin') {
    return (
      targetRole !== 'super_admin' &&
      targetRole !== 'clinic_admin' &&
      targetRole !== 'branch_admin'
    );
  }
  return false;
}

export function sanitizePermissionsForActor(
  actorRole: UserRole,
  actorEffectivePermissions: Record<MenuKey, UserMenuPermissionRecord>,
  targetPermissions: Record<MenuKey, UserMenuPermissionRecord>
): Record<MenuKey, UserMenuPermissionRecord> {
  if (actorRole === 'super_admin') {
    return targetPermissions;
  }

  const sanitized = {} as Record<MenuKey, UserMenuPermissionRecord>;
  for (const def of MENU_DEFINITIONS) {
    const target = targetPermissions[def.key];
    const actorCap = actorEffectivePermissions[def.key];
    sanitized[def.key] = {
      menuKey: def.key,
      canView: Boolean(target.canView && actorCap.canView),
      canConsult: Boolean(target.canConsult && actorCap.canConsult),
      canCreate: Boolean(target.canCreate && actorCap.canCreate),
      canEdit: Boolean(target.canEdit && actorCap.canEdit),
      canDelete: Boolean(def.supportsDelete && target.canDelete && actorCap.canDelete),
      canAdmin: Boolean(def.supportsAdmin && target.canAdmin && actorCap.canAdmin),
      isCustomOverride: Boolean(target.isCustomOverride),
    };
  }
  return sanitized;
}
