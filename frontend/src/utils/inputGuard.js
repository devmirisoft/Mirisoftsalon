// App-wide input rule: free-text fields take letters, digits, spaces and basic
// punctuation only; phone fields (type="tel") take at most 10 digits. Done once
// on `beforeinput` so every controlled React input is covered without per-field
// onChange code. Email, password, number and date inputs are left alone; any
// other field can opt out with a `data-allow-special` attribute.
const NOT_ALLOWED = /[^\p{L}\p{M}\p{N}\s.,\-'/&()]/gu;
const PHONE_DIGITS = 10;

// Returns the part of `data` the field may accept, given `room` characters left.
export const cleanInput = (kind, data, room) =>
  kind === "tel"
    ? data.replace(/\D/g, "").slice(0, Math.max(room, 0))
    : data.replace(NOT_ALLOWED, "");

const kindOf = (el) => {
  if (el.dataset.allowSpecial !== undefined || el.readOnly) return null;
  if (el.tagName === "TEXTAREA") return "text";
  if (el.tagName !== "INPUT") return null;
  if (el.type === "tel") return "tel";
  return el.type === "text" || el.type === "search" ? "text" : null;
};

export const installInputGuard = () =>
  document.addEventListener(
    "beforeinput",
    (event) => {
      const el = event.target;
      const kind = kindOf(el);
      if (!kind || typeof event.data !== "string" || !event.inputType.startsWith("insert")) return;
      const selected = (el.selectionEnd ?? 0) - (el.selectionStart ?? 0);
      const clean = cleanInput(kind, event.data, PHONE_DIGITS - (el.value.length - selected));
      if (clean === event.data) return;
      event.preventDefault();
      // Paste keeps its valid part; re-inserting fires beforeinput again, which now passes.
      if (clean) document.execCommand("insertText", false, clean);
    },
    true
  );
