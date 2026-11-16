import React, { useState, useEffect, useCallback } from 'react';
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
} from 'lucide-react';
import { MessageTemplate, MessageLog } from '../../types';
import { StorageService } from '../../services/storage';
import { useTenant } from '../../contexts/TenantContext';
import {
  sendWhatsAppMessage,
  checkMegaapiConnectionStatus,
  resolveMegaapiCredentials,
  MegaapiConnectionResult,
} from '../../services/megaApiService';

export const CommunicationModule: React.FC = () => {
  const { activeBranchId, branches, clinic, organization, updateClinic } = useTenant();
  const [messages, setMessages] = useState<MessageLog[]>(() => StorageService.getMessages());
  const [templates] = useState<MessageTemplate[]>(() => StorageService.getTemplates());
  const patients = StorageService.getPatients(activeBranchId);
  const professionals = StorageService.getProfessionals();

  // Dispatcher State
  const [selectedPatientId, setSelectedPatientId] = useState(patients[0]?.id || '');
  const [selectedTemplateId, setSelectedTemplateId] = useState(templates[0]?.id || '');
  const [customText, setCustomText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [dispatchFeedback, setDispatchFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Megaapi Settings & Status State
  const [megaapiInstanceUrl, setMegaapiInstanceUrl] = useState(clinic.megaapiInstanceUrl || '');
  const [megaapiToken, setMegaapiToken] = useState(clinic.megaapiToken || '');
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [configFeedback, setConfigFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<MegaapiConnectionResult>(() => {
    const creds = resolveMegaapiCredentials(clinic);
    return creds.isConfigured
      ? {
          connected: false,
          status: 'DISCONNECTED',
          message: 'Clique em "Verificar Conexão" para consultar a instância.',
        }
      : {
          connected: false,
          status: 'UNCONFIGURED',
          message: 'Configure a URL da instância e o Token na aba Configuração WhatsApp.',
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

  const loadMessagesAndClinic = useCallback(async () => {
    setIsRefreshingMessages(true);
    const [{ clinic: cloudClinic }, cloudMessages] = await Promise.all([
      StorageService.fetchClinicFromCloud({
        clinicId: clinic.id,
        organizationId: organization.id,
        slug: organization.slug,
      }),
      StorageService.fetchMessagesFromCloud(),
    ]);

    setMessages(cloudMessages);
    if (cloudClinic.megaapiInstanceUrl !== undefined) {
      setMegaapiInstanceUrl(cloudClinic.megaapiInstanceUrl || '');
    }
    if (cloudClinic.megaapiToken !== undefined) {
      setMegaapiToken(cloudClinic.megaapiToken || '');
    }
    setIsRefreshingMessages(false);

    const creds = resolveMegaapiCredentials(cloudClinic);
    if (creds.isConfigured) {
      const statusRes = await checkMegaapiConnectionStatus(cloudClinic);
      setConnectionStatus(statusRes);
    }
  }, [clinic.id, organization.id, organization.slug]);

  useEffect(() => {
    void loadMessagesAndClinic();
  }, [loadMessagesAndClinic]);

  const handleCheckConnection = async (customUrl?: string, customTok?: string) => {
    setIsCheckingStatus(true);
    const result = await checkMegaapiConnectionStatus({
      megaapiInstanceUrl: customUrl !== undefined ? customUrl : megaapiInstanceUrl,
      megaapiToken: customTok !== undefined ? customTok : megaapiToken,
    });
    setConnectionStatus(result);
    setIsCheckingStatus(false);
  };

  // Compute preview with dynamic variables
  const generatePreview = (templateContent: string) => {
    if (!selectedPatient) return templateContent;
    let text = templateContent;
    text = text.replace(/{{nome_paciente}}/g, selectedPatient.fullName);
    text = text.replace(/{{nome_clinica}}/g, clinic.tradeName.split('-')[0].trim());
    text = text.replace(/{{nome_profissional}}/g, professionals[0]?.fullName || 'Dr. Newton Mureb');
    text = text.replace(/{{data_consulta}}/g, new Date().toLocaleDateString('pt-BR'));
    text = text.replace(/{{horario_consulta}}/g, '14:30');
    text = text.replace(
      /{{endereco_filial}}/g,
      `${activeBranch?.street || ''}, ${activeBranch?.number || ''} - ${activeBranch?.neighborhood || ''}`
    );
    return text;
  };

  const effectiveMessageText = customText.trim()
    ? customText
    : generatePreview(selectedTemplate?.content || '');

  const handleSendRealMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPatient) return;

    const creds = resolveMegaapiCredentials({
      megaapiInstanceUrl,
      megaapiToken,
    });

    if (!creds.isConfigured) {
      setDispatchFeedback({
        type: 'error',
        text: 'Configure a URL da instância Megaapi e o Token na aba "Configuração Megaapi" antes de disparar mensagens reais.',
      });
      setActiveTab('config');
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
        megaapiToken,
      },
      {
        organizationId: organization.id || clinic.organizationId,
        branchId: selectedPatient.originBranchId,
        patientId: selectedPatient.id,
        patientName: selectedPatient.fullName,
        recordAttemptOnFailure: true,
      }
    );

    setMessages(StorageService.getMessages());
    setIsSending(false);

    if (!result.success) {
      setDispatchFeedback({
        type: 'error',
        text: result.error || 'Não foi possível enviar a mensagem pela instância Megaapi.',
      });
      return;
    }

    setCustomText('');
    setDispatchFeedback({
      type: 'success',
      text: `Mensagem enviada via Megaapi para ${selectedPatient.fullName} (${result.cleanPhone}) e registrada no histórico!`,
    });
  };

  const handleSaveMegaapiConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingConfig(true);
    setConfigFeedback(null);

    const trimmedUrl = megaapiInstanceUrl.trim();
    const trimmedToken = megaapiToken.trim();

    updateClinic({
      megaapiInstanceUrl: trimmedUrl,
      megaapiToken: trimmedToken,
    });

    const saveRes = await StorageService.saveClinicToCloud({
      megaapiInstanceUrl: trimmedUrl,
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
        text: 'Credenciais Megaapi salvas e sincronizadas com sucesso!',
      });
    }

    if (trimmedUrl && trimmedToken) {
      await handleCheckConnection(trimmedUrl, trimmedToken);
    } else {
      setConnectionStatus({
        connected: false,
        status: 'UNCONFIGURED',
        message: 'Informe a URL da instância e o Token para ativar o envio.',
      });
    }
  };

  const renderStatusBadge = () => {
    if (connectionStatus.status === 'CONNECTED') {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
          <Wifi className="w-3.5 h-3.5" />
          <span>Megaapi Conectado</span>
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
            Gatilhos Automáticos
          </button>
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
        </div>
      </div>

      {/* Main Grid: Dispatcher & Tab Content */}
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
              className={`p-3 rounded-xl border text-[11px] flex items-start gap-2 ${
                dispatchFeedback.type === 'success'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-rose-50 border-rose-200 text-rose-800'
              }`}
            >
              {dispatchFeedback.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              )}
              <span>{dispatchFeedback.text}</span>
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

            <button
              type="submit"
              disabled={isSending || !selectedPatient}
              className="w-full py-2.5 px-4 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 rounded-xl shadow-xs transition flex items-center justify-center gap-2"
            >
              {isSending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
              <span>{isSending ? 'Enviando via Megaapi...' : 'Enviar Mensagem Agora'}</span>
            </button>
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

          {/* TAB 2: Templates List */}
          {activeTab === 'templates' && (
            <div className="space-y-4">
              <div className="p-4 bg-sky-50 rounded-xl border border-sky-200 text-xs text-sky-800 space-y-1">
                <span className="font-bold block">Variáveis Dinâmicas Disponíveis:</span>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {[
                    '{{nome_paciente}}',
                    '{{nome_clinica}}',
                    '{{nome_profissional}}',
                    '{{data_consulta}}',
                    '{{horario_consulta}}',
                    '{{endereco_filial}}',
                  ].map((v) => (
                    <code
                      key={v}
                      className="bg-white text-sky-800 px-2 py-0.5 rounded font-mono text-[10px] border border-sky-300"
                    >
                      {v}
                    </code>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4">
                {templates.map((tpl) => (
                  <div
                    key={tpl.id}
                    className="p-5 bg-white rounded-2xl border border-slate-200 shadow-xs space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold text-slate-900">{tpl.name}</h4>
                      <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                        Canal: {tpl.channel}
                      </span>
                    </div>
                    <pre className="text-xs text-slate-700 bg-slate-50 p-3 rounded-xl border border-slate-200 whitespace-pre-line font-sans leading-relaxed">
                      {tpl.content}
                    </pre>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 3: Automations Settings */}
          {activeTab === 'automations' && (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6 space-y-5">
              <h3 className="text-sm font-bold text-slate-900">
                Configuração de Disparos Automáticos
              </h3>

              <div className="space-y-4 text-xs">
                <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between">
                  <div>
                    <strong className="block text-slate-900">
                      Confirmação Imediata de Agendamento
                    </strong>
                    <span className="text-slate-500 text-[11px]">
                      Dispara automaticamente mensagem de confirmação via Megaapi ao criar um novo agendamento.
                    </span>
                  </div>
                  <input type="checkbox" defaultChecked className="w-4 h-4 text-sky-600 rounded" />
                </div>

                <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between">
                  <div>
                    <strong className="block text-slate-900">
                      Lembrete & Confirmação com 48 Horas de Antecedência
                    </strong>
                    <span className="text-slate-500 text-[11px]">
                      Disparado 2 dias antes para confirmar presença ou liberar vaga para lista de espera.
                    </span>
                  </div>
                  <input type="checkbox" defaultChecked className="w-4 h-4 text-sky-600 rounded" />
                </div>

                <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between">
                  <div>
                    <strong className="block text-slate-900">
                      Lembrete com 24 Horas de Antecedência
                    </strong>
                    <span className="text-slate-500 text-[11px]">
                      Envia instruções de jejum ou envio prévio de exames laboratoriais.
                    </span>
                  </div>
                  <input type="checkbox" defaultChecked className="w-4 h-4 text-sky-600 rounded" />
                </div>

                <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between">
                  <div>
                    <strong className="block text-slate-900">
                      Mensagem de Pós-Atendimento e Acolhimento
                    </strong>
                    <span className="text-slate-500 text-[11px]">
                      Pesquisa de satisfação e canal aberto para dúvidas sobre receitas e orientações.
                    </span>
                  </div>
                  <input type="checkbox" defaultChecked className="w-4 h-4 text-sky-600 rounded" />
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: Megaapi Credentials & Connection Status */}
          {activeTab === 'config' && (
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
                    : connectionStatus.status === 'QRCODE_REQUIRED'
                      ? 'bg-amber-50 border-amber-200 text-amber-900'
                      : connectionStatus.status === 'UNCONFIGURED'
                        ? 'bg-slate-50 border-slate-200 text-slate-700'
                        : 'bg-rose-50 border-rose-200 text-rose-900'
                }`}
              >
                <div className="space-y-1">
                  <div className="font-bold flex items-center gap-2">
                    {connectionStatus.connected ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    ) : connectionStatus.status === 'QRCODE_REQUIRED' ? (
                      <QrCode className="w-4 h-4 text-amber-600" />
                    ) : (
                      <AlertCircle className="w-4 h-4" />
                    )}
                    <span>Status da Instância: {connectionStatus.status}</span>
                  </div>
                  <p className="text-[11px]">{connectionStatus.message}</p>
                  {connectionStatus.phoneNumber && (
                    <p className="text-[11px] font-mono">
                      Número conectado: {connectionStatus.phoneNumber}
                    </p>
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
                    <span>URL da Instância Megaapi (megaapi_instance_url)</span>
                  </label>
                  <input
                    type="url"
                    required
                    value={megaapiInstanceUrl}
                    onChange={(e) => setMegaapiInstanceUrl(e.target.value)}
                    placeholder="https://api.megaapi.com.br/v2/instances/sua-instancia"
                    className="w-full px-3 py-2.5 font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                  <span className="text-[11px] text-slate-400 mt-1 block">
                    Informe a URL base da instância (v2 ou REST) fornecida no painel da Megaapi.
                  </span>
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
    </div>
  );
};
