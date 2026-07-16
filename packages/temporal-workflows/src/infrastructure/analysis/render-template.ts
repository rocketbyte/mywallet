/**
 * Shared `{{var}}` template renderer for the analyzer prompts. Unknown
 * placeholders render as empty strings so a prompt edited at runtime can
 * reference a variable an older worker doesn't supply without crashing.
 */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}
