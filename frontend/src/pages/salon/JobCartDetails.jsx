/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import Select from "react-select";
import {
  Alert,
  Col,
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
  const [serviceId, setServiceId] = useState("");
  const [packageId, setPackageId] = useState("");
  const [packageStaffId, setPackageStaffId] = useState("");
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
        status: next.invoice?.status === "DRAFT" ? "DRAFT" : "ISSUED",
        discountAmount: 0,
        processingFeeAmount: Number(next.invoice?.processingFeeAmount || 0),
        taxPercent: Number(next.invoice?.items?.[0]?.taxPercent || 0),
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

  const availableServices = useMemo(() => {
    const existing = new Set(
      (cart?.items || [])
        .filter((item) => item.itemType !== "PACKAGE")
        .map((item) => item.serviceId)
    );
    return refs.services.filter((service) => !existing.has(service.id));
  }, [cart?.items, refs.services]);
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

  const confirm = () => {
    if (
      !window.confirm(
        "Confirm this job cart? This completes the appointment, deducts service consumables and finalizes the invoice."
      )
    ) {
      return;
    }
    run(() =>
      salonApi.jobCarts.confirm(id, {
        ...billingForm,
        discountAmount: Number(billingForm.discountAmount || 0),
        processingFeeAmount: Number(billingForm.processingFeeAmount || 0),
        taxPercent: Number(billingForm.taxPercent || 0),
        billingNote: billingForm.billingNote || null,
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
  const membershipDiscount = active
    ? Math.min(
        subtotalAmount * (membershipPercent / 100),
        Math.max(subtotalAmount - manualDiscount, 0)
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
  const payableAmount = active
    ? taxableAmount + processingFee + taxAmount
    : Number(invoice?.totalAmount || 0);
  const packageCoveredAmount = (cart?.packageRedemptions || [])
    .filter((usage) => usage.status !== "CANCELLED")
    .flatMap((usage) => usage.items || [])
    .reduce(
      (total, item) =>
        total + Number(item.priceSnapshot || 0) * Number(item.quantity || 0),
      0
    );

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
      {loading && !cart ? (
        <div className="text-center py-5">
          <Spinner color="primary" />
        </div>
      ) : cart ? (
        <Row className="g-4">
          <Col lg="8">
            <div className="card card-bordered mb-4">
              <div className="card-inner">
                <div className="d-flex justify-content-between align-items-center mb-4">
                  <h5 className="mb-0">Customer & Schedule</h5>
                  <span className="text-soft">
                    {cart.branch?.name || "No branch"}
                  </span>
                </div>
                <Row>
                  <Col md="6">
                    <FormGroup>
                      <Label>Customer Name</Label>
                      <Input
                        disabled={!active}
                        value={form.customerName}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            customerName: event.target.value,
                          }))
                        }
                      />
                    </FormGroup>
                  </Col>
                  <Col md="6">
                    <FormGroup>
                      <Label>Phone Number</Label>
                      <Input
                        disabled={!active}
                        value={form.phone}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            phone: event.target.value,
                          }))
                        }
                      />
                    </FormGroup>
                  </Col>
                </Row>
                <Row>
                  <Col md="6">
                    <FormGroup>
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
                  <Col md="6">
                    <FormGroup>
                      <Label>Staff (optional)</Label>
                      <Input
                        type="select"
                        disabled={!active}
                        value={form.staffId}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            staffId: event.target.value,
                          }))
                        }
                      >
                        <option value="">Unassigned</option>
                        {refs.staff.map((member) => (
                          <option key={member.id} value={member.id}>
                            {member.name} — {member.jobRole}
                          </option>
                        ))}
                      </Input>
                    </FormGroup>
                  </Col>
                </Row>
                <FormGroup>
                  <Label>Note</Label>
                  <Input
                    type="textarea"
                    rows="2"
                    disabled={!active}
                    value={form.bookingNote}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        bookingNote: event.target.value,
                      }))
                    }
                  />
                </FormGroup>
                {active && (
                  <Button color="primary" outline disabled={working} onClick={save}>
                    Save Details
                  </Button>
                )}
              </div>
            </div>

            <div className="card card-bordered">
              <div className="card-inner">
                <h5>Services & Packages</h5>
                {active && standaloneServiceItems.length > 0 && (
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
                )}
                {active && (
                  <div className="d-flex gap-2 mb-4 h-50">
                    <div className="flex-grow-1">
                      <Select
                        className="react-select-container"
                        classNamePrefix="react-select"
                        isClearable
                        options={availableServices.map((service) => ({
                          value: service.id,
                          label: `${service.name} - ${formatMoney(
                            service.price
                          )}`,
                        }))}
                        value={
                          availableServices
                            .filter((service) => service.id === serviceId)
                            .map((service) => ({
                              value: service.id,
                              label: `${service.name} - ${formatMoney(
                                service.price
                              )}`,
                            }))[0] || null
                        }
                        placeholder="Search service"
                        noOptionsMessage={() => "No services"}
                        onChange={(option) => setServiceId(option?.value || "")}
                      />
                    </div>
                    <Input
                      type="select"
                      value={serviceId}
                      onChange={(event) => setServiceId(event.target.value)}
                      className="d-none"
                    >
                      <option value="">Select a service</option>
                      {availableServices.map((service) => (
                        <option key={service.id} value={service.id}>
                          {service.name} — {formatMoney(service.price)}
                        </option>
                      ))}
                    </Input>
                    <Button
                      color="primary"
                      disabled={!serviceId || working}
                      onClick={() =>
                        run(async () => {
                          await salonApi.jobCarts.addItem(id, {
                            itemType: "SERVICE",
                            serviceId,
                          });
                          setServiceId("");
                        })
                      }
                    >
                      Add
                    </Button>
                  </div>
                )}
                {active && (
                  <div className="row g-2 mb-4">
                    <div className="col-md-6">
                      <Input
                        type="select"
                        value={packageId}
                        onChange={(event) => setPackageId(event.target.value)}
                      >
                        <option value="">Select a package</option>
                        {availablePackages.map((servicePackage) => (
                          <option
                            key={servicePackage.id}
                            value={servicePackage.id}
                          >
                            {servicePackage.name} —{" "}
                            {formatMoney(servicePackage.specialPrice)}
                          </option>
                        ))}
                      </Input>
                    </div>
                    <div className="col-md-4">
                      <Input
                        type="select"
                        value={packageStaffId}
                        onChange={(event) =>
                          setPackageStaffId(event.target.value)
                        }
                      >
                        <option value="">Sold by (optional)</option>
                        {refs.staff.map((member) => (
                          <option key={member.id} value={member.id}>
                            {member.name}
                          </option>
                        ))}
                      </Input>
                    </div>
                    <div className="col-md-2 d-grid">
                      <Button
                        color="primary"
                        outline
                        disabled={!packageId || working}
                        onClick={() =>
                          run(async () => {
                            await salonApi.jobCarts.addItem(id, {
                              itemType: "PACKAGE",
                              packageId,
                              ...(packageStaffId
                                ? { staffId: packageStaffId }
                                : {}),
                            });
                            setPackageId("");
                            setPackageStaffId("");
                          })
                        }
                      >
                        + Package
                      </Button>
                    </div>
                  </div>
                )}
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
                              {item.itemType === "PACKAGE" && (
                                <div className="small text-primary">
                                  Package
                                  {item.soldByStaff?.name
                                    ? ` • Sold by ${item.soldByStaff.name}`
                                    : ""}
                                </div>
                              )}
                              {item.itemType !== "PACKAGE" && item.staff?.name && (
                                <div className="small text-primary">
                                  Staff: {item.staff.name}
                                </div>
                              )}
                            </td>
                            <td>
                              {item.itemType === "PACKAGE"
                                ? `${item.package?.validityDays || 0} days validity`
                                : `${item.durationValue || 0} ${(
                                    item.durationUnit || "MINUTES"
                                  ).toLowerCase()}`}
                            </td>
                            <td className="text-end">
                              {formatMoney(item.price)}
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
                            <strong>Package covered</strong>
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
                  <span>Tax</span>
                  <strong>{formatMoney(taxAmount)}</strong>
                </div>
                <div className="d-flex justify-content-between py-2 border-bottom">
                  <span>Coupon</span>
                  <strong>
                    -{formatMoney(invoice?.couponDiscountAmount)}
                  </strong>
                </div>
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
                      onClick={confirm}
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
                ) : invoice && canOpenInvoice ? (
                  <Link to={`/billing/invoices/${invoice.id}`}>
                    <Button color="primary" block>
                      {cart.status === "CANCELLED"
                        ? "Open Invoice"
                        : "Open Invoice / Payment"}
                    </Button>
                  </Link>
                ) : invoice ? (
                  <p className="text-soft small mb-0">
                    Invoice issued. Payment access follows the existing billing
                    role policy.
                  </p>
                ) : null}
              </div>
            </div>
          </Col>
        </Row>
      ) : null}
    </PageShell>
  );
};

export default JobCartDetails;
