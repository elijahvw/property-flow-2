export function agreementContext(params: URLSearchParams) {
  const result: Record<string, string> = {};
  for (const key of [
    "agreementId",
    "agreementQ",
    "agreementStatus",
    "agreementPage",
  ])
    if (params.get(key)) result[key] = params.get(key)!;
  return result;
}
