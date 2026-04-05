export type AdminSessionState = {
  username: string | null;
  loggedIn: boolean;
};

export const adminSession = $state<AdminSessionState>({
  username: null,
  loggedIn: false,
});

export function setAdminSession(next: { username: string }) {
  adminSession.username = next.username;
  adminSession.loggedIn = true;
}

export function clearAdminSession() {
  adminSession.username = null;
  adminSession.loggedIn = false;
}
