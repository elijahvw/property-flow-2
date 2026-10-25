// Scanning has been retired. Keep recorded verdicts immutable: legacy pending
// means no verdict was recorded, while a known rejection remains blocked.
export const availableDocumentStatuses = ['unscanned', 'pending', 'clean'];
export function documentAvailable(status: string): boolean {
  return availableDocumentStatuses.includes(status);
}
