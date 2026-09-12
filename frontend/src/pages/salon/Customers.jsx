/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Alert,
  Modal,
  ModalBody,
  ModalHeader,
  Spinner,
} from "reactstrap";
import { Button, Icon } from "@/components/Component";
import PageShell from "@/components/salon/PageShell";
import ResourcePanel from "@/components/salon/ResourcePanel";
import SchemaModal from "@/components/salon/SchemaModal";
import { customerFields } from "@/components/salon/customerFields";
import StatusBadge from "@/components/salon/StatusBadge";
import { useAuth } from "@/auth/AuthContext";
import { salonApi } from "@/services/salonApi";
import {
  formatDate,
  formatMoney,
  roleCanManage,
} from "@/utils/salonFormat";
import ReportExportButtons from "@/components/salon/ReportExportButtons";

const Customers = () => {
  const { user } = useAuth();
  const [refs, setRefs] = useState({ salons: [], branches: [] });
  const [walletCustomer, setWalletCustomer] = useState(null);
  const [ledgerCustomer, setLedgerCustomer] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [loyaltyTransactions, setLoyaltyTransactions] = useState([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const canManageWallet = roleCanManage(user?.role);
  const isSuper = user?.role === "SUPER_ADMIN";

  const loadRefs = useCallback(async () => {
    const [salons, branches] = await Promise.allSettled([
      isSuper ? salonApi.salons.list() : Promise.resolve({ data: [] }),
      user?.role === "STAFF"
        ? Promise.resolve({ data: [] })
        : salonApi.branches.list(),
    ]);
    setRefs({
      salons: salons.status === "fulfilled" ? salons.value.data || [] : [],
      branches: branches.status === "fulfilled" ? branches.value.data || [] : [],
    });
  }, [isSuper, user?.role]);

  useEffect(() => {
    loadRefs();
  }, [loadRefs]);

  const fields = useMemo(
    () =>
      customerFields({
        ...(user?.role !== "STAFF" ? { branches: refs.branches } : {}),
        ...(isSuper ? { salons: refs.salons } : {}),
      }),
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
          {
            key: "name",
            label: "Customer",
            render: (value, row) => (
              <Link to={`/customers/${row.id}`}>{value}</Link>
            ),
          },
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
            {user?.role !== "STAFF" && <Button size="sm" color="secondary" outline className="ms-1" onClick={() => { window.location.href = `/customer-retention/loyalty-transactions?customerId=${row.id}`; }}>Point history</Button>}
          </>
        )}
      />

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
