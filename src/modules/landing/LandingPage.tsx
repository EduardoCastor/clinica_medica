import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Building2,
  Calendar,
  Check,
  CheckCircle2,
  DollarSign,
  FileText,
  Loader2,
  MessageSquare,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  X,
} from 'lucide-react';
import { Plan } from '../../types';
import {
  fetchPublicPlansStrict,
  registerTrialClinic,
} from '../../services/saasCloudService';
import {
  calculatePlanCyclePricing,
  formatBrl,
  sortPlansByCommercialOrder,
} from '../../services/saasCommercialUtils';
import { useAuth } from '../../contexts/AuthContext';

interface LandingPageProps {
  onAccessClinic: () => void;
  onAccessSuperAdmin: () => void;
}

type CommercialCycle = 'monthly' | 'quarterly' | 'yearly';

export const LandingPage: React.FC<LandingPageProps> = ({
  onAccessClinic,
  onAccessSuperAdmin,
}) => {
  const { refreshSessionProfile } = useAuth();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [isLoadingPlans, setIsLoadingPlans] = useState<boolean>(true);
  const [plansError, setPlansError] = useState<string | null>(null);
  const [billingCycle, setBillingCycle] = useState<CommercialCycle>('monthly');

  const loadPlansStrict = useCallback(async () => {
    setIsLoadingPlans(true);
    const result = await fetchPublicPlansStrict({ includeInactive: false });
    if (!result.success) {
      setPlans([]);
      setPlansError(
        result.error ||
          'Não foi possível carregar os planos comerciais diretamente do banco de dados.'
      );
    } else {
      setPlans(sortPlansByCommercialOrder(result.plans));
      setPlansError(null);
    }
    setIsLoadingPlans(false);
  }, []);

  useEffect(() => {
    void loadPlansStrict();

    const handleFocus = () => {
      void loadPlansStrict();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void loadPlansStrict();
      }
    };
    const handlePlansUpdated = () => {
      void loadPlansStrict();
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('medsync-plans-updated', handlePlansUpdated);

    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('medsync-plans-updated', handlePlansUpdated);
    };
  }, [loadPlansStrict]);

  const maxQuarterlyDiscount = useMemo(() => {
    const paidPlans = plans.filter((p) => p.priceMonthly > 0);
    if (paidPlans.length === 0) return 0;
    return Math.max(
      ...paidPlans.map((p) => calculatePlanCyclePricing(p, 'quarterly').discountPercent)
    );
  }, [plans]);

  const maxYearlyDiscount = useMemo(() => {
    const paidPlans = plans.filter((p) => p.priceMonthly > 0);
    if (paidPlans.length === 0) return 0;
    return Math.max(
      ...paidPlans.map((p) => calculatePlanCyclePricing(p, 'yearly').discountPercent)
    );
  }, [plans]);

  // Modal real de cadastro + provisionamento de teste gratuito de 10 dias
  const [isRegisterModalOpen, setIsRegisterModalOpen] = useState(false);
  const [clinicName, setClinicName] = useState('');
  const [responsibleName, setResponsibleName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [documentNumber, setDocumentNumber] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [selectedPlanCode, setSelectedPlanCode] = useState('trial');
  const [isSubmittingSignup, setIsSubmittingSignup] = useState(false);
  const [signupError, setSignupError] = useState<string | null>(null);
  const [signupSuccessNotice, setSignupSuccessNotice] = useState<{
    message: string;
    requiresEmailConfirmation: boolean;
    trialEndsAt?: string;
  } | null>(null);

  const openTrialModal = (planCode = 'trial') => {
    setSelectedPlanCode(planCode);
    setSignupError(null);
    setSignupSuccessNotice(null);
    setIsRegisterModalOpen(true);
  };

  const handleRegisterClinic = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingSignup) return;
    setSignupError(null);
    setSignupSuccessNotice(null);
    setIsSubmittingSignup(true);

    try {
      const res = await registerTrialClinic({
        clinicName,
        responsibleName,
        email,
        phone,
        documentNumber: documentNumber.trim() || undefined,
        password,
        confirmPassword,
        planCode: selectedPlanCode,
      });

      if (!res.success) {
        setSignupError(res.error || 'Não foi possível criar sua clínica de teste.');
        return;
      }

      if (res.requiresEmailConfirmation || !res.signedIn) {
        setSignupSuccessNotice({
          requiresEmailConfirmation: true,
          trialEndsAt: res.trialEndsAt,
          message:
            'Conta criada com sucesso. Confirme o link enviado ao seu e-mail comercial para acessar o painel da clínica com 10 dias de avaliação gratuita.',
        });
        return;
      }

      await refreshSessionProfile();
      setIsRegisterModalOpen(false);
      onAccessClinic();
    } finally {
      setIsSubmittingSignup(false);
    }
  };

  const capabilities = [
    {
      index: '01',
      title: 'Arquitetura Multiunidade (Modelos A e B)',
      description:
        'Gerencie matriz e filiais em um único painel. Escolha prontuário compartilhado entre unidades (Modelo B) ou base exclusiva por filial (Modelo A).',
      icon: Building2,
      span: 'md:col-span-2',
    },
    {
      index: '02',
      title: 'Prontuário Eletrônico Imutável & LGPD',
      description:
        'Anamnese completa, evolução clínica, prescrições, atestados, pedidos de exames e adendos auditáveis em conformidade com o CFM.',
      icon: FileText,
      span: 'md:col-span-1',
    },
    {
      index: '03',
      title: 'Agenda Inteligente & Painel de Chamada TV',
      description:
        'Controle horários, salas e encaixes em tempo real com tela exclusiva de chamada sonora para a recepção.',
      icon: Calendar,
      span: 'md:col-span-1',
    },
    {
      index: '04',
      title: 'Automação WhatsApp Oficial + N8N',
      description:
        'Confirmações 48h e 24h antes da consulta com variáveis dinâmicas e retorno automático na agenda para reduzir faltas.',
      icon: MessageSquare,
      span: 'md:col-span-2',
    },
    {
      index: '05',
      title: 'Financeiro, Caixa & Recibos',
      description:
        'Contas a receber por filial e profissional, emissão de recibos para reembolso e acompanhamento diário de faturamento.',
      icon: DollarSign,
      span: 'md:col-span-1',
    },
    {
      index: '06',
      title: 'Site Institucional White-Label & Agendamento',
      description:
        'Site próprio com domínio personalizado, apresentação do corpo clínico e portal de agendamento online integrado.',
      icon: Smartphone,
      span: 'md:col-span-2',
    },
  ];

  const faqs = [
    {
      q: 'Como funciona o teste gratuito de 10 dias?',
      a: 'Ao concluir o cadastro, criamos automaticamente sua organização, clínica, unidade matriz e usuário administrador com acesso completo por 10 dias corridos, sem cobrança antecipada. Se o período expirar antes da contratação de um plano, todos os prontuários e cadastros permanecem preservados em modo leitura até a ativação da assinatura.',
    },
    {
      q: 'Posso migrar do teste grátis para o plano pago sem perder meus dados?',
      a: 'Sim. A contratação do plano mensal, trimestral ou anual converte a mesma clínica e mantém intactos todos os pacientes, agenda, prontuários, equipe e configurações cadastradas durante os 10 dias de teste.',
    },
    {
      q: 'Como funciona a diferença entre Modelo A e Modelo B nas filiais?',
      a: 'No Modelo A, cada filial mantém sua base isolada de pacientes. No Modelo B, as filiais autorizadas compartilham o cadastro e o prontuário eletrônico completo com controle de permissões por perfil.',
    },
    {
      q: 'Os preços mostrados na página são garantidos?',
      a: 'Sim. Todos os valores, descontos trimestrais/anuais e limites de usuários, filiais e pacientes são carregados diretamente do servidor oficial de planos comerciais do MedSync.',
    },
  ];

  return (
    <div className="min-h-screen bg-white text-slate-900 font-sans">
      {/* Top Bar Contract: 3 zonas equilibradas */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between gap-8">
          <a
            href="#topo"
            className="text-lg font-extrabold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            MedSync
          </a>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            <a
              href="#recursos"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Recursos
            </a>
            <a
              href="#planos"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Planos
            </a>
            <a
              href="#duvidas"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Dúvidas
            </a>
            <button
              type="button"
              onClick={onAccessClinic}
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Entrar na Clínica
            </button>
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => openTrialModal('trial')}
              className="px-4 py-2 text-xs font-bold text-white bg-sky-700 hover:bg-sky-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              Experimente grátis por 10 dias
            </button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section
        id="topo"
        className="pt-16 pb-20 sm:pt-24 sm:pb-28 px-6 bg-slate-950 text-white border-b border-slate-800"
      >
        <div className="max-w-5xl mx-auto space-y-8">
          <div className="text-xs font-medium text-sky-300 tracking-wide">
            Gestão Clínica Multiunidade · Prontuário Eletrônico CFM · Agenda e WhatsApp Oficial
          </div>

          <h1
            className="font-extrabold tracking-tight text-white max-w-4xl leading-[1.08]"
            style={{
              fontSize: 'clamp(2.25rem, 4vw, 3.65rem)',
              textWrap: 'balance',
            }}
          >
            Operação clínica completa para consultórios e redes com múltiplas filiais.
          </h1>

          <p className="text-base sm:text-lg text-slate-300 max-w-2xl leading-relaxed">
            Centralize agenda, prontuário eletrônico auditável, painel de chamada na recepção, financeiro e site white-label da sua clínica em um único sistema com isolamento por organização.
          </p>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-2">
            <button
              type="button"
              onClick={() => openTrialModal('trial')}
              className="px-6 py-3.5 text-xs font-bold text-white bg-sky-600 hover:bg-sky-500 rounded-xl transition-colors inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0"
            >
              <span>Começar Teste Grátis de 10 Dias</span>
              <ArrowRight className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onAccessClinic}
              className="px-6 py-3.5 text-xs font-semibold text-slate-200 hover:text-white bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded-xl transition-colors whitespace-nowrap shrink-0"
            >
              Acessar Painel da Clínica
            </button>
          </div>

          <div className="pt-6 border-t border-slate-800 grid grid-cols-1 sm:grid-cols-3 gap-6 text-xs text-slate-300">
            <div>
              <span className="block text-xl font-extrabold text-white tabular-nums">10 dias</span>
              <span className="text-slate-400">Teste completo sem cartão de crédito</span>
            </div>
            <div>
              <span className="block text-xl font-extrabold text-white tabular-nums">Modelos A e B</span>
              <span className="text-slate-400">Prontuário isolado ou unificado por filial</span>
            </div>
            <div>
              <span className="block text-xl font-extrabold text-white tabular-nums">LGPD + CFM</span>
              <span className="text-slate-400">Trilha de auditoria e controle estrito por perfil</span>
            </div>
          </div>
        </div>
      </section>

      {/* Core Capabilities */}
      <section id="recursos" className="py-20 px-6 max-w-6xl mx-auto space-y-12">
        <div className="max-w-2xl space-y-3">
          <p className="text-xs font-semibold text-sky-700">Módulos Integrados</p>
          <h2
            className="text-2xl sm:text-4xl font-extrabold text-slate-900 tracking-tight"
            style={{ textWrap: 'balance' }}
          >
            Do primeiro agendamento ao fechamento financeiro da clínica
          </h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            Cada clínica opera com ambiente próprio, equipe configurável por unidade e fluxo clínico contínuo sem retrabalho entre recepção, médicos e financeiro.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {capabilities.map((cap) => {
            const Icon = cap.icon;
            return (
              <div
                key={cap.index}
                className={`${cap.span} p-6 bg-slate-50 rounded-2xl border border-slate-200 flex flex-col justify-between space-y-4`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-semibold text-slate-500 tabular-nums">
                    {cap.index}.
                  </span>
                  <Icon className="w-5 h-5 text-sky-700" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-base font-bold text-slate-900">{cap.title}</h3>
                  <p className="text-sm text-slate-600 leading-relaxed">{cap.description}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Pricing Section — Fonte Única de Verdade (Supabase) */}
      <section id="planos" className="py-20 px-6 bg-slate-50 border-y border-slate-200">
        <div className="max-w-6xl mx-auto space-y-10">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
            <div className="space-y-2 max-w-2xl">
              <p className="text-xs font-semibold text-sky-700">
                Planos Comerciais · Tabela Oficial em Tempo Real
              </p>
              <h2
                className="text-2xl sm:text-4xl font-extrabold text-slate-900 tracking-tight"
                style={{ textWrap: 'balance' }}
              >
                Escolha o plano compatível com o porte da sua clínica
              </h2>
              <p className="text-sm text-slate-600">
                Comece com 10 dias gratuitos e contrate o ciclo mensal, trimestral ou anual quando estiver pronto.
              </p>
            </div>

            {/* Segmented Control Mensal / Trimestral / Anual */}
            <div
              role="tablist"
              aria-label="Periodicidade de cobrança"
              className="inline-flex items-center gap-1 p-1 bg-slate-200/80 rounded-xl border border-slate-300/70 self-start md:self-auto"
            >
              <button
                type="button"
                role="tab"
                aria-selected={billingCycle === 'monthly'}
                onClick={() => setBillingCycle('monthly')}
                className={`px-3.5 py-2 rounded-lg text-xs font-bold transition-colors whitespace-nowrap shrink-0 ${
                  billingCycle === 'monthly'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Mensal
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={billingCycle === 'quarterly'}
                onClick={() => setBillingCycle('quarterly')}
                className={`px-3.5 py-2 rounded-lg text-xs font-bold transition-colors whitespace-nowrap shrink-0 ${
                  billingCycle === 'quarterly'
                    ? 'bg-sky-700 text-white shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Trimestral{maxQuarterlyDiscount > 0 ? ` (-${maxQuarterlyDiscount}%)` : ''}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={billingCycle === 'yearly'}
                onClick={() => setBillingCycle('yearly')}
                className={`px-3.5 py-2 rounded-lg text-xs font-bold transition-colors whitespace-nowrap shrink-0 ${
                  billingCycle === 'yearly'
                    ? 'bg-sky-700 text-white shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Anual{maxYearlyDiscount > 0 ? ` (-${maxYearlyDiscount}%)` : ''}
              </button>
            </div>
          </div>

          {/* Loading Skeleton / Explicit Error / Real Plans */}
          {isLoadingPlans ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch">
              {[0, 1, 2].map((idx) => (
                <div
                  key={idx}
                  className="rounded-2xl p-6 bg-white border border-slate-200 space-y-4 animate-pulse"
                >
                  <div className="h-5 w-36 bg-slate-200 rounded" />
                  <div className="h-3 w-full bg-slate-100 rounded" />
                  <div className="h-9 w-32 bg-slate-200 rounded mt-4" />
                  <div className="h-px bg-slate-100 my-4" />
                  <div className="space-y-2.5">
                    <div className="h-3 w-4/5 bg-slate-100 rounded" />
                    <div className="h-3 w-3/4 bg-slate-100 rounded" />
                    <div className="h-3 w-5/6 bg-slate-100 rounded" />
                  </div>
                  <div className="h-10 w-full bg-slate-200 rounded-xl mt-6" />
                </div>
              ))}
            </div>
          ) : plansError || plans.length === 0 ? (
            <div className="p-8 bg-white rounded-2xl border border-rose-200 text-center space-y-4 max-w-2xl mx-auto">
              <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-700 flex items-center justify-center mx-auto">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div className="space-y-1.5">
                <h3 className="text-base font-bold text-slate-900">
                  Não foi possível carregar os planos oficiais no momento
                </h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  {plansError ||
                    'Nenhum plano comercial ativo retornado pelo servidor. Para evitar divergência de valores, os preços não são exibidos fora do banco de dados.'}
                </p>
              </div>
              <div className="flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => void loadPlansStrict()}
                  className="px-4 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-xl inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Tentar novamente</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch">
              {plans.map((plan) => {
                const isPopular = Boolean(plan.isPopular || plan.code === 'advanced');
                const pricing = calculatePlanCyclePricing(plan, billingCycle);
                const isTrial = pricing.isTrial;

                return (
                  <div
                    key={plan.id}
                    className={`rounded-2xl p-6 flex flex-col justify-between transition ${
                      isPopular
                        ? 'bg-slate-900 text-white border border-sky-500'
                        : 'bg-white text-slate-900 border border-slate-200'
                    }`}
                  >
                    <div className="space-y-5">
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span
                            className={`font-medium ${
                              isPopular ? 'text-sky-300' : 'text-slate-500'
                            }`}
                          >
                            {isTrial
                              ? `Avaliação gratuita · ${plan.trialDays || 10} dias`
                              : isPopular
                              ? 'Mais escolhido pelas clínicas'
                              : 'Plano comercial'}
                          </span>
                        </div>
                        <h3 className="text-lg font-bold">{plan.name}</h3>
                        <p
                          className={`text-xs leading-relaxed ${
                            isPopular ? 'text-slate-300' : 'text-slate-600'
                          }`}
                        >
                          {plan.description}
                        </p>
                      </div>

                      <div className="pt-1 space-y-1">
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-xs font-semibold">R$</span>
                          <span className="text-3xl font-extrabold tabular-nums">
                            {isTrial ? '0,00' : formatBrl(pricing.effectiveMonthly)}
                          </span>
                          <span
                            className={`text-xs ${
                              isPopular ? 'text-slate-400' : 'text-slate-500'
                            }`}
                          >
                            {isTrial ? `/ ${plan.trialDays || 10} dias` : '/mês'}
                          </span>
                        </div>

                        {!isTrial && billingCycle === 'monthly' && (
                          <p
                            className={`text-[11px] font-mono tabular-nums ${
                              isPopular ? 'text-slate-400' : 'text-slate-500'
                            }`}
                          >
                            Cobrança mensal de R$ {formatBrl(pricing.finalPeriodAmount)}
                          </p>
                        )}
                        {!isTrial && billingCycle === 'quarterly' && (
                          <p
                            className={`text-[11px] font-mono tabular-nums ${
                              isPopular ? 'text-sky-300' : 'text-emerald-700'
                            }`}
                          >
                            R$ {formatBrl(pricing.finalPeriodAmount)} / trimestre
                            {pricing.discountPercent > 0
                              ? ` (${pricing.discountPercent}% OFF)`
                              : ''}
                          </p>
                        )}
                        {!isTrial && billingCycle === 'yearly' && (
                          <p
                            className={`text-[11px] font-mono tabular-nums ${
                              isPopular ? 'text-sky-300' : 'text-emerald-700'
                            }`}
                          >
                            R$ {formatBrl(pricing.finalPeriodAmount)} / ano
                            {pricing.discountPercent > 0
                              ? ` (${pricing.discountPercent}% OFF)`
                              : ''}
                          </p>
                        )}
                      </div>

                      <div
                        className={`h-px ${isPopular ? 'bg-slate-800' : 'bg-slate-200'}`}
                      />

                      <ul className="space-y-2.5 text-xs">
                        <li className="flex items-center gap-2">
                          <Check
                            className={`w-4 h-4 shrink-0 ${
                              isPopular ? 'text-sky-400' : 'text-sky-700'
                            }`}
                          />
                          <span>
                            Até <strong className="tabular-nums">{plan.maxBranches}</strong>{' '}
                            {plan.maxBranches === 1 ? 'unidade/filial' : 'unidades integradas'}
                          </span>
                        </li>
                        <li className="flex items-center gap-2">
                          <Check
                            className={`w-4 h-4 shrink-0 ${
                              isPopular ? 'text-sky-400' : 'text-sky-700'
                            }`}
                          />
                          <span>
                            Até <strong className="tabular-nums">{plan.maxUsers}</strong>{' '}
                            usuários da equipe
                          </span>
                        </li>
                        <li className="flex items-center gap-2">
                          <Check
                            className={`w-4 h-4 shrink-0 ${
                              isPopular ? 'text-sky-400' : 'text-sky-700'
                            }`}
                          />
                          <span>
                            Até{' '}
                            <strong className="tabular-nums">
                              {plan.maxPatients.toLocaleString('pt-BR')}
                            </strong>{' '}
                            pacientes cadastrados
                          </span>
                        </li>
                        <li className="flex items-center gap-2">
                          <Check
                            className={`w-4 h-4 shrink-0 ${
                              isPopular ? 'text-sky-400' : 'text-sky-700'
                            }`}
                          />
                          <span>
                            {plan.hasPatientSharing
                              ? 'Compartilhamento Modelo A & B entre filiais'
                              : 'Base isolada por unidade (Modelo A)'}
                          </span>
                        </li>
                        <li className="flex items-center gap-2">
                          <Check
                            className={`w-4 h-4 shrink-0 ${
                              isPopular ? 'text-sky-400' : 'text-sky-700'
                            }`}
                          />
                          <span>
                            {plan.hasCustomWebsite
                              ? 'Site White-Label + Agendamento Online'
                              : 'Agendamento interno da recepção'}
                          </span>
                        </li>
                        <li className="flex items-center gap-2">
                          <Check
                            className={`w-4 h-4 shrink-0 ${
                              isPopular ? 'text-sky-400' : 'text-sky-700'
                            }`}
                          />
                          <span>
                            {plan.hasWhatsAppAutomation
                              ? 'Automação WhatsApp Oficial + Lembretes'
                              : 'Confirmação manual via WhatsApp'}
                          </span>
                        </li>
                        {plan.hasFinancialModule && (
                          <li className="flex items-center gap-2">
                            <Check
                              className={`w-4 h-4 shrink-0 ${
                                isPopular ? 'text-sky-400' : 'text-sky-700'
                              }`}
                            />
                            <span>Módulo Financeiro, Caixa & Recibos</span>
                          </li>
                        )}
                        {plan.hasAdvancedReports && (
                          <li className="flex items-center gap-2">
                            <Check
                              className={`w-4 h-4 shrink-0 ${
                                isPopular ? 'text-sky-400' : 'text-sky-700'
                              }`}
                            />
                            <span>Indicadores Gerenciais e Produtividade</span>
                          </li>
                        )}
                      </ul>
                    </div>

                    <div className="pt-6">
                      <button
                        type="button"
                        onClick={() => openTrialModal(plan.code)}
                        className={`w-full py-2.5 px-4 text-xs font-bold rounded-xl transition-colors whitespace-nowrap ${
                          isPopular
                            ? 'bg-sky-600 hover:bg-sky-500 text-white'
                            : 'bg-slate-900 hover:bg-slate-800 text-white'
                        }`}
                      >
                        {isTrial
                          ? 'Experimente grátis por 10 dias'
                          : `Testar 10 dias · ${plan.name}`}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* FAQ Section */}
      <section id="duvidas" className="py-20 px-6 max-w-4xl mx-auto space-y-10">
        <div className="space-y-2">
          <p className="text-xs font-semibold text-slate-500">Perguntas Frequentes</p>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
            Dúvidas sobre contratação, filiais e segurança
          </h2>
        </div>

        <div className="divide-y divide-slate-200 border-y border-slate-200">
          {faqs.map((f, i) => (
            <div key={i} className="py-5 space-y-2">
              <h3 className="font-bold text-sm text-slate-900">{f.q}</h3>
              <p className="text-sm text-slate-600 leading-relaxed">{f.a}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Quiet Footer */}
      <footer className="bg-slate-950 text-slate-400 py-10 px-6 border-t border-slate-800 text-xs">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-white font-bold">
            <Activity className="w-4 h-4 text-sky-400" />
            <span>MedSync SaaS · Gestão de Clínicas Médicas</span>
          </div>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={onAccessClinic}
              className="hover:text-white transition-colors whitespace-nowrap"
            >
              Acesso Clínica
            </button>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              onClick={onAccessSuperAdmin}
              className="hover:text-white transition-colors whitespace-nowrap"
            >
              Administração Geral SaaS
            </button>
            <span aria-hidden="true">·</span>
            <span>Conformidade LGPD & CFM</span>
          </div>
        </div>
      </footer>

      {/* Modal Real de Cadastro e Provisionamento do Teste Gratuito de 10 Dias */}
      {isRegisterModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 space-y-5 my-6">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
              <div className="space-y-1">
                <h3 className="text-base font-bold text-slate-900">
                  Criar Conta com 10 Dias de Teste Grátis
                </h3>
                <p className="text-xs text-slate-600">
                  Provisionamos automaticamente sua organização, unidade matriz, sala inicial e usuário administrador no servidor.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsRegisterModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100"
                aria-label="Fechar"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {signupSuccessNotice ? (
              <div className="space-y-4 text-xs">
                <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 space-y-2">
                  <div className="flex items-center gap-2 font-bold">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>Ambiente da Clínica Provisionado</span>
                  </div>
                  <p className="leading-relaxed">{signupSuccessNotice.message}</p>
                  {signupSuccessNotice.trialEndsAt && (
                    <p className="font-mono text-[11px] text-emerald-800">
                      Teste válido até{' '}
                      {new Date(signupSuccessNotice.trialEndsAt).toLocaleDateString('pt-BR')}
                    </p>
                  )}
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsRegisterModalOpen(false);
                      onAccessClinic();
                    }}
                    className="px-4 py-2 text-xs font-bold text-white bg-sky-700 hover:bg-sky-800 rounded-xl"
                  >
                    Ir para Login da Clínica
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleRegisterClinic} className="space-y-3.5 text-xs">
                {signupError && (
                  <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                    <span>{signupError}</span>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Nome da Clínica
                    </label>
                    <input
                      type="text"
                      required
                      minLength={3}
                      placeholder="Ex: Clínica Saúde Integrada"
                      value={clinicName}
                      onChange={(e) => setClinicName(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-600"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Nome do Responsável
                    </label>
                    <input
                      type="text"
                      required
                      minLength={3}
                      placeholder="Ex: Dr. Carlos Almeida"
                      value={responsibleName}
                      onChange={(e) => setResponsibleName(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-600"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      E-mail Comercial
                    </label>
                    <input
                      type="email"
                      required
                      placeholder="gestao@suaclinica.com.br"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-600"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      WhatsApp / Telefone
                    </label>
                    <input
                      type="tel"
                      required
                      placeholder="(11) 98765-4321"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-600"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      CNPJ ou CPF (Opcional)
                    </label>
                    <input
                      type="text"
                      placeholder="00.000.000/0001-00"
                      value={documentNumber}
                      onChange={(e) => setDocumentNumber(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-600 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Plano de Interesse
                    </label>
                    <select
                      value={selectedPlanCode}
                      onChange={(e) => setSelectedPlanCode(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-slate-50 font-semibold text-slate-900"
                    >
                      {plans.length > 0 ? (
                        plans.map((p) => (
                          <option key={p.id} value={p.code}>
                            {p.name}{' '}
                            {p.priceMonthly > 0
                              ? `(R$ ${formatBrl(p.priceMonthly)}/mês após teste)`
                              : `(${p.trialDays || 10} dias grátis)`}
                          </option>
                        ))
                      ) : (
                        <option value="trial">Teste Grátis (10 dias)</option>
                      )}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Senha de Acesso
                    </label>
                    <input
                      type="password"
                      required
                      minLength={8}
                      placeholder="Mínimo 8 caracteres"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-600"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Confirmar Senha
                    </label>
                    <input
                      type="password"
                      required
                      minLength={8}
                      placeholder="Repita a senha"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-600"
                    />
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-600 flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-sky-700 shrink-0" />
                  <span>
                    Prazo de 10 dias calculado no servidor. Apenas um teste gratuito por e-mail ou CNPJ/CPF.
                  </span>
                </div>

                <div className="pt-3 flex justify-end gap-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setIsRegisterModalOpen(false)}
                    disabled={isSubmittingSignup}
                    className="px-4 py-2 text-slate-600 hover:text-slate-900 font-semibold"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmittingSignup}
                    className="px-5 py-2 font-bold text-white bg-sky-700 hover:bg-sky-800 disabled:opacity-60 rounded-xl inline-flex items-center gap-2"
                  >
                    {isSubmittingSignup ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Provisionando clínica...</span>
                      </>
                    ) : (
                      <span>Iniciar Teste Grátis de 10 Dias</span>
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
