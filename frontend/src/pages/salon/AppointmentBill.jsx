/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import Select from "react-select";
import {
  Alert,
  Col,
  Form,
  FormGroup,
  Input,
  Label,
  Row,
  Spinner,
} from "reactstrap";
import { Button, Icon } from "@/components/Component";
import PageShell from "@/components/salon/PageShell";
import StatusBadge from "@/components/salon/StatusBadge";
import { useAuth } from "@/auth/AuthContext";
import { salonApi } from "@/services/salonApi";
import { formatDate, formatMoney, toLocalInput } from "@/utils/salonFormat";

const TAX_OPTIONS = [
  { value: "", label: "Salon GST setting" },
  { value: 0, label: "No tax" },
  { value: 5, label: "GST 5%" },
  { value: 12, label: "GST 12%" },
  { value: 18, label: "GST 18%" },
  { value: 28, label: "GST 28%" },
];

const PAYMENT_METHODS = ["CASH", "CARD", "UPI", "OTHER"];

const SummaryRow = ({ label, value, strong, muted }) => (
  <div className="d-flex justify-content-between py-2 border-bottom">
    <span className={muted ? "text-soft" : ""}>{label}</span>
    {strong ? <strong>{value}</strong> : <span>{value}</span>}
  </div>
);

const Stat = ({ label, value }) => (
  <div className="d-flex justify-content-between py-1">
    <span className="text-soft">{label}</span>
    <strong>{value}</strong>
  </div>
);

const num = (value) => Number(value || 0);

// Bills one completed appointment: services plus anything bought at the
// counter, then takes the payment. Reached only from the "Make bill" button.
const AppointmentBill = () => {
  const { appointmentId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [appointment, setAppointment] = useState(null);
  const [invoice, setInvoice] = useState(null);
  const [summary, setSummary] = useState(null);
  const [refs, setRefs] = useState({ products: [], packages: [], staff: [] });
  const [memberships, setMemberships] = useState([]);
  const [wallet, setWallet] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [bill, setBill] = useState({
    invoiceType: "BILL_OF_SUPPLY",
    serviceTaxPercent: "",
    productTaxPercent: "",
    discountAmount: 0,
    processingFeeAmount: 0,
    billingNote: "",
    footerNote: "",
  });
  // Counter add-ons: product quantities by id, chosen package ids, and at most
  // one membership plan. All three are billed as taxed lines on this invoice.
  const [extras, setExtras] = useState({
    productQuantities: {},
    packageIds: [],
    membershipId: "",
    soldByStaffId: "",
  });
  const [payment, setPayment] = useState({
    amount: "",
    amountTouched: false,
    method: "CASH",
    referenceNo: "",
    paidAt: toLocalInput(new Date()),
    note: "",
  });

  const canBill = ["SUPER_ADMIN", "SALON_ADMIN", "RECEPTIONIST", "STAFF"].includes(
    user?.role
  );
  const canPay = ["SUPER_ADMIN", "SALON_ADMIN", "RECEPTIONIST"].includes(
    user?.role
  );
  const canSellExtras = [
    "SUPER_ADMIN",
    "SALON_ADMIN",
    "BRANCH_MANAGER",
    "RECEPTIONIST",
  ].includes(user?.role);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [appointmentResponse, invoiceResponse] = await Promise.all([
        salonApi.appointments.get(appointmentId),
        salonApi.invoices.list(),
      ]);
      const loaded = appointmentResponse.data;
      setAppointment(loaded);
      // The invoice list carries no appointment filter, so match it here and
      // refetch the full invoice for its totals.
      const existing = (invoiceResponse.data || []).find(
        (item) => item.appointmentId === appointmentId
      );
      setInvoice(
        existing ? (await salonApi.invoices.get(existing.id)).data : null
      );

      // Everything below is decoration: a role that cannot read it still bills.
      const customerId = loaded?.customer?.id;
      const [summaryResult, refsResult, membershipResult] =
        await Promise.allSettled([
          customerId
            ? salonApi.jobCarts.customerSummary({ customerId })
            : Promise.reject(new Error("No customer")),
          canSellExtras
            ? salonApi.jobCarts.references({
                ...(loaded?.salon?.id ? { salonId: loaded.salon.id } : {}),
                ...(loaded?.branch?.id ? { branchId: loaded.branch.id } : {}),
              })
            : Promise.reject(new Error("Not allowed")),
          canSellExtras
            ? salonApi.memberships.list()
            : Promise.reject(new Error("Not allowed")),
        ]);
      setSummary(
        summaryResult.status === "fulfilled" ? summaryResult.value.data : null
      );
      if (refsResult.status === "fulfilled") {
        setRefs({
          products: refsResult.value.data?.products || [],
          packages: refsResult.value.data?.packages || [],
          staff: refsResult.value.data?.staff || [],
        });
      }
      setMemberships(
        membershipResult.status === "fulfilled"
          ? (membershipResult.value.data || []).filter((item) => item.status)
          : []
      );
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, [appointmentId, canSellExtras]);

  useEffect(() => {
    load();
  }, [load]);

  // Wallet is only offered as a method when the customer has spendable funds.
  useEffect(() => {
    const customerId = appointment?.customer?.id;
    if (!customerId) return;
    salonApi.membershipWallets
      .forCustomer(customerId)
      .then((response) => setWallet(response.data))
      .catch(() => setWallet(null));
  }, [appointment?.customer?.id]);

  useEffect(() => {
    if (!invoice) return;
    setPayment((current) => ({
      ...current,
      amount: num(invoice.balanceAmount) || "",
      amountTouched: false,
    }));
  }, [invoice]);

  const services = useMemo(() => appointment?.services || [], [appointment]);
  const selectedProducts = useMemo(
    () =>
      refs.products
        .map((product) => ({
          ...product,
          quantity: Number(extras.productQuantities[product.id] || 0),
        }))
        .filter((product) => product.quantity > 0),
    [extras.productQuantities, refs.products]
  );
  const productOptions = useMemo(
    () =>
      refs.products.map((product) => ({
        value: product.id,
        label: [
          product.name,
          product.sku,
          formatMoney(product.sellingPrice),
          "stock " +
            num(product.currentStock) +
            (product.unit ? " " + product.unit : ""),
        ]
          .filter(Boolean)
          .join(" · "),
        isDisabled:
          num(product.currentStock) <= num(extras.productQuantities[product.id]),
      })),
    [extras.productQuantities, refs.products]
  );
  const selectedPackages = useMemo(
    () => refs.packages.filter((item) => extras.packageIds.includes(item.id)),
    [extras.packageIds, refs.packages]
  );
  const selectedMembership = memberships.find(
    (item) => item.id === extras.membershipId
  );

  // Mirrors the server: the discount only touches services, packages are taxed
  // at the service rate, and products carry their own rate.
  const preview = useMemo(() => {
    const serviceSubtotal = services.reduce(
      (total, item) => total + num(item.price),
      0
    );
    const packageSubtotal = selectedPackages.reduce(
      (total, item) => total + num(item.specialPrice),
      0
    );
    const productSubtotal = selectedProducts.reduce(
      (total, item) => total + num(item.sellingPrice) * item.quantity,
      0
    );
    // A membership is billed at its plan price and never discounted, but it
    // is taxed at the service rate like a package.
    const membershipSubtotal = num(selectedMembership?.price);
    const discount = Math.min(num(bill.discountAmount), serviceSubtotal);
    const gst = bill.invoiceType === "GST_INVOICE";
    const serviceTax = gst
      ? ((serviceSubtotal - discount + packageSubtotal + membershipSubtotal) *
          num(bill.serviceTaxPercent)) /
        100
      : 0;
    const productTax = gst
      ? (productSubtotal * num(bill.productTaxPercent)) / 100
      : 0;
    const subtotal =
      serviceSubtotal + packageSubtotal + productSubtotal + membershipSubtotal;
    return {
      serviceSubtotal,
      packageSubtotal,
      productSubtotal,
      membershipSubtotal,
      subtotal,
      discount,
      serviceTax,
      productTax,
      total:
        subtotal -
        discount +
        serviceTax +
        productTax +
        num(bill.processingFeeAmount),
    };
  }, [bill, selectedMembership, selectedPackages, selectedProducts, services]);

  const walletBalance = num(wallet?.spendableBalance);
  const balance = num(invoice?.balanceAmount);
  const dueNow = invoice ? balance : preview.total;

  const setBillField = (name) => (event) =>
    setBill((current) => ({ ...current, [name]: event.target.value }));
  const setPaymentField = (name) => (event) =>
    setPayment((current) => ({
      ...current,
      [name]: event.target.value,
      ...(name === "amount" ? { amountTouched: true } : {}),
    }));
  const setProductQuantity = (productId, quantity) => {
    // The stock movement rejects an oversell, so the counter never offers one.
    const stock = num(
      refs.products.find((product) => product.id === productId)?.currentStock
    );
    setExtras((current) => ({
      ...current,
      productQuantities: {
        ...current.productQuantities,
        [productId]: Math.min(stock, Math.max(0, Number(quantity) || 0)),
      },
    }));
  };
  const togglePackage = (packageId) =>
    setExtras((current) => ({
      ...current,
      packageIds: current.packageIds.includes(packageId)
        ? current.packageIds.filter((id) => id !== packageId)
        : [...current.packageIds, packageId],
    }));

  const buildExtraItems = () => [
    ...selectedProducts.map((product) => ({
      itemType: "PRODUCT",
      productId: product.id,
      quantity: product.quantity,
      ...(extras.soldByStaffId ? { soldByStaffId: extras.soldByStaffId } : {}),
    })),
    ...selectedPackages.map((item) => ({
      itemType: "PACKAGE",
      packageId: item.id,
      quantity: 1,
      ...(extras.soldByStaffId ? { soldByStaffId: extras.soldByStaffId } : {}),
    })),
    ...(selectedMembership
      ? [
          {
            itemType: "MEMBERSHIP",
            membershipId: selectedMembership.id,
            quantity: 1,
            ...(extras.soldByStaffId
              ? { soldByStaffId: extras.soldByStaffId }
              : {}),
          },
        ]
      : []),
  ];

  const createInvoice = async (status) => {
    const created = await salonApi.invoices.fromAppointment(appointmentId, {
      invoiceType: bill.invoiceType,
      status,
      discountAmount: num(bill.discountAmount),
      processingFeeAmount: num(bill.processingFeeAmount),
      ...(bill.serviceTaxPercent === ""
        ? {}
        : { serviceTaxPercent: Number(bill.serviceTaxPercent) }),
      ...(bill.productTaxPercent === ""
        ? {}
        : { productTaxPercent: Number(bill.productTaxPercent) }),
      ...(bill.billingNote ? { billingNote: bill.billingNote } : {}),
      ...(bill.footerNote ? { footerNote: bill.footerNote } : {}),
      extraItems: buildExtraItems(),
    });
    setInvoice(created.data);
    return created.data;
  };

  // Parks the bill when the customer is not paying at the counter. The same
  // invoice is issued and settled later, keeping its code and its lines.
  const saveDraft = async () => {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const draft = await createInvoice("DRAFT");
      setNotice(
        `Saved as draft ${draft.invoiceCode}. Open this bill again to issue it and take the payment.`
      );
    } catch (draftError) {
      setError(draftError.message);
    } finally {
      setSaving(false);
    }
  };

  // One button: bill what is on screen, issue it, and settle it. An invoice
  // that already exists is issued if it is still a draft, never billed twice.
  const billAndPay = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      let current = invoice || (await createInvoice("ISSUED"));
      if (current.status === "DRAFT") {
        // A draft cannot take money, so issue it first; the totals come back
        // recalculated, which is what the payment below settles.
        current = (await salonApi.invoices.issue(current.id)).data;
        setInvoice(current);
      }
      const due = num(current.balanceAmount);
      const amount = payment.amountTouched
        ? Math.min(num(payment.amount), due)
        : due;
      // A role that may bill but not take money stops at an issued invoice.
      if (due > 0 && canPay) {
        if (amount <= 0) {
          throw new Error(`Enter an amount from 0.01 to ${formatMoney(due)}.`);
        }
        if (payment.method === "MEMBERSHIP_WALLET") {
          await salonApi.membershipWallets.payInvoice({
            invoiceId: current.id,
            amount,
            ...(payment.note ? { note: payment.note } : {}),
          });
        } else {
          await salonApi.payments.create({
            invoiceId: current.id,
            amount,
            method: payment.method,
            ...(payment.referenceNo
              ? { referenceNo: payment.referenceNo }
              : {}),
            ...(payment.note ? { note: payment.note } : {}),
            ...(payment.paidAt
              ? { paidAt: new Date(payment.paidAt).toISOString() }
              : {}),
          });
        }
      }

      const refreshed = await salonApi.invoices.get(current.id);
      setInvoice(refreshed.data);
    } catch (payError) {
      setError(payError.message);
    } finally {
      setSaving(false);
    }
  };

  const billed = Boolean(invoice);
  const isDraft = invoice?.status === "DRAFT";
  const paid = billed && !isDraft && balance <= 0;

  return (
    <PageShell
      title="Make Bill"
      description="Bill a completed appointment, sell add-ons, and take the payment."
      tools={
        <Button color="light" outline onClick={() => navigate("/appointments")}>
          <Icon name="arrow-left" /> Back
        </Button>
      }
    >
      {error && <Alert color="danger">{error}</Alert>}
      {notice && <Alert color="info">{notice}</Alert>}
      {loading ? (
        <div className="card card-bordered">
          <div className="card-inner text-center py-5">
            <Spinner color="primary" />
          </div>
        </div>
      ) : !appointment ? (
        <Alert color="warning">Appointment not found.</Alert>
      ) : appointment.status !== "COMPLETED" && !billed ? (
        <Alert color="warning">
          Only completed appointments can be billed. This one is{" "}
          {appointment.status}.
        </Alert>
      ) : (
        <Form onSubmit={billAndPay}>
          <Row className="g-4">
            <Col lg="8">
              <div className="card card-bordered mb-4">
                <div className="card-inner">
                  <div className="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-3">
                    <div>
                      <h5 className="mb-1">
                        {appointment.customer?.name || "Unknown customer"}
                      </h5>
                      <span className="text-soft">
                        {appointment.appointmentCode} ·{" "}
                        {formatDate(appointment.startTime, true)}
                        {appointment.staff?.name
                          ? ` · ${appointment.staff.name}`
                          : ""}
                      </span>
                    </div>
                    <StatusBadge value={appointment.status} />
                  </div>
                  <div className="table-responsive">
                    <table className="table table-middle mb-0">
                      <thead>
                        <tr>
                          <th>Service</th>
                          <th className="text-end">Price</th>
                        </tr>
                      </thead>
                      <tbody>
                        {services.map((item) => (
                          <tr key={item.id || item.serviceId}>
                            <td>
                              {item.serviceName ||
                                item.service?.name ||
                                "Service"}
                            </td>
                            <td className="text-end">
                              {formatMoney(item.price)}
                            </td>
                          </tr>
                        ))}
                        {services.length === 0 && (
                          <tr>
                            <td
                              colSpan="2"
                              className="text-center text-soft py-4"
                            >
                              No services on this appointment.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {!billed && canSellExtras && (
                <div className="card card-bordered mb-4">
                  <div className="card-inner">
                    <h5 className="mb-1">Add to this bill</h5>
                    <p className="text-soft">
                      Products, packages and memberships are billed here, with
                      tax applied. The membership starts once the bill is
                      issued.
                    </p>

                    <FormGroup>
                      <Label>Sold by</Label>
                      <Input
                        type="select"
                        value={extras.soldByStaffId}
                        onChange={(event) =>
                          setExtras((current) => ({
                            ...current,
                            soldByStaffId: event.target.value,
                          }))
                        }
                      >
                        <option value="">Not recorded</option>
                        {refs.staff.map((member) => (
                          <option key={member.id} value={member.id}>
                            {member.name}
                            {member.jobRole ? ` · ${member.jobRole}` : ""}
                          </option>
                        ))}
                      </Input>
                    </FormGroup>

                    <div className="overline-title text-soft mb-2">
                      Products
                    </div>
                    {refs.products.length === 0 ? (
                      <p className="text-soft small">No products available.</p>
                    ) : (
                      <Select
                        className="react-select-container mb-3"
                        classNamePrefix="react-select"
                        options={productOptions}
                        value={null}
                        isDisabled={saving}
                        placeholder="Search a product by name or SKU"
                        noOptionsMessage={() => "No products match"}
                        onChange={(option) =>
                          option &&
                          setProductQuantity(
                            option.value,
                            num(extras.productQuantities[option.value]) + 1
                          )
                        }
                      />
                    )}
                    {selectedProducts.length > 0 && (
                      <div className="table-responsive mb-4">
                        <table className="table table-sm table-bordered mb-0">
                          <thead>
                            <tr>
                              <th>Product</th>
                              <th style={{ width: 100 }}>Qty</th>
                              <th style={{ width: 110 }}>Price</th>
                              <th style={{ width: 120 }}>Total</th>
                              <th style={{ width: 60 }} />
                            </tr>
                          </thead>
                          <tbody>
                            {selectedProducts.map((product) => (
                              <tr key={product.id}>
                                <td>
                                  {product.name}
                                  <small className="d-block text-soft">
                                    {product.sku ? `${product.sku} · ` : ""}
                                    stock {num(product.currentStock)}
                                    {product.unit ? ` ${product.unit}` : ""}
                                  </small>
                                </td>
                                <td>
                                  <Input
                                    type="number"
                                    min="1"
                                    max={num(product.currentStock)}
                                    step="1"
                                    disabled={saving}
                                    value={product.quantity}
                                    onChange={(event) =>
                                      setProductQuantity(
                                        product.id,
                                        event.target.value
                                      )
                                    }
                                  />
                                </td>
                                <td>{formatMoney(product.sellingPrice)}</td>
                                <td>
                                  {formatMoney(
                                    num(product.sellingPrice) * product.quantity
                                  )}
                                </td>
                                <td className="text-end">
                                  <Button
                                    color="danger"
                                    outline
                                    size="sm"
                                    type="button"
                                    disabled={saving}
                                    onClick={() =>
                                      setProductQuantity(product.id, 0)
                                    }
                                  >
                                    X
                                  </Button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    <div className="overline-title text-soft mb-2">
                      Packages
                    </div>
                    {refs.packages.length === 0 ? (
                      <p className="text-soft small">No packages available.</p>
                    ) : (
                      <div
                        className="border rounded mb-4"
                        style={{ maxHeight: 220, overflowY: "auto" }}
                      >
                        {refs.packages.map((item) => (
                          <label
                            key={item.id}
                            className="d-flex align-items-center gap-2 px-3 py-2 border-bottom mb-0"
                            style={{ cursor: "pointer" }}
                          >
                            <input
                              type="checkbox"
                              className="form-check-input mt-0"
                              checked={extras.packageIds.includes(item.id)}
                              onChange={() => togglePackage(item.id)}
                            />
                            <span className="flex-grow-1">
                              {item.name}
                              <small className="d-block text-soft">
                                {(item.items || [])
                                  .map((line) => line.serviceNameSnapshot)
                                  .join(", ") || "No services listed"}
                              </small>
                            </span>
                            <strong>{formatMoney(item.specialPrice)}</strong>
                          </label>
                        ))}
                      </div>
                    )}

                    <FormGroup className="mb-0">
                      <Label>Membership</Label>
                      <Input
                        type="select"
                        value={extras.membershipId}
                        onChange={(event) =>
                          setExtras((current) => ({
                            ...current,
                            membershipId: event.target.value,
                          }))
                        }
                      >
                        <option value="">
                          {memberships.length
                            ? "Not buying a membership"
                            : "No membership plans yet - add one under Customer Retention > Manage Memberships"}
                        </option>
                        {memberships.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name} · {formatMoney(item.price)} ·{" "}
                            {num(item.discountPercentage)}% off
                          </option>
                        ))}
                      </Input>
                    </FormGroup>
                  </div>
                </div>
              )}

              {!billed && (
                <div className="card card-bordered mb-4">
                  <div className="card-inner">
                    <h5 className="mb-4">Bill details</h5>
                    <Row className="g-3">
                      <Col md="6">
                        <FormGroup>
                          <Label>Invoice type</Label>
                          <Input
                            type="select"
                            value={bill.invoiceType}
                            onChange={setBillField("invoiceType")}
                          >
                            <option value="BILL_OF_SUPPLY">
                              Bill of supply (no GST)
                            </option>
                            <option value="GST_INVOICE">GST invoice</option>
                          </Input>
                        </FormGroup>
                      </Col>
                      <Col md="6">
                        <FormGroup>
                          <Label>Discount (services)</Label>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={bill.discountAmount}
                            onChange={setBillField("discountAmount")}
                          />
                        </FormGroup>
                      </Col>
                      <Col md="6">
                        <FormGroup>
                          <Label>Service tax</Label>
                          <Input
                            type="select"
                            disabled={bill.invoiceType !== "GST_INVOICE"}
                            value={bill.serviceTaxPercent}
                            onChange={setBillField("serviceTaxPercent")}
                          >
                            {TAX_OPTIONS.map((option) => (
                              <option key={option.label} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </Input>
                        </FormGroup>
                      </Col>
                      <Col md="6">
                        <FormGroup>
                          <Label>Product tax</Label>
                          <Input
                            type="select"
                            disabled={bill.invoiceType !== "GST_INVOICE"}
                            value={bill.productTaxPercent}
                            onChange={setBillField("productTaxPercent")}
                          >
                            {TAX_OPTIONS.map((option) => (
                              <option key={option.label} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </Input>
                        </FormGroup>
                      </Col>
                      <Col md="6">
                        <FormGroup>
                          <Label>Processing fee</Label>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={bill.processingFeeAmount}
                            onChange={setBillField("processingFeeAmount")}
                          />
                        </FormGroup>
                      </Col>
                      <Col md="12">
                        <FormGroup>
                          <Label>Billing note</Label>
                          <Input
                            type="textarea"
                            value={bill.billingNote}
                            onChange={setBillField("billingNote")}
                          />
                        </FormGroup>
                      </Col>
                      <Col md="12">
                        <FormGroup className="mb-0">
                          <Label>Footer note</Label>
                          <Input
                            type="textarea"
                            value={bill.footerNote}
                            onChange={setBillField("footerNote")}
                          />
                        </FormGroup>
                      </Col>
                    </Row>
                  </div>
                </div>
              )}

              <div className="card card-bordered">
                <div className="card-inner">
                  <h5 className="mb-1">Payment</h5>
                  <p className="text-soft">
                    {billed ? (
                      <>
                        {isDraft ? "Draft " : "Invoice "}
                        {invoice.invoiceCode} ·{" "}
                        <Link to={`/billing/invoices/${invoice.id}`}>
                          View invoice
                        </Link>
                      </>
                    ) : (
                      "The invoice is issued and settled when you record the payment. Save it as a draft if the customer is paying later."
                    )}
                  </p>
                  {isDraft && (
                    <Alert color="info">
                      This bill is parked as a draft. Recording the payment
                      issues this same invoice and settles it.
                    </Alert>
                  )}
                  {paid ? (
                    <Alert color="success" className="mb-0">
                      This bill is fully paid.
                    </Alert>
                  ) : !canPay ? (
                    <Alert color="warning" className="mb-0">
                      Your role can issue this bill but not take money for it.
                      Ask a receptionist or admin to collect{" "}
                      {formatMoney(dueNow)}.
                    </Alert>
                  ) : (
                    <Row className="g-3">
                      <Col md="6">
                        <FormGroup>
                          <Label>Amount</Label>
                          <Input
                            type="number"
                            min="0.01"
                            step="0.01"
                            value={
                              payment.amountTouched
                                ? payment.amount
                                : dueNow || ""
                            }
                            onChange={setPaymentField("amount")}
                          />
                          <span className="text-soft small">
                            Pay the full {formatMoney(dueNow)} to close the bill
                            as paid.
                          </span>
                        </FormGroup>
                      </Col>
                      <Col md="6">
                        <FormGroup>
                          <Label>Payment method</Label>
                          <Input
                            type="select"
                            value={payment.method}
                            onChange={setPaymentField("method")}
                          >
                            {PAYMENT_METHODS.map((method) => (
                              <option key={method} value={method}>
                                {method}
                              </option>
                            ))}
                            {walletBalance > 0 && (
                              <option value="MEMBERSHIP_WALLET">
                                Membership wallet ({formatMoney(walletBalance)}{" "}
                                available)
                              </option>
                            )}
                          </Input>
                        </FormGroup>
                      </Col>
                      <Col md="6">
                        <FormGroup>
                          <Label>Reference number</Label>
                          <Input
                            value={payment.referenceNo}
                            onChange={setPaymentField("referenceNo")}
                          />
                        </FormGroup>
                      </Col>
                      <Col md="6">
                        <FormGroup>
                          <Label>Paid at</Label>
                          <Input
                            type="datetime-local"
                            value={payment.paidAt}
                            onChange={setPaymentField("paidAt")}
                          />
                        </FormGroup>
                      </Col>
                      <Col md="12">
                        <FormGroup className="mb-0">
                          <Label>Payment note</Label>
                          <Input
                            type="textarea"
                            value={payment.note}
                            onChange={setPaymentField("note")}
                          />
                        </FormGroup>
                      </Col>
                    </Row>
                  )}
                </div>
              </div>
            </Col>

            <Col lg="4">
              {summary && (
                <div className="card card-bordered mb-4">
                  <div className="card-inner">
                    <h5 className="mb-3">Customer</h5>
                    <Stat label="Total visits" value={summary.totalVisits} />
                    <Stat
                      label="Last visit"
                      value={
                        summary.lastVisitDate
                          ? formatDate(summary.lastVisitDate)
                          : "First visit"
                      }
                    />
                    <Stat
                      label="Lifetime spend"
                      value={formatMoney(summary.totalSpend)}
                    />
                    <Stat
                      label="Membership"
                      value={summary.membershipName || "None"}
                    />
                    <Stat
                      label="Wallet"
                      value={formatMoney(summary.membershipWalletBalance)}
                    />
                    <Stat
                      label="Loyalty points"
                      value={num(summary.loyaltyPoints)}
                    />
                    <Stat
                      label="Outstanding"
                      value={formatMoney(summary.outstandingBalance)}
                    />
                    {summary.preferredStaff && (
                      <Stat
                        label="Usually with"
                        value={summary.preferredStaff.staffName}
                      />
                    )}
                    {(summary.activePackages || []).length > 0 && (
                      <div className="mt-2 small">
                        <div className="overline-title text-soft mb-1">
                          Active packages
                        </div>
                        {summary.activePackages.map((item) => (
                          <div key={item.customerPackageId}>
                            {item.packageName} — valid to{" "}
                            {formatDate(item.validUntil)}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="card card-bordered">
                <div className="card-inner">
                  <h5 className="mb-3">Summary</h5>
                  {billed ? (
                    <>
                      <SummaryRow
                        label="Subtotal"
                        value={formatMoney(invoice.subtotalAmount)}
                      />
                      <SummaryRow
                        label="Discount"
                        value={`- ${formatMoney(
                          num(invoice.discountAmount) +
                            num(invoice.couponDiscountAmount)
                        )}`}
                      />
                      <SummaryRow
                        label="Service tax"
                        value={formatMoney(invoice.serviceGstAmount)}
                      />
                      <SummaryRow
                        label="Product tax"
                        value={formatMoney(invoice.productGstAmount)}
                      />
                      <SummaryRow
                        label="Processing fee"
                        value={formatMoney(invoice.processingFeeAmount)}
                      />
                      <SummaryRow
                        label="Total"
                        value={formatMoney(invoice.totalAmount)}
                        strong
                      />
                      <SummaryRow
                        label="Paid"
                        value={formatMoney(invoice.paidAmount)}
                      />
                      <div className="d-flex justify-content-between py-3">
                        <span>Balance</span>
                        <strong
                          className={
                            balance > 0 ? "text-danger" : "text-success"
                          }
                        >
                          {formatMoney(invoice.balanceAmount)}
                        </strong>
                      </div>
                    </>
                  ) : (
                    <>
                      <SummaryRow
                        label={`Services (${services.length})`}
                        value={formatMoney(preview.serviceSubtotal)}
                      />
                      {preview.packageSubtotal > 0 && (
                        <SummaryRow
                          label={`Packages (${selectedPackages.length})`}
                          value={formatMoney(preview.packageSubtotal)}
                        />
                      )}
                      {preview.productSubtotal > 0 && (
                        <SummaryRow
                          label={`Products (${selectedProducts.length})`}
                          value={formatMoney(preview.productSubtotal)}
                        />
                      )}
                      {preview.membershipSubtotal > 0 && (
                        <SummaryRow
                          label={`Membership: ${selectedMembership.name}`}
                          value={formatMoney(preview.membershipSubtotal)}
                        />
                      )}
                      <SummaryRow
                        label="Discount"
                        value={`- ${formatMoney(preview.discount)}`}
                      />
                      <SummaryRow
                        label="Service tax"
                        value={formatMoney(preview.serviceTax)}
                      />
                      <SummaryRow
                        label="Product tax"
                        value={formatMoney(preview.productTax)}
                      />
                      <SummaryRow
                        label="Processing fee"
                        value={formatMoney(bill.processingFeeAmount)}
                      />
                      <div className="d-flex justify-content-between py-3">
                        <span>Bill total</span>
                        <strong>{formatMoney(preview.total)}</strong>
                      </div>
                      <p className="text-soft small mt-2">
                        Membership discount and the final GST rounding are
                        applied by the server when the bill is issued.
                      </p>
                    </>
                  )}

                  {paid ? (
                    <>
                      <Button
                        color="primary"
                        block
                        onClick={() =>
                          navigate(`/billing/invoices/${invoice.id}/print`)
                        }
                      >
                        <Icon name="printer-fill" /> Print bill
                      </Button>
                      <Button
                        color="light"
                        block
                        className="mt-2"
                        onClick={() => navigate("/appointments")}
                      >
                        Done
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        type="submit"
                        color="primary"
                        block
                        disabled={
                          saving ||
                          !canBill ||
                          (billed && !canPay) ||
                          (!billed && services.length === 0)
                        }
                      >
                        {saving && <Spinner size="sm" className="me-1" />}
                        {!canPay
                          ? "Generate bill"
                          : isDraft
                            ? "Issue and record payment"
                            : "Record payment"}{" "}
                        · {formatMoney(dueNow)}
                      </Button>
                      {!billed && (
                        <Button
                          type="button"
                          color="light"
                          block
                          className="mt-2"
                          disabled={saving || !canBill || services.length === 0}
                          onClick={saveDraft}
                        >
                          Save as draft
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </div>
            </Col>
          </Row>
        </Form>
      )}
    </PageShell>
  );
};

export default AppointmentBill;
