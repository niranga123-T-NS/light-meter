// Browser key-value storage for the web dashboard.
function ls(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export const kv = {
  getItem: async (key: string) => ls()?.getItem(key) ?? null,
  setItem: async (key: string, value: string) => {
    ls()?.setItem(key, value);
  },
  removeItem: async (key: string) => {
    ls()?.removeItem(key);
  },
};
