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
import { TeamCloudService } from '../services/teamCloudService';

export type SimplePermAction = 'view' | 'consult' | 'create' | 'edit' | 'delete' | 'admin';

interface SignInResult {
  success: boolean;
  error?: string;
  role?: UserRole;
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
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    if (isSupabaseAuthMode) return false;
    if (!import.meta.env.DEV) return false;
    if (typeof window === 'undefined') return false;
    return sessionStorage.getItem(DEV_AUTH_FLAG_KEY) === 'true';
  });
  const [impersonatedClinicId, setImpersonatedClinicId] = useState<string | null>(() =>
    DomainResolver.getImpersonatedClinicId()
  );

  const applySessionContextToTenant = useCallback(async () => {
    const supabase = getSupabase();
    if (!supabase) {
      setIsAuthLoading(false);
      return;
    }

    try {
      const ctx = await TeamCloudService.fetchCurrentUserSessionContext();
      if (!ctx.authenticated) {
        setCloudUser(null);
        setCloudEffectivePerms(null);
        setIsAuthenticated(false);
        return;
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
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setAuthError(`Erro ao restaurar sessão: ${msg}`);
      setIsAuthenticated(false);
    } finally {
      setIsAuthLoading(false);
    }
  }, []);

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
      return;
    }

    let mounted = true;
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
  }, [applySessionContextToTenant]);

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
          const friendly =
            error?.message === 'Invalid login credentials'
              ? 'E-mail ou senha inválidos. Verifique suas credenciais ou utilize "Esqueci minha senha".'
              : error?.message || 'Não foi possível autenticar no sistema.';
          setAuthError(friendly);
          setIsAuthLoading(false);
          return { success: false, error: friendly };
        }

        const ctx = await TeamCloudService.fetchCurrentUserSessionContext();
        if (!ctx.profileFound || !ctx.profile) {
          await supabase.auth.signOut();
          const msg =
            ctx.error || 'Conta autenticada sem perfil ativo vinculado a uma clínica no banco de dados.';
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
          const msg = 'Acesso restrito: este painel é exclusivo para Super Administradores (SaaS).';
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

    // Sem Supabase configurado: bloqueado em produção, permitido apenas em modo dev local controlado
    if (!isDevSimulationMode) {
      const msg =
        'Autenticação indisponível: configure a conexão Supabase (VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY) para autenticar usuários.';
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
        error: 'Envio de e-mail de recuperação requer conexão ativa com o Supabase Auth.',
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
    // Segurança: nunca permite troca livre de perfil em produção ou quando Supabase Auth está ativo
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
