const SENSITIVE_KEYS =
  /password|passwordhash|accesstoken|refreshtoken|refreshtokenhash|token|jwt|secret|apikey|authorization|cookie|paymentsecret|providersecret|phone|email|address|gst|note/i;

export function redactAiData(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactAiData(item));
  }

  if (value instanceof Date) {
    return value;
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        SENSITIVE_KEYS.test(key) ? "[REDACTED]" : redactAiData(item),
      ])
    );
  }

  return value;
}
