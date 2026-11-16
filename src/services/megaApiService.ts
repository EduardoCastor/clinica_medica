import { Clinic, MessageLog } from '../types';
import { StorageService } from './storage';

export interface MegaapiClinicConfig {
  megaapi_instance_url?: string;
  megaapiInstanceUrl?: string;
  megaapi_instance_key?: string;
  megaapiInstanceKey?: string;
  instance_key?: string;
  instanceKey?: string;
  megaapi_token?: string;
  megaapiToken?: string;
  access_token?: string;
}

export interface MegaapiMessageContext {
  organizationId?: string;
  branchId?: string;
  patientId?: string;
  patientName?: string;
  appointmentId?: string;
  recordAttemptOnFailure?: boolean;
  /** When true, bypasses external HTTP call and records a simulated test dispatch directly in public.messages. */
  simulate?: boolean;
  /** When true, automatically falls back to simulated logging if browser CORS or 404 blocks the direct call. */
  fallbackToSimulation?: boolean;
}

export interface MegaapiSendResult {
  success: boolean;
  cleanPhone: string;
  messageId?: string;
  statusCode?: number;
  error?: string;
  isCorsError?: boolean;
  isNotFoundError?: boolean;
  isSimulated?: boolean;
  testedEndpoint?: string;
  loggedMessage?: MessageLog;
  syncedSupabase?: boolean;
}

export type MegaapiConnectionStatusCode =
  | 'CONNECTED'
  | 'QRCODE_REQUIRED'
  | 'DISCONNECTED'
  | 'UNCONFIGURED'
  | 'CORS_BLOCKED'
  | 'NOT_FOUND'
  | 'ERROR';

export interface MegaapiConnectionResult {
  connected: boolean;
  status: MegaapiConnectionStatusCode;
  httpStatus?: number;
  isCorsBlocked?: boolean;
  testedEndpoint?: string;
  qrCode?: string;
  phoneNumber?: string;
  instanceName?: string;
  instanceKey?: string;
  message: string;
}

/**
 * Normalizes a Brazilian phone/WhatsApp number to digits with country code (ex: 5522999089122).
 */
export function formatMegaapiPhone(rawPhone: string): string {
  const digits = String(rawPhone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('55') && digits.length >= 12) {
    return digits;
  }
  return `55${digits}`;
}

/**
 * Formats a JID or raw WhatsApp digits (ex: 5522999089122:15@s.whatsapp.net) into a clean readable phone number.
 */
export function extractCleanWhatsAppNumber(rawJid?: string): string | undefined {
  if (!rawJid) return undefined;
  const beforeAt = String(rawJid).split('@')[0];
  const beforeColon = beforeAt.split(':')[0];
  const digits = beforeColon.replace(/\D/g, '');
  if (!digits) return undefined;
  if (digits.startsWith('55') && digits.length === 13) {
    return `+${digits.slice(0, 2)} (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
  }
  if (digits.startsWith('55') && digits.length === 12) {
    return `+${digits.slice(0, 2)} (${digits.slice(2, 4)}) ${digits.slice(4, 8)}-${digits.slice(8)}`;
  }
  return digits;
}

/**
 * Normalizes the configured Megaapi URL: trims spaces, ensures https://, removes trailing slashes.
 */
export function normalizeMegaapiBaseUrl(rawUrl?: string): string {
  const cleaned = String(rawUrl || '').trim().replace(/\/+$/, '');
  if (!cleaned) return '';
  if (/^https?:\/\//i.test(cleaned)) {
    return cleaned;
  }
  return `https://${cleaned}`;
}

function parseUrlSafe(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/**
 * Extracts an instance key from a Megaapi URL path if the user pasted a full instance URL.
 */
function extractInstanceKeyFromUrl(instanceUrl: string): string {
  const parsed = parseUrlSafe(instanceUrl);
  if (!parsed) return '';
  const pathname = parsed.pathname.replace(/\/+$/, '');
  if (!pathname) return '';

  const patterns = [
    /\/rest\/(?:v\d+\/)?instance\/(?:connectionState|status|qrcode_base64)\/([^/]+)$/i,
    /\/rest\/(?:v\d+\/)?instance\/([^/]+)$/i,
    /\/rest\/(?:v\d+\/)?sendMessage\/([^/]+)\/text$/i,
    /\/v2\/instances\/([^/]+)(?:\/(?:status|messages\/text))?$/i,
  ];

  for (const regex of patterns) {
    const match = pathname.match(regex);
    if (
      match?.[1] &&
      !['status', 'instance', 'instances', 'connectionstate'].includes(match[1].toLowerCase())
    ) {
      return decodeURIComponent(match[1]);
    }
  }

  return '';
}

export function resolveMegaapiCredentials(clinicConfig?: MegaapiClinicConfig | Partial<Clinic>): {
  instanceUrl: string;
  instanceKey: string;
  token: string;
  isConfigured: boolean;
  hasInstanceKey: boolean;
} {
  const storedClinic = StorageService.getClinic();
  const cfg = (clinicConfig || storedClinic) as MegaapiClinicConfig & Partial<Clinic>;

  const rawUrl =
    cfg.megaapiInstanceUrl ||
    cfg.megaapi_instance_url ||
    storedClinic.megaapiInstanceUrl ||
    '';

  const instanceUrl = normalizeMegaapiBaseUrl(rawUrl);

  const rawKey =
    cfg.megaapiInstanceKey ||
    cfg.megaapi_instance_key ||
    cfg.instanceKey ||
    cfg.instance_key ||
    storedClinic.megaapiInstanceKey ||
    extractInstanceKeyFromUrl(instanceUrl) ||
    '';

  const rawToken =
    cfg.megaapiToken ||
    cfg.megaapi_token ||
    cfg.access_token ||
    storedClinic.megaapiToken ||
    '';

  const instanceKey = rawKey.trim();
  const token = rawToken.trim();

  return {
    instanceUrl,
    instanceKey,
    token,
    isConfigured: Boolean(instanceUrl && token),
    hasInstanceKey: Boolean(instanceKey),
  };
}

function isLikelyCorsOrNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('network request failed') ||
    msg.includes('cors') ||
    msg.includes('load failed')
  );
}

function buildMegaapiHeaders(
  token: string,
  instanceKey: string,
  isJsonPost = false
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
  };

  if (instanceKey) {
    headers.instancekey = instanceKey;
    headers.key = instanceKey;
  }

  if (isJsonPost) {
    headers['Content-Type'] = 'application/json';
  }

  return headers;
}

function dedupeUrls(urls: string[]): string[] {
  return Array.from(new Set(urls.filter(Boolean)));
}

/**
 * Builds candidate status endpoints for Megaapi using the configured HOST (origin)
 * combined with the Instance Key (e.g. megabusiness-MH7CY257SQCAASLHMW73HB9GZ64).
 */
export function buildStatusEndpointCandidates(
  instanceUrl: string,
  instanceKey = ''
): string[] {
  const normalized = normalizeMegaapiBaseUrl(instanceUrl);
  if (!normalized) return [];

  const parsed = parseUrlSafe(normalized);
  const origin = parsed?.origin || normalized;
  const pathname = (parsed?.pathname || '').replace(/\/+$/, '');
  const cleanKey = instanceKey.trim();
  const encodedKey = cleanKey ? encodeURIComponent(cleanKey) : '';

  const keyBasedCandidates = encodedKey
    ? [
        `${origin}/rest/instance/${encodedKey}`,
        `${origin}/rest/instance/connectionState/${encodedKey}`,
        `${origin}/rest/v1/instance/connectionState/${encodedKey}`,
        `${origin}/rest/v1/instance/${encodedKey}`,
        `${origin}/rest/v1/instance/status?instanceKey=${encodedKey}`,
        `${origin}/api/v1/instance/status?instanceKey=${encodedKey}`,
        `${origin}/v2/instances/${encodedKey}/status`,
      ]
    : [];

  // If user entered only the domain (e.g. https://apibusiness1.megaapi.com.br)
  if (!pathname) {
    return dedupeUrls([
      ...keyBasedCandidates,
      `${origin}/rest/instance/status`,
      `${origin}/rest/v1/instance/status`,
      `${origin}/api/v1/instance/status`,
      `${origin}/v2/instances/status`,
    ]);
  }

  // Already an explicit status / connectionState endpoint
  if (/\/(status|connectionState)(\/|$)/i.test(pathname)) {
    return dedupeUrls([normalized, ...keyBasedCandidates]);
  }

  // Versioned prefix only (/rest, /rest/v1, /api/v1)
  if (/^\/(rest|api)(\/v\d+)?$/i.test(pathname)) {
    return dedupeUrls([
      ...keyBasedCandidates,
      `${normalized}/instance/status`,
      `${normalized}/status`,
    ]);
  }

  // REST sendMessage URL -> map to instance & connectionState
  const restSendMatch = pathname.match(/\/rest\/(?:v\d+\/)?sendMessage\/([^/]+)\/text$/i);
  if (restSendMatch) {
    const prefix = pathname.includes('/rest/v1') ? '/rest/v1' : '/rest';
    const keyFromPath = encodedKey || encodeURIComponent(restSendMatch[1]);
    return dedupeUrls([
      `${origin}${prefix}/instance/${keyFromPath}`,
      `${origin}${prefix}/instance/connectionState/${keyFromPath}`,
      ...keyBasedCandidates,
    ]);
  }

  // Megaapi v2 text endpoint (.../messages/text)
  if (/\/messages\/text$/i.test(pathname)) {
    return dedupeUrls([
      normalized.replace(/\/messages\/text$/i, '/status'),
      ...keyBasedCandidates,
    ]);
  }

  return dedupeUrls([
    ...keyBasedCandidates,
    `${normalized}/status`,
    `${origin}/rest/v1/instance/status`,
    `${origin}/api/v1/instance/status`,
  ]);
}

function buildSendEndpointCandidates(
  instanceUrl: string,
  cleanPhone: string,
  message: string,
  instanceKey = ''
): Array<{ endpoint: string; body: Record<string, unknown> }> {
  const normalized = normalizeMegaapiBaseUrl(instanceUrl);
  const parsed = parseUrlSafe(normalized);
  const origin = parsed?.origin || normalized;
  const pathname = (parsed?.pathname || '').replace(/\/+$/, '');
  const cleanKey = instanceKey.trim();
  const encodedKey = cleanKey ? encodeURIComponent(cleanKey) : '';

  const restBody: Record<string, unknown> = {
    messageData: {
      to: `${cleanPhone}@s.whatsapp.net`,
      text: message,
    },
  };

  const v2Body: Record<string, unknown> = {
    ...(cleanKey
      ? {
          instanceKey: cleanKey,
          instance_key: cleanKey,
          key: cleanKey,
        }
      : {}),
    to: cleanPhone,
    number: cleanPhone,
    text: message,
  };

  const keyBasedSendCandidates: Array<{ endpoint: string; body: Record<string, unknown> }> =
    encodedKey
      ? [
          {
            endpoint: `${origin}/rest/sendMessage/${encodedKey}/text`,
            body: restBody,
          },
          {
            endpoint: `${origin}/rest/v1/sendMessage/${encodedKey}/text`,
            body: restBody,
          },
          {
            endpoint: `${origin}/rest/v1/message/text`,
            body: v2Body,
          },
          {
            endpoint: `${origin}/api/v1/message/text`,
            body: v2Body,
          },
          {
            endpoint: `${origin}/v2/instances/${encodedKey}/messages/text`,
            body: v2Body,
          },
        ]
      : [];

  // Bare domain (https://apibusiness1.megaapi.com.br)
  if (!pathname) {
    return [
      ...keyBasedSendCandidates,
      { endpoint: `${origin}/rest/v1/message/text`, body: v2Body },
      { endpoint: `${origin}/api/v1/message/text`, body: v2Body },
      { endpoint: `${origin}/rest/v1/messages/text`, body: v2Body },
    ];
  }

  // Explicit REST sendMessage path
  if (/\/rest\/(?:v\d+\/)?sendMessage\/[^/]+\/text$/i.test(pathname)) {
    return [{ endpoint: normalized, body: restBody }, ...keyBasedSendCandidates];
  }

  // Versioned prefix only (/rest, /rest/v1, /api/v1)
  if (/^\/(rest|api)(\/v\d+)?$/i.test(pathname)) {
    return [
      ...keyBasedSendCandidates,
      { endpoint: `${normalized}/message/text`, body: v2Body },
      { endpoint: `${normalized}/messages/text`, body: v2Body },
    ];
  }

  // Status URL passed as instanceUrl -> rewrite to text dispatch
  if (/\/instance\/status$/i.test(pathname)) {
    return [
      ...keyBasedSendCandidates,
      { endpoint: normalized.replace(/\/instance\/status$/i, '/message/text'), body: v2Body },
      { endpoint: normalized.replace(/\/instance\/status$/i, '/sendMessage/text'), body: restBody },
    ];
  }

  // REST instance key URL (.../rest/instance/{key})
  const restInstanceMatch = pathname.match(/^(\/rest(?:\/v\d+)?)\/(?:instance\/)?([^/]+)$/i);
  if (restInstanceMatch && restInstanceMatch[2].toLowerCase() !== 'instance') {
    const [, prefix, pathKey] = restInstanceMatch;
    const effectiveKey = encodedKey || encodeURIComponent(pathKey);
    return [
      { endpoint: `${origin}${prefix}/sendMessage/${effectiveKey}/text`, body: restBody },
      ...keyBasedSendCandidates,
      { endpoint: `${normalized}/messages/text`, body: v2Body },
    ];
  }

  // Explicit /messages/text or /message/text
  if (/\/messages?\/text$/i.test(pathname)) {
    return [{ endpoint: normalized, body: v2Body }, ...keyBasedSendCandidates];
  }

  return [
    ...keyBasedSendCandidates,
    { endpoint: `${normalized}/messages/text`, body: v2Body },
    { endpoint: `${normalized}/message/text`, body: v2Body },
    { endpoint: `${origin}/rest/v1/message/text`, body: v2Body },
  ];
}

function buildNotFoundGuidanceMessage(testedEndpoint: string, hasInstanceKey: boolean): string {
  if (!hasInstanceKey) {
    return `Servidor Megaapi respondeu 404 em ${testedEndpoint}. Informe a Instance Key (ex: megabusiness-...) no campo correspondente para identificar a instância no servidor.`;
  }
  return `Servidor Megaapi respondeu 404 em ${testedEndpoint}. Verifique o HOST cadastrado (ex: https://apibusiness1.megaapi.com.br) e confirme se a Instance Key e o Token estão ativos no painel da Megaapi.`;
}

function buildCorsGuidanceMessage(testedEndpoint: string): string {
  return `Não foi possível acessar ${testedEndpoint} diretamente pelo navegador (bloqueio de CORS ou rede indisponível). Use o Modo de Simulação / Teste abaixo para validar o fluxo e gravar o registro em public.messages no Supabase.`;
}

/**
 * Checks whether the clinic's Megaapi WhatsApp instance is connected or requires QR Code scan.
 * Combines configured HOST with Instance Key and Bearer Token in headers and route candidates.
 */
export async function checkMegaapiConnectionStatus(
  clinicConfig?: MegaapiClinicConfig | Partial<Clinic>
): Promise<MegaapiConnectionResult> {
  const { instanceUrl, instanceKey, token, isConfigured, hasInstanceKey } =
    resolveMegaapiCredentials(clinicConfig);

  if (!isConfigured) {
    return {
      connected: false,
      status: 'UNCONFIGURED',
      message: 'Informe a URL (Host), a Instance Key e o Token de acesso para verificar a conexão.',
    };
  }

  if (!hasInstanceKey) {
    return {
      connected: false,
      status: 'UNCONFIGURED',
      message:
        'Informe a Instance Key da Megaapi (ex: megabusiness-MH7CY257SQCAASLHMW73HB9GZ64) para identificar a instância corretamente.',
    };
  }

  const candidates = buildStatusEndpointCandidates(instanceUrl, instanceKey);
  const headers = buildMegaapiHeaders(token, instanceKey, false);

  let lastHttpStatus: number | undefined;
  let lastEndpoint = candidates[0] || instanceUrl;
  let fallbackDisconnectedResult: MegaapiConnectionResult | null = null;

  for (const statusEndpoint of candidates) {
    lastEndpoint = statusEndpoint;

    try {
      const response = await fetch(statusEndpoint, {
        method: 'GET',
        headers,
      });

      lastHttpStatus = response.status;

      if (response.status === 404) {
        continue;
      }

      if (response.status === 401 || response.status === 403) {
        return {
          connected: false,
          status: 'ERROR',
          httpStatus: response.status,
          testedEndpoint: statusEndpoint,
          instanceKey,
          message: `Autenticação recusada pela Megaapi (HTTP ${response.status}). Verifique se o Token (megaapi_token) e a Instance Key (megaapi_instance_key) estão corretos.`,
        };
      }

      if (!response.ok) {
        return {
          connected: false,
          status: 'ERROR',
          httpStatus: response.status,
          testedEndpoint: statusEndpoint,
          instanceKey,
          message: `Servidor Megaapi retornou HTTP ${response.status} em ${statusEndpoint}. Verifique as configurações da instância.`,
        };
      }

      const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      const instanceObj = (data.instance as Record<string, unknown> | undefined) || data;

      const rawState = String(
        instanceObj.connection_status ||
          instanceObj.connectionStatus ||
          instanceObj.status ||
          instanceObj.state ||
          data.connection_status ||
          data.connectionStatus ||
          data.status ||
          data.state ||
          ''
      )
        .trim()
        .toUpperCase();

      const qrCode =
        (instanceObj.qrcode as string | undefined) ||
        (instanceObj.qrCode as string | undefined) ||
        (data.qrcode as string | undefined) ||
        (data.base64 as string | undefined);

      const rawPhoneJid =
        (instanceObj.user as { id?: string } | undefined)?.id ||
        (data.user as { id?: string } | undefined)?.id ||
        (instanceObj.phone as string | undefined) ||
        (instanceObj.owner as string | undefined) ||
        (instanceObj.number as string | undefined) ||
        (instanceObj.wid as string | undefined) ||
        (data.phone as string | undefined);

      const phoneNumber = extractCleanWhatsAppNumber(rawPhoneJid);

      const instanceName =
        (instanceObj.instanceName as string | undefined) ||
        (instanceObj.key as string | undefined) ||
        (instanceObj.name as string | undefined) ||
        instanceKey;

      const isExplicitlyDisconnected =
        ['DISCONNECTED', 'CLOSE', 'CLOSED', 'LOGOUT', 'OFFLINE'].includes(rawState) ||
        data.error === true;

      const isConnected =
        !isExplicitlyDisconnected &&
        (instanceObj.connected === true ||
          instanceObj.phone_connected === true ||
          data.connected === true ||
          data.phone_connected === true ||
          ['CONNECTED', 'OPEN', 'ONLINE', 'AUTHENTICATED'].includes(rawState) ||
          (Boolean(phoneNumber) &&
            !['QRCODE', 'PAIRING', 'CONNECTING'].includes(rawState)));

      if (isConnected) {
        return {
          connected: true,
          status: 'CONNECTED',
          httpStatus: response.status,
          testedEndpoint: statusEndpoint,
          phoneNumber,
          instanceName,
          instanceKey,
          message: phoneNumber
            ? `Instância conectada ao WhatsApp ${phoneNumber} e pronta para envios em tempo real.`
            : 'Instância conectada e pronta para envios em tempo real.',
        };
      }

      if (
        qrCode ||
        rawState.includes('QR') ||
        rawState === 'CONNECTING' ||
        rawState === 'PAIRING'
      ) {
        return {
          connected: false,
          status: 'QRCODE_REQUIRED',
          httpStatus: response.status,
          testedEndpoint: statusEndpoint,
          qrCode,
          instanceName,
          instanceKey,
          message: 'Instância aguardando leitura do QR Code do WhatsApp.',
        };
      }

      fallbackDisconnectedResult = {
        connected: false,
        status: 'DISCONNECTED',
        httpStatus: response.status,
        testedEndpoint: statusEndpoint,
        instanceName,
        instanceKey,
        message:
          (data.message as string | undefined) ||
          'Instância desconectada. Reconecte o aparelho via QR Code no painel da Megaapi.',
      };

      // If this route returned an error payload (e.g., generic /status without instance match), try remaining candidates
      if (data.error === true) {
        continue;
      }

      return fallbackDisconnectedResult;
    } catch (err) {
      if (isLikelyCorsOrNetworkError(err)) {
        return {
          connected: false,
          status: 'CORS_BLOCKED',
          isCorsBlocked: true,
          testedEndpoint: statusEndpoint,
          instanceKey,
          message: buildCorsGuidanceMessage(statusEndpoint),
        };
      }

      const errMsg = err instanceof Error ? err.message : 'Erro inesperado ao consultar instância.';
      return {
        connected: false,
        status: 'ERROR',
        testedEndpoint: statusEndpoint,
        instanceKey,
        message: `Falha ao conectar ao servidor Megaapi: ${errMsg}`,
      };
    }
  }

  if (fallbackDisconnectedResult) {
    return fallbackDisconnectedResult;
  }

  // All normalized status endpoints returned 404
  return {
    connected: false,
    status: 'NOT_FOUND',
    httpStatus: lastHttpStatus || 404,
    testedEndpoint: lastEndpoint,
    instanceKey,
    message: buildNotFoundGuidanceMessage(lastEndpoint, hasInstanceKey),
  };
}

/**
 * Simulates a Megaapi WhatsApp message dispatch and persists the audit/conversation record
 * into public.messages on Supabase (and localStorage cache) so end-to-end validation works
 * even when browser CORS or 404 blocks direct client-side requests.
 */
export async function simulateWhatsAppMessage(
  phone: string,
  message: string,
  context?: MegaapiMessageContext
): Promise<MegaapiSendResult> {
  const cleanPhone = formatMegaapiPhone(phone);
  if (!cleanPhone || cleanPhone.length < 12) {
    return {
      success: false,
      cleanPhone,
      error: 'Número de WhatsApp inválido. Informe DDD e telefone completo.',
    };
  }

  const trimmedMessage = String(message || '').trim();
  if (!trimmedMessage) {
    return {
      success: false,
      cleanPhone,
      error: 'A mensagem não pode estar vazia.',
    };
  }

  const clinic = StorageService.getClinic();
  const simulatedId = `sim_mega_${Date.now()}`;

  const { message: loggedMessage, syncedCloud } = await StorageService.sendMessageToCloud({
    organizationId: context?.organizationId || clinic.organizationId,
    branchId: context?.branchId,
    patientId: context?.patientId,
    appointmentId: context?.appointmentId,
    patientName: context?.patientName || 'Paciente',
    recipientPhone: phone,
    channel: 'whatsapp',
    direction: 'outbound',
    content: trimmedMessage,
    status: 'delivered',
    externalMessageId: simulatedId,
  });

  return {
    success: true,
    cleanPhone,
    messageId: simulatedId,
    statusCode: 200,
    isSimulated: true,
    loggedMessage,
    syncedSupabase: syncedCloud,
  };
}

/**
 * Sends a WhatsApp text message through the clinic's Megaapi instance and logs it to public.messages.
 * Combines HOST, Instance Key, and Bearer Token in headers and Megaapi REST/v1/v2 routes.
 */
export async function sendWhatsAppMessage(
  phone: string,
  message: string,
  clinicConfig?: MegaapiClinicConfig | Partial<Clinic>,
  context?: MegaapiMessageContext
): Promise<MegaapiSendResult> {
  if (context?.simulate) {
    return simulateWhatsAppMessage(phone, message, context);
  }

  const cleanPhone = formatMegaapiPhone(phone);
  if (!cleanPhone || cleanPhone.length < 12) {
    return {
      success: false,
      cleanPhone,
      error: 'Número de WhatsApp inválido. Informe DDD e telefone completo.',
    };
  }

  const trimmedMessage = String(message || '').trim();
  if (!trimmedMessage) {
    return {
      success: false,
      cleanPhone,
      error: 'A mensagem não pode estar vazia.',
    };
  }

  const { instanceUrl, instanceKey, token, isConfigured, hasInstanceKey } =
    resolveMegaapiCredentials(clinicConfig);

  if (!isConfigured || !hasInstanceKey) {
    if (context?.fallbackToSimulation) {
      return simulateWhatsAppMessage(phone, trimmedMessage, context);
    }
    return {
      success: false,
      cleanPhone,
      error: !isConfigured
        ? 'Credenciais da API de WhatsApp não configuradas para esta clínica.'
        : 'Instance Key da Megaapi não informada. Preencha o campo megaapi_instance_key nas configurações.',
    };
  }

  const candidates = buildSendEndpointCandidates(
    instanceUrl,
    cleanPhone,
    trimmedMessage,
    instanceKey
  );
  const headers = buildMegaapiHeaders(token, instanceKey, true);

  let lastStatusCode: number | undefined;
  let lastEndpoint = candidates[0]?.endpoint || instanceUrl;

  for (const { endpoint, body } of candidates) {
    lastEndpoint = endpoint;

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      lastStatusCode = response.status;

      if (response.status === 404) {
        continue;
      }

      const responseJson = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      if (!response.ok) {
        const apiErr =
          response.status === 401 || response.status === 403
            ? `Token ou Instance Key Megaapi inválido (HTTP ${response.status}).`
            : (responseJson.message as string | undefined) ||
              (responseJson.error as string | undefined) ||
              `Erro HTTP ${response.status} ao enviar mensagem.`;

        if (context?.recordAttemptOnFailure) {
          const clinic = StorageService.getClinic();
          await StorageService.sendMessageToCloud({
            organizationId: context.organizationId || clinic.organizationId,
            branchId: context.branchId,
            patientId: context.patientId,
            appointmentId: context.appointmentId,
            patientName: context.patientName || 'Paciente',
            recipientPhone: phone,
            channel: 'whatsapp',
            direction: 'outbound',
            content: trimmedMessage,
            status: 'failed',
          });
        }

        return {
          success: false,
          cleanPhone,
          statusCode: response.status,
          testedEndpoint: endpoint,
          error: apiErr,
        };
      }

      const messageId =
        (responseJson.id as string | undefined) ||
        (responseJson.messageId as string | undefined) ||
        ((responseJson.key as { id?: string } | undefined)?.id);

      const clinic = StorageService.getClinic();
      const { message: loggedMessage, syncedCloud } = await StorageService.sendMessageToCloud({
        organizationId: context?.organizationId || clinic.organizationId,
        branchId: context?.branchId,
        patientId: context?.patientId,
        appointmentId: context?.appointmentId,
        patientName: context?.patientName || 'Paciente',
        recipientPhone: phone,
        channel: 'whatsapp',
        direction: 'outbound',
        content: trimmedMessage,
        status: 'delivered',
        externalMessageId: messageId,
      });

      return {
        success: true,
        cleanPhone,
        messageId,
        statusCode: response.status,
        testedEndpoint: endpoint,
        loggedMessage,
        syncedSupabase: syncedCloud,
      };
    } catch (err) {
      const corsBlocked = isLikelyCorsOrNetworkError(err);
      if (corsBlocked && context?.fallbackToSimulation) {
        return simulateWhatsAppMessage(phone, trimmedMessage, context);
      }

      const errMsg = corsBlocked
        ? buildCorsGuidanceMessage(endpoint)
        : err instanceof Error
          ? err.message
          : 'Falha de comunicação ao enviar WhatsApp.';

      return {
        success: false,
        cleanPhone,
        isCorsError: corsBlocked,
        testedEndpoint: endpoint,
        error: errMsg,
      };
    }
  }

  // All send candidates returned 404
  if (context?.fallbackToSimulation) {
    return simulateWhatsAppMessage(phone, trimmedMessage, context);
  }

  return {
    success: false,
    cleanPhone,
    statusCode: lastStatusCode || 404,
    isNotFoundError: true,
    testedEndpoint: lastEndpoint,
    error: buildNotFoundGuidanceMessage(lastEndpoint, hasInstanceKey),
  };
}
