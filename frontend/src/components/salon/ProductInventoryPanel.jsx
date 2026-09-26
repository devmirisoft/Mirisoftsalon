import { useState } from "react";
import { Col, Row } from "reactstrap";
import { Button, Icon } from "@/components/Component";
import DataGrid from "./DataGrid";
import { KpiCard, formatQty } from "./ProductForms";
import {
  OpenContainerModal,
  ReconcileContainerModal,
  TransferStockModal,
  formatAmount,
  packName,
} from "./InventoryModals";
import { formatDate } from "@/utils/salonFormat";

const STATUS_COLORS = { OPEN: "success", EMPTY: "light", LOST: "danger", DAMAGED: "warning" };
const RECONCILE_ROLES = ["SUPER_ADMIN", "SALON_ADMIN", "BRANCH_MANAGER"];

/**
 * Where a product is (warehouse, retail, service, opened containers), how
 * much services used and what was wasted or lost. Reads one API response.
 */
const ProductInventoryPanel = ({ inventory, role, onChanged }) => {
  const [modal, setModal] = useState(null); // { kind, site?, container? }
  const { product, sites, containers, usage, usageByService, discrepancies, staff } = inventory;
  const unit = product.unit.toLowerCase();
  const usageUnit = product.usageUnit;
  const tracked = product.containerTracked;
  const pack = packName(product);
  const staffAt = (branchId) =>
    staff.filter((member) => !branchId || !member.branchId || member.branchId === branchId);
  const done = async () => {
    setModal(null);
    await onChanged();
  };

  return (
    <>
      {sites.map((site) => (
        <div className="card card-bordered mb-3" key={site.branchId || "salon"} data-site={site.branchName}>
          <div className="card-inner">
            <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
              <h6 className="overline-title text-soft mb-0">Current Stock · {site.branchName}</h6>
              <div className="d-flex gap-2">
                <Button size="sm" color="primary" outline onClick={() => setModal({ kind: "transfer", site })}>
                  <Icon name="swap" />
                  <span>Transfer Stock</span>
                </Button>
                {tracked && (
                  <Button size="sm" color="primary" onClick={() => setModal({ kind: "open", site })}>
                    <Icon name="plus" />
                    <span>Open New {pack}</span>
                  </Button>
                )}
              </div>
            </div>
            <Row className="g-3">
              <Col xs="6" lg="3"><KpiCard label="Warehouse" value={`${formatQty(site.WAREHOUSE)} ${unit}`} /></Col>
              <Col xs="6" lg="3"><KpiCard label="Retail" value={`${formatQty(site.RETAIL)} ${unit}`} /></Col>
              <Col xs="6" lg="3">
                <KpiCard
                  label={tracked ? "Sealed Service Stock" : "Service"}
                  value={`${formatQty(tracked ? site.sealedService : site.SERVICE)} ${unit}`}
                />
              </Col>
              {tracked && (
                <Col xs="6" lg="3">
                  <KpiCard
                    label="Open Containers"
                    value={
                      <>
                        {site.openContainers}
                        <span className="fs-6 fw-normal text-soft"> · {formatAmount(site.openRemaining, usageUnit)} left</span>
                      </>
                    }
                  />
                  <div className="form-note mt-1">
                    Open packs stay in service stock until they are finished.
                  </div>
                </Col>
              )}
            </Row>
          </div>
        </div>
      ))}

      {tracked && (
        <div className="mb-4">
          <h6 className="overline-title text-soft mb-2">Containers</h6>
          <DataGrid
            rows={containers}
            emptyText={`No ${pack.toLowerCase()} opened yet.`}
            columns={[
              { key: "code", label: pack, render: (value) => <strong>{value}</strong> },
              {
                key: "remainingQuantity",
                label: "Remaining",
                render: (value, row) => `${formatAmount(value, row.unit)} of ${formatAmount(row.originalQuantity, row.unit)}`,
              },
              {
                key: "status",
                label: "Status",
                render: (value) => <span className={`badge badge-dim bg-${STATUS_COLORS[value] || "light"}`}>{value}</span>,
              },
              { key: "openedByStaff", label: "Opened by", render: (value, row) => value?.name || row.openedBy?.name || "—" },
              { key: "openedAt", label: "Opened", render: (value) => formatDate(value, true) },
              { key: "closedAt", label: "Emptied / closed", render: (value) => (value ? formatDate(value, true) : "—") },
              ...(sites.length > 1
                ? [{ key: "branch", label: "Branch", render: (value) => value?.name || "Salon level" }]
                : []),
            ]}
            renderActions={
              RECONCILE_ROLES.includes(role)
                ? (row) =>
                    ["OPEN", "EMPTY"].includes(row.status) ? (
                      <Button onClick={() => setModal({ kind: "reconcile", container: row })}>
                        <Icon name="edit" />
                        <span>Reconcile stock</span>
                      </Button>
                    ) : null
                : undefined
            }
          />
        </div>
      )}

      <h6 className="overline-title text-soft mb-2">Usage</h6>
      <Row className="g-3 mb-3">
        <Col xs="4"><KpiCard label="Today" value={formatAmount(usage?.today, usageUnit)} /></Col>
        <Col xs="4"><KpiCard label="This Week" value={formatAmount(usage?.week, usageUnit)} /></Col>
        <Col xs="4"><KpiCard label="This Month" value={formatAmount(usage?.month, usageUnit)} /></Col>
      </Row>
      <Row className="g-3 mb-4">
        <Col lg="7">
          <DataGrid
            rows={usageByService}
            emptyText="No service has used this product yet."
            columns={[
              { key: "serviceName", label: "Service" },
              { key: "used", label: "Used", render: (value) => formatAmount(value, usageUnit) },
              { key: "lines", label: "Services" },
              {
                key: "averageExpected",
                label: "Expected",
                render: (value) => (value === null ? "—" : formatAmount(value, usageUnit)),
              },
              { key: "averageActual", label: "Average actual", render: (value) => formatAmount(value, usageUnit) },
            ]}
          />
        </Col>
        <Col lg="5">
          <div className="card card-bordered h-100">
            <div className="card-inner">
              <h6 className="overline-title text-soft mb-3">Usage vs discrepancies</h6>
              {[
                ["Recorded service usage", discrepancies.serviceUsage],
                ["Wastage", discrepancies.wastage],
                ["Lost", discrepancies.lost],
                ["Damaged", discrepancies.damaged],
                ["Adjustments (net)", discrepancies.adjustments],
              ].map(([label, value]) => (
                <div key={label} className="d-flex justify-content-between py-1 border-bottom border-light">
                  <span className="text-soft">{label}</span>
                  <strong>{formatAmount(value, usageUnit)}</strong>
                </div>
              ))}
            </div>
          </div>
        </Col>
      </Row>

      <TransferStockModal
        isOpen={modal?.kind === "transfer"}
        toggle={() => setModal(null)}
        product={product}
        branchId={modal?.site?.branchId ?? null}
        stock={modal?.site || {}}
        salonWarehouse={
          modal?.site?.branchId
            ? sites.find((site) => !site.branchId)?.WAREHOUSE || 0
            : 0
        }
        staff={staffAt(modal?.site?.branchId)}
        serviceOnly={role === "STAFF"}
        toLocation={role === "STAFF" ? "SERVICE" : "RETAIL"}
        onSaved={done}
      />
      <OpenContainerModal
        isOpen={modal?.kind === "open"}
        toggle={() => setModal(null)}
        product={product}
        branchId={modal?.site?.branchId ?? null}
        sealed={modal?.site?.sealedService ?? modal?.site?.SERVICE}
        staff={staffAt(modal?.site?.branchId)}
        onSaved={done}
      />
      <ReconcileContainerModal
        isOpen={modal?.kind === "reconcile"}
        toggle={() => setModal(null)}
        container={modal?.container}
        onSaved={done}
      />
    </>
  );
};

export default ProductInventoryPanel;
