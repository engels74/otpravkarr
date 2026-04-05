import type { ProvisioningMode } from "$lib/db/types";

export type UserSessionState = {
  plexUsername: string | null;
  plexThumb: string | null;
  provisioningMode: ProvisioningMode | null;
  isActive: boolean;
  loggedIn: boolean;
};

export const userSession = $state<UserSessionState>({
  plexUsername: null,
  plexThumb: null,
  provisioningMode: null,
  isActive: false,
  loggedIn: false,
});

export function setUserSession(next: {
  plexUsername: string;
  plexThumb: string | null;
  provisioningMode: ProvisioningMode;
  isActive: boolean;
}) {
  userSession.plexUsername = next.plexUsername;
  userSession.plexThumb = next.plexThumb;
  userSession.provisioningMode = next.provisioningMode;
  userSession.isActive = next.isActive;
  userSession.loggedIn = true;
}

export function clearUserSession() {
  userSession.plexUsername = null;
  userSession.plexThumb = null;
  userSession.provisioningMode = null;
  userSession.isActive = false;
  userSession.loggedIn = false;
}
