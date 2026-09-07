/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Col,
  Form,
  FormGroup,
  Input,
  Label,
  Row,
  Spinner,
  Table,
} from "reactstrap";
import { Button, Icon } from "@/components/Component";
import PageShell from "@/components/salon/PageShell";
import StatusBadge from "@/components/salon/StatusBadge";
import { salonApi } from "@/services/salonApi";
import {
  addMonthsInputDate,
  formatDate,
  formatMoney,
  labelize,
  todayInputDate,
} from "@/utils/salonFormat";

// A membership sale takes money in, so MEMBERSHIP_WALLET is not offered here:
// you cannot buy a membership by redeeming another membership's wallet.
const PAYMENT_METHODS = [
  "CASH",
  "UPI",
  "GPAY",
  "PAYTM",
  "PHONEPE",
  "CARD",
  "BANK_TRANSFER",
  "CHEQUE",
  "OTHER",
];

const initialCustomerId =
  new URLSearchParams(window.location.search).get("customerId") || "";

const defaultMembershipForm = () => {
  const startsAt = todayInputDate();
  return {
    membershipId: "",
    startsAt,
    expiresAt: addMonthsInputDate(startsAt, 1),
    paymentMethod: "CASH",
    amountPaid: "",
    soldByStaffId: "",
    note: "",
  };
};

const ManageMemberships = () => {
  const [customers, setCustomers] = useState([]);
  const [memberships, setMemberships] = useState([]);
  const [staff, setStaff] = useState([]);
  const [customerId, setCustomerId] = useState(initialCustomerId);
  const [customer, setCustomer] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState(defaultMembershipForm);
  const [filters, setFilters] = useState({
    q: "",
    membership: "",
    paymentMethod: "",
    status: "",
    soldBy: "",
  });

  useEffect(() => {
    Promise.all([
      salonApi.customers.list(),
      salonApi.memberships.list(),
      // Staff list is restricted for some roles; a rejection here should not
      // blank the page, it just leaves the seller dropdown empty.
      salonApi.staff.list().catch(() => ({ data: [] })),
    ])
      .then(([customersRes, membershipsRes, staffRes]) => {
        setCustomers(customersRes.data || []);
        setMemberships(membershipsRes.data || []);
        setStaff(staffRes.data || []);
      })
      .catch((loadError) => setError(loadError.message));
  }, []);

  const loadCustomer = useCallback(async (id) => {
    setLoading(true);
    setError("");
    try {
      // With nobody selected the page still shows the salon-wide history.
      if (!id) {
        setCustomer(null);
        const allRes = await salonApi.customerMemberships.list({ limit: 100 });
        setHistory(allRes.data || []);
        return;
      }
      const [detail, historyRes] = await Promise.all([
        salonApi.customers.get(id),
        salonApi.customers.memberships(id),
      ]);
      setCustomer(detail.data);
      setHistory(historyRes.data || []);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCustomer(customerId);
  }, [customerId, loadCustomer]);

  const refresh = async () => {
    await loadCustomer(customerId);
  };

  const selectedPlan = memberships.find((item) => item.id === form.membershipId);

  // History filters run over the rows already loaded, so the dropdown options
  // are whatever those rows actually contain.
  const sellerName = (item) =>
    item.soldByStaff?.name || item.assignedBy?.name || "";
  const optionsOf = (pick) =>
    [...new Set(history.map(pick).filter(Boolean))].sort();
  // Hover text instead of a modal: the browser draws it, we write no CSS.
  const rowDetails = (item) =>
    [
      `${item.customer?.name || "—"}${
        item.customer?.phone ? ` · ${item.customer.phone}` : ""
      }`,
      `${item.membershipNameSnapshot} · ${Number(
        item.discountPercentageSnapshot
      )}% off`,
      `Wallet ${formatMoney(item.walletCredited)}`,
      `Paid ${item.amountPaid == null ? "—" : formatMoney(item.amountPaid)}${
        item.paymentMethod ? ` (${labelize(item.paymentMethod)})` : ""
      }`,
      `${formatDate(item.startsAt)} → ${
        item.expiresAt ? formatDate(item.expiresAt) : "Never"
      }`,
      `${labelize(item.status)}${
        sellerName(item) ? ` · sold by ${sellerName(item)}` : ""
      }`,
    ].join("\n");

  // Renew reuses the row: pick its customer and plan, the seller confirms.
  const renewFrom = (item) => {
    const plan = memberships.find((entry) => entry.id === item.membershipId);
    setCustomerId(item.customerId || item.customer?.id || "");
    setForm((value) => ({
      ...value,
      membershipId: item.membershipId || "",
      amountPaid: plan?.price != null ? String(plan.price) : value.amountPaid,
      expiresAt: plan?.durationMonths
        ? addMonthsInputDate(value.startsAt || todayInputDate(), plan.durationMonths)
        : "",
    }));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const filtered = Object.values(filters).some(Boolean);
  const clearFilters = () =>
    setFilters({
      q: "",
      membership: "",
      paymentMethod: "",
      status: "",
      soldBy: "",
    });
  const search = filters.q.trim().toLowerCase();
  const visibleHistory = history.filter(
    (item) =>
      (!search ||
        `${item.customer?.name || ""} ${item.customer?.phone || ""}`
          .toLowerCase()
          .includes(search)) &&
      (!filters.membership ||
        item.membershipNameSnapshot === filters.membership) &&
      (!filters.paymentMethod || item.paymentMethod === filters.paymentMethod) &&
      (!filters.status || item.status === filters.status) &&
      (!filters.soldBy || sellerName(item) === filters.soldBy)
  );

  const submitMembership = async (event) => {
    event.preventDefault();
    if (!customerId || !form.membershipId) return;
    const today = todayInputDate();
    if (form.expiresAt && form.expiresAt < today) {
      setError("Membership expiry date cannot be in the past.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await salonApi.customers.assignMembership(customerId, {
        membershipId: form.membershipId,
        // A start of today is stamped with the click time, not local midnight:
        // midnight here can already be "in the past" for a server in another
        // timezone, which the API rejects.
        ...(form.startsAt
          ? {
              startsAt:
                form.startsAt <= today
                  ? new Date().toISOString()
                  : new Date(`${form.startsAt}T00:00:00`).toISOString(),
            }
          : {}),
        ...(form.expiresAt
          ? { expiresAt: new Date(`${form.expiresAt}T23:59:59`).toISOString() }
          : {}),
        ...(form.paymentMethod ? { paymentMethod: form.paymentMethod } : {}),
        ...(form.amountPaid !== "" ? { amountPaid: Number(form.amountPaid) } : {}),
        ...(form.soldByStaffId ? { soldByStaffId: form.soldByStaffId } : {}),
        ...(form.note ? { note: form.note } : {}),
      });
      // Reload so every panel (wallet, current plan, history) comes back fresh.
      window.location.assign(
        customerId
          ? `${window.location.pathname}?customerId=${customerId}`
          : window.location.pathname
      );
      return;
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setSaving(false);
    }
  };

  const endMembership = async (action) => {
    const id = customer?.currentCustomerMembershipId;
    if (!id) return;
    setSaving(true);
    setError("");
    try {
      await salonApi.customerMemberships[action](id);
      await refresh();
    } catch (endError) {
      setError(endError.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageShell
      title="Manage Memberships"
      description="Sell or renew a membership plan for a customer, and review their membership history."
    >
      {error && <Alert color="danger">{error}</Alert>}
      <div className="card card-bordered mb-4">
        <div className="card-inner">
          <FormGroup>
            <Label>Customer</Label>
            <Input
              type="select"
              value={customerId}
              onChange={(event) => setCustomerId(event.target.value)}
              style={{ maxWidth: 420 }}
            >
              <option value="">Select customer</option>
              {customers.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.customerCode} · {item.name}
                </option>
              ))}
            </Input>
          </FormGroup>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-5">
          <Spinner color="primary" />
        </div>
      ) : (
        <>
          {customer && (
            <>
            <div className="card card-bordered mb-4">
              <div className="card-inner d-flex justify-content-between align-items-start flex-wrap gap-3">
                <div>
                  <div className="overline-title text-soft">Current membership</div>
                  <h5 className="mt-1">
                    {customer.currentMembership?.membershipName || "No active membership"}
                  </h5>
                  {customer.currentMembership && (
                    <div className="small text-soft">
                      {Number(customer.currentMembership.discountPercentage)}% discount ·
                      Starts {formatDate(customer.currentMembership.startsAt)} · Expires{" "}
                      {customer.currentMembership.expiresAt
                        ? formatDate(customer.currentMembership.expiresAt)
                        : "Never"}{" "}
                      · <StatusBadge value={customer.currentMembership.status} />
                    </div>
                  )}
                </div>
                {customer.currentCustomerMembershipId && (
                  <div className="d-flex gap-2">
                    <Button size="sm" color="warning" outline disabled={saving} onClick={() => endMembership("cancel")}>
                      Cancel
                    </Button>
                    <Button size="sm" color="danger" outline disabled={saving} onClick={() => endMembership("remove")}>
                      Remove
                    </Button>
                  </div>
                )}
              </div>
            </div>

            <Form onSubmit={submitMembership} className="card card-bordered mb-4">
              <div className="card-inner">
                <h6>Sell / renew membership</h6>
                <Row className="g-3">
                  <Col md="4">
                    <FormGroup>
                      <Label>Membership plan</Label>
                      <Input
                        type="select"
                        required
                        value={form.membershipId}
                        onChange={(event) => {
                          const plan = memberships.find(
                            (item) => item.id === event.target.value
                          );
                          setForm((value) => ({
                            ...value,
                            membershipId: event.target.value,
                            // Prefill what to collect from the plan price; the
                            // seller can still override it below.
                            amountPaid:
                              plan?.price != null ? String(plan.price) : "",
                            // Plans without a duration never expire.
                            expiresAt: plan?.durationMonths
                              ? addMonthsInputDate(
                                  value.startsAt || todayInputDate(),
                                  plan.durationMonths
                                )
                              : "",
                          }));
                        }}
                      >
                        <option value="">Select membership</option>
                        {memberships
                          .filter((item) => item.status)
                          .map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name} · {Number(item.discountPercentage)}%
                            </option>
                          ))}
                      </Input>
                    </FormGroup>
                  </Col>
                  <Col md="4">
                    <FormGroup>
                      <Label>Starts at</Label>
                      <Input
                        type="date"
                        min={todayInputDate()}
                        value={form.startsAt}
                        onChange={(event) =>
                          setForm((value) => ({
                            ...value,
                            startsAt: event.target.value,
                            expiresAt: (() => {
                              const months = memberships.find(
                                (item) => item.id === value.membershipId
                              )?.durationMonths;
                              return value.membershipId && !months
                                ? ""
                                : addMonthsInputDate(event.target.value, months || 1);
                            })(),
                          }))
                        }
                      />
                    </FormGroup>
                  </Col>
                  <Col md="4">
                    <FormGroup>
                      <Label>Expires at</Label>
                      <Input
                        type="date"
                        min={form.startsAt || todayInputDate()}
                        value={form.expiresAt}
                        onChange={(event) =>
                          setForm((value) => ({ ...value, expiresAt: event.target.value }))
                        }
                      />
                    </FormGroup>
                  </Col>
                  <Col md="4">
                    <FormGroup>
                      <Label>Payment method</Label>
                      <Input
                        type="select"
                        required
                        value={form.paymentMethod}
                        onChange={(event) =>
                          setForm((value) => ({
                            ...value,
                            paymentMethod: event.target.value,
                          }))
                        }
                      >
                        {PAYMENT_METHODS.map((method) => (
                          <option key={method} value={method}>
                            {labelize(method)}
                          </option>
                        ))}
                      </Input>
                    </FormGroup>
                  </Col>
                  <Col md="4">
                    <FormGroup>
                      <Label>Amount collected</Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={form.amountPaid}
                        onChange={(event) =>
                          setForm((value) => ({
                            ...value,
                            amountPaid: event.target.value,
                          }))
                        }
                      />
                    </FormGroup>
                  </Col>
                  <Col md="4">
                    <FormGroup>
                      <Label>Sold by</Label>
                      <Input
                        type="select"
                        value={form.soldByStaffId}
                        onChange={(event) =>
                          setForm((value) => ({
                            ...value,
                            soldByStaffId: event.target.value,
                          }))
                        }
                      >
                        <option value="">Select staff</option>
                        {staff
                          .filter((item) => item.status)
                          .map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name}
                              {item.jobRole ? ` · ${item.jobRole}` : ""}
                            </option>
                          ))}
                      </Input>
                    </FormGroup>
                  </Col>
                  {selectedPlan && (
                    <Col md="12">
                      <div className="alert alert-light py-2 mb-0">
                        <span className="me-3">
                          <strong>Price</strong> {formatMoney(selectedPlan.price)}
                        </span>
                        <span className="me-3">
                          <strong>Wallet credit</strong>{" "}
                          {formatMoney(selectedPlan.walletCreditAmount)}
                        </span>
                        <span className="me-3">
                          <strong>Discount</strong>{" "}
                          {Number(selectedPlan.discountPercentage)}%
                        </span>
                        <span>
                          <strong>Validity</strong>{" "}
                          {selectedPlan.durationMonths
                            ? `${selectedPlan.durationMonths} month${selectedPlan.durationMonths > 1 ? "s" : ""}`
                            : "No expiry"}
                        </span>
                      </div>
                    </Col>
                  )}
                  <Col md="9">
                    <FormGroup>
                      <Label>Note</Label>
                      <Input
                        value={form.note}
                        onChange={(event) =>
                          setForm((value) => ({ ...value, note: event.target.value }))
                        }
                      />
                    </FormGroup>
                  </Col>
                  <Col md="3" className="d-flex align-items-end pb-3">
                    <Button color="primary" type="submit" block disabled={saving}>
                      {saving && <Spinner size="sm" className="me-1" />}
                      Assign / Renew
                    </Button>
                  </Col>
                </Row>
              </div>
            </Form>
            </>
          )}

            <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-2">
              <h6 className="mb-0">
                Membership history{" "}
                <span className="text-soft fw-normal">
                  ({visibleHistory.length}
                  {visibleHistory.length === history.length
                    ? ""
                    : ` of ${history.length}`}
                  )
                </span>
              </h6>
              {filtered && (
                <Button size="sm" color="light" onClick={clearFilters}>
                  <Icon name="cross" /> Clear filters
                </Button>
              )}
            </div>
            <div className="card card-bordered">
            <Table responsive hover className="align-middle mb-0">
              <thead>
                <tr>
                  <th style={{ minWidth: "180px" }}>
                    <Input
                      bsSize="sm"
                      placeholder="Customer"
                      value={filters.q}
                      onChange={(event) =>
                        setFilters((value) => ({ ...value, q: event.target.value }))
                      }
                    />
                  </th>
                  <th style={{ minWidth: "150px" }}>
                    <Input
                      type="select"
                      bsSize="sm"
                      value={filters.membership}
                      onChange={(event) =>
                        setFilters((value) => ({
                          ...value,
                          membership: event.target.value,
                        }))
                      }
                    >
                      <option value="">Membership</option>
                      {optionsOf((item) => item.membershipNameSnapshot).map(
                        (name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        )
                      )}
                    </Input>
                  </th>
                  <th className="align-middle text-end">Discount</th>
                  <th className="align-middle text-end">Wallet value</th>
                  <th className="align-middle text-end">Paid</th>
                  <th style={{ minWidth: "150px" }}>
                    <Input
                      type="select"
                      bsSize="sm"
                      value={filters.paymentMethod}
                      onChange={(event) =>
                        setFilters((value) => ({
                          ...value,
                          paymentMethod: event.target.value,
                        }))
                      }
                    >
                      <option value="">Payment method</option>
                      {optionsOf((item) => item.paymentMethod).map((method) => (
                        <option key={method} value={method}>
                          {labelize(method)}
                        </option>
                      ))}
                    </Input>
                  </th>
                  <th className="align-middle">Starts</th>
                  <th className="align-middle">Expires</th>
                  <th style={{ minWidth: "130px" }}>
                    <Input
                      type="select"
                      bsSize="sm"
                      value={filters.status}
                      onChange={(event) =>
                        setFilters((value) => ({
                          ...value,
                          status: event.target.value,
                        }))
                      }
                    >
                      <option value="">Status</option>
                      {optionsOf((item) => item.status).map((status) => (
                        <option key={status} value={status}>
                          {labelize(status)}
                        </option>
                      ))}
                    </Input>
                  </th>
                  <th style={{ minWidth: "150px" }}>
                    <Input
                      type="select"
                      bsSize="sm"
                      value={filters.soldBy}
                      onChange={(event) =>
                        setFilters((value) => ({
                          ...value,
                          soldBy: event.target.value,
                        }))
                      }
                    >
                      <option value="">Sold by</option>
                      {optionsOf(sellerName).map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </Input>
                  </th>
                  <th className="align-middle text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleHistory.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <span className="fw-medium">
                        {item.customer?.name || "—"}
                      </span>
                      {item.customer?.phone && (
                        <small className="d-block text-soft">
                          {item.customer.phone}
                        </small>
                      )}
                    </td>
                    <td>{item.membershipNameSnapshot}</td>
                    <td className="text-end">
                      {Number(item.discountPercentageSnapshot)}%
                    </td>
                    <td className="text-end">
                      {formatMoney(item.walletCredited)}
                    </td>
                    <td className="text-end">
                      {item.amountPaid == null
                        ? "—"
                        : formatMoney(item.amountPaid)}
                    </td>
                    <td>
                      {item.paymentMethod ? labelize(item.paymentMethod) : "—"}
                    </td>
                    <td className="text-nowrap">{formatDate(item.startsAt)}</td>
                    <td className="text-nowrap">
                      {item.expiresAt ? formatDate(item.expiresAt) : "Never"}
                    </td>
                    <td>
                      <StatusBadge value={item.status} />
                    </td>
                    <td>
                      {sellerName(item) || "—"}
                    </td>
                    <td className="text-end text-nowrap">
                      {item.note && (
                        <Button
                          size="sm"
                          color="light"
                          className="btn-icon"
                          title={item.note}
                        >
                          <Icon name="eye" />
                        </Button>
                      )}
                      <Button
                        size="sm"
                        color="light"
                        className="btn-icon ms-1"
                        title={rowDetails(item)}
                      >
                        <Icon name="info" />
                      </Button>
                      <Button
                        size="sm"
                        color="primary"
                        outline
                        className="ms-1"
                        title="Prefill the form to renew this plan"
                        onClick={() => renewFrom(item)}
                      >
                        <Icon name="repeat" /> <span>Renew</span>
                      </Button>
                    </td>
                  </tr>
                ))}
                {visibleHistory.length === 0 && (
                  <tr>
                    <td colSpan="11" className="text-center text-soft py-4">
                      {filtered
                        ? "No rows match these filters."
                        : "No membership history yet."}
                    </td>
                  </tr>
                )}
              </tbody>
            </Table>
            </div>
        </>
      )}
    </PageShell>
  );
};

export default ManageMemberships;
