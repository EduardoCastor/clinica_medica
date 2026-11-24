import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  MessageSquare,
  Send,
  CheckCheck,
  Smartphone,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Settings,
  Wifi,
  WifiOff,
  QrCode,
  Loader2,
  Save,
  KeyRound,
  Link2,
  FlaskConical,
  Hash,
  Plus,
  Copy,
  Check,
  Smile,
  FileEdit,
  Sparkles,
} from 'lucide-react';
import { MessageTemplate, MessageLog, AutomationTriggerSettings } from '../../types';
import { StorageService } from '../../services/storage';
import { useTenant } from '../../contexts/TenantContext';
import { useAuth } from '../../contexts/AuthContext';
import {
  sendWhatsAppMessage,
  simulateWhatsAppMessage,
  checkMegaapiConnectionStatus,
  resolveMegaapiCredentials,
  normalizeMegaapiBaseUrl,
  MegaapiConnectionResult,
} from '../../services/megaApiService';
import { WhatsAppAutomationManager } from './WhatsAppAutomationManager';

const TEMPLATE_VARIABLES = [
  { tag: '{{nome_paciente}}', label: 'Paciente' },
  { tag: '{{nome_clinica}}', label: 'Clínica' },
  { tag: '{{nome_profissional}}', label: 'Profissional' },
  { tag: '{{data_consulta}}', label: 'Data' },
  { tag: '{{horario_consulta}}', label: 'Horário' },
  { tag: '{{endereco_filial}}', label: 'Endereço' },
];

const WHATSAPP_EMOJIS = ['👋', '✅', '📅', '⏰', '📍', '🩺', '📄', '💊', '💚', '✨', '🔄', '🙏'];

const CATEGORY_LABELS: Record<MessageTemplate['category'], string> = {
  immediate_confirmation: 'Confirmação Imediata',
  confirmation_48h: 'Confirmação 48h',
  reminder_24h: 'Lembrete de Véspera (24h)',
  day_reminder: 'Lembrete do Dia',
  soon_reminder: 'Lembrete Próximo do Horário',
  confirmation_reply: 'Resposta Automática',
  post_care: 'Orientações Pós-Atendimento',
  follow_up: 'Acompanhamento Pós-Consulta',
  birthday: 'Aniversário',
  custom: 'Personalizado',
};

const DEFAULT_AUTOMATION_TRIGGERS: AutomationTriggerSettings = {
  immediateConfirmation: true,
  confirmation48h: true,
  reminder24h: true,
  autoReplyConfirm: true,
  postCare: true,
};

const DEFAULT_INBOUND_N8N_WEBHOOK =
  'https://n8n.srv1352561.hstgr.cloud/webhook/megaapi-whatsapp-inbound';

function renderFormattedWhatsAppText(text: string): React.ReactNode {
  const lines = text.split('\n');
  return lines.map((line, lineIdx) => {
    const parts = line.split(/(\*[^*]+\*)/g);
    return (
      <React.Fragment key={lineIdx}>
        {parts.map((part, partIdx) =>
          part.startsWith('*') && part.endsWith('*') && part.length > 2 ? (
            <strong key={partIdx} className="font-semibold text-slate-900">
              {part.slice(1, -1)}
            </strong>
          ) : (
            <React.Fragment key={partIdx}>{part}</React.Fragment>
          )
        )}
        {lineIdx < lines.length - 1 && <br />}
      </React.Fragment>
    );
  });
}

export const CommunicationModule: React.FC = () => {
  const { activeBranchId, branches, clinic, organization, updateClinic } = useTenant();
  const { canCreateInMenu, canEditInMenu, canAdminMenu } = useAuth();
  const canDispatchWhatsapp = canCreateInMenu('communication') || canEditInMenu('communication');
  const canEditCommunication = canEditInMenu('communication') || canAdminMenu('communication');
  const canConfigureMegaapi = canAdminMenu('communication') || canEditInMenu('communication');

  const [messages, setMessages] = useState<MessageLog[]>(() => StorageService.getMessages());
  const [templates, setTemplates] = useState<MessageTemplate[]>(() =>
    StorageService.getTemplates()
  );
  const patients = StorageService.getPatients(activeBranchId);
  const professionals = StorageService.getProfessionals();

  // Dispatcher State
  const [selectedPatientId, setSelectedPatientId] = useState(patients[0]?.id || '');
  const [selectedTemplateId, setSelectedTemplateId] = useState(templates[0]?.id || '');
  const [customText, setCustomText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isSimulationMode, setIsSimulationMode] = useState(false);
  const [dispatchFeedback, setDispatchFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
    canSimulateFallback?: boolean;
  } | null>(null);

  // Template Editor State
  const templateTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [editingTemplateId, setEditingTemplateId] = useState<string>(templates[0]?.id || '');
  const [tplName, setTplName] = useState<string>(templates[0]?.name || '');
  const [tplCategory, setTplCategory] = useState<MessageTemplate['category']>(
    templates[0]?.category || 'confirmation_48h'
  );
  const [tplContent, setTplContent] = useState<string>(templates[0]?.content || '');
  const [tplIsActive, setTplIsActive] = useState<boolean>(templates[0]?.isActive ?? true);
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [templatesSyncSource, setTemplatesSyncSource] = useState<'cloud' | 'local'>('local');
  const [templateFeedback, setTemplateFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Inbound auto-reply webhook state
  const [n8nInboundWebhook, setN8nInboundWebhook] = useState<string>(
    clinic.n8nWebhookMegaapiInbound || DEFAULT_INBOUND_N8N_WEBHOOK
  );
  const [automationTriggers, setAutomationTriggers] = useState<AutomationTriggerSettings>(
    clinic.automationTriggers || DEFAULT_AUTOMATION_TRIGGERS
  );

  // Megaapi Settings & Status State
  const [megaapiInstanceUrl, setMegaapiInstanceUrl] = useState(clinic.megaapiInstanceUrl || '');
  const [megaapiInstanceKey, setMegaapiInstanceKey] = useState(clinic.megaapiInstanceKey || '');
  const [megaapiToken, setMegaapiToken] = useState(clinic.megaapiToken || '');
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [configFeedback, setConfigFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<MegaapiConnectionResult>(() => {
    const creds = resolveMegaapiCredentials(clinic);
    return creds.isConfigured && creds.hasInstanceKey
      ? {
          connected: false,
          status: 'DISCONNECTED',
          message: 'Clique em "Verificar Conexão" para consultar a instância.',
        }
      : {
          connected: false,
          status: 'UNCONFIGURED',
          message: 'Configure o Host, a Instance Key e o Token na aba Configuração Megaapi.',
        };
  });
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  const [isRefreshingMessages, setIsRefreshingMessages] = useState(false);

  // Active Tab
  const [activeTab, setActiveTab] = useState<'messages' | 'templates' | 'automations' | 'config'>(
    'messages'
  );

  const selectedPatient = patients.find((p) => p.id === selectedPatientId) || patients[0];
  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId) || templates[0];
  const activeBranch = branches.find(
    (b) => b.id === (selectedPatient?.originBranchId || branches[0]?.id)
  );

  const selectTemplateForEditing = useCallback((tpl: MessageTemplate) => {
    setEditingTemplateId(tpl.id);
    setTplName(tpl.name);
    setTplCategory(tpl.category);
    setTplContent(tpl.content);
    setTplIsActive(tpl.isActive);
    setTemplateFeedback(null);
  }, []);

  const loadMessagesAndClinic = useCallback(async () => {
    setIsRefreshingMessages(true);
    const activeTenantOrgId = clinic.organizationId || organization.id;
    const [{ clinic: cloudClinic }, cloudMessages, cloudTemplatesResult] = await Promise.all([
      StorageService.fetchClinicFromCloud({
        clinicId: clinic.id,
        organizationId: activeTenantOrgId,
        slug: organization.slug,
      }),
      StorageService.fetchMessagesFromCloud(),
      StorageService.fetchTemplatesFromCloud({
        organizationId: activeTenantOrgId,
        slug: organization.slug,
      }),
    ]);

    const loadedTemplates = cloudTemplatesResult.templates;
    setMessages(cloudMessages);
    setTemplates(loadedTemplates);
    setTemplatesSyncSource(cloudTemplatesResult.source);

    if (loadedTemplates.length > 0) {
      setEditingTemplateId((currId) => {
        const match = loadedTemplates.find((t) => t.id === currId) || loadedTemplates[0];
        if (match) {
          setTplName(match.name);
          setTplCategory(match.category);
          setTplContent(match.content);
          setTplIsActive(match.isActive);
          return match.id;
        }
        return currId;
      });
    }

    if (cloudClinic.megaapiInstanceUrl !== undefined) {
      setMegaapiInstanceUrl(cloudClinic.megaapiInstanceUrl || '');
    }
    if (cloudClinic.megaapiInstanceKey !== undefined) {
      setMegaapiInstanceKey(cloudClinic.megaapiInstanceKey || '');
    }
    if (cloudClinic.megaapiToken !== undefined) {
      setMegaapiToken(cloudClinic.megaapiToken || '');
    }
    if (cloudClinic.n8nWebhookMegaapiInbound) {
      setN8nInboundWebhook(cloudClinic.n8nWebhookMegaapiInbound);
    }
    if (cloudClinic.automationTriggers) {
      setAutomationTriggers(cloudClinic.automationTriggers);
    }
    setIsRefreshingMessages(false);

    const creds = resolveMegaapiCredentials(cloudClinic);
    if (creds.isConfigured && creds.hasInstanceKey) {
      const statusRes = await checkMegaapiConnectionStatus(cloudClinic);
      setConnectionStatus(statusRes);
    }
  }, [clinic.id, clinic.organizationId, organization.id, organization.slug]);

  useEffect(() => {
    void loadMessagesAndClinic();
  }, [loadMessagesAndClinic]);

  const handleCheckConnection = async (
    customUrl?: string,
    customTok?: string,
    customKey?: string
  ) => {
    setIsCheckingStatus(true);
    const result = await checkMegaapiConnectionStatus({
      megaapiInstanceUrl: customUrl !== undefined ? customUrl : megaapiInstanceUrl,
      megaapiInstanceKey: customKey !== undefined ? customKey : megaapiInstanceKey,
      megaapiToken: customTok !== undefined ? customTok : megaapiToken,
    });
    setConnectionStatus(result);
    setIsCheckingStatus(false);
  };

  // Compute preview with dynamic variables
  const generatePreview = (templateContent: string) => {
    const samplePatientName = selectedPatient?.fullName || 'Camila Albuquerque';
    const sampleBranchAddress = activeBranch
      ? `${activeBranch.street || 'Av. Júlia Kubitschek'}, ${activeBranch.number || '16'} - ${activeBranch.neighborhood || 'Centro'}`
      : 'Av. Júlia Kubitschek, 16 - Centro, Cabo Frio';

    let text = templateContent;
    text = text.replace(/{{nome_paciente}}/g, samplePatientName);
    text = text.replace(/{{nome_clinica}}/g, clinic.tradeName.split('-')[0].trim());
    text = text.replace(/{{nome_profissional}}/g, professionals[0]?.fullName || 'Dr. Newton Mureb');
    text = text.replace(/{{data_consulta}}/g, new Date().toLocaleDateString('pt-BR'));
    text = text.replace(/{{horario_consulta}}/g, '14:30');
    text = text.replace(/{{endereco_filial}}/g, sampleBranchAddress);
    return text;
  };

  const handleInsertSnippetAtCursor = (snippet: string) => {
    const textarea = templateTextareaRef.current;
    if (!textarea) {
      setTplContent((prev) => `${prev}${snippet}`);
      return;
    }

    const start = textarea.selectionStart ?? tplContent.length;
    const end = textarea.selectionEnd ?? tplContent.length;
    const nextValue = tplContent.slice(0, start) + snippet + tplContent.slice(end);
    setTplContent(nextValue);

    requestAnimationFrame(() => {
      textarea.focus();
      const nextPos = start + snippet.length;
      textarea.setSelectionRange(nextPos, nextPos);
    });
  };

  const handleCreateNewTemplate = () => {
    const newId = `tpl_custom_${Date.now()}`;
    setEditingTemplateId(newId);
    setTplName('Novo Modelo WhatsApp');
    setTplCategory('custom');
    setTplContent(
      'Olá, {{nome_paciente}}! 👋\n\nEscreva aqui sua mensagem personalizada da *{{nome_clinica}}*.'
    );
    setTplIsActive(true);
    setTemplateFeedback(null);
  };

  const handleSaveTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tplName.trim() || !tplContent.trim()) {
      setTemplateFeedback({
        type: 'error',
        text: 'Informe o nome e o corpo da mensagem antes de salvar.',
      });
      return;
    }

    setIsSavingTemplate(true);
    setTemplateFeedback(null);

    const activeTenantOrgId = clinic.organizationId || organization.id;
    const payload: MessageTemplate = {
      id: editingTemplateId || `tpl_custom_${Date.now()}`,
      organizationId: activeTenantOrgId,
      name: tplName.trim(),
      category: tplCategory,
      channel: 'whatsapp',
      content: tplContent,
      variables: [],
      isActive: tplIsActive,
    };

    const res = await StorageService.saveTemplateToCloud(payload, {
      organizationId: activeTenantOrgId,
      slug: organization.slug,
    });
    const updatedTemplates = StorageService.getTemplates();
    setTemplates(updatedTemplates);
    setEditingTemplateId(res.template.id);
    setSelectedTemplateId(res.template.id);
    setIsSavingTemplate(false);

    if (res.syncedCloud) {
      setTemplatesSyncSource('cloud');
      setTemplateFeedback({
        type: 'success',
        text: `Modelo "${res.template.name}" salvo e sincronizado com sucesso!`,
      });
    } else {
      setTemplateFeedback({
        type: 'error',
        text: `Alteração salva localmente, mas não foi possível sincronizar na nuvem: ${res.error || 'verifique sua conexão ou permissões de acesso.'}`,
      });
    }
  };

  const handleSaveInboundWebhook = async (webhookUrl: string) => {
    const cleanedWebhook = webhookUrl.trim() || DEFAULT_INBOUND_N8N_WEBHOOK;
    setN8nInboundWebhook(cleanedWebhook);

    updateClinic({
      n8nWebhookMegaapiInbound: cleanedWebhook,
      automationTriggers,
    });

    await StorageService.saveClinicToCloud({
      n8nWebhookMegaapiInbound: cleanedWebhook,
      automationTriggers,
    });
  };

  const handleOpenTemplateInEditor = (templateId: string) => {
    const target = templates.find((t) => t.id === templateId);
    if (target) {
      selectTemplateForEditing(target);
    }
    setActiveTab('templates');
  };

  const effectiveMessageText = customText.trim()
    ? customText
    : generatePreview(selectedTemplate?.content || '');

  const handleSimulateTestDispatch = async () => {
    if (!selectedPatient) return;
    setIsSending(true);
    setDispatchFeedback(null);

    const recipientPhone = selectedPatient.whatsapp || selectedPatient.phone;
    const simResult = await simulateWhatsAppMessage(recipientPhone, effectiveMessageText, {
      organizationId: organization.id || clinic.organizationId,
      branchId: selectedPatient.originBranchId,
      patientId: selectedPatient.id,
      patientName: selectedPatient.fullName,
    });

    setMessages(StorageService.getMessages());
    setIsSending(false);

    if (!simResult.success) {
      setDispatchFeedback({
        type: 'error',
        text: simResult.error || 'Erro ao executar envio de teste.',
      });
      return;
    }

    setCustomText('');
    setDispatchFeedback({
      type: 'success',
      text: `Envio de teste (simulação) concluído para ${selectedPatient.fullName} (${simResult.cleanPhone}) e registrado ${simResult.syncedSupabase ? 'na nuvem' : 'no histórico local'}!`,
    });
  };

  const handleSendRealMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPatient) return;

    if (isSimulationMode) {
      await handleSimulateTestDispatch();
      return;
    }

    const creds = resolveMegaapiCredentials({
      megaapiInstanceUrl,
      megaapiInstanceKey,
      megaapiToken,
    });

    if (!creds.isConfigured || !creds.hasInstanceKey) {
      setDispatchFeedback({
        type: 'error',
        text: 'Configure a URL (Host), a Instance Key e o Token na aba "Configuração Megaapi" ou ative o Modo de Simulação / Teste.',
        canSimulateFallback: true,
      });
      return;
    }

    setIsSending(true);
    setDispatchFeedback(null);

    const recipientPhone = selectedPatient.whatsapp || selectedPatient.phone;
    const result = await sendWhatsAppMessage(
      recipientPhone,
      effectiveMessageText,
      {
        megaapiInstanceUrl,
        megaapiInstanceKey,
        megaapiToken,
      },
      {
        organizationId: organization.id || clinic.organizationId,
        branchId: selectedPatient.originBranchId,
        patientId: selectedPatient.id,
        patientName: selectedPatient.fullName,
        recordAttemptOnFailure: false,
      }
    );

    setMessages(StorageService.getMessages());
    setIsSending(false);

    if (!result.success) {
      setDispatchFeedback({
        type: 'error',
        text: result.error || 'Não foi possível enviar a mensagem pela instância Megaapi.',
        canSimulateFallback: Boolean(result.isCorsError || result.isNotFoundError),
      });
      return;
    }

    setCustomText('');
    setDispatchFeedback({
      type: 'success',
      text: `Mensagem enviada via Megaapi para ${selectedPatient.fullName} (${result.cleanPhone}) e registrada ${result.syncedSupabase ? 'na nuvem' : 'no histórico'}!`,
    });
  };

  const handleSaveMegaapiConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingConfig(true);
    setConfigFeedback(null);

    const trimmedUrl = normalizeMegaapiBaseUrl(megaapiInstanceUrl);
    const trimmedKey = megaapiInstanceKey.trim();
    const trimmedToken = megaapiToken.trim();
    setMegaapiInstanceUrl(trimmedUrl);
    setMegaapiInstanceKey(trimmedKey);

    updateClinic({
      megaapiInstanceUrl: trimmedUrl,
      megaapiInstanceKey: trimmedKey,
      megaapiToken: trimmedToken,
    });

    const saveRes = await StorageService.saveClinicToCloud({
      megaapiInstanceUrl: trimmedUrl,
      megaapiInstanceKey: trimmedKey,
      megaapiToken: trimmedToken,
    });

    setIsSavingConfig(false);

    if (saveRes.error) {
      setConfigFeedback({
        type: 'success',
        text: 'Credenciais salvas no navegador. Caso o banco remoto ainda não possua as colunas da integração, execute a migração SQL mais recente.',
      });
    } else {
      setConfigFeedback({
        type: 'success',
        text: 'Credenciais Megaapi (Host, Instance Key e Token) salvas e sincronizadas com sucesso!',
      });
    }

    if (trimmedUrl && trimmedKey && trimmedToken) {
      await handleCheckConnection(trimmedUrl, trimmedToken, trimmedKey);
    } else {
      setConnectionStatus({
        connected: false,
        status: 'UNCONFIGURED',
        message: 'Informe a URL (Host), a Instance Key e o Token para ativar o envio.',
      });
    }
  };

  const renderStatusBadge = () => {
    if (connectionStatus.status === 'CONNECTED') {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
          <Wifi className="w-3.5 h-3.5 text-emerald-600" />
          <span>
            CONNECTED
            {connectionStatus.phoneNumber ? ` • ${connectionStatus.phoneNumber}` : ''}
          </span>
        </span>
      );
    }
    if (connectionStatus.status === 'QRCODE_REQUIRED') {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-800 bg-amber-50 px-2.5 py-0.5 rounded-full border border-amber-200">
          <QrCode className="w-3.5 h-3.5" />
          <span>Aguardando QR Code</span>
        </span>
      );
    }
    if (connectionStatus.status === 'UNCONFIGURED') {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 bg-slate-100 px-2.5 py-0.5 rounded-full border border-slate-200">
          <Settings className="w-3.5 h-3.5" />
          <span>Megaapi Não Configurado</span>
        </span>
      );
    }
    if (connectionStatus.status === 'CORS_BLOCKED' || connectionStatus.status === 'NOT_FOUND') {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-800 bg-amber-50 px-2.5 py-0.5 rounded-full border border-amber-200">
          <AlertCircle className="w-3.5 h-3.5" />
          <span>
            {connectionStatus.status === 'NOT_FOUND'
              ? 'Rota Megaapi 404'
              : 'Bloqueio CORS (Browser)'}
          </span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-700 bg-rose-50 px-2.5 py-0.5 rounded-full border border-rose-200">
        <WifiOff className="w-3.5 h-3.5" />
        <span>Instância Desconectada</span>
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
              Central de Comunicação & WhatsApp
            </h1>
            {renderStatusBadge()}
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Envio real via Megaapi, lembretes automáticos, confirmação de consultas e histórico auditado de conversas.
          </p>
        </div>

        {/* Tab Controls */}
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-xl">
          <button
            type="button"
            onClick={() => setActiveTab('messages')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
              activeTab === 'messages'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Histórico de Conversas
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('templates')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
              activeTab === 'templates'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Modelos de Mensagens
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('automations')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
              activeTab === 'automations'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Automações WhatsApp
          </button>
          {canConfigureMegaapi && (
            <button
              type="button"
              onClick={() => setActiveTab('config')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition inline-flex items-center gap-1 ${
                activeTab === 'config'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Settings className="w-3.5 h-3.5" />
              <span>Configuração Megaapi</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Layout */}
      {activeTab === 'automations' ? (
        <WhatsAppAutomationManager
          clinic={clinic}
          organization={organization}
          branches={branches}
          templates={templates}
          connectionStatus={connectionStatus}
          n8nInboundWebhook={n8nInboundWebhook}
          onSaveInboundWebhook={handleSaveInboundWebhook}
          renderPreview={generatePreview}
          onOpenTemplateEditor={handleOpenTemplateInEditor}
          onOpenMegaapiConfig={() => setActiveTab('config')}
        />
      ) : (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: WhatsApp Dispatcher */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-emerald-600" />
              <h3 className="text-xs font-bold text-slate-900">Disparo WhatsApp (Megaapi)</h3>
            </div>
            <button
              type="button"
              onClick={() => void handleCheckConnection()}
              disabled={isCheckingStatus}
              className="text-[10px] font-semibold text-sky-700 hover:text-sky-900 inline-flex items-center gap-1"
              title="Verificar status da instância"
            >
              <RefreshCw className={`w-3 h-3 ${isCheckingStatus ? 'animate-spin' : ''}`} />
              <span>{connectionStatus.connected ? 'Conectado' : 'Verificar'}</span>
            </button>
          </div>

          {dispatchFeedback && (
            <div
              className={`p-3 rounded-xl border text-[11px] space-y-2 ${
                dispatchFeedback.type === 'success'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-rose-50 border-rose-200 text-rose-800'
              }`}
            >
              <div className="flex items-start gap-2">
                {dispatchFeedback.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                )}
                <span>{dispatchFeedback.text}</span>
              </div>

              {dispatchFeedback.canSimulateFallback && (
                <button
                  type="button"
                  onClick={() => void handleSimulateTestDispatch()}
                  disabled={isSending}
                  className="w-full py-1.5 px-3 text-[11px] font-bold text-amber-900 bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded-lg transition inline-flex items-center justify-center gap-1.5"
                >
                  <FlaskConical className="w-3.5 h-3.5" />
                  <span>Simular Envio e Registrar no Histórico</span>
                </button>
              )}
            </div>
          )}

          <form onSubmit={handleSendRealMessage} className="space-y-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                Destinatário (Paciente)
              </label>
              <select
                value={selectedPatientId}
                onChange={(e) => setSelectedPatientId(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-slate-50 focus:ring-2 focus:ring-emerald-500"
              >
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.fullName} ({p.whatsapp || p.phone})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                Modelo de Mensagem
              </label>
              <select
                value={selectedTemplateId}
                onChange={(e) => setSelectedTemplateId(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-slate-50 focus:ring-2 focus:ring-emerald-500"
              >
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                Mensagem Personalizada (opcional)
              </label>
              <textarea
                rows={3}
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
                placeholder="Deixe em branco para usar o modelo selecionado ou digite uma mensagem livre..."
                className="w-full px-2.5 py-2 text-xs border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-emerald-500 leading-relaxed"
              />
            </div>

            {/* WhatsApp Bubble Preview */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                Pré-visualização do Envio
              </label>
              <div className="bg-[#EFEAE2] p-3.5 rounded-xl border border-slate-300 relative overflow-hidden text-xs">
                <div className="bg-white rounded-lg p-3 shadow-xs max-w-xs ml-auto rounded-tr-none text-slate-800 leading-relaxed whitespace-pre-line text-[11px] border border-[#d1d7db]">
                  <p>{effectiveMessageText}</p>
                  <div className="mt-1 flex items-center justify-end gap-1 text-[9px] text-slate-400">
                    <span>
                      {new Date().toLocaleTimeString('pt-BR', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    <CheckCheck className="w-3 h-3 text-sky-500" />
                  </div>
                </div>
              </div>
            </div>

            {/* Simulation Mode Toggle */}
            <label className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-amber-50/70 border border-amber-200 text-[11px] cursor-pointer">
              <div className="flex items-center gap-2">
                <FlaskConical className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                <div>
                  <span className="font-bold text-amber-950 block">Modo Simulação / Teste</span>
                  <span className="text-[10px] text-amber-800">
                    Registra o disparo no histórico sem envio externo real
                  </span>
                </div>
              </div>
              <input
                type="checkbox"
                checked={isSimulationMode}
                onChange={(e) => setIsSimulationMode(e.target.checked)}
                className="w-4 h-4 text-amber-600 rounded"
              />
            </label>

            {canDispatchWhatsapp ? (
              <div className="flex flex-col gap-2">
                <button
                  type="submit"
                  disabled={isSending || !selectedPatient}
                  className={`w-full py-2.5 px-4 text-xs font-semibold text-white disabled:opacity-60 rounded-xl shadow-xs transition flex items-center justify-center gap-2 ${
                    isSimulationMode
                      ? 'bg-amber-600 hover:bg-amber-700'
                      : 'bg-emerald-600 hover:bg-emerald-700'
                  }`}
                >
                  {isSending ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : isSimulationMode ? (
                    <FlaskConical className="w-3.5 h-3.5" />
                  ) : (
                    <Send className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {isSending
                      ? 'Processando...'
                      : isSimulationMode
                        ? 'Disparar Teste (Registrar no Histórico)'
                        : 'Enviar Mensagem Agora'}
                  </span>
                </button>

                {!isSimulationMode && (
                  <button
                    type="button"
                    onClick={() => void handleSimulateTestDispatch()}
                    disabled={isSending || !selectedPatient}
                    className="w-full py-2 px-3 text-[11px] font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-60 rounded-xl transition inline-flex items-center justify-center gap-1.5"
                  >
                    <FlaskConical className="w-3.5 h-3.5 text-amber-600" />
                    <span>Disparar Mensagem de Teste (Simulação)</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-600 text-center">
                Seu perfil possui acesso somente leitura para envios na Central de WhatsApp.
              </div>
            )}
          </form>
        </div>

        {/* Right Columns: Tab Content */}
        <div className="lg:col-span-2 space-y-4">
          {/* TAB 1: Messages History */}
          {activeTab === 'messages' && (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
              <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-sky-600" />
                  <h3 className="text-sm font-bold text-slate-900">
                    Histórico de Disparos e Mensagens
                  </h3>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-400">
                    {messages.length} mensagens registradas
                  </span>
                  <button
                    type="button"
                    onClick={() => void loadMessagesAndClinic()}
                    disabled={isRefreshingMessages}
                    className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition"
                    title="Atualizar histórico"
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 ${isRefreshingMessages ? 'animate-spin' : ''}`}
                    />
                  </button>
                </div>
              </div>

              <div className="divide-y divide-slate-100 max-h-[620px] overflow-y-auto">
                {messages.length === 0 ? (
                  <div className="p-12 text-center text-xs text-slate-400">
                    Nenhuma mensagem registrada na central.
                  </div>
                ) : (
                  messages.map((msg) => (
                    <div
                      key={msg.id}
                      className="p-4 hover:bg-slate-50/60 transition flex items-start justify-between gap-4 text-xs"
                    >
                      <div className="space-y-1.5 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-bold text-slate-900">{msg.patientName}</span>
                          <span className="text-[11px] text-slate-400 font-mono">
                            ({msg.recipientPhone})
                          </span>
                          <span
                            className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
                              msg.direction === 'inbound'
                                ? 'bg-purple-50 text-purple-700 border border-purple-200'
                                : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            }`}
                          >
                            {msg.direction === 'inbound'
                              ? 'Recebida (Paciente)'
                              : 'Enviada (Clínica)'}
                          </span>
                        </div>
                        <p className="text-slate-700 whitespace-pre-line bg-slate-50 p-2.5 rounded-lg border border-slate-100 text-[11px] leading-relaxed">
                          {msg.content}
                        </p>
                      </div>

                      <div className="text-right shrink-0 space-y-1">
                        <span className="text-[10px] text-slate-400 block tabular-nums">
                          {new Date(msg.sentAt).toLocaleDateString('pt-BR')}{' '}
                          {new Date(msg.sentAt).toLocaleTimeString('pt-BR', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                        {msg.status === 'failed' ? (
                          <div className="flex items-center justify-end gap-1 text-[11px] text-rose-600 font-medium">
                            <AlertCircle className="w-3.5 h-3.5" />
                            <span>Falhou</span>
                          </div>
                        ) : (
                          <div className="flex items-center justify-end gap-1 text-[11px] text-emerald-600 font-medium">
                            <CheckCheck className="w-3.5 h-3.5" />
                            <span>
                              {msg.status === 'read'
                                ? 'Lido'
                                : msg.status === 'sent'
                                  ? 'Enviado'
                                  : 'Entregue'}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* TAB 2: Rich Visual Message Templates Editor */}
          {activeTab === 'templates' && (
            <div className="space-y-4">
              <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                        <FileEdit className="w-4 h-4 text-sky-600" />
                        <span>Editor Visual de Modelos de Mensagens</span>
                      </h3>
                      <span
                        className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                          templatesSyncSource === 'cloud'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-amber-50 text-amber-800 border border-amber-200'
                        }`}
                      >
                        {templatesSyncSource === 'cloud'
                          ? 'Sincronizado na Nuvem'
                          : 'Cache Local'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Personalize mensagens com variáveis dinâmicas, quebras de linha e emojis sincronizados na nuvem.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => void loadMessagesAndClinic()}
                      disabled={isRefreshingMessages}
                      className="px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition inline-flex items-center gap-1.5"
                      title="Recarregar modelos do banco de dados"
                    >
                      <RefreshCw
                        className={`w-3.5 h-3.5 ${isRefreshingMessages ? 'animate-spin' : ''}`}
                      />
                      <span>Recarregar</span>
                    </button>
                    {canEditCommunication && (
                      <button
                        type="button"
                        onClick={handleCreateNewTemplate}
                        className="px-3.5 py-2 text-xs font-semibold text-sky-700 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-xl transition inline-flex items-center gap-1.5"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Novo Modelo</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Template Selector Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {templates.map((tpl) => {
                    const isSelected = tpl.id === editingTemplateId;
                    return (
                      <button
                        key={tpl.id}
                        type="button"
                        onClick={() => selectTemplateForEditing(tpl)}
                        className={`text-left p-3.5 rounded-xl border transition space-y-1.5 ${
                          isSelected
                            ? 'bg-sky-50/70 border-sky-400 ring-2 ring-sky-100'
                            : 'bg-slate-50/60 border-slate-200 hover:border-slate-300 hover:bg-white'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-bold text-slate-900 truncate">
                            {tpl.name}
                          </span>
                          <span
                            className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${
                              tpl.isActive
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : 'bg-slate-200 text-slate-600'
                            }`}
                          >
                            {tpl.isActive ? 'Ativo' : 'Pausado'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-[10px] text-slate-500">
                          <span>{CATEGORY_LABELS[tpl.category] || tpl.category}</span>
                          <span className="font-mono">
                            {tpl.updatedAt
                              ? `Atualizado ${new Date(tpl.updatedAt).toLocaleDateString('pt-BR')}`
                              : tpl.channel.toUpperCase()}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {templateFeedback && (
                  <div
                    className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
                      templateFeedback.type === 'success'
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                        : 'bg-rose-50 border-rose-200 text-rose-800'
                    }`}
                  >
                    {templateFeedback.type === 'success' ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                    )}
                    <span>{templateFeedback.text}</span>
                  </div>
                )}

                {/* Editor + Real-time WhatsApp Preview */}
                <form onSubmit={handleSaveTemplate} className="grid grid-cols-1 xl:grid-cols-12 gap-5 pt-1">
                  <div className="xl:col-span-7 space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                          Nome do Modelo
                        </label>
                        <input
                          type="text"
                          required
                          value={tplName}
                          onChange={(e) => setTplName(e.target.value)}
                          placeholder="Ex: Confirmação de Agendamento 48h"
                          className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                          Categoria do Gatilho
                        </label>
                        <select
                          value={tplCategory}
                          onChange={(e) =>
                            setTplCategory(e.target.value as MessageTemplate['category'])
                          }
                          className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                        >
                          <option value="confirmation_48h">Confirmação 48h Antes</option>
                          <option value="reminder_24h">Lembrete de Véspera (24h)</option>
                          <option value="day_reminder">Lembrete no Dia</option>
                          <option value="confirmation_reply">
                            Resposta Automática de Confirmação
                          </option>
                          <option value="post_care">Pós-Atendimento</option>
                          <option value="birthday">Aniversário</option>
                          <option value="custom">Personalizado</option>
                        </select>
                      </div>
                    </div>

                    {/* Dynamic Variables Bar */}
                    <div className="p-3 bg-sky-50/80 rounded-xl border border-sky-200 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-sky-900 flex items-center gap-1.5">
                          <Sparkles className="w-3.5 h-3.5 text-sky-600" />
                          <span>Variáveis Dinâmicas (clique para inserir no cursor)</span>
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {TEMPLATE_VARIABLES.map((v) => (
                          <button
                            key={v.tag}
                            type="button"
                            onClick={() => handleInsertSnippetAtCursor(v.tag)}
                            className="px-2 py-1 text-[11px] font-mono bg-white hover:bg-sky-600 hover:text-white text-sky-800 border border-sky-300 rounded-lg transition shadow-2xs"
                            title={`Inserir ${v.tag} (${v.label})`}
                          >
                            + {v.tag}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Emoji Quick Toolbar */}
                    <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200 flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] font-semibold text-slate-600 inline-flex items-center gap-1 mr-1">
                        <Smile className="w-3.5 h-3.5 text-amber-500" />
                        <span>Emojis:</span>
                      </span>
                      {WHATSAPP_EMOJIS.map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => handleInsertSnippetAtCursor(emoji)}
                          className="w-7 h-7 flex items-center justify-center rounded-lg bg-white hover:bg-slate-200 border border-slate-200 text-sm transition"
                          title={`Inserir ${emoji}`}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-[11px] font-semibold text-slate-700">
                          Corpo da Mensagem (suporta *negrito*, quebras de linha e emojis)
                        </label>
                        <span className="text-[10px] text-slate-400">
                          {tplContent.length} caracteres
                        </span>
                      </div>
                      <textarea
                        ref={templateTextareaRef}
                        rows={8}
                        required
                        value={tplContent}
                        onChange={(e) => setTplContent(e.target.value)}
                        placeholder="Digite a mensagem com variáveis {{nome_paciente}} e emojis..."
                        className="w-full px-3 py-2.5 text-xs border border-slate-300 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-sky-500 leading-relaxed font-sans"
                      />
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                      <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={tplIsActive}
                          onChange={(e) => setTplIsActive(e.target.checked)}
                          className="w-4 h-4 text-sky-600 rounded"
                        />
                        <span>Modelo ativo para disparos automáticos</span>
                      </label>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedTemplateId(editingTemplateId);
                            setCustomText(tplContent ? generatePreview(tplContent) : '');
                          }}
                          className="px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition"
                        >
                          Usar no Disparador
                        </button>
                        {canEditCommunication && (
                          <button
                            type="submit"
                            disabled={isSavingTemplate}
                            className="px-4 py-2 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-60 rounded-xl shadow-xs transition inline-flex items-center gap-1.5"
                          >
                            {isSavingTemplate ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Save className="w-3.5 h-3.5" />
                            )}
                            <span>{isSavingTemplate ? 'Salvando...' : 'Salvar Modelo'}</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Live WhatsApp Chat Window Preview */}
                  <div className="xl:col-span-5 flex flex-col">
                    <span className="text-[11px] font-semibold text-slate-700 mb-1.5 block">
                      Preview em Tempo Real (WhatsApp)
                    </span>
                    <div className="rounded-2xl overflow-hidden border border-slate-300 shadow-xs flex-1 flex flex-col min-h-[340px] bg-[#EFEAE2]">
                      {/* WhatsApp Chat Header */}
                      <div className="bg-[#075E54] text-white px-3.5 py-2.5 flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-emerald-500/30 border border-white/30 flex items-center justify-center text-xs font-bold shrink-0">
                          {clinic.tradeName.substring(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-bold truncate">
                            {clinic.tradeName.split('-')[0].trim()}
                          </p>
                          <p className="text-[10px] text-emerald-100 truncate">
                            WhatsApp Business • online
                          </p>
                        </div>
                      </div>

                      {/* Chat Body */}
                      <div className="p-4 flex-1 flex flex-col justify-end space-y-2">
                        <div className="mx-auto px-2.5 py-0.5 rounded-full bg-white/80 text-[10px] text-slate-500 font-medium shadow-2xs">
                          Hoje
                        </div>

                        <div className="bg-[#D9FDD3] text-slate-800 rounded-xl rounded-tr-none p-3 shadow-xs max-w-[92%] ml-auto text-[11px] leading-relaxed border border-[#c6ecc0]">
                          <div className="break-words">
                            {renderFormattedWhatsAppText(generatePreview(tplContent))}
                          </div>
                          <div className="mt-1.5 flex items-center justify-end gap-1 text-[9px] text-slate-500">
                            <span>
                              {new Date().toLocaleTimeString('pt-BR', {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                            <CheckCheck className="w-3 h-3 text-sky-500" />
                          </div>
                        </div>

                        {tplCategory === 'confirmation_48h' && (
                          <div className="bg-white text-slate-800 rounded-xl rounded-tl-none px-3 py-2 shadow-xs max-w-[75%] mr-auto text-[11px] border border-slate-200">
                            <span>1</span>
                            <span className="block text-[9px] text-slate-400 text-right mt-0.5">
                              Paciente (resposta exemplo)
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* TAB 4: Megaapi Credentials & Connection Status */}
          {activeTab === 'config' && canConfigureMegaapi && (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6 space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Integração WhatsApp Business (Megaapi)
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Configure a instância dedicada da clínica {clinic.tradeName} para disparos reais de confirmações e lembretes.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleCheckConnection()}
                  disabled={isCheckingStatus}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition inline-flex items-center gap-1.5 shrink-0"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isCheckingStatus ? 'animate-spin' : ''}`} />
                  <span>{isCheckingStatus ? 'Verificando...' : 'Verificar Conexão'}</span>
                </button>
              </div>

              {/* Connection Status Box */}
              <div
                className={`p-4 rounded-xl border text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                  connectionStatus.connected
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : connectionStatus.status === 'QRCODE_REQUIRED' ||
                        connectionStatus.status === 'NOT_FOUND' ||
                        connectionStatus.status === 'CORS_BLOCKED'
                      ? 'bg-amber-50 border-amber-200 text-amber-900'
                      : connectionStatus.status === 'UNCONFIGURED'
                        ? 'bg-slate-50 border-slate-200 text-slate-700'
                        : 'bg-rose-50 border-rose-200 text-rose-900'
                }`}
              >
                <div className="space-y-1.5">
                  <div className="font-bold flex flex-wrap items-center gap-2">
                    {connectionStatus.connected ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    ) : connectionStatus.status === 'QRCODE_REQUIRED' ? (
                      <QrCode className="w-4 h-4 text-amber-600" />
                    ) : (
                      <AlertCircle className="w-4 h-4" />
                    )}
                    <span>Status da Instância:</span>
                    <span
                      className={`px-2 py-0.5 rounded text-[11px] font-extrabold tracking-wide ${
                        connectionStatus.connected
                          ? 'bg-emerald-600 text-white'
                          : connectionStatus.status === 'UNCONFIGURED'
                            ? 'bg-slate-200 text-slate-700'
                            : 'bg-white/80 border border-current'
                      }`}
                    >
                      {connectionStatus.status}
                    </span>
                  </div>
                  <p className="text-[11px] leading-relaxed">{connectionStatus.message}</p>
                  {connectionStatus.phoneNumber && (
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-emerald-200 text-emerald-800 text-[11px] font-semibold">
                      <Smartphone className="w-3.5 h-3.5 text-emerald-600" />
                      <span>WhatsApp conectado:</span>
                      <span className="font-mono font-bold">{connectionStatus.phoneNumber}</span>
                    </div>
                  )}
                  {connectionStatus.testedEndpoint && (
                    <p className="text-[10px] font-mono opacity-80 break-all">
                      Endpoint verificado: {connectionStatus.testedEndpoint}
                    </p>
                  )}
                  {(connectionStatus.status === 'NOT_FOUND' ||
                    connectionStatus.status === 'CORS_BLOCKED') && (
                    <div className="pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          setIsSimulationMode(true);
                          void handleSimulateTestDispatch();
                        }}
                        disabled={isSending || !selectedPatient}
                        className="px-3 py-1.5 text-[11px] font-bold text-amber-950 bg-amber-200/80 hover:bg-amber-200 rounded-lg transition inline-flex items-center gap-1.5"
                      >
                        <FlaskConical className="w-3.5 h-3.5" />
                        <span>Ativar Simulação e Disparar Teste Agora</span>
                      </button>
                    </div>
                  )}
                </div>

                {connectionStatus.qrCode && (
                  <div className="bg-white p-2 rounded-xl border border-amber-200 shrink-0 self-start">
                    <img
                      src={
                        connectionStatus.qrCode.startsWith('data:')
                          ? connectionStatus.qrCode
                          : `data:image/png;base64,${connectionStatus.qrCode}`
                      }
                      alt="QR Code WhatsApp"
                      className="w-28 h-28 object-contain"
                    />
                  </div>
                )}
              </div>

              {configFeedback && (
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>{configFeedback.text}</span>
                </div>
              )}

              <form onSubmit={handleSaveMegaapiConfig} className="space-y-4 text-xs">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1 flex items-center gap-1.5">
                    <Link2 className="w-3.5 h-3.5 text-sky-600" />
                    <span>Host / URL da API Megaapi (megaapi_instance_url)</span>
                  </label>
                  <input
                    type="url"
                    required
                    value={megaapiInstanceUrl}
                    onChange={(e) => setMegaapiInstanceUrl(e.target.value)}
                    placeholder="https://apibusiness1.megaapi.com.br"
                    className="w-full px-3 py-2.5 font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                  <span className="text-[11px] text-slate-500 mt-1 block">
                    Informe o host do servidor Megaapi (ex: <code className="font-mono">https://apibusiness1.megaapi.com.br</code>). Ele será combinado automaticamente com a Instance Key.
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1 flex items-center gap-1.5">
                      <Hash className="w-3.5 h-3.5 text-sky-600" />
                      <span>Instance Key (megaapi_instance_key)</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={megaapiInstanceKey}
                      onChange={(e) => setMegaapiInstanceKey(e.target.value)}
                      placeholder="megabusiness-MH7CY257SQCAASLHMW73HB9GZ64"
                      className="w-full px-3 py-2.5 font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 mb-1 flex items-center gap-1.5">
                      <KeyRound className="w-3.5 h-3.5 text-sky-600" />
                      <span>Token de Acesso Megaapi (megaapi_token)</span>
                    </label>
                    <input
                      type="password"
                      required
                      value={megaapiToken}
                      onChange={(e) => setMegaapiToken(e.target.value)}
                      placeholder="Seu token Bearer da instância Megaapi"
                      className="w-full px-3 py-2.5 font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    type="submit"
                    disabled={isSavingConfig}
                    className="px-5 py-2.5 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-60 rounded-xl shadow-xs transition inline-flex items-center gap-2"
                  >
                    {isSavingConfig ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Save className="w-4 h-4" />
                    )}
                    <span>{isSavingConfig ? 'Salvando...' : 'Salvar Credenciais Megaapi'}</span>
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>
      )}
    </div>
  );
};
