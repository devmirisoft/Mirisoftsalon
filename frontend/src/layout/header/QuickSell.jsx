import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Alert,
  Col,
  Input,
  Label,
  Modal,
  ModalBody,
  ModalHeader,
  Row,
  Spinner,
} from "reactstrap";
import { Button, Icon } from "@/components/Component";
import { Select } from "@/components/select/PortalSelect";
import { salonApi } from "@/services/salonApi";
import { formatMoney } from "@/utils/salonFormat";
import { PAYMENT_METHODS } from "@/utils/paymentMethods";

// Quick sell from the header: pick who it is for, pick the plan, take the
// money. Same picker as the job cart page, but the cart it opens underneath is
// billed and settled here and never shown.
const QuickSell = ({ kind, onClose }) => {
  const isPackage = kind === "PACKAGE";
  const [refs, setRefs] = useState({
    branches: [],
    staff: [],
    packages: [],
    memberships: [],
    salon: null,
  });
  const [customers, setCustomers] = useState([]);
  const [branchId, setBranchId] = useState("");
  const [customer, setCustomer] = useState(null);
  const [staffId, setStaffId] = useState("");
  const [search, setSearch] = useState("");
  // The cart created behind this modal, kept only until the bill is confirmed.
  const [cart, setCart] = useState(null);
  const [bill, setBill] = useState({
    invoiceType: "BILL_OF_SUPPLY",
    taxPercent: 0,
    method: "CASH",
    referenceNo: "",
  });
  const [paid, setPaid] = useState(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.allSettled([
      salonApi.jobCarts.references(branchId ? { branchId } : {}),
      salonApi.customers.list(),
    ])
      .then(([referenceResult, customerResult]) => {
        if (!active) return;
        if (referenceResult.status === "fulfilled") {
          const data = referenceResult.value.data || {};
          setRefs({
            branches: data.branches || [],
            staff: data.staff || [],
            packages: data.packages || [],
            memberships: data.memberships || [],
            salon: data.salon || null,
          });
          if (!branchId && data.branches?.length === 1) {
            setBranchId(data.branches[0].id);
          }
        } else {
          setError(referenceResult.reason.message);
        }
        if (customerResult.status === "fulfilled") {
          setCustomers(customerResult.value.data || []);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [branchId]);

  const customerOptions = useMemo(
    () =>
      customers.map((item) => ({
        value: item.id,
        label: item.phone ? `${item.name} - ${item.phone}` : item.name,
        name: item.name,
        phone: item.phone || "",
      })),
    [customers]
  );

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    const list = isPackage ? refs.packages : refs.memberships;
    return list.filter(
      (item) => !term || item.name.toLowerCase().includes(term)
    );
  }, [isPackage, refs.packages, refs.memberships, search]);

  const invoice = cart?.invoice;
  const subtotal = Number(invoice?.subtotalAmount || 0);
  // A membership never discounts itself or a product, and only discounts a
  // package when the salon opted in - same rule the server bills by.
  const discount =
    isPackage && cart?.salon?.membershipDiscountOnPackages
      ? subtotal *
        (Number(cart?.customer?.membership?.discountPercentage || 0) / 100)
      : 0;
  const taxable = Math.max(subtotal - discount, 0);
  const tax =
    bill.invoiceType === "GST_INVOICE"
      ? taxable * (Number(bill.taxPercent || 0) / 100)
      : 0;
  // Bills settle in whole rupees, same as the server.
  const payable = Math.round(taxable + tax);

  const start = async (item) => {
    if (!customer) {
      setError("Pick who this is for.");
      return;
    }
    if (!customer.phone) {
      setError("That customer has no phone number on file.");
      return;
    }
    if (!branchId) {
      setError("Pick a branch.");
      return;
    }
    setWorking(true);
    setError("");
    try {
      const created = await salonApi.jobCarts.create({
        branchId,
        customerName: customer.name,
        phone: customer.phone,
      });
      await salonApi.jobCarts.addItem(created.data.id, {
        itemType: kind,
        ...(isPackage ? { packageId: item.id } : { membershipId: item.id }),
        ...(staffId ? { staffId } : {}),
      });
      const loaded = await salonApi.jobCarts.get(created.data.id);
      setCart(loaded.data);
      setBill((current) => ({
        ...current,
        taxPercent: Number(
          loaded.data.invoice?.items?.[0]?.taxPercent ||
            (loaded.data.salon?.gstEnabled
              ? loaded.data.salon?.serviceGstRate
              : 0) ||
            0
        ),
      }));
    } catch (startError) {
      setError(startError.message);
    } finally {
      setWorking(false);
    }
  };

  // Backing out leaves an ACTIVE cart nobody asked for, so drop it.
  const discard = async () => {
    const id = cart?.id;
    setCart(null);
    setError("");
    if (id) await salonApi.jobCarts.cancel(id).catch(() => {});
  };

  const confirm = async () => {
    setWorking(true);
    setError("");
    try {
      const result = await salonApi.jobCarts.confirm(cart.id, {
        invoiceType: bill.invoiceType,
        status: "ISSUED",
        taxPercent: Number(bill.taxPercent || 0),
        // No amount: the server settles the whole balance against its own
        // total, so a stale estimate here can never underpay.
        payment: {
          method: bill.method,
          ...(bill.referenceNo.trim()
            ? { referenceNo: bill.referenceNo.trim() }
            : {}),
        },
        idempotencyKey: globalThis.crypto.randomUUID(),
        confirmedAt: new Date().toISOString(),
      });
      setPaid(result.data?.invoice || cart.invoice);
      setCart(null);
    } catch (confirmError) {
      setError(confirmError.message);
    } finally {
      setWorking(false);
    }
  };

  const close = () => {
    if (cart) discard();
    onClose();
  };

  const title = isPackage ? "Sell a Package" : "Sell a Membership";
  const soldItem = cart?.items?.[0];

  return (
    <Modal
      isOpen
      toggle={close}
      centered
      size="lg"
      contentClassName="border-0"
    >
      <ModalHeader toggle={close}>{paid ? "Sold" : title}</ModalHeader>
      <ModalBody>
        {error && <Alert color="danger">{error}</Alert>}

        {paid ? (
          <>
            <div className="text-center py-3">
              <Icon name="check-circle" className="text-success fs-1" />
              <h5 className="mt-2 mb-1">{formatMoney(paid.totalAmount)} paid</h5>
              <p className="text-soft mb-0">
                Invoice {paid.invoiceNumber || ""} issued for {customer?.name}.
              </p>
            </div>
            <div className="d-flex justify-content-end gap-2">
              <Link to={`/billing/invoices/${paid.id}`} onClick={onClose}>
                <Button color="light" outline>
                  Open Invoice
                </Button>
              </Link>
              <Button color="primary" onClick={onClose}>
                Done
              </Button>
            </div>
          </>
        ) : cart ? (
          <>
            <div className="border rounded p-3 mb-3">
              <div className="d-flex justify-content-between py-1">
                <span>{soldItem?.serviceName || title}</span>
                <span>{formatMoney(subtotal)}</span>
              </div>
              <div className="d-flex justify-content-between py-1 text-soft">
                <span>For</span>
                <span>
                  {customer?.name} - {customer?.phone}
                </span>
              </div>
              {discount > 0 && (
                <div className="d-flex justify-content-between py-1">
                  <span className="text-soft">Membership discount</span>
                  <span>-{formatMoney(discount)}</span>
                </div>
              )}
              {tax > 0 && (
                <div className="d-flex justify-content-between py-1">
                  <span className="text-soft">Tax</span>
                  <span>{formatMoney(tax)}</span>
                </div>
              )}
              <div className="d-flex justify-content-between py-2 border-top mt-1 fw-bold">
                <span>Payable</span>
                <span>{formatMoney(payable)}</span>
              </div>
            </div>
            <Row className="g-3 mb-3">
              <Col md="4">
                <Label className="mb-1">Bill type</Label>
                <Input
                  type="select"
                  value={bill.invoiceType}
                  onChange={(event) =>
                    setBill((current) => ({
                      ...current,
                      invoiceType: event.target.value,
                    }))
                  }
                >
                  <option value="BILL_OF_SUPPLY">Bill of supply</option>
                  <option value="GST_INVOICE">GST invoice</option>
                </Input>
              </Col>
              <Col md="4">
                <Label className="mb-1">Tax %</Label>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  disabled={bill.invoiceType !== "GST_INVOICE"}
                  value={bill.taxPercent}
                  onChange={(event) =>
                    setBill((current) => ({
                      ...current,
                      taxPercent: event.target.value,
                    }))
                  }
                />
              </Col>
              <Col md="4">
                <Label className="mb-1">Paid by</Label>
                <Input
                  type="select"
                  value={bill.method}
                  onChange={(event) =>
                    setBill((current) => ({
                      ...current,
                      method: event.target.value,
                    }))
                  }
                >
                  {PAYMENT_METHODS.map((method) => (
                    <option key={method.value} value={method.value}>
                      {method.label}
                    </option>
                  ))}
                </Input>
              </Col>
              <Col md="12">
                <Label className="mb-1">Reference no (optional)</Label>
                <Input
                  value={bill.referenceNo}
                  onChange={(event) =>
                    setBill((current) => ({
                      ...current,
                      referenceNo: event.target.value,
                    }))
                  }
                  placeholder="UPI / card reference"
                />
              </Col>
            </Row>
            <div className="d-flex justify-content-between align-items-center">
              <Button color="light" outline disabled={working} onClick={discard}>
                Back
              </Button>
              <Button color="primary" disabled={working} onClick={confirm}>
                {working ? <Spinner size="sm" /> : `Collect ${formatMoney(payable)}`}
              </Button>
            </div>
          </>
        ) : (
          <>
            <Row className="g-3 mb-3">
              <Col md="6">
                <Label className="mb-1">Sell to</Label>
                <Select
                  options={customerOptions}
                  value={customer}
                  onChange={setCustomer}
                  isDisabled={working}
                  placeholder="Search customer by name or phone"
                />
              </Col>
              {refs.branches.length > 1 && (
                <Col md="6">
                  <Label className="mb-1">Branch</Label>
                  <Input
                    type="select"
                    value={branchId}
                    onChange={(event) => setBranchId(event.target.value)}
                  >
                    <option value="">Pick a branch</option>
                    {refs.branches.map((branch) => (
                      <option key={branch.id} value={branch.id}>
                        {branch.name}
                      </option>
                    ))}
                  </Input>
                </Col>
              )}
              <Col md="6">
                <Label className="mb-1">Sold by</Label>
                <Input
                  type="select"
                  value={staffId}
                  onChange={(event) => setStaffId(event.target.value)}
                >
                  <option value="">Not recorded</option>
                  {refs.staff.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                </Input>
              </Col>
              <Col md="6">
                <Label className="mb-1">Search</Label>
                <Input
                  type="search"
                  placeholder={isPackage ? "Search packages" : "Search plans"}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </Col>
            </Row>
            <div
              className="border rounded"
              style={{ maxHeight: 380, overflowY: "auto" }}
            >
              {loading || working ? (
                <div className="text-center py-4">
                  <Spinner size="sm" />
                </div>
              ) : visible.length === 0 ? (
                <div className="text-soft text-center py-4">
                  {isPackage
                    ? "No packages match - create one from the Packages page"
                    : "No plans match - add one under Customer Retention > Manage Memberships"}
                </div>
              ) : (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                  }}
                >
                  {visible.map((item) => (
                    <div key={item.id} style={{ minWidth: 0 }}>
                      <button
                        type="button"
                        className="btn d-flex align-items-center justify-content-between gap-2 px-3 py-2 border-bottom mb-0 h-100 w-100 text-start bg-transparent"
                        style={{ cursor: "pointer", minWidth: 0 }}
                        disabled={working}
                        onClick={() => start(item)}
                      >
                        <span className="text-truncate" style={{ minWidth: 0 }}>
                          <span className="d-block text-truncate">
                            {item.name}
                          </span>
                          <small className="text-soft">
                            {isPackage
                              ? `${formatMoney(item.specialPrice)} - ${
                                  item.validityDays || 0
                                } days validity`
                              : `${formatMoney(item.price)} - ${Number(
                                  item.discountPercentage || 0
                                )}% off${
                                  item.durationMonths
                                    ? ` - ${item.durationMonths} months`
                                    : " - no expiry"
                                }`}
                          </small>
                        </span>
                        <Icon
                          name="plus-circle"
                          className="text-primary flex-shrink-0"
                        />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </ModalBody>
    </Modal>
  );
};

export default QuickSell;
