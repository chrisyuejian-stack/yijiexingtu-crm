export function logger(record) { console.log(JSON.stringify({at:new Date().toISOString(),...record})); }
export function safeError(error) {
  // Errors from SDKs may contain signed URLs/Authorization. Do not log those objects.
  return {name:error?.name || 'Error',code:String(error?.code || 'unknown').slice(0,80)};
}
