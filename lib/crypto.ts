export function createUuid() {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (typeof cryptoApi?.getRandomValues === "function") {
    cryptoApi.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function sha256Hex(
  value: ArrayBuffer | Uint8Array,
  options?: { subtle?: SubtleCrypto | null },
) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  const subtle =
    options && "subtle" in options ? options.subtle : globalThis.crypto?.subtle;

  if (subtle) {
    try {
      const digestInput = new Uint8Array(bytes.byteLength);
      digestInput.set(bytes);
      const digest = await subtle.digest("SHA-256", digestInput.buffer);
      return Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
    } catch {
      // Insecure LAN origins can expose crypto but reject SubtleCrypto.
    }
  }

  const [{ sha256 }, { bytesToHex }] = await Promise.all([
    import("@noble/hashes/sha2.js"),
    import("@noble/hashes/utils.js"),
  ]);
  return bytesToHex(sha256(bytes));
}
