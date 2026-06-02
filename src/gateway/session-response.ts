import type { SessionRecord } from "../lib/sessions.js";

export type SessionResponse = {
  sessionId: string;
  createdAt: string;
  path: string;
  events: SessionRecord["events"];
};

export function toSessionResponse(session: SessionRecord): SessionResponse {
  return {
    sessionId: session.header.sessionId,
    createdAt: session.header.createdAt,
    path: session.path,
    events: session.events,
  };
}
