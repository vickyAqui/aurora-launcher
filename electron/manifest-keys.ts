/**
 * Public keys trusted to sign the modpack manifest.
 *
 * The manifest is what decides which jars land in `mods/`, so it is only as trustworthy as the
 * channel it arrives on: a manifest fetched over TLS from a GitHub release can still be rewritten
 * by anyone with write access to the repository, or served by anyone who can answer for
 * `github.com`. Signing it means the launcher only accepts a manifest whose bytes match a signature
 * from a key in this list, so a tampered manifest stops the game instead of choosing its contents.
 *
 * Rotation: publish with the new private key first, add its public key here in the same release
 * that ships the new launcher, and remove the old key only once no player is left on a build that
 * predates it. `keyId` is the first 16 hex chars of the sha256 of the public key in SPKI/DER form,
 * which is how the publisher labels a signature and how a key is recognized here.
 */
export interface IManifestKey {
  keyId: string
  publicKeyPem: string
  addedAt: string
  comment?: string
}

export const MANIFEST_KEYS: IManifestKey[] = [
  {
    keyId: '243685e37e0867e6',
    addedAt: '2026-10-04',
    comment: 'chave de produção do modpack; privada em MODPACK_SIGNING_KEY_B64 (secret do CI)',
    publicKeyPem: `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEABvldyye4PbXLojhnbKvWU8/2icV2ojxRsEmPrsojHpc=
-----END PUBLIC KEY-----
`
  }
]