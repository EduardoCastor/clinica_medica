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
}

export interface MegaapiSendResult {
  success: boolean;
  cleanPhone: string;
  messageId?: string;
  statusCode?: number;
  error?: string;
  loggedMessage?: MessageLog;
  syncedSupabase?: boolean;
}

export type MegaapiConnectionStatusCode =
  | 'CONNECTED'
  | 'QRCODE_REQUIRED'
  | 'DISCONNECTED'
  | 'UNCONFIGURED'
  | 'ERROR';

export interface MegaapiConnectionResult {
  connected: boolean;
  status: MegaapiConnectionStatusCode;
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

  const instanceUrl = rawUrl.trim().replace(/\/+$/, '');
  const token = rawToken.trim();

  return {
    instanceUrl,
    token,
    isConfigured: Boolean(instanceUrl && token),
  };
}

function buildSendEndpointAndBody(
  instanceUrl: string,
  cleanPhone: string,
  message: string
): { endpoint: string; body: Record<string, unknown> } {
  // Pattern 1: Megaapi REST explicit endpoint (.../rest/sendMessage/{instanceKey}/text)
  if (/\/rest\/sendMessage\/[^/]+\/text$/i.test(instanceUrl)) {
    return {
      endpoint: instanceUrl,
      body: {
        messageData: {
          to: `${cleanPhone}@s.whatsapp.net`,
          text: message,
        },
      },
    };
  }

  // Pattern 2: Megaapi REST instance URL (.../rest/instance/{instanceKey})
  const restInstanceMatch = instanceUrl.match(/^(https?:\/\/[^/]+)\/rest\/(?:instance\/)?([^/]+)$/i);
  if (restInstanceMatch) {
    const [, origin, instanceKey] = restInstanceMatch;
    return {
      endpoint: `${origin}/rest/sendMessage/${instanceKey}/text`,
      body: {
        messageData: {
          to: `${cleanPhone}@s.whatsapp.net`,
          text: message,
        },
      },
    };
  }

  // Pattern 3: Megaapi v2 explicit text endpoint (.../messages/text)
  if (/\/messages\/text$/i.test(instanceUrl)) {
    return {
      endpoint: instanceUrl,
      body: {
        to: cleanPhone,
        number: cleanPhone,
        text: message,
      },
    };
  }

  // Pattern 4: Megaapi v2 instance base URL (https://api.megaapi.com.br/v2/instances/{id})
  return {
    endpoint: `${instanceUrl}/messages/text`,
    body: {
      to: cleanPhone,
      number: cleanPhone,
      text: message,
    },
  };
}

function buildStatusEndpoint(instanceUrl: string): string {
  if (/\/(status|connectionState)(\/|$)/i.test(instanceUrl)) {
    return instanceUrl;
  }

  if (/\/rest\/sendMessage\/([^/]+)\/text$/i.test(instanceUrl)) {
    const match = instanceUrl.match(/^(https?:\/\/[^/]+)\/rest\/sendMessage\/([^/]+)\/text$/i);
    if (match) {
      return `${match[1]}/rest/instance/connectionState/${match[2]}`;
    }
  }

  const restMatch = instanceUrl.match(/^(https?:\/\/[^/]+)\/rest\/(?:instance\/)?([^/]+)$/i);
  if (restMatch) {
    return `${restMatch[1]}/rest/instance/connectionState/${restMatch[2]}`;
  }

  if (/\/messages\/text$/i.test(instanceUrl)) {
    return instanceUrl.replace(/\/messages\/text$/i, '/status');
  }

  return `${instanceUrl}/status`;
}

/**
 * Checks whether the clinic's Megaapi WhatsApp instance is connected or requires QR Code scan.
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

  const statusEndpoint = buildStatusEndpoint(instanceUrl);

  try {
    const response = await fetch(statusEndpoint, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      return {
        connected: false,
        status: 'ERROR',
        message: `Não foi possível consultar a instância (HTTP ${response.status}). Verifique a URL e o Token.`,
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
        qrCode,
        instanceName,
        message: 'Instância aguardando leitura do QR Code do WhatsApp.',
      };
    }

    return {
      connected: false,
      status: 'DISCONNECTED',
      instanceName,
      message: 'Instância desconectada. Reconecte o aparelho via QR Code.',
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Erro de rede ao consultar instância.';
    return {
      connected: false,
      status: 'ERROR',
      message: `Falha ao conectar ao servidor de WhatsApp: ${errMsg}`,
    };
  }
}

/**
 * Sends a WhatsApp text message through the clinic's Megaapi instance and logs it to public.messages.
 */
export async function sendWhatsAppMessage(
  phone: string,
  message: string,
  clinicConfig?: MegaapiClinicConfig | Partial<Clinic>,
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

  const { instanceUrl, token, isConfigured } = resolveMegaapiCredentials(clinicConfig);
  if (!isConfigured) {
    return {
      success: false,
      cleanPhone,
      error: 'Credenciais da API de WhatsApp não configuradas para esta clínica.',
    };
  }

  const { endpoint, body } = buildSendEndpointAndBody(instanceUrl, cleanPhone, trimmedMessage);

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

    const responseJson = (await response.json().catch(() => ({}))) as Record<string, unknown>;

    if (!response.ok) {
      const apiErr =
        (responseJson.message as string | undefined) ||
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
      loggedMessage,
      syncedSupabase: syncedCloud,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Falha de comunicação ao enviar WhatsApp.';
    return {
      success: false,
      cleanPhone,
      error: errMsg,
    };
  }
}
