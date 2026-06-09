#!/usr/bin/env bun
/**
 * Master key rotation script for otpravkarr.
 *
 * Re-encrypts all encrypted fields in the database using a new OTPRAVKARR_SECRET.
 * Runs standalone — no SvelteKit imports.
 *
 * Usage:
 *   OLD_SECRET=<old> NEW_SECRET=<new> bun scripts/rotate-key.ts
 *   OLD_SECRET=<old> NEW_SECRET=<new> DATABASE_PATH=./data/otpravkarr.sqlite bun scripts/rotate-key.ts
 */

import { Database } from "bun:sqlite";
import { assessSecretStrength } from "../src/lib/crypto/secret";

// ── Constants (must match src/lib/crypto/keys.ts and encryption.ts) ─────────

const HKDF_SALT = new TextEncoder().encode("otpravkarr-hkdf-v1");
const IV_LENGTH = 12;

const PURPOSE_CONFIG = "config-encryption";
const PURPOSE_CREDENTIAL = "credential-encryption";

const DEFAULT_DATABASE_PATH = "./data/otpravkarr.sqlite";

// ── Key derivation (standalone HKDF, mirrors src/lib/crypto/keys.ts) ────────

async function deriveKey(secret: string, purpose: string): Promise<CryptoKey> {
  const raw = new TextEncoder().encode(secret);
  const masterKey = await crypto.subtle.importKey("raw", raw, "HKDF", false, ["deriveKey"]);
  const info = new TextEncoder().encode(purpose);

  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: HKDF_SALT, info },
    masterKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

// ── Encryption / decryption (mirrors src/lib/crypto/encryption.ts) ──────────

async function encrypt(plaintext: string, key: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoded = new TextEncoder().encode(plaintext);

  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded),
  );

  const result = new Uint8Array(IV_LENGTH + ciphertext.byteLength);
  result.set(iv, 0);
  result.set(ciphertext, IV_LENGTH);

  return Buffer.from(result).toString("base64");
}

async function decrypt(ciphertext: string, key: CryptoKey): Promise<string> {
  const binary = atob(ciphertext);
  const raw = Uint8Array.from(binary, (c) => c.charCodeAt(0));

  const iv = raw.slice(0, IV_LENGTH);
  const encrypted = raw.slice(IV_LENGTH);

  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, encrypted);
  return new TextDecoder().decode(decrypted);
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const oldSecret = process.env.OLD_SECRET?.trim();
  const newSecret = process.env.NEW_SECRET?.trim();
  const dbPath = process.env.DATABASE_PATH?.trim() || DEFAULT_DATABASE_PATH;

  if (!oldSecret || !newSecret) {
    console.error("Usage: OLD_SECRET=<old> NEW_SECRET=<new> bun scripts/rotate-key.ts");
    console.error("  Optional: DATABASE_PATH=<path> (default: ./data/otpravkarr.sqlite)");
    process.exit(1);
  }

  if (oldSecret === newSecret) {
    console.error("Error: OLD_SECRET and NEW_SECRET must be different.");
    process.exit(1);
  }

  const strength = assessSecretStrength(newSecret);
  if (!strength.ok) {
    console.error("Error: NEW_SECRET does not meet minimum strength requirements.");
    console.error(strength.reason);
    console.error("Generate one with: openssl rand -base64 32");
    process.exit(1);
  }

  // Derive old and new keys for both purposes
  const [oldConfigKey, newConfigKey, oldCredentialKey, newCredentialKey] = await Promise.all([
    deriveKey(oldSecret, PURPOSE_CONFIG),
    deriveKey(newSecret, PURPOSE_CONFIG),
    deriveKey(oldSecret, PURPOSE_CREDENTIAL),
    deriveKey(newSecret, PURPOSE_CREDENTIAL),
  ]);

  const db = new Database(dbPath);
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA foreign_keys=ON");

  let configCount = 0;
  let credentialCount = 0;

  try {
    db.exec("BEGIN IMMEDIATE");

    // ── Re-encrypt config rows ──────────────────────────────────────────
    const configRows = db.prepare("SELECT key, value FROM config WHERE encrypted = 1").all() as {
      key: string;
      value: string;
    }[];

    for (const row of configRows) {
      const plaintext = await decrypt(row.value, oldConfigKey);
      const newCiphertext = await encrypt(plaintext, newConfigKey);
      db.prepare("UPDATE config SET value = ?, updated_at = datetime('now') WHERE key = ?").run(
        newCiphertext,
        row.key,
      );
      configCount++;
    }

    // ── Re-encrypt user mapping credentials ─────────────────────────────
    const userRows = db
      .prepare(
        "SELECT id, dispatcharr_xc_password_enc FROM user_mappings WHERE dispatcharr_xc_password_enc IS NOT NULL",
      )
      .all() as { id: number; dispatcharr_xc_password_enc: string }[];

    for (const row of userRows) {
      const plaintext = await decrypt(row.dispatcharr_xc_password_enc, oldCredentialKey);
      const newCiphertext = await encrypt(plaintext, newCredentialKey);
      db.prepare(
        "UPDATE user_mappings SET dispatcharr_xc_password_enc = ?, updated_at = datetime('now') WHERE id = ?",
      ).run(newCiphertext, row.id);
      credentialCount++;
    }

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    console.error("Key rotation failed — all changes rolled back.");
    console.error(err instanceof Error ? err.message : String(err));
    db.close();
    process.exit(1);
  }

  db.close();

  console.log("Key rotation complete.");
  console.log("  Config rows re-encrypted: %d", configCount);
  console.log("  User credentials re-encrypted: %d", credentialCount);
  console.log("\nUpdate OTPRAVKARR_SECRET in your environment to the new value.");
}

main();
