import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  UserCog,
  Stethoscope,
  Plus,
  Building2,
  ShieldCheck,
  Mail,
  Activity,
  MapPin,
  Check,
  Search,
  Edit,
  Eye,
  KeyRound,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Sliders,
  Users,
  Lock,
  Power,
  Send,
  RotateCcw,
  X,
  Loader2,
} from 'lucide-react';
import {
  AuditLog,
  MenuKey,
  MenuPermissionSet,
  Professional,
  RolePermissionTemplate,
  UserMenuPermissionRecord,
  UserProfile,
  UserRole,
} from '../../types';
import { StorageService } from '../../services/storage';
import { useTenant } from '../../contexts/TenantContext';
import { useAuth } from '../../contexts/AuthContext';
import {
  ALL_USER_ROLES,
  DEFAULT_ROLE_PERMISSIONS,
  MENU_DEFINITIONS,
  PermissionAction,
  ROLE_METADATA,
  applyRoleChangePreservingOverrides,
  canActorAssignRole,
  resolveEffectivePermissions,
  sanitizePermissionsForActor,
} from '../../services/rbacConfig';
import { TeamCloudService, isUuid } from '../../services/teamCloudService';

type TeamTab =
  | 'overview'
  | 'professionals'
  | 'users'
  | 'roles_permissions'
  | 'branches_links';

const PERM_COLUMNS: Array<{ key: PermissionAction; label: string; short: string }> = [
  { key: 'canView', label: 'Visualizar', short: 'Ver' },
  { key: 'canConsult', label: 'Consultar', short: 'Cons.' },
  { key: 'canCreate', label: 'Incluir', short: 'Incl.' },
  { key: 'canEdit', label: 'Editar', short: 'Edit.' },
  { key: 'canDelete', label: 'Excluir', short: 'Excl.' },
  { key: 'canAdmin', label: 'Administrar', short: 'Adm.' },
];

export const TeamManagement: React.FC = () => {
  const { organization, branches } = useTenant();
  const {
    currentUser,
    currentRole,
    effectivePermissions: actorEffectivePermissions,
    isSupabaseAuthMode,
    isDevSimulationMode,
    canCreateInMenu,
    canEditInMenu,
    canAdminMenu,
    refreshSessionProfile,
  } = useAuth();

  const [activeTab, setActiveTab] = useState<TeamTab>('users');
  const [cloudOrgId, setCloudOrgId] = useState<string>(organization.id);
  const [professionals, setProfessionals] = useState<Professional[]>(() =>
    StorageService.getProfessionals()
  );
  const [users, setUsers] = useState<UserProfile[]>(() => StorageService.getUsers());
  const [specialties, setSpecialties] = useState(() => StorageService.getSpecialties());
  const [roleTemplates, setRoleTemplates] = useState<Record<UserRole, RolePermissionTemplate>>(() =>
    StorageService.getRolePermissions()
  );
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>(() => StorageService.getAuditLogs());

  const [isLoadingCloud, setIsLoadingCloud] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [feedbackSuccess, setFeedbackSuccess] = useState<string | null>(null);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);

  // Filtros - Profissionais
  const [profSearch, setProfSearch] = useState('');
  const [profBranchFilter, setProfBranchFilter] = useState<string>('all');
  const [profStatusFilter, setProfStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  // Filtros - Usuários
  const [userSearch, setUserSearch] = useState('');
  const [userRoleFilter, setUserRoleFilter] = useState<string>('all');
  const [userBranchFilter, setUserBranchFilter] = useState<string>('all');
  const [userStatusFilter, setUserStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  // Modal Profissional (Criar / Editar)
  const [profModalOpen, setProfModalOpen] = useState(false);
  const [editingProfId, setEditingProfId] = useState<string | null>(null);
  const [profName, setProfName] = useState('');
  const [profCouncil, setProfCouncil] = useState('');
  const [profSpecialtyId, setProfSpecialtyId] = useState('');
  const [profPhone, setProfPhone] = useState('');
  const [profEmail, setProfEmail] = useState('');
  const [profBio, setProfBio] = useState('');
  const [profBranchIds, setProfBranchIds] = useState<string[]>([]);
  const [profLinkedUserId, setProfLinkedUserId] = useState<string>('');
  const [profIsActive, setProfIsActive] = useState(true);
  const [viewingProfessional, setViewingProfessional] = useState<Professional | null>(null);

  // Modal Criar Usuário
  const [createUserModalOpen, setCreateUserModalOpen] = useState(false);
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPhone, setNewUserPhone] = useState('');
  const [newUserRole, setNewUserRole] = useState<UserRole>('receptionist');
  const [newUserDefaultBranchId, setNewUserDefaultBranchId] = useState<string>('');
  const [newUserAuthorizedBranches, setNewUserAuthorizedBranches] = useState<string[]>([]);
  const [newUserIsActive, setNewUserIsActive] = useState(true);
  const [newUserAuthMode, setNewUserAuthMode] = useState<'invite' | 'password'>('password');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserLinkedProfId, setNewUserLinkedProfId] = useState('');
  const [showNewUserCustomPerms, setShowNewUserCustomPerms] = useState(false);
  const [newUserCustomPerms, setNewUserCustomPerms] = useState<
    Record<MenuKey, UserMenuPermissionRecord>
  >(() => resolveEffectivePermissions('receptionist'));

  // Modal Editar Usuário
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [editUserName, setEditUserName] = useState('');
  const [editUserPhone, setEditUserPhone] = useState('');
  const [editUserRole, setEditUserRole] = useState<UserRole>('receptionist');
  const [editUserDefaultBranchId, setEditUserDefaultBranchId] = useState<string>('');
  const [editUserAuthorizedBranches, setEditUserAuthorizedBranches] = useState<string[]>([]);
  const [editUserIsActive, setEditUserIsActive] = useState(true);
  const [editUserPermsDraft, setEditUserPermsDraft] = useState<
    Record<MenuKey, UserMenuPermissionRecord>
  >(() => resolveEffectivePermissions('receptionist'));

  // Modal Detalhes do Usuário
  const [viewingUser, setViewingUser] = useState<UserProfile | null>(null);

  // Aba Papéis & Permissões
  const [permSubMode, setPermSubMode] = useState<'individual' | 'role_templates'>('individual');
  const [selectedRoleForTemplate, setSelectedRoleForTemplate] = useState<UserRole>('receptionist');
  const [roleTemplateDraft, setRoleTemplateDraft] = useState<RolePermissionTemplate>(() => ({
    ...DEFAULT_ROLE_PERMISSIONS.receptionist,
  }));

  const [selectedUserIdForPerms, setSelectedUserIdForPerms] = useState<string>('');
  const [userRbacRoleDraft, setUserRbacRoleDraft] = useState<UserRole>('receptionist');
  const [userRbacPermsDraft, setUserRbacPermsDraft] = useState<
    Record<MenuKey, UserMenuPermissionRecord>
  >(() => resolveEffectivePermissions('receptionist'));

  const canCreateTeam = currentRole === 'super_admin' || canCreateInMenu('users');
  const canEditTeam = currentRole === 'super_admin' || canEditInMenu('users');
  const canAdminTeam = currentRole === 'super_admin' || canAdminMenu('users');

  const clearFeedback = () => {
    setFeedbackSuccess(null);
    setFeedbackError(null);
  };

  const loadTeamData = useCallback(async () => {
    setIsLoadingCloud(true);
    try {
      const res = await TeamCloudService.fetchTeamBootstrap(organization.id);
      setCloudOrgId(res.organizationId || organization.id);
      setProfessionals(res.professionals);
      setUsers(res.users);
      setSpecialties(res.specialties);
      setRoleTemplates(res.roleTemplates);
      setAuditLogs(res.auditLogs);
      if (!selectedUserIdForPerms && res.users.length > 0) {
        const defaultTarget =
          res.users.find((u) => u.role !== 'super_admin') || res.users[0];
        if (defaultTarget) {
          setSelectedUserIdForPerms(defaultTarget.id);
          setUserRbacRoleDraft(defaultTarget.role);
          setUserRbacPermsDraft(
            resolveEffectivePermissions(
              defaultTarget.role,
              res.roleTemplates,
              defaultTarget.permissions
            )
          );
        }
      }
      if (res.error && isSupabaseAuthMode) {
        setFeedbackError(res.error);
      }
    } finally {
      setIsLoadingCloud(false);
    }
  }, [organization.id, isSupabaseAuthMode, selectedUserIdForPerms]);

  useEffect(() => {
    void loadTeamData();
  }, [loadTeamData]);

  useEffect(() => {
    const template = roleTemplates[selectedRoleForTemplate] || DEFAULT_ROLE_PERMISSIONS[selectedRoleForTemplate];
    setRoleTemplateDraft({ ...template });
  }, [selectedRoleForTemplate, roleTemplates]);

  const selectUserForPermissions = (user: UserProfile) => {
    setSelectedUserIdForPerms(user.id);
    setUserRbacRoleDraft(user.role);
    setUserRbacPermsDraft(
      resolveEffectivePermissions(user.role, roleTemplates, user.permissions)
    );
  };

  const selectedPermUser = useMemo(
    () => users.find((u) => u.id === selectedUserIdForPerms) || null,
    [users, selectedUserIdForPerms]
  );

  // ============================================================================
  // FILTROS E MÉTRICAS
  // ============================================================================
  const filteredProfessionals = useMemo(() => {
    return professionals.filter((p) => {
      const q = profSearch.trim().toLowerCase();
      const matchesQ =
        !q ||
        p.fullName.toLowerCase().includes(q) ||
        p.councilNumber.toLowerCase().includes(q) ||
        (p.specialtyName || '').toLowerCase().includes(q) ||
        p.email.toLowerCase().includes(q);
      const matchesBranch =
        profBranchFilter === 'all' || p.branchIds.includes(profBranchFilter);
      const matchesStatus =
        profStatusFilter === 'all' ||
        (profStatusFilter === 'active' ? p.isActive !== false : p.isActive === false);
      return matchesQ && matchesBranch && matchesStatus;
    });
  }, [professionals, profSearch, profBranchFilter, profStatusFilter]);

  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      const q = userSearch.trim().toLowerCase();
      const matchesQ =
        !q ||
        u.fullName.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        ROLE_METADATA[u.role]?.label.toLowerCase().includes(q);
      const matchesRole = userRoleFilter === 'all' || u.role === userRoleFilter;
      const matchesBranch =
        userBranchFilter === 'all' ||
        u.defaultBranchId === userBranchFilter ||
        Boolean(u.authorizedBranchIds?.includes(userBranchFilter));
      const matchesStatus =
        userStatusFilter === 'all' ||
        (userStatusFilter === 'active' ? u.isActive !== false : u.isActive === false);
      return matchesQ && matchesRole && matchesBranch && matchesStatus;
    });
  }, [users, userSearch, userRoleFilter, userBranchFilter, userStatusFilter]);

  const stats = useMemo(() => {
    const activeProfs = professionals.filter((p) => p.isActive !== false).length;
    const activeUsers = users.filter((u) => u.isActive !== false).length;
    const inactiveUsers = users.filter((u) => u.isActive === false).length;
    const customOverrideUsers = users.filter((u) =>
      Object.values(u.permissions || {}).some((p) => p?.isCustomOverride)
    ).length;
    return { activeProfs, activeUsers, inactiveUsers, customOverrideUsers };
  }, [professionals, users]);

  // ============================================================================
  // HANDLERS: PROFISSIONAIS
  // ============================================================================
  const openCreateProfessionalModal = () => {
    clearFeedback();
    setEditingProfId(null);
    setProfName('');
    setProfCouncil('');
    setProfSpecialtyId(specialties[0]?.id || '');
    setProfPhone('');
    setProfEmail('');
    setProfBio('');
    setProfBranchIds(branches[0]?.id ? [branches[0].id] : []);
    setProfLinkedUserId('');
    setProfIsActive(true);
    setProfModalOpen(true);
  };

  const openEditProfessionalModal = (prof: Professional) => {
    clearFeedback();
    setEditingProfId(prof.id);
    setProfName(prof.fullName);
    setProfCouncil(prof.councilNumber);
    setProfSpecialtyId(prof.specialtyId || specialties[0]?.id || '');
    setProfPhone(prof.phone);
    setProfEmail(prof.email);
    setProfBio(prof.bio);
    setProfBranchIds(prof.branchIds.length > 0 ? prof.branchIds : branches[0]?.id ? [branches[0].id] : []);
    setProfLinkedUserId(prof.userProfileId || '');
    setProfIsActive(prof.isActive !== false);
    setProfModalOpen(true);
  };

  const handleSaveProfessional = async (e: React.FormEvent) => {
    e.preventDefault();
    clearFeedback();

    if (!profName.trim() || !profCouncil.trim()) {
      setFeedbackError('Informe o nome completo e o número de registro no conselho.');
      return;
    }

    if (profBranchIds.length === 0) {
      setFeedbackError('Vincule o profissional a pelo menos uma filial.');
      return;
    }

    const spec = specialties.find((s) => s.id === profSpecialtyId);

    // Prevenção local de duplicidade imediata
    const duplicateLocal = professionals.find(
      (p) =>
        p.id !== editingProfId &&
        p.councilNumber.trim().toLowerCase() === profCouncil.trim().toLowerCase()
    );
    if (duplicateLocal) {
      setFeedbackError(
        `Já existe um profissional com o registro ${profCouncil.trim()} (${duplicateLocal.fullName}).`
      );
      return;
    }

    setIsSaving(true);
    try {
      if (isSupabaseAuthMode) {
        const res = await TeamCloudService.saveProfessionalToCloud({
          id: editingProfId || undefined,
          organizationId: cloudOrgId,
          userProfileId: profLinkedUserId || undefined,
          fullName: profName.trim(),
          councilNumber: profCouncil.trim(),
          specialtyId: profSpecialtyId,
          specialtyName: spec?.name,
          branchIds: profBranchIds,
          phone: profPhone.trim(),
          email: profEmail.trim(),
          bio: profBio.trim(),
          isActive: profIsActive,
        });

        if (!res.success) {
          setFeedbackError(res.error || 'Não foi possível salvar os dados do profissional.');
          return;
        }

        await loadTeamData();
        setProfModalOpen(false);
        setFeedbackSuccess(
          editingProfId
            ? `Profissional ${profName.trim()} atualizado com sucesso.`
            : `Profissional ${profName.trim()} cadastrado com sucesso.`
        );
      } else if (isDevSimulationMode) {
        const profObj: Professional = {
          id: editingProfId || `prof_${Date.now()}`,
          organizationId: cloudOrgId,
          userProfileId: profLinkedUserId || undefined,
          fullName: profName.trim(),
          councilNumber: profCouncil.trim(),
          specialtyId: profSpecialtyId,
          specialtyName: spec?.name,
          branchIds: profBranchIds,
          phone: profPhone.trim(),
          email: profEmail.trim().toLowerCase(),
          bio: profBio.trim(),
          color: '#0284c7',
          isActive: profIsActive,
          updatedAt: new Date().toISOString(),
        };
        StorageService.saveProfessional(profObj);
        setProfessionals(StorageService.getProfessionals());
        setProfModalOpen(false);
        setFeedbackSuccess(`Profissional ${profObj.fullName} salvo no ambiente de desenvolvimento.`);
      } else {
        setFeedbackError('Conexão com o servidor necessária para cadastrar profissionais.');
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleProfessionalStatus = async (prof: Professional) => {
    clearFeedback();
    const nextActive = prof.isActive === false;
    setIsSaving(true);
    try {
      if (isSupabaseAuthMode) {
        const res = await TeamCloudService.toggleProfessionalActiveInCloud(
          prof.id,
          prof.organizationId,
          nextActive
        );
        if (!res.success) {
          setFeedbackError(res.error || 'Não foi possível alterar o status do profissional.');
          return;
        }
        await loadTeamData();
      } else if (isDevSimulationMode) {
        StorageService.saveProfessional({ ...prof, isActive: nextActive });
        setProfessionals(StorageService.getProfessionals());
      }
      setFeedbackSuccess(
        `Profissional ${prof.fullName} ${nextActive ? 'ativado' : 'desativado'} mantendo todo o histórico de consultas e prontuários.`
      );
    } finally {
      setIsSaving(false);
    }
  };

  // ============================================================================
  // HANDLERS: USUÁRIOS (CRIAÇÃO, EDIÇÃO, CONVITE/SENHA)
  // ============================================================================
  const openCreateUserModal = () => {
    clearFeedback();
    setNewUserName('');
    setNewUserEmail('');
    setNewUserPhone('');
    setNewUserRole('receptionist');
    const firstBranchId = branches[0]?.id || '';
    setNewUserDefaultBranchId(firstBranchId);
    setNewUserAuthorizedBranches(firstBranchId ? [firstBranchId] : []);
    setNewUserIsActive(true);
    setNewUserAuthMode('password');
    setNewUserPassword('');
    setNewUserLinkedProfId('');
    setShowNewUserCustomPerms(false);
    setNewUserCustomPerms(resolveEffectivePermissions('receptionist', roleTemplates));
    setCreateUserModalOpen(true);
  };

  const toggleNewUserPermCell = (menuKey: MenuKey, action: PermissionAction) => {
    const currentRow = newUserCustomPerms[menuKey];
    const nextVal = !currentRow[action];

    if (nextVal && currentRole !== 'super_admin' && !actorEffectivePermissions[menuKey]?.[action]) {
      setFeedbackError('Você não pode conceder uma permissão maior do que o seu próprio acesso.');
      return;
    }

    const updatedRow: UserMenuPermissionRecord = {
      ...currentRow,
      [action]: nextVal,
      canView: action !== 'canView' && nextVal ? true : action === 'canView' ? nextVal : currentRow.canView,
      isCustomOverride: true,
    };

    if (action === 'canView' && !nextVal) {
      updatedRow.canConsult = false;
      updatedRow.canCreate = false;
      updatedRow.canEdit = false;
      updatedRow.canDelete = false;
      updatedRow.canAdmin = false;
    }

    setNewUserCustomPerms((prev) => ({
      ...prev,
      [menuKey]: updatedRow,
    }));
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    clearFeedback();

    if (!newUserName.trim() || !newUserEmail.trim()) {
      setFeedbackError('Nome completo e e-mail são obrigatórios.');
      return;
    }

    if (!canActorAssignRole(currentRole, newUserRole)) {
      setFeedbackError('Você não possui permissão para atribuir este papel.');
      return;
    }

    if (newUserAuthMode === 'password' && newUserPassword.length < 8) {
      setFeedbackError('A senha inicial deve ter pelo menos 8 caracteres.');
      return;
    }

    const duplicateEmail = users.find(
      (u) => u.email.toLowerCase() === newUserEmail.trim().toLowerCase()
    );
    if (duplicateEmail) {
      setFeedbackError(`Já existe um usuário cadastrado com o e-mail ${newUserEmail.trim()}.`);
      return;
    }

    const sanitizedPerms = sanitizePermissionsForActor(
      currentRole,
      actorEffectivePermissions,
      showNewUserCustomPerms
        ? newUserCustomPerms
        : resolveEffectivePermissions(newUserRole, roleTemplates)
    );
    const initialPerms = Object.values(sanitizedPerms);

    setIsSaving(true);
    try {
      if (isSupabaseAuthMode) {
        const res = await TeamCloudService.createUserViaAdminFunction({
          organizationId: cloudOrgId,
          fullName: newUserName.trim(),
          email: newUserEmail.trim().toLowerCase(),
          phone: newUserPhone.trim(),
          role: newUserRole,
          defaultBranchId: newUserDefaultBranchId || null,
          authorizedBranchIds: newUserAuthorizedBranches,
          isActive: newUserIsActive,
          authMode: newUserAuthMode,
          password: newUserPassword,
          professionalId: newUserLinkedProfId || null,
          menuPermissions: initialPerms,
        });

        if (!res.success) {
          setFeedbackError(
            res.error || 'Não foi possível criar a conta de acesso para este usuário.'
          );
          return;
        }

        await loadTeamData();
        setCreateUserModalOpen(false);
        setFeedbackSuccess(
          res.reusedExistingAuth
            ? `Conta existente de ${newUserEmail.trim()} vinculada com sucesso à clínica ${organization.name}.`
            : newUserAuthMode === 'invite'
              ? `Usuário ${newUserName.trim()} cadastrado e convite de acesso enviado para ${newUserEmail.trim()}.`
              : `Usuário ${newUserName.trim()} cadastrado com sucesso e vinculado à clínica ${organization.name}.`
        );
      } else if (isDevSimulationMode) {
        const newId = `usr_${Date.now()}`;
        const localUser: UserProfile = {
          id: newId,
          organizationId: cloudOrgId,
          defaultBranchId: newUserDefaultBranchId || undefined,
          authorizedBranchIds: newUserAuthorizedBranches,
          fullName: newUserName.trim(),
          email: newUserEmail.trim().toLowerCase(),
          phone: newUserPhone.trim(),
          role: newUserRole,
          isActive: newUserIsActive,
          permissions: sanitizedPerms,
          createdAt: new Date().toISOString(),
        };
        StorageService.saveUser(localUser);
        if (newUserLinkedProfId) {
          const prof = professionals.find((p) => p.id === newUserLinkedProfId);
          if (prof) StorageService.saveProfessional({ ...prof, userProfileId: newId });
        }
        setUsers(StorageService.getUsers());
        setProfessionals(StorageService.getProfessionals());
        setCreateUserModalOpen(false);
        setFeedbackSuccess(`Usuário ${localUser.fullName} criado no ambiente de desenvolvimento local.`);
      } else {
        setFeedbackError('Conexão com o servidor necessária para cadastrar usuários.');
      }
    } finally {
      setIsSaving(false);
    }
  };

  const openEditUserModal = (user: UserProfile) => {
    clearFeedback();
    setEditingUser(user);
    setEditUserName(user.fullName);
    setEditUserPhone(user.phone);
    setEditUserRole(user.role);
    setEditUserDefaultBranchId(user.defaultBranchId || branches[0]?.id || '');
    setEditUserAuthorizedBranches(
      user.authorizedBranchIds && user.authorizedBranchIds.length > 0
        ? user.authorizedBranchIds
        : user.defaultBranchId
        ? [user.defaultBranchId]
        : []
    );
    setEditUserIsActive(user.isActive !== false);
    setEditUserPermsDraft(
      resolveEffectivePermissions(user.role, roleTemplates, user.permissions)
    );
  };

  const handleSaveEditedUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    clearFeedback();

    if (!canActorAssignRole(currentRole, editUserRole) && editUserRole !== editingUser.role) {
      setFeedbackError('Você não tem permissão para atribuir o papel selecionado.');
      return;
    }

    const sanitizedPerms = sanitizePermissionsForActor(
      currentRole,
      actorEffectivePermissions,
      editUserPermsDraft
    );
    const permList = Object.values(sanitizedPerms);

    setIsSaving(true);
    try {
      if (isSupabaseAuthMode && isUuid(editingUser.id)) {
        const res = await TeamCloudService.saveUserAndPermissionsToCloud({
          targetProfileId: editingUser.id,
          fullName: editUserName.trim(),
          phone: editUserPhone.trim(),
          role: editUserRole,
          defaultBranchId: editUserDefaultBranchId || null,
          authorizedBranchIds: editUserAuthorizedBranches,
          isActive: editUserIsActive,
          previousIsActive: editingUser.isActive !== false,
          menuPermissions: permList,
        });

        if (!res.success) {
          setFeedbackError(res.error || 'Não foi possível salvar as alterações do usuário.');
          return;
        }

        await loadTeamData();
        if (editingUser.id === currentUser.id) {
          await refreshSessionProfile();
        }
        setEditingUser(null);
        setFeedbackSuccess(
          res.warning
            ? `Usuário atualizado com aviso: ${res.warning}`
            : `Dados e acessos de ${editUserName.trim()} atualizados com sucesso no banco de dados.`
        );
      } else if (isDevSimulationMode) {
        const updated: UserProfile = {
          ...editingUser,
          fullName: editUserName.trim(),
          phone: editUserPhone.trim(),
          role: editUserRole,
          defaultBranchId: editUserDefaultBranchId || undefined,
          authorizedBranchIds: editUserAuthorizedBranches,
          isActive: editUserIsActive,
          permissions: sanitizedPerms,
          updatedAt: new Date().toISOString(),
        };
        StorageService.saveUser(updated);
        StorageService.addAuditLog({
          action: 'change_permission',
          entity: 'user_profiles',
          entityId: updated.id,
          details: `Alterou usuário ${updated.fullName} para papel ${updated.role} (Ativo: ${updated.isActive})`,
        });
        setUsers(StorageService.getUsers());
        setAuditLogs(StorageService.getAuditLogs());
        setEditingUser(null);
        setFeedbackSuccess(`Usuário ${updated.fullName} atualizado no ambiente local.`);
      } else {
        setFeedbackError('Conexão com o servidor necessária para salvar usuários.');
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleUserActiveQuick = async (user: UserProfile) => {
    clearFeedback();
    if (user.id === currentUser.id) {
      setFeedbackError('Você não pode desativar o próprio usuário em sessão ativa.');
      return;
    }
    const nextActive = user.isActive === false;
    setIsSaving(true);
    try {
      if (isSupabaseAuthMode && isUuid(user.id)) {
        const perms = Object.values(
          resolveEffectivePermissions(user.role, roleTemplates, user.permissions)
        );
        const res = await TeamCloudService.saveUserAndPermissionsToCloud({
          targetProfileId: user.id,
          fullName: user.fullName,
          phone: user.phone,
          role: user.role,
          defaultBranchId: user.defaultBranchId || null,
          authorizedBranchIds: user.authorizedBranchIds || [],
          isActive: nextActive,
          previousIsActive: user.isActive !== false,
          menuPermissions: perms,
        });
        if (!res.success) {
          setFeedbackError(res.error || 'Não foi possível alterar o status do usuário.');
          return;
        }
        await loadTeamData();
        setFeedbackSuccess(
          nextActive
            ? `Usuário ${user.fullName} reativado com sucesso.`
            : `Usuário ${user.fullName} desativado e impedido de acessar o sistema.`
        );
      } else if (isDevSimulationMode) {
        StorageService.saveUser({ ...user, isActive: nextActive, updatedAt: new Date().toISOString() });
        setUsers(StorageService.getUsers());
        setFeedbackSuccess(
          nextActive
            ? `Usuário ${user.fullName} reativado no ambiente local.`
            : `Usuário ${user.fullName} desativado no ambiente local.`
        );
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleResendLink = async (user: UserProfile, mode: 'invite' | 'recovery') => {
    clearFeedback();
    setIsSaving(true);
    try {
      const res = await TeamCloudService.resendUserAccessLink(user.id, user.email, mode);
      if (!res.success) {
        setFeedbackError(res.error || 'Erro ao enviar e-mail de acesso.');
        return;
      }
      setFeedbackSuccess(
        res.deliveredMode === 'recovery'
          ? `Link de definição/redefinição de senha enviado para ${user.email}.`
          : `Convite enviado para ${user.email}.`
      );
    } finally {
      setIsSaving(false);
    }
  };

  // ============================================================================
  // HANDLERS: MATRIZ DE PERMISSÕES (INDIVIDUAL + MODELO DE PAPEL)
  // ============================================================================
  const toggleUserPermissionCell = (menuKey: MenuKey, action: PermissionAction) => {
    if (!selectedPermUser) return;
    if (selectedPermUser.role === 'super_admin' && currentRole !== 'super_admin') return;

    const currentRow = userRbacPermsDraft[menuKey];
    const nextVal = !currentRow[action];

    // Impede não-super_admin de conceder permissão superior à própria
    if (nextVal && currentRole !== 'super_admin' && !actorEffectivePermissions[menuKey]?.[action]) {
      setFeedbackError('Você não pode conceder uma permissão maior do que o seu próprio acesso.');
      return;
    }

    const updatedRow: UserMenuPermissionRecord = {
      ...currentRow,
      [action]: nextVal,
      // Se habilitou ação operacional (consult/create/edit/delete/admin), habilita visualização automaticamente
      canView: action !== 'canView' && nextVal ? true : action === 'canView' ? nextVal : currentRow.canView,
      isCustomOverride: true,
    };

    // Se desabilitou visualização, limpa ações dependentes
    if (action === 'canView' && !nextVal) {
      updatedRow.canConsult = false;
      updatedRow.canCreate = false;
      updatedRow.canEdit = false;
      updatedRow.canDelete = false;
      updatedRow.canAdmin = false;
    }

    setUserRbacPermsDraft((prev) => ({
      ...prev,
      [menuKey]: updatedRow,
    }));
  };

  const revertMenuRowToRoleDefault = (menuKey: MenuKey) => {
    const base =
      roleTemplates[userRbacRoleDraft]?.[menuKey] ||
      DEFAULT_ROLE_PERMISSIONS[userRbacRoleDraft][menuKey];
    setUserRbacPermsDraft((prev) => ({
      ...prev,
      [menuKey]: {
        menuKey,
        ...base,
        isCustomOverride: false,
      },
    }));
  };

  const applyFullRoleTemplateToUserDraft = () => {
    const clean = resolveEffectivePermissions(userRbacRoleDraft, roleTemplates, undefined);
    setUserRbacPermsDraft(clean);
    setFeedbackSuccess(
      `Padrão do papel "${ROLE_METADATA[userRbacRoleDraft].label}" aplicado na pré-visualização. Clique em Salvar Permissões para confirmar.`
    );
  };

  const handleSaveUserRbacMatrix = async () => {
    if (!selectedPermUser) return;
    clearFeedback();

    if (!canActorAssignRole(currentRole, userRbacRoleDraft) && userRbacRoleDraft !== selectedPermUser.role) {
      setFeedbackError('Você não tem permissão para atribuir este papel.');
      return;
    }

    const sanitized = sanitizePermissionsForActor(
      currentRole,
      actorEffectivePermissions,
      resolveEffectivePermissions(userRbacRoleDraft, roleTemplates, userRbacPermsDraft)
    );

    setIsSaving(true);
    try {
      if (isSupabaseAuthMode && isUuid(selectedPermUser.id)) {
        const res = await TeamCloudService.saveUserAndPermissionsToCloud({
          targetProfileId: selectedPermUser.id,
          fullName: selectedPermUser.fullName,
          phone: selectedPermUser.phone,
          role: userRbacRoleDraft,
          defaultBranchId: selectedPermUser.defaultBranchId || null,
          authorizedBranchIds: selectedPermUser.authorizedBranchIds || [],
          isActive: selectedPermUser.isActive,
          previousIsActive: selectedPermUser.isActive,
          menuPermissions: Object.values(sanitized),
        });

        if (!res.success) {
          setFeedbackError(res.error || 'Erro ao gravar permissões no banco de dados.');
          return;
        }

        await loadTeamData();
        if (selectedPermUser.id === currentUser.id) {
          await refreshSessionProfile();
        }
        setFeedbackSuccess(
          `Permissões e papel de ${selectedPermUser.fullName} salvos e registrados na auditoria.`
        );
      } else if (isDevSimulationMode) {
        const updated: UserProfile = {
          ...selectedPermUser,
          role: userRbacRoleDraft,
          permissions: sanitized,
          updatedAt: new Date().toISOString(),
        };
        StorageService.saveUser(updated);
        StorageService.addAuditLog({
          action: 'change_permission',
          entity: 'user_menu_permissions',
          entityId: updated.id,
          details: `Permissões atualizadas para ${updated.fullName} (Papel: ${updated.role})`,
        });
        setUsers(StorageService.getUsers());
        setAuditLogs(StorageService.getAuditLogs());
        setFeedbackSuccess(`Permissões de ${updated.fullName} atualizadas no ambiente local.`);
      } else {
        setFeedbackError('Conexão com o servidor necessária para salvar permissões.');
      }
    } finally {
      setIsSaving(false);
    }
  };

  const toggleRoleTemplateCell = (menuKey: MenuKey, action: PermissionAction) => {
    if (selectedRoleForTemplate === 'super_admin' && currentRole !== 'super_admin') return;

    const currentRow = roleTemplateDraft[menuKey];
    const nextVal = !currentRow[action];
    if (nextVal && currentRole !== 'super_admin' && !actorEffectivePermissions[menuKey]?.[action]) {
      setFeedbackError('Você não pode incluir no papel uma permissão acima da sua própria.');
      return;
    }

    const nextRow: MenuPermissionSet = {
      ...currentRow,
      [action]: nextVal,
      canView: action !== 'canView' && nextVal ? true : action === 'canView' ? nextVal : currentRow.canView,
    };

    if (action === 'canView' && !nextVal) {
      nextRow.canConsult = false;
      nextRow.canCreate = false;
      nextRow.canEdit = false;
      nextRow.canDelete = false;
      nextRow.canAdmin = false;
    }

    setRoleTemplateDraft((prev) => ({
      ...prev,
      [menuKey]: nextRow,
    }));
  };

  const handleSaveRoleTemplate = async () => {
    clearFeedback();
    if (selectedRoleForTemplate === 'super_admin' && currentRole !== 'super_admin') {
      setFeedbackError('Apenas Super Admin pode alterar o modelo padrão de Super Admin.');
      return;
    }

    setIsSaving(true);
    try {
      if (isSupabaseAuthMode) {
        const res = await TeamCloudService.saveRolePermissionsToCloud(
          cloudOrgId,
          selectedRoleForTemplate,
          roleTemplateDraft
        );
        if (!res.success) {
          setFeedbackError(res.error || 'Erro ao salvar modelo padrão do papel.');
          return;
        }
        await loadTeamData();
        setFeedbackSuccess(
          `Modelo padrão do papel "${ROLE_METADATA[selectedRoleForTemplate].label}" atualizado com sucesso.`
        );
      } else if (isDevSimulationMode) {
        const nextTemplates = {
          ...roleTemplates,
          [selectedRoleForTemplate]: roleTemplateDraft,
        };
        StorageService.saveRolePermissions(nextTemplates);
        setRoleTemplates(nextTemplates);
        setFeedbackSuccess(
          `Modelo padrão de "${ROLE_METADATA[selectedRoleForTemplate].label}" salvo localmente.`
        );
      } else {
        setFeedbackError('Conexão com o servidor necessária para salvar papéis.');
      }
    } finally {
      setIsSaving(false);
    }
  };

  // ============================================================================
  // RENDER
  // ============================================================================
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
            Equipe Clínica, Usuários & Permissões
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Gestão completa do corpo clínico, acessos autenticados por filial e controle granular de permissões por menu.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => void loadTeamData()}
            disabled={isLoadingCloud}
            className="px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl transition flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingCloud ? 'animate-spin' : ''}`} />
            <span>Atualizar</span>
          </button>

          {canCreateTeam && (
            <>
              <button
                type="button"
                onClick={openCreateProfessionalModal}
                className="px-3.5 py-2 text-xs font-semibold text-sky-700 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-xl transition flex items-center gap-1.5"
              >
                <Stethoscope className="w-4 h-4" />
                <span>Novo Profissional</span>
              </button>

              <button
                type="button"
                onClick={openCreateUserModal}
                className="px-4 py-2 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-xl shadow-xs transition flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                <span>Novo Usuário</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Feedback Alerts */}
      {feedbackSuccess && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs font-semibold flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{feedbackSuccess}</span>
          </div>
          <button onClick={() => setFeedbackSuccess(null)} className="text-emerald-700 hover:text-emerald-950">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {feedbackError && (
        <div className="p-3.5 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs font-semibold flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{feedbackError}</span>
          </div>
          <button onClick={() => setFeedbackError(null)} className="text-rose-700 hover:text-rose-950">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 5 Organized Sections Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 border-b border-slate-200">
        {[
          { id: 'overview', label: 'Visão Geral da Equipe', icon: <Activity className="w-3.5 h-3.5" /> },
          { id: 'professionals', label: `Profissionais de Saúde (${professionals.length})`, icon: <Stethoscope className="w-3.5 h-3.5" /> },
          { id: 'users', label: `Usuários do Sistema (${users.length})`, icon: <Users className="w-3.5 h-3.5" /> },
          { id: 'roles_permissions', label: 'Papéis e Permissões', icon: <Sliders className="w-3.5 h-3.5" /> },
          { id: 'branches_links', label: 'Filiais e Vínculos', icon: <Building2 className="w-3.5 h-3.5" /> },
        ].map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as TeamTab)}
              className={`px-3.5 py-2 text-xs font-bold rounded-xl whitespace-nowrap transition flex items-center gap-1.5 ${
                isActive
                  ? 'bg-sky-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* =====================================================================
          SEÇÃO 1: VISÃO GERAL DA EQUIPE
          ===================================================================== */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-5 bg-white rounded-2xl border border-slate-200 shadow-xs">
              <span className="text-xs font-medium text-slate-500">Profissionais Ativos</span>
              <div className="mt-2 text-2xl font-extrabold text-slate-900 tabular-nums">
                {stats.activeProfs}
              </div>
              <span className="text-[11px] text-sky-700 font-semibold block mt-1">
                Corpo clínico habilitado
              </span>
            </div>

            <div className="p-5 bg-white rounded-2xl border border-slate-200 shadow-xs">
              <span className="text-xs font-medium text-slate-500">Usuários Ativos</span>
              <div className="mt-2 text-2xl font-extrabold text-emerald-700 tabular-nums">
                {stats.activeUsers}
              </div>
              <span className="text-[11px] text-slate-500 block mt-1">
                Com acesso autenticado
              </span>
            </div>

            <div className="p-5 bg-white rounded-2xl border border-slate-200 shadow-xs">
              <span className="text-xs font-medium text-slate-500">Usuários Inativos</span>
              <div className="mt-2 text-2xl font-extrabold text-rose-600 tabular-nums">
                {stats.inactiveUsers}
              </div>
              <span className="text-[11px] text-slate-500 block mt-1">
                Bloqueados no acesso ao sistema
              </span>
            </div>

            <div className="p-5 bg-white rounded-2xl border border-slate-200 shadow-xs">
              <span className="text-xs font-medium text-slate-500">Permissões Customizadas</span>
              <div className="mt-2 text-2xl font-extrabold text-purple-700 tabular-nums">
                {stats.customOverrideUsers}
              </div>
              <span className="text-[11px] text-slate-500 block mt-1">
                Usuários com exceções individuais
              </span>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-sky-600" />
                <span>Trilha de Auditoria Recente (Acessos, Papéis & Equipe)</span>
              </h3>
              <span className="text-[11px] text-slate-400">{auditLogs.length} registros</span>
            </div>
            <div className="divide-y divide-slate-100 max-h-96 overflow-y-auto">
              {auditLogs.slice(0, 12).map((log) => (
                <div key={log.id} className="p-3.5 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-slate-50">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-900">{log.action}</span>
                      <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-mono">
                        {log.entity}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5 break-all line-clamp-2">
                      {log.userName} ({log.userRole}) · {log.details}
                    </p>
                  </div>
                  <span className="text-[11px] text-slate-400 whitespace-nowrap font-mono">
                    {new Date(log.timestamp).toLocaleString('pt-BR')}
                  </span>
                </div>
              ))}
              {auditLogs.length === 0 && (
                <div className="p-6 text-center text-xs text-slate-400">
                  Nenhum evento de auditoria registrado ainda.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          SEÇÃO 2: PROFISSIONAIS DE SAÚDE (CRUD COMPLETO)
          ===================================================================== */}
      {activeTab === 'professionals' && (
        <div className="space-y-4">
          <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Buscar profissional por nome, CRM/conselho, especialidade..."
                value={profSearch}
                onChange={(e) => setProfSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={profBranchFilter}
                onChange={(e) => setProfBranchFilter(e.target.value)}
                className="px-3 py-2 text-xs border border-slate-200 rounded-xl bg-white"
              >
                <option value="all">Todas as Filiais</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>

              <select
                value={profStatusFilter}
                onChange={(e) => setProfStatusFilter(e.target.value as 'all' | 'active' | 'inactive')}
                className="px-3 py-2 text-xs border border-slate-200 rounded-xl bg-white"
              >
                <option value="all">Todos os Status</option>
                <option value="active">Somente Ativos</option>
                <option value="inactive">Somente Inativos</option>
              </select>

              {canCreateTeam && (
                <button
                  type="button"
                  onClick={openCreateProfessionalModal}
                  className="px-3.5 py-2 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-xl flex items-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Cadastrar Profissional</span>
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredProfessionals.map((p) => {
              const spec = specialties.find((s) => s.id === p.specialtyId);
              const profBranches = branches.filter((b) => p.branchIds.includes(b.id));
              const linkedUser = users.find((u) => u.id === p.userProfileId);
              const isProfActive = p.isActive !== false;

              return (
                <div
                  key={p.id}
                  className={`p-5 bg-white rounded-2xl border shadow-xs space-y-3 transition ${
                    isProfActive ? 'border-slate-200' : 'border-slate-200 opacity-75 bg-slate-50/70'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-sky-50 text-sky-700 font-bold flex items-center justify-center shrink-0">
                        <Stethoscope className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="font-bold text-slate-900 text-sm">{p.fullName}</h4>
                        <span className="text-xs text-sky-700 font-medium font-mono">
                          {p.councilNumber}
                        </span>
                      </div>
                    </div>
                    <span
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${
                        isProfActive
                          ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                          : 'text-rose-700 bg-rose-50 border-rose-200'
                      }`}
                    >
                      {isProfActive ? 'Ativo' : 'Inativo'}
                    </span>
                  </div>

                  <div className="text-xs text-slate-600 space-y-1">
                    <p>
                      <strong>Especialidade:</strong> {p.specialtyName || spec?.name || 'Não informada'}
                    </p>
                    {linkedUser && (
                      <p className="text-sky-800">
                        <strong>Usuário vinculado:</strong> {linkedUser.fullName} ({linkedUser.email})
                      </p>
                    )}
                    {p.bio && (
                      <p className="line-clamp-2 text-slate-500 italic text-[11px]">"{p.bio}"</p>
                    )}
                  </div>

                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 gap-2 flex-wrap">
                    <div className="flex items-center gap-1">
                      <MapPin className="w-3.5 h-3.5 text-slate-400" />
                      <span>
                        Filiais:{' '}
                        {profBranches.length > 0
                          ? profBranches.map((b) => b.name.split('(')[0].trim()).join(', ')
                          : 'Nenhuma'}
                      </span>
                    </div>
                    <span>{p.phone}</span>
                  </div>

                  <div className="pt-2 border-t border-slate-100 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setViewingProfessional(p)}
                      className="px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg border border-slate-200 flex items-center gap-1"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>Visualizar</span>
                    </button>

                    {canEditTeam && (
                      <>
                        <button
                          type="button"
                          onClick={() => openEditProfessionalModal(p)}
                          className="px-2.5 py-1.5 text-[11px] font-semibold text-sky-700 bg-sky-50 hover:bg-sky-100 rounded-lg border border-sky-200 flex items-center gap-1"
                        >
                          <Edit className="w-3.5 h-3.5" />
                          <span>Editar</span>
                        </button>

                        <button
                          type="button"
                          disabled={isSaving}
                          onClick={() => void handleToggleProfessionalStatus(p)}
                          className={`px-2.5 py-1.5 text-[11px] font-semibold rounded-lg border flex items-center gap-1 ${
                            isProfActive
                              ? 'text-rose-700 bg-rose-50 hover:bg-rose-100 border-rose-200'
                              : 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border-emerald-200'
                          }`}
                        >
                          <Power className="w-3.5 h-3.5" />
                          <span>{isProfActive ? 'Desativar' : 'Ativar'}</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* =====================================================================
          SEÇÃO 3: USUÁRIOS DO SISTEMA (CRUD COMPLETO + FILTROS + DETALHES)
          ===================================================================== */}
      {activeTab === 'users' && (
        <div className="space-y-4">
          <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-xs flex flex-col lg:flex-row gap-3 items-stretch lg:items-center justify-between">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Buscar usuário por nome, e-mail ou papel..."
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={userRoleFilter}
                onChange={(e) => setUserRoleFilter(e.target.value)}
                className="px-3 py-2 text-xs border border-slate-200 rounded-xl bg-white"
              >
                <option value="all">Todos os Papéis</option>
                {ALL_USER_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_METADATA[r].label}
                  </option>
                ))}
              </select>

              <select
                value={userBranchFilter}
                onChange={(e) => setUserBranchFilter(e.target.value)}
                className="px-3 py-2 text-xs border border-slate-200 rounded-xl bg-white"
              >
                <option value="all">Todas as Filiais</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>

              <select
                value={userStatusFilter}
                onChange={(e) => setUserStatusFilter(e.target.value as 'all' | 'active' | 'inactive')}
                className="px-3 py-2 text-xs border border-slate-200 rounded-xl bg-white"
              >
                <option value="all">Todos os Status</option>
                <option value="active">Ativos</option>
                <option value="inactive">Inativos</option>
              </select>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                Usuários e Acessos Autenticados ({filteredUsers.length})
              </h3>
              <span className="text-[11px] text-slate-400">
                Controle por organização, filial e menu
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold text-[11px]">
                    <th className="py-2.5 px-4">Nome Completo</th>
                    <th className="py-2.5 px-4">E-mail</th>
                    <th className="py-2.5 px-4">Papel / Função</th>
                    <th className="py-2.5 px-4">Filiais Autorizadas</th>
                    <th className="py-2.5 px-4">Status & Criação</th>
                    <th className="py-2.5 px-4 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredUsers.map((u) => {
                    const roleMeta = ROLE_METADATA[u.role];
                    const defaultBranchName =
                      branches.find((b) => b.id === u.defaultBranchId)?.name || 'Todas as Filiais';
                    const authCount = u.authorizedBranchIds?.length || (u.defaultBranchId ? 1 : 0);
                    const hasCustom = Object.values(u.permissions || {}).some(
                      (p) => p?.isCustomOverride
                    );
                    const isSelf = u.id === currentUser.id;
                    const isRestrictedSuper =
                      u.role === 'super_admin' && currentRole !== 'super_admin';

                    return (
                      <tr key={u.id} className="hover:bg-slate-50/80">
                        <td className="py-3 px-4">
                          <div className="font-bold text-slate-900 flex items-center gap-1.5">
                            <span>{u.fullName}</span>
                            {isSelf && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-100 text-sky-800 font-semibold">
                                Você
                              </span>
                            )}
                          </div>
                          {hasCustom && (
                            <span className="text-[10px] text-purple-700 font-semibold">
                              Com exceções individuais
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-slate-600 font-mono text-[11px]">
                          {u.email}
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`px-2 py-0.5 rounded border font-semibold text-[11px] ${
                              roleMeta?.badgeClass || 'bg-slate-100 text-slate-800 border-slate-200'
                            }`}
                          >
                            {roleMeta?.shortLabel || u.role}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-slate-600">
                          <span className="block truncate max-w-[180px]">{defaultBranchName}</span>
                          <span className="text-[10px] text-slate-400">
                            {u.role === 'super_admin' || u.role === 'clinic_admin'
                              ? 'Acesso global à clínica'
                              : `${authCount} filial(is) vinculada(s)`}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold border ${
                              u.isActive !== false
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : 'bg-rose-50 text-rose-700 border-rose-200'
                            }`}
                          >
                            {u.isActive !== false ? 'Ativo' : 'Inativo'}
                          </span>
                          <span className="block text-[10px] text-slate-400 mt-0.5">
                            {u.createdAt
                              ? `Criado em ${new Date(u.createdAt).toLocaleDateString('pt-BR')}`
                              : 'Conta cadastrada'}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center justify-end gap-1.5 flex-wrap">
                            <button
                              type="button"
                              onClick={() => setViewingUser(u)}
                              className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg border border-slate-200"
                              title="Detalhes do usuário"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>

                            {canEditTeam && !isRestrictedSuper && (
                              <button
                                type="button"
                                onClick={() => openEditUserModal(u)}
                                className="px-2 py-1 text-[11px] font-semibold text-sky-700 bg-sky-50 hover:bg-sky-100 rounded-lg border border-sky-200 flex items-center gap-1"
                              >
                                <Edit className="w-3 h-3" />
                                <span>Editar</span>
                              </button>
                            )}

                            {canAdminTeam && !isRestrictedSuper && (
                              <button
                                type="button"
                                onClick={() => {
                                  selectUserForPermissions(u);
                                  setPermSubMode('individual');
                                  setActiveTab('roles_permissions');
                                }}
                                className="px-2 py-1 text-[11px] font-semibold text-purple-700 bg-purple-50 hover:bg-purple-100 rounded-lg border border-purple-200 flex items-center gap-1"
                              >
                                <Sliders className="w-3 h-3" />
                                <span>Permissões</span>
                              </button>
                            )}

                            {canEditTeam && !isRestrictedSuper && (
                              <button
                                type="button"
                                disabled={isSaving}
                                onClick={() => void handleResendLink(u, 'recovery')}
                                className="p-1.5 text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-lg border border-amber-200"
                                title="Enviar link de definição/redefinição de senha"
                              >
                                <Send className="w-3.5 h-3.5" />
                              </button>
                            )}

                            {canEditTeam && !isRestrictedSuper && !isSelf && (
                              <button
                                type="button"
                                disabled={isSaving}
                                onClick={() => void handleToggleUserActiveQuick(u)}
                                className={`p-1.5 rounded-lg border ${
                                  u.isActive !== false
                                    ? 'text-rose-700 bg-rose-50 hover:bg-rose-100 border-rose-200'
                                    : 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border-emerald-200'
                                }`}
                                title={u.isActive !== false ? 'Desativar usuário' : 'Reativar usuário'}
                              >
                                <Power className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          SEÇÃO 4: PAPÉIS E PERMISSÕES (MATRIZ 9 MENUS × 6 AÇÕES)
          ===================================================================== */}
      {activeTab === 'roles_permissions' && (
        <div className="space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPermSubMode('individual')}
                className={`px-3.5 py-2 text-xs font-bold rounded-xl transition ${
                  permSubMode === 'individual'
                    ? 'bg-sky-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:text-slate-900'
                }`}
              >
                Permissões Individuais por Usuário
              </button>
              <button
                type="button"
                onClick={() => setPermSubMode('role_templates')}
                className={`px-3.5 py-2 text-xs font-bold rounded-xl transition ${
                  permSubMode === 'role_templates'
                    ? 'bg-purple-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:text-slate-900'
                }`}
              >
                Modelos Padrão por Papel
              </button>
            </div>
            <span className="text-[11px] text-slate-500">
              Todas as alterações são registradas e validadas com segurança pelo sistema.
            </span>
          </div>

          {permSubMode === 'individual' ? (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
              {/* Seleção de Usuário */}
              <div className="lg:col-span-4 bg-white rounded-2xl border border-slate-200 shadow-xs p-4 space-y-3">
                <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                  Selecionar Usuário
                </h3>
                <div className="space-y-1.5 max-h-[520px] overflow-y-auto">
                  {users.map((u) => {
                    const isSelected = u.id === selectedUserIdForPerms;
                    const roleMeta = ROLE_METADATA[u.role];
                    const overrideCount = Object.values(u.permissions || {}).filter(
                      (p) => p?.isCustomOverride
                    ).length;

                    return (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => selectUserForPermissions(u)}
                        className={`w-full text-left p-3 rounded-xl border transition ${
                          isSelected
                            ? 'bg-sky-50 border-sky-300 shadow-2xs'
                            : 'bg-white border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-xs text-slate-900 truncate">
                            {u.fullName}
                          </span>
                          <span
                            className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold ${roleMeta?.badgeClass}`}
                          >
                            {roleMeta?.shortLabel}
                          </span>
                        </div>
                        <div className="flex items-center justify-between mt-1 text-[11px] text-slate-500">
                          <span className="truncate">{u.email}</span>
                          {overrideCount > 0 && (
                            <span className="text-[10px] font-bold text-purple-700 shrink-0 ml-2">
                              {overrideCount} exceção(ões)
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Matriz 9 Menus × 6 Ações */}
              <div className="lg:col-span-8 space-y-4">
                {selectedPermUser ? (
                  <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                      <div>
                        <h3 className="text-sm font-bold text-slate-900">
                          Configuração RBAC: {selectedPermUser.fullName}
                        </h3>
                        <p className="text-[11px] text-slate-500">
                          {selectedPermUser.email} · Escolha o papel base e personalize exceções individuais por menu.
                        </p>
                      </div>

                      <div className="flex items-center gap-2 flex-wrap">
                        <select
                          value={userRbacRoleDraft}
                          disabled={
                            !canAdminTeam ||
                            (selectedPermUser.role === 'super_admin' && currentRole !== 'super_admin')
                          }
                          onChange={(e) => {
                            const nextRole = e.target.value as UserRole;
                            setUserRbacRoleDraft(nextRole);
                            setUserRbacPermsDraft((prev) =>
                              applyRoleChangePreservingOverrides(nextRole, prev, roleTemplates)
                            );
                          }}
                          className="px-3 py-1.5 text-xs font-semibold border border-slate-300 rounded-lg bg-white"
                        >
                          {ALL_USER_ROLES.filter(
                            (r) => canActorAssignRole(currentRole, r) || r === selectedPermUser.role
                          ).map((r) => (
                            <option key={r} value={r}>
                              {ROLE_METADATA[r].label}
                            </option>
                          ))}
                        </select>

                        <button
                          type="button"
                          onClick={applyFullRoleTemplateToUserDraft}
                          className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg flex items-center gap-1"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Aplicar Padrão do Papel</span>
                        </button>
                      </div>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 text-[11px]">
                            <th className="py-2 px-3 text-left">Menu / Módulo</th>
                            {PERM_COLUMNS.map((col) => (
                              <th key={col.key} className="py-2 px-2 text-center">
                                {col.label}
                              </th>
                            ))}
                            <th className="py-2 px-2 text-right">Origem</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {MENU_DEFINITIONS.map((def) => {
                            const row = userRbacPermsDraft[def.key];
                            const isSuperTarget = userRbacRoleDraft === 'super_admin';
                            const isLockedForActor =
                              !canAdminTeam ||
                              (selectedPermUser.role === 'super_admin' && currentRole !== 'super_admin');

                            return (
                              <tr key={def.key} className="hover:bg-slate-50/70">
                                <td className="py-2.5 px-3">
                                  <div className="font-bold text-slate-900 flex items-center gap-1.5">
                                    <span>{def.label}</span>
                                    {def.sensitiveClinical && (
                                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200 font-bold">
                                        Sigilo CFM
                                      </span>
                                    )}
                                  </div>
                                  <span className="text-[10px] text-slate-400 block">
                                    {def.description}
                                  </span>
                                </td>

                                {PERM_COLUMNS.map((col) => {
                                  const supported =
                                    (col.key === 'canDelete' ? def.supportsDelete : true) &&
                                    (col.key === 'canAdmin' ? def.supportsAdmin : true);
                                  const actorAllowed =
                                    currentRole === 'super_admin' ||
                                    Boolean(actorEffectivePermissions[def.key]?.[col.key]);
                                  const lockedSuperEssential =
                                    isSuperTarget &&
                                    (def.key === 'dashboard' || def.key === 'users' || def.key === 'settings') &&
                                    (col.key === 'canView' || col.key === 'canConsult' || col.key === 'canAdmin');

                                  return (
                                    <td key={col.key} className="py-2.5 px-2 text-center">
                                      {supported ? (
                                        <input
                                          type="checkbox"
                                          checked={Boolean(row?.[col.key])}
                                          disabled={
                                            isLockedForActor ||
                                            lockedSuperEssential ||
                                            (!row?.[col.key] && !actorAllowed)
                                          }
                                          onChange={() => toggleUserPermissionCell(def.key, col.key)}
                                          className="rounded text-sky-600 focus:ring-sky-500 cursor-pointer disabled:opacity-40"
                                        />
                                      ) : (
                                        <span className="text-slate-300">—</span>
                                      )}
                                    </td>
                                  );
                                })}

                                <td className="py-2.5 px-2 text-right">
                                  {row?.isCustomOverride ? (
                                    <button
                                      type="button"
                                      onClick={() => revertMenuRowToRoleDefault(def.key)}
                                      className="px-2 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-200 text-[10px] font-bold hover:bg-purple-100"
                                      title="Clique para voltar ao padrão do papel"
                                    >
                                      Exceção ×
                                    </button>
                                  ) : (
                                    <span className="text-[10px] text-slate-400">Padrão</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Prévia ao vivo dos menus visíveis */}
                    <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                      <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block">
                        Prévia dos Menus Resultantes na Sidebar do Usuário
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {MENU_DEFINITIONS.map((def) => {
                          const visible = Boolean(userRbacPermsDraft[def.key]?.canView);
                          return (
                            <span
                              key={def.key}
                              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border ${
                                visible
                                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                  : 'bg-slate-100 text-slate-400 border-slate-200 line-through'
                              }`}
                            >
                              {def.label}
                            </span>
                          );
                        })}
                      </div>
                    </div>

                    {canAdminTeam && (
                      <div className="flex justify-end pt-2">
                        <button
                          type="button"
                          disabled={
                            isSaving ||
                            (selectedPermUser.role === 'super_admin' && currentRole !== 'super_admin')
                          }
                          onClick={() => void handleSaveUserRbacMatrix()}
                          className="px-5 py-2.5 text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-60 rounded-xl shadow-xs flex items-center gap-2"
                        >
                          {isSaving ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <ShieldCheck className="w-4 h-4" />
                          )}
                          <span>Salvar Permissões do Usuário</span>
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="p-8 bg-white rounded-2xl border border-slate-200 text-center text-xs text-slate-500">
                    Selecione um usuário à esquerda para configurar suas permissões.
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* MODELOS PADRÃO POR PAPEL */
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Modelo Padrão de Permissões por Papel ({ROLE_METADATA[selectedRoleForTemplate].label})
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    {ROLE_METADATA[selectedRoleForTemplate].description}
                  </p>
                </div>

                <select
                  value={selectedRoleForTemplate}
                  onChange={(e) => setSelectedRoleForTemplate(e.target.value as UserRole)}
                  className="px-3 py-2 text-xs font-bold border border-slate-300 rounded-xl bg-white"
                >
                  {ALL_USER_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_METADATA[r].label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 text-[11px]">
                      <th className="py-2 px-3 text-left">Menu / Módulo</th>
                      {PERM_COLUMNS.map((col) => (
                        <th key={col.key} className="py-2 px-2 text-center">
                          {col.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {MENU_DEFINITIONS.map((def) => {
                      const row = roleTemplateDraft[def.key];
                      const lockedSuper = selectedRoleForTemplate === 'super_admin' && currentRole !== 'super_admin';
                      return (
                        <tr key={def.key} className="hover:bg-slate-50/70">
                          <td className="py-2.5 px-3">
                            <span className="font-bold text-slate-900 block">{def.label}</span>
                            <span className="text-[10px] text-slate-400">{def.description}</span>
                          </td>
                          {PERM_COLUMNS.map((col) => {
                            const supported =
                              (col.key === 'canDelete' ? def.supportsDelete : true) &&
                              (col.key === 'canAdmin' ? def.supportsAdmin : true);
                            return (
                              <td key={col.key} className="py-2.5 px-2 text-center">
                                {supported ? (
                                  <input
                                    type="checkbox"
                                    checked={Boolean(row?.[col.key])}
                                    disabled={!canAdminTeam || lockedSuper}
                                    onChange={() => toggleRoleTemplateCell(def.key, col.key)}
                                    className="rounded text-purple-600 focus:ring-purple-500 cursor-pointer disabled:opacity-40"
                                  />
                                ) : (
                                  <span className="text-slate-300">—</span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {canAdminTeam && (
                <div className="flex justify-end pt-2">
                  <button
                    type="button"
                    disabled={
                      isSaving ||
                      (selectedRoleForTemplate === 'super_admin' && currentRole !== 'super_admin')
                    }
                    onClick={() => void handleSaveRoleTemplate()}
                    className="px-5 py-2.5 text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 disabled:opacity-60 rounded-xl shadow-xs flex items-center gap-2"
                  >
                    {isSaving ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Check className="w-4 h-4" />
                    )}
                    <span>Salvar Padrão do Papel</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* =====================================================================
          SEÇÃO 5: FILIAIS E VÍNCULOS
          ===================================================================== */}
      {activeTab === 'branches_links' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {branches.map((branch) => {
            const branchProfs = professionals.filter((p) => p.branchIds.includes(branch.id));
            const branchUsers = users.filter(
              (u) =>
                u.role === 'super_admin' ||
                u.role === 'clinic_admin' ||
                u.defaultBranchId === branch.id ||
                u.authorizedBranchIds?.includes(branch.id)
            );

            return (
              <div
                key={branch.id}
                className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-4"
              >
                <div className="flex items-start justify-between border-b border-slate-100 pb-3">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-sky-600" />
                      <span>{branch.name}</span>
                    </h3>
                    <span className="text-[11px] text-slate-500">
                      {branch.city}/{branch.state} · Código {branch.code} ·{' '}
                      {branch.patientSharingMode === 'model_b'
                        ? 'Compartilhamento Modelo B'
                        : 'Isolamento Modelo A'}
                    </span>
                  </div>
                  <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold">
                    {branch.isHeadquarters ? 'Matriz' : 'Filial'}
                  </span>
                </div>

                <div className="space-y-2">
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                    Profissionais Vinculados ({branchProfs.length})
                  </span>
                  {branchProfs.length > 0 ? (
                    <div className="space-y-1.5">
                      {branchProfs.map((p) => (
                        <div
                          key={p.id}
                          className="p-2 rounded-xl bg-slate-50 border border-slate-200 text-xs flex items-center justify-between"
                        >
                          <div>
                            <span className="font-bold text-slate-800">{p.fullName}</span>
                            <span className="text-[11px] text-slate-500 ml-2 font-mono">
                              {p.councilNumber}
                            </span>
                          </div>
                          <span
                            className={`text-[10px] font-bold ${
                              p.isActive !== false ? 'text-emerald-700' : 'text-rose-600'
                            }`}
                          >
                            {p.isActive !== false ? 'Ativo' : 'Inativo'}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400">Nenhum profissional vinculado.</p>
                  )}
                </div>

                <div className="space-y-2">
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                    Usuários com Acesso à Unidade ({branchUsers.length})
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {branchUsers.map((u) => (
                      <span
                        key={u.id}
                        className="px-2.5 py-1 rounded-lg bg-sky-50 text-sky-800 border border-sky-200 text-[11px] font-semibold"
                      >
                        {u.fullName} ({ROLE_METADATA[u.role]?.shortLabel})
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* =====================================================================
          MODAL: CADASTRAR / EDITAR PROFISSIONAL
          ===================================================================== */}
      {profModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 space-y-4 my-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">
                {editingProfId ? 'Editar Profissional de Saúde' : 'Cadastrar Profissional de Saúde'}
              </h3>
              <button
                type="button"
                onClick={() => setProfModalOpen(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveProfessional} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Nome Completo *</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Dr. Newton Mureb"
                  value={profName}
                  onChange={(e) => setProfName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Registro no Conselho *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="CRM/RJ 52-444985"
                    value={profCouncil}
                    onChange={(e) => setProfCouncil(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Especialidade</label>
                  <select
                    value={profSpecialtyId}
                    onChange={(e) => setProfSpecialtyId(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  >
                    {specialties.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.councilType})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Telefone Celular</label>
                  <input
                    type="text"
                    placeholder="(22) 99908-9122"
                    value={profPhone}
                    onChange={(e) => setProfPhone(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">E-mail Profissional</label>
                  <input
                    type="email"
                    placeholder="contato@drnewtonmureb.com.br"
                    value={profEmail}
                    onChange={(e) => setProfEmail(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Vincular Usuário de Acesso ao Sistema (opcional)
                </label>
                <select
                  value={profLinkedUserId}
                  onChange={(e) => setProfLinkedUserId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                >
                  <option value="">Sem vínculo com usuário do sistema</option>
                  {users
                    .filter((u) => u.role !== 'patient')
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.fullName} ({u.email})
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Filiais de Atendimento *
                </label>
                <div className="flex flex-wrap gap-2">
                  {branches.map((b) => {
                    const checked = profBranchIds.includes(b.id);
                    return (
                      <label
                        key={b.id}
                        className="flex items-center gap-1.5 p-2 bg-slate-50 border border-slate-200 rounded-lg cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setProfBranchIds((prev) =>
                              checked ? prev.filter((id) => id !== b.id) : [...prev, b.id]
                            )
                          }
                          className="rounded text-sky-600"
                        />
                        <span>{b.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Mini Biografia</label>
                <textarea
                  rows={2}
                  value={profBio}
                  onChange={(e) => setProfBio(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              <label className="flex items-center gap-2 p-2.5 rounded-lg bg-slate-50 border border-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={profIsActive}
                  onChange={(e) => setProfIsActive(e.target.checked)}
                  className="rounded text-emerald-600"
                />
                <span className="font-semibold text-slate-800">
                  Profissional ativo na agenda e atendimentos
                </span>
              </label>

              <div className="pt-3 flex justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setProfModalOpen(false)}
                  className="px-3 py-2 text-slate-600 hover:text-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-4 py-2 text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-60 rounded-lg flex items-center gap-1.5"
                >
                  {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>{editingProfId ? 'Salvar Alterações' : 'Cadastrar Profissional'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL: VISUALIZAR PROFISSIONAL
          ===================================================================== */}
      {viewingProfessional && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 space-y-4 text-xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">Detalhes do Profissional</h3>
              <button onClick={() => setViewingProfessional(null)} className="text-slate-400 hover:text-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-2 text-slate-700">
              <p><strong>Nome:</strong> {viewingProfessional.fullName}</p>
              <p><strong>Conselho:</strong> {viewingProfessional.councilNumber}</p>
              <p><strong>Especialidade:</strong> {viewingProfessional.specialtyName || 'Não informada'}</p>
              <p><strong>E-mail:</strong> {viewingProfessional.email || '—'}</p>
              <p><strong>Telefone:</strong> {viewingProfessional.phone || '—'}</p>
              <p><strong>Status:</strong> {viewingProfessional.isActive !== false ? 'Ativo' : 'Inativo'}</p>
              <p><strong>Biografia:</strong> {viewingProfessional.bio || '—'}</p>
            </div>
            <div className="pt-3 border-t border-slate-100 flex justify-end">
              <button
                type="button"
                onClick={() => setViewingProfessional(null)}
                className="px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 font-semibold text-slate-700"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL: CADASTRAR NOVO USUÁRIO
          ===================================================================== */}
      {createUserModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 space-y-4 my-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">Cadastrar Novo Usuário do Sistema</h3>
                <p className="text-[11px] text-slate-500">
                  Cria conta autenticada, perfil na clínica, filiais autorizadas e permissões iniciais.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCreateUserModalOpen(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateUser} className="space-y-3 text-xs">
              <div className="p-2.5 rounded-xl bg-sky-50/70 border border-sky-200 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-sky-700 shrink-0" />
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-sky-800 block">
                      Organização / Clínica Autorizada
                    </span>
                    <span className="font-bold text-slate-900 text-xs">{organization.name}</span>
                  </div>
                </div>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-white border border-sky-200 text-sky-800">
                  Isolamento Ativo
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Nome Completo *</label>
                  <input
                    type="text"
                    required
                    value={newUserName}
                    onChange={(e) => setNewUserName(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">E-mail de Login *</label>
                  <input
                    type="email"
                    required
                    value={newUserEmail}
                    onChange={(e) => setNewUserEmail(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Telefone / WhatsApp</label>
                  <input
                    type="text"
                    value={newUserPhone}
                    onChange={(e) => setNewUserPhone(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Papel / Perfil *</label>
                  <select
                    value={newUserRole}
                    onChange={(e) => {
                      const nextRole = e.target.value as UserRole;
                      setNewUserRole(nextRole);
                      setNewUserCustomPerms(resolveEffectivePermissions(nextRole, roleTemplates));
                    }}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-semibold"
                  >
                    {ALL_USER_ROLES.filter((r) => canActorAssignRole(currentRole, r)).map((r) => (
                      <option key={r} value={r}>
                        {ROLE_METADATA[r].label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Filial Padrão</label>
                  <select
                    value={newUserDefaultBranchId}
                    onChange={(e) => {
                      const bid = e.target.value;
                      setNewUserDefaultBranchId(bid);
                      if (bid && !newUserAuthorizedBranches.includes(bid)) {
                        setNewUserAuthorizedBranches([...newUserAuthorizedBranches, bid]);
                      }
                    }}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  >
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Vincular Profissional (opcional)
                  </label>
                  <select
                    value={newUserLinkedProfId}
                    onChange={(e) => setNewUserLinkedProfId(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  >
                    <option value="">Nenhum profissional vinculado</option>
                    {professionals.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.fullName} ({p.councilNumber})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Filiais Autorizadas</label>
                <div className="flex flex-wrap gap-2">
                  {branches.map((b) => {
                    const checked = newUserAuthorizedBranches.includes(b.id);
                    return (
                      <label
                        key={b.id}
                        className="flex items-center gap-1.5 p-2 bg-slate-50 border border-slate-200 rounded-lg cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setNewUserAuthorizedBranches((prev) =>
                              checked ? prev.filter((id) => id !== b.id) : [...prev, b.id]
                            )
                          }
                          className="rounded text-sky-600"
                        />
                        <span>{b.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                <span className="font-bold text-slate-800 block">Forma de Ativação de Credenciais</span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <label className="flex items-center gap-2 p-2 rounded-lg border border-slate-200 bg-white cursor-pointer">
                    <input
                      type="radio"
                      name="authMode"
                      checked={newUserAuthMode === 'password'}
                      onChange={() => setNewUserAuthMode('password')}
                    />
                    <KeyRound className="w-3.5 h-3.5 text-sky-600" />
                    <span>Definir senha inicial agora</span>
                  </label>
                  <label className="flex items-center gap-2 p-2 rounded-lg border border-slate-200 bg-white cursor-pointer">
                    <input
                      type="radio"
                      name="authMode"
                      checked={newUserAuthMode === 'invite'}
                      onChange={() => setNewUserAuthMode('invite')}
                    />
                    <Mail className="w-3.5 h-3.5 text-purple-600" />
                    <span>Enviar convite por e-mail</span>
                  </label>
                </div>

                {newUserAuthMode === 'password' && (
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Senha Inicial (mínimo 8 caracteres) *
                    </label>
                    <input
                      type="password"
                      required
                      minLength={8}
                      value={newUserPassword}
                      onChange={(e) => setNewUserPassword(e.target.value)}
                      placeholder="Crie uma senha forte inicial"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono bg-white"
                    />
                  </div>
                )}
              </div>

              {canAdminTeam && (
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setShowNewUserCustomPerms((prev) => !prev)}
                    className="w-full px-3 py-2.5 bg-slate-50 hover:bg-slate-100 flex items-center justify-between text-left font-semibold text-slate-800"
                  >
                    <span className="flex items-center gap-2">
                      <Sliders className="w-3.5 h-3.5 text-purple-600" />
                      <span>Personalizar permissões individuais por menu (opcional)</span>
                    </span>
                    <span className="text-[11px] text-sky-700">
                      {showNewUserCustomPerms ? 'Ocultar matriz' : 'Ajustar permissões'}
                    </span>
                  </button>

                  {showNewUserCustomPerms && (
                    <div className="p-3 bg-white overflow-x-auto max-h-60 overflow-y-auto border-t border-slate-200">
                      <table className="w-full text-[11px]">
                        <thead>
                          <tr className="border-b border-slate-200 text-slate-600">
                            <th className="py-1.5 px-2 text-left">Menu</th>
                            {PERM_COLUMNS.map((col) => (
                              <th key={col.key} className="py-1.5 px-1.5 text-center">
                                {col.short}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {MENU_DEFINITIONS.map((def) => {
                            const row = newUserCustomPerms[def.key];
                            return (
                              <tr key={def.key}>
                                <td className="py-1.5 px-2 font-semibold text-slate-800">{def.label}</td>
                                {PERM_COLUMNS.map((col) => {
                                  const supported =
                                    (col.key === 'canDelete' ? def.supportsDelete : true) &&
                                    (col.key === 'canAdmin' ? def.supportsAdmin : true);
                                  const actorAllowed =
                                    currentRole === 'super_admin' ||
                                    Boolean(actorEffectivePermissions[def.key]?.[col.key]);
                                  return (
                                    <td key={col.key} className="py-1.5 px-1.5 text-center">
                                      {supported ? (
                                        <input
                                          type="checkbox"
                                          checked={Boolean(row?.[col.key])}
                                          disabled={!row?.[col.key] && !actorAllowed}
                                          onChange={() => toggleNewUserPermCell(def.key, col.key)}
                                          className="rounded text-sky-600 disabled:opacity-40"
                                        />
                                      ) : (
                                        <span className="text-slate-300">—</span>
                                      )}
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              <label className="flex items-center gap-2 p-2.5 rounded-lg bg-slate-50 border border-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newUserIsActive}
                  onChange={(e) => setNewUserIsActive(e.target.checked)}
                  className="rounded text-emerald-600"
                />
                <span className="font-semibold text-slate-800">Conta ativa imediatamente</span>
              </label>

              <div className="pt-3 flex justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setCreateUserModalOpen(false)}
                  className="px-3 py-2 text-slate-600 hover:text-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-4 py-2 text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-60 rounded-lg flex items-center gap-1.5"
                >
                  {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Criar Usuário</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL: EDITAR USUÁRIO
          ===================================================================== */}
      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 space-y-4 my-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">Editar Usuário</h3>
                <p className="text-[11px] text-slate-500 font-mono">{editingUser.email}</p>
              </div>
              <button
                type="button"
                onClick={() => setEditingUser(null)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEditedUser} className="space-y-3 text-xs">
              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-2">
                <div>
                  <span className="text-[10px] font-bold uppercase text-slate-500 block">
                    Organização / Clínica
                  </span>
                  <span className="font-bold text-slate-900">{organization.name}</span>
                </div>
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() => void handleResendLink(editingUser, 'recovery')}
                  className="px-2.5 py-1.5 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 font-semibold flex items-center gap-1"
                >
                  <Send className="w-3 h-3" />
                  <span>Enviar link de senha</span>
                </button>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Nome Completo</label>
                <input
                  type="text"
                  required
                  value={editUserName}
                  onChange={(e) => setEditUserName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Telefone</label>
                  <input
                    type="text"
                    value={editUserPhone}
                    onChange={(e) => setEditUserPhone(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Papel / Perfil</label>
                  <select
                    value={editUserRole}
                    disabled={editingUser.id === currentUser.id && currentRole !== 'super_admin'}
                    onChange={(e) => {
                      const nextRole = e.target.value as UserRole;
                      setEditUserRole(nextRole);
                      setEditUserPermsDraft((prev) =>
                        applyRoleChangePreservingOverrides(nextRole, prev, roleTemplates)
                      );
                    }}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-semibold"
                  >
                    {ALL_USER_ROLES.filter(
                      (r) => canActorAssignRole(currentRole, r) || r === editingUser.role
                    ).map((r) => (
                      <option key={r} value={r}>
                        {ROLE_METADATA[r].label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Filial Padrão</label>
                <select
                  value={editUserDefaultBranchId}
                  onChange={(e) => setEditUserDefaultBranchId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                >
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Filiais Autorizadas</label>
                <div className="flex flex-wrap gap-2">
                  {branches.map((b) => {
                    const checked = editUserAuthorizedBranches.includes(b.id);
                    return (
                      <label
                        key={b.id}
                        className="flex items-center gap-1.5 p-2 bg-slate-50 border border-slate-200 rounded-lg cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setEditUserAuthorizedBranches((prev) =>
                              checked ? prev.filter((id) => id !== b.id) : [...prev, b.id]
                            )
                          }
                          className="rounded text-sky-600"
                        />
                        <span>{b.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <label className="flex items-center gap-2 p-2.5 rounded-lg bg-slate-50 border border-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editUserIsActive}
                  disabled={editingUser.id === currentUser.id}
                  onChange={(e) => setEditUserIsActive(e.target.checked)}
                  className="rounded text-emerald-600"
                />
                <span className="font-semibold text-slate-800">
                  Usuário ativo (desmarcar bloqueia o login imediatamente)
                </span>
              </label>

              <div className="pt-3 flex justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  className="px-3 py-2 text-slate-600 hover:text-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-4 py-2 text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-60 rounded-lg flex items-center gap-1.5"
                >
                  {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Salvar Usuário</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL: DETALHES DO USUÁRIO
          ===================================================================== */}
      {viewingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 space-y-4 text-xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">{viewingUser.fullName}</h3>
                <span className="text-[11px] text-slate-500 font-mono">{viewingUser.email}</span>
              </div>
              <button onClick={() => setViewingUser(null)} className="text-slate-400 hover:text-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-slate-700">
              <p><strong>Papel:</strong> {ROLE_METADATA[viewingUser.role]?.label}</p>
              <p><strong>Status:</strong> {viewingUser.isActive !== false ? 'Ativo' : 'Inativo'}</p>
              <p><strong>Telefone:</strong> {viewingUser.phone || '—'}</p>
              <p>
                <strong>Criado em:</strong>{' '}
                {viewingUser.createdAt
                  ? new Date(viewingUser.createdAt).toLocaleString('pt-BR')
                  : '—'}
              </p>
            </div>

            <div className="space-y-1.5">
              <span className="font-bold text-slate-800 block">Menus Efetivamente Liberados</span>
              <div className="flex flex-wrap gap-1.5">
                {MENU_DEFINITIONS.map((def) => {
                  const eff = resolveEffectivePermissions(
                    viewingUser.role,
                    roleTemplates,
                    viewingUser.permissions
                  )[def.key];
                  return (
                    <span
                      key={def.key}
                      className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${
                        eff.canView
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                          : 'bg-slate-100 text-slate-400 border-slate-200'
                      }`}
                    >
                      {eff.canView ? '✓ ' : '✕ '}
                      {def.label}
                      {eff.isCustomOverride ? ' *' : ''}
                    </span>
                  );
                })}
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 flex justify-between">
              {canEditTeam && (
                <button
                  type="button"
                  onClick={() => void handleResendLink(viewingUser, 'invite')}
                  className="px-3 py-1.5 rounded-lg bg-purple-50 text-purple-700 border border-purple-200 font-semibold flex items-center gap-1"
                >
                  <Mail className="w-3.5 h-3.5" />
                  <span>Reenviar Convite</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setViewingUser(null)}
                className="px-4 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 font-semibold text-slate-700 ml-auto"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
