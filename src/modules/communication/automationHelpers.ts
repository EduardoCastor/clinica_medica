import {
  AutomationEventType,
  AutomationExecutionStatus,
  AutomationIntervalUnit,
  AutomationTriggerCategory,
  AutomationTriggerStatus,
  AutomationWeekday,
  MessageTemplate,
  WhatsAppAutomationTrigger,
} from '../../types';

export const AUTOMATION_CATEGORY_LABELS: Record<AutomationTriggerCategory, string> = {
  appointment_confirmation: 'Confirmação de Consulta',
  reminder: 'Lembrete de Agenda',
  auto_reply: 'Resposta Automática',
  post_care: 'Pós-Atendimento',
  birthday: 'Aniversário',
  custom: 'Personalizado',
};

export const AUTOMATION_STATUS_LABELS: Record<AutomationTriggerStatus, string> = {
  active: 'Ativo',
  paused: 'Pausado',
  draft: 'Rascunho',
  inactive: 'Inativo',
};

export const AUTOMATION_EXECUTION_STATUS_LABELS: Record<AutomationExecutionStatus, string> = {
  pending: 'Programado',
  processing: 'Em envio',
  sent: 'Enviado',
  delivered: 'Entregue',
  failed: 'Falhou',
  cancelled: 'Cancelado',
  skipped: 'Ignorado',
};

export interface EventTypeMeta {
  value: AutomationEventType;
  label: string;
  explanation: string;
  defaultCategory: AutomationTriggerCategory;
}

export const AUTOMATION_EVENT_OPTIONS: EventTypeMeta[] = [
  {
    value: 'appointment_created',
    label: 'Novo agendamento criado',
    explanation: 'Dispara quando uma nova consulta é registrada na agenda interna ou pelo agendamento online.',
    defaultCategory: 'appointment_confirmation',
  },
  {
    value: 'appointment_confirmed',
    label: 'Consulta confirmada',
    explanation: 'Dispara quando o paciente confirma presença (por resposta automática "1" ou confirmação da equipe).',
    defaultCategory: 'auto_reply',
  },
  {
    value: 'appointment_upcoming',
    label: 'Consulta agendada com antecedência',
    explanation: 'Dispara automaticamente antes da data da consulta (ex.: 48 horas antes, 24 horas antes ou na manhã do dia).',
    defaultCategory: 'reminder',
  },
  {
    value: 'appointment_soon',
    label: 'Consulta próxima do horário',
    explanation: 'Dispara poucas horas ou minutos antes do atendimento para reduzir atrasos e faltas.',
    defaultCategory: 'reminder',
  },
  {
    value: 'appointment_completed',
    label: 'Consulta concluída',
    explanation: 'Dispara após a finalização do atendimento na recepção ou prontuário.',
    defaultCategory: 'post_care',
  },
  {
    value: 'appointment_cancelled',
    label: 'Consulta cancelada',
    explanation: 'Dispara quando uma consulta marcada é cancelada, permitindo enviar confirmação ou opção de remarcação.',
    defaultCategory: 'custom',
  },
  {
    value: 'appointment_no_show',
    label: 'Paciente não compareceu',
    explanation: 'Dispara quando o atendimento é marcado como falta para acolher e oferecer novo horário.',
    defaultCategory: 'custom',
  },
  {
    value: 'post_care',
    label: 'Acompanhamento pós-atendimento',
    explanation: 'Inicia uma sequência programada de acompanhamento nos dias ou semanas seguintes à consulta.',
    defaultCategory: 'post_care',
  },
  {
    value: 'patient_birthday',
    label: 'Aniversário do paciente',
    explanation: 'Verifica diariamente os aniversariantes cadastrados e envia uma felicitação no horário configurado.',
    defaultCategory: 'birthday',
  },
  {
    value: 'custom',
    label: 'Gatilho personalizado',
    explanation: 'Regra flexível configurada pela administração para campanhas, retornos periódicos ou fluxos específicos.',
    defaultCategory: 'custom',
  },
];

export const WEEKDAY_OPTIONS: Array<{ value: AutomationWeekday; short: string; label: string }> = [
  { value: 'mon', short: 'Seg', label: 'Segunda-feira' },
  { value: 'tue', short: 'Ter', label: 'Terça-feira' },
  { value: 'wed', short: 'Qua', label: 'Quarta-feira' },
  { value: 'thu', short: 'Qui', label: 'Quinta-feira' },
  { value: 'fri', short: 'Sex', label: 'Sexta-feira' },
  { value: 'sat', short: 'Sáb', label: 'Sábado' },
  { value: 'sun', short: 'Dom', label: 'Domingo' },
];

export const PREFERRED_TIME_PRESETS = ['08:00', '09:00', '12:00', '15:00', '18:00'];

export const INTERVAL_UNIT_LABELS: Record<AutomationIntervalUnit, string> = {
  minutes: 'Minutos',
  hours: 'Horas',
  days: 'Dias',
  weeks: 'Semanas',
};

export function intervalToDays(value: number, unit: AutomationIntervalUnit): number {
  if (value <= 0) return 0;
  if (unit === 'minutes') return value / (60 * 24);
  if (unit === 'hours') return value / 24;
  if (unit === 'days') return value;
  return value * 7;
}

export function intervalToMinutes(value: number, unit: AutomationIntervalUnit): number {
  if (value <= 0) return 0;
  if (unit === 'minutes') return value;
  if (unit === 'hours') return value * 60;
  if (unit === 'days') return value * 24 * 60;
  return value * 7 * 24 * 60;
}

export function validateRepeatDurationCompatibility(
  totalSends: number,
  intervalValue: number,
  intervalUnit: AutomationIntervalUnit,
  maxDurationDays: number
): { valid: boolean; requiredDays: number; warning?: string } {
  if (totalSends <= 1) {
    return { valid: true, requiredDays: 0 };
  }
  if (intervalValue <= 0) {
    return {
      valid: false,
      requiredDays: 0,
      warning: 'Para múltiplos envios, informe um intervalo maior que zero entre as mensagens.',
    };
  }
  const spanDays = (totalSends - 1) * intervalToDays(intervalValue, intervalUnit);
  const roundedRequired = Math.ceil(spanDays);
  if (maxDurationDays > 0 && spanDays > maxDurationDays + 0.05) {
    return {
      valid: false,
      requiredDays: roundedRequired,
      warning: `A duração máxima de ${maxDurationDays} dia(s) é menor do que o período necessário para ${totalSends} envios nesse intervalo (mínimo recomendado: ${roundedRequired} dia(s)).`,
    };
  }
  return { valid: true, requiredDays: roundedRequired };
}

export function formatIntervalText(value: number, unit: AutomationIntervalUnit): string {
  if (value <= 0) return 'Envio imediato';
  const unitName =
    unit === 'minutes'
      ? value === 1
        ? 'minuto'
        : 'minutos'
      : unit === 'hours'
        ? value === 1
          ? 'hora'
          : 'horas'
        : unit === 'days'
          ? value === 1
            ? 'dia'
            : 'dias'
          : value === 1
            ? 'semana'
            : 'semanas';
  return `A cada ${value} ${unitName}`;
}

export function describeTriggerScheduleSummary(
  trigger: Pick<
    WhatsAppAutomationTrigger,
    | 'name'
    | 'eventType'
    | 'totalSends'
    | 'intervalValue'
    | 'intervalUnit'
    | 'maxDurationDays'
    | 'scheduleMode'
    | 'leadTimeValue'
    | 'leadTimeUnit'
    | 'preferredSendTime'
    | 'allowedDays'
    | 'windowStart'
    | 'windowEnd'
    | 'outsideWindowPolicy'
    | 'smartRules'
  >,
  templateName?: string
): string {
  const eventLabel =
    AUTOMATION_EVENT_OPTIONS.find((e) => e.value === trigger.eventType)?.label.toLowerCase() ||
    'evento selecionado';
  const tplLabel = templateName || 'modelo selecionado';

  const daysLabel =
    trigger.allowedDays.length === 7
      ? 'todos os dias'
      : trigger.allowedDays
          .map((d) => WEEKDAY_OPTIONS.find((w) => w.value === d)?.short || d)
          .join(', ');

  const timingPhrase =
    trigger.scheduleMode === 'fixed_time'
      ? `no horário fixo das ${trigger.preferredSendTime}`
      : trigger.leadTimeValue > 0
        ? `com referência de ${trigger.leadTimeValue} ${
            trigger.leadTimeUnit === 'minutes'
              ? 'minuto(s)'
              : trigger.leadTimeUnit === 'hours'
                ? 'hora(s)'
                : 'dia(s)'
          } e preferência às ${trigger.preferredSendTime}`
        : `imediatamente após o evento (ou às ${trigger.preferredSendTime} se ajustado à janela)`;

  const repeatPhrase =
    trigger.totalSends <= 1
      ? 'enviará 1 mensagem'
      : `enviará até ${trigger.totalSends} mensagens (já incluindo o 1º envio), ${formatIntervalText(
          trigger.intervalValue,
          trigger.intervalUnit
        ).toLowerCase()}, por no máximo ${trigger.maxDurationDays} dia(s)`;

  const stopConditions: string[] = [];
  if (trigger.smartRules.stopOnAppointmentCancel) {
    stopConditions.push('interrompendo se a consulta for cancelada');
  }
  if (trigger.smartRules.stopOnAppointmentConfirm) {
    stopConditions.push('interrompendo se o paciente já tiver confirmado');
  }

  const stopPhrase = stopConditions.length > 0 ? `, ${stopConditions.join(' e ')}` : '';

  return `Ao ocorrer "${eventLabel}", este gatilho ${repeatPhrase} utilizando o modelo "${tplLabel}", ${timingPhrase}, respeitando a janela de ${trigger.windowStart} às ${trigger.windowEnd} (${daysLabel} · Horário de Brasília)${stopPhrase}.`;
}

export function computeNextRunPreviewText(trigger: WhatsAppAutomationTrigger): string {
  if (trigger.status === 'paused') return 'Pausado no momento';
  if (trigger.status === 'draft') return 'Rascunho (aguardando ativação)';
  if (trigger.status === 'inactive') return 'Desativado';

  if (trigger.eventType === 'appointment_created') return 'Automático ao criar consulta';
  if (trigger.eventType === 'appointment_confirmed') return 'Reativo ao confirmar consulta';
  if (trigger.eventType === 'appointment_completed') return 'Após finalizar atendimento';
  if (trigger.eventType === 'patient_birthday') {
    return `Diariamente às ${trigger.preferredSendTime}`;
  }
  if (trigger.scheduleMode === 'fixed_time') {
    return `Próxima janela às ${trigger.preferredSendTime}`;
  }
  if (trigger.nextRunEstimate) return trigger.nextRunEstimate;
  return `Conforme agenda (${trigger.preferredSendTime})`;
}

export function isTemplateCompatibleWithTrigger(tpl: MessageTemplate): boolean {
  return tpl.isActive !== false && tpl.channel === 'whatsapp';
}
