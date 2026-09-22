import type { SessionCheck, SessionUser } from "@/lib/auth/session";

// Mission #089 — le contrat de lib/auth/request-user a changé : les routes
// lisent getRequestSession (trois issues) au lieu de getRequestUser (deux).
// Les tests qui simulaient un utilisateur connecté ou non continuent de le
// faire, sans rien changer à ce qu'ils vérifient : connecté → « valid »,
// null → « absent ». La panne se simule en passant « unavailable ».
export function requestSessionMock(current: () => SessionUser | null | "unavailable") {
  return {
    getRequestUser: async () => {
      const value = current();
      return value === "unavailable" ? null : value;
    },
    getRequestSession: async (): Promise<SessionCheck> => {
      const value = current();
      if (value === "unavailable") return { kind: "unavailable", status: 522 };
      return value ? { kind: "valid", user: value } : { kind: "absent" };
    },
    logAuthUnavailable: () => undefined,
  };
}
