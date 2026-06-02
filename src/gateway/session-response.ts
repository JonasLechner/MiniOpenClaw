import type { Session } from "../core/sessions.js";

export type SessionResponse = {
  sessionId: string;
  createdAt: string;
  path: string;
  events: Session["events"];
};

export function toSessionResponse(session: Session): SessionResponse {
  return {
    sessionId: session.sessionId,
    createdAt: session.createdAt,
    path: session.path,
    events: session.events,
  };
}
