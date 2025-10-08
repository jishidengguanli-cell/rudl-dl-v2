export async function hashPassword(password: string, saltHex: string) {
  const enc = new TextEncoder();
  const salt = hexToBytes(saltHex);
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 120_000 },
    keyMaterial,
    256
  );
  return bytesToHex(new Uint8Array(bits));
}

export function randomSaltHex(len = 16) {
  const b = new Uint8Array(len);
  crypto.getRandomValues(b);
  return bytesToHex(b);
}

function hexToBytes(hex: string) {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++) arr[i] = parseInt(hex.substr(i*2, 2), 16);
  return arr;
}
function bytesToHex(b: Uint8Array) {
  return [...b].map(x => x.toString(16).padStart(2, '0')).join('');
}
