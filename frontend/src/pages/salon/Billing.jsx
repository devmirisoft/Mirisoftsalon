/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Alert,
  Nav,
  NavItem,
  NavLink,
  TabContent,
  TabPane,
} from "reactstrap";
import { Button, Icon } from "@/components/Component";
import PageShell from "@/components/salon/PageShell";
import DataGrid from "@/components/salon/DataGrid";
import DetailsModal from "@/components/salon/DetailsModal";
import SchemaModal from "@/components/salon/SchemaModal";
import StatusBadge from "@/components/salon/StatusBadge";
import { useAuth } from "@/auth/AuthContext";
import { salonApi } from "@/services/salonApi";
import {
  formatDate,
  formatMoney,
  roleCanManage,
  toLocalInput,
} from "@/utils/salonFormat";
import ReportExportButtons from "@/components/salon/ReportExportButtons";

const TAX_OPTIONS = [
  { value: 0, label: "No tax" },
  { value: 5, label: "GST 5%" },
  { value: 12, label: "GST 12%" },
  { value: 18, label: "GST 18%" },
  { value: 28, label: "GST 28%" },
];

const Billing = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [tab, setTab] = useState("invoices");
  const [invoices, setInvoices] = useState([]);
  const [payments, setPayments] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [action, setAction] = useState(null);
  const [selected, setSelected] = useState(null);
  const [paymentDetails, setPaymentDetails] = useState(null);
  const [invoiceDefaults, setInvoiceDefaults] = useState({});
  const [handledAppointmentInvoiceId, setHandledAppointmentInvoiceId] =
    useState("");
  // Spendable membership wallet for the customer on the invoice being paid,
  // keyed by invoice id so switching invoices in the form refetches.
  const [wallet, setWallet] = useState(null);
  const [walletInvoiceId, setWalletInvoiceId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const [invoiceResult, paymentResult, appointmentResult] =
      await Promise.allSettled([
        salonApi.invoices.list(),
        salonApi.payments.list(),
        salonApi.appointments.list(),
      ]);
    if (invoiceResult.status === "fulfilled") {
      setInvoices(invoiceResult.value.data || []);
    } else {
      setError(invoiceResult.reason?.message || "Unable to load invoices.");
    }
    if (paymentResult.status === "fulfilled") {
      setPayments(paymentResult.value.data || []);
    }
    if (appointmentResult.status === "fulfilled") {
      setAppointments(appointmentResult.value.data || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const completedWithoutInvoice = appointments.filter(
    (appointment) =>
      appointment.status === "COMPLETED" &&
      !invoices.some((invoice) => invoice.appointmentId === appointment.id)
  );
  const payableInvoices = invoices.filter(
    (invoice) =>
      invoice.status !== "CANCELLED" &&
      invoice.appointment?.status !== "CANCELLED" &&
      invoice.paymentStatus !== "PAID"
  );
  const activeInvoices = invoices.filter(
    (invoice) => invoice.status !== "CANCELLED"
  );
  const visibleInvoices = activeInvoices.filter((invoice) => {
    const query = invoiceSearch.trim().toLowerCase();
    if (!query) return true;
    return [invoice.invoiceCode, invoice.customerName, invoice.customerPhone]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query));
  });

  useEffect(() => {
    const appointmentId = new URLSearchParams(location.search).get(
      "appointmentId"
    );
    if (!appointmentId || handledAppointmentInvoiceId === appointmentId) return;
    if (!completedWithoutInvoice.some((item) => item.id === appointmentId)) {
      return;
    }
    setInvoiceDefaults({ appointmentId });
    setSelected(null);
    setAction("invoice");
    setHandledAppointmentInvoiceId(appointmentId);
  }, [completedWithoutInvoice, handledAppointmentInvoiceId, location.search]);

  const walletBalance = Number(wallet?.spendableBalance ?? 0);

  const form = useMemo(() => {
    if (action === "invoice") {
      return {
        title: "Generate invoice from appointment",
        submitLabel: "Generate invoice",
        initialValues: invoiceDefaults,
        fields: [
          {
            name: "appointmentId",
            label: "Completed appointment",
            type: "select",
            required: true,
            fullWidth: true,
            options: completedWithoutInvoice.map((item) => ({
              value: item.id,
              label: `${item.appointmentCode} · ${item.customer?.name} · ${formatMoney(item.estimatedAmount)}`,
            })),
          },
          {
            name: "invoiceType",
            label: "Invoice type",
            type: "select",
            defaultValue: "BILL_OF_SUPPLY",
            options: [
              { value: "BILL_OF_SUPPLY", label: "Bill of supply" },
              { value: "GST_INVOICE", label: "GST invoice" },
            ],
          },
          {
            name: "status",
            label: "Initial status",
            type: "select",
            defaultValue: "DRAFT",
            options: [
              { value: "DRAFT", label: "Draft (apply coupon before issuing)" },
              { value: "ISSUED", label: "Issue immediately" },
            ],
          },
          { name: "discountAmount", label: "Discount", type: "number", min: 0, step: "0.01", defaultValue: 0 },
          {
            name: "taxPercent",
            label: "Tax",
            type: "select",
            defaultValue: 0,
            options: TAX_OPTIONS,
          },
          { name: "processingFeeAmount", label: "Processing fee", type: "number", min: 0, step: "0.01", defaultValue: 0 },
          { name: "billingNote", label: "Billing note", type: "textarea", fullWidth: true },
          { name: "footerNote", label: "Footer note", type: "textarea", fullWidth: true },
        ],
        submit: ({ appointmentId, ...values }) =>
          salonApi.invoices.fromAppointment(appointmentId, values),
      };
    }
    if (action === "redeem") {
      return {
        title: `Redeem loyalty points · ${selected?.invoiceCode || ""}`,
        submitLabel: "Redeem points",
        fields: [
          { name: "points", label: `Points to redeem (available: ${selected?.customer?.loyaltyPoints ?? 0})`, type: "number", min: 1, step: 1, required: true, fullWidth: true },
        ],
        submit: (values) => salonApi.invoices.redeemLoyalty(selected.id, Number(values.points)),
      };
    }
    return {
      title: "Record payment",
      submitLabel: "Record payment",
      fields: [
        {
          name: "invoiceId",
          label: "Invoice",
          type: "select",
          required: true,
          fullWidth: true,
          options: payableInvoices.map((item) => ({
            value: item.id,
            label: `${item.invoiceCode} · ${item.customerName} · Balance ${formatMoney(item.balanceAmount)}`,
          })),
          defaultValue: selected?.id || "",
        },
        { name: "amount", label: "Amount", type: "number", min: 0.01, step: "0.01", required: true },
        {
          name: "method",
          label: "Payment method",
          type: "select",
          required: true,
          options: [
            ...["CASH", "CARD", "UPI", "OTHER"].map((value) => ({
              value,
              label: value,
            })),
            // Only offered when the customer actually has spendable funds.
            ...(walletBalance > 0
              ? [
                  {
                    value: "MEMBERSHIP_WALLET",
                    label: `Membership wallet (${formatMoney(walletBalance)} available)`,
                  },
                ]
              : []),
          ],
        },
        { name: "referenceNo", label: "Reference number" },
        {
          name: "paidAt",
          label: "Paid at",
          type: "datetime-local",
          defaultValue: toLocalInput(new Date()),
        },
        { name: "note", label: "Payment note", type: "textarea", fullWidth: true },
      ],
      submit: (values) => {
        // A wallet payment debits the membership and records the payment in
        // one server-side transaction, so it uses its own endpoint.
        if (values.method === "MEMBERSHIP_WALLET") {
          return salonApi.membershipWallets.payInvoice({
            invoiceId: values.invoiceId,
            amount: Number(values.amount),
            ...(values.note ? { note: values.note } : {}),
          });
        }
        return salonApi.payments.create({
          ...values,
          ...(values.paidAt
            ? { paidAt: new Date(values.paidAt).toISOString() }
            : {}),
        });
      },
    };
  }, [
    action,
    completedWithoutInvoice,
    invoiceDefaults,
    payableInvoices,
    selected,
    walletBalance,
  ]);

  // Load the spendable membership wallet for whichever invoice the payment
  // form is aimed at, so the form can offer paying from it.
  useEffect(() => {
    if (action !== "payment") {
      setWallet(null);
      setWalletInvoiceId("");
      return;
    }
    const invoice = selected || payableInvoices[0];
    const customerId = invoice?.customerId || invoice?.customer?.id;
    if (!invoice || !customerId) {
      setWallet(null);
      setWalletInvoiceId("");
      return;
    }
    if (walletInvoiceId === invoice.id) return;

    let cancelled = false;
    setWalletInvoiceId(invoice.id);
    salonApi.membershipWallets
      .forCustomer(customerId)
      .then((response) => {
        if (!cancelled) setWallet(response.data);
      })
      .catch(() => {
        // A missing or unreadable wallet just means the option is not offered.
        if (!cancelled) setWallet(null);
      });
    return () => {
      cancelled = true;
    };
  }, [action, selected, payableInvoices, walletInvoiceId]);

  const viewPayment = async (row) => {
    try {
      const response = await salonApi.payments.get(row.id);
      setPaymentDetails(response.data);
    } catch (viewError) {
      setError(viewError.message);
    }
  };

  const cancelInvoice = async (invoice) => {
    if (!window.confirm(`Cancel invoice ${invoice.invoiceCode}?`)) return;
    try {
      await salonApi.invoices.cancel(invoice.id);
      await load();
    } catch (cancelError) {
      setError(cancelError.message);
    }
  };

  return (
    <PageShell
      title="Billing & payments"
      description="Generate invoices from completed appointments and record payments against outstanding balances."
      tools={
        <>
          {["SUPER_ADMIN", "SALON_ADMIN", "RECEPTIONIST"].includes(user?.role) && (
            <ReportExportButtons reportType="revenue" />
          )}
          {["SUPER_ADMIN", "SALON_ADMIN", "RECEPTIONIST"].includes(user?.role) && (
            <Button color="info" onClick={() => { setSelected(null); setAction("payment"); }}>
              <Icon name="wallet-in" /> Record payment
            </Button>
          )}
          {["SUPER_ADMIN", "SALON_ADMIN", "STAFF"].includes(user?.role) && (
            <Button color="primary" onClick={() => { setSelected(null); setInvoiceDefaults({}); setAction("invoice"); }}>
              <Icon name="file-plus" /> Generate invoice
            </Button>
          )}
        </>
      }
    >
      {error && <Alert color="danger">{error}</Alert>}
      <Nav tabs className="mt-n2 mb-4">
        <NavItem>
          <NavLink
            href="#invoices"
            active={tab === "invoices"}
            onClick={(event) => {
              event.preventDefault();
              setTab("invoices");
            }}
          >
            Invoices ({activeInvoices.length})
          </NavLink>
        </NavItem>
        <NavItem>
          <NavLink
            href="#payments"
            active={tab === "payments"}
            onClick={(event) => {
              event.preventDefault();
              setTab("payments");
            }}
          >
            Payments ({payments.length})
          </NavLink>
        </NavItem>
      </Nav>
      <TabContent activeTab={tab}>
        <TabPane tabId="invoices">
          <div className="card card-bordered mb-3">
            <div className="card-inner py-3">
              <div className="form-control-wrap">
                <div className="form-icon form-icon-left">
                  <Icon name="search" />
                </div>
                <input
                  type="search"
                  className="form-control"
                  placeholder="Search by invoice number or customer name"
                  value={invoiceSearch}
                  onChange={(event) => setInvoiceSearch(event.target.value)}
                />
              </div>
            </div>
          </div>
          <DataGrid
            rows={visibleInvoices}
            loading={loading}
            columns={[
              { key: "invoiceCode", label: "Invoice" },
              { key: "customerName", label: "Customer" },
              { key: "invoiceDate", label: "Date", render: (value) => formatDate(value) },
              { key: "totalAmount", label: "Total", render: formatMoney },
              { key: "discountAmount", label: "Discount", render: formatMoney },
              { key: "customer", label: "Points", render: (value) => value?.loyaltyPoints ?? 0 },
              { key: "paidAmount", label: "Paid", render: formatMoney },
              { key: "balanceAmount", label: "Balance", render: formatMoney },
              { key: "paymentStatus", label: "Payment", render: (value) => <StatusBadge value={value} /> },
              { key: "status", label: "Status", render: (value) => <StatusBadge value={value} /> },
            ]}
            renderActions={(row) => (
              <>
                <Button
                  size="sm"
                  color="primary"
                  outline
                  onClick={() => navigate(`/billing/invoices/${row.id}`)}
                >
                  View
                </Button>
                <Button
                  size="sm"
                  color="light"
                  className="ms-1"
                  onClick={() =>
                    window.open(`/billing/invoices/${row.id}/print`, "_blank")
                  }
                >
                  <Icon name="printer-fill" />
                </Button>
                {row.status === "ISSUED" &&
                  row.paymentStatus !== "PAID" &&
                  row.appointment?.status !== "CANCELLED" && (
                    <Button
                      size="sm"
                      color="warning"
                      outline
                      className="ms-1"
                      disabled={!row.customer?.loyaltyPoints}
                      onClick={() => {
                        setSelected(row);
                        setAction("redeem");
                      }}
                    >
                      Redeem
                    </Button>
                  )}
                {row.status === "ISSUED" &&
                  row.paymentStatus !== "PAID" &&
                  row.appointment?.status !== "CANCELLED" && (
                    <Button
                      size="sm"
                      color="success"
                      outline
                      className="ms-1"
                      onClick={() => {
                        setSelected(row);
                        setAction("payment");
                      }}
                    >
                      Pay
                    </Button>
                  )}
                {roleCanManage(user?.role) &&
                  row.status !== "CANCELLED" &&
                  row.paymentStatus === "UNPAID" && (
                    <Button
                      size="sm"
                      color="danger"
                      outline
                      className="ms-1"
                      onClick={() => cancelInvoice(row)}
                    >
                      Cancel
                    </Button>
                  )}
              </>
            )}
          />
        </TabPane>
        <TabPane tabId="payments">
          <DataGrid
            rows={payments}
            loading={loading}
            onView={viewPayment}
            columns={[
              { key: "paidAt", label: "Paid at", render: (value) => formatDate(value, true) },
              { key: "invoice", label: "Invoice", render: (value) => value?.invoiceCode || "—" },
              { key: "customer", label: "Customer", render: (value) => value?.name || "—" },
              { key: "amount", label: "Amount", render: formatMoney },
              { key: "method", label: "Method", render: (value) => <StatusBadge value={value} /> },
              { key: "referenceNo", label: "Reference" },
            ]}
          />
        </TabPane>
      </TabContent>

      <SchemaModal
        isOpen={Boolean(action)}
        toggle={() => setAction(null)}
        title={form.title}
        fields={form.fields}
        initialValues={form.initialValues}
        submitLabel={form.submitLabel}
        onSubmit={async (values) => {
          const response = await form.submit(values);
          await load();
          if (action === "invoice" && response?.data?.id) {
            navigate(`/billing/invoices/${response.data.id}`);
          }
        }}
      />
      <DetailsModal
        isOpen={Boolean(paymentDetails)}
        toggle={() => setPaymentDetails(null)}
        title="Payment details"
        data={paymentDetails}
      />
    </PageShell>
  );
};

export default Billing;
