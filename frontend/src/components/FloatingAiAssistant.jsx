import { useEffect, useRef, useState } from "react";
import { FaPaperPlane, FaRedoAlt, FaTimes } from "react-icons/fa";
import { useLocation, useNavigate } from "react-router-dom";
import { ApiError, request } from "../services/api";
import { getStoredSession } from "../services/auth";

// How long the "Mira AI" tooltip stays up on its own after a fresh login.
const LOGIN_HINT_MS = 3 * 60 * 1000;
const FAB_SIZE = 68;

function MiraMark({ size = 30 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" style={{ display: "block" }}>
      <defs>
        <linearGradient id="mira-ring" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#4f7cff" />
          <stop offset="1" stopColor="#b06cff" />
        </linearGradient>
      </defs>
      <path
        d="M22.6 6.8A11 11 0 1 0 26.9 14"
        fill="none"
        stroke="url(#mira-ring)"
        strokeWidth="3.2"
        strokeLinecap="round"
      />
      <circle cx="25.4" cy="8.6" r="2.6" fill="#a66bff" />
    </svg>
  );
}

function Sparkles() {
  return (
    <svg width="40" height="40" viewBox="0 0 32 32" aria-hidden="true" style={{ display: "block", flexShrink: 0 }}>
      <path d="M12 3l2.4 7.1L21.5 12.5l-7.1 2.4L12 22l-2.4-7.1L2.5 12.5l7.1-2.4z" fill="#c4a8ff" />
      <path d="M24 18l1.3 3.7L29 23l-3.7 1.3L24 28l-1.3-3.7L19 23l3.7-1.3z" fill="#9d7bff" />
    </svg>
  );
}

const QUICK_PROMPTS = [
  "What should I focus on today?",
  "How many staff do I have?",
  "Show today's appointments and revenue.",
  "What should I order first?",
];

const INITIAL_CHAT = [
  {
    role: "assistant",
    text: "Hi, I am Salon AI. Ask me about this screen, today's work, customers, billing, staff, inventory, or anything you need to understand in the salon.",
  },
];

export default function FloatingAiAssistant() {
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [chat, setChat] = useState(INITIAL_CHAT);
  const [conversationId, setConversationId] = useState(null);
  const bottomRef = useRef(null);
  const [hovered, setHovered] = useState(false);
  const [loginHint, setLoginHint] = useState(() => {
    const loggedInAt = getStoredSession()?.loggedInAt;
    return Boolean(loggedInAt) && Date.now() - loggedInAt < LOGIN_HINT_MS;
  });

  useEffect(() => {
    if (!loginHint) return undefined;
    const remaining = LOGIN_HINT_MS - (Date.now() - getStoredSession()?.loggedInAt);
    const timer = setTimeout(() => setLoginHint(false), Math.max(remaining, 0));
    return () => clearTimeout(timer);
  }, [loginHint]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat, loading]);

  // Backend suggests prompts per screen and per answer; fall back to the
  // static set only for the opening message.
  const lastAssistant = [...chat].reverse().find((item) => item.role === "assistant");
  const activePrompts = lastAssistant?.suggestedPrompts?.length
    ? lastAssistant.suggestedPrompts
    : chat.length === 1
      ? QUICK_PROMPTS
      : [];

  const send = async (preset) => {
    const text = (preset || message).trim();
    if (!text || loading) return;

    setMessage("");
    setChat((previous) => [...previous, { role: "user", text }]);
    setLoading(true);

    try {
      const response = await request("/api/ai-assistant/chat", {
        method: "POST",
        body: {
          message: text,
          ...(conversationId ? { conversationId } : {}),
          uiContext: buildUiContext(location),
        },
      });
      const data = response?.data;
      if (data?.conversationId) setConversationId(data.conversationId);

      setChat((previous) => [
        ...previous,
        {
          role: "assistant",
          text: data?.answer || "No answer returned.",
          cards: data?.cards || [],
          table: data?.table,
          suggestedActions: data?.suggestedActions || [],
          warnings: data?.warnings || [],
          suggestedPrompts: data?.suggestedPrompts || [],
          clarification: data?.clarification,
        },
      ]);
    } catch (error) {
      setChat((previous) => [
        ...previous,
        {
          role: "assistant",
          text:
            error instanceof ApiError
              ? error.message
              : "I could not reach Salon AI. Please try again.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const clearChat = () => {
    setMessage("");
    setConversationId(null);
    setChat(INITIAL_CHAT);
  };

  return (
    <>
      {!open && (
        <div
          style={styles.fabWrap}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          <div
            style={{ ...styles.tip, ...(hovered || loginHint ? styles.tipVisible : {}) }}
            aria-hidden="true"
          >
            <Sparkles />
            <div>
              <div style={styles.tipTitle}>Mira AI</div>
              <div style={styles.tipSub}>Your Salon Assistant</div>
            </div>
            <span style={styles.tipArrow} />
          </div>
          <button
            type="button"
            style={{ ...styles.fab, ...(hovered ? styles.fabHover : {}) }}
            onClick={() => {
              setLoginHint(false);
              setOpen(true);
            }}
            onFocus={() => setHovered(true)}
            onBlur={() => setHovered(false)}
            aria-label="Open Mira AI, your salon assistant"
          >
            <MiraMark size={34} />
          </button>
        </div>
      )}

      {open && (
        <section style={styles.box} role="dialog" aria-label="Salon AI assistant">
          <header style={styles.header}>
            <div style={styles.brand}>
              <span style={styles.avatar}>
                <MiraMark size={24} />
              </span>
              <div>
                <strong>Salon AI</strong>
                <div style={styles.sub}>{moduleLabel(inferModule(location.pathname))} aware</div>
              </div>
            </div>
            <div style={styles.headerActions}>
              <button
                type="button"
                style={styles.iconButton}
                onClick={clearChat}
                aria-label="Clear Salon AI chat"
                title="Clear chat"
                disabled={loading}
              >
                <FaRedoAlt />
              </button>
              <button
                type="button"
                style={styles.iconButton}
                onClick={() => setOpen(false)}
                aria-label="Close Salon AI assistant"
                title="Close"
              >
                <FaTimes />
              </button>
            </div>
          </header>

          <div style={styles.messages} aria-live="polite">
            {chat.map((item, index) => (
              <div
                key={`${item.role}-${index}`}
                style={{
                  ...styles.bubble,
                  ...(item.role === "user" ? styles.userBubble : styles.aiBubble),
                }}
              >
                {item.role === "assistant" && <div style={styles.aiName}>Salon AI</div>}
                <div style={styles.messageText}>{item.text}</div>

                {item.cards?.length > 0 && (
                  <div style={styles.cardGrid}>
                    {item.cards.slice(0, 4).map((card, cardIndex) => (
                      <div key={`${card.title}-${cardIndex}`} style={styles.infoCard}>
                        <span style={styles.cardTitle}>{card.title}</span>
                        {card.value && <strong style={styles.cardValue}>{card.value}</strong>}
                        {card.description && (
                          <span style={styles.cardDescription}>{card.description}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {item.table?.rows?.length > 0 && (
                  <div style={styles.tableWrap}>
                    <table style={styles.table}>
                      <thead>
                        <tr>
                          {item.table.columns.map((column) => (
                            <th key={column.key} style={styles.th}>
                              {column.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {item.table.rows.slice(0, 5).map((row, rowIndex) => (
                          <tr key={rowIndex}>
                            {item.table.columns.map((column) => (
                              <td key={column.key} style={styles.td}>
                                {formatCellValue(row[column.key])}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {item.warnings?.length > 0 && (
                  <div style={styles.warnings}>
                    {item.warnings.map((warning, warningIndex) => (
                      <div key={warningIndex}>{warning}</div>
                    ))}
                  </div>
                )}

                {item.suggestedActions?.length > 0 && (
                  <div style={styles.actionWrap}>
                    {item.suggestedActions.map((action) => (
                      <button
                        type="button"
                        key={action.id}
                        style={styles.action}
                        onClick={() => runSuggestedAction(action, navigate)}
                      >
                        {action.label}
                      </button>
                    ))}
                  </div>
                )}

                {item.clarification?.candidates?.length > 0 && (
                  <div style={styles.actionWrap}>
                    {item.clarification.candidates.map((candidate) => (
                      <button
                        type="button"
                        key={candidate.candidateId}
                        style={styles.action}
                        onClick={() => send(candidate.candidateId)}
                        disabled={loading}
                        title={candidate.description || candidate.label}
                      >
                        {candidate.label}
                      </button>
                    ))}
                  </div>
                )}

              </div>
            ))}

            {loading && (
              <div style={{ ...styles.bubble, ...styles.aiBubble, ...styles.loading }}>
                <span style={styles.dot} />
                <span style={styles.dot} />
                <span style={styles.dot} />
                Thinking through your salon data...
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {activePrompts.length > 0 && (
            <div style={styles.quickWrap}>
              {activePrompts.map((prompt) => (
                <button
                  type="button"
                  key={prompt}
                  style={styles.quick}
                  onClick={() => send(prompt)}
                  disabled={loading}
                >
                  {prompt}
                </button>
              ))}
            </div>
          )}

          <footer style={styles.composer}>
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  send();
                }
              }}
              placeholder="Ask Salon AI..."
              aria-label="Message Salon AI"
              style={styles.input}
              rows={2}
              maxLength={1000}
              disabled={loading}
            />
            <button
              type="button"
              style={{
                ...styles.send,
                ...(loading || !message.trim() ? styles.disabled : {}),
              }}
              onClick={() => send()}
              disabled={loading || !message.trim()}
              aria-label="Send message"
            >
              <FaPaperPlane />
            </button>
          </footer>
        </section>
      )}
    </>
  );
}

const styles = {
  fabWrap: {
    position: "fixed",
    right: 20,
    bottom: 72,
    zIndex: 9999,
    lineHeight: 1,
    fontFamily: "inherit",
  },
  fab: {
    width: FAB_SIZE,
    height: FAB_SIZE,
    padding: 0,
    border: "6px solid rgba(255,255,255,.9)",
    borderRadius: "50%",
    background: "radial-gradient(circle at 50% 40%, #ffffff 0%, #f6f5ff 100%)",
    backgroundClip: "padding-box",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    outline: "none",
    boxShadow:
      "0 0 0 1px rgba(124,108,255,.18), 0 0 18px 6px rgba(124,108,255,.35), 0 10px 28px rgba(79,70,229,.25)",
    transition: "transform .18s ease, box-shadow .18s ease",
  },
  fabHover: {
    transform: "scale(1.06)",
    boxShadow:
      "0 0 0 1px rgba(124,108,255,.28), 0 0 26px 10px rgba(124,108,255,.45), 0 12px 32px rgba(79,70,229,.3)",
  },
  tip: {
    position: "absolute",
    right: 0,
    bottom: "calc(100% + 16px)",
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "12px 20px 12px 14px",
    borderRadius: 16,
    background: "linear-gradient(120deg, #151a3d 0%, #26307a 60%, #4c5fd6 100%)",
    color: "#fff",
    textAlign: "left",
    whiteSpace: "nowrap",
    boxShadow: "0 12px 32px rgba(38,48,122,.4)",
    opacity: 0,
    transform: "translateY(6px)",
    transition: "opacity .18s ease, transform .18s ease",
    pointerEvents: "none",
  },
  tipVisible: {
    opacity: 1,
    transform: "translateY(0)",
  },
  tipTitle: {
    color: "#fff",
    fontSize: 22,
    fontWeight: 600,
    lineHeight: 1.1,
    letterSpacing: "-0.01em",
  },
  tipSub: {
    marginTop: 4,
    color: "rgba(255,255,255,.85)",
    fontSize: 13,
    lineHeight: 1.2,
  },
  // Sits under the button's centre, whatever the tooltip's width.
  tipArrow: {
    position: "absolute",
    right: FAB_SIZE / 2 - 9,
    top: "100%",
    width: 0,
    height: 0,
    borderLeft: "9px solid transparent",
    borderRight: "9px solid transparent",
    borderTop: "9px solid #2e3a8c",
  },
  box: {
    position: "fixed",
    right: 12,
    bottom: 12,
    width: "min(430px, calc(100vw - 24px))",
    height: "min(630px, calc(100vh - 24px))",
    background: "#fff",
    border: "1px solid #dce3f0",
    borderRadius: 14,
    boxShadow: "0 18px 45px rgba(15,23,42,.24)",
    zIndex: 9999,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  header: {
    padding: "14px 15px",
    background: "#243b6b",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  brand: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: "50%",
    background: "#fff",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  sub: {
    marginTop: 2,
    fontSize: 12,
    opacity: 0.78,
  },
  headerActions: {
    display: "flex",
    alignItems: "center",
    gap: 7,
  },
  iconButton: {
    border: 0,
    background: "rgba(255,255,255,.12)",
    color: "#fff",
    width: 32,
    height: 32,
    borderRadius: 8,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
  },
  messages: {
    flex: 1,
    padding: 14,
    overflowY: "auto",
    background: "#f7f8fb",
  },
  bubble: {
    maxWidth: "88%",
    marginBottom: 12,
    padding: "10px 12px",
    borderRadius: 13,
    fontSize: 13,
    lineHeight: 1.48,
  },
  aiBubble: {
    marginRight: "auto",
    background: "#fff",
    color: "#111827",
    border: "1px solid #e1e8f2",
    borderBottomLeftRadius: 4,
  },
  userBubble: {
    marginLeft: "auto",
    background: "#243b6b",
    color: "#fff",
    borderBottomRightRadius: 4,
  },
  aiName: {
    marginBottom: 5,
    color: "#526484",
    fontSize: 11,
    fontWeight: 700,
  },
  messageText: {
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  },
  cardGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 7,
    marginTop: 10,
  },
  infoCard: {
    display: "grid",
    gap: 2,
    minWidth: 0,
    padding: 8,
    borderRadius: 8,
    background: "#f8fafc",
    border: "1px solid #e7edf6",
  },
  cardTitle: {
    color: "#64748b",
    fontSize: 11,
  },
  cardValue: {
    color: "#111827",
    fontSize: 15,
    overflowWrap: "anywhere",
  },
  cardDescription: {
    color: "#526484",
    fontSize: 11,
  },
  tableWrap: {
    marginTop: 10,
    border: "1px solid #e1e8f2",
    borderRadius: 8,
    overflowX: "auto",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 11,
  },
  th: {
    padding: "7px 8px",
    background: "#f8fafc",
    color: "#526484",
    textAlign: "left",
    whiteSpace: "nowrap",
  },
  td: {
    padding: "7px 8px",
    borderTop: "1px solid #eef2f7",
    color: "#111827",
  },
  warnings: {
    marginTop: 10,
    padding: 8,
    borderRadius: 8,
    background: "#fff7ed",
    color: "#9a3412",
    border: "1px solid #fed7aa",
    fontSize: 11,
  },
  actionWrap: {
    marginTop: 10,
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
  },
  action: {
    border: "1px solid #243b6b",
    background: "#fff",
    color: "#243b6b",
    borderRadius: 999,
    padding: "6px 9px",
    fontSize: 11,
    fontWeight: 700,
    cursor: "pointer",
  },
  loading: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    color: "#526484",
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: "50%",
    display: "inline-block",
    background: "#212e6b",
  },
  quickWrap: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 7,
    padding: "10px 12px",
    background: "#fff",
    borderTop: "1px solid #eef2f7",
  },
  quick: {
    border: "1px solid #dbe4f0",
    background: "#f8fafc",
    color: "#334155",
    borderRadius: 8,
    padding: "7px 8px",
    fontSize: 11,
    textAlign: "left",
    cursor: "pointer",
  },
  composer: {
    display: "flex",
    gap: 8,
    padding: 10,
    borderTop: "1px solid #e7ecf5",
    background: "#fff",
  },
  input: {
    flex: 1,
    resize: "none",
    border: "1px solid #d7e0ec",
    borderRadius: 10,
    padding: "9px 10px",
    fontSize: 13,
    lineHeight: 1.35,
    outline: "none",
  },
  send: {
    width: 42,
    border: 0,
    borderRadius: 10,
    background: "#243b6b",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    flex: "0 0 auto",
  },
  disabled: {
    cursor: "not-allowed",
    opacity: 0.55,
  },
};

function inferModule(pathname) {
  if (pathname === "/") return "DASHBOARD";
  if (pathname.includes("appointments")) return "APPOINTMENTS";
  if (pathname.includes("customers") || pathname.includes("job-carts/customers")) return "CUSTOMERS";
  if (pathname.includes("billing") || pathname.includes("invoice")) return "BILLING";
  if (pathname.includes("low-stock") || pathname.includes("inventory") || pathname.includes("products") || pathname.includes("stock")) return "INVENTORY";
  if (pathname.includes("staff") || pathname.includes("attendance") || pathname.includes("leaves")) return "STAFF";
  if (pathname.includes("memberships")) return "MEMBERSHIPS";
  if (pathname.includes("packages")) return "PACKAGES";
  if (pathname.includes("expenses")) return "EXPENSES";
  if (pathname.includes("reports")) return "REPORTS";
  if (pathname.includes("settings")) return "SETTINGS";
  return "OTHER";
}

function moduleLabel(module) {
  return String(module || "OTHER")
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatCellValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return new Date(value).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return String(value).replaceAll("_", " ");
}

function selectedEntityFromPath(pathname) {
  const invoiceMatch = pathname.match(/billing\/invoices\/([^/]+)/);
  if (invoiceMatch?.[1]) return { type: "INVOICE", id: invoiceMatch[1] };
  const jobCartCustomerMatch = pathname.match(/job-carts\/customers\/([^/]+)/);
  if (jobCartCustomerMatch?.[1]) return { type: "CUSTOMER", id: jobCartCustomerMatch[1] };
  const jobCartMatch = pathname.match(/job-carts\/([^/]+)/);
  if (jobCartMatch?.[1] && jobCartMatch[1] !== "create") {
    return { type: "APPOINTMENT", id: jobCartMatch[1] };
  }
  return undefined;
}

function buildUiContext(location) {
  return {
    route: `${location.pathname}${location.search || ""}`,
    module: inferModule(location.pathname),
    pageTitle: document.title || undefined,
    selectedEntity: selectedEntityFromPath(location.pathname),
  };
}

function runSuggestedAction(action, navigate) {
  if (action.actionType === "NAVIGATE" && action.payload?.route) {
    navigate(action.payload.route);
  }
  if (action.actionType === "OPEN_ENTITY") {
    const { entityType, entityId } = action.payload || {};
    if (entityType === "INVOICE") navigate(`/billing/invoices/${entityId}`);
    if (entityType === "APPOINTMENT") navigate("/appointments");
    if (entityType === "CUSTOMER") navigate("/customers");
    if (entityType === "PRODUCT") navigate("/admin/products");
    if (entityType === "STAFF") navigate("/reports/staff-performance");
  }
}
