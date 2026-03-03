export async function ensureRuntimeCatalogBody({
  bodyMeta,
  hasBody,
  registerBody,
  createBodyVisual,
  mountBodyVisual,
  rebuildBodyLegend,
  onError,
} = {}) {
  const id = String(bodyMeta?.id || "").trim();
  if (!id) {
    return false;
  }
  if (typeof hasBody === "function" && hasBody(id)) {
    return true;
  }

  const normalized = {
    ...bodyMeta,
    id,
    name: String(bodyMeta?.name || id),
    body_type: String(bodyMeta?.body_type || "spacecraft"),
    parent: String(bodyMeta?.parent || "earth"),
  };

  if (typeof registerBody === "function") {
    registerBody(normalized);
  }

  try {
    const visual = await createBodyVisual?.(normalized);
    if (visual?.root && typeof mountBodyVisual === "function") {
      mountBodyVisual(visual);
    }
  } catch (error) {
    if (typeof onError === "function") {
      onError(error, id);
    }
  }

  rebuildBodyLegend?.();
  return true;
}
