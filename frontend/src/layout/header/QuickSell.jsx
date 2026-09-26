import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Alert,
  Col,
  Input,
  Label,
  Modal,
  ModalBody,
  Row,
  Spinner,
} from "reactstrap";
import { Button, Icon } from "@/components/Component";
import { Select } from "@/components/select/PortalSelect";
import { salonApi } from "@/services/salonApi";
import { formatMoney } from "@/utils/salonFormat";
import { PAYMENT_METHODS } from "@/utils/paymentMethods";

// Plans in this trade are named by tier, so a card takes its icon and tint from
// its own name; anything else falls back to the house blue.
const TIERS = [
  { match: /platinum|diamond/, icon: "diamond-fill", tone: "violet" },
  { match: /gold/, icon: "award-fill", tone: "amber" },
  { match: /silver|basic/, icon: "star-fill", tone: "slate" },
];

const tierOf = (name) =>
  TIERS.find((tier) => tier.match.test(String(name).toLowerCase())) || {
    icon: "award-fill",
    tone: "blue",
  };

// Suggestion list under the phone / name fields, styled like the job cart's.
const CustomerMenu = ({ matches, onPick }) => (
  <ul className="customer-phone-menu">
    {matches.map((item) => (
      <li key={item.id}>
        <button
          type="button"
          className="customer-phone-option"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onPick(item)}
        >
          <span className="customer-phone-name">{item.name}</span>
          <span className="customer-phone-number">
            {item.phone || "No mobile"}
          </span>
        </button>
      </li>
    ))}
  </ul>
);

// Quick sell from the header: pick who it is for, pick the plan, take the
// money. Same customer lookup as the job cart page; the cart it opens
// underneath is billed and settled here and never shown.
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
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [focused, setFocused] = useState("");
  const [staffId, setStaffId] = useState("");
  // The plan being billed. Nothing is written until it is paid, so a new
  // customer only exists once the sale goes through.
  const [picked, setPicked] = useState(null);
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

  // Same lookup as the job cart page: 3+ characters suggest, a full 10-digit
  // number that is already on file locks the customer in.
  const digitsOf = (value) => String(value || "").replace(/\D/g, "");
  const existing = useMemo(
    () =>
      phone.length === 10
        ? customers.find((item) => {
            const stored = digitsOf(item.phone);
            return stored.length >= 10 && stored.endsWith(phone);
          }) || null
        : null,
    [customers, phone]
  );
  const matches = useMemo(() => {
    if (existing) return [];
    const query = (focused === "name" ? name : phone).trim().toLowerCase();
    if (query.length < 3) return [];
    return customers
      .filter((item) =>
        focused === "name"
          ? item.name.toLowerCase().includes(query)
          : digitsOf(item.phone).includes(query)
      )
      .slice(0, 8);
  }, [customers, existing, focused, name, phone]);

  const choose = (item) => {
    setFocused("");
    setPhone(digitsOf(item.phone).slice(-10));
    setName(item.name);
  };

  const customerName = existing ? existing.name : name.trim();

  const staffOptions = useMemo(
    () =>
      refs.staff.map((member) => ({ value: member.id, label: member.name })),
    [refs.staff]
  );

  // Every plan is in the search dropdown; the cards only show the best sellers.
  const plans = isPackage ? refs.packages : refs.memberships;
  const planOptions = useMemo(
    () => plans.map((item) => ({ value: item.id, label: item.name, item })),
    [plans]
  );
  const topSold = useMemo(
    () =>
      plans
        .filter((item) => item.soldCount > 0)
        .sort((a, b) => b.soldCount - a.soldCount)
        .slice(0, 4),
    [plans]
  );
  const planMeta = (item) =>
    isPackage
      ? `${formatMoney(item.specialPrice)} - ${
          item.validityDays || 0
        } days validity`
      : [
          formatMoney(item.price),
          `${formatMoney(item.walletCreditAmount || 0)} wallet`,
          item.durationMonths ? `${item.durationMonths} months` : "no expiry",
        ].join(" - ");

  // An estimate for the till; the server settles against its own total.
  const taxable = Number(
    (isPackage ? picked?.specialPrice : picked?.price) || 0
  );
  const tax =
    bill.invoiceType === "GST_INVOICE"
      ? taxable * (Number(bill.taxPercent || 0) / 100)
      : 0;
  // Bills settle in whole rupees, same as the server.
  const payable = Math.round(taxable + tax);

  const start = (item) => {
    if (phone.length !== 10) {
      setError("Enter a 10-digit phone number.");
      return;
    }
    if (customerName.length < 2) {
      setError("Enter the customer's name.");
      return;
    }
    if (!branchId) {
      setError("Pick a branch.");
      return;
    }
    setError("");
    setPicked(item);
    setBill((current) => ({
      ...current,
      taxPercent: Number(
        (refs.salon?.gstEnabled ? refs.salon?.serviceGstRate : 0) || 0
      ),
    }));
  };

  const discard = () => {
    setPicked(null);
    setError("");
  };

  // Cart, customer and payment go in together, so backing out before paying
  // leaves nothing behind.
  const confirm = async () => {
    setWorking(true);
    setError("");
    let cartId;
    try {
      const created = await salonApi.jobCarts.create({
        branchId,
        customerName,
        phone: existing?.phone || phone,
      });
      cartId = created.data.id;
      await salonApi.jobCarts.addItem(cartId, {
        itemType: kind,
        ...(isPackage ? { packageId: picked.id } : { membershipId: picked.id }),
        ...(staffId ? { staffId } : {}),
      });
      const result = await salonApi.jobCarts.confirm(cartId, {
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
      setPaid(
        result.data?.invoice ||
          (await salonApi.jobCarts.get(cartId)).data.invoice
      );
      setPicked(null);
    } catch (confirmError) {
      // Don't leave an ACTIVE cart nobody asked for.
      if (cartId) salonApi.jobCarts.cancel(cartId).catch(() => {});
      setError(confirmError.message);
    } finally {
      setWorking(false);
    }
  };

  const close = onClose;

  const title = isPackage ? "Sell a Package" : "Sell a Membership";

  return (
    <Modal isOpen toggle={close} centered size="lg" className="quick-sell-modal">
      <div className="quick-sell-head">
        <span className="quick-sell-head-icon">
          <Icon name={isPackage ? "box-view" : "users"} />
        </span>
        <div className="quick-sell-head-text">
          <h5>{paid ? "Sold" : title}</h5>
          <span>
            {paid
              ? `Invoice issued for ${customerName || "your customer"}`
              : `Add a new ${
                  isPackage ? "package" : "membership"
                } for your customer`}
          </span>
        </div>
        <button
          type="button"
          className="btn-close"
          aria-label="Close"
          onClick={close}
        />
      </div>
      <ModalBody className="quick-sell-body">
        {error && <Alert color="danger">{error}</Alert>}

        {paid ? (
          <>
            <div className="text-center py-3">
              <Icon name="check-circle" className="text-success fs-1" />
              <h5 className="mt-2 mb-1">{formatMoney(paid.totalAmount)} paid</h5>
              <p className="text-soft mb-0">
                Invoice {paid.invoiceNumber || ""} issued for {customerName}.
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
        ) : picked ? (
          <>
            <div className="border rounded p-3 mb-3">
              <div className="d-flex justify-content-between py-1">
                <span>{picked.name}</span>
                <span>{formatMoney(taxable)}</span>
              </div>
              <div className="d-flex justify-content-between py-1 text-soft">
                <span>For</span>
                <span>
                  {customerName} - {phone}
                </span>
              </div>
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
            <Row className="g-3">
              <Col md="6">
                <Label className="quick-sell-label">
                  <Icon name="call" /> Phone Number
                </Label>
                <div className="position-relative">
                  <Input
                    autoComplete="off"
                    inputMode="numeric"
                    maxLength={10}
                    placeholder="10-digit phone number"
                    value={phone}
                    disabled={working}
                    onFocus={() => setFocused("phone")}
                    onBlur={() => window.setTimeout(() => setFocused(""), 150)}
                    onChange={(event) => {
                      // Changing a matched number breaks the match, so the
                      // name it filled goes too.
                      if (existing) setName("");
                      setPhone(digitsOf(event.target.value).slice(0, 10));
                    }}
                  />
                  {focused === "phone" && matches.length > 0 && (
                    <CustomerMenu matches={matches} onPick={choose} />
                  )}
                </div>
              </Col>
              <Col md="6">
                <Label className="quick-sell-label">
                  <Icon name="user" /> Customer Name
                </Label>
                <div className="position-relative">
                  <Input
                    autoComplete="off"
                    placeholder="Customer name"
                    maxLength={120}
                    value={existing ? existing.name : name}
                    readOnly={Boolean(existing)}
                    disabled={working}
                    onFocus={() => setFocused("name")}
                    onBlur={() => window.setTimeout(() => setFocused(""), 150)}
                    onChange={(event) => setName(event.target.value)}
                  />
                  {focused === "name" && matches.length > 0 && (
                    <CustomerMenu matches={matches} onPick={choose} />
                  )}
                </div>
              </Col>
              {refs.branches.length > 1 && (
                <Col md="6">
                  <Label className="quick-sell-label">
                    <Icon name="map-pin" /> Branch
                  </Label>
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
                <Label className="quick-sell-label">
                  <Icon name="tag" /> Sold by
                </Label>
                <Select
                  isClearable
                  placeholder="Not recorded"
                  isDisabled={working}
                  options={staffOptions}
                  value={
                    staffOptions.find((option) => option.value === staffId) ||
                    null
                  }
                  onChange={(option) => setStaffId(option?.value || "")}
                />
              </Col>
              <Col md="6">
                <Label className="quick-sell-label">
                  <Icon name="search" /> {isPackage ? "Package" : "Plan"}
                </Label>
                <Select
                  isDisabled={working}
                  isLoading={loading}
                  placeholder={
                    isPackage ? "Search packages..." : "Search plans..."
                  }
                  noOptionsMessage={() =>
                    isPackage ? "No packages match" : "No plans match"
                  }
                  options={planOptions}
                  value={null}
                  onChange={(option) => option && start(option.item)}
                  formatOptionLabel={({ item }) => (
                    <div>
                      <div className="fw-medium">{item.name}</div>
                      <small className="text-soft">{planMeta(item)}</small>
                    </div>
                  )}
                />
              </Col>
            </Row>

            <div className="quick-sell-section">
              <Icon name={isPackage ? "package-fill" : "award-fill"} />
              <div>
                <h6>
                  {isPackage ? "Most sold packages" : "Most sold plans"}
                </h6>
                <span>
                  Pick one here, or search above for any{" "}
                  {isPackage ? "package" : "plan"}
                </span>
              </div>
            </div>

            {loading || working ? (
              <div className="text-center py-4">
                <Spinner size="sm" />
              </div>
            ) : plans.length === 0 ? (
              <div className="quick-sell-empty">
                {isPackage
                  ? "No packages yet - create one from the Packages page"
                  : "No plans yet - add one under Customer Retention > Manage Memberships"}
              </div>
            ) : topSold.length === 0 ? (
              <div className="quick-sell-empty">
                Nothing sold yet - search above to pick one
              </div>
            ) : (
              <div className="quick-sell-plans">
                {topSold.map((item) => {
                  const tier = isPackage
                    ? { icon: "package-fill", tone: "blue" }
                    : tierOf(item.name);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`quick-sell-plan quick-sell-plan-${tier.tone}`}
                      disabled={working}
                      onClick={() => start(item)}
                    >
                      <span className="quick-sell-plan-icon">
                        <Icon name={tier.icon} />
                      </span>
                      <span className="quick-sell-plan-body">
                        <span className="quick-sell-plan-name">
                          {item.name}
                        </span>
                        <span className="quick-sell-plan-meta">
                          {planMeta(item)}
                        </span>
                      </span>
                      <span className="quick-sell-plan-add">
                        <Icon name="plus" />
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
      </ModalBody>
    </Modal>
  );
};

export default QuickSell;
