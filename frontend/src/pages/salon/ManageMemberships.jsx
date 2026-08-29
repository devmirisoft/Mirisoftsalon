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
import { Button } from "@/components/Component";
import PageShell from "@/components/salon/PageShell";
import StatusBadge from "@/components/salon/StatusBadge";
import { salonApi } from "@/services/salonApi";
import {
  addMonthsInputDate,
  formatDate,
  todayInputDate,
} from "@/utils/salonFormat";

const initialCustomerId =
  new URLSearchParams(window.location.search).get("customerId") || "";

const defaultMembershipForm = () => {
  const startsAt = todayInputDate();
  return {
    membershipId: "",
    startsAt,
    expiresAt: addMonthsInputDate(startsAt, 1),
    note: "",
  };
};

const ManageMemberships = () => {
  const [customers, setCustomers] = useState([]);
  const [memberships, setMemberships] = useState([]);
  const [customerId, setCustomerId] = useState(initialCustomerId);
  const [customer, setCustomer] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState(defaultMembershipForm);

  useEffect(() => {
    Promise.all([salonApi.customers.list(), salonApi.memberships.list()])
      .then(([customersRes, membershipsRes]) => {
        setCustomers(customersRes.data || []);
        setMemberships(membershipsRes.data || []);
      })
      .catch((loadError) => setError(loadError.message));
  }, []);

  const loadCustomer = useCallback(async (id) => {
    if (!id) {
      setCustomer(null);
      setHistory([]);
      return;
    }
    setLoading(true);
    setError("");
    try {
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

  const submitMembership = async (event) => {
    event.preventDefault();
    if (!customerId || !form.membershipId) return;
    const today = todayInputDate();
    if (form.startsAt && form.startsAt < today) {
      setError("Membership start date cannot be in the past.");
      return;
    }
    if (form.expiresAt && form.expiresAt < today) {
      setError("Membership expiry date cannot be in the past.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await salonApi.customers.assignMembership(customerId, {
        membershipId: form.membershipId,
        ...(form.startsAt
          ? { startsAt: new Date(`${form.startsAt}T00:00:00`).toISOString() }
          : {}),
        ...(form.expiresAt
          ? { expiresAt: new Date(`${form.expiresAt}T23:59:59`).toISOString() }
          : {}),
        ...(form.note ? { note: form.note } : {}),
      });
      setForm(defaultMembershipForm());
      await refresh();
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
        customer && (
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
                        onChange={(event) =>
                          setForm((value) => ({ ...value, membershipId: event.target.value }))
                        }
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
                            expiresAt:
                              value.expiresAt && value.expiresAt >= event.target.value
                                ? value.expiresAt
                                : addMonthsInputDate(event.target.value, 1),
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

            <h6>Membership history</h6>
            <Table responsive>
              <thead>
                <tr>
                  <th>Membership</th>
                  <th>Discount</th>
                  <th>Starts</th>
                  <th>Expires</th>
                  <th>Status</th>
                  <th>Assigned by</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {history.map((item) => (
                  <tr key={item.id}>
                    <td>{item.membershipNameSnapshot}</td>
                    <td>{Number(item.discountPercentageSnapshot)}%</td>
                    <td>{formatDate(item.startsAt)}</td>
                    <td>{item.expiresAt ? formatDate(item.expiresAt) : "Never"}</td>
                    <td>
                      <StatusBadge value={item.status} />
                    </td>
                    <td>{item.assignedBy?.name || "—"}</td>
                    <td>{item.note || "—"}</td>
                  </tr>
                ))}
                {history.length === 0 && (
                  <tr>
                    <td colSpan="7" className="text-center text-soft py-4">
                      No membership history.
                    </td>
                  </tr>
                )}
              </tbody>
            </Table>
          </>
        )
      )}
    </PageShell>
  );
};

export default ManageMemberships;
