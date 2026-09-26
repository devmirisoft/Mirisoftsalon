/* eslint-disable react-refresh/only-export-components, react-hooks/set-state-in-effect */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Col,
  Input,
  Label,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Row,
  Spinner,
} from "reactstrap";
import { Button, Icon } from "@/components/Component";
import SchemaModal from "./SchemaModal";
import { salonApi } from "@/services/salonApi";
import { allocateUsage, isValidQuantity } from "@/utils/usageAllocation";

export const LOCATIONS = [
  { value: "WAREHOUSE", label: "Warehouse" },
  { value: "RETAIL", label: "Retail" },
  { value: "SERVICE", label: "Service" },
];

export const locationLabel = (value) =>
  LOCATIONS.find((location) => location.value === value)?.label || "—";

const num = (value) => Number(value || 0);
const plain = (value) =>
  num(value).toLocaleString("en-IN", { maximumFractionDigits: 2 });

/** 1250 ML reads as 1.25 L; units are shown in lower case. */
export const formatAmount = (value, unit) => {
  const amount = num(value);
  if (unit === "ML" && Math.abs(amount) >= 1000) return `${plain(amount / 1000)} L`;
  if (unit === "GRAM" && Math.abs(amount) >= 1000) return `${plain(amount / 1000)} kg`;
  return `${plain(amount)} ${unit ? unit.toLowerCase() : ""}`.trim();
};

/** "Bottle" for a BOTTLE product, "Tube" for a TUBE, otherwise "Pack". */
export const packName = (product) =>
  ({ BOTTLE: "Bottle", TUBE: "Tube", BOX: "Box" })[product?.stockUnit || product?.unit] || "Pack";

const staffOptions = (staff = []) =>
  staff.map((member) => ({ value: member.id, label: member.name }));

// One id per opened form, so a double submit is applied once by the server.
const useRequestId = (isOpen) =>
  useMemo(() => (isOpen ? globalThis.crypto.randomUUID() : null), [isOpen]);

/**
 * Moves stock between locations of one branch, or from salon-level stock into
 * it. The same API serves Inventory, Make Bill, the job cart and usage.
 */
export const TransferStockModal = ({
  isOpen,
  toggle,
  product,
  branchId,
  stock = {},
  salonWarehouse = 0,
  staff = [],
  from = "WAREHOUSE",
  toLocation = "RETAIL",
  quantity = "",
  serviceOnly = false,
  submitLabel = "Transfer",
  onSaved,
}) => {
  const requestId = useRequestId(isOpen);
  const unit = (product?.stockUnit || product?.unit || "").toLowerCase();
  const fields = useMemo(
    () => [
      {
        name: "from",
        label: "From",
        type: "select",
        required: true,
        options: [
          ...LOCATIONS.map((location) => ({
            value: location.value,
            label: `${location.label} — ${plain(stock[location.value])} ${unit}`,
          })),
          ...(num(salonWarehouse) > 0
            ? [
                {
                  value: "SALON:WAREHOUSE",
                  label: `Salon-level warehouse — ${plain(salonWarehouse)} ${unit}`,
                },
              ]
            : []),
        ],
      },
      {
        name: "toLocation",
        label: "To",
        type: "select",
        required: true,
        options: serviceOnly
          ? LOCATIONS.filter((location) => location.value === "SERVICE")
          : LOCATIONS,
      },
      {
        name: "quantity",
        label: `Quantity${unit ? ` (${unit})` : ""}`,
        type: "number",
        min: 0.01,
        step: "0.01",
        required: true,
      },
      { name: "issuedByStaffId", label: "Issued by", type: "select", nullable: true, options: staffOptions(staff) },
      { name: "receivedByStaffId", label: "Received by", type: "select", nullable: true, options: staffOptions(staff) },
      { name: "note", label: "Note", nullable: true, fullWidth: true },
    ],
    [salonWarehouse, serviceOnly, staff, stock, unit]
  );
  const initialValues = useMemo(
    () => ({ from, toLocation, quantity }),
    [from, toLocation, quantity]
  );
  return (
    <SchemaModal
      isOpen={isOpen}
      toggle={toggle}
      title={`Transfer Stock — ${product?.name || ""}`}
      submitLabel={submitLabel}
      fields={fields}
      initialValues={initialValues}
      onSubmit={async (values) => {
        const salonLevel = values.from.startsWith("SALON:");
        if (!salonLevel && values.from === values.toLocation) {
          throw new Error("Choose two different locations.");
        }
        await salonApi.inventory.transfer({
          productId: product.id,
          ...(branchId !== undefined ? { branchId } : {}),
          fromLocation: salonLevel ? "WAREHOUSE" : values.from,
          fromSalonStock: salonLevel,
          toLocation: values.toLocation,
          quantity: values.quantity,
          ...(values.issuedByStaffId ? { issuedByStaffId: values.issuedByStaffId } : {}),
          ...(values.receivedByStaffId ? { receivedByStaffId: values.receivedByStaffId } : {}),
          ...(values.note ? { note: values.note } : {}),
          requestId,
        });
        await onSaved?.(values);
      }}
    />
  );
};

const OPEN_REASONS = [
  "Normal usage",
  "Previous one lost or misplaced",
  "Previous one damaged or contaminated",
  "Previous one unavailable",
  "Different variant needed",
  "Other",
].map((value) => ({ value, label: value }));

/** Opens sealed service stock into tracked containers; always available. */
export const OpenContainerModal = ({
  isOpen,
  toggle,
  product,
  branchId,
  sealed = 0,
  staff = [],
  onSaved,
}) => {
  const requestId = useRequestId(isOpen);
  const name = packName(product);
  const unit = (product?.stockUnit || product?.unit || "").toLowerCase();
  const fields = useMemo(
    () => [
      {
        name: "count",
        label: `${name}s to open`,
        type: "number",
        min: 1,
        step: "1",
        required: true,
        defaultValue: 1,
        help: `Available sealed service stock: ${plain(sealed)} ${unit}`,
      },
      {
        name: "openedByStaffId",
        label: "Opened by",
        type: "select",
        required: true,
        options: staffOptions(staff),
      },
      {
        name: "reason",
        label: "Reason",
        type: "select",
        required: true,
        defaultValue: "Normal usage",
        options: OPEN_REASONS,
      },
    ],
    [name, sealed, staff, unit]
  );
  return (
    <SchemaModal
      isOpen={isOpen}
      toggle={toggle}
      title={`Open New ${name} — ${product?.name || ""}`}
      submitLabel={`Open ${name}`}
      fields={fields}
      onSubmit={async (values) => {
        const response = await salonApi.inventory.openContainers({
          productId: product.id,
          ...(branchId !== undefined ? { branchId } : {}),
          count: values.count,
          openedByStaffId: values.openedByStaffId,
          reason: values.reason,
          requestId,
        });
        await onSaved?.(response.data.containers);
      }}
    />
  );
};

export const RECONCILE_REASONS = [
  { value: "WASTAGE", label: "Wastage" },
  { value: "SPILLAGE", label: "Spillage" },
  { value: "LOST", label: "Lost" },
  { value: "DAMAGED", label: "Damaged" },
  { value: "INCORRECT_USAGE", label: "Incorrect previous usage" },
  { value: "MEASUREMENT", label: "Measurement adjustment" },
  { value: "OTHER", label: "Other" },
];

/** Records what a physical check found in a container, under a reason. */
export const ReconcileContainerModal = ({ isOpen, toggle, container, onSaved }) => {
  const requestId = useRequestId(isOpen);
  const unit = container?.unit;
  const fields = useMemo(
    () => [
      {
        name: "system",
        label: "System remaining",
        readOnly: true,
        disabled: true,
        derive: () => formatAmount(container?.remainingQuantity, unit),
      },
      {
        name: "actualRemaining",
        label: `Actual remaining (${(unit || "").toLowerCase()})`,
        type: "number",
        min: 0,
        step: "0.01",
        required: true,
      },
      {
        name: "difference",
        label: "Difference",
        readOnly: true,
        disabled: true,
        derive: (values) => {
          if (values.actualRemaining === "" || values.actualRemaining === undefined) return "—";
          const hundredths =
            Math.round(num(values.actualRemaining) * 100) -
            Math.round(num(container?.remainingQuantity) * 100);
          return `${hundredths > 0 ? "+" : ""}${formatAmount(hundredths / 100, unit)}`;
        },
      },
      {
        name: "reason",
        label: "Reason",
        type: "select",
        required: true,
        options: RECONCILE_REASONS,
      },
      { name: "note", label: "Notes", type: "textarea", fullWidth: true, nullable: true },
    ],
    [container, unit]
  );
  return (
    <SchemaModal
      isOpen={isOpen}
      toggle={toggle}
      title={`Reconcile Stock — ${container?.code || ""}`}
      submitLabel="Record Adjustment"
      fields={fields}
      onSubmit={async (values) => {
        await salonApi.inventory.reconcile(container.id, {
          actualRemaining: values.actualRemaining,
          reason: values.reason,
          ...(values.note ? { note: values.note } : {}),
          requestId,
        });
        await onSaved?.();
      }}
    />
  );
};

const rowKey = (line, productId) => `${line.appointmentServiceId}:${productId}`;

/**
 * The usage step before a service is completed: the service consumables with
 * their expected quantity prefilled, the actual quantity editable, and the
 * container it comes from. Calls onConfirm(usage) with one entry per line,
 * product and container; nothing is booked until the caller completes.
 */
export const ProductUsageModal = ({
  isOpen,
  appointmentId,
  onCancel,
  onConfirm,
  title = "Record Product Usage",
  confirmLabel = "Confirm Usage",
}) => {
  const [plan, setPlan] = useState(null);
  const [values, setValues] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [helper, setHelper] = useState(null); // { kind: "open" | "transfer", product }

  const load = useCallback(
    async (keepEntries) => {
      setLoading(true);
      setError("");
      try {
        const { data } = await salonApi.inventory.usagePlan(appointmentId);
        setPlan(data);
        setValues((current) => {
          const next = {};
          for (const line of data.lines) {
            for (const consumable of line.consumables) {
              const key = rowKey(line, consumable.productId);
              next[key] =
                keepEntries && current[key]
                  ? current[key]
                  : { actual: String(num(consumable.expectedQuantity)), containerId: "" };
            }
          }
          return next;
        });
      } catch (loadError) {
        setError(loadError.message);
      } finally {
        setLoading(false);
      }
    },
    [appointmentId]
  );

  useEffect(() => {
    if (!isOpen || !appointmentId) return;
    setPlan(null);
    setValues({});
    load(false);
  }, [isOpen, appointmentId, load]);

  const products = useMemo(
    () => Object.fromEntries((plan?.products || []).map((product) => [product.id, product])),
    [plan]
  );
  const rows = useMemo(
    () =>
      (plan?.lines || []).flatMap((line) =>
        line.consumables.map((consumable) => {
          const key = rowKey(line, consumable.productId);
          return {
            key,
            line,
            consumable,
            productId: consumable.productId,
            actual: values[key]?.actual ?? "",
            containerId: values[key]?.containerId || undefined,
          };
        })
      ),
    [plan, values]
  );
  const allocation = useMemo(
    () =>
      allocateUsage(
        rows.map((row) => ({
          key: row.key,
          productId: row.productId,
          actual: isValidQuantity(row.actual) ? row.actual : 0,
          containerId: row.containerId,
        })),
        products
      ),
    [rows, products]
  );
  const invalid = rows.some((row) => !isValidQuantity(row.actual));
  const short = rows.some((row) => allocation[row.key]?.shortfall > 0);

  const setValue = (key, patch) =>
    setValues((current) => ({ ...current, [key]: { ...current[key], ...patch } }));

  const confirm = async () => {
    // The shared Button only styles itself as disabled, so the guard lives
    // here: a second click while saving, or one on an unusable quantity,
    // does nothing.
    if (saving || invalid || short) return;
    setSaving(true);
    setError("");
    try {
      const usage = rows.flatMap((row) => {
        const base = {
          appointmentServiceId: row.line.appointmentServiceId,
          productId: row.productId,
        };
        // An explicit zero says "not used" rather than "use the default".
        if (num(row.actual) === 0) return [{ ...base, quantity: 0 }];
        return products[row.productId]?.containerTracked
          ? allocation[row.key].parts.map((part) => ({
              ...base,
              quantity: part.quantity,
              containerId: part.containerId,
            }))
          : [{ ...base, quantity: num(row.actual) }];
      });
      await onConfirm(usage);
    } catch (confirmError) {
      setError(confirmError.message);
    } finally {
      setSaving(false);
    }
  };

  // A service with no consumables has nothing to confirm: go straight on.
  useEffect(() => {
    if (isOpen && plan && plan.lines.length === 0) confirm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, plan]);

  const containerCode = (product, id) =>
    product.openContainers.find((container) => container.id === id)?.code || "";
  const helperProduct = helper ? products[helper.productId] : null;

  return (
    <Modal isOpen={isOpen} toggle={saving ? undefined : onCancel} size="lg" centered>
      <ModalHeader toggle={saving ? undefined : onCancel}>{title}</ModalHeader>
      <ModalBody>
        {error && (
          <Alert color="danger">
            <Icon name="alert-circle" className="me-1" />
            {error}
          </Alert>
        )}
        {!plan ? (
          <div className="text-center py-4">{loading && <Spinner color="primary" />}</div>
        ) : (
          plan.lines.map((line) => (
            <div key={line.appointmentServiceId} className="mb-4">
              <h6 className="mb-2">
                {line.serviceName}
                {line.staff ? <span className="text-soft small fw-normal"> · {line.staff.name}</span> : null}
              </h6>
              {line.consumables.map((consumable) => {
                const key = rowKey(line, consumable.productId);
                const product = products[consumable.productId];
                const part = allocation[key];
                const warehouse = num(product.stock?.WAREHOUSE) + num(product.salonWarehouse);
                // Only sealed packs can be opened; the open ones are in use.
                const sealed = num(product.sealedService ?? product.stock?.SERVICE);
                return (
                  <div key={key} className="border rounded p-3 mb-2" data-usage-row={product.name}>
                    <div className="d-flex justify-content-between flex-wrap gap-2">
                      <strong>{product.name}</strong>
                      <span className="text-soft small">
                        Expected <strong>{formatAmount(consumable.expectedQuantity, product.unit)}</strong>
                      </span>
                    </div>
                    <Row className="g-2 mt-1 align-items-end">
                      <Col sm="4">
                        <Label className="small mb-1" for={`actual-${key}`}>
                          Actual ({(product.unit || "").toLowerCase()})
                        </Label>
                        <Input
                          id={`actual-${key}`}
                          type="number"
                          min="0"
                          step="0.01"
                          disabled={saving}
                          value={values[key]?.actual ?? ""}
                          onChange={(event) => setValue(key, { actual: event.target.value })}
                        />
                      </Col>
                      <Col sm="8">
                        {product.containerTracked ? (
                          <>
                            <Label className="small mb-1" for={`source-${key}`}>Source</Label>
                            <Input
                              id={`source-${key}`}
                              type="select"
                              disabled={saving}
                              value={values[key]?.containerId || ""}
                              onChange={(event) => setValue(key, { containerId: event.target.value })}
                            >
                              <option value="">Oldest open first</option>
                              {product.openContainers.map((container) => (
                                <option key={container.id} value={container.id}>
                                  {container.code} — {formatAmount(container.remainingQuantity, container.unit)} remaining
                                </option>
                              ))}
                            </Input>
                          </>
                        ) : (
                          <div className="small text-soft pb-2">
                            Service stock: {plain(sealed)} {(product.stockUnit || "").toLowerCase()}
                          </div>
                        )}
                      </Col>
                    </Row>
                    {part?.parts.length > 1 && (
                      <div className="small text-soft mt-1">
                        Taken from{" "}
                        {part.parts
                          .map((piece) => `${containerCode(product, piece.containerId)} ${formatAmount(piece.quantity, product.unit)}`)
                          .join(" + ")}
                      </div>
                    )}
                    {!isValidQuantity(values[key]?.actual ?? "") && (
                      <div className="small text-danger mt-1">
                        Enter a quantity of 0 or more, with at most 2 decimals.
                      </div>
                    )}
                    {part?.shortfall > 0 && (
                      <Alert color="warning" className="mt-2 mb-0 py-2 small">
                        {product.containerTracked ? (
                          <>
                            Available service stock:{" "}
                            {product.openContainers.length
                              ? product.openContainers
                                  .map((container) => `${container.code} → ${formatAmount(container.remainingQuantity, container.unit)}`)
                                  .join(", ")
                              : "no open " + packName(product).toLowerCase()}
                            {" · "}Required {formatAmount(values[key]?.actual, product.unit)}
                            {" · "}<strong>Shortfall {formatAmount(part.shortfall, product.unit)}</strong>
                          </>
                        ) : (
                          <>
                            Service stock is short by <strong>{formatAmount(part.shortfall, product.unit)}</strong>
                          </>
                        )}
                      </Alert>
                    )}
                    <div className="d-flex gap-2 mt-2 flex-wrap">
                      {product.containerTracked && (
                        <Button
                          size="sm"
                          color="primary"
                          outline
                          type="button"
                          disabled={saving || sealed <= 0}
                          title={sealed <= 0 ? "No sealed service stock left" : undefined}
                          onClick={() => setHelper({ kind: "open", productId: product.id })}
                        >
                          <Icon name="plus" />
                          <span>Open New {packName(product)}</span>
                        </Button>
                      )}
                      {warehouse > 0 && (sealed <= 0 || part?.shortfall > 0) && (
                        <Button
                          size="sm"
                          color="light"
                          type="button"
                          disabled={saving}
                          onClick={() => setHelper({ kind: "transfer", productId: product.id })}
                        >
                          <Icon name="swap" />
                          <span>Transfer From Warehouse</span>
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </ModalBody>
      <ModalFooter>
        <Button color="light" type="button" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button
          color="primary"
          type="button"
          onClick={confirm}
          disabled={saving || loading || !plan || invalid || short}
        >
          {saving && <Spinner size="sm" className="me-1" />}
          {confirmLabel}
        </Button>
      </ModalFooter>

      <OpenContainerModal
        isOpen={helper?.kind === "open"}
        toggle={() => setHelper(null)}
        product={helperProduct}
        branchId={helperProduct?.branchId}
        sealed={num(helperProduct?.stock?.SERVICE)}
        staff={plan?.staff || []}
        onSaved={() => load(true)}
      />
      <TransferStockModal
        isOpen={helper?.kind === "transfer"}
        toggle={() => setHelper(null)}
        product={helperProduct}
        branchId={helperProduct?.branchId}
        stock={helperProduct?.stock}
        salonWarehouse={helperProduct?.salonWarehouse}
        staff={plan?.staff || []}
        from={num(helperProduct?.stock?.WAREHOUSE) > 0 ? "WAREHOUSE" : "SALON:WAREHOUSE"}
        toLocation="SERVICE"
        serviceOnly
        onSaved={() => load(true)}
      />
    </Modal>
  );
};
