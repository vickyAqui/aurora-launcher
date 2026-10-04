import { createHash, createPrivateKey, createPublicKey, sign as signDetached } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'

/**
 * Signing side of the modpack manifest signature.
 *
 * The format is shared with `electron/manifest-signature.ts`, which is what the launcher verifies
 * with. `tests/manifest-signature.test.ts` signs with these functions and verifies with those, so the
 * two cannot drift apart.
 *
 * The manifest that gets signed is the exact file that gets uploaded, byte for byte: the signature
 * covers the sha256 of that file, so rewriting the manifest after signing invalidates it.
 *
 * Environment variables:
 *   MODPACK_SIGNING_KEY_B64    (required) base64 of the PEM-encoded ed25519 private key
 *   MODPACK_SIGNING_KEY_PATH   alternative to the above: path to the PEM file
 */

export const SIGNATURE_ALG = 'ed25519'

/** Name of the release asset holding the signature document. */
export const SIGNATURE_ASSET = 'modpack.sig.json'

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * Reads the private key from the environment.
 *
 * Returns `null` when neither variable is set, which is the caller's cue to refuse publishing rather
 * than to silently replace a signed manifest with an unsigned one. A variable that is set but does
 * not hold a readable key throws instead: that is a broken secret, not an absent one, and it should
 * say so rather than look like the key was never configured.
 */
export function loadSigningKey(env = process.env) {
  const b64 = env.MODPACK_SIGNING_KEY_B64
  if (b64) {
    try {
      return createPrivateKey({ key: Buffer.from(b64, 'base64'), format: 'pem', type: 'pkcs8' })
    } catch (err) {
      throw new Error(`MODPACK_SIGNING_KEY_B64 does not hold a readable PEM private key: ${err.message}`)
    }
  }

  const file = env.MODPACK_SIGNING_KEY_PATH
  if (file && existsSync(file)) {
    try {
      return createPrivateKey(readFileSync(file, 'utf8'))
    } catch (err) {
      throw new Error(`MODPACK_SIGNING_KEY_PATH (${file}) does not hold a readable PEM private key: ${err.message}`)
    }
  }

  return null
}

/**
 * The `keyId` of a key: the first 16 hex chars of the sha256 of its public key in SPKI/DER form.
 * Deriving it from the key itself means the publisher labels a signature with the same value the
 * launcher looks up in its trusted key list.
 */
export function keyIdOf(key) {
  const publicKey = createPublicKey(key)
  const der = publicKey.export({ type: 'spki', format: 'der' })
  return createHash('sha256').update(der).digest('hex').slice(0, 16)
}

/** Signs the exact bytes of the manifest that is about to be uploaded. */
export function signManifest(manifestBytes, privateKey) {
  const digest = Buffer.from(sha256Hex(manifestBytes), 'hex')

  return {
    keyId: keyIdOf(privateKey),
    alg: SIGNATURE_ALG,
    sha256: digest.toString('hex'),
    signature: signDetached(null, digest, privateKey).toString('base64')
  }
}

/** The signature document, serialized the way it is published. */
export function buildSignatureDocument(manifestBytes, privateKey) {
  return `${JSON.stringify(signManifest(manifestBytes, privateKey), null, 2)}\n`
}