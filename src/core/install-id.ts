const STORAGE_KEY_PREFIX = "growthcat_sdk_install_id";

function generateId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

let identityScope = "unconfigured";
const cachedInstallIds = new Map<string, string>();

function stableScope(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function makeIdentityScope(apiKey: string, baseUrl: string, workspace: string): string {
  return stableScope(`${baseUrl}|${apiKey}|${workspace}`);
}

export function configureIdentityScope(apiKey: string, baseUrl: string, workspace = "sandbox"): void {
  identityScope = makeIdentityScope(apiKey, baseUrl, workspace);
}

/** Builds a versioned browser-storage key isolated to the active GrowthCat project. */
export function scopedStorageKey(name: string, version: number, scope = identityScope): string {
  return `${name}:v${version}:${scope}`;
}

export function installId(scope = identityScope): string {
  const cached = cachedInstallIds.get(scope);
  if (cached) return cached;

  try {
    const key = scopedStorageKey(STORAGE_KEY_PREFIX, 2, scope);
    const stored = localStorage.getItem(key);
    if (stored && /^[a-f0-9-]{36}$/i.test(stored)) {
      cachedInstallIds.set(scope, stored);
      return stored;
    }
    const id = generateId();
    localStorage.setItem(key, id);
    cachedInstallIds.set(scope, id);
    return id;
  } catch {
    const id = generateId();
    cachedInstallIds.set(scope, id);
    return id;
  }
}

export function makeAdEventId(eventName: string, format: string): string {
  void eventName;
  void format;
  return generateId();
}

export function makeSessionId(): string {
  return generateId();
}

export function makeCreativeInstanceId(): string {
  return generateId();
}
