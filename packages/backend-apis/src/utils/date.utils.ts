export function padTwo(n: number): string {
  return n.toString().padStart(2, '0');
}

export function toDateStr(date: Date): string {
  return `${date.getFullYear()}-${padTwo(date.getMonth() + 1)}-${padTwo(date.getDate())}`;
}

export function toTimeStr(date: Date): string {
  return `${padTwo(date.getHours())}:${padTwo(date.getMinutes())}`;
}

export function formatWhen(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

export function periodStart(month: number, year: number): string {
  return `${year}-${padTwo(month)}-01`;
}

export function periodEnd(month: number, year: number): string {
  return `${year}-${padTwo(month)}-${padTwo(new Date(year, month, 0).getDate())}`;
}
