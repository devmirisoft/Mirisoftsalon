/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useMemo, useState } from "react";
import CreatableSelect from "react-select/creatable";
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
import StatusBadge from "@/components/salon/StatusBadge";
import { salonApi } from "@/services/salonApi";
import {
  appointmentTotals,
  serviceMinutes,
} from "@/utils/appointmentTotals";
import { formatDate, formatMoney, minDateTimeInput } from "@/utils/salonFormat";

const emptyForm = {
  salonId: "",
  branchId: "",
  customerId: "",
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
    setForm({ ...emptyForm, ...defaults });
    setRows([]);
    setPickerStaffId("");
    setPickerOpen(false);
    setError("");
  }, [isOpen, defaults]);

  // A customer added from the inline "create" option drops straight into the
  // form; the cart built so far is left untouched.
  useEffect(() => {
    if (newCustomerId) {
      setForm((current) => ({ ...current, customerId: newCustomerId }));
    }
  }, [newCustomerId]);

  // Tax rate comes from the salon GST settings. A super admin picks the salon
  // in this form, so the rate is refetched when that changes.
  useEffect(() => {
    if (!isOpen || (isSuper && !form.salonId)) return;
    salonApi.profile
      .gst(isSuper ? { salonId: form.salonId } : undefined)
      .then((response) => setGst(response.data))
      .catch(() => setGst(null));
  }, [isOpen, isSuper, form.salonId]);

  // Past visits for the selected customer: job carts (walk-in and completed
  // jobs) plus booked appointments, newest first. Walk-in appointments are
  // dropped because their job cart is already in the list.
  useEffect(() => {
    if (!isOpen || !form.customerId) {
      setHistory([]);
      return undefined;
    }
    let cancelled = false;
    setHistoryLoading(true);
    Promise.all([
      salonApi.jobCarts.list({ customerId: form.customerId, limit: 10 }),
      salonApi.appointments.list({ customerId: form.customerId }),
    ])
      .then(([jobs, appointments]) => {
        if (cancelled) return;
        const jobRows = (jobs.data || []).map((row) => ({
          key: `job-${row.id}`,
          code: row.jobCartId,
          startTime: row.startTime,
          services: (row.items || []).map((item) => item.serviceName),
          staff: row.staff?.name,
          status: row.status,
          amount: row.invoice?.totalAmount ?? row.invoice?.subtotalAmount,
        }));
        const appointmentRows = (appointments.data || [])
          .filter((row) => !row.walkInJobCart)
          .map((row) => ({
            key: `apt-${row.id}`,
            code: row.appointmentCode,
            startTime: row.startTime,
            services: (row.items || []).map(
              (item) => item.service?.name || item.serviceName
            ),
            staff: row.staff?.name,
            status: row.status,
          }));
        setHistory(
          [...jobRows, ...appointmentRows]
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
          const price = Number(service.price || 0);
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
        : [...current, { serviceId, staffId: pickerStaffId }]
    );

  // Label carries name and phone so react-select's default filter matches
  // either, and the picked customer shows both.
  const customerOptions = (refs.customers || []).map((item) => ({
    value: item.id,
    label: `${item.name}${item.phone ? ` · ${item.phone}` : ""}`,
  }));

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
        scrollable
        style={{ maxWidth: "70vw", width: "70vw", height: "70vh" }}
      >
        <Form onSubmit={submit}>
          <ModalHeader toggle={toggle}>Book appointment</ModalHeader>
          <ModalBody>
            {error && (
              <Alert color="danger">
                <Icon name="alert-circle" className="me-1" />
                {error}
              </Alert>
            )}
            <Row className="g-4">
              <Col lg="8">
                <Row className="g-3">
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
                          setField("customerId", option?.value || "")
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
                            {status}
                          </option>
                        ))}
                      </Input>
                    </FormGroup>
                  </Col>
                </Row>

                <FormGroup className="mt-4">
                  <div className="d-flex justify-content-between align-items-center mb-2">
                    <Label className="mb-0">Services</Label>
                    <Button
                      color="primary"
                      type="button"
                      className="text-nowrap px-3 py-2"
                      disabled={saving || (isSuper && !form.salonId)}
                      onClick={() => setPickerOpen(true)}
                    >
                      + Service
                    </Button>
                  </div>
                  <div className="table-responsive">
                    <table className="table table-sm table-bordered mb-2">
                      <thead>
                        <tr>
                          <th>Service</th>
                          <th style={{ width: 200 }}>Staff</th>
                          <th style={{ width: 110 }}>Price</th>
                          <th style={{ width: 80 }}>GST %</th>
                          <th style={{ width: 120 }}>Total</th>
                          <th style={{ width: 60 }} />
                        </tr>
                      </thead>
                      <tbody>
                        {cart.length === 0 && (
                          <tr>
                            <td colSpan="6" className="text-center text-soft py-3">
                              No services added yet.
                            </td>
                          </tr>
                        )}
                        {cart.map((item) => (
                          <tr key={item.serviceId}>
                            <td>
                              {item.name}
                              <small className="d-block text-soft">
                                {item.minutes
                                  ? `${item.minutes} min`
                                  : "Duration not set"}
                              </small>
                            </td>
                            <td>
                              <Input
                                type="select"
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
                            <td>{formatMoney(item.price)}</td>
                            <td>{gstPercent}</td>
                            <td>{formatMoney(item.price + item.tax)}</td>
                            <td className="text-end">
                              <Button
                                color="danger"
                                outline
                                size="sm"
                                type="button"
                                disabled={saving}
                                onClick={() => toggleService(item.serviceId)}
                              >
                                X
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <small className="text-soft">
                    Prices come from the service catalog. Rows left on
                    &quot;primary staff&quot; are booked with the first assigned
                    stylist.
                  </small>
                </FormGroup>

                <Row className="g-3">
                  <Col md="6">
                    <FormGroup className="mb-0">
                      <Label>Booking note</Label>
                      <Input
                        type="textarea"
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
                <div className="card card-bordered">
                  <div className="card-inner">
                    <h6 className="mb-3">Appointment Summary</h6>
                    <div className="d-flex justify-content-between py-2 border-bottom">
                      <span className="text-soft">Services</span>
                      <strong>{cart.length}</strong>
                    </div>
                    <div className="d-flex justify-content-between py-2 border-bottom">
                      <span className="text-soft">Primary staff</span>
                      <strong>{primaryStaffName || "—"}</strong>
                    </div>
                    <div className="d-flex justify-content-between py-2 border-bottom">
                      <span className="text-soft">Duration</span>
                      <strong>{totals.minutes} min</strong>
                    </div>
                    <div className="d-flex justify-content-between py-2 border-bottom">
                      <span className="text-soft">Ends at</span>
                      <strong>{endTime ? formatDate(endTime, true) : "—"}</strong>
                    </div>
                    <div className="d-flex justify-content-between py-2 border-bottom">
                      <span className="text-soft">Subtotal</span>
                      <strong>{formatMoney(totals.subtotal)}</strong>
                    </div>
                    <div className="d-flex justify-content-between py-2 border-bottom">
                      <span className="text-soft">
                        GST {gstPercent ? `(${gstPercent}%)` : "(not enabled)"}
                      </span>
                      <strong>{formatMoney(totals.tax)}</strong>
                    </div>
                    <div className="d-flex justify-content-between py-3">
                      <span>Estimated total</span>
                      <strong>{formatMoney(totals.total)}</strong>
                    </div>
                    <p className="text-soft small">
                      Tax is an estimate at the salon service GST rate. The final
                      invoice is raised from the bill screen.
                    </p>
                    <Button type="submit" color="primary" block disabled={saving}>
                      {saving && <Spinner size="sm" className="me-1" />}
                      Book appointment
                    </Button>
                  </div>
                </div>

                <div className="card card-bordered mt-3">
                  <div className="card-inner">
                    <h6 className="mb-3">Past visits</h6>
                    {!form.customerId ? (
                      <p className="text-soft small mb-0">
                        Pick a customer to see their history.
                      </p>
                    ) : historyLoading ? (
                      <Spinner size="sm" />
                    ) : history.length === 0 ? (
                      <p className="text-soft small mb-0">
                        No past appointments or job carts.
                      </p>
                    ) : (
                      <div style={{ maxHeight: 320, overflowY: "auto" }}>
                        {history.map((visit) => (
                          <div key={visit.key} className="border-bottom py-2">
                            <div className="d-flex justify-content-between align-items-center">
                              <strong className="small">
                                {visit.code || "—"}
                              </strong>
                              <StatusBadge value={visit.status} />
                            </div>
                            <div className="text-soft small">
                              {formatDate(visit.startTime, true)}
                            </div>
                            <div className="small">
                              {visit.services.filter(Boolean).join(", ") ||
                                "—"}
                            </div>
                            <div className="text-soft small">
                              {visit.staff || "Unassigned"}
                              {visit.amount != null
                                ? ` · ${formatMoney(visit.amount)}`
                                : ""}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
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
