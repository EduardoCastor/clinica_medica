import { createClient, SupabaseClient } from '@supabase/supabase-js';

const STORAGE_CONFIG_KEY = 'medsync_supabase_config';
const LEGACY_URL_KEY = 'medsync_supabase_url';
const LEGACY_KEY_KEY = 'medsync_supabase_key';
const PLACEHOLDER_URL = 'https://placeholder.supabase.co';
const PLACEHOLDER_KEY = 'public-anon-key';

let lastConfigError: string | null = null;

function cleanUrl(raw?: string | null): string {
  if (!raw || typeof raw !== 'string') return '';
  const trimmed = raw
    .trim()
    .replace(/^['"]+|['"]+$/g, '')
    .trim()
    .replace(/\/+$/, '');

  if (!trimmed) return '';

  try {
    const parsed = new URL(trimmed);
    if (parsed.hostname.endsWith('.supabase.co')) {
      return parsed.origin;
    }
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
  } catch {
    return trimmed;
  }
}

function cleanKey(raw?: string | null): string {
  if (!raw || typeof raw !== 'string') return '';
  return raw
    .trim()
    .replace(/^['"]+|['"]+$/g, '')
    .trim();
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const decoded =
      typeof atob === 'function'
        ? atob(padded)
        : Buffer.from(padded, 'base64').toString('utf8');
    const parsed = JSON.parse(decoded) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function validatePublicSupabaseKey(rawKey?: string | null): {
  valid: boolean;
  isSecretKey: boolean;
  error?: string;
} {
  const key = cleanKey(rawKey);
  if (!key || key === 'your-anon-key' || key === PLACEHOLDER_KEY) {
    return { valid: false, isSecretKey: false };
  }

  const lower = key.toLowerCase();
  if (lower.startsWith('sb_secret_')) {
    return {
      valid: false,
      isSecretKey: true,
      error:
        'Chave secreta (sb_secret_*) bloqueada no navegador. Utilize apenas a chave pública (anon / sb_publishable_*) em VITE_SUPABASE_ANON_KEY.',
    };
  }

  const jwtPayload = decodeJwtPayload(key);
  if (jwtPayload && typeof jwtPayload.role === 'string') {
    const jwtRole = jwtPayload.role.toLowerCase();
    if (jwtRole === 'service_role' || jwtRole === 'supabase_admin') {
      return {
        valid: false,
        isSecretKey: true,
        error:
          'Chave administrativa privada (service_role) bloqueada no navegador. Mantenha SUPABASE_SERVICE_ROLE_KEY apenas nos Secrets das Edge Functions e use a chave anon no frontend.',
      };
    }
  }

  return { valid: true, isSecretKey: false };
}

function isValidSupabaseConfig(url: string, anonKey: string): boolean {
  if (
    !url ||
    !url.startsWith('https://') ||
    !anonKey ||
    url.includes('undefined') ||
    url.includes('your-project.supabase.co') ||
    url.includes('placeholder.supabase.co')
  ) {
    return false;
  }

  const keyCheck = validatePublicSupabaseKey(anonKey);
  if (!keyCheck.valid) {
    if (keyCheck.isSecretKey && keyCheck.error) {
      lastConfigError = keyCheck.error;
    }
    return false;
  }

  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

function purgeStoredCustomConfig(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_CONFIG_KEY);
    window.localStorage.removeItem(LEGACY_URL_KEY);
    window.localStorage.removeItem(LEGACY_KEY_KEY);
  } catch {
    // ignore storage errors
  }
}

// Lê do localStorage ou do ambiente com proteção estrita contra chaves secretas no navegador
const getStoredConfig = (): { url: string; anonKey: string } => {
  lastConfigError = null;

  if (typeof window !== 'undefined') {
    try {
      const custom = window.localStorage.getItem(STORAGE_CONFIG_KEY);
      if (custom) {
        const parsed = JSON.parse(custom) as { url?: string; anonKey?: string };
        const customUrl = cleanUrl(parsed?.url);
        const customKey = cleanKey(parsed?.anonKey);
        const keyCheck = validatePublicSupabaseKey(customKey);
        if (keyCheck.isSecretKey) {
          lastConfigError = keyCheck.error || null;
          purgeStoredCustomConfig();
        } else if (isValidSupabaseConfig(customUrl, customKey)) {
          return {
            url: customUrl,
            anonKey: customKey,
          };
        }
      }

      const legacyUrl = cleanUrl(window.localStorage.getItem(LEGACY_URL_KEY));
      const legacyKey = cleanKey(window.localStorage.getItem(LEGACY_KEY_KEY));
      const legacyCheck = validatePublicSupabaseKey(legacyKey);
      if (legacyCheck.isSecretKey) {
        lastConfigError = legacyCheck.error || null;
        purgeStoredCustomConfig();
      } else if (isValidSupabaseConfig(legacyUrl, legacyKey)) {
        return {
          url: legacyUrl,
          anonKey: legacyKey,
        };
      }
    } catch {
      // ignora erro de parse do localStorage
    }
  }

  const metaEnv = (import.meta as { env?: Record<string, string | undefined> }).env;
  const envUrl = cleanUrl(metaEnv?.VITE_SUPABASE_URL);
  const envKey = cleanKey(metaEnv?.VITE_SUPABASE_ANON_KEY);
  const envCheck = validatePublicSupabaseKey(envKey);
  if (envCheck.isSecretKey) {
    lastConfigError = envCheck.error || null;
    return { url: envUrl, anonKey: '' };
  }

  return {
    url: envUrl,
    anonKey: envKey,
  };
};

const initialConfig = getStoredConfig();

export const isSupabaseConfigured = isValidSupabaseConfig(
  initialConfig.url,
  initialConfig.anonKey
);

export const supabase: SupabaseClient = createClient(
  isSupabaseConfigured ? initialConfig.url : PLACEHOLDER_URL,
  isSupabaseConfigured ? initialConfig.anonKey : PLACEHOLDER_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  }
);

let supabaseInstance: SupabaseClient | null = isSupabaseConfigured ? supabase : null;
let lastCredentialsKey = isSupabaseConfigured
  ? `${initialConfig.url}|${initialConfig.anonKey}`
  : '';

export function getSupabaseConfigError(): string | null {
  if (!lastConfigError) {
    getStoredConfig();
  }
  return lastConfigError;
}

export function getSupabaseCredentials(): {
  url: string;
  anonKey: string;
  isConfigured: boolean;
  configError?: string | null;
} {
  const { url, anonKey } = getStoredConfig();
  const isConfigured = isValidSupabaseConfig(url, anonKey);
  return { url, anonKey, isConfigured, configError: lastConfigError };
}

export function saveSupabaseCredentials(
  url: string,
  anonKey: string
): { success: boolean; error?: string } {
  const sanitizedUrl = cleanUrl(url);
  const sanitizedKey = cleanKey(anonKey);

  const keyCheck = validatePublicSupabaseKey(sanitizedKey);
  if (keyCheck.isSecretKey || !keyCheck.valid) {
    const err =
      keyCheck.error ||
      'Chave pública Supabase inválida. Informe a chave anon / sb_publishable_.';
    lastConfigError = err;
    return { success: false, error: err };
  }

  if (!isValidSupabaseConfig(sanitizedUrl, sanitizedKey)) {
    const err = 'URL do projeto Supabase inválida. Utilize formato https://seu-projeto.supabase.co';
    lastConfigError = err;
    return { success: false, error: err };
  }

  if (typeof window !== 'undefined') {
    window.localStorage.setItem(
      STORAGE_CONFIG_KEY,
      JSON.stringify({ url: sanitizedUrl, anonKey: sanitizedKey })
    );
    window.localStorage.setItem(LEGACY_URL_KEY, sanitizedUrl);
    window.localStorage.setItem(LEGACY_KEY_KEY, sanitizedKey);
    supabaseInstance = null;
    lastCredentialsKey = '';
    lastConfigError = null;
  }

  return { success: true };
}

export function clearSupabaseCredentials(): void {
  purgeStoredCustomConfig();
  supabaseInstance = null;
  lastCredentialsKey = '';
  lastConfigError = null;
}

export function getSupabase(): SupabaseClient | null {
  const { url, anonKey, isConfigured } = getSupabaseCredentials();
  if (!isConfigured) return null;

  const credentialsKey = `${url}|${anonKey}`;
  if (!supabaseInstance || lastCredentialsKey !== credentialsKey) {
    try {
      supabaseInstance = createClient(url, anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
        },
      });
      lastCredentialsKey = credentialsKey;
    } catch (err) {
      console.warn('Erro ao inicializar Supabase client:', err);
      return null;
    }
  }
  return supabaseInstance;
}
