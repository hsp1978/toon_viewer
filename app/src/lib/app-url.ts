const configuredApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();

function normalizeBaseUrl(value: string) {
  return value.endsWith("/") ? value : `${value}/`;
}

export function appUrl(path: string) {
  if (!path || /^[a-z][a-z\d+\-.]*:/i.test(path)) {
    return path;
  }

  if (!configuredApiBaseUrl || !path.startsWith("/api/")) {
    return path;
  }

  return new URL(path.replace(/^\/+/, ""), normalizeBaseUrl(configuredApiBaseUrl)).toString();
}
