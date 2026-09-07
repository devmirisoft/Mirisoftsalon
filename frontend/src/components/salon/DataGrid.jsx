/* eslint-disable react/prop-types */
import { Icon } from "@/components/Component";
import { LoaderOne } from "@/components/ui/loader";
import RowActionsMenu, { ActionMenuItem } from "./RowActionsMenu";
import { formatDisplayValue } from "@/utils/salonFormat";

const RowActions = ({ row, onView, onEdit, onDelete, renderActions }) => (
  <RowActionsMenu
    leading={
      <>
        {onView && (
          <ActionMenuItem
            icon={<Icon name="eye" />}
            label="Edit details"
            onClick={() => onView(row)}
          />
        )}
        {onEdit && (
          <ActionMenuItem
            icon={<Icon name="edit" />}
            label="Edit"
            onClick={() => onEdit(row)}
          />
        )}
      </>
    }
    trailing={
      onDelete && (
        <>
          <li className="divider"></li>
          <ActionMenuItem
            icon={<Icon name="trash" />}
            label="Delete"
            className="text-danger"
            onClick={() => onDelete(row)}
          />
        </>
      )
    }
  >
    {renderActions?.(row)}
  </RowActionsMenu>
);

const DataGrid = ({
  rows,
  columns,
  loading,
  emptyText = "No records found.",
  onView,
  onEdit,
  onDelete,
  renderActions,
}) => {
  const hasActions = Boolean(onView || onEdit || onDelete || renderActions);

  return (
    <div className="card card-bordered">
      <div className="table-responsive">
        <table className="table table-tranx">
          <thead>
            <tr className="tb-tnx-head">
              {columns.map((column) => (
                <th key={column.key}>{column.label}</th>
              ))}
              {hasActions && <th className="text-end">Actions</th>}
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
                        : formatDisplayValue(row[column.key])}
                    </td>
                  ))}
                  {hasActions && (
                    <td className="text-end text-nowrap">
                      <RowActions
                        row={row}
                        onView={onView}
                        onEdit={onEdit}
                        onDelete={onDelete}
                        renderActions={renderActions}
                      />
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
};

export default DataGrid;
