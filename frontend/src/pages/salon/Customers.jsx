/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
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
  Table,
} from "reactstrap";
import { Button, Icon } from "@/components/Component";
import PageShell from "@/components/salon/PageShell";
import ResourcePanel from "@/components/salon/ResourcePanel";
import SchemaModal from "@/components/salon/SchemaModal";
import StatusBadge from "@/components/salon/StatusBadge";
import { useAuth } from "@/auth/AuthContext";
import { salonApi } from "@/services/salonApi";
import {
  addMonthsInputDate,
  formatDate,
  formatMoney,
  roleCanManage,
  todayInputDate,
} from "@/utils/salonFormat";
import ReportExportButtons from "@/components/salon/ReportExportButtons";

const defaultMembershipForm = () => {
  const startsAt = todayInputDate();
  return {
    membershipId: "",
    startsAt,
    expiresAt: addMonthsInputDate(startsAt, 1),
    note: "",
  };
};

const Customers = () => {
  const { user } = useAuth();
  const [refs, setRefs] = useState({ salons: [], branches: [], memberships: [] });
  const [membershipCustomer, setMembershipCustomer] = useState(null);
  const [membershipHistory, setMembershipHistory] = useState([]);
  const [membershipLoading, setMembershipLoading] = useState(false);
  const [membershipSaving, setMembershipSaving] = useState(false);
  const [membershipError, setMembershipError] = useState("");
  const [membershipForm, setMembershipForm] = useState(defaultMembershipForm);
  const [walletCustomer, setWalletCustomer] = useState(null);
  const [ledgerCustomer, setLedgerCustomer] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [loyaltyTransactions, setLoyaltyTransactions] = useState([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const canManageWallet = roleCanManage(user?.role);
  const isSuper = user?.role === "SUPER_ADMIN";

  const loadRefs = useCallback(async () => {
    const [salons, branches, memberships] = await Promise.allSettled([
      isSuper ? salonApi.salons.list() : Promise.resolve({ data: [] }),
      user?.role === "STAFF"
        ? Promise.resolve({ data: [] })
        : salonApi.branches.list(),
      user?.role === "STAFF" ? Promise.resolve({ data: [] }) : salonApi.memberships.list(),
    ]);
    setRefs({
      salons: salons.status === "fulfilled" ? salons.value.data || [] : [],
      branches: branches.status === "fulfilled" ? branches.value.data || [] : [],
      memberships: memberships.status === "fulfilled" ? memberships.value.data || [] : [],
    });
  }, [isSuper, user?.role]);

  useEffect(() => {
    loadRefs();
  }, [loadRefs]);

  const fields = useMemo(
    () => [
      { name: "name", label: "Customer name", required: true },
      { name: "phone", label: "Phone", type: "tel", required: true },
      { name: "email", label: "Email", type: "email", nullable: true },
      { name: "gst", label: "GST number", nullable: true },
      {
        name: "status",
        label: "Customer status",
        type: "select",
        defaultValue: "REGULAR",
        options: ["REGULAR", "PREMIUM", "IRREGULAR"].map((value) => ({
          value,
          label: value,
        })),
      },
      {
        name: "dateOfBirth",
        initialName: "dob",
        label: "Date of birth",
        type: "date",
        nullable: true,
      },
      {
        name: "anniversaryDate",
        label: "Anniversary date",
        type: "date",
        nullable: true,
      },
      ...(user?.role !== "STAFF"
        ? [
            {
              name: "branchId",
              label: "Branch",
              type: "select",
              nullable: true,
              options: refs.branches.map((item) => ({
                value: item.id,
                label: item.name,
              })),
            },
          ]
        : []),
      ...(isSuper
        ? [
            {
              name: "salonId",
              label: "Salon",
              type: "select",
              required: true,
              options: refs.salons.map((item) => ({
                value: item.id,
                label: item.name,
              })),
            },
          ]
        : []),
      {
        name: "customNotes",
        label: "Customer notes",
        type: "textarea",
        fullWidth: true,
        nullable: true,
        rows: 3,
      },
    ],
    [isSuper, refs, user?.role]
  );

  const openLedger = async (customer) => {
    setLedgerCustomer(customer);
    setLedgerLoading(true);
    try {
      const [ledger, loyalty] = await Promise.all([
        salonApi.customers.transactions(customer.id),
        salonApi.loyalty.transactions({
          customerId: customer.id,
          page: 1,
          limit: 10,
        }),
      ]);
      setTransactions(ledger.data || []);
      setLoyaltyTransactions(loyalty.data || []);
    } finally {
      setLedgerLoading(false);
    }
  };

  const loadCustomerMembership = async (customer) => {
    setMembershipCustomer(customer);
    setMembershipLoading(true);
    setMembershipError("");
    try {
      const [detail, history] = await Promise.all([
        salonApi.customers.get(customer.id),
        salonApi.customers.memberships(customer.id),
      ]);
      setMembershipCustomer(detail.data);
      setMembershipHistory(history.data || []);
    } catch (error) {
      setMembershipError(error.message);
    } finally {
      setMembershipLoading(false);
    }
  };

  const refreshCustomerMembership = async () => {
    if (!membershipCustomer?.id) return;
    const [detail, history] = await Promise.all([
      salonApi.customers.get(membershipCustomer.id),
      salonApi.customers.memberships(membershipCustomer.id),
    ]);
    setMembershipCustomer(detail.data);
    setMembershipHistory(history.data || []);
    setRefreshKey((value) => value + 1);
  };

  const submitMembership = async (event) => {
    event.preventDefault();
    if (!membershipCustomer?.id || !membershipForm.membershipId) return;
    const today = todayInputDate();
    if (membershipForm.startsAt && membershipForm.startsAt < today) {
      setMembershipError("Membership start date cannot be in the past.");
      return;
    }
    if (membershipForm.expiresAt && membershipForm.expiresAt < today) {
      setMembershipError("Membership expiry date cannot be in the past.");
      return;
    }
    setMembershipSaving(true);
    setMembershipError("");
    try {
      await salonApi.customers.assignMembership(membershipCustomer.id, {
        membershipId: membershipForm.membershipId,
        ...(membershipForm.startsAt
          ? {
              startsAt: new Date(
                `${membershipForm.startsAt}T00:00:00`
              ).toISOString(),
            }
          : {}),
        ...(membershipForm.expiresAt
          ? {
              expiresAt: new Date(
                `${membershipForm.expiresAt}T23:59:59`
              ).toISOString(),
            }
          : {}),
        ...(membershipForm.note ? { note: membershipForm.note } : {}),
      });
      setMembershipForm(defaultMembershipForm());
      await refreshCustomerMembership();
    } catch (error) {
      setMembershipError(error.message);
    } finally {
      setMembershipSaving(false);
    }
  };

  const endMembership = async (action) => {
    const id = membershipCustomer?.currentCustomerMembershipId;
    if (!id) return;
    setMembershipSaving(true);
    setMembershipError("");
    try {
      await salonApi.customerMemberships[action](id);
      await refreshCustomerMembership();
    } catch (error) {
      setMembershipError(error.message);
    } finally {
      setMembershipSaving(false);
    }
  };

  return (
    <PageShell
      title="Customers"
      description="Customer profiles, membership status, wallet balance, outstanding amount, and ledger."
      tools={<ReportExportButtons reportType="customer-outstanding" />}
    >
      <ResourcePanel
        title="Customers"
        api={salonApi.customers}
        canDelete={roleCanManage(user?.role)}
        columns={[
          { key: "customerCode", label: "Code" },
          { key: "name", label: "Customer" },
          { key: "phone", label: "Phone" },
          { key: "branch", label: "Branch", render: (value) => value?.name || "—" },
          { key: "status", label: "Status", render: (value) => <StatusBadge value={value} /> },
          { key: "membership", label: "Membership", render: (value) => value?.name || "—" },
          { key: "loyaltyPoints", label: "Points" },
          { key: "walletBalance", label: "Wallet", render: formatMoney },
          {
            key: "outstandingAmount",
            label: "Outstanding",
            render: (value) => <span className={Number(value) > 0 ? "text-danger fw-bold" : ""}>{formatMoney(value)}</span>,
          },
        ]}
        fields={fields}
        transformUpdate={(values) => {
          const updateValues = { ...values };
          delete updateValues.salonId;
          return updateValues;
        }}
        refreshKey={refreshKey}
        renderActions={(row) => (
          <>
            <Button
              size="sm"
              color="info"
              outline
              onClick={() => openLedger(row)}
            >
              <Icon name="list-index" /> Ledger
            </Button>
            {canManageWallet && (
              <Button
                size="sm"
                color="success"
                outline
                className="ms-1"
                onClick={() => setWalletCustomer(row)}
              >
                <Icon name="wallet-in" /> Wallet
              </Button>
            )}
            {user?.role !== "STAFF" && <Button size="sm" color="primary" outline className="ms-1" onClick={() => loadCustomerMembership(row)}>Retention</Button>}
            {user?.role !== "STAFF" && <Button size="sm" color="secondary" outline className="ms-1" onClick={() => { window.location.href = `/customer-retention/loyalty-transactions?customerId=${row.id}`; }}>Point history</Button>}
          </>
        )}
      />

      <Modal
        isOpen={Boolean(membershipCustomer)}
        toggle={() => setMembershipCustomer(null)}
        size="xl"
        centered
      >
        <ModalHeader toggle={() => setMembershipCustomer(null)}>
          Customer membership · {membershipCustomer?.name || ""}
        </ModalHeader>
        <ModalBody>
          {membershipError && <Alert color="danger">{membershipError}</Alert>}
          {membershipLoading ? (
            <div className="text-center py-5">
              <Spinner color="primary" />
            </div>
          ) : (
            <>
              <div className="card card-bordered mb-4">
                <div className="card-inner d-flex justify-content-between align-items-start flex-wrap gap-3">
                  <div>
                    <div className="overline-title text-soft">Current membership</div>
                    <h5 className="mt-1">
                      {membershipCustomer?.currentMembership?.membershipName ||
                        "No active membership"}
                    </h5>
                    {membershipCustomer?.currentMembership && (
                      <div className="small text-soft">
                        {Number(
                          membershipCustomer.currentMembership
                            .discountPercentage
                        )}
                        % discount · Starts{" "}
                        {formatDate(
                          membershipCustomer.currentMembership.startsAt
                        )}{" "}
                        · Expires{" "}
                        {membershipCustomer.currentMembership.expiresAt
                          ? formatDate(
                              membershipCustomer.currentMembership.expiresAt
                            )
                          : "Never"}{" "}
                        ·{" "}
                        <StatusBadge
                          value={membershipCustomer.currentMembership.status}
                        />
                      </div>
                    )}
                  </div>
                  {membershipCustomer?.currentCustomerMembershipId && (
                    <div className="d-flex gap-2">
                      <Button
                        size="sm"
                        color="warning"
                        outline
                        disabled={membershipSaving}
                        onClick={() => endMembership("cancel")}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        color="danger"
                        outline
                        disabled={membershipSaving}
                        onClick={() => endMembership("remove")}
                      >
                        Remove
                      </Button>
                    </div>
                  )}
                </div>
              </div>

              <Form
                onSubmit={submitMembership}
                className="card card-bordered mb-4"
              >
                <div className="card-inner">
                  <h6>Assign or renew membership</h6>
                  <Row className="g-3">
                    <Col md="4">
                      <FormGroup>
                        <Label>Membership plan</Label>
                        <Input
                          type="select"
                          required
                          value={membershipForm.membershipId}
                          onChange={(event) =>
                            setMembershipForm((value) => ({
                              ...value,
                              membershipId: event.target.value,
                            }))
                          }
                        >
                          <option value="">Select membership</option>
                          {refs.memberships
                            .filter((item) => item.status)
                            .map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.name} ·{" "}
                                {Number(item.discountPercentage)}%
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
                          value={membershipForm.startsAt}
                          onChange={(event) =>
                            setMembershipForm((value) => ({
                              ...value,
                              startsAt: event.target.value,
                              expiresAt:
                                value.expiresAt &&
                                value.expiresAt >= event.target.value
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
                          min={membershipForm.startsAt || todayInputDate()}
                          value={membershipForm.expiresAt}
                          onChange={(event) =>
                            setMembershipForm((value) => ({
                              ...value,
                              expiresAt: event.target.value,
                            }))
                          }
                        />
                      </FormGroup>
                    </Col>
                    <Col md="9">
                      <FormGroup>
                        <Label>Note</Label>
                        <Input
                          value={membershipForm.note}
                          onChange={(event) =>
                            setMembershipForm((value) => ({
                              ...value,
                              note: event.target.value,
                            }))
                          }
                        />
                      </FormGroup>
                    </Col>
                    <Col md="3" className="d-flex align-items-end pb-3">
                      <Button
                        color="primary"
                        type="submit"
                        block
                        disabled={membershipSaving}
                      >
                        {membershipSaving && (
                          <Spinner size="sm" className="me-1" />
                        )}
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
                  {membershipHistory.map((item) => (
                    <tr key={item.id}>
                      <td>{item.membershipNameSnapshot}</td>
                      <td>{Number(item.discountPercentageSnapshot)}%</td>
                      <td>{formatDate(item.startsAt)}</td>
                      <td>
                        {item.expiresAt
                          ? formatDate(item.expiresAt)
                          : "Never"}
                      </td>
                      <td>
                        <StatusBadge value={item.status} />
                      </td>
                      <td>{item.assignedBy?.name || "—"}</td>
                      <td>{item.note || "—"}</td>
                    </tr>
                  ))}
                  {membershipHistory.length === 0 && (
                    <tr>
                      <td
                        colSpan="7"
                        className="text-center text-soft py-4"
                      >
                        No membership history.
                      </td>
                    </tr>
                  )}
                </tbody>
              </Table>
            </>
          )}
        </ModalBody>
      </Modal>

      <SchemaModal
        isOpen={Boolean(walletCustomer)}
        toggle={() => setWalletCustomer(null)}
        title={`Add wallet funds · ${walletCustomer?.name || ""}`}
        fields={[
          {
            name: "amount",
            label: "Amount",
            type: "number",
            min: 0.01,
            step: "0.01",
            required: true,
          },
          {
            name: "narration",
            label: "Narration",
            type: "textarea",
            fullWidth: true,
          },
        ]}
        onSubmit={async (values) => {
          await salonApi.customers.addWallet(walletCustomer.id, values);
          setRefreshKey((value) => value + 1);
        }}
        submitLabel="Add funds"
      />

      <Modal
        isOpen={Boolean(ledgerCustomer)}
        toggle={() => setLedgerCustomer(null)}
        size="xl"
        centered
      >
        <ModalHeader toggle={() => setLedgerCustomer(null)}>
          Customer ledger · {ledgerCustomer?.name}
        </ModalHeader>
        <ModalBody>
          {ledgerLoading ? (
            <div className="text-center py-5">
              <Spinner color="primary" />
            </div>
          ) : (
            <>
              <Alert color="light">
                Wallet: <strong>{formatMoney(ledgerCustomer?.walletBalance)}</strong>
                <span className="mx-3">·</span>
                Outstanding:{" "}
                <strong className="text-danger">
                  {formatMoney(ledgerCustomer?.outstandingAmount)}
                </strong>
              </Alert>
              <div className="table-responsive">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Bill no.</th>
                      <th>Type</th>
                      <th>Narration</th>
                      <th>Debit</th>
                      <th>Credit</th>
                      <th>Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((item) => (
                      <tr key={item.id}>
                        <td>{formatDate(item.createdAt, true)}</td>
                        <td>{item.billNo || "—"}</td>
                        <td><StatusBadge value={item.type} /></td>
                        <td>{item.narration}</td>
                        <td className="text-danger">{formatMoney(item.debit)}</td>
                        <td className="text-success">{formatMoney(item.credit)}</td>
                        <td>{formatMoney(item.balanceAfter)}</td>
                      </tr>
                    ))}
                    {transactions.length === 0 && (
                      <tr>
                        <td colSpan="7" className="text-center text-soft py-4">
                          No ledger transactions.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="d-flex justify-content-between align-items-center mt-4 mb-2">
                <h6 className="mb-0">Recent loyalty activity</h6>
                <Link
                  to={`/customer-retention/loyalty-transactions?customerId=${ledgerCustomer?.id}`}
                >
                  View full history
                </Link>
              </div>
              <div className="table-responsive">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Type</th>
                      <th>Points</th>
                      <th>Before</th>
                      <th>After</th>
                      <th>Reference</th>
                      <th>Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loyaltyTransactions.map((item) => (
                      <tr key={item.id}>
                        <td>{formatDate(item.createdAt, true)}</td>
                        <td><StatusBadge value={item.type} /></td>
                        <td>{item.points}</td>
                        <td>{item.balanceBefore}</td>
                        <td>{item.balanceAfter}</td>
                        <td>{item.referenceType || "—"}</td>
                        <td>{item.note || "—"}</td>
                      </tr>
                    ))}
                    {loyaltyTransactions.length === 0 && (
                      <tr>
                        <td colSpan="7" className="text-center text-soft py-4">
                          No loyalty activity.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </ModalBody>
      </Modal>
    </PageShell>
  );
};

export default Customers;
