import { createClient, SupabaseClient } from '@supabase/supabase-js';

const STORAGE_CONFIG_KEY = 'medsync_supabase_config';
const LEGACY_URL_KEY = 'medsync_supabase_url';
const LEGACY_KEY_KEY = 'medsync_supabase_key';
const PLACEHOLDER_URL = 'https://placeholder.supabase.co';
const PLACEHOLDER_KEY = 'public-anon-key';

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

function isValidSupabaseConfig(url: string, anonKey: string): boolean {
  if (
    !url ||
    !url.startsWith('https://') ||
    !anonKey ||
    url.includes('undefined') ||
    url.includes('your-project.supabase.co') ||
    url.includes('placeholder.supabase.co') ||
    anonKey === 'your-anon-key' ||
    anonKey === PLACEHOLDER_KEY
  ) {
    return false;
  }

  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

// Lê do localStorage ou do ambiente com limpeza automática de barras extras e formatação inválida
const getStoredConfig = (): { url: string; anonKey: string } => {
  if (typeof window !== 'undefined') {
    try {
      const custom = window.localStorage.getItem(STORAGE_CONFIG_KEY);
      if (custom) {
        const parsed = JSON.parse(custom) as { url?: string; anonKey?: string };
        const customUrl = cleanUrl(parsed?.url);
        const customKey = cleanKey(parsed?.anonKey);
        if (isValidSupabaseConfig(customUrl, customKey)) {
          return {
            url: customUrl,
            anonKey: customKey,
          };
        }
      }

      const legacyUrl = cleanUrl(window.localStorage.getItem(LEGACY_URL_KEY));
      const legacyKey = cleanKey(window.localStorage.getItem(LEGACY_KEY_KEY));
      if (isValidSupabaseConfig(legacyUrl, legacyKey)) {
        return {
          url: legacyUrl,
          anonKey: legacyKey,
        };
      }
    } catch {
      // ignora erro de parse do localStorage
    }
  }

  const envUrl = cleanUrl(import.meta.env.VITE_SUPABASE_URL);
  const envKey = cleanKey(import.meta.env.VITE_SUPABASE_ANON_KEY);

  return {
    url: envUrl,
    anonKey: envKey,
  };
};

const initialConfig = getStoredConfig();

// Validação estrita para evitar o erro "Invalid path specified in request URL"
export const isSupabaseConfigured = isValidSupabaseConfig(
  initialConfig.url,
  initialConfig.anonKey
);

// Criação do client Supabase seguro (nunca passa URL vazia, undefined ou com barras extras)
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

export function getSupabaseCredentials(): { url: string; anonKey: string; isConfigured: boolean } {
  const { url, anonKey } = getStoredConfig();
  const isConfigured = isValidSupabaseConfig(url, anonKey);
  return { url, anonKey, isConfigured };
}

export function saveSupabaseCredentials(url: string, anonKey: string): void {
  if (typeof window !== 'undefined') {
    const sanitizedUrl = cleanUrl(url);
    const sanitizedKey = cleanKey(anonKey);
    window.localStorage.setItem(
      STORAGE_CONFIG_KEY,
      JSON.stringify({ url: sanitizedUrl, anonKey: sanitizedKey })
    );
    window.localStorage.setItem(LEGACY_URL_KEY, sanitizedUrl);
    window.localStorage.setItem(LEGACY_KEY_KEY, sanitizedKey);
    supabaseInstance = null;
    lastCredentialsKey = '';
  }
}

export function clearSupabaseCredentials(): void {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(STORAGE_CONFIG_KEY);
    window.localStorage.removeItem(LEGACY_URL_KEY);
    window.localStorage.removeItem(LEGACY_KEY_KEY);
    supabaseInstance = null;
    lastCredentialsKey = '';
  }
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
