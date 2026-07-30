/* eslint-disable react/prop-types */
import { Button, Icon } from "@/components/Component";
import { LoaderOne } from "@/components/ui/loader";

const DataGrid = ({
  rows,
  columns,
  loading,
  emptyText = "No records found.",
  onView,
  onEdit,
  onDelete,
  renderActions,
}) => (
  <div className="card card-bordered">
    <div className="table-responsive">
      <table className="table table-tranx">
        <thead>
          <tr className="tb-tnx-head">
            {columns.map((column) => (
              <th key={column.key}>{column.label}</th>
            ))}
            {(onView || onEdit || onDelete || renderActions) && (
              <th className="text-end">Actions</th>
            )}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={columns.length + 1} className="text-center py-5">
                <div className="d-flex flex-column align-items-center gap-2 text-primary">
                  <LoaderOne label="Loading live data" />
                  <span>Loading live data...</span>
                </div>
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length + 1}
                className="text-center text-soft py-5"
              >
                {emptyText}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.id}>
                {columns.map((column) => (
                  <td key={column.key}>
                    {column.render
                      ? column.render(row[column.key], row)
                      : row[column.key] ?? "—"}
                  </td>
                ))}
                {(onView || onEdit || onDelete || renderActions) && (
                  <td className="text-end text-nowrap">
                    {renderActions?.(row)}
                    {onView && (
                      <Button
                        size="sm"
                        color="light"
                        className="btn-icon ms-1"
                        title="View details"
                        onClick={() => onView(row)}
                      >
                        <Icon name="eye" />
                      </Button>
                    )}
                    {onEdit && (
                      <Button
                        size="sm"
                        color="light"
                        className="btn-icon ms-1"
                        title="Edit"
                        onClick={() => onEdit(row)}
                      >
                        <Icon name="edit" />
                      </Button>
                    )}
                    {onDelete && (
                      <Button
                        size="sm"
                        color="danger"
                        outline
                        className="btn-icon ms-1"
                        title="Delete"
                        onClick={() => onDelete(row)}
                      >
                        <Icon name="trash" />
                      </Button>
                    )}
                  </td>
                )}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  </div>
);

export default DataGrid;
