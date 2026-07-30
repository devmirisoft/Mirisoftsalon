/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import CreatableSelect from "react-select/creatable";
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
import { useAuth } from "@/auth/AuthContext";
import { salonApi } from "@/services/salonApi";
import {
  currentInputTime,
  formatDate,
  formatMoney,
  todayInputDate,
} from "@/utils/salonFormat";

const nowParts = () => {
  return {
    date: todayInputDate(),
    time: currentInputTime(),
  };
};

const JobCartCreate = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const initial = nowParts();
  const [form, setForm] = useState({
    salonId: "",
    branchId: "",
    customerName: "",
    phone: "",
    date: initial.date,
    time: initial.time,
    staffId: "",
    serviceIds: [],
    packageIds: [],
    bookingNote: "",
  });
  const [customPackage, setCustomPackage] = useState({
    serviceIds: [],
    name: "",
    specialPrice: "",
    validityDays: 30,
    usageLimit: 1,
    soldByStaffId: "",
  });
  const [refs, setRefs] = useState({
    salons: [],
    branches: [],
    customers: [],
    staff: [],
    services: [],
    packages: [],
  });
  const [loadingRefs, setLoadingRefs] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [customerSummary, setCustomerSummary] = useState(null);
  const [lookingUp, setLookingUp] = useState(false);

  const loadCustomerSummary = useCallback(async (query, options = {}) => {
    const suppressNotFound = options.suppressNotFound ?? false;
    setLookingUp(true);
    setError("");
    try {
      const response = await salonApi.jobCarts.customerSummary(query);
      setCustomerSummary(response.data);
      if (response.data?.customerName) {
        setForm((current) => ({
          ...current,
          customerName: response.data.customerName,
          phone: response.data.phone || current.phone,
        }));
      }
    } catch (lookupError) {
      setCustomerSummary(null);
      if (!suppressNotFound || lookupError.status !== 404) {
        setError(lookupError.message);
      }
    } finally {
      setLookingUp(false);
    }
  }, []);

  useEffect(() => {
    const phoneDigits = form.phone.replace(/\D/g, "");
    if (phoneDigits.length < 7) {
      setCustomerSummary(null);
      return undefined;
    }
    const timer = window.setTimeout(() => {
      loadCustomerSummary({ phone: form.phone }, { suppressNotFound: true });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [form.phone, loadCustomerSummary]);

  useEffect(() => {
    let active = true;
    setLoadingRefs(true);
    Promise.allSettled([
      salonApi.jobCarts.references({
        ...(form.salonId ? { salonId: form.salonId } : {}),
        ...(form.branchId ? { branchId: form.branchId } : {}),
      }),
      salonApi.customers.list(),
    ])
      .then(([referenceResult, customerResult]) => {
        if (!active) return;
        const referenceData =
          referenceResult.status === "fulfilled"
            ? referenceResult.value.data
            : null;
        setRefs({
          ...(referenceData || {
          salons: [],
          branches: [],
          staff: [],
          services: [],
          packages: [],
          }),
          customers:
            customerResult.status === "fulfilled"
              ? customerResult.value.data || []
              : [],
        });
        if (
          user?.role !== "SUPER_ADMIN" &&
          !form.branchId &&
          referenceData?.branches?.length === 1
        ) {
          setForm((current) => ({
            ...current,
            branchId: referenceData.branches[0].id,
          }));
        }
        if (referenceResult.status === "rejected") {
          setError(referenceResult.reason.message);
        }
      })
      .finally(() => {
        if (active) setLoadingRefs(false);
      });
    return () => {
      active = false;
    };
  }, [form.salonId, form.branchId, user?.role]);

  const customerOptions = useMemo(
    () =>
      refs.customers.map((customer) => ({
        value: customer.id,
        label: `${customer.name}${customer.phone ? ` · ${customer.phone}` : ""}`,
        name: customer.name,
        phone: customer.phone || "",
      })),
    [refs.customers]
  );

  const selectedCustomerOption = useMemo(() => {
    const matched = customerOptions.find(
      (option) =>
        option.name === form.customerName &&
        (!form.phone || option.phone === form.phone)
    );
    if (matched) return matched;
    if (!form.customerName) return null;
    return {
      value: form.customerName,
      label: form.customerName,
      name: form.customerName,
      phone: form.phone,
    };
  }, [customerOptions, form.customerName, form.phone]);

  const selectedServices = useMemo(
    () =>
      refs.services.filter((service) =>
        form.serviceIds.includes(service.id)
      ),
    [refs.services, form.serviceIds]
  );
  const subtotal = selectedServices.reduce(
    (sum, service) => sum + Number(service.price || 0),
    0
  );
  const selectedPackages = useMemo(
    () =>
      (refs.packages || []).filter((servicePackage) =>
        form.packageIds.includes(servicePackage.id)
      ),
    [refs.packages, form.packageIds]
  );
  const packageSubtotal = selectedPackages.reduce(
    (sum, servicePackage) =>
      sum + Number(servicePackage.specialPrice || 0),
    0
  );
  const selectedCustomServices = useMemo(
    () =>
      selectedServices.filter((service) =>
        customPackage.serviceIds.includes(service.id)
      ),
    [customPackage.serviceIds, selectedServices]
  );
  const selectedCustomTotal = selectedCustomServices.reduce(
    (sum, service) => sum + Number(service.price || 0),
    0
  );
  const duration = selectedServices.reduce(
    (sum, service) =>
      sum +
      Number(service.durationValue || 0) *
        (service.durationUnit === "HOURS" ? 60 : 1),
    0
  );
  const selectedPackageServiceIds = useMemo(() => {
    const ids = new Set();
    selectedPackages.forEach((servicePackage) => {
      (servicePackage.items || []).forEach((item) => ids.add(item.serviceId));
    });
    return ids;
  }, [selectedPackages]);

  const togglePackage = (packageId) => {
    setForm((current) => {
      const packageIds = current.packageIds.includes(packageId)
        ? current.packageIds.filter((id) => id !== packageId)
        : [...current.packageIds, packageId];
      const coveredServices = new Set();
      (refs.packages || [])
        .filter((servicePackage) => packageIds.includes(servicePackage.id))
        .forEach((servicePackage) => {
          (servicePackage.items || []).forEach((item) =>
            coveredServices.add(item.serviceId)
          );
        });
      return {
        ...current,
        packageIds,
        serviceIds: current.serviceIds.filter(
          (serviceId) => !coveredServices.has(serviceId)
        ),
      };
    });
  };

  const toggleService = (serviceId) => {
    if (selectedPackageServiceIds.has(serviceId)) return;
    setForm((current) => ({
      ...current,
      serviceIds: current.serviceIds.includes(serviceId)
        ? current.serviceIds.filter((id) => id !== serviceId)
        : [...current.serviceIds, serviceId],
    }));
    setCustomPackage((current) => ({
      ...current,
      serviceIds: current.serviceIds.filter((id) => id !== serviceId),
    }));
  };

  const toggleCustomPackageService = (serviceId) =>
    setCustomPackage((current) => ({
      ...current,
      serviceIds: current.serviceIds.includes(serviceId)
        ? current.serviceIds.filter((id) => id !== serviceId)
        : [...current.serviceIds, serviceId],
    }));

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const startTime = new Date(`${form.date}T${form.time}:00`);
      if (Number.isNaN(startTime.getTime())) {
        throw new Error("Choose a valid date and start time");
      }
      if (startTime < new Date()) {
        throw new Error("Choose a start date and time from now onward.");
      }
      if (customPackage.serviceIds.length && !customPackage.name.trim()) {
        throw new Error("Enter a custom package name");
      }
      const usageLimit = Number(customPackage.usageLimit || 1);
      if (
        customPackage.serviceIds.length &&
        (!Number.isInteger(usageLimit) || usageLimit < 1 || usageLimit > 100)
      ) {
        throw new Error("Enter a usage limit from 1 to 100");
      }
      const customServiceIds = customPackage.serviceIds.filter((serviceId) =>
        form.serviceIds.includes(serviceId)
      );
      const response = await salonApi.jobCarts.create({
        ...(form.salonId ? { salonId: form.salonId } : {}),
        branchId: form.branchId,
        customerName: form.customerName,
        phone: form.phone,
        startTime: startTime.toISOString(),
        ...(form.staffId ? { staffId: form.staffId } : {}),
        serviceIds: form.serviceIds,
        ...(form.bookingNote ? { bookingNote: form.bookingNote } : {}),
      });
      for (const packageId of form.packageIds) {
        await salonApi.jobCarts.addItem(response.data.id, {
          itemType: "PACKAGE",
          packageId,
          ...(form.staffId ? { staffId: form.staffId } : {}),
        });
      }
      if (customServiceIds.length) {
        await salonApi.packages.createCustomFromCart({
          jobCartId: response.data.id,
          serviceIds: customServiceIds,
          items: customServiceIds.map((serviceId) => ({
            serviceId,
            quantity: usageLimit,
          })),
          name: customPackage.name,
          specialPrice: Number(
            customPackage.specialPrice || selectedCustomTotal
          ),
          validityDays: Number(customPackage.validityDays || 30),
          ...(customPackage.soldByStaffId
            ? { soldByStaffId: customPackage.soldByStaffId }
            : {}),
        });
      }
      navigate(`/job-carts/${response.data.id}`);
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageShell
      title="Create Job Cart"
      description="Start a walk-in appointment and its draft invoice."
      tools={
        <Button color="light" outline onClick={() => navigate("/job-carts")}>
          <Icon name="arrow-left" /> Back
        </Button>
      }
    >
      {error && <Alert color="danger">{error}</Alert>}
      <Form onSubmit={submit}>
        <Row className="g-4">
          <Col lg="8">
            <div className="card card-bordered">
              <div className="card-inner">
                <h5 className="mb-4">Walk-in Details</h5>
                {user?.role === "SUPER_ADMIN" && (
                  <FormGroup>
                    <Label>Salon</Label>
                    <Input
                      type="select"
                      required
                      value={form.salonId}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          salonId: event.target.value,
                          branchId: "",
                          staffId: "",
                          serviceIds: [],
                          packageIds: [],
                        }))
                      }
                    >
                      <option value="">Select salon</option>
                      {refs.salons.map((salon) => (
                        <option key={salon.id} value={salon.id}>
                          {salon.name}
                        </option>
                      ))}
                    </Input>
                  </FormGroup>
                )}
                <Row>
                  <Col md="6">
                    <FormGroup>
                      <Label>Customer</Label>
                      <CreatableSelect
                        className="react-select-container"
                        classNamePrefix="react-select"
                        isClearable
                        isDisabled={loadingRefs || saving}
                        options={customerOptions}
                        placeholder="Search or add customer"
                        value={selectedCustomerOption}
                        noOptionsMessage={({ inputValue }) =>
                          inputValue
                            ? `No customer named "${inputValue}"`
                            : "Type a customer name"
                        }
                        formatCreateLabel={(inputValue) =>
                          `Add "${inputValue}" as a new customer`
                        }
                        isValidNewOption={(inputValue, _selectValue, options) => {
                          const normalized = inputValue.trim().toLowerCase();
                          return (
                            Boolean(normalized) &&
                            !options.some(
                              (option) =>
                                option.name.trim().toLowerCase() === normalized
                            )
                          );
                        }}
                        onChange={(option) => {
                          setCustomerSummary(null);
                          setForm((current) => ({
                            ...current,
                            customerName: option?.name || "",
                            phone: option?.phone || current.phone,
                          }));
                          if (option?.value && option.value !== option.name) {
                            loadCustomerSummary({ customerId: option.value });
                          }
                        }}
                        onCreateOption={(inputValue) => {
                          setCustomerSummary(null);
                          setForm((current) => ({
                            ...current,
                            customerName: inputValue.trim(),
                          }));
                        }}
                      />
                    </FormGroup>
                  </Col>
                  <Col md="6">
                    <FormGroup>
                      <Label>Phone Number</Label>
                      <Input
                        required
                        placeholder="Customer phone"
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
                {lookingUp && (
                  <div className="small text-soft mb-3">
                    <Spinner size="sm" className="me-1" />
                    Checking customer phone
                  </div>
                )}
                <Row>
                  <Col md="4">
                    <FormGroup>
                      <Label>Date</Label>
                      <Input
                        type="date"
                        required
                        min={todayInputDate()}
                        value={form.date}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            date: event.target.value,
                            time:
                              event.target.value === todayInputDate() &&
                              current.time < currentInputTime()
                                ? currentInputTime()
                                : current.time,
                          }))
                        }
                      />
                    </FormGroup>
                  </Col>
                  <Col md="4">
                    <FormGroup>
                      <Label>Start Time</Label>
                      <Input
                        type="time"
                        required
                        min={
                          form.date === todayInputDate()
                            ? currentInputTime()
                            : undefined
                        }
                        value={form.time}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            time: event.target.value,
                          }))
                        }
                      />
                    </FormGroup>
                  </Col>
                  <Col md="4">
                    <FormGroup>
                      <Label>Branch</Label>
                      <Input
                        type="select"
                        required
                        value={form.branchId}
                        disabled={loadingRefs}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            branchId: event.target.value,
                            staffId: "",
                            serviceIds: [],
                            packageIds: [],
                          }))
                        }
                      >
                        <option value="">Select branch</option>
                        {refs.branches.map((branch) => (
                          <option key={branch.id} value={branch.id}>
                            {branch.name}
                          </option>
                        ))}
                      </Input>
                    </FormGroup>
                  </Col>
                </Row>
                <FormGroup>
                  <Label>Staff (optional)</Label>
                  <Input
                    type="select"
                    value={form.staffId}
                    disabled={!form.branchId}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        staffId: event.target.value,
                      }))
                    }
                  >
                    <option value="">Assign later</option>
                    {refs.staff.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name} — {member.jobRole}
                      </option>
                    ))}
                  </Input>
                </FormGroup>
                <FormGroup>
                  <Label>Add Packages</Label>
                  <div className="border rounded p-3">
                    {(refs.packages || []).length ? (
                      (refs.packages || []).map((servicePackage) => (
                        <div
                          key={servicePackage.id}
                          className="form-check mb-2"
                        >
                          <Input
                            type="checkbox"
                            id={`package-${servicePackage.id}`}
                            checked={form.packageIds.includes(
                              servicePackage.id
                            )}
                            disabled={!form.branchId}
                            onChange={() => togglePackage(servicePackage.id)}
                          />
                          <Label
                            className="form-check-label"
                            htmlFor={`package-${servicePackage.id}`}
                          >
                            {servicePackage.name} -{" "}
                            {formatMoney(servicePackage.specialPrice)}
                            <span className="d-block small text-soft">
                              {(servicePackage.items || [])
                                .map((item) => item.serviceNameSnapshot)
                                .join(", ")}
                            </span>
                          </Label>
                        </div>
                      ))
                    ) : (
                      <div className="text-soft small">No packages available.</div>
                    )}
                  </div>
                  <Input
                    className="d-none"
                    type="select"
                    multiple
                    value={form.packageIds}
                    disabled={!form.branchId}
                    style={{ minHeight: 120 }}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        packageIds: Array.from(
                          event.target.selectedOptions,
                          (option) => option.value
                        ),
                      }))
                    }
                  >
                    {(refs.packages || []).map((servicePackage) => (
                      <option key={servicePackage.id} value={servicePackage.id}>
                        {servicePackage.name} —{" "}
                        {formatMoney(servicePackage.specialPrice)}
                      </option>
                    ))}
                  </Input>
                  <small className="text-soft">
                    Selected packages are added to the draft invoice after the
                    cart is created.
                  </small>
                </FormGroup>
                <FormGroup>
                  <Label>Add Services</Label>
                  <div className="border rounded p-3">
                    {refs.services.length ? (
                      refs.services.map((service) => {
                        const covered = selectedPackageServiceIds.has(
                          service.id
                        );
                        return (
                          <div key={service.id} className="form-check mb-2">
                            <Input
                              type="checkbox"
                              id={`service-${service.id}`}
                              checked={form.serviceIds.includes(service.id)}
                              disabled={!form.branchId || covered}
                              onChange={() => toggleService(service.id)}
                            />
                            <Label
                              className="form-check-label"
                              htmlFor={`service-${service.id}`}
                            >
                              {service.name} - {formatMoney(service.price)}
                              {covered && (
                                <span className="d-block small text-soft">
                                  Covered by selected package
                                </span>
                              )}
                            </Label>
                          </div>
                        );
                      })
                    ) : (
                      <div className="text-soft small">No services available.</div>
                    )}
                  </div>
                  <Input
                    className="d-none"
                    type="select"
                    multiple
                    value={form.serviceIds}
                    disabled={!form.branchId}
                    style={{ minHeight: 180 }}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        serviceIds: Array.from(
                          event.target.selectedOptions,
                          (option) => option.value
                        ),
                      }))
                    }
                  >
                    {refs.services.map((service) => (
                      <option key={service.id} value={service.id}>
                        {service.name} — {formatMoney(service.price)}
                      </option>
                    ))}
                  </Input>
                  <small className="text-soft">
                    Services covered by selected packages cannot be added as
                    standalone services.
                  </small>
                </FormGroup>
                {selectedServices.length > 0 && (
                  <div className="border rounded p-3 mb-3">
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
                          placeholder={`Price ${formatMoney(
                            selectedCustomTotal
                          )}`}
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
                      <Col md="3">
                        <Label className="form-label">Sold by</Label>
                        <Input
                          type="select"
                          value={customPackage.soldByStaffId}
                          disabled={!form.branchId}
                          onChange={(event) =>
                            setCustomPackage((current) => ({
                              ...current,
                              soldByStaffId: event.target.value,
                            }))
                          }
                        >
                          <option value="">Sold by (optional)</option>
                          {refs.staff.map((member) => (
                            <option key={member.id} value={member.id}>
                              {member.name}
                            </option>
                          ))}
                        </Input>
                      </Col>
                    </Row>
                    <div className="mt-3">
                      {selectedServices.map((service) => (
                        <div key={service.id} className="form-check mb-1">
                          <Input
                            type="checkbox"
                            id={`create-custom-package-service-${service.id}`}
                            checked={customPackage.serviceIds.includes(
                              service.id
                            )}
                            onChange={() =>
                              toggleCustomPackageService(service.id)
                            }
                          />
                          <Label
                            className="form-check-label"
                            htmlFor={`create-custom-package-service-${service.id}`}
                          >
                            {service.name} - {formatMoney(service.price)}
                          </Label>
                        </div>
                      ))}
                    </div>
                    <small className="text-soft">
                      Selected services are converted into a customer custom
                      package after the job cart is created.
                    </small>
                  </div>
                )}
                <FormGroup>
                  <Label>Booking Note</Label>
                  <Input
                    type="textarea"
                    rows="3"
                    value={form.bookingNote}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        bookingNote: event.target.value,
                      }))
                    }
                  />
                </FormGroup>
              </div>
            </div>
          </Col>
          <Col lg="4">
            <div className="card card-bordered position-sticky" style={{ top: 90 }}>
              <div className="card-inner">
                <h5>Cart Summary</h5>
                {customerSummary && (
                  <div className="alert alert-light border mb-3">
                    <strong>{customerSummary.customerName}</strong>
                    <div className="small mt-2">
                      Last visit: {formatDate(customerSummary.lastVisitDate)}
                      <br />
                      Total visits: {customerSummary.totalVisits}
                      <br />
                      Loyalty: {customerSummary.loyaltyPoints} points
                      <br />
                      Wallet: {formatMoney(customerSummary.walletBalance)}
                      <br />
                      Outstanding:{" "}
                      {formatMoney(customerSummary.outstandingBalance)}
                      <br />
                      Membership:{" "}
                      {customerSummary.membershipName
                        ? `${customerSummary.membershipName}${
                            customerSummary.membershipExpiresAt
                              ? `, Expire on ${formatDate(
                                  customerSummary.membershipExpiresAt
                                )}`
                              : ""
                          }${
                            customerSummary.membershipStatus !== "ACTIVE"
                              ? ` (${customerSummary.membershipStatus})`
                              : ""
                          }`
                        : "None"}
                      <br />
                      Preferred staff:{" "}
                      {customerSummary.preferredStaff?.staffName || "Not known"}
                    </div>
                    {customerSummary.activePackages?.length > 0 && (
                      <div className="small mt-2">
                        <strong>Available packages</strong>
                        {customerSummary.activePackages.map((item) => (
                          <div key={item.customerPackageId}>
                            {item.packageName} — valid to{" "}
                            {formatDate(item.validUntil)}
                            {item.soldByStaffName
                              ? ` — sold by ${item.soldByStaffName}`
                              : ""}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {customerSummary?.activePackages?.length > 0 && (
                  <div className="small mb-3">
                    {customerSummary.activePackages.map((item) => (
                      <div
                        key={`${item.customerPackageId}-balances`}
                        className="border rounded p-2 mb-2"
                      >
                        <strong>{item.packageName} balances</strong>
                        {(item.serviceBalances || []).map((balance) => (
                          <div
                            key={balance.balanceId}
                            className="d-flex justify-content-between mt-1"
                          >
                            <span>{balance.serviceName}</span>
                            <span>
                              {balance.usedQuantity}/
                              {balance.includedQuantity} used •{" "}
                              {balance.remainingQuantity} remaining
                            </span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
                <div className="d-flex justify-content-between py-2 border-bottom">
                  <span>Services</span>
                  <strong>{selectedServices.length}</strong>
                </div>
                <div className="d-flex justify-content-between py-2 border-bottom">
                  <span>Packages</span>
                  <strong>{selectedPackages.length}</strong>
                </div>
                <div className="d-flex justify-content-between py-2 border-bottom">
                  <span>Duration</span>
                  <strong>{duration} min</strong>
                </div>
                <div className="d-flex justify-content-between py-3">
                  <span>Estimated subtotal</span>
                  <strong>
                    {formatMoney(subtotal + packageSubtotal)}
                  </strong>
                </div>
                <p className="text-soft small">
                  Membership discount is calculated when the draft invoice is
                  created. Coupon and loyalty actions remain in the invoice
                  flow.
                </p>
                <Button
                  type="submit"
                  color="primary"
                  block
                  disabled={saving || loadingRefs}
                >
                  {saving && <Spinner size="sm" className="me-1" />}
                  Create Job Cart
                </Button>
              </div>
            </div>
          </Col>
        </Row>
      </Form>
    </PageShell>
  );
};

export default JobCartCreate;
