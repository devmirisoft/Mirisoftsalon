/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import Select from "react-select";
import {
  Alert,
  Col,
  FormGroup,
  Input,
  Label,
  Modal,
  ModalBody,
  ModalHeader,
  Row,
  Spinner,
  UncontrolledPopover,
  PopoverBody,
} from "reactstrap";
import { Button, Icon } from "@/components/Component";
import PageShell from "@/components/salon/PageShell";
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

const TAX_OPTIONS = [
  { value: 0, label: "No tax" },
  { value: 5, label: "GST 5%" },
  { value: 12, label: "GST 12%" },
  { value: 18, label: "GST 18%" },
  { value: 28, label: "GST 28%" },
];

const PAYMENT_METHODS = [
  { value: "CASH", label: "Cash" },
  { value: "UPI", label: "UPI" },
  { value: "GPAY", label: "GPay" },
  { value: "PAYTM", label: "Paytm" },
  { value: "PHONEPE", label: "PhonePe" },
  { value: "CARD", label: "Card" },
  { value: "BANK_TRANSFER", label: "Bank transfer" },
  { value: "CHEQUE", label: "Cheque" },
  { value: "MEMBERSHIP_WALLET", label: "Membership wallet" },
  { value: "OTHER", label: "Other" },
];

const JobCartDetails = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [cart, setCart] = useState(null);
  const [refs, setRefs] = useState({ staff: [], services: [], packages: [] });
  const [customerSummary, setCustomerSummary] = useState(null);
  const [form, setForm] = useState({
    customerName: "",
    phone: "",
    startTime: "",
    staffId: "",
    bookingNote: "",
  });
  const [servicePickerOpen, setServicePickerOpen] = useState(false);
  const [productId, setProductId] = useState("");
  const [servicePickerCategoryId, setServicePickerCategoryId] = useState("");
  const [servicePickerSearch, setServicePickerSearch] = useState("");
  const [servicePickerStaffId, setServicePickerStaffId] = useState("");
  // Price edits live here until blur so each keystroke does not hit the API.
  const [priceDrafts, setPriceDrafts] = useState({});
  const [packageStaffId, setPackageStaffId] = useState("");
  const [membershipStaffId, setMembershipStaffId] = useState("");
  const [packagePickerOpen, setPackagePickerOpen] = useState(false);
  const [packagePickerCategoryId, setPackagePickerCategoryId] = useState("");
  const [packagePickerSearch, setPackagePickerSearch] = useState("");
  const [membershipPickerOpen, setMembershipPickerOpen] = useState(false);
  const [membershipPickerSearch, setMembershipPickerSearch] = useState("");
  const [customPackage, setCustomPackage] = useState({
    serviceIds: [],
    name: "",
    specialPrice: "",
    validityDays: 30,
    usageLimit: 1,
  });
  const [redemptionSelections, setRedemptionSelections] = useState({});
  const [couponCode, setCouponCode] = useState("");
  const [billingForm, setBillingForm] = useState({
    invoiceType: "BILL_OF_SUPPLY",
    status: "ISSUED",
    discountAmount: 0,
    processingFeeAmount: 0,
    taxPercent: 0,
    billingNote: "",
  });
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
      const referenceResponse = await salonApi.jobCarts.references({
        ...(next.salonId ? { salonId: next.salonId } : {}),
        ...(next.branchId ? { branchId: next.branchId } : {}),
      });
      setRefs(referenceResponse.data || { staff: [], services: [] });
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
        setQueuedNotice(
          `${pushed} queued bill${pushed === 1 ? "" : "s"} sent.`
        );
        load();
      }),
    [load]
  );

  const availableServices = useMemo(() => {
    const existing = new Set(
      (cart?.items || [])
        .filter((item) => item.itemType !== "PACKAGE")
        .map((item) => item.serviceId)
    );
    return refs.services.filter((service) => !existing.has(service.id));
  }, [cart?.items, refs.services]);
  // Mirrors the "Add Services" picker on job creation: category + search
  // filter over a checklist-style grid instead of a plain dropdown.
  const servicePickerCategories = useMemo(() => {
    const seen = new Map();
    availableServices.forEach((service) => {
      const categoryId = service.mainService?.id || service.mainServiceId || "";
      const categoryName =
        service.mainService?.name || service.mainServiceName || "Other";
      if (categoryId && !seen.has(categoryId)) {
        seen.set(categoryId, categoryName);
      }
    });
    return [...seen.entries()].map(([catId, name]) => ({ id: catId, name }));
  }, [availableServices]);
  const servicePickerVisibleServices = useMemo(() => {
    const term = servicePickerSearch.trim().toLowerCase();
    return availableServices.filter((service) => {
      const categoryId = service.mainService?.id || service.mainServiceId || "";
      if (servicePickerCategoryId && categoryId !== servicePickerCategoryId) {
        return false;
      }
      return !term || service.name.toLowerCase().includes(term);
    });
  }, [availableServices, servicePickerCategoryId, servicePickerSearch]);
  const availablePackages = useMemo(() => {
    const existing = new Set(
      (cart?.items || [])
        .filter((item) => item.itemType === "PACKAGE")
        .map((item) => item.packageId)
    );
    const standaloneServices = new Set(
      (cart?.items || [])
        .filter((item) => item.itemType !== "PACKAGE" && item.serviceId)
        .map((item) => item.serviceId)
    );
    return (refs.packages || []).filter(
      (servicePackage) =>
        !existing.has(servicePackage.id) &&
        !(servicePackage.items || []).some((item) =>
          standaloneServices.has(item.serviceId)
        )
    );
  }, [cart?.items, refs.packages]);
  // One plan per bill: a second would supersede the first and forfeit the
  // wallet it was just sold with, so the picker closes once one is on.
  const membershipOnCart = (cart?.items || []).some(
    (item) => item.itemType === "MEMBERSHIP"
  );
  const availableMemberships = useMemo(
    () => (membershipOnCart ? [] : refs.memberships || []),
    [membershipOnCart, refs.memberships]
  );
  // Package and membership pickers mirror the service one: category + search
  // over a clickable grid, so all three add the same way.
  const packagePickerCategories = useMemo(() => {
    const seen = new Map();
    availablePackages.forEach((servicePackage) => {
      const category = servicePackage.category;
      if (category?.id && !seen.has(category.id)) {
        seen.set(category.id, category.name);
      }
    });
    return [...seen.entries()].map(([catId, name]) => ({ id: catId, name }));
  }, [availablePackages]);
  const packagePickerVisiblePackages = useMemo(() => {
    const term = packagePickerSearch.trim().toLowerCase();
    return availablePackages.filter((servicePackage) => {
      if (
        packagePickerCategoryId &&
        servicePackage.category?.id !== packagePickerCategoryId
      ) {
        return false;
      }
      return !term || servicePackage.name.toLowerCase().includes(term);
    });
  }, [availablePackages, packagePickerCategoryId, packagePickerSearch]);
  const membershipPickerVisiblePlans = useMemo(() => {
    const term = membershipPickerSearch.trim().toLowerCase();
    return availableMemberships.filter(
      (plan) => !term || plan.name.toLowerCase().includes(term)
    );
  }, [availableMemberships, membershipPickerSearch]);
  const packagesInCart = (cart?.items || []).filter(
    (item) => item.itemType === "PACKAGE"
  ).length;
  // Product picker: searchable by name or SKU, out-of-stock rows unselectable.
  const productOptions = useMemo(
    () =>
      (refs.products || []).map((product) => {
        const stock = Number(product.currentStock) || 0;
        return {
          value: product.id,
          label: [
            product.name,
            product.sku,
            formatMoney(product.sellingPrice),
            stock > 0 ? `${stock} ${product.unit || "in stock"}` : "out of stock",
          ]
            .filter(Boolean)
            .join(" · "),
          isDisabled: stock <= 0,
        };
      }),
    [refs.products]
  );
  const standaloneServiceItems = useMemo(
    () =>
      (cart?.items || []).filter(
        (item) => item.itemType !== "PACKAGE" && item.serviceId
      ),
    [cart?.items]
  );
  const selectedCustomServices = useMemo(
    () =>
      standaloneServiceItems.filter((item) =>
        customPackage.serviceIds.includes(item.serviceId)
      ),
    [customPackage.serviceIds, standaloneServiceItems]
  );
  const selectedCustomTotal = selectedCustomServices.reduce(
    (sum, item) => sum + Number(item.price || 0),
    0
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

  const addServiceFromPicker = (pickedServiceId) =>
    run(() =>
      salonApi.jobCarts.addItem(id, {
        itemType: "SERVICE",
        serviceId: pickedServiceId,
        ...(servicePickerStaffId ? { staffId: servicePickerStaffId } : {}),
      })
    );

  const updateServiceItem = (itemId, body) =>
    run(() => salonApi.jobCarts.updateItem(id, itemId, body));

  const savePriceDraft = (item) => {
    const draft = priceDrafts[item.id];
    setPriceDrafts((current) => {
      const next = { ...current };
      delete next[item.id];
      return next;
    });
    const price = Number(draft);
    if (draft === undefined || draft === "" || Number.isNaN(price) || price < 0) {
      return;
    }
    if (price === Number(item.price)) return;
    updateServiceItem(item.id, { price });
  };

  const addPackageFromPicker = (pickedPackageId) =>
    run(() =>
      salonApi.jobCarts.addItem(id, {
        itemType: "PACKAGE",
        packageId: pickedPackageId,
        ...(packageStaffId ? { staffId: packageStaffId } : {}),
      })
    );

  // Only one plan per bill, so the picker closes on the first pick.
  const addMembershipFromPicker = (pickedMembershipId) =>
    run(async () => {
      await salonApi.jobCarts.addItem(id, {
        itemType: "MEMBERSHIP",
        membershipId: pickedMembershipId,
        ...(membershipStaffId ? { staffId: membershipStaffId } : {}),
      });
      setMembershipPickerOpen(false);
    });

  const save = () => {
    const startTime = new Date(form.startTime);
    if (Number.isNaN(startTime.getTime()) || startTime < new Date()) {
      setError("Choose a start time from now onward.");
      return;
    }
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

  const canApplyCoupon = [
    "SUPER_ADMIN",
    "SALON_ADMIN",
    "RECEPTIONIST",
  ].includes(user?.role);
  const canOpenInvoice = [
    "SUPER_ADMIN",
    "SALON_ADMIN",
    "RECEPTIONIST",
  ].includes(user?.role);
  const active = cart?.status === "ACTIVE";
  const invoice = cart?.invoice;
  const subtotalAmount = Number(invoice?.subtotalAmount || 0);
  const manualDiscount = active ? Number(billingForm.discountAmount || 0) : 0;
  const membershipPercent = Number(cart?.customer?.membership?.discountPercentage || 0);
  // Mirrors isMembershipDiscountable on the server: a membership never reduces
  // a product, and only reduces a package when the salon has opted in. Keeping
  // the rule in step here stops the page promising a discount the bill refuses.
  const membershipDiscountBase = (invoice?.items || [])
    .filter((item) =>
      item.itemType === "PRODUCT" || item.itemType === "MEMBERSHIP"
        ? false
        : item.itemType === "PACKAGE"
          ? Boolean(cart?.salon?.membershipDiscountOnPackages)
          : true
    )
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

  const collecting = billingForm.status !== "DRAFT" && paymentForm.collect;
  const activeTenders = collecting
    ? tenders.filter((tender) => tender.method)
    : [];
  // A blank amount on a lone tender means "the whole bill", which the server
  // settles against its own rounded total so a stale estimate cannot underpay.
  const tenderTotal = activeTenders.reduce(
    (sum, tender) => sum + Number(tender.amount || 0),
    0
  );
  const singleFullTender =
    activeTenders.length === 1 && !activeTenders[0].amount;
  const collectedAmount = singleFullTender ? payableAmount : tenderTotal;
  const outstandingAfter = Math.max(payableAmount - collectedAmount, 0);
  const overpaying = collectedAmount - payableAmount > 0.004;
  const walletTender = activeTenders.find(
    (tender) => tender.method === "MEMBERSHIP_WALLET"
  );
  const walletShort =
    walletTender &&
    (singleFullTender ? payableAmount : Number(walletTender.amount || 0)) >
      membershipWalletBalance + 0.004;

  const buildConfirmBody = () => ({
    ...billingForm,
    discountAmount: Number(billingForm.discountAmount || 0),
    processingFeeAmount: Number(billingForm.processingFeeAmount || 0),
    taxPercent: Number(billingForm.taxPercent || 0),
    billingNote: billingForm.billingNote || null,
    // Stamped here, not on the server, so a confirm pushed later from the
    // offline queue keeps the time the operator actually ended the job.
    confirmedAt: new Date().toISOString(),
    idempotencyKey: globalThis.crypto.randomUUID(),
    ...(collecting && activeTenders.length
      ? {
          payments: activeTenders.map((tender) => ({
            method: tender.method,
            amount: singleFullTender
              ? Number(payableAmount.toFixed(2))
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
          })),
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


  const setRedemptionValue = (balanceId, key, value) =>
    setRedemptionSelections((current) => ({
      ...current,
      [balanceId]: {
        ...(current[balanceId] || {}),
        [key]: value,
      },
    }));

  const redeemPackage = (customerPackage) =>
    run(async () => {
      const items = (customerPackage.serviceBalances || [])
        .map((balance) => {
          const selected = redemptionSelections[balance.balanceId] || {};
          return {
            serviceId: balance.serviceId,
            quantity: Number(selected.quantity || 0),
            ...(selected.staffId ? { staffId: selected.staffId } : {}),
          };
        })
        .filter((item) => item.quantity > 0);
      if (!items.length) {
        throw new Error("Choose at least one package service to redeem");
      }
      await salonApi.jobCarts.addRedemption(id, {
        customerPackageId: customerPackage.customerPackageId,
        items,
      });
      setRedemptionSelections({});
    });

  const toggleCustomPackageService = (serviceId) =>
    setCustomPackage((current) => ({
      ...current,
      serviceIds: current.serviceIds.includes(serviceId)
        ? current.serviceIds.filter((id) => id !== serviceId)
        : [...current.serviceIds, serviceId],
    }));

  const createCustomPackage = () =>
    run(async () => {
      if (!customPackage.serviceIds.length) {
        throw new Error("Choose at least one service for the custom package");
      }
      if (!customPackage.name.trim()) {
        throw new Error("Enter a custom package name");
      }
      const usageLimit = Number(customPackage.usageLimit || 1);
      if (!Number.isInteger(usageLimit) || usageLimit < 1 || usageLimit > 100) {
        throw new Error("Enter a usage limit from 1 to 100");
      }
      await salonApi.packages.createCustomFromCart({
        jobCartId: id,
        serviceIds: customPackage.serviceIds,
        items: customPackage.serviceIds.map((serviceId) => ({
          serviceId,
          quantity: usageLimit,
        })),
        name: customPackage.name,
        specialPrice: Number(customPackage.specialPrice || selectedCustomTotal),
        validityDays: Number(customPackage.validityDays || 30),
        ...(packageStaffId ? { soldByStaffId: packageStaffId } : {}),
      });
      setCustomPackage({
        serviceIds: [],
        name: "",
        specialPrice: "",
        validityDays: 30,
        usageLimit: 1,
      });
    });

  return (
    <PageShell
      title={cart ? `Job Cart ${cart.jobCartId}` : "Job Cart"}
      inlineDescription
      description={
        cart
          ? `${cart.customer?.name || "Walk-in"} • ${formatDate(
              cart.startTime,
              true
            )}`
          : "Walk-in appointment and draft invoice"
      }
      tools={
        <>
          <Button color="light" outline onClick={() => navigate("/job-carts")}>
            <Icon name="arrow-left" /> Back
          </Button>
          {cart && <StatusBadge value={cart.status} />}
        </>
      }
    >
      {error && <Alert color="danger">{error}</Alert>}
      {queuedNotice && (
        <Alert color="info" className="d-flex justify-content-between align-items-center">
          <span>{queuedNotice}</span>
          <Button size="sm" color="light" onClick={() => setQueuedNotice("")}>
            Dismiss
          </Button>
        </Alert>
      )}
      {loading && !cart ? (
        <div className="text-center py-5">
          <Spinner color="primary" />
        </div>
      ) : cart ? (
        <Row className="g-4">
          <Col lg="8">
            <div className="card card-bordered mb-4">
              <div className="card-inner">
                {/* <div className="d-flex justify-content-between align-items-center mb-4">
                  <h5 className="mb-0">Customer & Schedule</h5>
                  <span className="text-soft">
                    {cart.branch?.name || "No branch"}
                  </span>
                </div> */}
                <Row className="g-2 align-items-end">
                  <Col md="3">
                    <FormGroup noMargin>
                      <Label>Customer Name</Label>
                      <Input readOnly value={form.customerName} />
                    </FormGroup>
                  </Col>
                  <Col md="2">
                    <FormGroup noMargin>
                      <Label>Phone Number</Label>
                      <Input readOnly value={form.phone} />
                    </FormGroup>
                  </Col>
                  <Col md="3">
                    <FormGroup noMargin>
                      <Label>Date & Start Time</Label>
                      <Input
                        type="datetime-local"
                        min={minDateTimeInput()}
                        disabled={!active}
                        value={form.startTime}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            startTime: event.target.value,
                          }))
                        }
                      />
                    </FormGroup>
                  </Col>
                  <Col xs="auto" className="d-flex align-items-end gap-2">
                    <Button
                      id="bookingNoteToggle"
                      type="button"
                      color={form.bookingNote ? "primary" : "light"}
                      outline
                      className="btn-icon"
                      title={form.bookingNote || "Add note"}
                    >
                      <Icon name="edit-alt" />
                    </Button>
                    <UncontrolledPopover
                      trigger="legacy"
                      placement="bottom"
                      target="bookingNoteToggle"
                    >
                      <PopoverBody style={{ width: "18rem" }}>
                        <Label className="form-label">Note</Label>
                        <Input
                          type="textarea"
                          rows="3"
                          placeholder="Anything the stylist should know"
                          disabled={!active}
                          value={form.bookingNote}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              bookingNote: event.target.value,
                            }))
                          }
                        />
                      </PopoverBody>
                    </UncontrolledPopover>
                    {active && (
                      <Button
                        className="text-nowrap"
                        color="primary"
                        outline
                        disabled={working}
                        onClick={save}
                      >
                        Save Details
                      </Button>
                    )}
                  </Col>
                </Row>
              </div>
            </div>

            <div className="card card-bordered">
              <div className="card-inner">
                <div className="d-flex flex-wrap align-items-center gap-3 mb-3">
                  <h5 className="mb-4">Services & Package</h5>
                  {active && (
                    <Button
                      color="primary"
                      className="mb-4"
                      outline
                      disabled={working}
                      onClick={() => setServicePickerOpen(true)}
                    >
                      <Icon name="plus" /> Add Service
                    </Button>
                  )}
                </div>
                {/* {active && standaloneServiceItems.length > 0 && (
                  <div className="border rounded p-3 mb-4">
                    <h6>Create Customer Custom Package</h6>
                    <Row className="g-2">
                      <Col md="3">
                        <Label className="form-label">Package name</Label>
                        <Input
                          placeholder="Package name"
                          value={customPackage.name}
                          onChange={(event) =>
                            setCustomPackage((current) => ({
                              ...current,
                              name: event.target.value,
                            }))
                          }
                        />
                      </Col>
                      <Col md="2">
                        <Label className="form-label">Price</Label>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder={`Price ${formatMoney(selectedCustomTotal)}`}
                          value={customPackage.specialPrice}
                          onChange={(event) =>
                            setCustomPackage((current) => ({
                              ...current,
                              specialPrice: event.target.value,
                            }))
                          }
                        />
                      </Col>
                      <Col md="2">
                        <Label className="form-label">Validity days</Label>
                        <Input
                          type="number"
                          min="1"
                          value={customPackage.validityDays}
                          onChange={(event) =>
                            setCustomPackage((current) => ({
                              ...current,
                              validityDays: event.target.value,
                            }))
                          }
                        />
                      </Col>
                      <Col md="2">
                        <Label className="form-label">Usage limit</Label>
                        <Input
                          type="number"
                          min="1"
                          max="100"
                          step="1"
                          value={customPackage.usageLimit}
                          onChange={(event) =>
                            setCustomPackage((current) => ({
                              ...current,
                              usageLimit: event.target.value,
                            }))
                          }
                        />
                      </Col>
                      <Col md="2">
                        <Label className="form-label d-none d-md-block">&nbsp;</Label>
                        <Button
                          color="primary"
                          outline
                          disabled={working || !customPackage.serviceIds.length}
                          onClick={createCustomPackage}
                        >
                          Create
                        </Button>
                      </Col>
                    </Row>
                    <div className="mt-3">
                      {standaloneServiceItems.map((item) => (
                        <div key={item.id} className="form-check mb-1">
                          <Input
                            type="checkbox"
                            id={`custom-package-service-${item.serviceId}`}
                            checked={customPackage.serviceIds.includes(
                              item.serviceId
                            )}
                            onChange={() =>
                              toggleCustomPackageService(item.serviceId)
                            }
                          />
                          <Label
                            className="form-check-label"
                            htmlFor={`custom-package-service-${item.serviceId}`}
                          >
                            {item.serviceName} - {formatMoney(item.price)}
                          </Label>
                        </div>
                      ))}
                    </div>
                  </div>
                )} */}
                <Modal
                  isOpen={servicePickerOpen}
                  toggle={() => setServicePickerOpen(false)}
                  centered
                  size="xl"
                  contentClassName="border-0"
                >
                  <ModalHeader toggle={() => setServicePickerOpen(false)}>
                    Add Services
                  </ModalHeader>
                  <ModalBody>
                    <Row className="g-3 mb-3">
                       <Col md="4">
                        <Label className="mb-1">Search</Label>
                        <Input
                          type="search"
                          placeholder="Search services"
                          value={servicePickerSearch}
                          onChange={(event) =>
                            setServicePickerSearch(event.target.value)
                          }
                        />
                      </Col>
                      <Col md="4">
                        <Label className="mb-1">Category</Label>
                        <Input
                          type="select"
                          value={servicePickerCategoryId}
                          onChange={(event) =>
                            setServicePickerCategoryId(event.target.value)
                          }
                        >
                          <option value="">All services</option>
                          {servicePickerCategories.map((category) => (
                            <option key={category.id} value={category.id}>
                              {category.name}
                            </option>
                          ))}
                        </Input>
                      </Col>
                     
                      <Col md="4">
                        <Label className="mb-1">Staff</Label>
                        <Input
                          type="select"
                          value={servicePickerStaffId}
                          onChange={(event) =>
                            setServicePickerStaffId(event.target.value)
                          }
                        >
                          <option value="">Assign later</option>
                          {refs.staff.map((member) => (
                            <option key={member.id} value={member.id}>
                              {member.name} - {member.jobRole}
                            </option>
                          ))}
                        </Input>
                      </Col>
                    </Row>
                    <div
                      className="border rounded"
                      style={{ maxHeight: 380, overflowY: "auto" }}
                    >
                      {servicePickerVisibleServices.length === 0 ? (
                        <div className="text-soft text-center py-4">
                          No services match this search
                        </div>
                      ) : (
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns:
                              "repeat(auto-fit, minmax(280px, 1fr))",
                          }}
                        >
                          {servicePickerVisibleServices.map((service) => (
                            <div key={service.id} style={{ minWidth: 0 }}>
                              <button
                                type="button"
                                className="btn d-flex align-items-center justify-content-between gap-2 px-3 py-2 border-bottom mb-0 h-100 w-100 text-start bg-transparent"
                                style={{ cursor: "pointer", minWidth: 0 }}
                                disabled={working}
                                onClick={() => addServiceFromPicker(service.id)}
                              >
                                <span
                                  className="text-truncate"
                                  style={{ minWidth: 0 }}
                                >
                                  <span className="d-block text-truncate">
                                    {service.name}
                                  </span>
                                  <small className="text-soft">
                                    {service.mainService?.name ||
                                      service.mainServiceName ||
                                      "Other"}{" "}
                                    - {formatMoney(service.price)}
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
                    <div className="d-flex justify-content-between align-items-center mt-3">
                      <span className="text-soft">
                        {standaloneServiceItems.length} in cart
                      </span>
                      <Button
                        color="primary"
                        type="button"
                        onClick={() => setServicePickerOpen(false)}
                      >
                        Done
                      </Button>
                    </div>
                  </ModalBody>
                </Modal>
                <Modal
                  isOpen={packagePickerOpen}
                  toggle={() => setPackagePickerOpen(false)}
                  centered
                  size="xl"
                  contentClassName="border-0"
                >
                  <ModalHeader toggle={() => setPackagePickerOpen(false)}>
                    Add Packages
                  </ModalHeader>
                  <ModalBody>
                    <Row className="g-3 mb-3">
                      <Col md="4">
                        <Label className="mb-1">Category</Label>
                        <Input
                          type="select"
                          value={packagePickerCategoryId}
                          onChange={(event) =>
                            setPackagePickerCategoryId(event.target.value)
                          }
                        >
                          <option value="">All packages</option>
                          {packagePickerCategories.map((category) => (
                            <option key={category.id} value={category.id}>
                              {category.name}
                            </option>
                          ))}
                        </Input>
                      </Col>
                      <Col md="4">
                        <Label className="mb-1">Search</Label>
                        <Input
                          type="search"
                          placeholder="Search packages"
                          value={packagePickerSearch}
                          onChange={(event) =>
                            setPackagePickerSearch(event.target.value)
                          }
                        />
                      </Col>
                      <Col md="4">
                        <Label className="mb-1">Sold by</Label>
                        <Input
                          type="select"
                          value={packageStaffId}
                          onChange={(event) =>
                            setPackageStaffId(event.target.value)
                          }
                        >
                          <option value="">Not recorded</option>
                          {refs.staff.map((member) => (
                            <option key={member.id} value={member.id}>
                              {member.name}
                            </option>
                          ))}
                        </Input>
                      </Col>
                    </Row>
                    <div
                      className="border rounded"
                      style={{ maxHeight: 380, overflowY: "auto" }}
                    >
                      {packagePickerVisiblePackages.length === 0 ? (
                        <div className="text-soft text-center py-4">
                          {refs.packages?.length
                            ? "No packages match this search"
                            : "No packages yet - create one from the Packages page"}
                        </div>
                      ) : (
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns:
                              "repeat(auto-fit, minmax(280px, 1fr))",
                          }}
                        >
                          {packagePickerVisiblePackages.map(
                            (servicePackage) => (
                              <div
                                key={servicePackage.id}
                                style={{ minWidth: 0 }}
                              >
                                <button
                                  type="button"
                                  className="btn d-flex align-items-center justify-content-between gap-2 px-3 py-2 border-bottom mb-0 h-100 w-100 text-start bg-transparent"
                                  style={{ cursor: "pointer", minWidth: 0 }}
                                  disabled={working}
                                  onClick={() =>
                                    addPackageFromPicker(servicePackage.id)
                                  }
                                >
                                  <span
                                    className="text-truncate"
                                    style={{ minWidth: 0 }}
                                  >
                                    <span className="d-block text-truncate">
                                      {servicePackage.name}
                                    </span>
                                    <small className="text-soft">
                                      {formatMoney(
                                        servicePackage.specialPrice
                                      )}{" "}
                                      - {servicePackage.validityDays || 0} days
                                      validity
                                    </small>
                                  </span>
                                  <Icon
                                    name="plus-circle"
                                    className="text-primary flex-shrink-0"
                                  />
                                </button>
                              </div>
                            )
                          )}
                        </div>
                      )}
                    </div>
                    <div className="d-flex justify-content-between align-items-center mt-3">
                      <span className="text-soft">{packagesInCart} in cart</span>
                      <Button
                        color="primary"
                        type="button"
                        onClick={() => setPackagePickerOpen(false)}
                      >
                        Done
                      </Button>
                    </div>
                  </ModalBody>
                </Modal>
                <Modal
                  isOpen={membershipPickerOpen}
                  toggle={() => setMembershipPickerOpen(false)}
                  centered
                  size="lg"
                  contentClassName="border-0"
                >
                  <ModalHeader toggle={() => setMembershipPickerOpen(false)}>
                    Sell a Membership
                  </ModalHeader>
                  <ModalBody>
                    <Row className="g-3 mb-3">
                      <Col md="6">
                        <Label className="mb-1">Search</Label>
                        <Input
                          type="search"
                          placeholder="Search membership plans"
                          value={membershipPickerSearch}
                          onChange={(event) =>
                            setMembershipPickerSearch(event.target.value)
                          }
                        />
                      </Col>
                      <Col md="6">
                        <Label className="mb-1">Sold by</Label>
                        <Input
                          type="select"
                          value={membershipStaffId}
                          onChange={(event) =>
                            setMembershipStaffId(event.target.value)
                          }
                        >
                          <option value="">Not recorded</option>
                          {refs.staff.map((member) => (
                            <option key={member.id} value={member.id}>
                              {member.name}
                            </option>
                          ))}
                        </Input>
                      </Col>
                    </Row>
                    <div
                      className="border rounded"
                      style={{ maxHeight: 380, overflowY: "auto" }}
                    >
                      {membershipPickerVisiblePlans.length === 0 ? (
                        <div className="text-soft text-center py-4">
                          {refs.memberships?.length
                            ? "No plans match this search"
                            : "No membership plans yet - add one under Customer Retention > Manage Memberships"}
                        </div>
                      ) : (
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns:
                              "repeat(auto-fit, minmax(280px, 1fr))",
                          }}
                        >
                          {membershipPickerVisiblePlans.map((plan) => (
                            <div key={plan.id} style={{ minWidth: 0 }}>
                              <button
                                type="button"
                                className="btn d-flex align-items-center justify-content-between gap-2 px-3 py-2 border-bottom mb-0 h-100 w-100 text-start bg-transparent"
                                style={{ cursor: "pointer", minWidth: 0 }}
                                disabled={working}
                                onClick={() => addMembershipFromPicker(plan.id)}
                              >
                                <span
                                  className="text-truncate"
                                  style={{ minWidth: 0 }}
                                >
                                  <span className="d-block text-truncate">
                                    {plan.name}
                                  </span>
                                  <small className="text-soft">
                                    {formatMoney(plan.price)} -{" "}
                                    {Number(plan.discountPercentage || 0)}% off
                                    {plan.durationMonths
                                      ? ` - ${plan.durationMonths} months`
                                      : " - no expiry"}
                                    {Number(plan.walletCreditAmount) > 0
                                      ? ` - ${formatMoney(
                                          plan.walletCreditAmount
                                        )} wallet`
                                      : ""}
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
                    <p className="text-soft small mt-3 mb-0">
                      One plan per bill. It is billed with tax and starts when
                      the cart is confirmed.
                    </p>
                  </ModalBody>
                </Modal>
                {/* {active && (
                  <div className="row g-2 mb-4">
                    <div className="col-md-10">
                      <Select
                        className="react-select-container"
                        classNamePrefix="react-select"
                        options={productOptions}
                        value={
                          productOptions.find(
                            (option) => option.value === productId
                          ) || null
                        }
                        isClearable
                        isDisabled={working}
                        placeholder="Search a product by name or SKU"
                        noOptionsMessage={() => "No products match"}
                        onChange={(option) => setProductId(option?.value || "")}
                      />
                    </div>
                    <div className="col-md-2 d-grid">
                      <Button
                        color="primary"
                        outline
                        disabled={!productId || working}
                        onClick={() =>
                          run(async () => {
                            await salonApi.jobCarts.addItem(id, {
                              itemType: "PRODUCT",
                              productId,
                              quantity: 1,
                            });
                            setProductId("");
                          })
                        }
                      >
                        + Product
                      </Button>
                    </div>
                  </div>
                )} */}
                <div className="table-responsive">
                  <table className="table table-tranx">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>Duration</th>
                        <th className="text-end">Price</th>
                        {active && <th className="text-end">Action</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {cart.items.length ? (
                        cart.items.map((item) => (
                          <tr key={item.id}>
                            <td>
                              {item.serviceName}
                              {item.itemType === "SERVICE" &&
                                item.staff?.name && (
                                  <span className="small text-primary">
                                    {" "}
                                    - {item.staff.name}
                                  </span>
                                )}
                              {item.itemType === "PACKAGE" && (
                                <div className="small text-primary">
                                  Package
                                  {item.soldByStaff?.name
                                    ? ` • Sold by ${item.soldByStaff.name}`
                                    : ""}
                                </div>
                              )}
                              {item.itemType === "PRODUCT" && (
                                <div className="small text-info">
                                  Product x{item.quantity}
                                  {item.soldByStaff?.name
                                    ? ` • Sold by ${item.soldByStaff.name}`
                                    : ""}
                                  <span className="text-soft">
                                    {" "}
                                    • not covered by membership
                                  </span>
                                </div>
                              )}
                              {item.itemType === "MEMBERSHIP" && (
                                <div className="small text-success">
                                  Membership
                                  {item.membership?.durationMonths
                                    ? ` • ${item.membership.durationMonths} months`
                                    : ""}
                                  {item.soldByStaff?.name
                                    ? ` • Sold by ${item.soldByStaff.name}`
                                    : ""}
                                  <span className="text-soft">
                                    {" "}
                                    • starts when the bill is confirmed
                                  </span>
                                </div>
                              )}
                            </td>
                            <td>
                              {item.itemType === "PACKAGE"
                                ? `${item.package?.validityDays || 0} days validity`
                                : item.itemType === "PRODUCT" ||
                                    item.itemType === "MEMBERSHIP"
                                  ? "-"
                                  : `${item.durationValue || 0} ${(
                                      item.durationUnit || "MINUTES"
                                    ).toLowerCase()}`}
                            </td>
                            <td className="text-end">
                              {active && item.itemType === "SERVICE" ? (
                                <Input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  bsSize="sm"
                                  className="text-end ms-auto"
                                  style={{ maxWidth: 120 }}
                                  disabled={working}
                                  value={
                                    priceDrafts[item.id] ??
                                    String(item.price ?? "")
                                  }
                                  onChange={(event) =>
                                    setPriceDrafts((current) => ({
                                      ...current,
                                      [item.id]: event.target.value,
                                    }))
                                  }
                                  onBlur={() => savePriceDraft(item)}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                      event.target.blur();
                                    }
                                  }}
                                />
                              ) : (
                                <>
                                  {formatMoney(
                                    item.itemType === "PRODUCT"
                                      ? item.lineTotal
                                      : item.price
                                  )}
                                  {item.itemType === "PRODUCT" &&
                                  item.quantity > 1 ? (
                                    <div className="small text-soft">
                                      {item.quantity} x {formatMoney(item.price)}
                                    </div>
                                  ) : null}
                                </>
                              )}
                            </td>
                            {active && (
                              <td className="text-end">
                                <Button
                                  color="danger"
                                  outline
                                  size="sm"
                                  disabled={working}
                                  onClick={() =>
                                    run(() =>
                                      salonApi.jobCarts.removeItem(id, item.id)
                                    )
                                  }
                                >
                                  Remove
                                </Button>
                              </td>
                            )}
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td
                            colSpan={active ? 4 : 3}
                            className="text-center text-soft py-4"
                          >
                            No services or packages added yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="border-top mt-3 pt-3">
                  <div className="d-flex justify-content-between py-1">
                    <span className="text-soft">Subtotal</span>
                    <span>{formatMoney(subtotalAmount)}</span>
                  </div>
                  {discountTotal > 0 && (
                    <div className="d-flex justify-content-between py-1">
                      <span className="text-soft">Discount</span>
                      <span>-{formatMoney(discountTotal)}</span>
                    </div>
                  )}
                  <div className="d-flex justify-content-between py-1">
                    <span className="text-soft">Tax</span>
                    <span>{formatMoney(taxAmount)}</span>
                  </div>
                  {Math.abs(roundOffAmount) >= 0.005 && (
                    <div className="d-flex justify-content-between py-1">
                      <span className="text-soft">Round off</span>
                      <span>
                        {roundOffAmount > 0 ? "+" : "-"}
                        {formatMoney(Math.abs(roundOffAmount))}
                      </span>
                    </div>
                  )}
                  <div className="d-flex justify-content-between py-2 border-top mt-1 fw-bold">
                    <span>Payable</span>
                    <span>{formatMoney(payableAmount)}</span>
                  </div>
                </div>
                {(cart.packageRedemptions || []).length > 0 && (
                  <div className="mt-4">
                    <h6>Package-covered Services</h6>
                    {(cart.packageRedemptions || []).map((usage) => (
                      <div
                        key={usage.id}
                        className="border rounded p-3 mb-2"
                      >
                        <div className="d-flex justify-content-between gap-2">
                          <div>
                            <strong>
                              {usage.customerPackage?.packageNameSnapshot}
                            </strong>
                            <div className="small text-soft">
                              {usage.status}
                              {usage.customerPackage
                                ?.maxRedemptionsSnapshot != null
                                ? " | " +
                                  (usage.customerPackage.usedRedemptions || 0) +
                                  " of " +
                                  usage.customerPackage
                                    .maxRedemptionsSnapshot +
                                  " visits used, " +
                                  Math.max(
                                    usage.customerPackage
                                      .maxRedemptionsSnapshot -
                                      (usage.customerPackage
                                        .usedRedemptions || 0) -
                                      (usage.customerPackage
                                        .reservedRedemptions || 0),
                                    0
                                  ) +
                                  " left"
                                : ""}
                            </div>
                          </div>
                          {active && usage.status === "RESERVED" && (
                            <Button
                              color="danger"
                              outline
                              size="sm"
                              disabled={working}
                              onClick={() =>
                                run(() =>
                                  salonApi.jobCarts.removeRedemption(
                                    id,
                                    usage.id
                                  )
                                )
                              }
                            >
                              Remove
                            </Button>
                          )}
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
          </Col>

          <Col lg="4">
            {customerSummary && (
              <div className="card card-bordered mb-4">
                <div className="card-inner">
                  <h5>Customer Insight</h5>
                  <Row className="g-2 small">
                    <Col xs="6">
                      <span className="text-soft">Last visit</span>
                      <div>{formatDate(customerSummary.lastVisitDate)}</div>
                    </Col>
                    <Col xs="6">
                      <span className="text-soft">Total visits</span>
                      <div>{customerSummary.totalVisits}</div>
                    </Col>
                    <Col xs="6">
                      <span className="text-soft">Loyalty points</span>
                      <div>{customerSummary.loyaltyPoints}</div>
                    </Col>
                    <Col xs="6">
                      <span className="text-soft">Wallet</span>
                      <div>{formatMoney(customerSummary.walletBalance)}</div>
                    </Col>
                    <Col xs="6">
                      <span className="text-soft">Outstanding</span>
                      <div>
                        {formatMoney(customerSummary.outstandingBalance)}
                      </div>
                    </Col>
                    <Col xs="6">
                      <span className="text-soft">Membership</span>
                      <div>
                        {customerSummary.membershipName || "None"}
                        {customerSummary.membershipExpiresAt
                          ? `, Expire on ${formatDate(
                              customerSummary.membershipExpiresAt
                            )}`
                          : ""}
                        {customerSummary.membershipStatus &&
                        customerSummary.membershipStatus !== "ACTIVE"
                          ? ` (${customerSummary.membershipStatus})`
                          : ""}
                      </div>
                    </Col>
                  </Row>
                  <hr />
                  <div className="small mb-2">
                    <span className="text-soft">Preferred staff: </span>
                    {customerSummary.preferredStaff?.staffName || "Not known"}
                  </div>
                  <h6>Active Packages</h6>
                  {customerSummary.activePackages?.length ? (
                    customerSummary.activePackages.map((item) => (
                      <div
                        key={item.customerPackageId}
                        className="small border-bottom py-2"
                      >
                        <strong>{item.packageName}</strong>
                        <br />
                        Valid to {formatDate(item.validUntil)}
                        {item.soldByStaffName
                          ? ` • Sold by ${item.soldByStaffName}`
                          : ""}
                      </div>
                    ))
                  ) : (
                    <p className="small text-soft">No active packages.</p>
                  )}
                  {(customerSummary.activePackages || []).map((item) => (
                    <div
                      key={`${item.customerPackageId}-balances`}
                      className="small mb-3"
                    >
                      {(item.serviceBalances || []).map((balance) => (
                        <div
                          key={balance.balanceId}
                          className="border rounded p-2 mt-1"
                        >
                          <div className="d-flex justify-content-between">
                            <span>{balance.serviceName}</span>
                            <span>
                              {balance.usedQuantity}/{balance.includedQuantity}{" "}
                              used
                            </span>
                          </div>
                          <div className="text-soft">
                            {balance.remainingQuantity} remaining
                            {balance.reservedQuantity
                              ? ` • ${balance.reservedQuantity} reserved`
                              : ""}
                          </div>
                          {active && balance.remainingQuantity > 0 && (
                            <div className="row g-1 mt-1">
                              <div className="col-4">
                                <Input
                                  bsSize="sm"
                                  type="number"
                                  min="0"
                                  max={balance.remainingQuantity}
                                  placeholder="Qty"
                                  value={
                                    redemptionSelections[balance.balanceId]
                                      ?.quantity || ""
                                  }
                                  onChange={(event) =>
                                    setRedemptionValue(
                                      balance.balanceId,
                                      "quantity",
                                      event.target.value
                                    )
                                  }
                                />
                              </div>
                              <div className="col-8">
                                <Input
                                  bsSize="sm"
                                  type="select"
                                  value={
                                    redemptionSelections[balance.balanceId]
                                      ?.staffId || ""
                                  }
                                  onChange={(event) =>
                                    setRedemptionValue(
                                      balance.balanceId,
                                      "staffId",
                                      event.target.value
                                    )
                                  }
                                >
                                  <option value="">Staff optional</option>
                                  {refs.staff.map((member) => (
                                    <option key={member.id} value={member.id}>
                                      {member.name}
                                    </option>
                                  ))}
                                </Input>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                      {active &&
                        (item.serviceBalances || []).some(
                          (balance) => balance.remainingQuantity > 0
                        ) && (
                          <Button
                            className="mt-2"
                            size="sm"
                            color="primary"
                            outline
                            disabled={working}
                            onClick={() => redeemPackage(item)}
                          >
                            Redeem {item.packageName}
                          </Button>
                        )}
                    </div>
                  ))}
                  <h6 className="mt-3">Recent Invoices</h6>
                  {(customerSummary.recentInvoices || []).slice(0, 5).map(
                    (recent) => (
                      <Link
                        key={recent.invoiceId}
                        className="d-flex justify-content-between small py-1"
                        to={`/billing/invoices/${recent.invoiceId}`}
                      >
                        <span>{recent.invoiceCode}</span>
                        <span>{formatMoney(recent.totalAmount)}</span>
                      </Link>
                    )
                  )}
                  {customerSummary.recentInvoices?.length > 5 && (
                    <Link className="small d-inline-block mt-2" to="/billing">
                      View More Invoices
                    </Link>
                  )}
                </div>
              </div>
            )}
            <div className="card card-bordered mb-4">
              <div className="card-inner">
                <h5>Invoice Summary</h5>
                <div className="d-flex justify-content-between py-2 border-bottom">
                  <span>Paid services / packages</span>
                  <strong>{formatMoney(invoice?.subtotalAmount)}</strong>
                </div>
                <div className="d-flex justify-content-between py-2 border-bottom">
                  <span>Package-covered services</span>
                  <strong>{formatMoney(packageCoveredAmount)}</strong>
                </div>
                <div className="d-flex justify-content-between py-2 border-bottom">
                  <span>Membership / discount</span>
                  <strong>-{formatMoney(discountTotal)}</strong>
                </div>
                <div className="d-flex justify-content-between py-2 border-bottom">
                  <span>Processing fee</span>
                  <strong>{formatMoney(processingFee)}</strong>
                </div>
                <div className="d-flex justify-content-between py-2 border-bottom">
                  <span>
                    Tax
                    {Number(invoice?.serviceGstAmount || 0) > 0 ||
                    Number(invoice?.productGstAmount || 0) > 0 ? (
                      <span className="text-soft small d-block">
                        Service {formatMoney(invoice?.serviceGstAmount)} |
                        Product {formatMoney(invoice?.productGstAmount)}
                      </span>
                    ) : null}
                  </span>
                  <strong>{formatMoney(taxAmount)}</strong>
                </div>
                <div className="d-flex justify-content-between py-2 border-bottom">
                  <span>Coupon</span>
                  <strong>
                    -{formatMoney(invoice?.couponDiscountAmount)}
                  </strong>
                </div>
                {Math.abs(roundOffAmount) >= 0.005 && (
                  <div className="d-flex justify-content-between py-2 border-bottom">
                    <span>Round off</span>
                    <strong>
                      {roundOffAmount > 0 ? "+" : "-"}
                      {formatMoney(Math.abs(roundOffAmount))}
                    </strong>
                  </div>
                )}
                <div className="d-flex justify-content-between py-3 fs-5">
                  <span>Payable amount</span>
                  <strong>{formatMoney(payableAmount)}</strong>
                </div>
                <div className="small text-soft mb-3">
                  Membership: {cart.customer?.membership?.name || "None"}
                  <br />
                  Wallet: {formatMoney(cart.customer?.walletBalance)}
                  <br />
                  Loyalty points: {cart.customer?.loyaltyPoints || 0}
                </div>

                {active && (
                  <div className="border rounded p-3 mb-4">
                    <Row className="g-2">
                      <Col md="6">
                        <Label className="form-label">Invoice type</Label>
                        <Input
                          type="select"
                          value={billingForm.invoiceType}
                          onChange={(event) =>
                            setBillingForm((current) => ({
                              ...current,
                              invoiceType: event.target.value,
                            }))
                          }
                        >
                          <option value="BILL_OF_SUPPLY">Bill of supply</option>
                          <option value="GST_INVOICE">GST invoice</option>
                        </Input>
                      </Col>
                      <Col md="6">
                        <Label className="form-label">Initial status</Label>
                        <Input
                          type="select"
                          value={billingForm.status}
                          onChange={(event) =>
                            setBillingForm((current) => ({
                              ...current,
                              status: event.target.value,
                            }))
                          }
                        >
                          <option value="DRAFT">Draft (apply coupon before issuing)</option>
                          <option value="ISSUED">Issue immediately</option>
                        </Input>
                      </Col>
                      <Col md="4">
                        <Label className="form-label">Discount</Label>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={billingForm.discountAmount}
                          onChange={(event) =>
                            setBillingForm((current) => ({
                              ...current,
                              discountAmount: event.target.value,
                            }))
                          }
                        />
                      </Col>
                      <Col md="4">
                        <Label className="form-label">Processing fee</Label>
                        <Input
                          type="number"
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
                      <Col md="4">
                        <Label className="form-label">Tax</Label>
                        <Input
                          type="select"
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
                      <Col xs="12">
                        <Label className="form-label">Billing note</Label>
                        <Input
                          type="textarea"
                          rows="3"
                          value={billingForm.billingNote}
                          onChange={(event) =>
                            setBillingForm((current) => ({
                              ...current,
                              billingNote: event.target.value,
                            }))
                          }
                        />
                        {membershipDiscount > 0 && (
                          <small className="text-soft">
                            Membership discount included: {formatMoney(membershipDiscount)}
                          </small>
                        )}
                      </Col>
                    </Row>
                  </div>
                )}

                {active && billingForm.status !== "DRAFT" && (
                  <div className="mb-4">
                    <h6 className="title mb-2">Payment</h6>
                    <FormGroup check className="mb-2">
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
                    {paymentForm.collect && (
                      <>
                        {tenders.map((tender, index) => (
                          <Row className="g-2 mb-2" key={index}>
                            <Col md="5">
                              {index === 0 && (
                                <Label className="form-label">Method</Label>
                              )}
                              <Input
                                type="select"
                                value={tender.method}
                                onChange={(event) =>
                                  setTenders((current) =>
                                    current.map((row, rowIndex) =>
                                      rowIndex === index
                                        ? { ...row, method: event.target.value }
                                        : row
                                    )
                                  )
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
                                    {option.value === "MEMBERSHIP_WALLET"
                                      ? " (" +
                                        formatMoney(membershipWalletBalance) +
                                        " available)"
                                      : ""}
                                  </option>
                                ))}
                              </Input>
                            </Col>
                            <Col md="4">
                              {index === 0 && (
                                <Label className="form-label">Amount</Label>
                              )}
                              <Input
                                type="number"
                                min="0"
                                step="0.01"
                                placeholder={
                                  index === 0 && tenders.length === 1
                                    ? formatMoney(payableAmount)
                                    : "0.00"
                                }
                                value={tender.amount}
                                onChange={(event) =>
                                  setTenders((current) =>
                                    current.map((row, rowIndex) =>
                                      rowIndex === index
                                        ? { ...row, amount: event.target.value }
                                        : row
                                    )
                                  )
                                }
                              />
                            </Col>
                            <Col md="3">
                              {index === 0 && (
                                <Label className="form-label">Reference</Label>
                              )}
                              <div className="d-flex gap-1">
                                <Input
                                  value={tender.referenceNo}
                                  onChange={(event) =>
                                    setTenders((current) =>
                                      current.map((row, rowIndex) =>
                                        rowIndex === index
                                          ? {
                                              ...row,
                                              referenceNo: event.target.value,
                                            }
                                          : row
                                      )
                                    )
                                  }
                                />
                                {tenders.length > 1 && (
                                  <Button
                                    color="danger"
                                    outline
                                    size="sm"
                                    onClick={() =>
                                      setTenders((current) =>
                                        current.filter(
                                          (_row, rowIndex) => rowIndex !== index
                                        )
                                      )
                                    }
                                  >
                                    <Icon name="cross" />
                                  </Button>
                                )}
                              </div>
                            </Col>
                          </Row>
                        ))}
                        {tenders.length < 5 && (
                          <Button
                            color="primary"
                            outline
                            size="sm"
                            className="mb-2"
                            onClick={() =>
                              setTenders((current) => [
                                ...current,
                                {
                                  method: "CASH",
                                  amount: outstandingAfter
                                    ? outstandingAfter.toFixed(2)
                                    : "",
                                  referenceNo: "",
                                },
                              ])
                            }
                          >
                            <Icon name="plus" /> Split payment
                          </Button>
                        )}
                        {walletShort ? (
                          <Alert color="warning" className="py-2 mb-0">
                            Wallet has {formatMoney(membershipWalletBalance)}.
                            Reduce this tender and add another method for the
                            rest.
                          </Alert>
                        ) : overpaying ? (
                          <Alert color="danger" className="py-2 mb-0">
                            Collecting {formatMoney(collectedAmount)} exceeds
                            the {formatMoney(payableAmount)} payable.
                          </Alert>
                        ) : (
                          <small className="text-soft">
                            {outstandingAfter > 0.004
                              ? "Part payment. " +
                                formatMoney(outstandingAfter) +
                                " stays outstanding and the bill is marked partially paid."
                              : "Invoice will be issued and marked paid."}
                          </small>
                        )}
                      </>
                    )}
                  </div>
                )}

                {active && canApplyCoupon && (
                  <div className="mb-4">
                    <Label>Coupon</Label>
                    {!invoice?.couponId ? (
                      <div className="d-flex gap-2">
                        <Input
                          placeholder="Coupon code"
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
                              salonApi.invoices.applyCoupon(
                                invoice.id,
                                couponCode
                              )
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
                          run(() =>
                            salonApi.invoices.removeCoupon(invoice.id)
                          )
                        }
                      >
                        Remove {invoice.couponCodeSnapshot}
                      </Button>
                    )}
                  </div>
                )}

                {active ? (
                  <div className="d-grid gap-2">
                    <Button
                      color="success"
                      disabled={working || !cart.items.length}
                      onClick={() => setConfirmOpen(true)}
                    >
                      {working && <Spinner size="sm" className="me-1" />}
                      Confirm Job Cart
                    </Button>
                    <Button
                      color="danger"
                      outline
                      disabled={working}
                      onClick={cancel}
                    >
                      Cancel Job Cart
                    </Button>
                  </div>
                ) : invoice ? (
                  <>
                    {cart.status !== "CANCELLED" && (
                      <div className="mb-3">
                        <div className="d-flex justify-content-between">
                          <span className="text-soft">Paid</span>
                          <span>{formatMoney(invoice.paidAmount)}</span>
                        </div>
                        <div className="d-flex justify-content-between">
                          <span className="text-soft">Balance</span>
                          <span>{formatMoney(invoice.balanceAmount)}</span>
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
                            )?.label || payment.method}
                            {payment.method === "MEMBERSHIP_WALLET" &&
                            (cart.customer?.membership?.name ||
                              customerSummary?.membershipName)
                              ? " (" +
                                (cart.customer?.membership?.name ||
                                  customerSummary?.membershipName) +
                                ")"
                              : ""}{" "}
                            on {formatDate(payment.paidAt)}
                            {payment.referenceNo
                              ? ` (${payment.referenceNo})`
                              : ""}
                          </small>
                        ))}
                      </div>
                    )}
                    {canOpenInvoice ? (
                      <Link to={`/billing/invoices/${invoice.id}`}>
                        <Button color="primary" block>
                          {cart.status === "CANCELLED"
                            ? "Open Invoice"
                            : invoice.paymentStatus === "PAID"
                              ? "Open Invoice"
                              : "Open Invoice / Payment"}
                        </Button>
                      </Link>
                    ) : (
                      <p className="text-soft small mb-0">
                        Invoice issued. Payment access follows the existing
                        billing role policy.
                      </p>
                    )}
                  </>
                ) : null}
              </div>
            </div>
          </Col>
        </Row>
      ) : null}
      <Modal
        isOpen={confirmOpen}
        toggle={() => setConfirmOpen(false)}
        size="md"
      >
        <ModalHeader toggle={() => setConfirmOpen(false)}>
          End job and bill?
        </ModalHeader>
        <ModalBody>
          <p className="text-soft">
            This completes the appointment, deducts service consumables and
            issues the invoice. It cannot be undone from this page.
          </p>
          <div className="border rounded p-3 mb-3">
            <div className="d-flex justify-content-between py-1">
              <span className="text-soft">Subtotal</span>
              <span>{formatMoney(subtotalAmount)}</span>
            </div>
            {discountTotal > 0 && (
              <div className="d-flex justify-content-between py-1">
                <span className="text-soft">Discount</span>
                <span>-{formatMoney(discountTotal)}</span>
              </div>
            )}
            <div className="d-flex justify-content-between py-1">
              <span className="text-soft">Tax</span>
              <span>{formatMoney(taxAmount)}</span>
            </div>
            {Math.abs(roundOffAmount) >= 0.005 && (
              <div className="d-flex justify-content-between py-1">
                <span className="text-soft">Round off</span>
                <span>
                  {roundOffAmount > 0 ? "+" : "-"}
                  {formatMoney(Math.abs(roundOffAmount))}
                </span>
              </div>
            )}
            <div className="d-flex justify-content-between py-2 border-top mt-1 fw-bold">
              <span>Payable</span>
              <span>{formatMoney(payableAmount)}</span>
            </div>
          </div>
          {collecting && activeTenders.length ? (
            <div className="mb-3">
              <h6 className="mb-2">Collecting</h6>
              {activeTenders.map((tender, index) => (
                <div
                  key={index}
                  className="d-flex justify-content-between py-1"
                >
                  <span className="text-soft">
                    {PAYMENT_METHODS.find(
                      (option) => option.value === tender.method
                    )?.label || tender.method}
                    {tender.method === "MEMBERSHIP_WALLET" &&
                    customerSummary?.membershipName
                      ? " - " + customerSummary.membershipName
                      : ""}
                  </span>
                  <span>
                    {formatMoney(
                      singleFullTender ? payableAmount : Number(tender.amount || 0)
                    )}
                  </span>
                </div>
              ))}
              {outstandingAfter > 0.004 && (
                <div className="d-flex justify-content-between py-1 text-warning">
                  <span>Outstanding after payment</span>
                  <span>{formatMoney(outstandingAfter)}</span>
                </div>
              )}
            </div>
          ) : (
            <Alert color="light" className="py-2">
              No payment is being collected now. The bill will be left unpaid.
            </Alert>
          )}
          <div className="d-flex gap-2 justify-content-end">
            <Button
              color="light"
              onClick={() => setConfirmOpen(false)}
              disabled={working}
            >
              Keep job open
            </Button>
            <Button
              color="success"
              onClick={confirm}
              disabled={working || overpaying || walletShort}
            >
              {working && <Spinner size="sm" className="me-1" />}
              End job and bill
            </Button>
          </div>
        </ModalBody>
      </Modal>
    </PageShell>
  );
};

export default JobCartDetails;
