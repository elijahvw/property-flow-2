export const isFirstPartyApiUrl = (url: string, origin: string): boolean => {
  try {
    const target = new URL(url, origin);
    return target.origin === new URL(origin).origin && target.pathname.startsWith('/api/');
  } catch {
    return false;
  }
};

export function scrubUrl(value: string): string {
  try { const url = new URL(value); url.search = ''; url.hash = ''; return url.href; }
  catch { return value.split(/[?#]/)[0]; }
}
export function scrubRumEvent(event: any): boolean {
  if (event.view?.url) event.view.url = scrubUrl(event.view.url);
  if (event.view?.referrer) event.view.referrer = scrubUrl(event.view.referrer);
  if (event.resource?.url) event.resource.url = scrubUrl(event.resource.url);
  if (event.error?.resource?.url) event.error.resource.url = scrubUrl(event.error.resource.url);
  return true;
}
