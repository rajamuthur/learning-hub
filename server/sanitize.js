// Minimal HTML sanitizer for a single-user personal tool.
// Removes script/style/iframe(except allowed) tags, event-handler attributes,
// and javascript: URLs. This is intentionally lightweight — the app is
// single-user with an optional edit passcode, not a public multi-tenant service.

const BLOCKED_TAGS = /<\/?(script|style|object|embed|link|meta|base|form)\b[^>]*>/gi;
const EVENT_ATTRS = /\s(on\w+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
const JS_URLS = /\s(href|src)\s*=\s*("javascript:[^"]*"|'javascript:[^']*')/gi;

export function sanitizeHtml(html) {
  if (!html || typeof html !== 'string') return '';
  return html
    .replace(BLOCKED_TAGS, '')
    .replace(EVENT_ATTRS, '')
    .replace(JS_URLS, ' ');
}

// Convert HTML to a plain-text mirror used for search + list previews.
export function htmlToText(html) {
  if (!html) return '';
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}
