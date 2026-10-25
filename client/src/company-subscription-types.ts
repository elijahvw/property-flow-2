export type FeatureMode = "enabled" | "read_only" | "disabled";
export type Feature = { key: string; label: string; description: string };
export type MonthlyPlan = {
  id: string; name: string; version: number; currency: "USD";
  monthlyPriceCents: number; features: string[]; archivedAt: string | null; createdAt: string;
};
export type Subscription = {
  companyId: string; version: number; planId: string | null;
  status: "trial" | "active" | "expired" | "suspended" | "cancelled";
  trialEndsAt: string | null; billingEmail: string | null;
  featureOverrides: Record<string, FeatureMode>; overrideReason?: string | null;
  overrideExpiresAt: string | null; updatedAt: string; plan: MonthlyPlan | null;
};
export type SubscriptionView = {
  subscription: Subscription | null; plans?: MonthlyPlan[]; catalog: Feature[];
  effectiveFeatures: Record<string, FeatureMode>;
  billingProfile?: { name: string; email: string | null; address: Record<string, string | null>; companyVersion: number };
};
export type UsageView = {
  companyId: string; from: string; to: string;
  areas: { key: string; label: string; successfulReads: number; successfulWrites: number; total: number }[];
  resources: { properties: number; activeUnits: number; activeLeases: number; activeMembers: number; documentVersions: number; documentBytes: number };
  trackingStartedAt: string | null; definition: string;
};
export type Invoice = {
  id: string; companyId: string; number: number; reference: string; periodStart: string; periodEnd: string;
  dueOn: string; status: "issued" | "void"; version: number; currency: "USD";
  paymentState: "unpaid" | "partially_paid" | "paid" | "void";
  monthlyPriceCents: number; planName: string; planVersion: number; paidCents: number; balanceCents: number;
  billingName: string; billingEmail: string | null; billingAddress?: Record<string, string | null>;
  issuedAt: string;
};
export type InvoiceDetailView = {
  invoice: Invoice;
  payments: { id: string; amountCents: number; receivedOn: string; paymentReference: string; createdAt: string;
    reversal: null | { id: string; reason: string; createdAt: string } }[];
  events: { id: string; action: string; detail: unknown; createdAt: string }[];
};
export const featureModeLabel = (mode: string) => ({ enabled: "Enabled", read_only: "View only", disabled: "Disabled" } as Record<string, string>)[mode] || mode;
export const billingStateLabel = (state: string) => ({ trial: "Trial", active: "Active", expired: "Expired", suspended: "Suspended", cancelled: "Cancelled", issued: "Issued", unpaid: "Unpaid", partially_paid: "Partially paid", paid: "Paid", void: "Void" } as Record<string, string>)[state] || state;
