import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Printer, Lock } from 'lucide-react';
import {
  Prescription,
  MedicalCertificate,
  LabOrder,
  MedicalRecordEntry,
  ExamResult,
  FinancialTransaction,
  Branch,
  Clinic,
} from '../../types';
import { useTenant } from '../../contexts/TenantContext';
import {
  MedicalDocumentHeader,
  MedicalDocumentFooter,
  CLINIC_OFFICIAL_DATA,
} from '../ClinicBrandLogo';

export type PrintableDocumentType =
  | { type: 'prescription'; data: Prescription }
  | { type: 'certificate'; data: MedicalCertificate }
  | { type: 'lab_order'; data: LabOrder }
  | { type: 'medical_record'; data: MedicalRecordEntry; patientName?: string; patientCpf?: string }
  | { type: 'exam_result'; data: ExamResult; patientName?: string; patientCpf?: string }
  | { type: 'financial_receipt'; data: FinancialTransaction; patientName?: string; patientCpf?: string };

interface DocumentPrintModalProps {
  isOpen: boolean;
  onClose: () => void;
  document: PrintableDocumentType | null;
}

export const DocumentPrintModal: React.FC<DocumentPrintModalProps> = ({
  isOpen,
  onClose,
  document,
}) => {
  const { clinic, branches, activeBranch } = useTenant();
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen || !document || typeof window === 'undefined') {
      return;
    }

    const docBody = window.document.body;
    const container = window.document.createElement('div');
    container.id = 'medsync-print-portal';
    container.className = 'bg-white text-slate-900';
    docBody.appendChild(container);
    docBody.classList.add('medsync-printing-doc');
    setPortalContainer(container);

    return () => {
      docBody.classList.remove('medsync-printing-doc');
      if (container.parentNode) {
        container.parentNode.removeChild(container);
      }
      setPortalContainer(null);
    };
  }, [isOpen, document]);

  if (!isOpen || !document) return null;

  const docBranchId = document.data.branchId;
  const resolvedBranch: Branch | undefined =
    (docBranchId ? branches.find((b) => b.id === docBranchId) : undefined) ||
    activeBranch ||
    branches.find((b) => b.isHeadquarters) ||
    branches[0];

  const handlePrint = () => {
    window.print();
  };

  const renderPrintableBody = () => (
    <>
      {document.type === 'prescription' && (
        <PrescriptionCanvas
          prescription={document.data}
          clinic={clinic}
          branch={resolvedBranch}
        />
      )}

      {document.type === 'certificate' && (
        <CertificateCanvas
          certificate={document.data}
          clinic={clinic}
          branch={resolvedBranch}
        />
      )}

      {document.type === 'lab_order' && (
        <LabOrderCanvas
          order={document.data}
          clinic={clinic}
          branch={resolvedBranch}
        />
      )}

      {document.type === 'medical_record' && (
        <MedicalRecordCanvas
          record={document.data}
          patientName={document.patientName}
          patientCpf={document.patientCpf}
          clinic={clinic}
          branch={resolvedBranch}
        />
      )}

      {document.type === 'exam_result' && (
        <ExamResultCanvas
          result={document.data}
          patientName={document.patientName}
          patientCpf={document.patientCpf}
          clinic={clinic}
          branch={resolvedBranch}
        />
      )}

      {document.type === 'financial_receipt' && (
        <FinancialReceiptCanvas
          transaction={document.data}
          patientName={document.patientName}
          patientCpf={document.patientCpf}
          clinic={clinic}
          branch={resolvedBranch}
        />
      )}
    </>
  );

  const headerLegalName =
    clinic?.legalName || clinic?.tradeName || CLINIC_OFFICIAL_DATA.legalName;
  const headerCnpj =
    resolvedBranch?.documentNumber || clinic?.documentNumber || CLINIC_OFFICIAL_DATA.cnpj;

  return (
    <>
      {/* Modal de Pré-Visualização na Tela (Oculto durante window.print via print:hidden e body.medsync-printing-doc) */}
      <div className="print:hidden fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-xs p-4 overflow-y-auto">
        <div className="w-full max-w-4xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col my-6 max-h-[90vh]">
          {/* Modal Toolbar */}
          <div className="bg-[#1E2024] text-white px-6 py-4 flex items-center justify-between border-b border-[#D4AF37]/30 shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <div className="p-2 bg-[#D4AF37]/15 text-[#E5C158] rounded-lg border border-[#D4AF37]/30 shrink-0">
                <Printer className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-white flex items-center gap-2 flex-wrap">
                  <span>Visualização de Impressão Oficial</span>
                  <span className="text-[10px] font-semibold px-2 py-0.5 bg-[#D4AF37]/20 text-[#E5C158] rounded border border-[#D4AF37]/40">
                    Padrão CFM & ANVISA
                  </span>
                </h3>
                <p className="text-xs text-slate-400 truncate">
                  {headerLegalName} · CNPJ {headerCnpj}
                  {resolvedBranch ? ` · ${resolvedBranch.name}` : ''}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handlePrint}
                className="px-4 py-2 text-xs font-semibold text-[#1E2024] bg-[#E5C158] hover:bg-[#D4AF37] rounded-xl shadow-xs transition flex items-center gap-1.5"
              >
                <Printer className="w-4 h-4" />
                <span>Imprimir / Gerar PDF</span>
              </button>
              <button
                type="button"
                onClick={onClose}
                className="p-2 text-slate-400 hover:text-white rounded-lg transition"
                title="Fechar visualização"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Printable Preview Sheet (Screen Only) */}
          <div className="flex-1 overflow-y-auto p-6 sm:p-10 bg-slate-100 flex justify-center">
            <div className="w-full max-w-[210mm] min-h-[260mm] bg-white text-slate-900 p-8 sm:p-12 shadow-md flex flex-col justify-between border border-slate-200">
              {renderPrintableBody()}
            </div>
          </div>
        </div>
      </div>

      {/* Portal Exclusivo de Impressão diretamente no document.body */}
      {portalContainer &&
        createPortal(
          <div className="w-full max-w-[190mm] mx-auto bg-white text-slate-900 text-sm">
            {renderPrintableBody()}
          </div>,
          portalContainer
        )}
    </>
  );
};

interface CanvasProps {
  clinic?: Clinic;
  branch?: Branch;
}

/* =========================================================================
   SUB-CANVAS 1: RECEITUÁRIO (SIMPLES OU CONTROLE ESPECIAL ANVISA 344/98)
   ========================================================================= */
const PrescriptionCanvas: React.FC<{ prescription: Prescription } & CanvasProps> = ({
  prescription,
  clinic,
  branch,
}) => {
  const isSpecialControl = prescription.type === 'controle_especial';

  const renderSingleVia = (viaLabel: string, isRetencao: boolean, isSecondVia = false) => (
    <div
      className={`space-y-5 ${
        isSpecialControl && !isSecondVia
          ? 'border-b-2 border-dashed border-slate-300 pb-8 mb-8 print:border-b-0 print:pb-0 print:mb-0'
          : ''
      } ${isSecondVia ? 'print:break-before-page print:pt-2' : ''}`}
    >
      <MedicalDocumentHeader
        badgeTitle={isSpecialControl ? 'Controle Especial' : 'Receituário Médico'}
        badgeSubtitle={isSpecialControl ? viaLabel : 'Portaria ANVISA / CFM'}
        badgeTone="gold"
        clinic={clinic}
        branch={branch}
      />

      {/* Patient Strip */}
      <div className="medsync-break-avoid bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <span className="text-[10px] uppercase font-bold text-slate-400 block">Paciente:</span>
            <span className="font-bold text-slate-900 text-sm">{prescription.patientName}</span>
          </div>
          <div>
            <span className="text-[10px] uppercase font-bold text-slate-400 block">CPF do Paciente:</span>
            <span className="font-mono text-slate-800">{prescription.patientCpf}</span>
          </div>
        </div>
        {prescription.patientAddress && (
          <div className="mt-1 pt-1 border-t border-slate-200/60 text-[11px] text-slate-600">
            <span className="font-semibold">Endereço:</span> {prescription.patientAddress}
          </div>
        )}
      </div>

      {/* Items List */}
      <div className="space-y-4 py-2">
        <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-500 border-b border-slate-200 pb-1">
          Uso / Prescrição Medicamentosa:
        </h3>

        <div className="space-y-4 text-xs">
          {prescription.items.map((item, index) => (
            <div
              key={item.id}
              className="medsync-break-avoid pl-3 border-l-2 border-[#9A7B2C] space-y-1"
            >
              <div className="flex items-baseline justify-between font-bold text-slate-900 text-sm">
                <span>
                  {index + 1}. {item.medicineName} {item.concentration}
                </span>
                <span className="text-xs font-semibold text-slate-600 font-mono">
                  Qtd: {item.quantity}
                </span>
              </div>
              <div className="text-[11px] text-slate-600 font-medium">
                Via: <span className="font-semibold text-slate-800">{item.administrationRoute}</span> · Forma:{' '}
                {item.pharmaceuticalForm}
              </div>
              <p className="text-xs text-slate-800 leading-relaxed font-sans bg-slate-50/70 p-2 rounded">
                <strong>Posologia:</strong> {item.dosageInstruction}
              </p>
              {item.treatmentDuration && (
                <div className="text-[11px] text-slate-500 italic">
                  Duração estimada: {item.treatmentDuration}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* General Instructions */}
      {prescription.generalInstructions && (
        <div className="medsync-break-avoid p-3 bg-amber-50/60 rounded-lg border border-amber-200 text-xs text-amber-900">
          <strong className="block font-bold mb-0.5">Orientações Gerais ao Paciente / Farmácia:</strong>
          <p className="text-[11px] text-slate-700 leading-relaxed whitespace-pre-line">
            {prescription.generalInstructions}
          </p>
        </div>
      )}

      {/* Quadros de Identificação ANVISA (Portaria 344/98) para Controle Especial */}
      {isSpecialControl && isRetencao && (
        <div className="medsync-break-avoid grid grid-cols-2 gap-4 text-[10px] border border-slate-300 p-3 rounded-lg bg-slate-50/50">
          <div className="space-y-1 border-r border-slate-300 pr-3">
            <span className="font-bold text-slate-900 uppercase block border-b border-slate-200 pb-0.5">
              Identificação do Comprador (Preenchimento na Farmácia)
            </span>
            <div className="space-y-1 text-slate-600 pt-1">
              <p>Nome: __________________________________________________</p>
              <p>Identidade / RG: __________________ Órgão Emissor: _______</p>
              <p>Endereço: _______________________________________________</p>
              <p>Cidade: __________________________ UF: _____ Fone: ______</p>
              <div className="pt-4 text-center">
                <p>_______________________________________________________</p>
                <span className="text-[9px]">Assinatura do Comprador</span>
              </div>
            </div>
          </div>

          <div className="space-y-1 pl-1">
            <span className="font-bold text-slate-900 uppercase block border-b border-slate-200 pb-0.5">
              Identificação do Fornecedor / Drogaria
            </span>
            <div className="space-y-1 text-slate-600 pt-1">
              <p>Farmácia / Drogaria: _____________________________________</p>
              <p>Data de Atendimento: _____ / _____ / 2026</p>
              <p>Farmacêutico Responsável: ________________________________</p>
              <p>CRF: __________________ Assinatura: _____________________</p>
              <div className="pt-3 text-[9px] text-slate-400 italic">
                * Conforme Portaria SVS/MS nº 344/98 e RDC ANVISA nº 58/2014. Válido por 30 dias.
              </div>
            </div>
          </div>
        </div>
      )}

      <MedicalDocumentFooter
        dateLabel="Data de Emissão"
        dateValue={new Date(prescription.prescriptionDate + 'T00:00:00').toLocaleDateString('pt-BR')}
        extraLeftText={`Validade da Receita: ${prescription.validityDays} dias a contar da emissão`}
        signatureHash={prescription.signatureHash}
        roleSubtitle="Médico Responsável"
        professionalName={prescription.professionalName}
        professionalCouncil={prescription.professionalCouncil}
        cityState={branch ? `${branch.city} - ${branch.state}` : undefined}
        clinicLegalName={clinic?.legalName || clinic?.tradeName}
      />
    </div>
  );

  return (
    <div className="space-y-6 print:space-y-0">
      {renderSingleVia(
        isSpecialControl ? '1ª Via - Retenção da Farmácia / Drogaria' : 'Via Única do Paciente',
        true,
        false
      )}

      {isSpecialControl && renderSingleVia('2ª Via - Orientação do Paciente', false, true)}
    </div>
  );
};

/* =========================================================================
   SUB-CANVAS 2: ATESTADO MÉDICO COM CONTROLE ESTATUTÁRIO DE CID-10 (CFM)
   ========================================================================= */
const CertificateCanvas: React.FC<{ certificate: MedicalCertificate } & CanvasProps> = ({
  certificate,
  clinic,
  branch,
}) => {
  const getCertificateTitle = () => {
    switch (certificate.type) {
      case 'afastamento':
        return 'Atestado Médico de Afastamento';
      case 'aptidao_fisica':
        return 'Atestado de Aptidão Física';
      case 'comparecimento':
        return 'Declaração de Comparecimento';
      case 'acompanhante':
        return 'Atestado de Acompanhante';
      default:
        return 'Atestado Médico';
    }
  };

  return (
    <div className="flex flex-col justify-between h-full min-h-[235mm] print:h-auto print:min-h-0 space-y-8">
      <MedicalDocumentHeader
        badgeTitle="Documento Médico Oficial"
        badgeSubtitle="Resoluções CFM nº 1.658/2002 e 1.819/2007"
        badgeTone="gold"
        clinic={clinic}
        branch={branch}
      />

      {/* Title */}
      <div className="text-center py-4">
        <h2 className="text-2xl font-black text-slate-900 uppercase tracking-wide border-b-2 border-[#D4AF37]/60 inline-block pb-1">
          {getCertificateTitle()}
        </h2>
      </div>

      {/* Formal Text Body */}
      <div className="space-y-6 text-sm text-slate-800 leading-relaxed font-serif px-2 sm:px-6 print:px-2">
        {certificate.type === 'afastamento' && (
          <p className="indent-8 text-justify">
            Atesto, para os devidos fins legais, periciais ou trabalhistas, que o(a) Sr.(a){' '}
            <strong>{certificate.patientName}</strong>, portador(a) do CPF nº{' '}
            <strong>{certificate.patientCpf}</strong>, esteve sob meus cuidados profissionais nesta data, necessitando de{' '}
            <strong>
              {certificate.daysOff || 1} ({certificate.daysOff === 1 ? 'um' : certificate.daysOff}) dia(s)
            </strong>{' '}
            de afastamento de suas atividades rotineiras e laborais a contar de{' '}
            <strong>
              {certificate.startDate
                ? new Date(certificate.startDate + 'T00:00:00').toLocaleDateString('pt-BR')
                : new Date().toLocaleDateString('pt-BR')}
            </strong>
            , para recuperação clínica.
          </p>
        )}

        {certificate.type === 'comparecimento' && (
          <p className="indent-8 text-justify">
            Declaro, para os devidos fins de comprovação, que o(a) Sr.(a){' '}
            <strong>{certificate.patientName}</strong>, inscrito(a) no CPF nº{' '}
            <strong>{certificate.patientCpf}</strong>, compareceu a esta clínica médica nesta data para realização de
            consulta médica e avaliação diagnóstica, no período compreendido entre{' '}
            <strong>{certificate.hoursOff || '08:30 e 11:30'}</strong>.
          </p>
        )}

        {certificate.type === 'aptidao_fisica' && (
          <p className="indent-8 text-justify">
            Atesto que o(a) paciente <strong>{certificate.patientName}</strong>, portador(a) do CPF nº{' '}
            <strong>{certificate.patientCpf}</strong>, foi submetido(a) a avaliação clínica e metabólica nesta data,
            encontrando-se apto(a) para a realização de:{' '}
            <strong>
              {certificate.activityPermitted ||
                'atividades físicas supervisionadas, musculação e exercícios resistidos funcionais'}
            </strong>
            .
          </p>
        )}

        {certificate.type === 'acompanhante' && (
          <p className="indent-8 text-justify">
            Atesto que o(a) Sr.(a) <strong>{certificate.companionName || 'Acompanhante Legal'}</strong> esteve nesta
            unidade de saúde acompanhando o(a) paciente <strong>{certificate.patientName}</strong> (CPF:{' '}
            {certificate.patientCpf}) durante atendimento médico realizado nesta data.
          </p>
        )}

        {certificate.periodDescription && (
          <p className="indent-8 text-justify text-slate-700">{certificate.periodDescription}</p>
        )}

        {/* Regra Legal do CID-10 (Resolução CFM nº 1.658/2002) */}
        {certificate.showCidOnPrint && certificate.cid10Code ? (
          <div className="medsync-break-avoid p-4 bg-slate-50 border border-slate-300 rounded-lg text-xs space-y-2 font-sans">
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-900">
                Classificação Estatística Internacional de Doenças (CID-10):
              </span>
              <span className="px-2.5 py-0.5 bg-slate-900 text-white font-mono font-bold rounded text-xs">
                {certificate.cid10Code}
              </span>
            </div>
            {certificate.cid10Description && (
              <p className="text-slate-600 italic">Descrição: {certificate.cid10Description}</p>
            )}

            <div className="mt-3 pt-3 border-t border-slate-200 text-[11px] text-slate-700 space-y-3">
              <p className="text-justify font-sans">
                <strong>
                  Termo de Autorização Expressa do Paciente (Resolução CFM nº 1.658/2002 e CFM nº 1.819/2007):
                </strong>
                <br />
                Declaro que solicitei formalmente e autorizo de forma expressa a inclusão do código da CID-10 no
                presente atestado médico, ciente de que tal informação goza de sigilo médico profissional garantido
                pelo Código de Ética Médica e pela legislação brasileira.
              </p>

              <div className="pt-4 flex justify-end">
                <div className="text-center w-72">
                  <div className="border-b border-slate-700 pb-1 mb-1"></div>
                  <span className="text-[10px] uppercase font-bold text-slate-600 block">
                    Assinatura / Concordância do Paciente: {certificate.patientName}
                  </span>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="medsync-break-avoid p-3 bg-slate-50 border border-slate-200 rounded-lg text-[11px] text-slate-500 font-sans italic">
            * O código de diagnóstico (CID-10) foi omitido deste atestado em estrito cumprimento ao sigilo médico
            profissional (Resolução CFM nº 1.658/2002), permanecendo devidamente assentado no Prontuário Eletrônico do
            Paciente.
          </div>
        )}
      </div>

      <div className="px-2 sm:px-6 print:px-2">
        <MedicalDocumentFooter
          dateLabel="Emissão"
          dateValue={new Date(certificate.issueDate + 'T00:00:00').toLocaleDateString('pt-BR', {
            day: '2-digit',
            month: 'long',
            year: 'numeric',
          })}
          signatureHash={certificate.signatureHash}
          useLockIcon
          roleSubtitle="Carimbo e Assinatura Médica"
          professionalName={certificate.professionalName}
          professionalCouncil={certificate.professionalCouncil}
          cityState={branch ? `${branch.city} - ${branch.state}` : undefined}
          clinicLegalName={clinic?.legalName || clinic?.tradeName}
        />
      </div>
    </div>
  );
};

/* =========================================================================
   SUB-CANVAS 3: PEDIDO DE EXAMES (COM JUSTIFICATIVA CLÍNICA PARA CONVÊNIOS)
   ========================================================================= */
const LabOrderCanvas: React.FC<{ order: LabOrder } & CanvasProps> = ({
  order,
  clinic,
  branch,
}) => {
  return (
    <div className="flex flex-col justify-between h-full min-h-[235mm] print:h-auto print:min-h-0 space-y-6">
      <MedicalDocumentHeader
        badgeTitle="Solicitação de Exames"
        badgeSubtitle="Laboratoriais & Diagnósticos por Imagem"
        badgeTone="gold"
        clinic={clinic}
        branch={branch}
      />

      {/* Patient Strip */}
      <div className="medsync-break-avoid bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs grid grid-cols-2 gap-2">
        <div>
          <span className="text-[10px] uppercase font-bold text-slate-400 block">Paciente:</span>
          <span className="font-bold text-slate-900 text-sm">{order.patientName}</span>
        </div>
        <div>
          <span className="text-[10px] uppercase font-bold text-slate-400 block">CPF:</span>
          <span className="font-mono text-slate-800">{order.patientCpf}</span>
        </div>
      </div>

      {/* Justificativa Clínica */}
      <div className="medsync-break-avoid p-3 bg-sky-50/60 rounded-lg border border-sky-200 text-xs space-y-1">
        <span className="font-bold text-sky-900 block uppercase text-[10px] tracking-wider">
          Indicação / Justificativa Clínica (Exigência CFM & ANS):
        </span>
        <p className="text-slate-800 font-medium leading-relaxed">{order.clinicalIndication}</p>
      </div>

      {/* List of Exams */}
      <div className="space-y-3 py-2 flex-1 print:flex-none">
        <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-500 border-b border-slate-200 pb-1">
          Exames Solicitados ({order.items.length}):
        </h3>

        <div className={order.items.length > 8 ? 'space-y-1.5 text-xs' : 'space-y-3 text-xs'}>
          {order.items.map((item, index) => (
            <div
              key={item.id}
              className={`medsync-break-avoid rounded-lg border border-slate-200 bg-white flex items-start justify-between gap-3 ${
                order.items.length > 8 ? 'px-3 py-2' : 'p-3'
              }`}
            >
              <div className="space-y-0.5">
                <div className="font-bold text-slate-900 text-sm flex items-center gap-2">
                  <span>
                    {index + 1}. {item.examName}
                  </span>
                  {item.urgency === 'urgente' && (
                    <span className="text-[10px] font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded border border-rose-200 uppercase">
                      Urgente
                    </span>
                  )}
                </div>
                {item.observations && (
                  <p className="text-[11px] text-slate-600 italic">
                    Instrução de preparo: {item.observations}
                  </p>
                )}
              </div>
              <span className="text-[10px] uppercase font-semibold text-slate-500 bg-slate-100 px-2 py-1 rounded shrink-0">
                {item.examType}
              </span>
            </div>
          ))}
        </div>
      </div>

      {order.notes && (
        <div className="medsync-break-avoid p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs text-slate-600">
          <strong>Observações Adicionais:</strong> {order.notes}
        </div>
      )}

      <MedicalDocumentFooter
        dateLabel="Data de Solicitação"
        dateValue={new Date(order.orderDate + 'T00:00:00').toLocaleDateString('pt-BR')}
        signatureHash={order.signatureHash}
        roleSubtitle="Médico Solicitante"
        professionalName={order.professionalName}
        professionalCouncil={order.professionalCouncil}
        cityState={branch ? `${branch.city} - ${branch.state}` : undefined}
        clinicLegalName={clinic?.legalName || clinic?.tradeName}
      />
    </div>
  );
};

/* =========================================================================
   SUB-CANVAS 4: EVOLUÇÃO CLÍNICA / RELATÓRIO DE PRONTUÁRIO (PEP CFM)
   ========================================================================= */
const MedicalRecordCanvas: React.FC<{
  record: MedicalRecordEntry;
  patientName?: string;
  patientCpf?: string;
} & CanvasProps> = ({ record, patientName, patientCpf, clinic, branch }) => {
  return (
    <div className="flex flex-col justify-between h-full min-h-[235mm] print:h-auto print:min-h-0 space-y-6">
      <MedicalDocumentHeader
        badgeTitle="Evolução Clínica (PEP)"
        badgeSubtitle="Resoluções CFM nº 1.638/2002 e 1.821/2007"
        badgeTone="gold"
        clinic={clinic}
        branch={branch}
      />

      {/* Patient & Attendance Strip */}
      <div className="medsync-break-avoid bg-slate-50 p-3.5 rounded-lg border border-slate-200 text-xs grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div>
          <span className="text-[10px] uppercase font-bold text-slate-400 block">Paciente:</span>
          <span className="font-bold text-slate-900 text-sm">
            {patientName || 'Paciente Registrado no PEP'}
          </span>
        </div>
        <div>
          <span className="text-[10px] uppercase font-bold text-slate-400 block">CPF:</span>
          <span className="font-mono text-slate-800">{patientCpf || 'Conforme Prontuário'}</span>
        </div>
        <div>
          <span className="text-[10px] uppercase font-bold text-slate-400 block">Data/Hora Atendimento:</span>
          <span className="font-semibold text-slate-800">
            {new Date(record.recordDate).toLocaleString('pt-BR')}
          </span>
        </div>
      </div>

      {/* Vital Signs */}
      {record.vitalSigns && (
        <div className="medsync-break-avoid p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs flex flex-wrap gap-4">
          <span className="font-bold text-slate-800 uppercase text-[10px] tracking-wider w-full border-b border-slate-200 pb-1">
            Sinais Vitais & Antropometria
          </span>
          {record.vitalSigns.bloodPressureSystolic && (
            <span>
              <strong>PA:</strong> {record.vitalSigns.bloodPressureSystolic}/
              {record.vitalSigns.bloodPressureDiastolic} mmHg
            </span>
          )}
          {record.vitalSigns.heartRateBpm && (
            <span>
              <strong>FC:</strong> {record.vitalSigns.heartRateBpm} bpm
            </span>
          )}
          {record.vitalSigns.temperatureCelsius && (
            <span>
              <strong>Temp:</strong> {record.vitalSigns.temperatureCelsius} °C
            </span>
          )}
          {record.vitalSigns.oxygenSaturationPercent && (
            <span>
              <strong>SpO2:</strong> {record.vitalSigns.oxygenSaturationPercent}%
            </span>
          )}
          {record.vitalSigns.weightKg && (
            <span>
              <strong>Peso:</strong> {record.vitalSigns.weightKg} kg
            </span>
          )}
          {record.vitalSigns.heightCm && (
            <span>
              <strong>Altura:</strong> {record.vitalSigns.heightCm} cm
            </span>
          )}
          {record.vitalSigns.bmi && (
            <span>
              <strong>IMC:</strong> {record.vitalSigns.bmi} kg/m²
            </span>
          )}
        </div>
      )}

      {/* SOAP Sections */}
      <div className="space-y-4 flex-1 print:flex-none text-xs">
        <div className="medsync-break-avoid p-3.5 rounded-lg border border-slate-200 space-y-1">
          <span className="font-bold text-slate-900 uppercase text-[10px] tracking-wider block">
            S — Subjetivo / Queixa Principal e Anamnese
          </span>
          <p className="text-slate-800 whitespace-pre-line leading-relaxed">{record.chiefComplaint}</p>
          {record.clinicalHistory && (
            <p className="text-slate-600 whitespace-pre-line leading-relaxed pt-1 border-t border-slate-100">
              {record.clinicalHistory}
            </p>
          )}
        </div>

        {record.physicalExam && (
          <div className="medsync-break-avoid p-3.5 rounded-lg border border-slate-200 space-y-1">
            <span className="font-bold text-slate-900 uppercase text-[10px] tracking-wider block">
              O — Exame Físico e Achados Objetivos
            </span>
            <p className="text-slate-700 whitespace-pre-line leading-relaxed">{record.physicalExam}</p>
          </div>
        )}

        <div className="medsync-break-avoid p-3.5 rounded-lg border border-slate-200 space-y-1.5">
          <span className="font-bold text-slate-900 uppercase text-[10px] tracking-wider block">
            A — Avaliação Clínica e Hipóteses Diagnósticas
          </span>
          <p className="text-slate-800 leading-relaxed">
            {record.diagnosticHypothesis || 'Avaliação médica ambulatorial.'}
          </p>
          {record.cid10Codes && record.cid10Codes.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {record.cid10Codes.map((cid) => (
                <span
                  key={cid.code}
                  className="px-2 py-0.5 bg-slate-100 border border-slate-300 rounded text-[11px] font-mono"
                >
                  <strong>{cid.code}</strong> · {cid.description}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="medsync-break-avoid p-3.5 rounded-lg border border-slate-200 space-y-1.5">
          <span className="font-bold text-slate-900 uppercase text-[10px] tracking-wider block">
            P — Plano Terapêutico e Condutas
          </span>
          <p className="text-slate-800 whitespace-pre-line leading-relaxed">{record.therapeuticPlan}</p>
          {record.evolutionNotes && (
            <p className="text-slate-600 italic pt-1 border-t border-slate-100">{record.evolutionNotes}</p>
          )}
        </div>

        {record.addendums && record.addendums.length > 0 && (
          <div className="medsync-break-avoid p-3.5 rounded-lg border border-amber-300 bg-amber-50/40 space-y-2">
            <span className="font-bold text-amber-900 uppercase text-[10px] tracking-wider flex items-center gap-1">
              <Lock className="w-3 h-3" />
              Adendos / Erratas (CFM nº 1.821/2007)
            </span>
            {record.addendums.map((ad) => (
              <div key={ad.id} className="text-[11px] text-slate-800 border-t border-amber-200 pt-1.5">
                <p className="font-semibold">
                  {ad.authorName} ({ad.authorCouncilNumber || CLINIC_OFFICIAL_DATA.crm}) ·{' '}
                  {new Date(ad.createdAt).toLocaleString('pt-BR')}
                </p>
                <p className="italic mt-0.5">{ad.note}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <MedicalDocumentFooter
        dateLabel="Data/Hora do Registro"
        dateValue={new Date(record.signedAt || record.recordDate).toLocaleString('pt-BR')}
        extraLeftText={
          record.isSigned
            ? 'Prontuário Eletrônico Selado (Imutável CFM nº 1.821/2007)'
            : 'Registro em Elaboração'
        }
        signatureHash={record.signatureHash}
        useLockIcon
        roleSubtitle="Médico Assistente"
        professionalName={record.professionalName}
        professionalCouncil={record.professionalCouncilNumber}
        cityState={branch ? `${branch.city} - ${branch.state}` : undefined}
        clinicLegalName={clinic?.legalName || clinic?.tradeName}
      />
    </div>
  );
};

/* =========================================================================
   SUB-CANVAS 5: RESULTADO / LAUDO DE EXAME CLÍNICO
   ========================================================================= */
const ExamResultCanvas: React.FC<{
  result: ExamResult;
  patientName?: string;
  patientCpf?: string;
} & CanvasProps> = ({ result, patientName, patientCpf, clinic, branch }) => {
  return (
    <div className="flex flex-col justify-between h-full min-h-[235mm] print:h-auto print:min-h-0 space-y-6">
      <MedicalDocumentHeader
        badgeTitle="Laudo / Resultado de Exame"
        badgeSubtitle="Registro Integrado ao Prontuário (PEP)"
        badgeTone="gold"
        clinic={clinic}
        branch={branch}
      />

      <div className="medsync-break-avoid bg-slate-50 p-3.5 rounded-lg border border-slate-200 text-xs grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div>
          <span className="text-[10px] uppercase font-bold text-slate-400 block">Paciente:</span>
          <span className="font-bold text-slate-900 text-sm">
            {patientName || 'Paciente Registrado no PEP'}
          </span>
        </div>
        <div>
          <span className="text-[10px] uppercase font-bold text-slate-400 block">CPF:</span>
          <span className="font-mono text-slate-800">{patientCpf || 'Conforme Prontuário'}</span>
        </div>
        <div>
          <span className="text-[10px] uppercase font-bold text-slate-400 block">Data de Realização:</span>
          <span className="font-semibold text-slate-800">
            {new Date(result.performedDate + 'T00:00:00').toLocaleDateString('pt-BR')}
          </span>
        </div>
      </div>

      <div className="space-y-4 flex-1 print:flex-none text-xs">
        <div className="medsync-break-avoid p-4 rounded-lg border border-slate-200 bg-white space-y-2">
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400 block">Exame Avaliado</span>
              <h3 className="text-base font-extrabold text-slate-900">{result.examName}</h3>
            </div>
            <span
              className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase ${
                result.status === 'critical'
                  ? 'bg-rose-100 text-rose-800 border border-rose-200'
                  : 'bg-teal-100 text-teal-800 border border-teal-200'
              }`}
            >
              {result.status === 'critical'
                ? 'Alterado / Crítico'
                : result.status === 'evaluated'
                  ? 'Avaliado pelo Médico'
                  : 'Realizado'}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 text-[11px] text-slate-600">
            <div>
              <strong>Categoria:</strong> <span className="uppercase">{result.examCategory}</span>
            </div>
            <div>
              <strong>Laboratório / Executante:</strong> {result.laboratoryName || 'Não informado'}
            </div>
          </div>
        </div>

        <div className="medsync-break-avoid p-4 rounded-lg border border-slate-200 bg-slate-50/70 space-y-1.5">
          <span className="font-bold text-slate-900 uppercase text-[10px] tracking-wider block">
            Conclusão do Laudo / Valores Encontrados
          </span>
          <p className="text-slate-800 whitespace-pre-line leading-relaxed">{result.reportSummary}</p>
        </div>

        {result.referenceValues && (
          <div className="medsync-break-avoid p-3.5 rounded-lg border border-slate-200 space-y-1">
            <span className="font-bold text-slate-900 uppercase text-[10px] tracking-wider block">
              Valores de Referência / Notas Técnicas
            </span>
            <p className="text-slate-700 leading-relaxed">{result.referenceValues}</p>
          </div>
        )}

        {result.notes && (
          <div className="medsync-break-avoid p-3.5 rounded-lg border border-slate-200 space-y-1">
            <span className="font-bold text-slate-900 uppercase text-[10px] tracking-wider block">
              Observações Clínicas
            </span>
            <p className="text-slate-700 italic leading-relaxed">{result.notes}</p>
          </div>
        )}
      </div>

      <MedicalDocumentFooter
        dateLabel="Data da Avaliação"
        dateValue={new Date(result.evaluatedAt || result.createdAt).toLocaleDateString('pt-BR')}
        extraLeftText={
          result.attachmentFilename
            ? `Arquivo vinculado no PEP: ${result.attachmentFilename}`
            : 'Documento impresso a partir do Prontuário Eletrônico do Paciente'
        }
        roleSubtitle="Médico Responsável pela Análise"
        professionalName={result.evaluatedByProfessionalName || CLINIC_OFFICIAL_DATA.physicianName}
        cityState={branch ? `${branch.city} - ${branch.state}` : undefined}
        clinicLegalName={clinic?.legalName || clinic?.tradeName}
      />
    </div>
  );
};

/* =========================================================================
   SUB-CANVAS 6: RECIBO FINANCEIRO DE HONORÁRIOS MÉDICOS
   ========================================================================= */
const FinancialReceiptCanvas: React.FC<{
  transaction: FinancialTransaction;
  patientName?: string;
  patientCpf?: string;
} & CanvasProps> = ({ transaction, patientName, patientCpf, clinic, branch }) => {
  const displayPatient = patientName || transaction.patientName || 'Cliente / Paciente';
  const displayLegalName = clinic?.legalName || clinic?.tradeName || CLINIC_OFFICIAL_DATA.legalName;
  const displayCnpj = branch?.documentNumber || clinic?.documentNumber || CLINIC_OFFICIAL_DATA.cnpj;
  const displayPhone = branch?.phone || clinic?.phone || CLINIC_OFFICIAL_DATA.phone;
  const displayPhysician = transaction.professionalName || CLINIC_OFFICIAL_DATA.physicianName;
  const receiptDate = transaction.paidAt || transaction.createdAt;

  return (
    <div className="flex flex-col justify-between h-full min-h-[235mm] print:h-auto print:min-h-0 space-y-6">
      <MedicalDocumentHeader
        badgeTitle="Recibo de Honorários Médicos"
        badgeSubtitle={`Nº ${transaction.receiptNumber || transaction.id.slice(0, 8).toUpperCase()}`}
        badgeTone="gold"
        clinic={clinic}
        branch={branch}
      />

      <div className="space-y-5 flex-1 print:flex-none text-xs">
        <div className="medsync-break-avoid p-5 bg-slate-50 rounded-xl border border-slate-200 space-y-4">
          <p className="text-slate-800 leading-relaxed text-sm">
            Recebemos de <strong className="text-slate-900">{displayPatient}</strong>
            {patientCpf ? (
              <>
                {' '}(CPF: <span className="font-mono">{patientCpf}</span>)
              </>
            ) : null}{' '}
            a importância de{' '}
            <strong className="text-emerald-800 text-base tabular-nums">
              R$ {transaction.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </strong>{' '}
            referente aos serviços médicos prestados por{' '}
            <strong className="text-slate-900">{displayPhysician}</strong> junto à pessoa jurídica{' '}
            <strong className="text-slate-900">{displayLegalName}</strong> (CNPJ:{' '}
            <span className="font-mono">{displayCnpj}</span>).
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-4 border-t border-slate-200">
            <div>
              <span className="text-slate-500 block text-[11px]">Número do Recibo</span>
              <span className="font-mono font-bold text-slate-900">
                {transaction.receiptNumber || transaction.id}
              </span>
            </div>
            <div>
              <span className="text-slate-500 block text-[11px]">Data do Pagamento / Emissão</span>
              <span className="font-semibold text-slate-900">
                {new Date(receiptDate).toLocaleDateString('pt-BR')}
              </span>
            </div>
            <div>
              <span className="text-slate-500 block text-[11px]">Serviço / Procedimento</span>
              <span className="font-semibold text-slate-900">{transaction.description}</span>
            </div>
            <div>
              <span className="text-slate-500 block text-[11px]">Forma de Pagamento</span>
              <span className="uppercase font-semibold text-slate-900">
                {transaction.paymentMethod}
                {transaction.installments && transaction.installments > 1
                  ? ` (${transaction.installments}x)`
                  : ' (À vista)'}
              </span>
            </div>
            <div>
              <span className="text-slate-500 block text-[11px]">Unidade de Atendimento</span>
              <span className="font-medium text-slate-800">
                {branch?.name || transaction.branchName || 'Unidade'}
              </span>
            </div>
            <div>
              <span className="text-slate-500 block text-[11px]">Situação</span>
              <span className="font-extrabold text-emerald-700">
                {transaction.status === 'paid'
                  ? `QUITADO · R$ ${transaction.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
                  : transaction.status === 'pending'
                    ? 'PENDENTE DE QUITAÇÃO'
                    : 'CANCELADO'}
              </span>
            </div>
          </div>
        </div>

        <p className="text-[11px] text-slate-500 text-center italic">
          Recibo válido para fins de comprovação de despesas médicas (IRPF) e solicitação de reembolso junto a operadoras de saúde.
        </p>
      </div>

      <MedicalDocumentFooter
        dateLabel="Emissão"
        dateValue={new Date(receiptDate).toLocaleDateString('pt-BR')}
        extraLeftText={`CNPJ ${displayCnpj} · ${displayPhone}`}
        roleSubtitle="Médico Responsável Técnico"
        professionalName={displayPhysician}
        cityState={branch ? `${branch.city} - ${branch.state}` : undefined}
        clinicLegalName={displayLegalName}
      />
    </div>
  );
};
