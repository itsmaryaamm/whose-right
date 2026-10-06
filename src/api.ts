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

export function fileToUpload(file: File): Promise<UploadFile> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result);
      resolve({ name: file.name, mime: file.type || 'application/octet-stream', data: s.slice(s.indexOf(',') + 1) });
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}
