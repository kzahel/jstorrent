/**
 * MSE/PE Protocol Constants
 * Based on Vuze wiki spec (de facto standard)
 */

// 768-bit prime for Diffie-Hellman (96 bytes)
export const DH_PRIME_HEX =
  'ffffffffffffffffc90fdaa22168c234c4c6628b80dc1cd129024e088a67cc74' +
  '020bbea63b139b22514a08798e3404ddef9519b3cd3a431b302b0a6df25f1437' +
  '4fe1356d6d51c245e485b576625e7ec6f44c42e9a63a36210000000000090563'

export const DH_GENERATOR = 2

// Verification Constant (8 zero bytes)
export const VC = new Uint8Array(8)

// Crypto method flags
export const CRYPTO_PLAINTEXT = 0x01
export const CRYPTO_RC4 = 0x02

// We support both, prefer RC4
export const CRYPTO_PROVIDE = new Uint8Array([0x00, 0x00, 0x00, 0x03]) // bits 1 and 2
export const CRYPTO_SELECT_RC4 = new Uint8Array([0x00, 0x00, 0x00, 0x02])
export const CRYPTO_SELECT_PLAIN = new Uint8Array([0x00, 0x00, 0x00, 0x01])

// BitTorrent protocol header (for detection)
export const BT_PROTOCOL_HEADER = 0x13 // First byte of "\x13BitTorrent protocol"

// Handshake timeouts
export const MSE_HANDSHAKE_TIMEOUT = 30000 // 30 seconds per spec
export const MSE_SYNC_MAX_BYTES = 512 // Max padding before sync pattern
