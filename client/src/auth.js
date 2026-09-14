import { get, set, del } from 'idb-keyval';

const API_KEY_STORE = 'wppconnect_api_key';

export async function getApiKey() {
  return await get(API_KEY_STORE);
}

export async function setApiKey(key) {
  return await set(API_KEY_STORE, key);
}

export async function removeApiKey() {
  return await del(API_KEY_STORE);
}
