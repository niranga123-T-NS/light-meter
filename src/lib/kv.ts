// Device key-value storage backed by SQLite (survives restarts, works offline).
import Storage from 'expo-sqlite/kv-store';

export const kv = {
  getItem: (key: string) => Storage.getItemAsync(key),
  setItem: (key: string, value: string) => Storage.setItemAsync(key, value),
  removeItem: async (key: string) => {
    await Storage.removeItemAsync(key);
  },
};
