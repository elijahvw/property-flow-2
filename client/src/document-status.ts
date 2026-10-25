export function documentAvailable(status: string): boolean {
  return status === 'unscanned' || status === 'pending' || status === 'clean';
}
export function documentStatusLabel(status: string): string {
  if (status === 'clean') return 'Previously cleared by scanning';
  if (status === 'rejected') return 'Previously rejected by scanning · download blocked';
  if (status === 'unscanned' || status === 'pending') return 'Not scanned';
  return 'File status unavailable · download blocked';
}
