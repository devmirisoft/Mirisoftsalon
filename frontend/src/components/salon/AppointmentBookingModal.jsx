/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useMemo, useState } from "react";
import { CreatableSelect } from "@/components/select/PortalSelect";
import {
  Alert,
  Col,
  Form,
  FormGroup,
  Input,
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
import {
  appointmentTotals,
  serviceMinutes,
} from "@/utils/appointmentTotals";
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

// Booking cart: services are checked off in the picker and land as rows with
// their own stylist, price and tax, with a running summary beside them.
const AppointmentBookingModal = ({
  isOpen,
  toggle,
  isSuper,
  lockBranch = false,
  defaultBranchId = "",
  statuses = [],
  refs,
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

  // A customer added from the inline "create" option drops straight into the
  // form; the cart built so far is left untouched.
  useEffect(() => {
    if (newCustomerId) {
      const customer = (refs.customers || []).find(
        (item) => item.id === newCustomerId
      );
      setForm((current) => ({
        ...current,
        customerId: newCustomerId,
        customerPhone: customer?.phone || current.customerPhone,
      }));
    }
  }, [newCustomerId, refs.customers]);

  // Tax rate comes from the salon GST settings. A super admin picks the salon
  // in this form, so the rate is refetched when that changes.
  useEffect(() => {
    if (!isOpen || (isSuper && !form.salonId)) return;
    salonApi.profile
      .gst(isSuper ? { salonId: form.salonId } : undefined)
      .then((response) => setGst(response.data))
      .catch(() => setGst(null));
  }, [isOpen, isSuper, form.salonId]);

  // Past visits show job-cart records only, newest first.
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
      .catch(() => {
        if (!cancelled) setHistory([]);
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, form.customerId]);

  const gstPercent =
    gst?.gstEnabled === false ? 0 : Number(gst?.serviceGstRate ?? 0);

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

  const cart = useMemo(
    () =>
      rows
        .map((row) => {
          const service = serviceById.get(row.serviceId);
          if (!service) return null;
          const price = Number(row.price ?? service.price ?? 0);
          return {
            ...row,
            name: service.name,
            price,
            minutes: serviceMinutes(service),
            tax: (price * gstPercent) / 100,
          };
        })
        .filter(Boolean),
    [rows, serviceById, gstPercent]
  );

  const totals = useMemo(
    () => appointmentTotals(cart, gstPercent),
    [cart, gstPercent]
  );

  const endTime = useMemo(() => {
    const start = new Date(form.startTime);
    if (!form.startTime || Number.isNaN(start.getTime())) return null;
    return new Date(start.getTime() + totals.minutes * 60000);
  }, [form.startTime, totals.minutes]);

  // The API takes one primary staff plus per-service assignments; the first
  // assigned row is the primary, and unassigned rows inherit it server-side.
  const primaryStaffId = rows.find((row) => row.staffId)?.staffId || "";
  const primaryStaffName = refs.staff?.find(
    (member) => member.id === primaryStaffId
  )?.name;

  // Staff are scoped to the picked branch. "All branches" shows everyone, and
  // records with no branchId (the staff-role fallback list) always show.
  const branchStaff = useMemo(
    () =>
      (refs.staff || []).filter(
        (member) =>
          !form.branchId || !member.branchId || member.branchId === form.branchId
      ),
    [refs.staff, form.branchId]
  );

  const setField = (name, value) =>
    setForm((current) => ({ ...current, [name]: value }));

  const toggleService = (serviceId) =>
    setRows((current) =>
      current.some((row) => row.serviceId === serviceId)
        ? current.filter((row) => row.serviceId !== serviceId)
        : [
            ...current,
            {
              serviceId,
              staffId: pickerStaffId,
              price: Number(serviceById.get(serviceId)?.price || 0),
            },
          ]
    );

  // Label carries name and phone so react-select's default filter matches
  // either, and the picked customer shows both.
  const customerOptions = (refs.customers || []).map((item) => ({
    value: item.id,
    phone: item.phone || "",
    label: `${item.name}${item.phone ? ` · ${item.phone}` : ""}`,
  }));

  const selectCustomerByPhone = (value) => {
    const digits = value.replace(/\D/g, "");
    const match =
      digits.length >= 10
        ? (refs.customers || []).find((customer) => {
            const stored = String(customer.phone || "").replace(/\D/g, "");
            return stored.length >= 10 && stored.endsWith(digits.slice(-10));
          })
        : null;
    setForm((current) => ({
      ...current,
      customerPhone: value,
      customerId: match?.id || "",
    }));
  };

  const hasAppointmentRows = cart.length > 0;
  const hasScrollableContent = hasAppointmentRows || Boolean(form.customerId);

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    if (!form.customerId) return setError("Select a customer.");
    if (!cart.length) return setError("Add at least one service.");
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
        serviceItems: cart.map((item) => ({
          serviceId: item.serviceId,
          price: item.price,
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

  return (
    <>
      <Modal
        isOpen={isOpen}
        toggle={toggle}
        centered
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
                          onChange={(event) => {
                            setField("salonId", event.target.value);
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
                        onChange={(event) =>
                          selectCustomerByPhone(event.target.value)
                        }
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
                        onChange={(event) =>
                          setField("startTime", event.target.value)
                        }
                      />
                    </FormGroup>
                  </Col>
                  <Col md="6">
                    <FormGroup className="mb-0">
                      <Label>Initial status</Label>
                      <Input
                        type="select"
                        value={form.status}
                        onChange={(event) =>
                          setField("status", event.target.value)
                        }
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
                          onChange={(event) => {
                            const branchId = event.target.value;
                            setField("branchId", branchId);
                            setPickerStaffId("");
                            const allowed = new Set(
                              (refs.staff || [])
                                .filter(
                                  (member) =>
                                    !branchId ||
                                    !member.branchId ||
                                    member.branchId === branchId
                                )
                                .map((member) => member.id)
                            );
                            setRows((current) =>
                              current.map((row) =>
                                allowed.has(row.staffId)
                                  ? row
                                  : { ...row, staffId: "" }
                              )
                            );
                          }}
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
                      {hasAppointmentRows && (
                        <span className="booking-count">{cart.length}</span>
                      )}
                    </h6>
                    <Button
                      color="primary"
                      type="button"
                      className="text-nowrap"
                      disabled={saving || (isSuper && !form.salonId)}
                      onClick={() => setPickerOpen(true)}
                    >
                      <Icon name="plus" /> <span>Add service</span>
                    </Button>
                  </div>
                  <div
                    className={`booking-cart${
                      hasAppointmentRows ? " booking-cart--filled" : ""
                    }`}
                  >
                    <table className="table table-sm mb-2">
                      <thead>
                        <tr>
                          <th>Service</th>
                          <th style={{ width: 200 }}>Staff</th>
                          <th style={{ width: 110 }} className="text-end">
                            Price
                          </th>
                          <th style={{ width: 80 }} className="text-end">
                            GST
                          </th>
                          <th style={{ width: 120 }} className="text-end">
                            Total
                          </th>
                          <th style={{ width: 56 }} />
                        </tr>
                      </thead>
                      <tbody>
                        {!hasAppointmentRows && (
                          <tr>
                            <td colSpan="6">
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
                          <tr key={item.serviceId}>
                            <td>
                              <span className="booking-service-name">
                                {item.name}
                              </span>
                              <small className="d-block text-soft">
                                <Icon name="clock" />{" "}
                                {item.minutes
                                  ? `${item.minutes} min`
                                  : "Duration not set"}
                              </small>
                            </td>
                            <td>
                              <Input
                                type="select"
                                bsSize="sm"
                                value={item.staffId}
                                disabled={saving}
                                onChange={(event) =>
                                  setRows((current) =>
                                    current.map((row) =>
                                      row.serviceId === item.serviceId
                                        ? { ...row, staffId: event.target.value }
                                        : row
                                    )
                                  )
                                }
                              >
                                <option value="">Use primary staff</option>
                                {branchStaff.map((member) => (
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
                                min="0"
                                step="0.01"
                                className="booking-price-input"
                                aria-label={`Price for ${item.name}`}
                                value={item.price}
                                disabled={saving}
                                onChange={(event) => {
                                  const price = event.target.value;
                                  setRows((current) =>
                                    current.map((row) =>
                                      row.serviceId === item.serviceId
                                        ? { ...row, price }
                                        : row
                                    )
                                  );
                                }}
                              />
                            </td>
                            <td className="text-end text-soft">
                              {gstPercent}%
                            </td>
                            <td className="text-end fw-bold">
                              {formatMoney(item.price + item.tax)}
                            </td>
                            <td className="text-end">
                              <button
                                type="button"
                                className="booking-row-remove"
                                title="Remove service"
                                disabled={saving}
                                onClick={() => toggleService(item.serviceId)}
                              >
                                <Icon name="trash" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {hasAppointmentRows && (
                    <small className="text-soft">
                      Prices come from the service catalog. Rows left on
                      &quot;primary staff&quot; are booked with the first assigned
                      stylist.
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
                        onChange={(event) =>
                          setField("bookingNote", event.target.value)
                        }
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
                        onChange={(event) =>
                          setField("internalNote", event.target.value)
                        }
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
                      <div className="booking-summary-row">
                        <span>Services</span>
                        <strong>{cart.length}</strong>
                      </div>
                      <div className="booking-summary-row">
                        <span>Primary staff</span>
                        <strong>{primaryStaffName || "—"}</strong>
                      </div>
                      <div className="booking-summary-row">
                        <span>Duration</span>
                        <strong>{totals.minutes} min</strong>
                      </div>
                      <div className="booking-summary-row">
                        <span>Ends at</span>
                        <strong>
                          {endTime ? formatDate(endTime, true) : "—"}
                        </strong>
                      </div>
                      <div className="booking-summary-row">
                        <span>Subtotal</span>
                        <strong>{formatMoney(totals.subtotal)}</strong>
                      </div>
                      <div className="booking-summary-row">
                        <span>
                          GST {gstPercent ? `(${gstPercent}%)` : "(not enabled)"}
                        </span>
                        <strong>{formatMoney(totals.tax)}</strong>
                      </div>
                      <div className="booking-summary-total">
                        <span>Estimated total</span>
                        <strong>{formatMoney(totals.total)}</strong>
                      </div>
                      {hasAppointmentRows && (
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
                          <p className="text-soft small mb-0">
                            No past job carts.
                          </p>
                        ) : (
                          <div className="booking-history">
                            {history.map((visit) => (
                              <div
                                key={visit.key}
                                className="booking-history-item"
                              >
                                <strong className="small">
                                  {visit.code || "-"}
                                </strong>
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
        staffPlaceholder="Use primary staff"
      />
    </>
  );
};

export default AppointmentBookingModal;
