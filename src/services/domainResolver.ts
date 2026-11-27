import { ClinicDomain, ResolvedTenantContext, AppEnvironmentMode } from '../types';
import { StorageService } from './storage';

const SIMULATION_STORAGE_KEY = 'medsync_simulated_domain';
const IMPERSONATION_STORAGE_KEY = 'medsync_impersonated_clinic_id';

export const PRODUCTION_DOMAINS = {
  SAAS_LANDING: 'medsync.beaverstraining.com.br',
  SAAS_ADMIN: 'painelclinica.beaverstraining.com.br',
  CLINIC_APP: 'app.drnewtonmureb.com.br',
  CLINIC_WEBSITE: 'www.drnewtonmureb.com.br',
  CLINIC_APEX: 'drnewtonmureb.com.br',
  CLINIC_BOOKING: 'agenda.drnewtonmureb.com.br',
} as const;

const CLINIC_LOGIN_PATHS = new Set(['/login', '/acesso', '/app', '/clinica']);

export function normalizeAppPath(pathname: string, baseUrl = '/'): string {
  let cleanPath = (pathname || '/').trim();
  const normalizedBase = (baseUrl || '/').replace(/\/+$/, '');
  if (normalizedBase && normalizedBase !== '/' && cleanPath.startsWith(normalizedBase)) {
    cleanPath = cleanPath.slice(normalizedBase.length) || '/';
  }
  cleanPath = cleanPath.replace(/\/+$/, '') || '/';
  return cleanPath.toLowerCase();
}

export function isClinicLoginPath(pathname: string, baseUrl = '/'): boolean {
  return CLINIC_LOGIN_PATHS.has(normalizeAppPath(pathname, baseUrl));
}

export interface ResolveTenantInputs {
  realHostname: string;
  pathname: string;
  baseUrl?: string;
  simulationAllowed: boolean;
  simulatedDomain: string | null;
  matchedDomain?: ClinicDomain | null;
  defaultAppDomain?: ClinicDomain | null;
  impersonatingClinicId?: string;
}

export function normalizeHostnameValue(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .split(':')[0];
}

export function resolveTenantFromInputs(input: ResolveTenantInputs): ResolvedTenantContext {
  const realHostname = normalizeHostnameValue(input.realHostname);
  const simulatedDomain = input.simulationAllowed ? input.simulatedDomain : null;
  const effectiveDomain = simulatedDomain
    ? normalizeHostnameValue(simulatedDomain)
    : realHostname;
  const impersonatingClinicId = input.impersonatingClinicId || undefined;
  const normalizedPath = normalizeAppPath(input.pathname, input.baseUrl || '/');
  const wantsClinicLoginPath = CLINIC_LOGIN_PATHS.has(normalizedPath);

  // 1. Strict isolation for SaaS Super Admin Panel (never converts to CLINIC_APP via path)
  if (
    effectiveDomain === PRODUCTION_DOMAINS.SAAS_ADMIN ||
    effectiveDomain === 'admin.medsync.io' ||
    effectiveDomain === 'superadmin' ||
    effectiveDomain === 'saas_admin'
  ) {
    return {
      resolved: true,
      mode: 'SAAS_ADMIN',
      environment: 'saas_root',
      isSimulation: input.simulationAllowed && Boolean(simulatedDomain),
      impersonatingClinicId,
    };
  }

  // 2. Check if effective domain is SaaS Commercial Landing (supports /login path for clinic entry)
  if (
    effectiveDomain === PRODUCTION_DOMAINS.SAAS_LANDING ||
    effectiveDomain === 'medsync.io' ||
    effectiveDomain === 'medsync.com.br' ||
    effectiveDomain === 'landing'
  ) {
    if (wantsClinicLoginPath) {
      return {
        resolved: true,
        mode: 'CLINIC_APP',
        environment: 'app',
        isSimulation: input.simulationAllowed && Boolean(simulatedDomain),
        impersonatingClinicId,
      };
    }

    return {
      resolved: true,
      mode: 'SAAS_LANDING',
      environment: 'saas_root',
      isSimulation: input.simulationAllowed && Boolean(simulatedDomain),
      impersonatingClinicId,
    };
  }

  // 3. Check registered clinic domains in storage (exact or www alias)
  const matchedDomain = input.matchedDomain;
  if (matchedDomain) {
    const isApp = matchedDomain.domainType === 'clinic_app' || matchedDomain.domainType === 'app';
    const isBooking =
      matchedDomain.domainType === 'clinic_booking' ||
      matchedDomain.domainType === 'booking' ||
      effectiveDomain.startsWith('agenda.');

    if (isBooking) {
      return {
        resolved: true,
        mode: 'CLINIC_BOOKING',
        environment: 'booking',
        domain: matchedDomain,
        organizationId: matchedDomain.organizationId,
        clinicId: matchedDomain.clinicId,
        isSimulation:
          input.simulationAllowed &&
          (Boolean(simulatedDomain) || realHostname !== matchedDomain.domain),
        impersonatingClinicId,
      };
    }

    return {
      resolved: true,
      mode: isApp || wantsClinicLoginPath ? 'CLINIC_APP' : 'CLINIC_WEBSITE',
      environment: isApp || wantsClinicLoginPath ? 'app' : 'website',
      domain: matchedDomain,
      organizationId: matchedDomain.organizationId,
      clinicId: matchedDomain.clinicId,
      isSimulation:
        input.simulationAllowed &&
        (Boolean(simulatedDomain) || realHostname !== matchedDomain.domain),
      impersonatingClinicId,
    };
  }

  // Fallback check for any agenda.* subdomain not yet added to local registry
  if (effectiveDomain.startsWith('agenda.') || effectiveDomain === 'agenda') {
    return {
      resolved: true,
      mode: 'CLINIC_BOOKING',
      environment: 'booking',
      organizationId: 'org_mureb_01',
      clinicId: 'clinic_mureb_01',
      isSimulation: input.simulationAllowed && Boolean(simulatedDomain),
      impersonatingClinicId,
    };
  }

  // 4. Default fallback behavior in development/preview
  if (input.simulationAllowed) {
    const defaultAppDomain = input.defaultAppDomain || {
      id: 'dom_mureb_app',
      organizationId: 'org_mureb_01',
      clinicId: 'clinic_mureb_01',
      clinicName: 'Clínica Dr. Newton Mureb',
      domain: PRODUCTION_DOMAINS.CLINIC_APP,
      domainType: 'clinic_app',
      isVerified: true,
      isActive: true,
      verificationToken: 'medsync-verify-default',
      dnsStatus: 'verified',
      sslStatus: 'active',
      expectedCname: 'cname.vercel-dns.com',
      createdAt: new Date().toISOString(),
    };

    return {
      resolved: true,
      mode: 'CLINIC_APP',
      environment: 'app',
      domain: defaultAppDomain,
      organizationId: defaultAppDomain.organizationId,
      clinicId: defaultAppDomain.clinicId,
      isSimulation: true,
      impersonatingClinicId,
    };
  }

  // 5. In production on unknown root domain: honor /login path to enter Clinic App, otherwise Landing
  if (wantsClinicLoginPath) {
    return {
      resolved: true,
      mode: 'CLINIC_APP',
      environment: 'app',
      isSimulation: false,
      impersonatingClinicId,
    };
  }

  return {
    resolved: false,
    mode: 'SAAS_LANDING',
    environment: 'saas_root',
    isSimulation: false,
  };
}

/**
 * Domain Resolver for MedSync SaaS Multi-tenant Architecture.
 * Strictly separates 5 operational domain contexts:
 * 1. SAAS_LANDING: medsync.beaverstraining.com.br (Commercial landing page)
 * 2. SAAS_ADMIN: painelclinica.beaverstraining.com.br (Super Admin SaaS portal)
 * 3. CLINIC_APP: app.drnewtonmureb.com.br or /login (White-label clinic operational ERP)
 * 4. CLINIC_WEBSITE: www.drnewtonmureb.com.br / drnewtonmureb.com.br (Public institutional website)
 * 5. CLINIC_BOOKING: agenda.drnewtonmureb.com.br (Public standalone booking portal integrated with n8n)
 */
export const DomainResolver = {
  isSimulationAllowed(): boolean {
    if (typeof window === 'undefined') return true;
    const host = window.location.hostname.toLowerCase();
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host.endsWith('.localhost') ||
      host.endsWith('.vercel.app') ||
      host.includes('.run.app') ||
      host.includes('.web.app') ||
      host.includes('usercontent.goog') ||
      host.includes('aistudio.google.com') ||
      host.includes('github.io')
    );
  },

  isRealProductionDomain(): boolean {
    return !this.isSimulationAllowed();
  },

  isClinicLoginRoute(): boolean {
    if (typeof window === 'undefined') return false;
    return isClinicLoginPath(window.location.pathname, import.meta.env.BASE_URL || '/');
  },

  getSimulatedDomain(): string | null {
    if (typeof window === 'undefined') return null;

    const urlParams = new URLSearchParams(window.location.search);
    const queryDomain = urlParams.get('simulate_domain');
    if (queryDomain) {
      localStorage.setItem(SIMULATION_STORAGE_KEY, queryDomain);
      return queryDomain;
    }

    return localStorage.getItem(SIMULATION_STORAGE_KEY);
  },

  setSimulatedDomain(domain: string | null): void {
    if (typeof window === 'undefined') return;
    if (domain) {
      localStorage.setItem(SIMULATION_STORAGE_KEY, domain);
    } else {
      localStorage.removeItem(SIMULATION_STORAGE_KEY);
    }

    // Sincroniza ?simulate_domain na URL para evitar que a querystring antiga sobrescreva cliques de navegação
    try {
      const currentUrl = new URL(window.location.href);
      if (currentUrl.searchParams.has('simulate_domain')) {
        if (domain) {
          currentUrl.searchParams.set('simulate_domain', domain);
        } else {
          currentUrl.searchParams.delete('simulate_domain');
        }
        window.history.replaceState({}, '', `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`);
      }
    } catch {
      // ignore URL rewrite errors in restricted environments
    }

    window.dispatchEvent(new Event('medsync_domain_simulation_changed'));
  },

  navigateToClinicApp(): void {
    if (typeof window === 'undefined') return;

    if (this.isSimulationAllowed()) {
      this.setSimulatedDomain(PRODUCTION_DOMAINS.CLINIC_APP);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    // Em produção: preserva a mesma origem (mantendo sessão Supabase recém-criada no trial ou login)
    // alternando para a rota /login para exibir a tela de autenticação da clínica.
    const currentPath = normalizeAppPath(window.location.pathname, import.meta.env.BASE_URL || '/');
    if (!CLINIC_LOGIN_PATHS.has(currentPath)) {
      const base = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');
      const targetPath = `${base}/login`.replace(/\/{2,}/g, '/');
      window.history.pushState({}, '', targetPath);
    }
    window.dispatchEvent(new Event('medsync_domain_simulation_changed'));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  navigateToLanding(): void {
    if (typeof window === 'undefined') return;

    if (this.isSimulationAllowed()) {
      const base = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '') || '/';
      if (isClinicLoginPath(window.location.pathname, import.meta.env.BASE_URL || '/')) {
        window.history.pushState({}, '', base);
      }
      this.setSimulatedDomain(PRODUCTION_DOMAINS.SAAS_LANDING);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    const base = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '') || '/';
    window.history.pushState({}, '', base);
    window.dispatchEvent(new Event('medsync_domain_simulation_changed'));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  navigateToSuperAdmin(): void {
    if (typeof window === 'undefined') return;

    if (this.isSimulationAllowed()) {
      this.setSimulatedDomain(PRODUCTION_DOMAINS.SAAS_ADMIN);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    const realHost = this.normalizeHostname(window.location.hostname);
    if (realHost !== PRODUCTION_DOMAINS.SAAS_ADMIN) {
      window.location.assign(`https://${PRODUCTION_DOMAINS.SAAS_ADMIN}`);
    }
  },

  getImpersonatedClinicId(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(IMPERSONATION_STORAGE_KEY);
  },

  setImpersonatedClinicId(clinicId: string | null): void {
    if (typeof window === 'undefined') return;
    if (clinicId) {
      localStorage.setItem(IMPERSONATION_STORAGE_KEY, clinicId);
    } else {
      localStorage.removeItem(IMPERSONATION_STORAGE_KEY);
    }
    window.dispatchEvent(new Event('medsync_domain_simulation_changed'));
  },

  normalizeHostname(raw: string): string {
    return normalizeHostnameValue(raw);
  },

  resolveTenant(): ResolvedTenantContext {
    if (typeof window === 'undefined') {
      return {
        resolved: false,
        mode: 'SAAS_LANDING',
        environment: 'saas_root',
      };
    }

    const realHostname = this.normalizeHostname(window.location.hostname);
    const simulationAllowed = this.isSimulationAllowed();
    const simulatedDomain = simulationAllowed ? this.getSimulatedDomain() : null;
    const effectiveDomain = simulatedDomain ? this.normalizeHostname(simulatedDomain) : realHostname;
    const matchedDomain = StorageService.findDomainByName(effectiveDomain);
    const defaultAppDomain = simulationAllowed
      ? StorageService.findDomainByName(PRODUCTION_DOMAINS.CLINIC_APP)
      : undefined;

    return resolveTenantFromInputs({
      realHostname,
      pathname: window.location.pathname,
      baseUrl: import.meta.env.BASE_URL || '/',
      simulationAllowed,
      simulatedDomain,
      matchedDomain,
      defaultAppDomain,
      impersonatingClinicId: this.getImpersonatedClinicId() || undefined,
    });
  },
};
