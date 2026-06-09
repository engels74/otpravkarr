// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
  namespace App {
    // interface Error {}
    interface Locals {
      requestId: string;
      session: { id: string; type: "admin" | "user"; userRef: string } | null;
      admin: { id: number; username: string } | null;
      user: import("$lib/db/types").UserMapping | null;
      revokedUser: import("$lib/db/types").UserMapping | null;
    }
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }
}

export {};
