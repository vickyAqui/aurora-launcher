import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { buildSignatureDocument, keyIdOf, loadSigningKey, sha256Hex, signManifest } from '../scripts/manifest-signature.mjs'
import { MANIFEST_KEYS } from '../electron/manifest-keys.ts'
import { parseSignature, sha256Hex as appSha256Hex, verifyManifestSignature } from '../electron/manifest-signature.ts'

/**
 * The publisher signs with `scripts/manifest-signature.mjs` and the launcher verifies with
 * `electron/manifest-signature.ts`. Nothing forces those two to agree, so they are put on both sides
 * of every case here: if either side changes how it digests, labels a key or encodes a signature, this
 * fails instead of every player discovering it on the next launch.
 */
const MANIFEST = Buffer.from('{"files":[{"name":"a.jar","path":"mods/","size":10,"sha1":"' + 'a'.repeat(40) + '","url":"https://example.test/a.jar","type":"MOD"}]}\n')

function keysFor(key) {
  const publicKey = createPublicKey(key)
  return [
    {
      keyId: keyIdOf(key),
      publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      addedAt: 'test'
    }
  ]
}

describe('signature format', () => {
  it('verifies a document produced by the publisher', () => {
    const { privateKey } = generateKeyPairSync('ed25519')
    const doc = JSON.parse(buildSignatureDocument(MANIFEST, privateKey))

    expect(verifyManifestSignature(MANIFEST, doc, keysFor(privateKey))).toEqual({
      ok: true,
      keyId: keyIdOf(privateKey)
    })
  })

  it('labels a key the same way on both sides and digests the manifest the same way', () => {
    const { privateKey } = generateKeyPairSync('ed25519')

    expect(keyIdOf(privateKey)).toMatch(/^[0-9a-f]{16}$/)
    expect(sha256Hex(MANIFEST)).toBe(appSha256Hex(MANIFEST))
  })

  it('survives the round trip through JSON, which is how the document is published', () => {
    const { privateKey } = generateKeyPairSync('ed25519')
    const doc = JSON.parse(buildSignatureDocument(MANIFEST, privateKey))

    expect(parseSignature(doc)).toEqual({
      keyId: doc.keyId,
      alg: 'ed25519',
      sha256: doc.sha256,
      signature: doc.signature
    })
    expect(Buffer.from(doc.signature, 'base64')).toHaveLength(64)
  })

  it('refuses a manifest whose bytes changed after signing', () => {
    const { privateKey } = generateKeyPairSync('ed25519')
    const keys = keysFor(privateKey)
    const doc = JSON.parse(buildSignatureDocument(MANIFEST, privateKey))

    // One extra mod in the manifest: still valid JSON, still valid base64 signature, wrong manifest.
    const tampered = Buffer.from(MANIFEST.toString('utf8').replace('}]}', '},{"name":"b.jar"}]}'))

    expect(verifyManifestSignature(tampered, doc, keys)).toEqual({
      ok: false,
      reason: 'modpack não bate com a assinatura publicada'
    })
  })

  it('refuses a document signed by a key the launcher does not trust', () => {
    const publisher = generateKeyPairSync('ed25519').privateKey
    const stranger = generateKeyPairSync('ed25519').privateKey
    const doc = JSON.parse(buildSignatureDocument(MANIFEST, publisher))

    const result = verifyManifestSignature(MANIFEST, doc, keysFor(stranger))

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toMatch(/chave desconhecida/)
  })

  it('refuses a signature made by another key under a trusted keyId', () => {
    const publisher = generateKeyPairSync('ed25519').privateKey
    const stranger = generateKeyPairSync('ed25519').privateKey
    const keys = keysFor(stranger)
    // Swapping the signature, not the key: this is what an attacker who knows a valid keyId gets.
    const doc = JSON.parse(buildSignatureDocument(MANIFEST, publisher))
    doc.keyId = keys[0].keyId

    expect(verifyManifestSignature(MANIFEST, doc, keys)).toEqual({
      ok: false,
      reason: 'assinatura do modpack inválida'
    })
  })

  it('refuses a digest that does not describe the manifest', () => {
    const { privateKey } = generateKeyPairSync('ed25519')
    const keys = keysFor(privateKey)
    const doc = JSON.parse(buildSignatureDocument(MANIFEST, privateKey))
    doc.sha256 = createHash('sha256').update('other').digest('hex')

    expect(verifyManifestSignature(MANIFEST, doc, keys).ok).toBe(false)
  })

  it('refuses anything that is not a signature document', () => {
    const { privateKey } = generateKeyPairSync('ed25519')
    const keys = keysFor(privateKey)
    const valid = JSON.parse(buildSignatureDocument(MANIFEST, privateKey))

    const cases = [
      undefined,
      null,
      'modpack.json',
      {},
      { ...valid, alg: 'rsa' },
      { ...valid, keyId: '' },
      { ...valid, sha256: 'not-a-digest' },
      { ...valid, signature: '' }
    ]

    for (const bad of cases) {
      expect(parseSignature(bad), `aceitou ${JSON.stringify(bad)}`).toBeNull()
      expect(verifyManifestSignature(MANIFEST, bad, keys).ok).toBe(false)
    }
  })

  it('refuses a signature that is base64 but not 64 bytes', () => {
    // Passes the shape check and fails on the bytes, which is the split the verifier is built on.
    const { privateKey } = generateKeyPairSync('ed25519')
    const keys = keysFor(privateKey)

    for (const signature of [Buffer.alloc(63).toString('base64'), Buffer.alloc(65).toString('base64')]) {
      const doc = JSON.parse(buildSignatureDocument(MANIFEST, privateKey))
      doc.signature = signature

      expect(parseSignature(doc)).not.toBeNull()
      expect(verifyManifestSignature(MANIFEST, doc, keys)).toEqual({
        ok: false,
        reason: 'assinatura do modpack com tamanho inválido'
      })
    }
  })
})

describe('publisher key handling', () => {
  const b64 = (key) => Buffer.from(key.export({ type: 'pkcs8', format: 'pem' })).toString('base64')

  it('reads the key from base64 or from a file', () => {
    const { privateKey } = generateKeyPairSync('ed25519')

    expect(loadSigningKey({ MODPACK_SIGNING_KEY_B64: b64(privateKey) })).not.toBeNull()
    expect(loadSigningKey({})).toBeNull()
    expect(loadSigningKey({ MODPACK_SIGNING_KEY_PATH: '/does/not/exist.pem' })).toBeNull()
  })

  it('reports an absent key as absent and a broken one as broken', () => {
    // Returning null is what makes "refuse to publish unsigned" possible; throwing on a value that
    // is set but unreadable keeps a truncated secret from being reported as an unset variable.
    expect(loadSigningKey({})).toBeNull()
    expect(() => loadSigningKey({ MODPACK_SIGNING_KEY_B64: 'not-a-key' })).toThrow(
      /MODPACK_SIGNING_KEY_B64/
    )
    expect(() => loadSigningKey({ MODPACK_SIGNING_KEY_PATH: __filename })).toThrow(
      /MODPACK_SIGNING_KEY_PATH/
    )
  })

  it('signs the bytes it is given, not a parsed and reserialized manifest', () => {
    const { privateKey } = generateKeyPairSync('ed25519')
    const pretty = JSON.stringify({ files: [] }, null, 2)
    const compact = JSON.stringify({ files: [] })

    // Same JSON, different bytes: the signature follows the bytes, so the file that gets uploaded is
    // the one that was signed, and any edit to it afterwards is caught.
    expect(signManifest(Buffer.from(pretty), privateKey).sha256).not.toBe(
      signManifest(Buffer.from(compact), privateKey).sha256
    )
    expect(signManifest(Buffer.from(pretty), privateKey).sha256).toBe(
      createHash('sha256').update(pretty).digest('hex')
    )
  })
})

describe('committed key list', () => {
  it('is not empty, since an empty list refuses every manifest', () => {
    expect(MANIFEST_KEYS.length).toBeGreaterThan(0)
  })

  it('holds keys that parse as ed25519 public keys labelled by their own content', () => {
    for (const key of MANIFEST_KEYS) {
      const publicKey = createPublicKey(key.publicKeyPem)

      expect(publicKey.asymmetricKeyType, `chave ${key.keyId} não é ed25519`).toBe('ed25519')
      // The derivation `scripts/manifest-signature.mjs#keyIdOf` implements, restated here so a label
      // that no longer describes its key is caught instead of silently never matching.
      const der = publicKey.export({ type: 'spki', format: 'der' })
      expect(key.keyId, `keyId de ${key.keyId} não bate com a chave`).toBe(
        createHash('sha256').update(der).digest('hex').slice(0, 16)
      )
    }
  })

  it('has no duplicate key ids, which would make rotation ambiguous', () => {
    const ids = MANIFEST_KEYS.map((key) => key.keyId)

    expect(new Set(ids).size).toBe(ids.length)
  })

  it('does not verify a manifest signed by the key itself with an empty key list', () => {
    const { privateKey } = generateKeyPairSync('ed25519')
    const doc = JSON.parse(buildSignatureDocument(MANIFEST, privateKey))

    expect(verifyManifestSignature(MANIFEST, doc, [])).toEqual({
      ok: false,
      reason: `modpack assinado por uma chave desconhecida (${doc.keyId}); atualize o launcher`
    })
  })
})