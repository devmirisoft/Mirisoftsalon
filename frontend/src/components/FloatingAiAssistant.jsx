import { useEffect, useRef, useState } from "react";
import { FaPaperPlane, FaRedoAlt, FaTimes } from "react-icons/fa";
import { useLocation, useNavigate } from "react-router-dom";
import { ApiError, request } from "../services/api";

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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat, loading]);

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
        <button
          type="button"
          style={styles.fab}
          onClick={() => setOpen(true)}
          aria-label="Open Salon AI assistant"
          title="Open Salon AI"
        >
          <img src="/salon ai logo.png" alt="" style={styles.fabLogo} />
          
        </button>
      )}

      {open && (
        <section style={styles.box} role="dialog" aria-label="Salon AI assistant">
          <header style={styles.header}>
            <div style={styles.brand}>
              <span style={styles.avatar}>
                <img src="/salon ai logo.png" alt="" style={styles.logo} />
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

          {chat.length === 1 && (
            <div style={styles.quickWrap}>
              {QUICK_PROMPTS.map((prompt) => (
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
  fab: {
    position: "fixed",
    right: 20,
    bottom: 72,
    height: 54,
    border: 0,
    borderRadius: 999,
    color: "#fff",
    display: "inline-flex",
    alignItems: "center",
    gap: 9,
    fontSize: 14,
    fontWeight: 700,
    cursor: "pointer",
    boxShadow: "0 12px 28px rgba(15,23,42,.24)",
    zIndex: 9999,
  },
  fabLogo: {
    width: 46,
    height: 46,
    borderRadius: "50%",
    objectFit: "cover",
    background: "#fff",
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
  logo: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
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
    background: "#6576ff",
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
