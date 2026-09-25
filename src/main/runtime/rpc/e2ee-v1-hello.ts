import { deriveSharedKey } from './e2ee-crypto'
import { decodeMobileE2EEPublicKey } from './mobile-e2ee-auth-validation'

export type WearEnrollmentProof = (clientPublicKeyB64: string) => {
  serverPublicKeyB64: string
  proofB64: string
} | null

export function prepareE2EEV1Hello(
  hello: Record<string, unknown>,
  serverSecretKey: Uint8Array,
  wearEnrollmentProof?: WearEnrollmentProof
):
  | {
      ok: true
      sharedKey: Uint8Array
      wearEnrollmentRequested: boolean
      ready: Record<string, unknown>
    }
  | { ok: false; error: string } {
  if (hello.type !== 'e2ee_hello' || typeof hello.publicKeyB64 !== 'string') {
    return { ok: false, error: 'Invalid e2ee_hello' }
  }
  const clientPublicKey = decodeMobileE2EEPublicKey(hello.publicKeyB64)
  if (!clientPublicKey) {
    return { ok: false, error: 'Invalid public key' }
  }
  const proof =
    hello.wearEnrollment === true ? wearEnrollmentProof?.(hello.publicKeyB64) : undefined
  if (hello.wearEnrollment === true && !proof) {
    return { ok: false, error: 'Wear enrollment unavailable' }
  }
  return {
    ok: true,
    sharedKey: deriveSharedKey(serverSecretKey, clientPublicKey),
    wearEnrollmentRequested: hello.wearEnrollment === true,
    ready: { type: 'e2ee_ready', ...proof }
  }
}
