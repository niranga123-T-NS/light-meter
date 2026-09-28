import * as Crypto from 'expo-crypto';

/** Record IDs are generated on the device so offline records can be retried safely. */
export function newId(): string {
  return Crypto.randomUUID();
}
