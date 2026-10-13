export const isFirstPartyApiUrl = (url: string, origin: string): boolean => {
  try {
    const target = new URL(url, origin);
    return target.origin === new URL(origin).origin && target.pathname.startsWith('/api/');
  } catch {
    return false;
  }
};
