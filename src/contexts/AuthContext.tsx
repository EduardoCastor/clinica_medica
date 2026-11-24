import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  MenuKey,
  RolePermissionTemplate,
  UserMenuPermissionRecord,
  UserProfile,
  UserRole,
} from '../types';
import { StorageService } from '../services/storage';
import { DomainResolver, PRODUCTION_DOMAINS } from '../services/domainResolver';
import { getSupabase, getSupabaseCredentials } from '../services/supabaseClient';
import {
  DEFAULT_ROLE_PERMISSIONS,
  PermissionAction,
  resolveEffectivePermissions,
} from '../services/rbacConfig';
import { BootstrapStatus, TeamCloudService } from '../services/teamCloudService';

export type SimplePermAction = 'view' | 'consult' | 'create' | 'edit' | 'delete' | 'admin';

export const AUTHORIZED_FIRST_ACCESS_EMAIL = 'admin@drnewtonmureb.com.br';
const PENDING_BOOTSTRAP_NAME_KEY = 'medsync_pending_bootstrap_name';

interface SignInResult {
  success: boolean;
  error?: string;
  role?: UserRole;
}

interface FirstAccessRegistrationResult {
  success: boolean;
  requiresEmailConfirmation?: boolean;
  autoActivated?: boolean;
  error?: string;
}

interface AuthContextType {
  currentUser: UserProfile;
  currentRole: UserRole;
  isAuthenticated: boolean;
  isAuthLoading: boolean;
  isSupabaseAuthMode: boolean;
  isDevSimulationMode: boolean;
  authError: string | null;
  clearAuthError: () => void;
  bootstrapStatus: BootstrapStatus;
  isCheckingBootstrap: boolean;
  refreshBootstrapStatus: () => Promise<BootstrapStatus>;
  registerFirstAccessSuperAdmin: (params: {
    fullName: string;
    email: string;
    password: string;
    confirmPassword: string;
  }) => Promise<FirstAccessRegistrationResult>;
  resendFirstAccessConfirmation: (email: string) => Promise<{ success: boolean; error?: string }>;
  signInWithEmail: (email: string, password: string, expectedScope?: 'saas_admin' | 'clinic') => Promise<SignInResult>;
  sendPasswordReset: (email: string) => Promise<{ success: boolean; error?: string }>;
  refreshSessionProfile: () => Promise<void>;
  switchUser: (userId: string) => void;
  login: (userId: string) => void;
  logout: () => Promise<void>;
  impersonateClinic: (clinicId: string) => void;
  stopImpersonation: () => void;
  isImpersonating: boolean;
  impersonatedClinicId: string | null;
  usersList: UserProfile[];
  roleTemplates: Record<UserRole, RolePermissionTemplate>;
  effectivePermissions: Record<MenuKey, UserMenuPermissionRecord>;
  hasMenuAccess: (menuKey: MenuKey, action?: SimplePermAction) => boolean;
  canViewMenu: (menuKey: MenuKey) => boolean;
  canConsultMenu: (menuKey: MenuKey) => boolean;
  canCreateInMenu: (menuKey: MenuKey) => boolean;
  canEditInMenu: (menuKey: MenuKey) => boolean;
  canDeleteInMenu: (menuKey: MenuKey) => boolean;
  canAdminMenu: (menuKey: MenuKey) => boolean;
  canViewMedicalRecords: boolean;
  canEditMedicalRecords: boolean;
  canManageFinances: boolean;
  canManageSchedules: boolean;
  canManageClinicSettings: boolean;
  isSuperAdmin: boolean;
}

const DEV_AUTH_FLAG_KEY = 'medsync_dev_session_active';

const ACTION_MAP: Record<SimplePermAction, PermissionAction> = {
  view: 'canView',
  consult: 'canConsult',
  create: 'canCreate',
  edit: 'canEdit',
  delete: 'canDelete',
  admin: 'canAdmin',
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const FALLBACK_GUEST_USER: UserProfile = {
  id: 'guest',
  organizationId: '',
  fullName: 'Visitante não autenticado',
  email: '',
  phone: '',
  role: 'patient',
  isActive: false,
};

const INITIAL_BOOTSTRAP_STATUS: BootstrapStatus = {
  needsBootstrap: false,
  alreadyInitialized: false,
  organizationFound: false,
  organizationName: 'Clínica Dr Newton Mureb',
  checkedFromCloud: false,
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const isSupabaseAuthMode = getSupabaseCredentials().isConfigured;
  const isDevSimulationMode = Boolean(
    import.meta.env.DEV && !isSupabaseAuthMode && DomainResolver.isSimulationAllowed()
  );

  const [usersList, setUsersList] = useState<UserProfile[]>(() => StorageService.getUsers());
  const [roleTemplates, setRoleTemplates] = useState<Record<UserRole, RolePermissionTemplate>>(() =>
    StorageService.getRolePermissions()
  );
  const [cloudUser, setCloudUser] = useState<UserProfile | null>(null);
  const [cloudEffectivePerms, setCloudEffectivePerms] = useState<Record<
    MenuKey,
    UserMenuPermissionRecord
  > | null>(null);

  const [activeUserId, setActiveUserId] = useState<string>(() => StorageService.getActiveUserId());
  const [isAuthLoading, setIsAuthLoading] = useState<boolean>(isSupabaseAuthMode);
  const [authError, setAuthError] = useState<string | null>(null);
  const [bootstrapStatus, setBootstrapStatus] = useState<BootstrapStatus>(INITIAL_BOOTSTRAP_STATUS);
  const [isCheckingBootstrap, setIsCheckingBootstrap] = useState<boolean>(isSupabaseAuthMode);

  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    if (isSupabaseAuthMode) return false;
    if (!import.meta.env.DEV) return false;
    if (typeof window === 'undefined') return false;
    return sessionStorage.getItem(DEV_AUTH_FLAG_KEY) === 'true';
  });
  const [impersonatedClinicId, setImpersonatedClinicId] = useState<string | null>(() =>
    DomainResolver.getImpersonatedClinicId()
  );

  const refreshBootstrapStatus = useCallback(async (): Promise<BootstrapStatus> => {
    if (!isSupabaseAuthMode) {
      const localStatus: BootstrapStatus = {
        needsBootstrap: false,
        alreadyInitialized: true,
        organizationFound: true,
        organizationName: 'Clínica Dr Newton Mureb',
        checkedFromCloud: false,
      };
      setBootstrapStatus(localStatus);
      setIsCheckingBootstrap(false);
      return localStatus;
    }

    setIsCheckingBootstrap(true);
    try {
      const status = await TeamCloudService.fetchBootstrapStatus();
      setBootstrapStatus(status);
      return status;
    } finally {
      setIsCheckingBootstrap(false);
    }
  }, [isSupabaseAuthMode]);

  const attemptAuthorizedFirstAccessBootstrap = useCallback(async (): Promise<{
    bootstrapped: boolean;
    error?: string;
  }> => {
    const supabase = getSupabase();
    if (!supabase) return { bootstrapped: false };

    const { data: userRes } = await supabase.auth.getUser();
    const authUser = userRes?.user;
    if (!authUser) return { bootstrapped: false };

    const authEmail = (authUser.email || '').trim().toLowerCase();
    if (authEmail !== AUTHORIZED_FIRST_ACCESS_EMAIL) {
      return { bootstrapped: false };
    }

    if (!authUser.email_confirmed_at) {
      return {
        bootstrapped: false,
        error: 'Confirme seu e-mail antes de concluir o primeiro acesso.',
      };
    }

    const status = await TeamCloudService.fetchBootstrapStatus();
    setBootstrapStatus(status);
    if (!status.checkedFromCloud || !status.needsBootstrap) {
      return {
        bootstrapped: false,
        error: status.alreadyInitialized
          ? 'O administrador principal da Clínica Dr Newton Mureb já foi inicializado.'
          : undefined,
      };
    }

    const pendingName =
      (typeof window !== 'undefined' && sessionStorage.getItem(PENDING_BOOTSTRAP_NAME_KEY)) ||
      (typeof authUser.user_metadata?.full_name === 'string'
        ? authUser.user_metadata.full_name
        : '') ||
      'Administrador Clínica Dr Newton Mureb';

    const res = await TeamCloudService.bootstrapFirstSuperAdmin(pendingName);
    if (!res.success) {
      return { bootstrapped: false, error: res.error };
    }

    if (typeof window !== 'undefined') {
      sessionStorage.removeItem(PENDING_BOOTSTRAP_NAME_KEY);
    }
    await refreshBootstrapStatus();
    return { bootstrapped: true };
  }, [refreshBootstrapStatus]);

  const applySessionContextToTenant = useCallback(async () => {
    const supabase = getSupabase();
    if (!supabase) {
      setIsAuthLoading(false);
      return;
    }

    try {
      let ctx = await TeamCloudService.fetchCurrentUserSessionContext();
      if (!ctx.authenticated) {
        setCloudUser(null);
        setCloudEffectivePerms(null);
        setIsAuthenticated(false);
        return;
      }

      if (!ctx.profileFound || !ctx.profile) {
        const bootAttempt = await attemptAuthorizedFirstAccessBootstrap();
        if (bootAttempt.bootstrapped) {
          ctx = await TeamCloudService.fetchCurrentUserSessionContext();
        } else if (bootAttempt.error) {
          await supabase.auth.signOut();
          setCloudUser(null);
          setCloudEffectivePerms(null);
          setIsAuthenticated(false);
          setAuthError(bootAttempt.error);
          return;
        }
      }

      if (!ctx.profileFound || !ctx.profile) {
        await supabase.auth.signOut();
        setCloudUser(null);
        setCloudEffectivePerms(null);
        setIsAuthenticated(false);
        setAuthError(
          ctx.error ||
            'Conta autenticada sem perfil ativo vinculado. Contate o administrador da clínica.'
        );
        return;
      }

      if (!ctx.profile.isActive) {
        await supabase.auth.signOut();
        setCloudUser(null);
        setCloudEffectivePerms(null);
        setIsAuthenticated(false);
        setAuthError('Este usuário está desativado. Procure o administrador da clínica.');
        return;
      }

      if (ctx.organization) {
        StorageService.updateOrganizationCache(ctx.organization);
      }
      if (ctx.branches && ctx.branches.length > 0) {
        StorageService.replaceBranchesCache(ctx.branches);
        if (
          ctx.profile.role !== 'super_admin' &&
          ctx.profile.role !== 'clinic_admin' &&
          ctx.profile.defaultBranchId
        ) {
          const currentBranch = StorageService.getActiveBranchId();
          const allowed = ctx.profile.authorizedBranchIds || [];
          if (currentBranch === 'all' || (allowed.length > 0 && !allowed.includes(currentBranch))) {
            StorageService.setActiveBranchId(ctx.profile.defaultBranchId);
          }
        }
      }
      if (ctx.roleTemplates) {
        const mergedTemplates: Record<UserRole, RolePermissionTemplate> = {
          ...DEFAULT_ROLE_PERMISSIONS,
          ...(ctx.roleTemplates as Partial<Record<UserRole, RolePermissionTemplate>>),
        };
        setRoleTemplates(mergedTemplates);
        StorageService.saveRolePermissions(mergedTemplates);
      }

      setCloudUser(ctx.profile);
      setCloudEffectivePerms(ctx.effectivePermissions || null);
      StorageService.saveUser(ctx.profile);
      StorageService.setActiveUserId(ctx.profile.id);
      setActiveUserId(ctx.profile.id);
      setIsAuthenticated(true);
      setAuthError(null);
      setBootstrapStatus((prev) => ({
        ...prev,
        needsBootstrap: false,
        alreadyInitialized: true,
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setAuthError(`Erro ao restaurar sessão: ${msg}`);
      setIsAuthenticated(false);
    } finally {
      setIsAuthLoading(false);
    }
  }, [attemptAuthorizedFirstAccessBootstrap]);

  useEffect(() => {
    const handleStorageUpdate = () => {
      setUsersList(StorageService.getUsers());
      setRoleTemplates(StorageService.getRolePermissions());
      setActiveUserId(StorageService.getActiveUserId());
      setImpersonatedClinicId(DomainResolver.getImpersonatedClinicId());
    };
    window.addEventListener('medsync_storage_update', handleStorageUpdate);
    window.addEventListener('medsync_domain_simulation_changed', handleStorageUpdate);
    return () => {
      window.removeEventListener('medsync_storage_update', handleStorageUpdate);
      window.removeEventListener('medsync_domain_simulation_changed', handleStorageUpdate);
    };
  }, []);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) {
      setIsAuthLoading(false);
      setIsCheckingBootstrap(false);
      return;
    }

    let mounted = true;
    void refreshBootstrapStatus();
    void applySessionContextToTenant();

    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (!mounted) return;
      if (event === 'SIGNED_OUT') {
        setCloudUser(null);
        setCloudEffectivePerms(null);
        setIsAuthenticated(false);
        setIsAuthLoading(false);
        return;
      }
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        void applySessionContextToTenant();
      }
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [applySessionContextToTenant, refreshBootstrapStatus]);

  const currentUser: UserProfile = useMemo(() => {
    if (isSupabaseAuthMode) {
      return cloudUser || FALLBACK_GUEST_USER;
    }
    if (!isAuthenticated) {
      return FALLBACK_GUEST_USER;
    }
    return (
      usersList.find((u) => u.id === activeUserId) ||
      usersList.find((u) => u.id === 'usr_doctor_newton') ||
      usersList[0] ||
      FALLBACK_GUEST_USER
    );
  }, [isSupabaseAuthMode, cloudUser, isAuthenticated, usersList, activeUserId]);

  const currentRole: UserRole = currentUser.role;

  const effectivePermissions = useMemo(() => {
    if (isSupabaseAuthMode && cloudEffectivePerms) {
      return cloudEffectivePerms;
    }
    return resolveEffectivePermissions(currentRole, roleTemplates, currentUser.permissions);
  }, [isSupabaseAuthMode, cloudEffectivePerms, currentRole, roleTemplates, currentUser.permissions]);

  const registerFirstAccessSuperAdmin = async ({
    fullName,
    email,
    password,
    confirmPassword,
  }: {
    fullName: string;
    email: string;
    password: string;
    confirmPassword: string;
  }): Promise<FirstAccessRegistrationResult> => {
    setAuthError(null);
    const cleanName = fullName.trim();
    const cleanEmail = email.trim().toLowerCase();

    if (cleanName.length < 3) {
      return { success: false, error: 'Informe o nome completo do responsável pela clínica.' };
    }

    if (cleanEmail !== AUTHORIZED_FIRST_ACCESS_EMAIL) {
      return {
        success: false,
        error: `Somente o e-mail oficial autorizado (${AUTHORIZED_FIRST_ACCESS_EMAIL}) pode realizar o primeiro acesso.`,
      };
    }

    if (password.length < 8) {
      return {
        success: false,
        error: 'A senha deve conter no mínimo 8 caracteres.',
      };
    }

    if (password !== confirmPassword) {
      return {
        success: false,
        error: 'A senha e a confirmação de senha não coincidem.',
      };
    }

    const supabase = getSupabase();
    if (!supabase) {
      return {
        success: false,
        error: 'Conexão com o serviço de autenticação não configurada neste ambiente.',
      };
    }

    const freshStatus = await refreshBootstrapStatus();
    if (!freshStatus.checkedFromCloud || !freshStatus.needsBootstrap || freshStatus.alreadyInitialized) {
      return {
        success: false,
        error:
          'O primeiro acesso da Clínica Dr Newton Mureb já foi concluído ou não está disponível. Utilize a tela de login.',
      };
    }

    if (typeof window !== 'undefined') {
      sessionStorage.setItem(PENDING_BOOTSTRAP_NAME_KEY, cleanName);
    }

    const emailRedirectTo = typeof window !== 'undefined' ? window.location.origin : undefined;
    const { data, error } = await supabase.auth.signUp({
      email: cleanEmail,
      password,
      options: {
        emailRedirectTo,
        data: {
          full_name: cleanName,
        },
      },
    });

    if (error) {
      const lower = error.message.toLowerCase();
      if (lower.includes('already registered') || lower.includes('already exists')) {
        return {
          success: false,
          error:
            'Este e-mail já possui uma conta iniciada. Se você ainda não confirmou o e-mail, utilize "Reenviar e-mail de confirmação" ou entre com sua senha.',
        };
      }
      return { success: false, error: error.message };
    }

    // Se o projeto retornou identidade sem identidades novas (e-mail já cadastrado)
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      return {
        success: false,
        error:
          'Já existe um cadastro para este e-mail. Confirme seu e-mail ou utilize a aba de login para concluir o acesso.',
      };
    }

    if (data.session && data.user?.email_confirmed_at) {
      const boot = await TeamCloudService.bootstrapFirstSuperAdmin(cleanName);
      if (!boot.success) {
        await supabase.auth.signOut();
        return {
          success: false,
          error: boot.error || 'Não foi possível concluir a ativação do administrador principal.',
        };
      }
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem(PENDING_BOOTSTRAP_NAME_KEY);
      }
      await refreshBootstrapStatus();
      await applySessionContextToTenant();
      return { success: true, autoActivated: true };
    }

    if (data.session && !data.user?.email_confirmed_at) {
      await supabase.auth.signOut();
    }

    return {
      success: true,
      requiresEmailConfirmation: true,
    };
  };

  const resendFirstAccessConfirmation = async (
    email: string
  ): Promise<{ success: boolean; error?: string }> => {
    const cleanEmail = email.trim().toLowerCase();
    if (cleanEmail !== AUTHORIZED_FIRST_ACCESS_EMAIL) {
      return {
        success: false,
        error: `Reenvio permitido apenas para ${AUTHORIZED_FIRST_ACCESS_EMAIL}.`,
      };
    }
    const supabase = getSupabase();
    if (!supabase) {
      return { success: false, error: 'Serviço de autenticação indisponível neste ambiente.' };
    }
    const emailRedirectTo = typeof window !== 'undefined' ? window.location.origin : undefined;
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: cleanEmail,
      options: { emailRedirectTo },
    });
    if (error) {
      return { success: false, error: error.message };
    }
    return { success: true };
  };

  const signInWithEmail = async (
    email: string,
    password: string,
    expectedScope?: 'saas_admin' | 'clinic'
  ): Promise<SignInResult> => {
    const cleanEmail = email.trim().toLowerCase();
    setAuthError(null);

    if (!cleanEmail || !password) {
      const msg = 'Informe seu e-mail e senha de acesso.';
      setAuthError(msg);
      return { success: false, error: msg };
    }

    const supabase = getSupabase();
    if (supabase) {
      setIsAuthLoading(true);
      try {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password,
        });

        if (error || !data.session) {
          const msgLower = (error?.message || '').toLowerCase();
          const friendly =
            msgLower.includes('invalid login credentials')
              ? 'E-mail ou senha inválidos. Verifique suas credenciais ou utilize "Esqueci minha senha".'
              : msgLower.includes('email not confirmed')
              ? 'Confirme seu e-mail através do link enviado antes de entrar no sistema.'
              : error?.message || 'Não foi possível autenticar no sistema.';
          setAuthError(friendly);
          setIsAuthLoading(false);
          return { success: false, error: friendly };
        }

        let ctx = await TeamCloudService.fetchCurrentUserSessionContext();
        if (!ctx.profileFound || !ctx.profile) {
          const bootAttempt = await attemptAuthorizedFirstAccessBootstrap();
          if (bootAttempt.bootstrapped) {
            ctx = await TeamCloudService.fetchCurrentUserSessionContext();
          } else if (bootAttempt.error) {
            await supabase.auth.signOut();
            setAuthError(bootAttempt.error);
            setIsAuthLoading(false);
            return { success: false, error: bootAttempt.error };
          }
        }

        if (!ctx.profileFound || !ctx.profile) {
          await supabase.auth.signOut();
          const msg =
            ctx.error || 'Conta autenticada sem perfil ativo vinculado à clínica.';
          setAuthError(msg);
          setIsAuthLoading(false);
          return { success: false, error: msg };
        }

        if (!ctx.profile.isActive) {
          await supabase.auth.signOut();
          const msg = 'Usuário desativado. Solicite a reativação ao administrador da clínica.';
          setAuthError(msg);
          setIsAuthLoading(false);
          return { success: false, error: msg };
        }

        if (expectedScope === 'saas_admin' && ctx.profile.role !== 'super_admin') {
          await supabase.auth.signOut();
          const msg = 'Acesso restrito: este painel é exclusivo para Super Administradores.';
          setAuthError(msg);
          setIsAuthLoading(false);
          return { success: false, error: msg };
        }

        if (ctx.profile.role === 'patient' && expectedScope === 'clinic') {
          await supabase.auth.signOut();
          const msg = 'Perfis de paciente não possuem acesso ao painel interno da clínica.';
          setAuthError(msg);
          setIsAuthLoading(false);
          return { success: false, error: msg };
        }

        await applySessionContextToTenant();
        return { success: true, role: ctx.profile.role };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setAuthError(msg);
        setIsAuthLoading(false);
        return { success: false, error: msg };
      }
    }

    // Sem conexão em nuvem configurada: bloqueado em produção, permitido apenas em modo dev local controlado
    if (!isDevSimulationMode) {
      const msg =
        'Autenticação indisponível: a conexão com o servidor de autenticação não está configurada neste ambiente.';
      setAuthError(msg);
      return { success: false, error: msg };
    }

    const matchedLocal = usersList.find(
      (u) => u.email.toLowerCase() === cleanEmail && u.isActive !== false
    );
    if (!matchedLocal) {
      const msg = 'Usuário não encontrado ou inativo no ambiente de desenvolvimento.';
      setAuthError(msg);
      return { success: false, error: msg };
    }

    if (expectedScope === 'saas_admin' && matchedLocal.role !== 'super_admin') {
      const msg = 'Acesso restrito ao Super Administrador.';
      setAuthError(msg);
      return { success: false, error: msg };
    }

    StorageService.setActiveUserId(matchedLocal.id);
    setActiveUserId(matchedLocal.id);
    setIsAuthenticated(true);
    if (typeof window !== 'undefined') {
      sessionStorage.setItem(DEV_AUTH_FLAG_KEY, 'true');
    }
    return { success: true, role: matchedLocal.role };
  };

  const sendPasswordReset = async (
    email: string
  ): Promise<{ success: boolean; error?: string }> => {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      return { success: false, error: 'Informe o e-mail para receber o link de redefinição.' };
    }
    const supabase = getSupabase();
    if (!supabase) {
      return {
        success: false,
        error: 'Envio de e-mail de recuperação requer conexão ativa com o serviço de autenticação.',
      };
    }

    const redirectTo = typeof window !== 'undefined' ? window.location.origin : undefined;
    const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, { redirectTo });
    if (error) {
      return { success: false, error: error.message };
    }
    return { success: true };
  };

  const switchUser = (userId: string) => {
    // Segurança: nunca permite troca livre de perfil em produção ou quando autenticação em nuvem está ativa
    if (!isDevSimulationMode) {
      return;
    }
    const target = usersList.find((u) => u.id === userId);
    if (!target || !target.isActive) return;
    StorageService.setActiveUserId(userId);
    setActiveUserId(userId);
    setIsAuthenticated(true);
    if (typeof window !== 'undefined') {
      sessionStorage.setItem(DEV_AUTH_FLAG_KEY, 'true');
    }
  };

  const login = (userId: string) => {
    switchUser(userId);
  };

  const logout = async () => {
    const supabase = getSupabase();
    if (supabase) {
      await supabase.auth.signOut();
    }
    DomainResolver.setImpersonatedClinicId(null);
    setImpersonatedClinicId(null);
    setCloudUser(null);
    setCloudEffectivePerms(null);
    setIsAuthenticated(false);
    setAuthError(null);
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem(DEV_AUTH_FLAG_KEY);
      localStorage.removeItem('medsync_is_logged_in');
    }
  };

  const impersonateClinic = (clinicId: string) => {
    if (currentRole !== 'super_admin') return;
    DomainResolver.setImpersonatedClinicId(clinicId);
    setImpersonatedClinicId(clinicId);
    if (isDevSimulationMode) {
      const clinicAdmin = usersList.find((u) => u.role === 'clinic_admin') || usersList[1];
      if (clinicAdmin) switchUser(clinicAdmin.id);
    }
    if (DomainResolver.isSimulationAllowed()) {
      DomainResolver.setSimulatedDomain(PRODUCTION_DOMAINS.CLINIC_APP);
    }
  };

  const stopImpersonation = () => {
    DomainResolver.setImpersonatedClinicId(null);
    setImpersonatedClinicId(null);
    if (isDevSimulationMode) {
      const superAdmin = usersList.find((u) => u.role === 'super_admin') || usersList[0];
      if (superAdmin) switchUser(superAdmin.id);
    }
    if (DomainResolver.isSimulationAllowed()) {
      DomainResolver.setSimulatedDomain(PRODUCTION_DOMAINS.SAAS_ADMIN);
    }
  };

  const isImpersonating = Boolean(impersonatedClinicId);

  const hasMenuAccess = useCallback(
    (menuKey: MenuKey, action: SimplePermAction = 'view'): boolean => {
      if (!isAuthenticated || !currentUser.isActive) return false;
      const perm = effectivePermissions[menuKey];
      if (!perm) return false;
      return Boolean(perm[ACTION_MAP[action]]);
    },
    [isAuthenticated, currentUser.isActive, effectivePermissions]
  );

  const canViewMenu = useCallback((menuKey: MenuKey) => hasMenuAccess(menuKey, 'view'), [hasMenuAccess]);
  const canConsultMenu = useCallback((menuKey: MenuKey) => hasMenuAccess(menuKey, 'consult'), [hasMenuAccess]);
  const canCreateInMenu = useCallback((menuKey: MenuKey) => hasMenuAccess(menuKey, 'create'), [hasMenuAccess]);
  const canEditInMenu = useCallback((menuKey: MenuKey) => hasMenuAccess(menuKey, 'edit'), [hasMenuAccess]);
  const canDeleteInMenu = useCallback((menuKey: MenuKey) => hasMenuAccess(menuKey, 'delete'), [hasMenuAccess]);
  const canAdminMenu = useCallback((menuKey: MenuKey) => hasMenuAccess(menuKey, 'admin'), [hasMenuAccess]);

  const isSuperAdmin = isAuthenticated && currentUser.isActive && currentRole === 'super_admin';
  const canViewMedicalRecords = canViewMenu('medical_records') || canConsultMenu('medical_records');
  const canEditMedicalRecords = canCreateInMenu('medical_records') || canEditInMenu('medical_records');
  const canManageFinances = canViewMenu('financial');
  const canManageSchedules = canViewMenu('appointments');
  const canManageClinicSettings = canViewMenu('settings') || canViewMenu('users');

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        currentRole,
        isAuthenticated,
        isAuthLoading,
        isSupabaseAuthMode,
        isDevSimulationMode,
        authError,
        clearAuthError: () => setAuthError(null),
        bootstrapStatus,
        isCheckingBootstrap,
        refreshBootstrapStatus,
        registerFirstAccessSuperAdmin,
        resendFirstAccessConfirmation,
        signInWithEmail,
        sendPasswordReset,
        refreshSessionProfile: applySessionContextToTenant,
        switchUser,
        login,
        logout,
        impersonateClinic,
        stopImpersonation,
        isImpersonating,
        impersonatedClinicId,
        usersList,
        roleTemplates,
        effectivePermissions,
        hasMenuAccess,
        canViewMenu,
        canConsultMenu,
        canCreateInMenu,
        canEditInMenu,
        canDeleteInMenu,
        canAdminMenu,
        canViewMedicalRecords,
        canEditMedicalRecords,
        canManageFinances,
        canManageSchedules,
        canManageClinicSettings,
        isSuperAdmin,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
