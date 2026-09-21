/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Alert,
  Col,
  FormGroup,
  Input,
  Label,
  Modal,
  ModalBody,
  Row,
  Spinner,
} from "reactstrap";
import { Button, Icon } from "@/components/Component";
import Head from "@/layout/head/Head";
import Content from "@/layout/content/Content";
import StatusBadge from "@/components/salon/StatusBadge";
import { useAuth } from "@/auth/AuthContext";
import { salonApi } from "@/services/salonApi";
import { enqueueConfirm, startConfirmQueue } from "@/services/offlineQueue";
import {
  formatDate,
  formatMoney,
  minDateTimeInput,
  toLocalInput,
} from "@/utils/salonFormat";
import { PAYMENT_METHODS } from "@/utils/paymentMethods";

const TAX_OPTIONS = [
  { value: 0, label: "No tax" },
  { value: 5, label: "GST 5%" },
  { value: 12, label: "GST 12%" },
  { value: 18, label: "GST 18%" },
  { value: 28, label: "GST 28%" },
];

const BILLING_NOTE_MAX = 500;

// The four tiles a walk-in counter actually taps; everything else in
// PAYMENT_METHODS hides behind "Other" so the modal stays one row.
const QUICK_METHODS = [
  { value: "CASH", label: "Cash", icon: "coins" },
  { value: "CARD", label: "Card", icon: "cc-alt2" },
  { value: "UPI", label: "UPI", icon: "mobile" },
];
const OTHER_METHODS = PAYMENT_METHODS.filter(
  (method) => !QUICK_METHODS.some((quick) => quick.value === method.value)
);

// Card header: icon tile, title, sub-line, optional right-hand slot.
const SectionHead = ({ icon, title, subtitle, children }) => (
  <div className="jcp-head">
    <span className="jcp-tile">
      <Icon name={icon} />
    </span>
    <div className="jcp-head-text">
      <h6>{title}</h6>
      {subtitle ? <span>{subtitle}</span> : null}
    </div>
    {children ? <div className="ms-auto">{children}</div> : null}
  </div>
);

// A labelled value that reads as a field but never accepts input.
const ReadField = ({ icon, label, value }) => (
  <div className="jcp-field">
    <span className="jcp-field-icon">
      <Icon name={icon} />
    </span>
    <div className="jcp-field-body">
      <span className="jcp-field-label">{label}</span>
      <span className="jcp-field-value">{value || "—"}</span>
    </div>
  </div>
);

const InsightStat = ({ icon, label, value, note, noteTone }) => (
  <div className="jcp-stat">
    <span className="jcp-tile jcp-tile-sm">
      <Icon name={icon} />
    </span>
    <div className="jcp-stat-body">
      <span className="jcp-stat-label">{label}</span>
      <span className="jcp-stat-value">{value}</span>
      {note ? (
        <span className={`jcp-stat-note${noteTone ? ` text-${noteTone}` : ""}`}>
          {note}
        </span>
      ) : null}
    </div>
  </div>
);

// "0 days ago" reads better than a bare date on the last-visit tile.
const daysAgo = (value) => {
  if (!value) return "";
  const then = new Date(value);
  if (Number.isNaN(then.getTime())) return "";
  const days = Math.max(Math.floor((Date.now() - then.getTime()) / 86400000), 0);
  return `${days} day${days === 1 ? "" : "s"} ago`;
};

const JobCartDetails = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [cart, setCart] = useState(null);
  const [customerSummary, setCustomerSummary] = useState(null);
  const [form, setForm] = useState({
    customerName: "",
    phone: "",
    startTime: "",
    staffId: "",
    bookingNote: "",
  });
  // Customer details read as plain text until the operator asks to edit.
  const [editDetails, setEditDetails] = useState(false);
  const [couponCode, setCouponCode] = useState("");
  const [billingForm, setBillingForm] = useState({
    invoiceType: "BILL_OF_SUPPLY",
    status: "ISSUED",
    discountAmount: 0,
    processingFeeAmount: 0,
    taxPercent: 0,
    billingNote: "",
  });
  // The overall discount is typed as a percentage or a flat amount; the server
  // only ever takes an amount, so the percentage is resolved before sending.
  const [discountMode, setDiscountMode] = useState("PERCENT");
  // Blank amount means "settle the whole bill", which is the walk-in norm.
  const [paymentForm, setPaymentForm] = useState({
    collect: true,
    method: "CASH",
    amount: "",
    referenceNo: "",
  });
  // Split tender: each row is one method and amount. The first row keeps the
  // "blank means the whole bill" behaviour so the common single-payment case
  // needs no typing.
  const [tenders, setTenders] = useState([
    { method: "CASH", amount: "", referenceNo: "" },
  ]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // "+ Product / Membership / Package" picker: which kind is open, the picked
  // id and quantity. Reference lists load once, on the first open.
  const [adding, setAdding] = useState(null);
  const [addForm, setAddForm] = useState({ id: "", quantity: 1 });
  const [addRefs, setAddRefs] = useState(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [queuedNotice, setQueuedNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await salonApi.jobCarts.get(id);
      const next = response.data;
      setCart(next);
      setForm({
        customerName: next.customer?.name || "",
        phone: next.customer?.phone || "",
        startTime: toLocalInput(next.startTime),
        staffId: next.staffId || "",
        bookingNote: next.bookingNote || "",
      });
      setBillingForm({
        invoiceType: next.invoice?.invoiceType || "BILL_OF_SUPPLY",
        // On-spot billing issues the bill as the job ends, so default to
        // issuing. An unconfirmed cart always carries a DRAFT invoice, so
        // mirroring it here would hide the payment section every time.
        status: "ISSUED",
        discountAmount: 0,
        processingFeeAmount: Number(next.invoice?.processingFeeAmount || 0),
        // A bill-of-supply cart carries no line rate, so fall back to the
        // salon's own rate: switching the type to GST then shows real tax
        // instead of a silent zero.
        taxPercent: Number(
          next.invoice?.items?.[0]?.taxPercent ||
            (next.salon?.gstEnabled ? next.salon?.serviceGstRate : 0) ||
            0
        ),
        billingNote: next.invoice?.billingNote || "",
      });
      const summaryResponse = await salonApi.jobCarts.customerSummary({
        customerId: next.customerId,
      });
      setCustomerSummary(summaryResponse.data || null);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // "Make bill" on the job cart list lands here with ?bill=1: open the confirm
  // bill modal straight away instead of making the user find the button.
  useEffect(() => {
    if (!searchParams.get("bill") || !cart) return;
    setSearchParams({}, { replace: true });
    if (cart.status === "ACTIVE" && cart.items.length) setConfirmOpen(true);
  }, [cart, searchParams, setSearchParams]);

  // Push any bill confirmed while offline as soon as the connection is back.
  useEffect(
    () =>
      startConfirmQueue(({ pushed }) => {
        setQueuedNotice(`${pushed} queued bill${pushed === 1 ? "" : "s"} sent.`);
        load();
      }),
    [load]
  );

  const run = async (action) => {
    setWorking(true);
    setError("");
    try {
      await action();
      await load();
    } catch (actionError) {
      setError(actionError.message);
    } finally {
      setWorking(false);
    }
  };

  const save = () => {
    const startTime = new Date(form.startTime);
    if (Number.isNaN(startTime.getTime()) || startTime < new Date()) {
      setError("Choose a start time from now onward.");
      return;
    }
    setEditDetails(false);
    run(() =>
      salonApi.jobCarts.update(id, {
        customerName: form.customerName,
        phone: form.phone,
        startTime: startTime.toISOString(),
        staffId: form.staffId || null,
        bookingNote: form.bookingNote || null,
      })
    );
  };

  const cancel = () => {
    if (!window.confirm("Cancel this active job cart?")) return;
    run(() => salonApi.jobCarts.cancel(id));
  };

  const openAdd = async (kind) => {
    setAddForm({ id: "", quantity: 1 });
    setAdding(kind);
    if (addRefs) return;
    try {
      const response = await salonApi.jobCarts.references({
        salonId: cart.salonId,
        branchId: cart.branchId,
      });
      setAddRefs(response.data);
    } catch (refError) {
      setAdding(null);
      setError(refError.message);
    }
  };

  const addOptions = !addRefs
    ? []
    : adding === "PRODUCT"
      ? (addRefs.products || []).map((product) => ({
          id: product.id,
          label: `${product.name} - ${formatMoney(product.sellingPrice)} (${Number(product.currentStock || 0)} in stock)`,
        }))
      : adding === "MEMBERSHIP"
        ? (addRefs.memberships || []).map((membership) => ({
            id: membership.id,
            label: `${membership.name} - ${formatMoney(membership.price)}`,
          }))
        : (addRefs.packages || []).map((pkg) => ({
            id: pkg.id,
            label: `${pkg.name} - ${formatMoney(pkg.specialPrice)}`,
          }));

  const submitAdd = () => {
    const idKey = {
      PRODUCT: "productId",
      MEMBERSHIP: "membershipId",
      PACKAGE: "packageId",
    }[adding];
    const body = {
      itemType: adding,
      [idKey]: addForm.id,
      ...(adding === "PRODUCT" ? { quantity: Number(addForm.quantity) || 1 } : {}),
    };
    setAdding(null);
    run(() => salonApi.jobCarts.addItem(id, body));
  };

  const canApplyCoupon = ["SUPER_ADMIN", "SALON_ADMIN", "RECEPTIONIST"].includes(
    user?.role
  );
  const canOpenInvoice = ["SUPER_ADMIN", "SALON_ADMIN", "RECEPTIONIST"].includes(
    user?.role
  );
  const active = cart?.status === "ACTIVE";
  const invoice = cart?.invoice;
  const subtotalAmount = Number(invoice?.subtotalAmount || 0);
  const discountInput = Number(billingForm.discountAmount || 0);
  // Stacking off (Settings): a member gets their membership discount only, so
  // the overall discount is locked at zero. The server refuses it too.
  const discountsLocked =
    Number(customerSummary?.membershipDiscountPercentage || 0) > 0 &&
    !cart?.salon?.stackMembershipDiscount;
  const manualDiscount = !active || discountsLocked
    ? 0
    : discountMode === "PERCENT"
      ? (subtotalAmount * Math.min(Math.max(discountInput, 0), 100)) / 100
      : Math.max(discountInput, 0);
  const membershipPercent = Number(
    cart?.customer?.membership?.discountPercentage || 0
  );
  // Mirrors isMembershipDiscountable on the server: a membership never reduces
  // a product, and only reduces a package when the salon has opted in. Keeping
  // the rule in step here stops the page promising a discount the bill refuses.
  const isDiscountableLine = (item) =>
    item.itemType === "PRODUCT" || item.itemType === "MEMBERSHIP"
      ? false
      : item.itemType === "PACKAGE"
        ? Boolean(cart?.salon?.membershipDiscountOnPackages)
        : true;
  const membershipDiscountBase = (invoice?.items || [])
    .filter(isDiscountableLine)
    .reduce(
      (total, item) =>
        total + Number(item.quantity || 0) * Number(item.unitPrice || 0),
      0
    );
  const membershipDiscount = active
    ? Math.min(
        membershipDiscountBase * (membershipPercent / 100),
        Math.max(membershipDiscountBase - manualDiscount, 0)
      )
    : Number(invoice?.discountAmount || 0);
  const discountTotal = active
    ? Math.min(manualDiscount + membershipDiscount, subtotalAmount)
    : Number(invoice?.discountAmount || 0);
  const processingFee = active
    ? Number(billingForm.processingFeeAmount || 0)
    : Number(invoice?.processingFeeAmount || 0);
  const taxableAmount = Math.max(subtotalAmount - discountTotal, 0);
  const taxAmount =
    active && billingForm.invoiceType === "GST_INVOICE"
      ? taxableAmount * (Number(billingForm.taxPercent || 0) / 100)
      : Number(invoice?.taxAmount || 0);
  const exactPayable = taxableAmount + processingFee + taxAmount;
  // Bills settle in whole rupees, same as the server.
  const payableAmount = active
    ? Math.round(exactPayable)
    : Number(invoice?.totalAmount || 0);
  const roundOffAmount = active
    ? payableAmount - exactPayable
    : Number(invoice?.roundOffAmount || 0);
  const membershipWalletBalance = Number(
    customerSummary?.membershipWalletBalance || 0
  );
  const packageCoveredAmount = (cart?.packageRedemptions || [])
    .filter((usage) => usage.status !== "CANCELLED")
    .flatMap((usage) => usage.items || [])
    .reduce(
      (total, item) =>
        total + Number(item.priceSnapshot || 0) * Number(item.quantity || 0),
      0
    );
  // One rate covers every taxed line in practice, so the column header names it
  // and a row only repeats a rate that differs from it.
  // While the cart is open, preview how confirming will split the discount and
  // tax across lines - same pro-rata split as calculateInvoiceGst on the server.
  const round2 = (value) => Math.round(value * 100) / 100;
  const previewTaxRate =
    billingForm.invoiceType === "GST_INVOICE"
      ? Number(billingForm.taxPercent || 0)
      : 0;
  const lineGross = (item) =>
    Number(item.price || 0) * Number(item.quantity ?? 1);
  const discountableGross = (cart?.items || [])
    .filter(isDiscountableLine)
    .reduce((total, item) => total + lineGross(item), 0);
  const lineDiscountTotal = Math.min(
    discountTotal + Number(invoice?.couponDiscountAmount || 0),
    discountableGross
  );
  const lastDiscountableIndex = (cart?.items || [])
    .map(isDiscountableLine)
    .lastIndexOf(true);
  const discountShares = (cart?.items || []).map((item, index) =>
    !isDiscountableLine(item) ||
    index === lastDiscountableIndex ||
    !discountableGross
      ? 0
      : round2((lineGross(item) * lineDiscountTotal) / discountableGross)
  );
  if (lastDiscountableIndex >= 0) {
    // The last line takes the rounding remainder so the shares add up exactly.
    discountShares[lastDiscountableIndex] = round2(
      lineDiscountTotal -
        discountShares.reduce((total, share) => total + share, 0)
    );
  }
  const tableItems = (cart?.items || []).map((item, index) => {
    if (!active) return item;
    const gross = lineGross(item);
    const discountAmount = discountShares[index];
    const taxAmount = round2(
      (Math.max(gross - discountAmount, 0) * previewTaxRate) / 100
    );
    return {
      ...item,
      discountAmount,
      gstPercent: previewTaxRate,
      taxAmount,
      lineTotal: round2(Math.max(gross - discountAmount, 0) + taxAmount),
    };
  });
  const headerTaxPercent = Number(
    tableItems.find((item) => Number(item.gstPercent) > 0)
      ?.gstPercent || 0
  );

  // A member pays from the wallet first; whatever the balance cannot cover is
  // split onto a second tender below.
  useEffect(() => {
    if (membershipWalletBalance <= 0) return;
    setTenders((current) =>
      current.length === 1 &&
      current[0].method === "CASH" &&
      !current[0].amount &&
      !current[0].referenceNo
        ? [{ ...current[0], method: "MEMBERSHIP_WALLET" }]
        : current
    );
  }, [membershipWalletBalance]);

  const collecting = billingForm.status !== "DRAFT" && paymentForm.collect;
  // Once a split row exists the first tender silently takes whatever the split
  // rows leave, so its amount field is hidden and only the splits are typed.
  const splitting = tenders.length > 1;
  const splitRowsTotal = tenders
    .slice(1)
    .reduce((sum, tender) => sum + Number(tender.amount || 0), 0);
  const firstTenderAmount = Math.max(payableAmount - splitRowsTotal, 0);
  const activeTenders = (
    collecting ? tenders.filter((tender) => tender.method) : []
  ).map((tender, index) =>
    splitting && index === 0
      ? { ...tender, amount: firstTenderAmount.toFixed(2) }
      : tender
  );
  // A blank amount on a lone tender means "the whole bill", which the server
  // settles against its own rounded total so a stale estimate cannot underpay.
  // The wallet is the exception: it can only ever settle what it holds, so a
  // blank wallet amount means "up to the balance" and the rest stays to split.
  const tenderTotal = activeTenders.reduce(
    (sum, tender) => sum + Number(tender.amount || 0),
    0
  );
  const singleFullTender =
    activeTenders.length === 1 && !activeTenders[0].amount;
  // The wallet pays for services only (walletPayableFor on the server): the
  // payable less every product, package and membership line.
  const nonServiceTotal = tableItems
    .filter((item) => ["PRODUCT", "PACKAGE", "MEMBERSHIP"].includes(item.itemType))
    .reduce((total, item) => total + Number(item.lineTotal || 0), 0);
  const walletCap = Math.max(payableAmount - nonServiceTotal, 0);
  const singleFullAmount = !singleFullTender
    ? 0
    : activeTenders[0].method === "MEMBERSHIP_WALLET"
      ? Math.min(membershipWalletBalance, walletCap)
      : payableAmount;
  const collectedAmount = singleFullTender ? singleFullAmount : tenderTotal;
  const outstandingAfter = Math.max(payableAmount - collectedAmount, 0);
  const overpaying = collectedAmount - payableAmount > 0.004;
  const walletTender = activeTenders.find(
    (tender) => tender.method === "MEMBERSHIP_WALLET"
  );
  const otherMethodPicked = OTHER_METHODS.some(
    (option) => option.value === tenders[0].method
  );
  const walletShort =
    walletTender &&
    (singleFullTender ? singleFullAmount : Number(walletTender.amount || 0)) >
      membershipWalletBalance + 0.004;
  // Split for the pay modal: the wallet settles services; products, packages
  // and memberships ride on another payment.
  const walletPaid = walletTender
    ? singleFullTender
      ? singleFullAmount
      : Number(walletTender.amount || 0)
    : 0;
  const walletOverCap = Boolean(walletTender) && walletPaid > walletCap + 0.004;
  const serviceLinesTotal = walletCap;
  const walletOnServices = Math.min(walletPaid, serviceLinesTotal);
  const serviceShortfall = serviceLinesTotal - walletOnServices;
  const restAmount = Math.max(payableAmount - walletOnServices, 0);
  const hasProducts = nonServiceTotal > 0.004;
  const restMethods = activeTenders
    .filter(
      (tender) =>
        tender.method !== "MEMBERSHIP_WALLET" || walletPaid > walletOnServices
    )
    .map(
      (tender) =>
        PAYMENT_METHODS.find((option) => option.value === tender.method)
          ?.label || tender.method
    )
    .join(" + ");

  const buildConfirmBody = () => ({
    ...billingForm,
    // The percentage is a UI affordance only; the bill carries the rupees.
    discountAmount: Number(manualDiscount.toFixed(2)),
    processingFeeAmount: Number(billingForm.processingFeeAmount || 0),
    taxPercent: Number(billingForm.taxPercent || 0),
    billingNote: billingForm.billingNote || null,
    // Stamped here, not on the server, so a confirm pushed later from the
    // offline queue keeps the time the operator actually ended the job.
    confirmedAt: new Date().toISOString(),
    idempotencyKey: globalThis.crypto.randomUUID(),
    ...(collecting && activeTenders.length
      ? {
          payments: activeTenders
            .map((tender) => ({
              method: tender.method,
              amount: singleFullTender
                ? Number(singleFullAmount.toFixed(2))
                : Number(tender.amount),
              ...(tender.referenceNo?.trim()
                ? { referenceNo: tender.referenceNo.trim() }
                : {}),
              ...(tender.method === "MEMBERSHIP_WALLET" &&
              customerSummary?.currentCustomerMembershipId
                ? {
                    customerMembershipId:
                      customerSummary.currentCustomerMembershipId,
                  }
                : {}),
            }))
            .filter((tender) => tender.amount > 0),
        }
      : {}),
  });

  const confirm = async () => {
    const body = buildConfirmBody();
    setConfirmOpen(false);
    setWorking(true);
    setError("");
    try {
      await salonApi.jobCarts.confirm(id, body);
      await load();
    } catch (actionError) {
      // A transport failure may still have been applied server-side, so the
      // confirm is queued rather than retried blindly: the idempotency key
      // makes the replay safe either way.
      if (!navigator.onLine || actionError.status === 0) {
        enqueueConfirm(id, body);
        setQueuedNotice(
          "No connection. This bill is saved and will be sent automatically when you are back online."
        );
      } else {
        setError(actionError.message);
      }
    } finally {
      setWorking(false);
    }
  };

  const setTenderValue = (index, key, value) =>
    setTenders((current) =>
      current.map((row, rowIndex) =>
        rowIndex === index ? { ...row, [key]: value } : row
      )
    );

  return (
    <>
      <Head title={cart ? `Job Cart ${cart.jobCartId}` : "Job Cart"} />
      <Content className="is-wide jcp">
        {loading && !cart ? (
          <div className="text-center py-5">
            <Spinner color="primary" />
          </div>
        ) : !cart ? null : (
          <>
            <div className="jcp-topbar">
              <button
                type="button"
                className="jcp-back"
                onClick={() => navigate("/job-carts")}
              >
                <Icon name="arrow-left" />
                <span>Back to Jobs</span>
              </button>
              <div className="jcp-topbar-meta">
                <span>
                  <Icon name="calendar-alt" />
                  {formatDate(cart.startTime, true)}
                </span>
                <span className="jcp-topbar-sep" />
                <span>Job Cart – {cart.jobCartId}</span>
              </div>
              <div className="ms-auto d-flex align-items-center gap-2">
                <button
                  type="button"
                  className="jcp-back"
                  onClick={() => navigate(`/job-carts/${cart.id}/view`)}
                >
                  <Icon name="file-text" />
                  <span>View</span>
                </button>
                <StatusBadge value={cart.status} />
              </div>
            </div>

            {error && <Alert color="danger">{error}</Alert>}
            {queuedNotice && (
              <Alert
                color="info"
                className="d-flex justify-content-between align-items-center"
              >
                <span>{queuedNotice}</span>
                <Button
                  size="sm"
                  color="light"
                  onClick={() => setQueuedNotice("")}
                >
                  Dismiss
                </Button>
              </Alert>
            )}

            <Row className="g-4">
              <Col xl="8">
                <div className="jcp-hero">
                  <span className="jcp-tile jcp-tile-lg">
                    <Icon name="cc-alt" />
                  </span>
                  <div className="jcp-hero-text">
                    <h4>Complete Your Payment</h4>
                    <p>
                      Review your services and details, apply any discounts and
                      proceed to payment.
                    </p>
                  </div>
                  <span className="jcp-hero-art">Self Care Looks Good On You</span>
                </div>

                <div className="card card-bordered jcp-card mb-4">
                  <div className="card-inner">
                    <SectionHead icon="user-alt" title="Customer Details">
                      {active && (
                        <Button
                          color="primary"
                          outline
                          size="sm"
                          disabled={working}
                          onClick={() =>
                            editDetails ? save() : setEditDetails(true)
                          }
                        >
                          <Icon name={editDetails ? "check" : "edit"} />
                          <span>{editDetails ? "Save" : "Edit"}</span>
                        </Button>
                      )}
                    </SectionHead>
                    <Row className="g-3">
                      <Col md="4">
                        <ReadField
                          icon="user"
                          label="Customer Name"
                          value={form.customerName}
                        />
                      </Col>
                      <Col md="4">
                        <ReadField
                          icon="call"
                          label="Phone Number"
                          value={form.phone}
                        />
                      </Col>
                      <Col md="4">
                        {editDetails ? (
                          <FormGroup noMargin>
                            <Label className="jcp-field-label">
                              Date &amp; Start Time
                            </Label>
                            <Input
                              type="datetime-local"
                              min={minDateTimeInput()}
                              value={form.startTime}
                              onChange={(event) =>
                                setForm((current) => ({
                                  ...current,
                                  startTime: event.target.value,
                                }))
                              }
                            />
                          </FormGroup>
                        ) : (
                          <ReadField
                            icon="calendar"
                            label="Date & Start Time"
                            value={formatDate(cart.startTime, true)}
                          />
                        )}
                      </Col>
                      {editDetails ? (
                        <Col xs="12">
                          <Label className="jcp-field-label">Booking note</Label>
                          <Input
                            type="textarea"
                            rows="2"
                            placeholder="Anything the stylist should know"
                            value={form.bookingNote}
                            onChange={(event) =>
                              setForm((current) => ({
                                ...current,
                                bookingNote: event.target.value,
                              }))
                            }
                          />
                        </Col>
                      ) : form.bookingNote ? (
                        <Col xs="12">
                          <div className="jcp-note">
                            <Icon name="note-add" /> {form.bookingNote}
                          </div>
                        </Col>
                      ) : null}
                    </Row>
                  </div>
                </div>

                {customerSummary?.recentInvoices?.length ? (
                  <div className="card card-bordered jcp-card mb-4">
                    <div className="card-inner">
                      <SectionHead
                        icon="file-docs"
                        title="Invoices"
                        subtitle="Earlier bills for this customer."
                      >
                        {customerSummary.recentInvoices.length > 4 && (
                          <Button
                            type="button"
                            color="primary"
                            outline
                            size="sm"
                            onClick={() =>
                              navigate(
                                `/billing?q=${encodeURIComponent(
                                  form.phone || form.customerName
                                )}`
                              )
                            }
                          >
                            <span>View more</span>
                            <Icon name="arrow-long-right" />
                          </Button>
                        )}
                      </SectionHead>
                      <Row className="g-2">
                        {customerSummary.recentInvoices
                          .slice(0, 4)
                          .map((recent) => (
                            <Col sm="12" xl="6" key={recent.invoiceId}>
                              <Link
                                to={`/billing/invoices/${recent.invoiceId}`}
                                className="jcp-invoice-tile"
                              >
                                <span className="jcp-item-name">
                                  {recent.invoiceCode}
                                </span>
                                <span className="jcp-item-sub">
                                  {formatDate(
                                    recent.issuedAt || recent.createdAt
                                  )}
                                </span>
                                <strong>
                                  {formatMoney(recent.totalAmount)}
                                </strong>
                                <StatusBadge value={recent.paymentStatus} />
                              </Link>
                            </Col>
                          ))}
                      </Row>
                    </div>
                  </div>
                ) : null}

                <div className="card card-bordered jcp-card mb-4">
                  <div className="card-inner">
                    <SectionHead
                      icon="scissor"
                      title="Services & Package"
                      subtitle="Review the selected services for this job cart."
                    >
                      <div className="d-flex flex-wrap align-items-center gap-2">
                        {active &&
                          [
                            ["PRODUCT", "Product"],
                            ["MEMBERSHIP", "Membership"],
                            ["PACKAGE", "Package"],
                          ].map(([kind, label]) => (
                            <Button
                              key={kind}
                              color="primary"
                              outline
                              size="sm"
                              disabled={working}
                              onClick={() => openAdd(kind)}
                            >
                              <Icon name="plus" />
                              <span>{label}</span>
                            </Button>
                          ))}
                        <span className="jcp-chip">
                          {cart.items.length} Item
                          {cart.items.length === 1 ? "" : "s"}
                        </span>
                      </div>
                    </SectionHead>
                    <div className="table-responsive">
                      <table className="table jcp-table">
                        <thead>
                          <tr>
                            <th style={{ width: 44 }}>#</th>
                            <th>Service</th>
                            <th>Duration</th>
                            <th className="text-end">Qty</th>
                            <th className="text-end">Price</th>
                            <th className="text-end">Discount</th>
                            <th className="text-end">
                              Tax
                              {headerTaxPercent ? ` (${headerTaxPercent}%)` : ""}
                            </th>
                            <th className="text-end">Total</th>
                            {active && <th style={{ width: 44 }} />}
                          </tr>
                        </thead>
                        <tbody>
                          {cart.items.length ? (
                            tableItems.map((item, index) => (
                              <tr key={item.id}>
                                <td className="text-soft">{index + 1}</td>
                                <td>
                                  <span className="jcp-item-name">
                                    {item.serviceName}
                                  </span>
                                  {item.itemType === "SERVICE" &&
                                    item.staff?.name && (
                                      <span className="jcp-item-sub">
                                        {item.staff.name}
                                      </span>
                                    )}
                                  {item.itemType === "PACKAGE" && (
                                    <span className="jcp-item-sub text-primary">
                                      Package
                                      {item.soldByStaff?.name
                                        ? ` • Sold by ${item.soldByStaff.name}`
                                        : ""}
                                    </span>
                                  )}
                                  {item.itemType === "PRODUCT" && (
                                    <span className="jcp-item-sub text-info">
                                      Product x{item.quantity}
                                      {item.soldByStaff?.name
                                        ? ` • Sold by ${item.soldByStaff.name}`
                                        : ""}{" "}
                                      • not covered by membership
                                    </span>
                                  )}
                                  {item.itemType === "MEMBERSHIP" && (
                                    <span className="jcp-item-sub text-success">
                                      Membership
                                      {item.membership?.durationMonths
                                        ? ` • ${item.membership.durationMonths} months`
                                        : ""}
                                      {item.soldByStaff?.name
                                        ? ` • Sold by ${item.soldByStaff.name}`
                                        : ""}{" "}
                                      • starts when the bill is confirmed
                                    </span>
                                  )}
                                </td>
                                <td>
                                  {item.itemType === "PACKAGE"
                                    ? `${item.package?.validityDays || 0} days validity`
                                    : item.itemType === "PRODUCT" ||
                                        item.itemType === "MEMBERSHIP"
                                      ? "—"
                                      : `${item.durationValue || 0} ${(
                                          item.durationUnit || "MINUTES"
                                        ).toLowerCase()}`}
                                </td>
                                <td className="text-end">{item.quantity ?? 1}</td>
                                <td className="text-end">
                                  {formatMoney(
                                    item.itemType === "PRODUCT"
                                      ? item.lineTotal
                                      : item.price
                                  )}
                                  {item.itemType === "PRODUCT" &&
                                  item.quantity > 1 ? (
                                    <span className="jcp-item-sub">
                                      {item.quantity} x {formatMoney(item.price)}
                                    </span>
                                  ) : null}
                                </td>
                                <td className="text-end">
                                  {Number(item.discountAmount || 0) > 0 ? (
                                    <span className="text-success">
                                      - {formatMoney(item.discountAmount)}
                                    </span>
                                  ) : (
                                    "—"
                                  )}
                                </td>
                                <td className="text-end">
                                  {item.taxAmount === null ||
                                  item.taxAmount === undefined ? (
                                    "—"
                                  ) : (
                                    <>
                                      {formatMoney(item.taxAmount)}
                                      {Number(item.gstPercent) > 0 &&
                                      Number(item.gstPercent) !==
                                        headerTaxPercent ? (
                                        <span className="jcp-item-sub">
                                          {Number(item.gstPercent)}%
                                        </span>
                                      ) : null}
                                    </>
                                  )}
                                </td>
                                <td className="text-end fw-bold">
                                  {item.lineTotal === null ||
                                  item.lineTotal === undefined
                                    ? "—"
                                    : formatMoney(item.lineTotal)}
                                </td>
                                {active && (
                                  <td className="text-end">
                                    {item.itemType !== "SERVICE" && (
                                      <button
                                        type="button"
                                        className="jcp-tender-remove"
                                        aria-label={`Remove ${item.serviceName}`}
                                        disabled={working}
                                        onClick={() =>
                                          run(() =>
                                            salonApi.jobCarts.removeItem(
                                              id,
                                              item.id
                                            )
                                          )
                                        }
                                      >
                                        <Icon name="cross" />
                                      </button>
                                    )}
                                  </td>
                                )}
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td
                                colSpan={active ? 9 : 8}
                                className="text-center text-soft py-4"
                              >
                                No services or packages on this job cart.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>

                    {(cart.packageRedemptions || []).length > 0 && (
                      <div className="mt-3">
                        <h6 className="jcp-subhead">Package-covered Services</h6>
                        {(cart.packageRedemptions || []).map((usage) => (
                          <div key={usage.id} className="jcp-panel mb-2">
                            <div>
                              <strong>
                                {usage.customerPackage?.packageNameSnapshot}
                              </strong>
                              <div className="small text-soft">
                                {usage.status}
                                {usage.customerPackage?.maxRedemptionsSnapshot !=
                                null
                                  ? " | " +
                                    (usage.customerPackage.usedRedemptions || 0) +
                                    " of " +
                                    usage.customerPackage
                                      .maxRedemptionsSnapshot +
                                    " visits used, " +
                                    Math.max(
                                      usage.customerPackage
                                        .maxRedemptionsSnapshot -
                                        (usage.customerPackage.usedRedemptions ||
                                          0) -
                                        (usage.customerPackage
                                          .reservedRedemptions || 0),
                                      0
                                    ) +
                                    " left"
                                  : ""}
                              </div>
                            </div>
                            {(usage.items || []).map((item) => (
                              <div
                                key={item.id}
                                className="d-flex justify-content-between small mt-2"
                              >
                                <span>
                                  {item.serviceNameSnapshot} × {item.quantity}
                                  {item.staff?.name
                                    ? ` • ${item.staff.name}`
                                    : ""}
                                </span>
                                <strong className="text-end">
                                  Package covered
                                  {item.customerPackageServiceBalance ? (
                                    <span className="d-block fw-normal text-soft">
                                      {Math.max(
                                        (item.customerPackageServiceBalance
                                          .includedQuantity || 0) -
                                          (item.customerPackageServiceBalance
                                            .usedQuantity || 0) -
                                          (item.customerPackageServiceBalance
                                            .reservedQuantity || 0),
                                        0
                                      )}{" "}
                                      of{" "}
                                      {item.customerPackageServiceBalance
                                        .includedQuantity || 0}{" "}
                                      left
                                    </span>
                                  ) : null}
                                </strong>
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="card card-bordered jcp-card">
                  <div className="card-inner">
                    <SectionHead
                      icon="wallet"
                      title="Billing Options"
                      subtitle={
                        active
                          ? "Discounts, tax and fees applied to this bill."
                          : "This job cart is billed. The figures below are final."
                      }
                    />
                    {active ? (
                      <Row className="g-3 jcp-billing-options">
                        <Col md="5">
                          <Label className="jcp-field-label">
                            Overall Discount{" "}
                            <span className="text-soft">(Optional)</span>
                          </Label>
                          <div className="d-flex gap-2">
                            <Input
                              type="select"
                              bsSize="sm"
                              style={{ flex: "0 0 150px" }}
                              value={discountMode}
                              disabled={discountsLocked}
                              onChange={(event) =>
                                setDiscountMode(event.target.value)
                              }
                            >
                              <option value="PERCENT">Percentage</option>
                              <option value="AMOUNT">Amount</option>
                            </Input>
                            <div className="jcp-input-suffix">
                              <Input
                                type="number"
                                bsSize="sm"
                                min="0"
                                max={
                                  discountMode === "PERCENT" ? "100" : undefined
                                }
                                step="0.01"
                                value={discountsLocked ? "" : billingForm.discountAmount}
                                disabled={discountsLocked}
                                onChange={(event) =>
                                  setBillingForm((current) => ({
                                    ...current,
                                    discountAmount: event.target.value,
                                  }))
                                }
                              />
                              <span>
                                {discountMode === "PERCENT" ? "%" : "₹"}
                              </span>
                            </div>
                          </div>
                          {membershipDiscount > 0 && (
                            <small className="text-soft d-block mt-1">
                              Membership discount included:{" "}
                              {formatMoney(membershipDiscount)}
                              {discountsLocked
                                ? ". Extra discounts are off in Settings."
                                : ""}
                            </small>
                          )}
                        </Col>

                        <Col md="7">
                          <Row className="g-2">
                            <Col sm="4">
                              <Label className="jcp-field-label">
                                Invoice type
                              </Label>
                              <Input
                                type="select"
                                bsSize="sm"
                                value={billingForm.invoiceType}
                                onChange={(event) =>
                                  setBillingForm((current) => ({
                                    ...current,
                                    invoiceType: event.target.value,
                                  }))
                                }
                              >
                                <option value="BILL_OF_SUPPLY">
                                  Bill of supply
                                </option>
                                <option value="GST_INVOICE">GST invoice</option>
                              </Input>
                            </Col>
                            <Col sm="4">
                              <Label className="jcp-field-label">Tax</Label>
                              <Input
                                type="select"
                                bsSize="sm"
                                value={billingForm.taxPercent}
                                onChange={(event) =>
                                  setBillingForm((current) => ({
                                    ...current,
                                    taxPercent: event.target.value,
                                  }))
                                }
                              >
                                {TAX_OPTIONS.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </Input>
                            </Col>
                            <Col sm="4">
                              <Label className="jcp-field-label">
                                Processing fee
                              </Label>
                              <Input
                                type="number"
                                bsSize="sm"
                                min="0"
                                step="0.01"
                                value={billingForm.processingFeeAmount}
                                onChange={(event) =>
                                  setBillingForm((current) => ({
                                    ...current,
                                    processingFeeAmount: event.target.value,
                                  }))
                                }
                              />
                            </Col>
                          </Row>
                        </Col>
                      </Row>
                    ) : (
                      <Row className="g-3">
                        <Col md="6">
                          <div className="jcp-amount">
                            <span className="jcp-field-label">Total billed</span>
                            <strong>{formatMoney(payableAmount)}</strong>
                            <span className="jcp-amount-note">
                              Inclusive of all taxes
                            </span>
                          </div>
                        </Col>
                        <Col md="6">
                          {invoice && cart.status !== "CANCELLED" ? (
                            <>
                              <div className="jcp-line">
                                <span>Paid</span>
                                <strong>{formatMoney(invoice.paidAmount)}</strong>
                              </div>
                              <div className="jcp-line">
                                <span>Balance</span>
                                <strong>
                                  {formatMoney(invoice.balanceAmount)}
                                </strong>
                              </div>
                              <div className="mt-2">
                                <StatusBadge value={invoice.paymentStatus} />
                              </div>
                              {(invoice.payments || []).map((payment) => (
                                <small
                                  key={payment.id}
                                  className="d-block text-soft mt-1"
                                >
                                  {formatMoney(payment.amount)} via{" "}
                                  {PAYMENT_METHODS.find(
                                    (option) => option.value === payment.method
                                  )?.label || payment.method}{" "}
                                  on {formatDate(payment.paidAt)}
                                  {payment.referenceNo
                                    ? ` (${payment.referenceNo})`
                                    : ""}
                                </small>
                              ))}
                            </>
                          ) : null}
                        </Col>
                      </Row>
                    )}
                  </div>
                </div>
              </Col>

              <Col xl="4">
                {customerSummary && (
                  <div className="card card-bordered jcp-card jcp-insight mb-4">
                    <div className="jcp-insight-head">
                      <span className="jcp-tile jcp-tile-on-dark">
                        <Icon name="user-alt" />
                      </span>
                      <div className="jcp-head-text">
                        <h6>Customer Insights</h6>
                        <span>Know your customer better</span>
                      </div>
                      {customerSummary.membershipName ? (
                        <span className="jcp-vip ms-auto">
                          <Icon name="award" /> {customerSummary.membershipName}
                        </span>
                      ) : null}
                    </div>
                    <div className="card-inner">
                      <div className="jcp-stats">
                        <InsightStat
                          icon="calendar-alt"
                          label="Last Visit"
                          value={formatDate(customerSummary.lastVisitDate)}
                          note={daysAgo(customerSummary.lastVisitDate)}
                        />
                        <InsightStat
                          icon="bar-chart"
                          label="Total Visits"
                          value={customerSummary.totalVisits}
                        />
                        <InsightStat
                          icon="gift"
                          label="Loyalty Points"
                          value={customerSummary.loyaltyPoints}
                        />
                        <InsightStat
                          icon="wallet"
                          label="Wallet Balance"
                          value={formatMoney(customerSummary.walletBalance)}
                        />
                        <InsightStat
                          icon="cc-alt"
                          label="Outstanding"
                          value={formatMoney(customerSummary.outstandingBalance)}
                          note={
                            Number(customerSummary.outstandingBalance) > 0
                              ? "Due amount"
                              : ""
                          }
                          noteTone="danger"
                        />
                        <InsightStat
                          icon="award"
                          label="Membership"
                          value={customerSummary.membershipName || "None"}
                          note={
                            customerSummary.membershipExpiresAt
                              ? `Expires ${formatDate(
                                  customerSummary.membershipExpiresAt
                                )}`
                              : ""
                          }
                        />
                      </div>
                      <div className="jcp-stat mt-2">
                        <span className="jcp-tile jcp-tile-sm">
                          <Icon name="users" />
                        </span>
                        <div className="jcp-stat-body">
                          <span className="jcp-stat-label">Preferred Staff</span>
                          <span className="jcp-stat-value">
                            {customerSummary.preferredStaff?.staffName ||
                              "Not known"}
                          </span>
                        </div>
                      </div>

                      {customerSummary.activePackages?.length ? (
                        <>
                          <h6 className="jcp-subhead mt-3">Active Packages</h6>
                          {customerSummary.activePackages.map((item) => (
                            <div
                              key={item.customerPackageId}
                              className="jcp-panel mb-2"
                            >
                              <div className="d-flex justify-content-between gap-2">
                                <strong>{item.packageName}</strong>
                                <span className="small text-soft">
                                  Valid to {formatDate(item.validUntil)}
                                </span>
                              </div>
                              {(item.serviceBalances || []).map((balance) => (
                                <div
                                  key={balance.balanceId}
                                  className="d-flex justify-content-between small text-soft mt-1"
                                >
                                  <span>{balance.serviceName}</span>
                                  <span>
                                    {balance.remainingQuantity} of{" "}
                                    {balance.includedQuantity} left
                                  </span>
                                </div>
                              ))}
                            </div>
                          ))}
                        </>
                      ) : null}
                    </div>
                  </div>
                )}

                <div className="card card-bordered jcp-card jcp-actions">
                  <div className="card-inner">
                    <div className="jcp-sum-head">
                      <h6>Order Summary</h6>
                      <span className="jcp-chip">
                        {cart.items.length} Item
                        {cart.items.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div className="jcp-line">
                      <span>Paid services / packages</span>
                      <strong>{formatMoney(subtotalAmount)}</strong>
                    </div>
                    {packageCoveredAmount > 0 && (
                      <div className="jcp-line">
                        <span>Package-covered</span>
                        <strong>{formatMoney(packageCoveredAmount)}</strong>
                      </div>
                    )}
                    <div className="jcp-line">
                      <span>Membership / discount</span>
                      <strong>-{formatMoney(discountTotal)}</strong>
                    </div>
                    {processingFee > 0 && (
                      <div className="jcp-line">
                        <span>Processing fee</span>
                        <strong>{formatMoney(processingFee)}</strong>
                      </div>
                    )}
                    <div className="jcp-line">
                      <span>Tax</span>
                      <strong>{formatMoney(taxAmount)}</strong>
                    </div>
                    {Number(invoice?.couponDiscountAmount || 0) > 0 && (
                      <div className="jcp-line">
                        <span>Coupon</span>
                        <strong>
                          -{formatMoney(invoice.couponDiscountAmount)}
                        </strong>
                      </div>
                    )}
                    {Math.abs(roundOffAmount) >= 0.005 && (
                      <div className="jcp-line">
                        <span>Round off</span>
                        <strong>
                          {roundOffAmount > 0 ? "+" : "-"}
                          {formatMoney(Math.abs(roundOffAmount))}
                        </strong>
                      </div>
                    )}
                    <div className="jcp-line jcp-line-total">
                      <span>Payable amount</span>
                      <strong>{formatMoney(payableAmount)}</strong>
                    </div>

                    {active ? (
                      <div className="jcp-cta">
                        <Button
                          className="jcp-pay"
                          disabled={working || !cart.items.length}
                          onClick={() => setConfirmOpen(true)}
                        >
                          {working ? (
                            <Spinner size="sm" />
                          ) : (
                            <Icon name="lock-alt" />
                          )}
                          <span>Pay Now {formatMoney(payableAmount)}</span>
                        </Button>
                        <Button
                          className="jcp-cancel"
                          disabled={working}
                          onClick={cancel}
                        >
                          Cancel Job Cart
                        </Button>
                      </div>
                    ) : invoice && canOpenInvoice ? (
                      <Link
                        to={`/billing/invoices/${invoice.id}`}
                        className="d-block mt-3"
                      >
                        <Button className="jcp-pay w-100">
                          <span>
                            {cart.status === "CANCELLED" ||
                            invoice.paymentStatus === "PAID"
                              ? "Open Invoice"
                              : "Open Invoice / Payment"}
                          </span>
                          <Icon name="arrow-long-right" />
                        </Button>
                      </Link>
                    ) : invoice ? (
                      <p className="text-soft small mt-3 mb-0">
                        Invoice issued. Payment access follows the existing
                        billing role policy.
                      </p>
                    ) : null}
                  </div>
                </div>
              </Col>
            </Row>
          </>
        )}

        <Modal isOpen={Boolean(adding)} toggle={() => setAdding(null)} centered>
          <ModalBody>
            <h5 className="mb-3">
              Add {adding ? adding.charAt(0) + adding.slice(1).toLowerCase() : ""}
            </h5>
            {!addRefs ? (
              <div className="text-center py-3">
                <Spinner size="sm" color="primary" />
              </div>
            ) : (
              <>
                <Input
                  type="select"
                  value={addForm.id}
                  onChange={(event) =>
                    setAddForm((current) => ({ ...current, id: event.target.value }))
                  }
                >
                  <option value="">
                    {addOptions.length ? "Select..." : "Nothing available"}
                  </option>
                  {addOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </Input>
                {adding === "PRODUCT" && (
                  <FormGroup className="mt-2" noMargin>
                    <Label className="jcp-field-label">Quantity</Label>
                    <Input
                      type="number"
                      min="1"
                      max="999"
                      value={addForm.quantity}
                      onChange={(event) =>
                        setAddForm((current) => ({
                          ...current,
                          quantity: event.target.value,
                        }))
                      }
                    />
                  </FormGroup>
                )}
              </>
            )}
            <div className="d-flex justify-content-end gap-2 mt-3">
              <Button color="light" onClick={() => setAdding(null)}>
                Cancel
              </Button>
              <Button
                color="primary"
                disabled={!addForm.id || working}
                onClick={submitAdd}
              >
                Add
              </Button>
            </div>
          </ModalBody>
        </Modal>

        <Modal
          isOpen={confirmOpen}
          toggle={() => setConfirmOpen(false)}
          size="lg"
          centered
          contentClassName="jcp-modal"
        >
          <ModalBody className="jcp-modal-body">
            <div className="jcp-modal-head">
              <span className="jcp-tile">
                <Icon name="lock-alt" />
              </span>
              <div className="jcp-head-text">
                <h5>Make Payment</h5>
                <span>Choose a payment method to complete your job cart</span>
              </div>
              <button
                type="button"
                className="jcp-modal-close"
                aria-label="Close"
                onClick={() => setConfirmOpen(false)}
              >
                <Icon name="cross" />
              </button>
            </div>

            <div className="jcp-pay-amount">
              <div>
                <span className="jcp-field-label">Amount to Pay</span>
                <strong>{formatMoney(payableAmount)}</strong>
                <span className="jcp-amount-note">Inclusive of all taxes</span>
              </div>
              <div className="jcp-pay-code">
                <span>Job Cart</span>
                <strong>{cart?.jobCartId}</strong>
              </div>
            </div>

            {collecting && (
              <>
                <h6 className="jcp-subhead">Select Payment Method</h6>
                <div className="jcp-pm-grid">
                  {QUICK_METHODS.map((option) => (
                    <button
                      type="button"
                      key={option.value}
                      className={`jcp-pm${
                        tenders[0].method === option.value ? " is-on" : ""
                      }`}
                      onClick={() => setTenderValue(0, "method", option.value)}
                    >
                      <Icon name={option.icon} />
                      <span>{option.label}</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    className={`jcp-pm${otherMethodPicked ? " is-on" : ""}`}
                    onClick={() =>
                      setTenderValue(
                        0,
                        "method",
                        membershipWalletBalance > 0
                          ? "MEMBERSHIP_WALLET"
                          : "OTHER"
                      )
                    }
                  >
                    <Icon name="more-h" />
                    <span>Other</span>
                  </button>
                </div>
                {otherMethodPicked && (
                  <Input
                    type="select"
                    className="mt-2"
                    value={tenders[0].method}
                    onChange={(event) =>
                      setTenderValue(0, "method", event.target.value)
                    }
                  >
                    {OTHER_METHODS.map((option) => (
                      <option
                        key={option.value}
                        value={option.value}
                        disabled={
                          option.value === "MEMBERSHIP_WALLET" &&
                          membershipWalletBalance <= 0
                        }
                      >
                        {option.label}
                        {option.value === "MEMBERSHIP_WALLET"
                          ? " (" +
                            formatMoney(membershipWalletBalance) +
                            " available)"
                          : ""}
                      </option>
                    ))}
                  </Input>
                )}

                <Row className="g-2 mt-2 align-items-end">
                  {!splitting && (
                    <Col sm="5">
                      <Label className="jcp-field-label">Amount</Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder={formatMoney(collectedAmount)}
                        value={tenders[0].amount}
                        onChange={(event) =>
                          setTenderValue(0, "amount", event.target.value)
                        }
                      />
                    </Col>
                  )}
                  {splitting && (
                    <Col sm="3">
                      <Label className="jcp-field-label">Remaining</Label>
                      <div className="jcp-tender-fixed">
                        {formatMoney(firstTenderAmount)}
                      </div>
                    </Col>
                  )}
                  <Col sm={splitting ? "5" : "4"}>
                    <Label className="jcp-field-label">
                      Reference <span className="text-soft">(Optional)</span>
                    </Label>
                    <Input
                      placeholder="Enter reference (e.g. txn id)"
                      value={tenders[0].referenceNo}
                      onChange={(event) =>
                        setTenderValue(0, "referenceNo", event.target.value)
                      }
                    />
                  </Col>
                  <Col sm={splitting ? "4" : "3"}>
                    {tenders.length < 5 && (
                      <Button
                        type="button"
                        color="primary"
                        outline
                        className="w-100 jcp-split-add"
                        // First split opens empty (only a wallet shortfall is
                        // carried over). Each later row takes the balance the
                        // first method still holds, so rows chain down.
                        onClick={() => {
                          const carry = splitting
                            ? firstTenderAmount
                            : outstandingAfter;
                          setTenders((current) => [
                            ...current,
                            {
                              method: "CASH",
                              amount: carry > 0.004 ? carry.toFixed(2) : "",
                              referenceNo: "",
                            },
                          ]);
                        }}
                      >
                        <Icon name="plus" />
                        <span>Split payment</span>
                      </Button>
                    )}
                  </Col>
                </Row>

                {tenders.slice(1).map((tender, offset) => (
                  <Row className="g-2 align-items-end jcp-tender-row" key={offset + 1}>
                    <Col sm="4">
                      <Label className="jcp-field-label">
                        Payment {offset + 2}
                      </Label>
                      <Input
                        type="select"
                        value={tender.method}
                        onChange={(event) =>
                          setTenderValue(offset + 1, "method", event.target.value)
                        }
                      >
                        {PAYMENT_METHODS.map((option) => (
                          <option
                            key={option.value}
                            value={option.value}
                            disabled={
                              option.value === "MEMBERSHIP_WALLET" &&
                              membershipWalletBalance <= 0
                            }
                          >
                            {option.label}
                          </option>
                        ))}
                      </Input>
                    </Col>
                    <Col sm="3">
                      <Label className="jcp-field-label">Amount</Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        value={tender.amount}
                        onChange={(event) =>
                          setTenderValue(offset + 1, "amount", event.target.value)
                        }
                      />
                    </Col>
                    <Col>
                      <Label className="jcp-field-label">
                        Reference <span className="text-soft">(Optional)</span>
                      </Label>
                      <Input
                        placeholder="Reference"
                        value={tender.referenceNo}
                        onChange={(event) =>
                          setTenderValue(
                            offset + 1,
                            "referenceNo",
                            event.target.value
                          )
                        }
                      />
                    </Col>
                    <Col xs="auto">
                      <button
                        type="button"
                        className="jcp-tender-remove"
                        aria-label="Remove payment method"
                        onClick={() =>
                          setTenders((current) =>
                            current.filter(
                              (_row, rowIndex) => rowIndex !== offset + 1
                            )
                          )
                        }
                      >
                        <Icon name="cross" />
                      </button>
                    </Col>
                  </Row>
                ))}
              </>
            )}

            <FormGroup check className="jcp-collect">
              <Input
                type="checkbox"
                id="collect-payment"
                checked={paymentForm.collect}
                onChange={(event) =>
                  setPaymentForm((current) => ({
                    ...current,
                    collect: event.target.checked,
                  }))
                }
              />
              <Label check for="collect-payment">
                Collect payment now
              </Label>
            </FormGroup>

            {!collecting ? (
              <Alert color="light" className="py-2">
                No payment is being collected now. The bill will be left unpaid.
              </Alert>
            ) : walletShort ? (
              <Alert color="warning" className="py-2">
                Wallet has {formatMoney(membershipWalletBalance)}. Reduce this
                tender and add another method for the rest.
              </Alert>
            ) : walletOverCap ? (
              <Alert color="warning" className="py-2">
                The membership wallet pays for services only, up to{" "}
                {formatMoney(walletCap)} on this bill. Pay products, packages
                and memberships with another method.
              </Alert>
            ) : overpaying ? (
              <Alert color="danger" className="py-2">
                Collecting {formatMoney(collectedAmount)} exceeds the{" "}
                {formatMoney(payableAmount)} payable.
              </Alert>
            ) : (
              <small className="text-soft d-block">
                {outstandingAfter <= 0.004
                  ? "Invoice will be issued and marked paid."
                  : walletTender
                    ? "Membership wallet covers " +
                      formatMoney(collectedAmount) +
                      ". Add a payment method for the remaining " +
                      formatMoney(outstandingAfter) +
                      ", or leave it outstanding."
                    : "Part payment. " +
                      formatMoney(outstandingAfter) +
                      " stays outstanding and the bill is marked partially paid."}
              </small>
            )}

            {collecting && (walletTender || packageCoveredAmount > 0) && (
              <div className="jcp-panel mt-2">
                <div className="jcp-line">
                  <span>
                    Services
                    <span className="d-block small text-soft">
                      Mode of payment:{" "}
                      {[
                        packageCoveredAmount > 0 && "Package",
                        walletTender && "Membership",
                      ]
                        .filter(Boolean)
                        .join(" + ")}
                      {walletTender && serviceShortfall > 0.004
                        ? ` (covers ${formatMoney(walletOnServices)}, ${formatMoney(
                            serviceShortfall
                          )} added to ${hasProducts ? "the other items" : "the balance"})`
                        : ""}
                    </span>
                  </span>
                  <strong>
                    {formatMoney(serviceLinesTotal + packageCoveredAmount)}
                  </strong>
                </div>
                {restAmount > 0.004 && (
                  <div className="jcp-line">
                    <span>
                      {hasProducts ? "Products, packages & memberships" : "Remaining"}
                      {hasProducts && serviceShortfall > 0.004
                        ? " + remaining services"
                        : ""}
                      <span className="d-block small text-soft">
                        Mode of payment: {restMethods || "Outstanding"}
                      </span>
                    </span>
                    <strong>{formatMoney(restAmount)}</strong>
                  </div>
                )}
                <div className="jcp-line">
                  <span>Total</span>
                  <strong>
                    {formatMoney(payableAmount + packageCoveredAmount)}
                  </strong>
                </div>
              </div>
            )}

            <div className="jcp-modal-cols">
            {canApplyCoupon && (
              <div className="jcp-modal-row">
                <span className="jcp-field-icon">
                  <Icon name="tag" />
                </span>
                <div className="jcp-modal-row-body">
                  <Label className="jcp-field-label">Coupon Code</Label>
                  {!invoice?.couponId ? (
                    <div className="d-flex gap-2">
                      <Input
                        placeholder="Enter coupon code"
                        value={couponCode}
                        onChange={(event) =>
                          setCouponCode(event.target.value.toUpperCase())
                        }
                      />
                      <Button
                        color="primary"
                        outline
                        disabled={!couponCode.trim() || working}
                        onClick={() =>
                          run(() =>
                            salonApi.invoices.applyCoupon(invoice.id, couponCode)
                          )
                        }
                      >
                        Apply
                      </Button>
                    </div>
                  ) : (
                    <Button
                      color="danger"
                      outline
                      disabled={working}
                      onClick={() =>
                        run(() => salonApi.invoices.removeCoupon(invoice.id))
                      }
                    >
                      Remove {invoice.couponCodeSnapshot}
                    </Button>
                  )}
                </div>
              </div>
            )}

            <div className="jcp-modal-row">
              <span className="jcp-field-icon">
                <Icon name="notes-alt" />
              </span>
              <div className="jcp-modal-row-body">
                <Label className="jcp-field-label">
                  Billing Note <span className="text-soft">(Optional)</span>
                </Label>
                <Input
                  type="textarea"
                  rows="2"
                  maxLength={BILLING_NOTE_MAX}
                  style={{ minHeight: 0 }}
                  value={billingForm.billingNote}
                  onChange={(event) =>
                    setBillingForm((current) => ({
                      ...current,
                      billingNote: event.target.value,
                    }))
                  }
                />
                <div className="text-end small text-soft">
                  {billingForm.billingNote.length}/{BILLING_NOTE_MAX}
                </div>
              </div>
            </div>
            </div>

            <div className="jcp-modal-foot">
              <Button
                color="light"
                className="jcp-ghost"
                onClick={() => setConfirmOpen(false)}
                disabled={working}
              >
                Cancel
              </Button>
              <Button
                className="jcp-pay"
                onClick={confirm}
                disabled={working || overpaying || walletShort || walletOverCap}
              >
                {working ? <Spinner size="sm" /> : <Icon name="lock-alt" />}
                <span>
                  {collecting
                    ? `Pay ${formatMoney(collectedAmount)}`
                    : "Issue bill"}
                </span>
              </Button>
            </div>
          </ModalBody>
        </Modal>
      </Content>
    </>
  );
};

export default JobCartDetails;
