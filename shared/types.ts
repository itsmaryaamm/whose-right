// Types shared by the server and the web client.

export type Relationship =
  | 'couple'
  | 'friends'
  | 'family'
  | 'co-founders'
  | 'colleagues'
  | 'business'
  | 'other';

export interface Attachment {
  id: string;
  name: string;
  mime: string;
  size: number;
}

export type ChatKind =
  | 'user' // what this person wrote privately
  | 'ai' // the mediator talking privately to this person
  | 'relay-in' // a reframed concern passed on from another party
  | 'relay-out' // a reframed concern this person approved and sent
  | 'system'; // neutral notices (someone joined, analysis ready…)

export interface ChatMessage {
  id: string;
  kind: ChatKind;
  text: string;
  at: number;
  fromName?: string; // for relay-in
  attachments?: Attachment[];
}

export interface BridgeMessage {
  id: string;
  fromId: string;
  fromName: string;
  text: string;
  at: number;
}

export interface Report {
  generatedAt: number;
  summary: string;
  agreedFacts: string[];
  disputedFacts: string[];
  concerns: { name: string; concern: string }[];
  misunderstandings: string[];
  contributions: { name: string; items: string[] }[];
  reasonablePositions: string[];
  commonGround: string[];
  compromises: string[];
  proposedResolution: string;
  nextSteps: string[];
}

export interface ParticipantPublic {
  id: string;
  name: string;
  joinedAt: number;
  isYou: boolean;
  isCreator: boolean;
  agreed: boolean | null;
}

/** Everything one participant is allowed to see about a case. */
export interface CaseView {
  id: string;
  title: string;
  relationship: Relationship;
  createdAt: number;
  status: 'open' | 'resolved';
  inviteCode: string;
  you: { id: string; name: string };
  participants: ParticipantPublic[];
  chat: ChatMessage[];
  pendingRelay: string | null;
  bridge: BridgeMessage[];
  report: Report | null;
  thinking: boolean;
  yourTurn: boolean;
  mockAi: boolean;
}

export interface CaseSummary {
  id: string;
  title: string;
  relationship: Relationship;
  status: 'open' | 'resolved';
  participants: { name: string; isYou: boolean }[];
  yourTurn: boolean;
  updatedAt: number;
}
