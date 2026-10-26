export type OperationName =
  | 'sales_demo.create' | 'sales_demo.teardown' | 'sales_demo.credentials'
  | "draft.save" | "draft.delete" | "application.save" | "application.review" | "application.convert" | "prospect.followup" | "availability.listing" | "document.shared.received"
  | "availability.update" | "unit.import.preview" | "unit.import.commit" | "unit.import.cancel"
  | "prospect.create" | "prospect.update" | "prospect.stage" | "prospect.convert"
  | "document.share" | "document.revoke" | "document.shared.download"
  | "expense.import.preview" | "expense.import.commit" | "expense.import.cancel"
  | "plan.publish" | "plan.availability" | "subscription.update" | "subscription.invoice.issue" | "subscription.invoice.void" | "subscription.payment.record" | "subscription.payment.reverse"
  | "impersonation.start" | "impersonation.stop" | "impersonation.support.update"
  | "notification.state"
  | "notification.preferences"
  | 'agreement.save' | 'agreement.review'
  | 'inspection.save' | 'inspection.review'
  | 'preventive.save' | 'preventive.occurrence'
  | 'vendor.save' | 'maintenance.vendor'
  | 'document.upload' | 'document.scan' | 'document.download' | 'document.archive'
  | 'deposit.setup' | 'deposit.update' | 'deposit.receipt' | 'deposit.void'
  | 'rent.charge' | 'rent.payment' | 'rent.void'
  | 'user.provision' | 'account.verification'
  | 'finance.create' | 'finance.void'
  | 'unit.create' | 'unit.update' | 'lease.create' | 'lease.update'
  | 'maintenance.work' | 'maintenance.create' | 'maintenance.status' | 'maintenance.update' | 'maintenance.reply'
  | 'maintenance.cost.link' | 'maintenance.cost.unlink'
  | 'page.data.load'
  | 'auth.session.restore' | 'auth.profile.load'
  | 'admin.users.load' | 'admin.companies.load'
  | 'account.update' | 'account.status' | 'invitation.create' | 'invitation.accept' | 'invitation.send' | 'onboarding.update' | 'membership.update' | 'ownership.transfer' | 'property.create' | 'property.update'
  | 'company.delete' | 'company.create' | 'company.details.load' | 'company.update' | 'company.user.assign';
type Options = { operationKey: string; context?: Record<string, string | number> };
export interface OperationSink {
  startFeatureOperation(name: string, options: Options): void;
  succeedFeatureOperation(name: string, options: Options): void;
  failFeatureOperation(name: string, reason: 'error' | 'abandoned' | 'other', options: Options): void;
}
let sequence = 0;
export function beginOperation(sink: OperationSink, name: OperationName, timeoutMs = 30000) {
  const operationKey = `${Date.now()}-${++sequence}`;
  let finished = false;
  const safe = (call: () => void) => { try { call(); } catch { /* Telemetry never blocks the app. */ } };
  safe(() => sink.startFeatureOperation(name, { operationKey }));
  const end = (reason?: 'error' | 'abandoned' | 'other', context?: Options['context']) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    safe(() => reason
      ? sink.failFeatureOperation(name, reason, { operationKey, context })
      : sink.succeedFeatureOperation(name, { operationKey, context }));
  };
  const timer = setTimeout(() => end('error', { error_code: 'OPERATION_TIMEOUT' }), timeoutMs);
  return {
    succeed: () => end(),
    fail: (error: unknown) => {
      const status = (error as { response?: { status?: unknown } } | null)?.response?.status;
      end('error', typeof status === 'number' ? { http_status: status } : undefined);
    },
    abandon: () => end('abandoned'),
  };
}
