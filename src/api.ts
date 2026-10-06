import type { CaseSummary, CaseView, Relationship } from '../shared/types.ts';

// ---- Local identity: which cases this device can open ---------------------

const KEY = 'whosright.cases';
const NAME_KEY = 'whosright.name';

function readTokens(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

export const tokens = {
  all: readTokens,
  get: (caseId: string) => readTokens()[caseId],
  set(caseId: string, token: string) {
    const t = readTokens();
    t[caseId] = token;
    try {
      localStorage.setItem(KEY, JSON.stringify(t));
    } catch {
      /* private mode: still works for this session via memory below */
    }
    memory[caseId] = token;
  },
  remove(caseId: string) {
    const t = readTokens();
    delete t[caseId];
    try {
      localStorage.setItem(KEY, JSON.stringify(t));
    } catch {
      /* ignore */
    }
    delete memory[caseId];
  },
};
const memory: Record<string, string> = {};
const tokenFor = (caseId: string) => tokens.get(caseId) ?? memory[caseId];

export const savedName = {
  get: () => {
    try {
      return localStorage.getItem(NAME_KEY) ?? '';
    } catch {
      return '';
    }
  },
  set: (n: string) => {
    try {
      localStorage.setItem(NAME_KEY, n);
    } catch {
      /* ignore */
    }
  },
};

// ---- HTTP -----------------------------------------------------------------

async function call<T>(method: string, url: string, body?: unknown, caseId?: string): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (caseId) headers['x-token'] = tokenFor(caseId) ?? '';
  const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

export interface UploadFile {
  name: string;
  mime: string;
  data: string; // base64
}

export const api = {
  createCase: (title: string, relationship: Relationship, name: string) =>
    call<{ caseId: string; token: string }>('POST', '/api/cases', { title, relationship, name }),
  lookup: (code: string) =>
    call<{ title: string; relationship: Relationship; invitedBy: string; participants: number; status: string }>(
      'GET',
      `/api/join/${encodeURIComponent(code)}`,
    ),
  join: (code: string, name: string) =>
    call<{ caseId: string; token: string }>('POST', `/api/join/${encodeURIComponent(code)}`, { name }),
  summaries: () =>
    call<CaseSummary[]>('POST', '/api/cases/summary', {
      entries: Object.entries({ ...memory, ...readTokens() }).map(([id, token]) => ({ id, token })),
    }),
  get: (id: string) => call<CaseView>('GET', `/api/cases/${id}`, undefined, id),
  read: (id: string) => call<{ ok: true }>('POST', `/api/cases/${id}/read`, {}, id),
  send: (id: string, text: string, attachments: UploadFile[]) =>
    call<CaseView>('POST', `/api/cases/${id}/messages`, { text, attachments }, id),
  relay: (id: string, action: 'send' | 'discard', text?: string) =>
    call<CaseView>('POST', `/api/cases/${id}/relay`, { action, text }, id),
  report: (id: string) => call<CaseView>('POST', `/api/cases/${id}/report`, {}, id),
  agree: (id: string, agree: boolean) => call<CaseView>('POST', `/api/cases/${id}/agree`, { agree }, id),
  attachmentUrl: (caseId: string, attId: string) =>
    `/api/cases/${caseId}/attachments/${attId}?t=${encodeURIComponent(tokenFor(caseId) ?? '')}`,
  privateLink: (caseId: string) => `${location.origin}/c/${caseId}#t=${tokenFor(caseId) ?? ''}`,
};

const readDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

/** Photos are shrunk to at most 1600px so they upload fast and stay small. */
async function shrinkImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not read image'))), 'image/jpeg', 0.82));
}

export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;

export async function fileToUpload(file: File): Promise<UploadFile> {
  let blob: Blob = file;
  let mime = file.type || 'application/octet-stream';
  let name = file.name;
  if (/^image\/(jpeg|png|webp|heic|heif)$/.test(mime) || (!file.type && /\.(heic|heif)$/i.test(name))) {
    try {
      blob = await shrinkImage(file);
      mime = 'image/jpeg';
      name = name.replace(/\.\w+$/, '') + '.jpg';
    } catch {
      /* fall back to the original file */
    }
  }
  if (blob.size > MAX_UPLOAD_BYTES) throw new Error(`“${file.name}” is too big (max 3 MB).`);
  const url = await readDataUrl(blob);
  return { name, mime, data: url.slice(url.indexOf(',') + 1) };
}
