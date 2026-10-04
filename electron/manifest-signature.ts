import { createHash, createPublicKey, verify as verifyDetached } from 'node:crypto'
import { MANIFEST_KEYS, type IManifestKey } from './manifest-keys'

/**
 * Signature check for the modpack manifest.
 *
 * The manifest is the only thing that decides which files are downloaded into the game folder, so
 * it is treated as untrusted input: it is accepted only when a signature document, fetched next to
 * it, proves that its exact bytes were signed by a key from `MANIFEST_KEYS`. Both parts travel
 * separately over the network, so the document also carries the sha256 of the manifest — the digest
 * is what is actually signed, which binds the signature to those exact bytes and leaves no window
 * between reading the two responses.
 *
 * Nothing here throws: a caller deciding whether to launch the game needs a reason it can show the
 * player, not an exception.
 */

export const SIGNATURE_ALG = 'ed25519'

export interface IManifestSignature {
  keyId: string
  alg: string
  sha256: string
  /** base64 of the ed25519 signature over the raw sha256 digest of the manifest */
  signature: string
}

export type IManifestSignatureResult = { ok: true; keyId: string } | { ok: false; reason: string }

const HEX_64 = /^[0-9a-f]{64}$/i

export function sha256Hex(bytes: Buffer | Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Validates the shape of a signature document before any crypto runs on it. */
export function parseSignature(raw: unknown): IManifestSignature | null {
  if (!raw || typeof raw !== 'object') return null

  const { keyId, alg, sha256, signature } = raw as Partial<IManifestSignature>
  if (typeof keyId !== 'string' || !keyId) return null
  if (alg !== SIGNATURE_ALG) return null
  if (typeof sha256 !== 'string' || !HEX_64.test(sha256)) return null
  if (typeof signature !== 'string' || !signature) return null

  return { keyId, alg, sha256, signature }
}

/**
 * Checks a manifest against a signature document.
 *
 * Order matters for the message the player gets: an unknown `keyId` means the launcher is out of
 * date (or the manifest was signed with a key that was never shipped), while a bad signature on a
 * known key means the bytes do not come from the publisher.
 */
export function verifyManifestSignature(
  manifest: Buffer | Uint8Array,
  rawSignature: unknown,
  keys: IManifestKey[] = MANIFEST_KEYS
): IManifestSignatureResult {
  const parsed = parseSignature(rawSignature)
  if (!parsed) return { ok: false, reason: 'assinatura do modpack em formato desconhecido' }

  const key = keys.find((candidate) => candidate.keyId === parsed.keyId)
  if (!key) {
    return {
      ok: false,
      reason: `modpack assinado por uma chave desconhecida (${parsed.keyId}); atualize o launcher`
    }
  }

  const digest = Buffer.from(sha256Hex(manifest), 'hex')
  if (digest.toString('hex') !== parsed.sha256.toLowerCase()) {
    return { ok: false, reason: 'modpack não bate com a assinatura publicada' }
  }

  let signature: Buffer
  try {
    signature = Buffer.from(parsed.signature, 'base64')
  } catch {
    return { ok: false, reason: 'assinatura do modpack ilegível' }
  }
  if (signature.length !== 64) return { ok: false, reason: 'assinatura do modpack com tamanho inválido' }

  try {
    const publicKey = createPublicKey(key.publicKeyPem)
    if (!verifyDetached(null, digest, publicKey, signature)) {
      return { ok: false, reason: 'assinatura do modpack inválida' }
    }
  } catch (err) {
    return { ok: false, reason: `chave pública do modpack inválida: ${(err as Error).message}` }
  }

  return { ok: true, keyId: key.keyId }
}