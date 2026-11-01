// Test link (`?test`, optionally `&sector=N`): a sandbox for trying content quickly.
// Profile, run save and best record go to their own keys, so test runs never touch the real save.
const params = new URLSearchParams(location.search);

export const TEST = params.has('test');
export const TEST_SECTOR = Math.max(1, Math.floor(Number(params.get('sector')) || 1));

export const storageKey = (key: string): string => TEST ? key.replace('neonrift.', 'neonrift.test.') : key;
