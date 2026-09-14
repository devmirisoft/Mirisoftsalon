const PAGE_SIZES = [10, 25, 50, 100];

// 1 … 4 5 [6] 7 8 … 20 — a five-page window clamped to the ends, with the
// first/last page always reachable.
const pageWindow = (page, total) => {
  if (total <= 7) return [...Array(total)].map((_, index) => index + 1);
  const start = Math.max(1, Math.min(page - 2, total - 4));
  const window = [...Array(5)].map((_, index) => start + index);
  const last = window[window.length - 1];
  return [
    ...(start > 2 ? [1, "…"] : start > 1 ? [1] : []),
    ...window,
    ...(last < total - 1 ? ["…", total] : last < total ? [total] : []),
  ];
};

const ServerPagination = ({ pagination, onPage, onLimit }) => {
  if (!pagination || !pagination.total) return null;
  const { page = 1, totalPages = 1, total, limit = 20 } = pagination;
  const first = (page - 1) * limit + 1;

  return (
    <div className="server-pagination">
      {onLimit && (
        <div className="server-pagination-size">
          <span>Show</span>
          <select
            className="form-select form-select-sm"
            value={limit}
            onChange={(event) => onLimit(Number(event.target.value))}
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
          <span>entries per page</span>
        </div>
      )}
      <ul className="pagination pagination-sm mb-0">
        <li className={`page-item ${page <= 1 ? "disabled" : ""}`}>
          <button
            type="button"
            className="page-link"
            disabled={page <= 1}
            onClick={() => onPage(page - 1)}
          >
            Previous
          </button>
        </li>
        {pageWindow(page, totalPages).map((entry, index) =>
          entry === "…" ? (
            <li key={`gap-${index}`} className="page-item disabled">
              <span className="page-link">…</span>
            </li>
          ) : (
            <li
              key={entry}
              className={`page-item ${entry === page ? "active" : ""}`}
            >
              <button
                type="button"
                className="page-link"
                onClick={() => onPage(entry)}
              >
                {entry}
              </button>
            </li>
          )
        )}
        <li className={`page-item ${page >= totalPages ? "disabled" : ""}`}>
          <button
            type="button"
            className="page-link"
            disabled={page >= totalPages}
            onClick={() => onPage(page + 1)}
          >
            Next
          </button>
        </li>
      </ul>
      <small className="server-pagination-count">
        Showing {first}–{Math.min(first + limit - 1, total)} of {total} records
      </small>
    </div>
  );
};

export default ServerPagination;
