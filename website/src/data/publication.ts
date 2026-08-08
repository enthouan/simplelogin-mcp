export function normalizePublicationUrl(value: string | undefined): URL | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;

  if (trimmed.includes('\\') || /%(?:2f|5c)/i.test(trimmed)) {
    throw new Error('WEBSITE_BASE_URL contains an unsafe path separator');
  }
  if (trimmed.includes('%')) {
    throw new Error('WEBSITE_BASE_URL must not contain percent-encoded path segments');
  }

  const url = new URL(trimmed);
  if (url.protocol !== 'https:') {
    throw new Error('WEBSITE_BASE_URL must use https');
  }
  if (url.username || url.password) {
    throw new Error('WEBSITE_BASE_URL must not include credentials');
  }
  if (trimmed.includes('?') || trimmed.includes('#')) {
    throw new Error('WEBSITE_BASE_URL must not include a query string or fragment');
  }
  if (url.pathname.startsWith('//')) {
    throw new Error('WEBSITE_BASE_URL must not use a protocol-relative path');
  }
  if (url.pathname.includes('//')) {
    throw new Error('WEBSITE_BASE_URL must not contain repeated path separators');
  }
  if (url.pathname.includes('%')) {
    throw new Error('WEBSITE_BASE_URL must not contain percent-encoded path segments');
  }
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url;
}
