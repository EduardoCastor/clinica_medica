import { Clinic, MessageLog } from '../types';
import { StorageService } from './storage';

export interface MegaapiClinicConfig {
  megaapi_instance_url?: string;
  megaapiInstanceUrl?: string;
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

export function resolveMegaapiCredentials(clinicConfig?: MegaapiClinicConfig | Partial<Clinic>): {
  instanceUrl: string;
  token: string;
  isConfigured: boolean;
} {
  const storedClinic = StorageService.getClinic();
  const cfg = (clinicConfig || storedClinic) as MegaapiClinicConfig & Partial<Clinic>;

  const rawUrl =
    cfg.megaapiInstanceUrl ||
    cfg.megaapi_instance_url ||
    storedClinic.megaapiInstanceUrl ||
    '';

  const rawToken =
    cfg.megaapiToken ||
    cfg.megaapi_token ||
    cfg.access_token ||
    storedClinic.megaapiToken ||
    '';

  const instanceUrl = normalizeMegaapiBaseUrl(rawUrl);
  const token = rawToken.trim();

  return {
    instanceUrl,
    token,
    isConfigured: Boolean(instanceUrl && token),
  };
}

function parseUrlSafe(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
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

/**
 * Builds candidate status endpoints for Megaapi based on whether the user entered
 * a bare domain (e.g. https://apibusiness1.megaapi.com.br), a versioned prefix (/rest/v1, /api/v1),
 * or a full instance route.
 */
export function buildStatusEndpointCandidates(instanceUrl: string): string[] {
  const normalized = normalizeMegaapiBaseUrl(instanceUrl);
  if (!normalized) return [];

  const parsed = parseUrlSafe(normalized);
  if (!parsed) return [`${normalized}/rest/v1/instance/status`];

  const origin = parsed.origin;
  const pathname = parsed.pathname.replace(/\/+$/, '');

  // If user entered only the domain (no path), complement automatically with standard Megaapi routes
  if (!pathname || pathname === '') {
    return [
      `${origin}/rest/v1/instance/status`,
      `${origin}/api/v1/instance/status`,
      `${origin}/rest/instance/status`,
      `${origin}/v2/instances/status`,
    ];
  }

  // Already a status / connectionState endpoint
  if (/\/(status|connectionState)(\/|$)/i.test(pathname)) {
    return [normalized];
  }

  // Versioned prefix only (/rest/v1 or /api/v1)
  if (/^\/(rest|api)\/v\d+$/i.test(pathname)) {
    return [`${normalized}/instance/status`, `${normalized}/status`];
  }

  // REST sendMessage URL -> map to connectionState
  const restSendMatch = pathname.match(/\/rest\/(?:v\d+\/)?sendMessage\/([^/]+)\/text$/i);
  if (restSendMatch) {
    const prefix = pathname.includes('/rest/v1') ? '/rest/v1' : '/rest';
    return [
      `${origin}${prefix}/instance/connectionState/${restSendMatch[1]}`,
      `${origin}${prefix}/instance/status`,
    ];
  }

  // REST instance URL (.../rest/instance/{key} or .../rest/v1/instance/{key})
  const restInstanceMatch = pathname.match(/^(\/rest(?:\/v\d+)?)\/(?:instance\/)?([^/]+)$/i);
  if (restInstanceMatch && restInstanceMatch[2].toLowerCase() !== 'instance') {
    const [, prefix, instanceKey] = restInstanceMatch;
    return [
      `${origin}${prefix}/instance/connectionState/${instanceKey}`,
      `${origin}${prefix}/instance/status/${instanceKey}`,
      `${normalized}/status`,
    ];
  }

  // Megaapi v2 text endpoint (.../messages/text)
  if (/\/messages\/text$/i.test(pathname)) {
    return [normalized.replace(/\/messages\/text$/i, '/status')];
  }

  return [
    `${normalized}/status`,
    `${origin}/rest/v1/instance/status`,
    `${origin}/api/v1/instance/status`,
  ];
}

function buildSendEndpointCandidates(
  instanceUrl: string,
  cleanPhone: string,
  message: string
): Array<{ endpoint: string; body: Record<string, unknown> }> {
  const normalized = normalizeMegaapiBaseUrl(instanceUrl);
  const parsed = parseUrlSafe(normalized);
  const origin = parsed?.origin || normalized;
  const pathname = (parsed?.pathname || '').replace(/\/+$/, '');

  const restBody: Record<string, unknown> = {
    messageData: {
      to: `${cleanPhone}@s.whatsapp.net`,
      text: message,
    },
  };

  const v2Body: Record<string, unknown> = {
    to: cleanPhone,
    number: cleanPhone,
    text: message,
  };

  // Bare domain (https://apibusiness1.megaapi.com.br)
  if (!pathname) {
    return [
      { endpoint: `${origin}/rest/v1/message/text`, body: v2Body },
      { endpoint: `${origin}/api/v1/message/text`, body: v2Body },
      { endpoint: `${origin}/rest/v1/messages/text`, body: v2Body },
    ];
  }

  // Explicit REST sendMessage path
  if (/\/rest\/(?:v\d+\/)?sendMessage\/[^/]+\/text$/i.test(pathname)) {
    return [{ endpoint: normalized, body: restBody }];
  }

  // Versioned prefix only (/rest/v1 or /api/v1)
  if (/^\/(rest|api)\/v\d+$/i.test(pathname)) {
    return [
      { endpoint: `${normalized}/message/text`, body: v2Body },
      { endpoint: `${normalized}/messages/text`, body: v2Body },
    ];
  }

  // Status URL passed as instanceUrl -> rewrite to text dispatch
  if (/\/instance\/status$/i.test(pathname)) {
    return [
      { endpoint: normalized.replace(/\/instance\/status$/i, '/message/text'), body: v2Body },
      { endpoint: normalized.replace(/\/instance\/status$/i, '/sendMessage/text'), body: restBody },
    ];
  }

  // REST instance key URL (.../rest/instance/{key})
  const restInstanceMatch = pathname.match(/^(\/rest(?:\/v\d+)?)\/(?:instance\/)?([^/]+)$/i);
  if (restInstanceMatch && restInstanceMatch[2].toLowerCase() !== 'instance') {
    const [, prefix, instanceKey] = restInstanceMatch;
    return [
      { endpoint: `${origin}${prefix}/sendMessage/${instanceKey}/text`, body: restBody },
      { endpoint: `${normalized}/messages/text`, body: v2Body },
    ];
  }

  // Explicit /messages/text or /message/text
  if (/\/messages?\/text$/i.test(pathname)) {
    return [{ endpoint: normalized, body: v2Body }];
  }

  return [
    { endpoint: `${normalized}/messages/text`, body: v2Body },
    { endpoint: `${normalized}/message/text`, body: v2Body },
    { endpoint: `${origin}/rest/v1/message/text`, body: v2Body },
  ];
}

function buildNotFoundGuidanceMessage(testedEndpoint: string): string {
  return `Servidor Megaapi respondeu 404 em ${testedEndpoint}. Verifique se o caminho da instância no painel da Megaapi inclui o prefixo correto (/rest/v1, /api/v1 ou /rest/instance/...) e o identificador da instância.`;
}

function buildCorsGuidanceMessage(testedEndpoint: string): string {
  return `Não foi possível acessar ${testedEndpoint} diretamente pelo navegador (bloqueio de CORS ou rede indisponível). Use o Modo de Simulação / Teste abaixo para validar o fluxo e gravar o registro em public.messages no Supabase.`;
}

/**
 * Checks whether the clinic's Megaapi WhatsApp instance is connected or requires QR Code scan.
 * Normalizes bare URLs and handles HTTP 404 and browser CORS errors gracefully.
 */
export async function checkMegaapiConnectionStatus(
  clinicConfig?: MegaapiClinicConfig | Partial<Clinic>
): Promise<MegaapiConnectionResult> {
  const { instanceUrl, token, isConfigured } = resolveMegaapiCredentials(clinicConfig);

  if (!isConfigured) {
    return {
      connected: false,
      status: 'UNCONFIGURED',
      message: 'Informe a URL da instância e o Token de acesso para verificar a conexão.',
    };
  }

  const candidates = buildStatusEndpointCandidates(instanceUrl);
  let lastHttpStatus: number | undefined;
  let lastEndpoint = candidates[0] || instanceUrl;

  for (const statusEndpoint of candidates) {
    lastEndpoint = statusEndpoint;

    try {
      const response = await fetch(statusEndpoint, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });

      lastHttpStatus = response.status;

      if (response.status === 404) {
        // Try next normalized candidate if available
        continue;
      }

      if (response.status === 401 || response.status === 403) {
        return {
          connected: false,
          status: 'ERROR',
          httpStatus: response.status,
          testedEndpoint: statusEndpoint,
          message: `Autenticação recusada pela Megaapi (HTTP ${response.status}). Verifique se o Token (megaapi_token) está correto e ativo.`,
        };
      }

      if (!response.ok) {
        return {
          connected: false,
          status: 'ERROR',
          httpStatus: response.status,
          testedEndpoint: statusEndpoint,
          message: `Servidor Megaapi retornou HTTP ${response.status} em ${statusEndpoint}. Verifique as configurações da instância.`,
        };
      }

      const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      const instanceObj = (data.instance as Record<string, unknown> | undefined) || data;

      const rawState = String(
        instanceObj.status ||
          instanceObj.state ||
          instanceObj.connectionStatus ||
          data.status ||
          data.state ||
          ''
      ).toUpperCase();

      const qrCode =
        (instanceObj.qrcode as string | undefined) ||
        (instanceObj.qrCode as string | undefined) ||
        (data.qrcode as string | undefined) ||
        (data.base64 as string | undefined);

      const phoneNumber =
        (instanceObj.phone as string | undefined) ||
        (instanceObj.owner as string | undefined) ||
        (instanceObj.user as { id?: string } | undefined)?.id;

      const instanceName =
        (instanceObj.instanceName as string | undefined) ||
        (instanceObj.key as string | undefined) ||
        (instanceObj.name as string | undefined);

      const isConnected =
        Boolean(instanceObj.connected) ||
        Boolean(data.connected) ||
        rawState === 'CONNECTED' ||
        rawState === 'OPEN';

      if (isConnected) {
        return {
          connected: true,
          status: 'CONNECTED',
          httpStatus: response.status,
          testedEndpoint: statusEndpoint,
          phoneNumber,
          instanceName,
          message: 'Instância conectada e pronta para envios em tempo real.',
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
          message: 'Instância aguardando leitura do QR Code do WhatsApp.',
        };
      }

      return {
        connected: false,
        status: 'DISCONNECTED',
        httpStatus: response.status,
        testedEndpoint: statusEndpoint,
        instanceName,
        message: 'Instância desconectada. Reconecte o aparelho via QR Code no painel da Megaapi.',
      };
    } catch (err) {
      if (isLikelyCorsOrNetworkError(err)) {
        return {
          connected: false,
          status: 'CORS_BLOCKED',
          isCorsBlocked: true,
          testedEndpoint: statusEndpoint,
          message: buildCorsGuidanceMessage(statusEndpoint),
        };
      }

      const errMsg = err instanceof Error ? err.message : 'Erro inesperado ao consultar instância.';
      return {
        connected: false,
        status: 'ERROR',
        testedEndpoint: statusEndpoint,
        message: `Falha ao conectar ao servidor Megaapi: ${errMsg}`,
      };
    }
  }

  // All normalized status endpoints returned 404
  return {
    connected: false,
    status: 'NOT_FOUND',
    httpStatus: lastHttpStatus || 404,
    testedEndpoint: lastEndpoint,
    message: buildNotFoundGuidanceMessage(lastEndpoint),
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
 * Supports simulation mode and clear 404/CORS error guidance.
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

  const { instanceUrl, token, isConfigured } = resolveMegaapiCredentials(clinicConfig);
  if (!isConfigured) {
    if (context?.fallbackToSimulation) {
      return simulateWhatsAppMessage(phone, trimmedMessage, context);
    }
    return {
      success: false,
      cleanPhone,
      error: 'Credenciais da API de WhatsApp não configuradas para esta clínica.',
    };
  }

  const candidates = buildSendEndpointCandidates(instanceUrl, cleanPhone, trimmedMessage);
  let lastStatusCode: number | undefined;
  let lastEndpoint = candidates[0]?.endpoint || instanceUrl;

  for (const { endpoint, body } of candidates) {
    lastEndpoint = endpoint;

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      lastStatusCode = response.status;

      if (response.status === 404) {
        // Try next candidate route
        continue;
      }

      const responseJson = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      if (!response.ok) {
        const apiErr =
          response.status === 401 || response.status === 403
            ? `Token Megaapi inválido ou sem autorização (HTTP ${response.status}).`
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
    error: buildNotFoundGuidanceMessage(lastEndpoint),
  };
}
