export function serializeErr(err: any) {
  const out: Record<string, any> = {
    name: err?.name || "Error",
    message: err?.message || String(err),
  };
  if (err?.stack) out.stack = err.stack;

  // OpenAI / fetch response helpers
  if (err?.status) out.status = err.status;
  if (err?.statusText) out.statusText = err.statusText;
  if (err?.response?.status) out.httpStatus = err.response.status;
  if (err?.response?.statusText) out.httpStatusText = err.response.statusText;
  if (err?.response?.data) out.httpData = err.response.data;
  if (err?.code) out.code = err.code;

  // Supabase
  if (err?.hint) out.hint = err.hint;
  if (err?.details) out.details = err.details;

  // Zod
  if (err?.issues) out.issues = err.issues;

  // Anything else attached
  for (const k of ["body", "provider", "combo", "requestId", "preview"]) {
    if (err?.[k]) out[k] = err[k];
  }
  return out;
}
