const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export function generateLinkCode(): string {
  let result = '';
  const randomValues = crypto.getRandomValues(new Uint32Array(4));
  for (let i = 0; i < 4; i++) {
    result += ALPHABET[randomValues[i] % ALPHABET.length];
  }
  return result;
}
