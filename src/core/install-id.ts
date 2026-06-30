const STORAGE_KEY = "growthcat_sdk_install_id";

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

function makeEventId(eventName: string, format: string): string {
  return `${installId()}_${eventName}_${format}_${Date.now()}`;
}

let _cached: string | null = null;

export function installId(): string {
  if (_cached) return _cached;

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      _cached = stored;
      return stored;
    }
    const id = generateId();
    localStorage.setItem(STORAGE_KEY, id);
    _cached = id;
    return id;
  } catch {
    if (!_cached) _cached = generateId();
    return _cached;
  }
}

export function makeAdEventId(eventName: string, format: string): string {
  return makeEventId(eventName, format);
}

export function makeSessionId(): string {
  return generateId();
}
