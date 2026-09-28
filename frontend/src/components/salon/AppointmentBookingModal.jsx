/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useMemo, useState } from "react";
import { CreatableSelect } from "@/components/select/PortalSelect";
import {
  Alert,
  Col,
  Form,
  FormGroup,
  Input,
  InputGroup,
  Label,
  Modal,
  ModalBody,
  ModalHeader,
  Row,
  Spinner,
} from "reactstrap";
import { Button, Icon } from "@/components/Component";
import ServicePickerModal from "@/components/salon/ServicePickerModal";
import { salonApi } from "@/services/salonApi";
import { serviceMinutes } from "@/utils/appointmentTotals";
import {
  cappedDiscount,
  netPrice,
  priceToTotal,
  qtyOf,
  round2,
  totalToPrice,
} from "@/utils/lineItemPricing";
import {
  formatDate,
  formatMoney,
  labelize,
  minDateTimeInput,
} from "@/utils/salonFormat";

const emptyForm = {
  salonId: "",
  branchId: "",
  customerId: "",
  customerPhone: "",
  startTime: "",
  status: "SCHEDULED",
  bookingNote: "",
  internalNote: "",
};

const digitsOf = (value) => String(value || "").replace(/\D/g, "");

// One place that keeps price / discount / qty / total consistent.
// Editing total back-solves price; editing anything else re-derives total.
const reprice = (row, patch, gstPercent) => {
  const next = { ...row, ...patch };
  if ("total" in patch) {
    next.price = totalToPrice(
      next.total,
      next.qty,
      gstPercent,
      next.discount,
      next.discountType
    );
    return next;
  }
  next.discount = cappedDiscount(next.price, next.discount, next.discountType);
  next.total = priceToTotal(
    next.price,
    next.qty,
    gstPercent,
    next.discount,
    next.discountType
  );
  return next;
};

const newRow = (service, staffId, gstPercent) =>
  reprice(
    {
      serviceId: service.id,
      staffId,
      qty: "1",
      price: String(service.price ?? ""),
      discount: "",
      discountType: "AMT",
      total: "",
    },
    {},
    gstPercent
  );

// One line of the booking cart. `item` is the row plus derived display values.
const CartRow = ({ item, gstPercent, staff, saving, onEdit, onRemove }) => {
  const discounted = Number(item.discount) > 0 ? item.unit : null;
  return (
    <tr>
      <td>
        <span className="booking-service-name">{item.name}</span>
        <small className="d-block text-soft">
          <Icon name="clock" />{" "}
          {item.minutes ? `${item.minutes} min` : "Duration not set"}
        </small>
      </td>
      <td>
        <Input
          type="select"
          bsSize="sm"
          value={item.staffId}
          disabled={saving}
          onChange={(e) => onEdit({ staffId: e.target.value })}
        >
          <option value="">Use primary staff</option>
          {staff.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
              {member.jobRole ? ` - ${member.jobRole}` : ""}
            </option>
          ))}
        </Input>
      </td>
      <td>
        <Input
          type="number"
          bsSize="sm"
          min="1"
          step="1"
          aria-label={`Quantity for ${item.name}`}
          value={item.qty}
          disabled={saving}
          onChange={(e) => onEdit({ qty: e.target.value })}
        />
      </td>
      <td>
        <div className="jobcart-price-field">
          <Input
            type="number"
            bsSize="sm"
            min="0"
            step="0.01"
            aria-label={`Price for ${item.name}`}
            value={item.price}
            disabled={saving}
            style={discounted === null ? undefined : { paddingRight: 82 }}
            onChange={(e) => onEdit({ price: e.target.value })}
          />
          {discounted !== null && (
            <span className="jobcart-net-price" title="Price after discount">
              {formatMoney(discounted)}
            </span>
          )}
        </div>
      </td>
      <td>
        <InputGroup size="sm" className="flex-nowrap">
          <Input
            type="number"
            min="0"
            step="0.01"
            max={
              item.discountType === "PCT"
                ? "100"
                : String(Math.max(0, Number(item.price || 0)))
            }
            aria-label={`Discount for ${item.name}`}
            value={item.discount}
            disabled={saving}
            style={{ minWidth: 0 }}
            onChange={(e) => onEdit({ discount: e.target.value })}
          />
          <button
            type="button"
            className="input-group-text jobcart-discount-unit"
            disabled={saving}
            title="Switch discount type"
            onClick={() =>
              onEdit({ discountType: item.discountType === "PCT" ? "AMT" : "PCT" })
            }
          >
            {item.discountType === "PCT" ? "%" : <>&#8377;</>}
          </button>
        </InputGroup>
      </td>
      <td className="text-end text-soft">{gstPercent}%</td>
      <td>
        <Input
          type="number"
          bsSize="sm"
          min="0"
          step="0.01"
          aria-label={`Total for ${item.name}`}
          value={item.total}
          disabled={saving}
          onChange={(e) => onEdit({ total: e.target.value })}
        />
      </td>
      <td className="text-end">
        <button
          type="button"
          className="booking-row-remove"
          title="Remove service"
          disabled={saving}
          onClick={onRemove}
        >
          <Icon name="trash" />
        </button>
      </td>
    </tr>
  );
};

const SummaryRow = ({ label, children }) => (
  <div className="booking-summary-row">
    <span>{label}</span>
    <strong>{children}</strong>
  </div>
);

const AppointmentBookingModal = ({
  isOpen,
  toggle,
  isSuper,
  lockBranch = false,
  defaultBranchId = "",
  statuses = [],
  refs = {},
  defaults,
  newCustomerId,
  onCreateCustomer,
  onSubmit,
}) => {
  const [form, setForm] = useState(emptyForm);
  const [rows, setRows] = useState([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerStaffId, setPickerStaffId] = useState("");
  const [gst, setGst] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const gstPercent =
    gst?.gstEnabled === false ? 0 : Number(gst?.serviceGstRate ?? 0);

  // ---- lifecycle -----------------------------------------------------------

  // Reset everything whenever the modal opens.
  useEffect(() => {
    if (!isOpen) return;
    setForm({
      ...emptyForm,
      ...defaults,
      ...(lockBranch
        ? { branchId: defaultBranchId || defaults?.branchId || "" }
        : {}),
    });
    setRows([]);
    setPickerStaffId(defaults?.staffId || "");
    setPickerOpen(false);
    setError("");
  }, [isOpen, defaults, defaultBranchId, lockBranch]);

  // A customer created inline drops into the form; the cart is untouched.
  useEffect(() => {
    if (!newCustomerId) return;
    const customer = (refs.customers || []).find((c) => c.id === newCustomerId);
    setForm((current) => ({
      ...current,
      customerId: newCustomerId,
      customerPhone: customer?.phone || current.customerPhone,
    }));
  }, [newCustomerId, refs.customers]);

  // GST rate follows the salon (super admins pick the salon in this form).
  useEffect(() => {
    if (!isOpen || (isSuper && !form.salonId)) return;
    salonApi.profile
      .gst(isSuper ? { salonId: form.salonId } : undefined)
      .then((response) => setGst(response.data))
      .catch(() => setGst(null));
  }, [isOpen, isSuper, form.salonId]);

  // The rate arrives async; re-derive totals so early rows are not stale.
  useEffect(() => {
    setRows((current) => current.map((row) => reprice(row, {}, gstPercent)));
  }, [gstPercent]);

  // Past visits: job-cart records only, newest first.
  useEffect(() => {
    if (!isOpen || !form.customerId) {
      setHistory([]);
      return undefined;
    }
    let cancelled = false;
    setHistoryLoading(true);
    salonApi.jobCarts
      .list({ customerId: form.customerId, limit: 15 })
      .then((response) => {
        if (cancelled) return;
        setHistory(
          (response.data || [])
            .map((row) => ({
              key: row.id,
              code: row.jobCartId,
              startTime: row.startTime,
            }))
            .sort((a, b) => new Date(b.startTime) - new Date(a.startTime))
            .slice(0, 15)
        );
      })
      .catch(() => !cancelled && setHistory([]))
      .finally(() => !cancelled && setHistoryLoading(false));
    return () => {
      cancelled = true;
    };
  }, [isOpen, form.customerId]);

  // ---- derived data --------------------------------------------------------

  const activeServices = useMemo(
    () => (refs.services || []).filter((service) => service.status),
    [refs.services]
  );
  const serviceById = useMemo(
    () => new Map(activeServices.map((service) => [service.id, service])),
    [activeServices]
  );
  const assignedById = useMemo(
    () => new Map(rows.map((row) => [row.serviceId, row.staffId])),
    [rows]
  );

  // Staff scoped to the picked branch; "All branches" shows everyone and
  // records without a branchId always show.
  const branchStaff = useMemo(
    () =>
      (refs.staff || []).filter(
        (m) => !form.branchId || !m.branchId || m.branchId === form.branchId
      ),
    [refs.staff, form.branchId]
  );

  const cart = useMemo(
    () =>
      rows
        .map((row) => {
          const service = serviceById.get(row.serviceId);
          if (!service) return null;
          const qty = qtyOf(row.qty);
          const unit = netPrice(row.price, row.discount, row.discountType);
          const base = unit * qty;
          return {
            ...row,
            name: service.name,
            qty,
            unit,
            base,
            tax: (base * gstPercent) / 100,
            discountAmount: round2((Number(row.price || 0) - unit) * qty),
            minutes: serviceMinutes(service) * qty,
          };
        })
        .filter(Boolean),
    [rows, serviceById, gstPercent]
  );

  const totals = useMemo(() => {
    const sum = (key) => cart.reduce((acc, item) => acc + item[key], 0);
    const subtotal = sum("base");
    const tax = sum("tax");
    return {
      minutes: sum("minutes"),
      discount: sum("discountAmount"),
      subtotal,
      tax,
      total: subtotal + tax,
    };
  }, [cart]);

  const endTime = useMemo(() => {
    const start = new Date(form.startTime);
    if (!form.startTime || Number.isNaN(start.getTime())) return null;
    return new Date(start.getTime() + totals.minutes * 60000);
  }, [form.startTime, totals.minutes]);

  // API takes one primary staff plus per-service assignments; the first
  // assigned row is primary and unassigned rows inherit it server-side.
  const primaryStaffId = rows.find((row) => row.staffId)?.staffId || "";
  const primaryStaffName = refs.staff?.find((m) => m.id === primaryStaffId)?.name;

  const customerOptions = useMemo(
    () =>
      (refs.customers || []).map((item) => ({
        value: item.id,
        phone: item.phone || "",
        label: `${item.name}${item.phone ? ` · ${item.phone}` : ""}`,
      })),
    [refs.customers]
  );

  const hasRows = cart.length > 0;
  const hasScrollableContent = hasRows || Boolean(form.customerId);

  // ---- actions -------------------------------------------------------------

  const setField = (name, value) =>
    setForm((current) => ({ ...current, [name]: value }));

  const editRow = (serviceId, patch) =>
    setRows((current) =>
      current.map((row) =>
        row.serviceId === serviceId ? reprice(row, patch, gstPercent) : row
      )
    );

  const toggleService = (serviceId) =>
    setRows((current) => {
      if (current.some((row) => row.serviceId === serviceId)) {
        return current.filter((row) => row.serviceId !== serviceId);
      }
      const service = serviceById.get(serviceId);
      return service
        ? [...current, newRow(service, pickerStaffId, gstPercent)]
        : current;
    });

  const selectCustomerByPhone = (value) => {
    const digits = digitsOf(value);
    const match =
      digits.length >= 10
        ? (refs.customers || []).find((customer) => {
            const stored = digitsOf(customer.phone);
            return stored.length >= 10 && stored.endsWith(digits.slice(-10));
          })
        : null;
    setForm((current) => ({
      ...current,
      customerPhone: value,
      customerId: match?.id || "",
    }));
  };

  const changeBranch = (branchId) => {
    setField("branchId", branchId);
    setPickerStaffId("");
    const allowed = new Set(
      (refs.staff || [])
        .filter((m) => !branchId || !m.branchId || m.branchId === branchId)
        .map((m) => m.id)
    );
    // Staff outside the new branch are cleared from rows, not the rows.
    setRows((current) =>
      current.map((row) =>
        allowed.has(row.staffId) ? row : { ...row, staffId: "" }
      )
    );
  };

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    if (!form.customerId) return setError("Select a customer.");
    if (!cart.length) return setError("Add at least one service.");
    const unpriced = cart.find((item) => item.price === "");
    if (unpriced) return setError(`Enter a price for ${unpriced.name}.`);
    if (!primaryStaffId) {
      return setError("Assign staff to at least one service.");
    }
    const startTime = new Date(form.startTime);
    if (Number.isNaN(startTime.getTime()) || startTime < new Date()) {
      return setError(
        "Choose a start time from now onward. Past appointments are not allowed."
      );
    }
    setSaving(true);
    try {
      await onSubmit({
        ...(isSuper && form.salonId ? { salonId: form.salonId } : {}),
        ...(form.branchId ? { branchId: form.branchId } : {}),
        customerId: form.customerId,
        staffId: primaryStaffId,
        serviceIds: cart.map((item) => item.serviceId),
        // price = discounted, pre-GST unit price (same contract as job carts)
        serviceItems: cart.map((item) => ({
          serviceId: item.serviceId,
          price: item.unit,
          quantity: item.qty,
          ...(item.staffId ? { staffId: item.staffId } : {}),
        })),
        startTime: startTime.toISOString(),
        status: form.status,
        ...(form.bookingNote ? { bookingNote: form.bookingNote } : {}),
        ...(form.internalNote ? { internalNote: form.internalNote } : {}),
      });
      toggle();
    } catch (submitError) {
      setError(submitError.message || "Unable to book appointment.");
    } finally {
      setSaving(false);
    }
  };

  // ---- render --------------------------------------------------------------

  return (
    <>
      <Modal
        isOpen={isOpen}
        toggle={toggle}
        centered
        size="xl"
        scrollable={hasScrollableContent}
        wrapClassName="appointment-booking-modal-wrap"
        className={`appointment-booking-modal ${
          hasScrollableContent
            ? "appointment-booking-modal--filled"
            : "appointment-booking-modal--empty"
        }`}
      >
        <Form onSubmit={submit}>
          <ModalHeader toggle={toggle}>
            <span className="booking-head">
              <span className="booking-head-icon">
                <Icon name="calendar-booking" />
              </span>
              <span>
                Book appointment
                <small>Pick the customer, slot and services</small>
              </span>
            </span>
          </ModalHeader>
          <ModalBody>
            {error && (
              <Alert color="danger">
                <Icon name="alert-circle" className="me-1" />
                {error}
              </Alert>
            )}
            <Row className="g-4">
              <Col lg="8">
                <Row
                  className={`g-3 booking-details-grid booking-details-grid--${
                    isSuper ? "six" : lockBranch ? "four" : "five"
                  }`}
                >
                  {isSuper && (
                    <Col md="6">
                      <FormGroup className="mb-0">
                        <Label>Salon</Label>
                        <Input
                          type="select"
                          required
                          value={form.salonId}
                          onChange={(e) => {
                            setField("salonId", e.target.value);
                            setRows([]);
                          }}
                        >
                          <option value="">Select salon</option>
                          {(refs.salons || []).map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name}
                            </option>
                          ))}
                        </Input>
                      </FormGroup>
                    </Col>
                  )}
                  <Col md="6">
                    <FormGroup className="mb-0">
                      <Label>Phone Number</Label>
                      <Input
                        type="tel"
                        inputMode="tel"
                        list="appointment-customer-phones"
                        autoComplete="off"
                        placeholder="Search by phone"
                        value={form.customerPhone}
                        onChange={(e) => selectCustomerByPhone(e.target.value)}
                      />
                      <datalist id="appointment-customer-phones">
                        {customerOptions
                          .filter((option) => option.phone)
                          .map((option) => (
                            <option key={option.value} value={option.phone}>
                              {option.label}
                            </option>
                          ))}
                      </datalist>
                    </FormGroup>
                  </Col>
                  <Col md="6">
                    <FormGroup className="mb-0">
                      <Label>Customer</Label>
                      <CreatableSelect
                        className="react-select-container"
                        classNamePrefix="react-select"
                        isClearable
                        options={customerOptions}
                        value={
                          customerOptions.find(
                            (option) => option.value === form.customerId
                          ) || null
                        }
                        placeholder="Search by name or phone"
                        onChange={(option) =>
                          setForm((current) => ({
                            ...current,
                            customerId: option?.value || "",
                            customerPhone: option?.phone || "",
                          }))
                        }
                        onCreateOption={(name) => onCreateCustomer?.(name, form)}
                      />
                    </FormGroup>
                  </Col>
                  <Col md="6">
                    <FormGroup className="mb-0">
                      <Label>Start time</Label>
                      <Input
                        type="datetime-local"
                        required
                        min={minDateTimeInput()}
                        value={form.startTime}
                        onChange={(e) => setField("startTime", e.target.value)}
                      />
                    </FormGroup>
                  </Col>
                  <Col md="6">
                    <FormGroup className="mb-0">
                      <Label>Initial status</Label>
                      <Input
                        type="select"
                        value={form.status}
                        onChange={(e) => setField("status", e.target.value)}
                      >
                        {statuses.map((status) => (
                          <option key={status} value={status}>
                            {labelize(status)}
                          </option>
                        ))}
                      </Input>
                    </FormGroup>
                  </Col>
                  {!lockBranch && (
                    <Col md="6">
                      <FormGroup className="mb-0">
                        <Label>Branch</Label>
                        <Input
                          type="select"
                          value={form.branchId}
                          onChange={(e) => changeBranch(e.target.value)}
                        >
                          <option value="">All branches</option>
                          {(refs.branches || []).map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name}
                            </option>
                          ))}
                        </Input>
                      </FormGroup>
                    </Col>
                  )}
                </Row>

                <FormGroup className="mt-4">
                  <div className="booking-section-head">
                    <h6 className="booking-section-title mb-0">
                      <Icon name="cart-fill" /> Services
                      {hasRows && (
                        <span className="booking-count">{cart.length}</span>
                      )}
                    </h6>
                    <Button
                      color="primary"
                      type="button"
                      className="text-nowrap"
                      disabled={saving || (isSuper && !form.salonId)}
                      onClick={() => {
                        setPickerStaffId("");
                        setPickerOpen(true);
                      }}
                    >
                      <Icon name="plus" /> <span>Add service</span>
                    </Button>
                  </div>
                  <div
                    className={`booking-cart table-responsive${
                      hasRows ? " booking-cart--filled" : ""
                    }`}
                  >
                    <table className="table table-sm mb-2" style={{ minWidth: 820 }}>
                      <thead>
                        <tr>
                          <th style={{ minWidth: 150 }}>Service</th>
                          <th style={{ width: 170 }}>Staff</th>
                          <th style={{ width: 70 }}>Qty</th>
                          <th style={{ width: 120 }}>Price</th>
                          <th style={{ width: 120 }}>Discount</th>
                          <th style={{ width: 60 }} className="text-end">
                            GST %
                          </th>
                          <th style={{ width: 110 }}>Total</th>
                          <th style={{ width: 48 }} />
                        </tr>
                      </thead>
                      <tbody>
                        {!hasRows && (
                          <tr>
                            <td colSpan="8">
                              <div className="booking-cart-empty">
                                <Icon name="cart-fill" />
                                <span>No services added yet</span>
                                <small>
                                  Use “Add service” to build the appointment.
                                </small>
                              </div>
                            </td>
                          </tr>
                        )}
                        {cart.map((item) => (
                          <CartRow
                            key={item.serviceId}
                            item={item}
                            gstPercent={gstPercent}
                            staff={branchStaff}
                            saving={saving}
                            onEdit={(patch) => editRow(item.serviceId, patch)}
                            onRemove={() => toggleService(item.serviceId)}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {hasRows && (
                    <small className="text-soft">
                      Price is the pre-GST unit price; Total is the post-GST line
                      total. Edit either and the other follows. Rows left on
                      &quot;primary staff&quot; are booked with the first
                      assigned stylist.
                    </small>
                  )}
                </FormGroup>

                <h6 className="booking-section-title mt-4">
                  <Icon name="file-text" /> Notes
                </h6>
                <Row className="g-3">
                  <Col md="6">
                    <FormGroup className="mb-0">
                      <Label>Booking note</Label>
                      <Input
                        type="textarea"
                        rows="2"
                        value={form.bookingNote}
                        onChange={(e) => setField("bookingNote", e.target.value)}
                      />
                    </FormGroup>
                  </Col>
                  <Col md="6">
                    <FormGroup className="mb-0">
                      <Label>Internal note</Label>
                      <Input
                        type="textarea"
                        rows="2"
                        value={form.internalNote}
                        onChange={(e) => setField("internalNote", e.target.value)}
                      />
                    </FormGroup>
                  </Col>
                </Row>
              </Col>

              <Col lg="4">
                <div className="booking-aside">
                  <div className="card card-bordered booking-summary">
                    <div className="card-inner">
                      <h6 className="booking-section-title">
                        <Icon name="calendar-booking" /> Appointment summary
                      </h6>
                      <SummaryRow label="Services">{cart.length}</SummaryRow>
                      <SummaryRow label="Primary staff">
                        {primaryStaffName || "—"}
                      </SummaryRow>
                      <SummaryRow label="Duration">{totals.minutes} min</SummaryRow>
                      <SummaryRow label="Ends at">
                        {endTime ? formatDate(endTime, true) : "—"}
                      </SummaryRow>
                      {totals.discount > 0 && (
                        <SummaryRow label="Discount">
                          <span className="text-danger">
                            - {formatMoney(totals.discount)}
                          </span>
                        </SummaryRow>
                      )}
                      <SummaryRow label="Subtotal">
                        {formatMoney(totals.subtotal)}
                      </SummaryRow>
                      <SummaryRow
                        label={`GST ${
                          gstPercent ? `(${gstPercent}%)` : "(not enabled)"
                        }`}
                      >
                        {formatMoney(totals.tax)}
                      </SummaryRow>
                      <div className="booking-summary-total">
                        <span>Estimated total</span>
                        <strong>{formatMoney(totals.total)}</strong>
                      </div>
                      {hasRows && (
                        <p className="text-soft small">
                          Tax is an estimate at the salon service GST rate. The
                          final invoice is raised from the bill screen.
                        </p>
                      )}
                      <Button
                        type="submit"
                        color="primary"
                        block
                        size="lg"
                        disabled={saving}
                      >
                        {saving ? (
                          <Spinner size="sm" className="me-1" />
                        ) : (
                          <Icon name="check-circle" className="me-1" />
                        )}
                        Book appointment
                      </Button>
                    </div>
                  </div>

                  {form.customerId && (
                    <div className="card card-bordered mt-3">
                      <div className="card-inner">
                        <h6 className="booking-section-title">
                          <Icon name="history" /> Past visits
                        </h6>
                        {historyLoading ? (
                          <Spinner size="sm" />
                        ) : history.length === 0 ? (
                          <p className="text-soft small mb-0">No past job carts.</p>
                        ) : (
                          <div className="booking-history">
                            {history.map((visit) => (
                              <div key={visit.key} className="booking-history-item">
                                <strong className="small">{visit.code || "-"}</strong>
                                <div className="text-soft small">
                                  {formatDate(visit.startTime)}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </Col>
            </Row>
          </ModalBody>
        </Form>
      </Modal>
      <ServicePickerModal
        isOpen={pickerOpen}
        toggle={() => setPickerOpen(false)}
        services={activeServices}
        staff={branchStaff}
        staffId={pickerStaffId}
        onStaffChange={setPickerStaffId}
        assignedById={assignedById}
        onToggleService={toggleService}
        disabled={saving}
        requireStaff
        staffPlaceholder="Select staff"
      />
    </>
  );
};

export default AppointmentBookingModal;