export function parseTrustRecord(record) {
  const fields = Object.create(null);

  for (const part of String(record || "").split(";")) {
    const trimmedPart = part.trim();
    if (!trimmedPart) {
      continue;
    }

    const [rawKey, ...rawValueParts] = trimmedPart.split("=");
    const key = rawKey.trim();
    if (!key) {
      continue;
    }

    fields[key] = rawValueParts.join("=").trim();
  }

  return fields;
}

export function verifyRecord(record, domain) {
  const fields = parseTrustRecord(record);
  const normalizedRecordDomain = normalizeDomain(fields.id);
  const normalizedExpectedDomain = normalizeDomain(domain);

  return {
    valid: Boolean(normalizedRecordDomain && normalizedExpectedDomain && normalizedRecordDomain === normalizedExpectedDomain),
    fields,
    expectedDomain: normalizedExpectedDomain,
    recordDomain: normalizedRecordDomain,
    signature: fields.sig || null,
  };
}

export async function verifySignatureEnvelope(record, payload, publicKey) {
  const fields = parseTrustRecord(record);

  if (!fields.sig) {
    return { verified: false, reason: "missing-signature" };
  }

  if (!publicKey) {
    // TODO: Hinterlege hier den Root-Trust-Anchor bzw. den öffentlichen Ed25519-Schlüssel.
    return { verified: false, reason: "public-key-not-configured" };
  }

  const signatureBytes = decodeBase64Url(fields.sig);
  const payloadBytes = new TextEncoder().encode(String(payload || ""));
  const keyBytes = decodePemPublicKey(publicKey);

  if (!keyBytes) {
    return { verified: false, reason: "invalid-public-key" };
  }

  if (!globalThis.crypto?.subtle) {
    return { verified: false, reason: "crypto-subtle-unavailable" };
  }

  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "Ed25519" },
    false,
    ["verify"]
  );

  const verified = await crypto.subtle.verify({ name: "Ed25519" }, key, signatureBytes, payloadBytes);
  return { verified };
}

function normalizeDomain(value) {
  return String(value || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\.+$/, "");
}

function decodeBase64Url(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "===".slice((normalized.length + 3) % 4);
  const raw = atob(padded);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

function decodePemPublicKey(publicKey) {
  const pemText = String(publicKey || "").trim();
  if (!pemText) {
    return null;
  }

  const base64Text = pemText
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");

  try {
    return decodeBase64Url(base64Text);
  } catch {
    return null;
  }
}