// A tiny JSON-file database. Good enough for personal use and small groups;
// swap for a real database if this grows.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type {
  Attachment,
  BridgeMessage,
  ChatMessage,
  Relationship,
  Report,
} from '../shared/types.ts';

export interface Participant {
  id: string;
  token: string;
  name: string;
  joinedAt: number;
  isCreator: boolean;
  chat: ChatMessage[];
  /** The mediator's private working notes about this person. Never shown to anyone. */
  notes: string;
  pendingRelay: string | null;
  lastReadAt: number;
  agreed: boolean | null;
}

export interface Case {
  id: string;
  title: string;
  relationship: Relationship;
  createdAt: number;
  updatedAt: number;
  status: 'open' | 'resolved';
  inviteCode: string;
  participants: Participant[];
  bridge: BridgeMessage[];
  report: Report | null;
}

interface Db {
  cases: Record<string, Case>;
}

export const DATA_DIR = path.resolve(process.env.DATA_DIR ?? './data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

let db: Db = { cases: {} };
if (fs.existsSync(DB_FILE)) {
  db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) as Db;
}

let saveTimer: NodeJS.Timeout | null = null;
export function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, DB_FILE);
  }, 200);
}

export const id = () => crypto.randomBytes(9).toString('base64url');
const token = () => crypto.randomBytes(24).toString('base64url');

// Unambiguous characters only, so codes are easy to read out loud.
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function inviteCode() {
  let code = '';
  do {
    code = Array.from(crypto.randomBytes(6), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
  } while (Object.values(db.cases).some((c) => c.inviteCode === code));
  return code;
}

export function newParticipant(name: string, isCreator: boolean): Participant {
  const now = Date.now();
  return {
    id: id(),
    token: token(),
    name,
    joinedAt: now,
    isCreator,
    chat: [],
    notes: '',
    pendingRelay: null,
    lastReadAt: now,
    agreed: null,
  };
}

export function createCase(title: string, relationship: Relationship, creator: Participant): Case {
  const now = Date.now();
  const c: Case = {
    id: id(),
    title,
    relationship,
    createdAt: now,
    updatedAt: now,
    status: 'open',
    inviteCode: inviteCode(),
    participants: [creator],
    bridge: [],
    report: null,
  };
  db.cases[c.id] = c;
  save();
  return c;
}

export const getCase = (caseId: string): Case | undefined => db.cases[caseId];

export const findByCode = (code: string): Case | undefined =>
  Object.values(db.cases).find((c) => c.inviteCode === code.trim().toUpperCase());

export function auth(c: Case, tok: string | undefined): Participant | undefined {
  if (!tok) return undefined;
  return c.participants.find(
    (p) => p.token.length === tok.length && crypto.timingSafeEqual(Buffer.from(p.token), Buffer.from(tok)),
  );
}

export function touch(c: Case) {
  c.updatedAt = Date.now();
  save();
}

export function chatMessage(kind: ChatMessage['kind'], text: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id: id(), kind, text, at: Date.now(), ...extra };
}

// ---- Attachments ----------------------------------------------------------

export const ALLOWED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/pdf',
  'text/plain',
]);
export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

export function saveAttachment(caseId: string, name: string, mime: string, base64: string): Attachment {
  const buf = Buffer.from(base64, 'base64');
  if (buf.length > MAX_ATTACHMENT_BYTES) throw new Error('File is larger than 8 MB');
  if (!ALLOWED_MIME.has(mime)) throw new Error('Only images, PDFs and .txt files are supported');
  const att: Attachment = { id: id(), name: name.slice(0, 120), mime, size: buf.length };
  const dir = path.join(UPLOAD_DIR, caseId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, att.id), buf);
  return att;
}

export function readAttachment(caseId: string, attId: string): Buffer {
  return fs.readFileSync(path.join(UPLOAD_DIR, caseId, path.basename(attId)));
}
