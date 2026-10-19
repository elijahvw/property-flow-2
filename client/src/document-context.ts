export function documentLibraryBack(params: URLSearchParams) {
  if (!params.has("library")) return null;
  const q = new URLSearchParams();
  for (const key of ["q", "source", "status", "scan", "propertyId", "page"])
    if (params.get(`library_${key}`)) q.set(key, params.get(`library_${key}`)!);
  return `/company/documents${q.size ? `?${q}` : ""}`;
}
export function documentSource(
  params: URLSearchParams,
  document: { id: string; source: string; sourceId: string },
) {
  const q = new URLSearchParams({ library: "1", documentId: document.id });
  if (document.source === "leases") q.set("section", "documents");
  for (const key of ["q", "source", "status", "scan", "propertyId", "page"])
    if (params.get(key)) q.set(`library_${key}`, params.get(key)!);
  return `/company/${document.source === "leases" ? "leases" : "maintenance"}/${encodeURIComponent(document.sourceId)}?${q}`;
}

export function documentLibraryContext(params: URLSearchParams) {
  const context: Record<string, string> = {};
  for (const key of [
    "library",
    "documentId",
    ...["q", "source", "status", "scan", "propertyId", "page"].map(
      (k) => `library_${k}`,
    ),
  ])
    if (params.get(key)) context[key] = params.get(key)!;
  return context;
}
