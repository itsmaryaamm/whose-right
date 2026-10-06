// Storage. With DATABASE_URL (or POSTGRES_URL) set, cases live in Postgres, e.g. a
// free Neon database. Otherwise they're kept in a JSON file in DATA_DIR, for local use.
//
// Each case is one JSON document with a version number. Updates go through
// `mutate`, which re-reads and retries if someone else changed the case meanwhile.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import pg from 'pg';
import type { Attachment, BridgeMessage, ChatMessage, Relationship, Report } from '../shared/types.js';

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
  /** Set while the mediator is writing a reply to this person. */
  thinkingSince?: number | null;
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
  /** Set while the neutral analysis is being written. */
  reportSince?: number | null;
}

interface Repo {
  get(id: string): Promise<{ c: Case; version: number } | undefined>;
  getMany(ids: string[]): Promise<Case[]>;
  findByCode(code: string): Promise<Case | undefined>;
  insert(c: Case): Promise<boolean>;
  /** Writes only if the stored version still equals `version`. */
  update(c: Case, version: number): Promise<boolean>;
  putAttachment(caseId: string, att: Attachment, data: Buffer): Promise<void>;
  getAttachment(caseId: string, attId: string): Promise<Buffer | undefined>;
}

// ---- Postgres ---------------------------------------------------------------

function postgresRepo(url: string): Repo {
  const local = /localhost|127\.0\.0\.1|host=\/|sslmode=disable/.test(url);
  const pool = new pg.Pool({ connectionString: url, max: 3, ssl: local ? undefined : { rejectUnauthorized: false } });
  let ready: Promise<unknown> | null = null;
  const q = async (text: string, params: unknown[]) => {
    ready ??= pool
      .query(
        `create table if not exists cases (
           id text primary key,
           invite_code text unique not null,
           version integer not null default 1,
           data jsonb not null,
           updated_at timestamptz not null default now()
         );
         create table if not exists attachments (
           id text primary key,
           case_id text not null,
           mime text not null,
           name text not null,
           data bytea not null
         );`,
      )
      .catch((err) => {
        ready = null; // try again on the next request
        throw err;
      });
    await ready;
    return pool.query(text, params);
  };
  return {
    async get(id) {
      const r = await q('select data, version from cases where id = $1', [id]);
      return r.rows[0] ? { c: r.rows[0].data as Case, version: r.rows[0].version as number } : undefined;
    },
    async getMany(ids) {
      if (ids.length === 0) return [];
      const r = await q('select data from cases where id = any($1)', [ids]);
      return r.rows.map((row) => row.data as Case);
    },
    async findByCode(code) {
      const r = await q('select data from cases where invite_code = $1', [code]);
      return r.rows[0]?.data as Case | undefined;
    },
    async insert(c) {
      const r = await q('insert into cases (id, invite_code, data) values ($1, $2, $3) on conflict do nothing', [c.id, c.inviteCode, c]);
      return r.rowCount === 1;
    },
    async update(c, version) {
      const r = await q('update cases set data = $2, version = version + 1, updated_at = now() where id = $1 and version = $3', [c.id, c, version]);
      return r.rowCount === 1;
    },
    async putAttachment(caseId, att, data) {
      await q('insert into attachments (id, case_id, mime, name, data) values ($1, $2, $3, $4, $5)', [att.id, caseId, att.mime, att.name, data]);
    },
    async getAttachment(caseId, attId) {
      const r = await q('select data from attachments where id = $1 and case_id = $2', [attId, caseId]);
      return r.rows[0]?.data as Buffer | undefined;
    },
  };
}

// ---- JSON file (local development) -------------------------------------------

function fileRepo(dir: string): Repo {
  const dbFile = path.join(dir, 'db.json');
  const uploads = path.join(dir, 'uploads');
  fs.mkdirSync(uploads, { recursive: true });
  const db: { cases: Record<string, { data: Case; version: number }> } = fs.existsSync(dbFile)
    ? JSON.parse(fs.readFileSync(dbFile, 'utf8'))
    : { cases: {} };
  const save = () => {
    fs.writeFileSync(dbFile + '.tmp', JSON.stringify(db));
    fs.renameSync(dbFile + '.tmp', dbFile);
  };
  const copy = <T>(v: T): T => structuredClone(v);
  return {
    async get(id) {
      const row = db.cases[id];
      return row ? { c: copy(row.data), version: row.version } : undefined;
    },
    async getMany(ids) {
      return ids.flatMap((id) => (db.cases[id] ? [copy(db.cases[id].data)] : []));
    },
    async findByCode(code) {
      const row = Object.values(db.cases).find((r) => r.data.inviteCode === code);
      return row && copy(row.data);
    },
    async insert(c) {
      if (db.cases[c.id] || Object.values(db.cases).some((r) => r.data.inviteCode === c.inviteCode)) return false;
      db.cases[c.id] = { data: copy(c), version: 1 };
      save();
      return true;
    },
    async update(c, version) {
      const row = db.cases[c.id];
      if (!row || row.version !== version) return false;
      db.cases[c.id] = { data: copy(c), version: version + 1 };
      save();
      return true;
    },
    async putAttachment(caseId, att, data) {
      fs.mkdirSync(path.join(uploads, path.basename(caseId)), { recursive: true });
      fs.writeFileSync(path.join(uploads, path.basename(caseId), path.basename(att.id)), data);
    },
    async getAttachment(caseId, attId) {
      try {
        return fs.readFileSync(path.join(uploads, path.basename(caseId), path.basename(attId)));
      } catch {
        return undefined;
      }
    },
  };
}

/** On hosted serverless platforms there's no disk to fall back to, so explain what's missing. */
function missingDatabase(): Repo {
  const fail = async (): Promise<never> => {
    throw new Refusal('The database isn’t connected yet. In Vercel, open Storage, connect a free Neon database, then redeploy.', 503);
  };
  return { get: fail, getMany: fail, findByCode: fail, insert: fail, update: fail, putAttachment: fail, getAttachment: fail };
}

const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;
export const STORAGE = DATABASE_URL ? 'postgres' : 'file';
const repo: Repo = DATABASE_URL
  ? postgresRepo(DATABASE_URL)
  : process.env.VERCEL
    ? missingDatabase()
    : fileRepo(path.resolve(process.env.DATA_DIR ?? './data'));

// ---- Helpers ------------------------------------------------------------------

export const id = () => crypto.randomBytes(9).toString('base64url');
const token = () => crypto.randomBytes(24).toString('base64url');

// Unambiguous characters only, so codes are easy to read out loud.
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const inviteCode = () => Array.from(crypto.randomBytes(6), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');

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
    thinkingSince: null,
  };
}

/** Saves a brand-new case, picking a fresh id and invite code if either clashes. */
export async function createCase(build: (ids: { id: string; inviteCode: string }) => Case): Promise<Case> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const c = build({ id: id(), inviteCode: inviteCode() });
    if (await repo.insert(c)) return c;
  }
  throw new Error('Could not create the case. Please try again.');
}

export const getCase = async (caseId: string) => (await repo.get(caseId))?.c;
export const getCases = (ids: string[]) => repo.getMany(ids);
export const findByCode = (code: string) => repo.findByCode(code.trim().toUpperCase());

/** Thrown by a `mutate` callback to abort with a message for the user. */
export class Refusal extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

/**
 * Loads a case, applies `fn`, and saves it. If someone else saved in between,
 * it starts again from the fresh copy. `fn` may throw (e.g. a Refusal) to abort.
 */
export async function mutate<T>(caseId: string, fn: (c: Case) => T): Promise<{ c: Case; result: T }> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const row = await repo.get(caseId);
    if (!row) throw new Refusal('Case not found', 404);
    const result = fn(row.c);
    row.c.updatedAt = Date.now();
    if (await repo.update(row.c, row.version)) return { c: row.c, result };
    await new Promise((r) => setTimeout(r, 20 + Math.random() * 80));
  }
  throw new Refusal('The case is busy. Please try again.', 409);
}

export function auth(c: Case, tok: string | undefined): Participant | undefined {
  if (!tok) return undefined;
  return c.participants.find((p) => p.token.length === tok.length && crypto.timingSafeEqual(Buffer.from(p.token), Buffer.from(tok)));
}

export function chatMessage(kind: ChatMessage['kind'], text: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id: id(), kind, text, at: Date.now(), ...extra };
}

// ---- Attachments ----------------------------------------------------------------

export const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf', 'text/plain']);
// Hosted serverless functions cap request bodies at ~4.5 MB, so keep files small.
// The app shrinks photos before uploading.
export const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024;

export async function saveAttachment(caseId: string, name: string, mime: string, base64: string): Promise<Attachment> {
  const buf = Buffer.from(base64, 'base64');
  if (buf.length > MAX_ATTACHMENT_BYTES) throw new Refusal('File is larger than 3 MB');
  if (!ALLOWED_MIME.has(mime)) throw new Refusal('Only images, PDFs and .txt files are supported');
  const att: Attachment = { id: id(), name: name.slice(0, 120), mime, size: buf.length };
  await repo.putAttachment(caseId, att, buf);
  return att;
}

export const readAttachment = (caseId: string, attId: string) => repo.getAttachment(caseId, attId);
