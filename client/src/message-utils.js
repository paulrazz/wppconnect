export function serializedId(id) {
  if (typeof id === 'string') return id;
  return id?._serialized || id?.id || '';
}
