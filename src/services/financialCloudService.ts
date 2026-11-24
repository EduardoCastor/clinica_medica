import {
  Appointment,
  AppointmentStatus,
  FinancialCategory,
  FinancialOriginType,
  FinancialPaymentMethod,
  FinancialTransaction,
  FinancialTransactionType,
  Service,
} from '../types';
import { getSupabase } from './supabaseClient';
import { StorageService } from './storage';
import {
  getSaoPauloTodayYmd,
  normalizeCategoryName,
  normalizeDateToSaoPauloYmd,
} from './financialDateUtils';

export const isUuid = (val?: string | null): val is string =>
  Boolean(
    val &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val.trim())
  );

function extractJoin(val: unknown): Record<string, unknown> | null {
  if (!val) return null;
  if (Array.isArray(val)) return (val[0] as Record<string, unknown>) || null;
  if (typeof val === 'object') return val as Record<string, unknown>;
  return null;
}

async function resolveOrgId(hintOrgId?: string): Promise<string | undefined> {
  if (isUuid(hintOrgId)) return hintOrgId;
  const cachedOrg = StorageService.getOrganization();
  if (isUuid(cachedOrg.id)) return cachedOrg.id;

  const supabase = getSupabase();
  if (!supabase) return undefined;

  const { data } = await supabase.from('organizations').select('id').limit(1).maybeSingle();
  return data?.id ? String(data.id) : undefined;
}

async function resolveCurrentAuthUserId(): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getUser();
    return data?.user?.id && isUuid(data.user.id) ? data.user.id : null;
  } catch {
    return null;
  }
}

function mapPaymentMethod(raw: unknown): FinancialPaymentMethod {
  const method = String(raw || 'pix');
  if (
    method === 'pix' ||
    method === 'credit_card' ||
    method === 'debit_card' ||
    method === 'cash' ||
    method === 'transfer' ||
    method === 'boleto'
  ) {
    return method;
  }
  return 'transfer';
}

function mapStatus(raw: unknown): FinancialTransaction['status'] {
  const st = String(raw || 'pending');
  if (st === 'paid' || st === 'pending' || st === 'cancelled') return st;
  if (st === 'refunded') return 'cancelled';
  return 'pending';
}

function mapOriginType(
  raw: unknown,
  txType: FinancialTransactionType,
  appointmentId?: string,
  serviceId?: string
): FinancialOriginType {
  const str = String(raw || '');
  if (str === 'appointment' || str === 'treatment' || str === 'manual' || str === 'expense') {
    return str;
  }
  if (appointmentId) return 'appointment';
  if (serviceId && txType === 'receivable') return 'treatment';
  if (txType === 'payable') return 'expense';
  return 'manual';
}

function mapFinancialRow(
  row: Record<string, unknown>,
  lookups: {
    branches: ReturnType<typeof StorageService.getBranches>;
    professionals: ReturnType<typeof StorageService.getProfessionals>;
    categoriesById?: Map<string, FinancialCategory>;
    servicesById?: Map<string, Service>;
  },
  fallbackOrgId?: string
): FinancialTransaction {
  const patientJoin = extractJoin(row.patient);
  const profJoin = extractJoin(row.professional);
  const branchJoin = extractJoin(row.branch);
  const categoryJoin = extractJoin(row.category);
  const serviceJoin = extractJoin(row.service);

  const branchId = String(row.branch_id || '');
  const profId = row.professional_id ? String(row.professional_id) : undefined;
  const catId = row.category_id ? String(row.category_id) : undefined;
  const srvId = row.service_id ? String(row.service_id) : undefined;
  const aptId = row.appointment_id ? String(row.appointment_id) : undefined;

  const branchObj = lookups.branches.find((b) => b.id === branchId);
  const profObj = profId ? lookups.professionals.find((p) => p.id === profId) : undefined;
  const catObj = catId ? lookups.categoriesById?.get(catId) : undefined;
  const srvObj = srvId ? lookups.servicesById?.get(srvId) : undefined;

  const txType: FinancialTransactionType =
    row.transaction_type === 'payable' ? 'payable' : 'receivable';
  const status = mapStatus(row.status);
  const createdAt = String(row.created_at || new Date().toISOString());
  const issueDate =
    normalizeDateToSaoPauloYmd(row.issue_date ? String(row.issue_date) : undefined) ||
    normalizeDateToSaoPauloYmd(createdAt) ||
    getSaoPauloTodayYmd();
  const dueDate =
    normalizeDateToSaoPauloYmd(row.due_date ? String(row.due_date) : undefined) || issueDate;

  const rawPaymentDate = row.payment_date
    ? normalizeDateToSaoPauloYmd(String(row.payment_date))
    : row.paid_at && status === 'paid'
      ? normalizeDateToSaoPauloYmd(String(row.paid_at))
      : undefined;

  const resolvedCategoryName =
    (categoryJoin?.name ? String(categoryJoin.name) : undefined) ||
    (row.category_name ? String(row.category_name) : undefined) ||
    catObj?.name;

  const resolvedTreatmentName =
    (row.treatment_name ? String(row.treatment_name) : undefined) ||
    (serviceJoin?.name ? String(serviceJoin.name) : undefined) ||
    srvObj?.name;

  return {
    id: String(row.id),
    organizationId: String(row.organization_id || fallbackOrgId || ''),
    branchId,
    branchName: String(branchJoin?.name || branchObj?.name || 'Unidade'),
    categoryId: catId,
    categoryName: resolvedCategoryName,
    originType: mapOriginType(row.origin_type, txType, aptId, srvId),
    patientId: row.patient_id ? String(row.patient_id) : undefined,
    patientName: patientJoin?.full_name ? String(patientJoin.full_name) : undefined,
    appointmentId: aptId,
    medicalRecordId: row.medical_record_id ? String(row.medical_record_id) : undefined,
    professionalId: profId,
    professionalName: profJoin?.full_name
      ? String(profJoin.full_name)
      : profObj?.fullName,
    serviceId: srvId,
    treatmentName: resolvedTreatmentName,
    supplierName: row.supplier_name ? String(row.supplier_name) : undefined,
    description: String(row.description || ''),
    amount: Number(row.amount || 0),
    type: txType,
    paymentMethod: mapPaymentMethod(row.payment_method),
    installments: Math.max(1, Number(row.installments || 1)),
    status,
    issueDate,
    dueDate,
    paymentDate: status === 'paid' ? rawPaymentDate : undefined,
    paidAt: row.paid_at ? String(row.paid_at) : undefined,
    receiptNumber: row.receipt_number ? String(row.receipt_number) : undefined,
    notes: row.notes ? String(row.notes) : undefined,
    idempotencyKey: row.idempotency_key ? String(row.idempotency_key) : undefined,
    cancelledAt: row.cancelled_at ? String(row.cancelled_at) : undefined,
    cancellationReason: row.cancellation_reason
      ? String(row.cancellation_reason)
      : undefined,
    createdAt,
    updatedAt: row.updated_at ? String(row.updated_at) : undefined,
  };
}

export interface BillableAppointmentItem {
  appointment: Appointment;
  servicePrice: number;
  existingFinancialTx?: {
    id: string;
    status: FinancialTransaction['status'];
    amount: number;
    receiptNumber?: string;
  };
}

export const FinancialCloudService = {
  fetchServicesFromCloud: async (
    organizationId?: string
  ): Promise<{ services: Service[]; error?: string }> => {
    const supabase = getSupabase();
    if (!supabase) {
      return { services: [], error: 'Conexão com o Supabase não configurada neste ambiente.' };
    }

    try {
      const orgId = await resolveOrgId(organizationId);
      let query = supabase
        .from('services')
        .select('*')
        .eq('is_active', true)
        .order('name', { ascending: true });

      if (orgId) {
        query = query.eq('organization_id', orgId);
      }

      const { data, error } = await query;
      if (error) {
        return {
          services: [],
          error:
            error.code === '42501'
              ? 'Sem permissão para consultar catálogo de serviços/tratamentos (RLS).'
              : error.message,
        };
      }

      const mapped: Service[] = ((data || []) as Array<Record<string, unknown>>).map((s) => ({
        id: String(s.id),
        organizationId: String(s.organization_id || orgId || ''),
        name: String(s.name || ''),
        durationMinutes: Number(s.duration_minutes || 50),
        price: Number(s.price || 0),
        description: s.description ? String(s.description) : undefined,
        specialtyId: s.specialty_id ? String(s.specialty_id) : undefined,
        isActive: s.is_active !== false,
      }));

      if (mapped.length > 0) {
        mapped.forEach((srv) => StorageService.saveService(srv));
      }

      return { services: mapped };
    } catch (err) {
      return {
        services: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },

  fetchFinancialCategoriesFromCloud: async (
    organizationId?: string,
    categoryType?: FinancialTransactionType
  ): Promise<{ categories: FinancialCategory[]; error?: string }> => {
    const supabase = getSupabase();
    if (!supabase) {
      return { categories: [], error: 'Conexão com o Supabase não configurada neste ambiente.' };
    }

    try {
      const orgId = await resolveOrgId(organizationId);
      let query = supabase
        .from('financial_categories')
        .select('*')
        .order('name', { ascending: true });

      if (orgId) query = query.eq('organization_id', orgId);
      if (categoryType) query = query.eq('category_type', categoryType);

      let { data, error } = await query;

      if (!error && (!data || data.length === 0) && orgId) {
        await supabase.rpc('medsync_seed_default_financial_categories', { p_org_id: orgId });
        const retry = await supabase
          .from('financial_categories')
          .select('*')
          .eq('organization_id', orgId)
          .order('name', { ascending: true });
        if (!retry.error && retry.data) {
          data = categoryType
            ? retry.data.filter((r) => r.category_type === categoryType)
            : retry.data;
        }
      }

      if (error) {
        return {
          categories: [],
          error:
            error.code === '42501'
              ? 'Sem permissão para consultar categorias financeiras (RLS).'
              : error.message,
        };
      }

      const mapped: FinancialCategory[] = ((data || []) as Array<Record<string, unknown>>).map(
        (row) => ({
          id: String(row.id),
          organizationId: String(row.organization_id || orgId || ''),
          name: String(row.name || ''),
          normalizedName: String(row.normalized_name || normalizeCategoryName(String(row.name || ''))),
          categoryType: row.category_type === 'payable' ? 'payable' : 'receivable',
          isActive: row.is_active !== false,
          createdAt: String(row.created_at || new Date().toISOString()),
          updatedAt: row.updated_at ? String(row.updated_at) : undefined,
        })
      );

      return { categories: mapped };
    } catch (err) {
      return {
        categories: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },

  saveFinancialCategoryToCloud: async (input: {
    id?: string;
    organizationId?: string;
    name: string;
    categoryType: FinancialTransactionType;
    isActive?: boolean;
  }): Promise<{ success: boolean; category?: FinancialCategory; error?: string }> => {
    const supabase = getSupabase();
    if (!supabase) {
      return { success: false, error: 'Conexão com o Supabase não configurada.' };
    }

    const cleanName = input.name.trim();
    if (!cleanName || cleanName.length < 2) {
      return { success: false, error: 'Informe um nome de categoria válido (mínimo 2 caracteres).' };
    }
    if (cleanName.length > 120) {
      return { success: false, error: 'O nome da categoria deve ter no máximo 120 caracteres.' };
    }

    const orgId = await resolveOrgId(input.organizationId);
    if (!orgId) {
      return { success: false, error: 'Organização não identificada para salvar categoria.' };
    }

    const normalizedName = normalizeCategoryName(cleanName);

    try {
      let dupQuery = supabase
        .from('financial_categories')
        .select('id, name')
        .eq('organization_id', orgId)
        .eq('category_type', input.categoryType)
        .eq('normalized_name', normalizedName)
        .limit(1);

      if (isUuid(input.id)) {
        dupQuery = dupQuery.neq('id', input.id);
      }

      const { data: existingDup } = await dupQuery.maybeSingle();
      if (existingDup) {
        return {
          success: false,
          error: `Já existe uma categoria "${existingDup.name}" cadastrada para este tipo.`,
        };
      }

      const isUpdate = isUuid(input.id);
      const { data: savedRow, error } = isUpdate
        ? await supabase
            .from('financial_categories')
            .update({
              name: cleanName,
              normalized_name: normalizedName,
              is_active: input.isActive !== false,
            })
            .eq('id', input.id!)
            .select('*')
            .single()
        : await supabase
            .from('financial_categories')
            .insert({
              organization_id: orgId,
              name: cleanName,
              normalized_name: normalizedName,
              category_type: input.categoryType,
              is_active: input.isActive !== false,
            })
            .select('*')
            .single();

      if (error || !savedRow) {
        return {
          success: false,
          error:
            error?.code === '42501'
              ? 'Sem permissão para gerenciar categorias financeiras (RLS).'
              : error?.message || 'Não foi possível salvar a categoria financeira.',
        };
      }

      if (isUpdate) {
        // Sincronizar category_name nos lançamentos que usam esta categoria
        await supabase
          .from('financial_transactions')
          .update({ category_name: cleanName })
          .eq('category_id', savedRow.id);
      }

      const savedCat: FinancialCategory = {
        id: String(savedRow.id),
        organizationId: String(savedRow.organization_id || orgId),
        name: String(savedRow.name),
        normalizedName: String(savedRow.normalized_name),
        categoryType: savedRow.category_type === 'payable' ? 'payable' : 'receivable',
        isActive: savedRow.is_active !== false,
        createdAt: String(savedRow.created_at),
        updatedAt: savedRow.updated_at ? String(savedRow.updated_at) : undefined,
      };

      void StorageService.addAuditLogToCloud({
        organizationId: orgId,
        action: isUpdate ? 'update_financial_category' : 'create_financial_category',
        entity: 'Categoria Financeira',
        entityId: savedCat.id,
        details: `${savedCat.categoryType === 'receivable' ? 'Receita' : 'Despesa'}: ${savedCat.name}`,
      });

      return { success: true, category: savedCat };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },

  toggleFinancialCategoryActiveInCloud: async (
    id: string,
    isActive: boolean,
    organizationId?: string
  ): Promise<{ success: boolean; error?: string }> => {
    const supabase = getSupabase();
    if (!supabase) {
      return { success: false, error: 'Conexão com o Supabase não configurada.' };
    }
    if (!isUuid(id)) {
      return { success: false, error: 'ID de categoria inválido.' };
    }

    try {
      const { error } = await supabase
        .from('financial_categories')
        .update({ is_active: isActive })
        .eq('id', id);

      if (error) {
        return {
          success: false,
          error:
            error.code === '42501'
              ? 'Sem permissão para alterar situação da categoria (RLS).'
              : error.message,
        };
      }

      void StorageService.addAuditLogToCloud({
        organizationId,
        action: 'toggle_financial_category',
        entity: 'Categoria Financeira',
        entityId: id,
        details: isActive ? 'Categoria reativada' : 'Categoria desativada',
      });

      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },

  fetchFinancialFromCloud: async (
    branchFilterId?: string,
    organizationId?: string
  ): Promise<{ transactions: FinancialTransaction[]; error?: string }> => {
    const supabase = getSupabase();
    if (!supabase) {
      return {
        transactions: [],
        error: 'Conexão com o Supabase não configurada neste ambiente.',
      };
    }

    try {
      const orgId = await resolveOrgId(organizationId);

      let query = supabase
        .from('financial_transactions')
        .select(
          `
          *,
          patient:patients (id, full_name, document_cpf),
          professional:professionals (id, full_name),
          branch:branches (id, name),
          category:financial_categories (id, name),
          service:services (id, name)
        `
        )
        .order('due_date', { ascending: true })
        .order('created_at', { ascending: false });

      if (orgId) {
        query = query.eq('organization_id', orgId);
      }
      if (branchFilterId && branchFilterId !== 'all' && isUuid(branchFilterId)) {
        query = query.eq('branch_id', branchFilterId);
      }

      let { data, error } = await query;

      if (error) {
        let flatQuery = supabase
          .from('financial_transactions')
          .select('*')
          .order('due_date', { ascending: true })
          .order('created_at', { ascending: false });

        if (orgId) flatQuery = flatQuery.eq('organization_id', orgId);
        if (branchFilterId && branchFilterId !== 'all' && isUuid(branchFilterId)) {
          flatQuery = flatQuery.eq('branch_id', branchFilterId);
        }

        const flatRes = await flatQuery;
        data = flatRes.data;
        error = flatRes.error;
      }

      if (error) {
        return {
          transactions: [],
          error:
            error.code === '42501'
              ? 'Acesso negado ao módulo financeiro pelas políticas de segurança (RLS). Verifique suas permissões.'
              : error.message,
        };
      }

      const branches = StorageService.getBranches();
      const professionals = StorageService.getProfessionals();

      const mapped = ((data || []) as Array<Record<string, unknown>>).map((row) =>
        mapFinancialRow(row, { branches, professionals }, orgId)
      );

      if (!branchFilterId || branchFilterId === 'all') {
        mapped.forEach((tx) => StorageService.saveFinancialTransaction(tx));
      }

      return { transactions: mapped };
    } catch (err) {
      return {
        transactions: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },

  fetchFinancialTransactionByIdFromCloud: async (
    id: string
  ): Promise<{ transaction?: FinancialTransaction; error?: string }> => {
    const supabase = getSupabase();
    if (!supabase) {
      return { error: 'Conexão com o Supabase não configurada neste ambiente.' };
    }
    if (!isUuid(id)) {
      return { error: 'ID de lançamento financeiro inválido.' };
    }

    try {
      let { data, error } = await supabase
        .from('financial_transactions')
        .select(
          `
          *,
          patient:patients (id, full_name, document_cpf),
          professional:professionals (id, full_name),
          branch:branches (id, name),
          category:financial_categories (id, name),
          service:services (id, name)
        `
        )
        .eq('id', id)
        .maybeSingle();

      if (error) {
        const flat = await supabase
          .from('financial_transactions')
          .select('*')
          .eq('id', id)
          .maybeSingle();
        data = flat.data;
        error = flat.error;
      }

      if (error || !data) {
        return {
          error: error?.message || 'Lançamento financeiro não encontrado no Supabase.',
        };
      }

      const tx = mapFinancialRow(data as Record<string, unknown>, {
        branches: StorageService.getBranches(),
        professionals: StorageService.getProfessionals(),
      });

      return { transaction: tx };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },

  saveFinancialTransactionToCloud: async (
    tx: FinancialTransaction
  ): Promise<{
    success: boolean;
    duplicate?: boolean;
    transaction?: FinancialTransaction;
    error?: string;
  }> => {
    const supabase = getSupabase();
    if (!supabase) {
      return {
        success: false,
        error: 'Conexão com o Supabase não configurada neste ambiente.',
      };
    }

    if (!tx.description.trim()) {
      return { success: false, error: 'Informe a descrição do lançamento financeiro.' };
    }
    if (!Number.isFinite(Number(tx.amount)) || Number(tx.amount) <= 0) {
      return { success: false, error: 'Informe um valor financeiro maior que zero.' };
    }

    const issueDate = normalizeDateToSaoPauloYmd(tx.issueDate) || getSaoPauloTodayYmd();
    const dueDate = normalizeDateToSaoPauloYmd(tx.dueDate);
    if (!dueDate) {
      return { success: false, error: 'Informe uma data de vencimento válida.' };
    }

    const paymentDate =
      tx.status === 'paid' ? normalizeDateToSaoPauloYmd(tx.paymentDate || tx.paidAt) : undefined;
    if (tx.status === 'paid' && !paymentDate) {
      return {
        success: false,
        error: 'Informe a data de pagamento/recebimento para confirmar a quitação.',
      };
    }

    try {
      const orgId = await resolveOrgId(tx.organizationId);
      if (!orgId) {
        return {
          success: false,
          error: 'Organização não identificada para gravar o lançamento financeiro.',
        };
      }

      let branchId = isUuid(tx.branchId) ? tx.branchId : undefined;
      if (!branchId) {
        const localValid = StorageService.getBranches().find((b) => isUuid(b.id));
        if (localValid) {
          branchId = localValid.id;
        } else {
          const { data: branchRow } = await supabase
            .from('branches')
            .select('id')
            .eq('organization_id', orgId)
            .limit(1)
            .maybeSingle();
          if (branchRow?.id) branchId = String(branchRow.id);
        }
      }

      if (!branchId) {
        return {
          success: false,
          error: 'Filial válida não encontrada para gravar o lançamento financeiro.',
        };
      }

      const isUpdate = isUuid(tx.id);

      // Idempotência para cobranças automáticas / vinculadas (evitar duplicidade)
      if (!isUpdate && tx.idempotencyKey) {
        const { data: existingByKey } = await supabase
          .from('financial_transactions')
          .select('*')
          .eq('organization_id', orgId)
          .eq('idempotency_key', tx.idempotencyKey)
          .neq('status', 'cancelled')
          .limit(1)
          .maybeSingle();

        if (existingByKey) {
          const existingMapped = mapFinancialRow(existingByKey as Record<string, unknown>, {
            branches: StorageService.getBranches(),
            professionals: StorageService.getProfessionals(),
          });
          return {
            success: false,
            duplicate: true,
            transaction: existingMapped,
            error:
              'Já existe uma cobrança ativa registrada para este atendimento/tratamento (idempotência).',
          };
        }
      }

      const actorAuthId = await resolveCurrentAuthUserId();

      const payload: Record<string, unknown> = {
        organization_id: orgId,
        branch_id: branchId,
        category_id: isUuid(tx.categoryId) ? tx.categoryId : null,
        category_name: tx.categoryName?.trim() || null,
        origin_type:
          tx.originType ||
          (tx.appointmentId
            ? 'appointment'
            : tx.serviceId && tx.type === 'receivable'
              ? 'treatment'
              : tx.type === 'payable'
                ? 'expense'
                : 'manual'),
        patient_id: isUuid(tx.patientId) ? tx.patientId : null,
        appointment_id: isUuid(tx.appointmentId) ? tx.appointmentId : null,
        medical_record_id: isUuid(tx.medicalRecordId) ? tx.medicalRecordId : null,
        professional_id: isUuid(tx.professionalId) ? tx.professionalId : null,
        service_id: isUuid(tx.serviceId) ? tx.serviceId : null,
        treatment_name: tx.treatmentName?.trim() || null,
        supplier_name: tx.type === 'payable' ? tx.supplierName?.trim() || null : null,
        description: tx.description.trim(),
        amount: Number(Number(tx.amount).toFixed(2)),
        transaction_type: tx.type,
        payment_method: tx.paymentMethod,
        installments: Math.max(1, Number(tx.installments || 1)),
        status: tx.status,
        issue_date: issueDate,
        due_date: dueDate,
        payment_date: tx.status === 'paid' ? paymentDate : null,
        paid_at: tx.status === 'paid' ? `${paymentDate}T12:00:00-03:00` : null,
        receipt_number: tx.receiptNumber?.trim() || null,
        notes: tx.notes?.trim() || null,
        idempotency_key: tx.idempotencyKey?.trim() || null,
        updated_by: actorAuthId,
      };

      if (!isUpdate) {
        payload.created_by = actorAuthId;
      }

      if (tx.status === 'cancelled') {
        payload.cancelled_at = tx.cancelledAt || new Date().toISOString();
        payload.cancellation_reason = tx.cancellationReason?.trim() || 'Cancelado pelo usuário';
      } else {
        payload.cancelled_at = null;
        payload.cancellation_reason = null;
      }

      const { data: savedRow, error } = isUpdate
        ? await supabase
            .from('financial_transactions')
            .update(payload)
            .eq('id', tx.id)
            .select('*')
            .single()
        : await supabase
            .from('financial_transactions')
            .insert(payload)
            .select('*')
            .single();

      if (error || !savedRow) {
        if (error?.code === '23505') {
          return {
            success: false,
            duplicate: true,
            error:
              'Já existe um lançamento financeiro ativo correspondente a este registro (duplicidade bloqueada).',
          };
        }
        return {
          success: false,
          error:
            error?.code === '42501'
              ? 'Sem permissão para gravar lançamento financeiro nesta filial (RLS).'
              : error?.message || 'Não foi possível salvar o lançamento financeiro no Supabase.',
        };
      }

      const savedTx = mapFinancialRow(savedRow as Record<string, unknown>, {
        branches: StorageService.getBranches(),
        professionals: StorageService.getProfessionals(),
      });
      const enrichedTx: FinancialTransaction = {
        ...tx,
        ...savedTx,
        patientName: tx.patientName || savedTx.patientName,
        professionalName: tx.professionalName || savedTx.professionalName,
        branchName: tx.branchName || savedTx.branchName,
        categoryName: tx.categoryName || savedTx.categoryName,
      };

      StorageService.saveFinancialTransaction(enrichedTx);

      void StorageService.addAuditLogToCloud({
        organizationId: orgId,
        action: isUpdate ? 'update_financial' : 'create_financial',
        entity: enrichedTx.type === 'payable' ? 'Contas a Pagar' : 'Contas a Receber',
        entityId: enrichedTx.id,
        details: `${enrichedTx.description} - R$ ${enrichedTx.amount.toFixed(2)} (${enrichedTx.status})`,
      });

      return { success: true, transaction: enrichedTx };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },

  settleFinancialTransactionInCloud: async (params: {
    id: string;
    paymentDate: string;
    paymentMethod?: FinancialPaymentMethod;
    notes?: string;
  }): Promise<{ success: boolean; transaction?: FinancialTransaction; error?: string }> => {
    const supabase = getSupabase();
    if (!supabase) {
      return { success: false, error: 'Conexão com o Supabase não configurada.' };
    }
    if (!isUuid(params.id)) {
      return { success: false, error: 'ID de lançamento inválido.' };
    }

    const paymentDate = normalizeDateToSaoPauloYmd(params.paymentDate);
    if (!paymentDate) {
      return {
        success: false,
        error: 'Informe a data real do pagamento/recebimento para dar baixa.',
      };
    }

    try {
      const actorAuthId = await resolveCurrentAuthUserId();
      const updateFields: Record<string, unknown> = {
        status: 'paid',
        payment_date: paymentDate,
        paid_at: `${paymentDate}T12:00:00-03:00`,
        cancelled_at: null,
        cancellation_reason: null,
        updated_by: actorAuthId,
      };

      if (params.paymentMethod) {
        updateFields.payment_method = params.paymentMethod;
      }
      if (params.notes !== undefined) {
        updateFields.notes = params.notes.trim() || null;
      }

      const { data: updatedRow, error } = await supabase
        .from('financial_transactions')
        .update(updateFields)
        .eq('id', params.id)
        .select('*')
        .single();

      if (error || !updatedRow) {
        return {
          success: false,
          error:
            error?.code === '42501'
              ? 'Sem permissão para dar baixa neste lançamento financeiro (RLS).'
              : error?.message || 'Erro ao quitar lançamento no Supabase.',
        };
      }

      const mapped = mapFinancialRow(updatedRow as Record<string, unknown>, {
        branches: StorageService.getBranches(),
        professionals: StorageService.getProfessionals(),
      });
      StorageService.saveFinancialTransaction(mapped);

      void StorageService.addAuditLogToCloud({
        organizationId: mapped.organizationId,
        action: 'settle_financial',
        entity: mapped.type === 'payable' ? 'Contas a Pagar' : 'Contas a Receber',
        entityId: mapped.id,
        details: `Quitação em ${paymentDate}: ${mapped.description} (R$ ${mapped.amount.toFixed(2)})`,
      });

      return { success: true, transaction: mapped };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },

  cancelFinancialTransactionInCloud: async (params: {
    id: string;
    reason: string;
  }): Promise<{ success: boolean; transaction?: FinancialTransaction; error?: string }> => {
    const supabase = getSupabase();
    if (!supabase) {
      return { success: false, error: 'Conexão com o Supabase não configurada.' };
    }
    if (!isUuid(params.id)) {
      return { success: false, error: 'ID de lançamento inválido.' };
    }
    const cleanReason = params.reason.trim();
    if (cleanReason.length < 3) {
      return { success: false, error: 'Informe o motivo do cancelamento (mínimo 3 caracteres).' };
    }

    try {
      const actorAuthId = await resolveCurrentAuthUserId();
      const { data: updatedRow, error } = await supabase
        .from('financial_transactions')
        .update({
          status: 'cancelled',
          cancelled_at: new Date().toISOString(),
          cancellation_reason: cleanReason,
          payment_date: null,
          paid_at: null,
          updated_by: actorAuthId,
        })
        .eq('id', params.id)
        .select('*')
        .single();

      if (error || !updatedRow) {
        return {
          success: false,
          error:
            error?.code === '42501'
              ? 'Sem permissão para cancelar este lançamento financeiro (RLS).'
              : error?.message || 'Erro ao cancelar lançamento no Supabase.',
        };
      }

      const mapped = mapFinancialRow(updatedRow as Record<string, unknown>, {
        branches: StorageService.getBranches(),
        professionals: StorageService.getProfessionals(),
      });
      StorageService.saveFinancialTransaction(mapped);

      void StorageService.addAuditLogToCloud({
        organizationId: mapped.organizationId,
        action: 'cancel_financial',
        entity: mapped.type === 'payable' ? 'Contas a Pagar' : 'Contas a Receber',
        entityId: mapped.id,
        details: `Cancelado (${cleanReason}): ${mapped.description}`,
      });

      return { success: true, transaction: mapped };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },

  deleteFinancialTransactionInCloud: async (
    id: string
  ): Promise<{ success: boolean; requiresCancel?: boolean; error?: string }> => {
    const supabase = getSupabase();
    if (!supabase) {
      return { success: false, error: 'Conexão com o Supabase não configurada.' };
    }
    if (!isUuid(id)) {
      return { success: false, error: 'ID de lançamento inválido.' };
    }

    try {
      const { data: currentRow, error: fetchErr } = await supabase
        .from('financial_transactions')
        .select('id, organization_id, status, appointment_id, medical_record_id, description, amount, transaction_type')
        .eq('id', id)
        .maybeSingle();

      if (fetchErr || !currentRow) {
        return {
          success: false,
          error: fetchErr?.message || 'Lançamento financeiro não encontrado.',
        };
      }

      if (currentRow.status === 'paid') {
        return {
          success: false,
          requiresCancel: true,
          error:
            'Lançamentos já pagos/recebidos não podem ser excluídos para preservar o histórico contábil. Utilize o Cancelamento Lógico informando o motivo.',
        };
      }

      if (currentRow.appointment_id || currentRow.medical_record_id) {
        return {
          success: false,
          requiresCancel: true,
          error:
            'Lançamentos vinculados a consultas ou prontuários não podem ser excluídos fisicamente. Utilize o Cancelamento Lógico para preservar o vínculo clínico.',
        };
      }

      const { error: delErr } = await supabase
        .from('financial_transactions')
        .delete()
        .eq('id', id);

      if (delErr) {
        return {
          success: false,
          error:
            delErr.code === '42501'
              ? 'Sem permissão para excluir este lançamento financeiro (RLS).'
              : delErr.message,
        };
      }

      StorageService.removeFinancialTransactionFromCache(id);

      void StorageService.addAuditLogToCloud({
        organizationId: String(currentRow.organization_id),
        action: 'delete_financial',
        entity: currentRow.transaction_type === 'payable' ? 'Contas a Pagar' : 'Contas a Receber',
        entityId: id,
        details: `Excluído: ${currentRow.description} (R$ ${Number(currentRow.amount || 0).toFixed(2)})`,
      });

      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },

  fetchBillableAppointmentsFromCloud: async (
    organizationId?: string,
    branchFilterId?: string
  ): Promise<{ items: BillableAppointmentItem[]; error?: string }> => {
    const supabase = getSupabase();
    if (!supabase) {
      return { items: [], error: 'Conexão com o Supabase não configurada neste ambiente.' };
    }

    try {
      const orgId = await resolveOrgId(organizationId);
      let aptQuery = supabase
        .from('appointments')
        .select(
          `
          *,
          patient:patients (id, full_name, phone, whatsapp),
          professional:professionals (id, full_name),
          branch:branches (id, name),
          service:services (id, name, price)
        `
        )
        .neq('status', 'cancelled')
        .order('start_time', { ascending: false })
        .limit(80);

      if (orgId) aptQuery = aptQuery.eq('organization_id', orgId);
      if (branchFilterId && branchFilterId !== 'all' && isUuid(branchFilterId)) {
        aptQuery = aptQuery.eq('branch_id', branchFilterId);
      }

      let { data: aptRows, error: aptErr } = await aptQuery;
      if (aptErr) {
        let flatAptQuery = supabase
          .from('appointments')
          .select('*')
          .neq('status', 'cancelled')
          .order('start_time', { ascending: false })
          .limit(80);
        if (orgId) flatAptQuery = flatAptQuery.eq('organization_id', orgId);
        if (branchFilterId && branchFilterId !== 'all' && isUuid(branchFilterId)) {
          flatAptQuery = flatAptQuery.eq('branch_id', branchFilterId);
        }
        const flatRes = await flatAptQuery;
        aptRows = flatRes.data;
        aptErr = flatRes.error;
      }

      if (aptErr) {
        return {
          items: [],
          error:
            aptErr.code === '42501'
              ? 'Sem permissão para listar consultas faturáveis (RLS).'
              : aptErr.message,
        };
      }

      let finQuery = supabase
        .from('financial_transactions')
        .select('id, appointment_id, status, amount, receipt_number')
        .not('appointment_id', 'is', null)
        .neq('status', 'cancelled');

      if (orgId) finQuery = finQuery.eq('organization_id', orgId);

      const { data: linkedFinRows } = await finQuery;
      const finByAptId = new Map<
        string,
        { id: string; status: FinancialTransaction['status']; amount: number; receiptNumber?: string }
      >();
      for (const fRow of (linkedFinRows || []) as Array<Record<string, unknown>>) {
        if (fRow.appointment_id) {
          finByAptId.set(String(fRow.appointment_id), {
            id: String(fRow.id),
            status: mapStatus(fRow.status),
            amount: Number(fRow.amount || 0),
            receiptNumber: fRow.receipt_number ? String(fRow.receipt_number) : undefined,
          });
        }
      }

      const items: BillableAppointmentItem[] = (
        (aptRows || []) as Array<Record<string, unknown>>
      ).map((row) => {
        const pat = extractJoin(row.patient);
        const prof = extractJoin(row.professional);
        const branch = extractJoin(row.branch);
        const srv = extractJoin(row.service);
        const aptId = String(row.id);

        const appointment: Appointment = {
          id: aptId,
          organizationId: String(row.organization_id || orgId || ''),
          branchId: String(row.branch_id || ''),
          branchName: String(branch?.name || row.branch_name || 'Unidade'),
          patientId: String(row.patient_id || pat?.id || ''),
          patientName: String(pat?.full_name || row.patient_name || 'Paciente'),
          patientPhone: String(pat?.whatsapp || pat?.phone || row.patient_phone || ''),
          professionalId: String(row.professional_id || prof?.id || ''),
          professionalName: String(prof?.full_name || row.professional_name || 'Profissional'),
          serviceId: row.service_id ? String(row.service_id) : undefined,
          serviceName: String(srv?.name || row.service_name || 'Consulta Médica'),
          roomId: row.room_id ? String(row.room_id) : undefined,
          startTime: String(row.start_time || row.created_at || new Date().toISOString()),
          endTime: String(row.end_time || row.start_time || new Date().toISOString()),
          status: (row.status as AppointmentStatus) || 'scheduled',
          appointmentType: row.appointment_type === 'telemedicina' ? 'telemedicina' : 'presencial',
          notes: row.notes ? String(row.notes) : undefined,
          createdAt: String(row.created_at || new Date().toISOString()),
        };

        return {
          appointment,
          servicePrice: srv?.price !== undefined && srv?.price !== null ? Number(srv.price) : 0,
          existingFinancialTx: finByAptId.get(aptId),
        };
      });

      return { items };
    } catch (err) {
      return {
        items: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },

  createReceivableFromClinicalOrigin: async (params: {
    originType: 'appointment' | 'treatment';
    organizationId: string;
    branchId: string;
    branchName: string;
    patientId?: string;
    patientName?: string;
    professionalId?: string;
    professionalName?: string;
    appointmentId?: string;
    medicalRecordId?: string;
    serviceId?: string;
    treatmentName?: string;
    categoryId?: string;
    categoryName?: string;
    description: string;
    amount: number;
    issueDate: string;
    dueDate: string;
    status: 'pending' | 'paid';
    paymentDate?: string;
    paymentMethod: FinancialPaymentMethod;
    installments?: number;
    notes?: string;
    idempotencyKey?: string;
  }) => {
    const key =
      params.idempotencyKey ||
      (params.originType === 'appointment' && params.appointmentId
        ? `apt:${params.appointmentId}`
        : `trt:${params.organizationId}:${params.patientId || 'none'}:${params.serviceId || params.treatmentName || 'custom'}:${params.issueDate}`);

    const receiptCode = `REC-${getSaoPauloTodayYmd().slice(0, 4)}-${Math.floor(1000 + Math.random() * 9000)}`;

    const newTx: FinancialTransaction = {
      id: `fin_${Date.now()}`,
      organizationId: params.organizationId,
      branchId: params.branchId,
      branchName: params.branchName,
      categoryId: params.categoryId,
      categoryName:
        params.categoryName ||
        (params.originType === 'appointment' ? 'Consulta Médica' : 'Tratamento / Procedimento'),
      originType: params.originType,
      patientId: params.patientId,
      patientName: params.patientName,
      appointmentId: params.appointmentId,
      medicalRecordId: params.medicalRecordId,
      professionalId: params.professionalId,
      professionalName: params.professionalName,
      serviceId: params.serviceId,
      treatmentName: params.treatmentName,
      description: params.description,
      amount: params.amount,
      type: 'receivable',
      paymentMethod: params.paymentMethod,
      installments: Math.max(1, params.installments || 1),
      status: params.status,
      issueDate: params.issueDate,
      dueDate: params.dueDate,
      paymentDate: params.status === 'paid' ? params.paymentDate : undefined,
      paidAt:
        params.status === 'paid' && params.paymentDate
          ? `${params.paymentDate}T12:00:00-03:00`
          : undefined,
      receiptNumber: receiptCode,
      notes: params.notes,
      idempotencyKey: key,
      createdAt: new Date().toISOString(),
    };

    return FinancialCloudService.saveFinancialTransactionToCloud(newTx);
  },
};
