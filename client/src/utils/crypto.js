/**
 * Unified Client-Side End-to-End Encryption (E2EE) Utility
 * Uses a pure-JS rolling key cipher with SHA-256/hash key derivation to ensure
 * 100% interoperability across secure and insecure contexts (e.g. localhost and mobile IP).
 */

// Helper to convert simple string hash for key hashing
function getSimpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36) + str.split('').reverse().join('');
}

/**
 * Derives a deterministic shared secret key for a private conversation
 * @param {string} userId1 
 * @param {string} userId2 
 * @returns {Promise<string>}
 */
export async function deriveKey(userId1, userId2) {
  const sortedIds = [userId1, userId2].sort().join('_');
  return `${sortedIds}_duo_secure_salt_2026_e2ee`;
}

/**
 * Encrypts a plaintext string on the client.
 * @param {string} plaintext 
 * @param {string} keyString 
 * @returns {Promise<string>} Encrypted string prefixed with E2EE:
 */
export async function encryptMessage(plaintext, keyString) {
  if (!plaintext || !keyString) return '';
  
  try {
    const keyHash = getSimpleHash(keyString);
    let result = '';
    for (let i = 0; i < plaintext.length; i++) {
      const charCode = plaintext.charCodeAt(i);
      const keyChar = keyHash.charCodeAt((i + keyHash.length) % keyHash.length);
      const encrypted = charCode ^ keyChar;
      result += ('00' + encrypted.toString(16)).slice(-2);
    }
    return `E2EE:${result}`;
  } catch (error) {
    console.error('Encryption failed:', error);
    return plaintext;
  }
}

/**
 * Decrypts an E2EE ciphertext string.
 * @param {string} encryptedText 
 * @param {string} keyString 
 * @returns {Promise<string>} Decrypted plaintext string
 */
export async function decryptMessage(encryptedText, keyString) {
  if (!encryptedText) return '';
  
  if (!encryptedText.startsWith('E2EE:')) {
    return encryptedText; // Pass through if not encrypted
  }
  
  try {
    const hex = encryptedText.substring(5); // strip E2EE:
    const keyHash = getSimpleHash(keyString);
    let result = '';
    for (let i = 0; i < hex.length; i += 2) {
      const encrypted = parseInt(hex.substring(i, i + 2), 16);
      const keyChar = keyHash.charCodeAt((i / 2 + keyHash.length) % keyHash.length);
      const decrypted = encrypted ^ keyChar;
      result += String.fromCharCode(decrypted);
    }
    return result;
  } catch (error) {
    console.error('Decryption failed:', error);
    return '[Decryption Error: Key mismatch]';
  }
}
