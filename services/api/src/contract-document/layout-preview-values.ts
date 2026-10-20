export function layoutPreviewValues(sampleData: unknown, billKeys: readonly string[] = []) {
  const values: Record<string, unknown> = {};
  const flatten = (value: unknown, prefix = "") => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      if (prefix) values[prefix] = value;
      return;
    }
    for (const [key, nested] of Object.entries(value)) {
      flatten(nested, prefix ? `${prefix}.${key}` : key);
    }
  };
  if (
    sampleData &&
    typeof sampleData === "object" &&
    !Array.isArray(sampleData) &&
    "values" in sampleData &&
    sampleData.values &&
    typeof sampleData.values === "object" &&
    !Array.isArray(sampleData.values)
  ) {
    Object.assign(values, sampleData.values);
  } else {
    flatten(sampleData);
  }
  for (const key of new Set([...billKeys, ...Object.keys(values).filter((key) => /^bill\.[^.]+$/.test(key))])) {
    if (!Array.isArray(values[key])) throw new Error("合同版式预览清单数据格式不正确");
  }
  values["contract.name"] ??= "版式预览合同";
  values["contract.temporaryCode"] ??= "预览";
  values["document.watermark"] ??= "预览";
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      typeof value === "boolean" ? String(value) : value
    ])
  );
}
