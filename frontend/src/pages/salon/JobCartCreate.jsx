/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Select } from "@/components/select/PortalSelect";
import {
  Alert,
  Col,
  Form,
  FormGroup,
  Input,
  InputGroup,
  Label,
  Modal,
  ModalBody,
  ModalHeader,
  Row,
  Spinner,
} from "reactstrap";
import { Button, Icon } from "@/components/Component";
import PageShell from "@/components/salon/PageShell";
import ServicePickerModal from "@/components/salon/ServicePickerModal";
import { useAuth } from "@/auth/AuthContext";
import { salonApi } from "@/services/salonApi";
import {
  currentInputTime,
  formatDate,
  formatMoney,
  todayInputDate,
  toLocalInput,
} from "@/utils/salonFormat";

const newServiceRow = () => ({
  rowId: `service-${Date.now()}-${Math.random()}`,
  mainServiceId: "",
  serviceId: "",
  staffId: "",
  qty: "1",
  price: "",
  discount: "",
  discountType: "AMT",
  total: "",
});

const round2 = (value) => Math.round(Number(value || 0) * 100) / 100;
// A quantity below 1 would make the price back-solve divide by zero.
const qtyOf = (qty) => Math.max(1, Math.floor(Number(qty) || 1));
// Row price is the pre-GST unit price, row total is the post-GST line total.
// Editing either one derives the other; quantity re-derives the total.
// The discount comes off the base unit price, as a flat amount ("AMT") or a
// percentage of it ("PCT"), and never takes the price below 0.
const pctOf = (discount) => Math.min(100, Math.max(0, Number(discount || 0)));
const discountAmountOf = (price, discount, type) =>
  type === "PCT"
    ? (Number(price || 0) * pctOf(discount)) / 100
    : Number(discount || 0);
const netPrice = (price, discount, type) =>
  Math.max(
    0,
    round2(Number(price || 0) - discountAmountOf(price, discount, type))
  );
const priceToTotal = (price, qty, gst, discount = 0, type = "AMT") =>
  String(round2(netPrice(price, discount, type) * qtyOf(qty) * (1 + gst / 100)));
// Back-solving a percentage discount at 100% off has no single answer, so the
// base price collapses to 0 rather than dividing by zero.
const totalToPrice = (total, qty, gst, discount = 0, type = "AMT") => {
  const net = Number(total || 0) / qtyOf(qty) / (1 + gst / 100);
  if (type !== "PCT") return String(round2(net + Number(discount || 0)));
  const pct = pctOf(discount);
  return String(pct >= 100 ? 0 : round2(net / (1 - pct / 100)));
};

// Pencil to the picked customer's profile, where their details are editable.
// Renders nothing until a saved customer is matched, so a brand-new name never
// links to a dead page.
const CustomerProfileLink = ({ customerId }) =>
  customerId ? (
    <Link
      to={`/customers/${customerId}`}
      className="btn btn-outline-primary flex-shrink-0 d-flex align-items-center justify-content-center"
      style={{ width: 26, height: 26, padding: 0 }}
      title="Edit customer details"
    >
      <Icon name="edit" />
    </Link>
  ) : null;

const JobCartCreate = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [form, setForm] = useState({
    salonId: "",
    branchId: "",
    customerName: "",
    phone: "",
    date: todayInputDate(),
    packageIds: [],
  });
  const [serviceRows, setServiceRows] = useState([]);
  // Staff chosen in the picker; services picked afterwards attach to them.
  const [pickerStaffId, setPickerStaffId] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
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
    salon: null,
  });
  const [loadingRefs, setLoadingRefs] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [customerSummary, setCustomerSummary] = useState(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [packageModalOpen, setPackageModalOpen] = useState(false);
  const [availableSlots, setAvailableSlots] = useState([]);
  const [loadingSlots, setLoadingSlots] = useState(false);

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
    if (phoneDigits.length < 10) {
      setCustomerSummary(null);
      return undefined;
    }
    const timer = window.setTimeout(() => {
      loadCustomerSummary({ phone: form.phone }, { suppressNotFound: true });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [form.phone, loadCustomerSummary]);

  const serviceIds = useMemo(
    () => serviceRows.map((row) => row.serviceId).filter(Boolean),
    [serviceRows]
  );

  useEffect(() => {
    setCustomPackage((current) => ({
      ...current,
      serviceIds: current.serviceIds.filter((id) => serviceIds.includes(id)),
    }));
  }, [serviceIds]);

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
          salon: null,
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
        name: customer.name,
        phone: customer.phone || "",
      })),
    [refs.customers]
  );

  // Search box suggestions: 3+ characters, matched against the customer name
  // or the digits-only stored phone.
  const [phoneFocused, setPhoneFocused] = useState(false);
  const [customerNameFocused, setCustomerNameFocused] = useState(false);
  const phoneMatches = useMemo(() => {
    const query = form.phone.trim().toLowerCase();
    const digits = form.phone.replace(/\D/g, "");
    if (query.length < 3) return [];
    // Once a full number is typed, suffix-compare so a stored "+919876543210"
    // counts as resolved for "9876543210" and the list stops nagging.
    const exact =
      digits.length >= 10 &&
      customerOptions.some((option) => {
        const stored = option.phone.replace(/\D/g, "");
        return (
          stored.length >= 10 &&
          (stored.endsWith(digits) || digits.endsWith(stored))
        );
      });
    if (exact) return [];
    return customerOptions
      .filter(
        (option) =>
          option.name.toLowerCase().includes(query) ||
          (digits.length >= 3 &&
            option.phone.replace(/\D/g, "").includes(digits))
      )
      .slice(0, 8);
  }, [customerOptions, form.phone]);

  const customerNameMatches = useMemo(() => {
    const query = form.customerName.trim().toLowerCase();
    if (query.length < 3) return [];

    return customerOptions
      .filter((option) => option.name.toLowerCase().includes(query))
      .slice(0, 8);
  }, [customerOptions, form.customerName]);

  // A 10-digit phone that already belongs to a customer: no "add" allowed.
  const existingPhoneCustomer = useMemo(() => {
    const digits = form.phone.replace(/\D/g, "");
    if (digits.length !== 10) return null;
    return (
      customerOptions.find((option) => {
        const stored = option.phone.replace(/\D/g, "");
        return stored.length >= 10 && stored.endsWith(digits);
      }) || null
    );
  }, [customerOptions, form.phone]);

  const savedCustomerId =
    customerSummary?.customerId || existingPhoneCustomer?.value || "";

  const selectedServices = useMemo(
    () =>
      refs.services.filter((service) =>
        serviceIds.includes(service.id)
      ),
    [refs.services, serviceIds]
  );
  // Rows carry an editable price, so the estimate follows the row not the catalog.
  const subtotal = serviceRows.reduce((sum, row) => {
    if (!row.serviceId) return sum;
    const service = refs.services.find((item) => item.id === row.serviceId);
    const unitPrice = Number(
      row.price === "" || row.price === undefined ? service?.price || 0 : row.price
    );
    return (
      sum + netPrice(unitPrice, row.discount, row.discountType) * qtyOf(row.qty)
    );
  }, 0);
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
  const serviceGstPercent =
    refs.salon?.gstEnabled === false
      ? 0
      : Number(refs.salon?.serviceGstRate ?? 0);
  // Estimate only: the real tax is computed server-side on the draft invoice,
  // after the membership discount and any coupon are applied.
  const estimatedTax = ((subtotal + packageSubtotal) * serviceGstPercent) / 100;
  const membershipLabel = !customerSummary?.membershipName
    ? "None"
    : `${customerSummary.membershipName}${
        customerSummary.membershipExpiresAt
          ? `, expires ${formatDate(customerSummary.membershipExpiresAt)}`
          : ""
      }${
        customerSummary.membershipStatus !== "ACTIVE"
          ? ` (${customerSummary.membershipStatus})`
          : ""
      }`;
  const customerRows = [
    {
      icon: "award-fill",
      label: "Membership",
      value: membershipLabel,
      muted: !customerSummary?.membershipName,
    },
    {
      icon: "user",
      label: "Preferred Staff",
      value: customerSummary?.preferredStaff?.staffName || "Not known",
      muted: !customerSummary?.preferredStaff,
    },
    {
      icon: "notes-alt",
      label: "Notes",
      value: customerSummary?.notes || "No notes yet",
      muted: !customerSummary?.notes,
    },
    // Money already owed stays visible before another cart is opened.
    ...(Number(customerSummary?.outstandingBalance) > 0
      ? [
          {
            icon: "alert-circle",
            label: "Outstanding",
            value: formatMoney(customerSummary.outstandingBalance),
            danger: true,
          },
        ]
      : []),
  ];
  const mainServices = useMemo(
    () =>
      Array.from(
        refs.services.reduce((map, service) => {
          const id = service.mainService?.id || service.mainServiceId || "";
          const name = service.mainService?.name || service.mainServiceName;
          if (id && name) map.set(id, name);
          return map;
        }, new Map())
      ).map(([id, name]) => ({ id, name })),
    [refs.services]
  );
  // Carts start at the chosen date and the current clock, so availability is
  // looked up for that date.
  const selectedStartKey = `${form.date}T${currentInputTime()}`;
  // Slots are generated on a fixed grid (15-minute steps), so the form's
  // live "current time" default almost never lands on a boundary exactly.
  // Match each staff member's slot nearest to (at or before) the selected
  // time instead of requiring an exact string match.
  const slotsAtSelectedTime = useMemo(() => {
    const bestByStaff = new Map();
    availableSlots.forEach((slot) => {
      const slotKey = toLocalInput(slot.startTime);
      if (slotKey > selectedStartKey) return;
      const current = bestByStaff.get(slot.staffId);
      if (!current || slotKey > toLocalInput(current.startTime)) {
        bestByStaff.set(slot.staffId, slot);
      }
    });
    return [...bestByStaff.values()];
  }, [availableSlots, selectedStartKey]);
  const availableStaffAtSelectedTime = useMemo(() => {
    const staffById = new Map(refs.staff.map((member) => [member.id, member]));
    const seen = new Map();
    slotsAtSelectedTime.forEach((slot) => {
      const member = staffById.get(slot.staffId);
      if (member) seen.set(member.id, member);
    });
    return [...seen.values()];
  }, [refs.staff, slotsAtSelectedTime]);
  // Availability slots are only fetched once the cart has services (the API
  // needs a duration). Before that, offer all branch staff so a staff member
  // can be chosen up front; the per-row dropdown still enforces real
  // availability once services are added.
  // Walk-in carts are not slot-gated, so every branch staff member is
  // selectable; the server still rejects an appointment double-booking.
  const pickerStaffOptions = refs.staff;
  const slotOptions = useMemo(() => {
    const seen = new Map();
    availableSlots.forEach((slot) => {
      const local = toLocalInput(slot.startTime);
      const time = local.slice(11, 16);
      const key = `${local}-${slot.staffId}`;
      if (!seen.has(key)) {
        seen.set(key, {
          value: key,
          slot,
          label: `${time} - ${slot.staffName}`,
        });
      }
    });
    return [...seen.values()];
  }, [availableSlots]);
  const selectedSlotOption = useMemo(
    () =>
      slotOptions.find(
        (option) =>
          toLocalInput(option.slot.startTime) === selectedStartKey &&
          serviceRows.some((row) => row.staffId === option.slot.staffId)
      ) || null,
    [selectedStartKey, serviceRows, slotOptions]
  );

  useEffect(() => {
    let active = true;
    if (!form.branchId || !form.date || !serviceIds.length) {
      setAvailableSlots([]);
      setLoadingSlots(false);
      return undefined;
    }
    setLoadingSlots(true);
    salonApi.staffAvailability
      .slots({
        branchId: form.branchId,
        date: form.date,
        serviceIds: serviceIds.join(","),
      })
      .then((response) => {
        if (active) setAvailableSlots(response.data?.slots || []);
      })
      .catch(() => {
        if (active) setAvailableSlots([]);
      })
      .finally(() => {
        if (active) setLoadingSlots(false);
      });
    return () => {
      active = false;
    };
  }, [form.branchId, form.date, serviceIds]);

  const togglePackage = (packageId) => {
    const packageIds = form.packageIds.includes(packageId)
      ? form.packageIds.filter((id) => id !== packageId)
      : [...form.packageIds, packageId];
    const coveredServices = new Set();
    (refs.packages || [])
      .filter((servicePackage) => packageIds.includes(servicePackage.id))
      .forEach((servicePackage) => {
        (servicePackage.items || []).forEach((item) =>
          coveredServices.add(item.serviceId)
        );
      });
    setForm((current) => {
      return { ...current, packageIds };
    });
    setServiceRows((current) =>
      current
        .map((row) =>
          coveredServices.has(row.serviceId)
            ? { ...row, serviceId: "", mainServiceId: "" }
            : row
        )
        .filter((row) => row.serviceId)
    );
  };

  const updateServiceRow = (rowId, updates) => {
    setServiceRows((current) =>
      current.map((row) => {
        if (row.rowId !== rowId) return row;
        const next = { ...row, ...updates };
        if (
          updates.mainServiceId !== undefined &&
          updates.serviceId === undefined
        ) {
          next.serviceId = "";
        }
        return next;
      })
    );
  };

  // Rows keyed by service, so the list can show what is already in the cart
  // and which staff each one went to.
  const rowsByServiceId = useMemo(() => {
    const map = new Map();
    serviceRows.forEach((row) => {
      if (row.serviceId) map.set(row.serviceId, row);
    });
    return map;
  }, [serviceRows]);

  const assignedById = useMemo(
    () =>
      new Map(
        [...rowsByServiceId].map(([serviceId, row]) => [serviceId, row.staffId])
      ),
    [rowsByServiceId]
  );

  // Everything not covered by a selected package. Services already in the cart
  // stay listed (shown checked) so they can be unchecked to remove them.
  const pickerServiceOptions = useMemo(
    () =>
      refs.services
        .filter((service) => !selectedPackageServiceIds.has(service.id))
        .map((service) => ({
          id: service.id,
          name: service.name,
          price: service.price,
          durationValue: service.durationValue,
          durationUnit: service.durationUnit,
          mainServiceId: service.mainService?.id || service.mainServiceId || "",
          mainServiceName:
            service.mainService?.name || service.mainServiceName || "Other",
        })),
    [refs.services, selectedPackageServiceIds]
  );

  // Checking a service adds it to the cart immediately, assigned to whoever
  // is selected in the staff dropdown at that moment. Unchecking removes it.
  // Rows added earlier keep their original staff, so switching staff only
  // affects services checked from that point on.
  const togglePickerService = (serviceId) => {
    const service = refs.services.find((item) => item.id === serviceId);
    if (!service) return;
    setServiceRows((current) => {
      const existing = current.find((row) => row.serviceId === serviceId);
      if (existing) {
        return current.filter((row) => row.serviceId !== serviceId);
      }
      const row = {
        ...newServiceRow(),
        rowId: `service-${Date.now()}-${Math.random()}`,
        serviceId,
        mainServiceId: service.mainService?.id || service.mainServiceId || "",
        staffId: pickerStaffId || "",
        price: String(service.price ?? ""),
        total: priceToTotal(service.price ?? 0, 1, serviceGstPercent),
      };
      // Drop the leading blank row so the first add does not leave a gap.
      const kept = current.filter((item) => item.serviceId);
      return [...kept, row];
    });
  };

  const removeServiceRow = (rowId) =>
    setServiceRows((current) => {
      return current.filter((row) => row.rowId !== rowId);
    });

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
      const startTime = new Date(`${form.date}T${currentInputTime()}`);
      const selectedServiceIds = serviceRows
        .map((row) => row.serviceId)
        .filter(Boolean);
      if (new Set(selectedServiceIds).size !== selectedServiceIds.length) {
        throw new Error("Each service can be selected only once.");
      }
      if (serviceRows.some((row) => row.serviceId && !row.staffId)) {
        throw new Error("Assign staff to every service.");
      }
      // A stored number may carry a country code, so only the length floor.
      if (form.phone.replace(/\D/g, "").length < 10) {
        throw new Error("Pick a customer or enter a 10-digit phone number.");
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
        selectedServiceIds.includes(serviceId)
      );
      const serviceItems = serviceRows
        .filter((row) => row.serviceId)
        .map((row) => ({
          serviceId: row.serviceId,
          ...(row.staffId ? { staffId: row.staffId } : {}),
          ...(row.price === ""
            ? {}
            : { price: netPrice(row.price, row.discount, row.discountType) }),
          quantity: qtyOf(row.qty),
        }));
      const response = await salonApi.jobCarts.create({
        ...(form.salonId ? { salonId: form.salonId } : {}),
        branchId: form.branchId,
        customerName: form.customerName,
        phone: form.phone,
        startTime: startTime.toISOString(),
        serviceIds: selectedServiceIds,
        serviceItems,
      });
      for (const packageId of form.packageIds) {
        await salonApi.jobCarts.addItem(response.data.id, {
          itemType: "PACKAGE",
          packageId,
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
      className="is-wide"
      title="Create Job Cart"
      tools={
        <Button color="light" outline onClick={() => navigate("/job-carts")}>
          <Icon name="arrow-left" /> Back
        </Button>
      }
    >
      {error && <Alert color="danger">{error}</Alert>}
      <Form onSubmit={submit}>
        <Row className="g-4 jobcart-fill">
          <Col lg="8">
            <div className="card card-bordered jobcart-main">
              <div className="card-inner">
                {user?.role === "SUPER_ADMIN" && (
                  <FormGroup>
                    <Label>Salon</Label>
                    <Input
                      type="select"
                      required
                      value={form.salonId}
                      onChange={(event) => {
                        setForm((current) => ({
                          ...current,
                          salonId: event.target.value,
                          branchId: "",
                          packageIds: [],
                        }));
                        setServiceRows([]);
                        setPickerStaffId("");
                        setPickerOpen(false);
                      }}
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
                <Row className="g-3">
                  <Col md="6" lg="3">
                    <FormGroup>
                      <Label>Phone Number</Label>
                      <div className="position-relative">
                        <div className="cust-field">
                          <Icon name="call" className="cust-field-icon" />
                          <Input
                            required
                            autoComplete="off"
                            className="cust-input"
                            placeholder="Search name or phone"
                            maxLength={40}
                            value={form.phone}
                            onFocus={() => setPhoneFocused(true)}
                            onBlur={() =>
                              window.setTimeout(
                                () => setPhoneFocused(false),
                                150
                              )
                            }
                            onChange={(event) => {
                              setCustomerSummary(null);
                              setForm((current) => ({
                                ...current,
                                // Letters mean a name search; a numeric entry
                                // is still kept as a 10-digit phone.
                                phone: /[^\d\s]/.test(event.target.value)
                                  ? event.target.value
                                  : event.target.value
                                      .replace(/\D/g, "")
                                      .slice(0, 10),
                                // A matched customer filled the name; changing
                                // the phone breaks the match, so the name goes
                                // too.
                                ...(customerSummary ? { customerName: "" } : {}),
                              }));
                            }}
                          />
                          {form.phone && (
                            <button
                              type="button"
                              className="cust-field-clear"
                              title="Clear customer"
                              onClick={() => {
                                setCustomerSummary(null);
                                setForm((current) => ({
                                  ...current,
                                  phone: "",
                                  customerName: "",
                                }));
                              }}
                            >
                              <Icon name="cross" />
                            </button>
                          )}
                        </div>
                        {phoneFocused && phoneMatches.length > 0 && (
                          <ul className="customer-phone-menu">
                            {phoneMatches.map((option) => (
                              <li key={option.value}>
                                <button
                                  type="button"
                                  className="customer-phone-option"
                                  onMouseDown={(event) =>
                                    event.preventDefault()
                                  }
                                  onClick={() => {
                                    setPhoneFocused(false);
                                    setCustomerSummary(null);
                                    setForm((current) => ({
                                      ...current,
                                      customerName: option.name,
                                      phone: option.phone,
                                    }));
                                    loadCustomerSummary({
                                      customerId: option.value,
                                    });
                                  }}
                                >
                                  <span className="customer-phone-name">
                                    {option.name}
                                  </span>
                                  <span className="customer-phone-number">
                                    {option.phone}
                                  </span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </FormGroup>
                  </Col>
                  <Col md="6" lg="4">
                    <FormGroup>
                      <Label>Customer</Label>
                      {savedCustomerId ? (
                        // A matched customer is display only; their details are
                        // edited on the profile, behind the pencil.
                        <div className="cust-chip">
                          <span className="cust-avatar">
                            {form.customerName?.trim()?.[0]?.toUpperCase() ||
                              "?"}
                          </span>
                          <div className="flex-grow-1" style={{ minWidth: 0 }}>
                            <div className="fw-bold text-truncate">
                                 <div className="cust-chip-sub">{form.customerName} {form.phone}</div>

                            </div>
                          </div>
                          {/* <span className="cust-tag">
                            <span className="cust-tag-dot" />
                            Existing Customer
                          </span> */}
                          <CustomerProfileLink customerId={savedCustomerId} />
                        </div>
                      ) : (
                        <div className="position-relative">
                          <Input
                            required
                            autoComplete="off"
                            placeholder="Customer name"
                            value={form.customerName}
                            onFocus={() => setCustomerNameFocused(true)}
                            onBlur={() =>
                              window.setTimeout(
                                () => setCustomerNameFocused(false),
                                150
                              )
                            }
                            onChange={(event) => {
                              setCustomerSummary(null);
                              setForm((current) => ({
                                ...current,
                                customerName: event.target.value,
                              }));
                            }}
                          />
                          {customerNameFocused &&
                            customerNameMatches.length > 0 && (
                              <ul className="customer-phone-menu">
                                {customerNameMatches.map((option) => (
                                  <li key={option.value}>
                                    <button
                                      type="button"
                                      className="customer-phone-option"
                                      onMouseDown={(event) =>
                                        event.preventDefault()
                                      }
                                      onClick={() => {
                                        setCustomerNameFocused(false);
                                        setCustomerSummary(null);
                                        setForm((current) => ({
                                          ...current,
                                          customerName: option.name,
                                          phone: option.phone,
                                        }));
                                        loadCustomerSummary({
                                          customerId: option.value,
                                        });
                                      }}
                                    >
                                      <span className="customer-phone-name">
                                        {option.name}
                                      </span>
                                      <span className="customer-phone-number">
                                        {option.phone || "No mobile"}
                                      </span>
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            )}
                        </div>
                      )}
                    </FormGroup>
                  </Col>
                  <Col md="6" lg="3">
                    <FormGroup>
                      <Label>Date</Label>
                      <div className="cust-field">
                        <Icon name="calendar" className="cust-field-icon" />
                        <Input
                          type="date"
                          required
                          className="cust-input"
                          value={form.date}
                          disabled={saving}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              date: event.target.value,
                            }))
                          }
                        />
                      </div>
                    </FormGroup>
                  </Col>
                  <Col md="6" lg="2">
                    <FormGroup>
                      <Label>Branch</Label>
                      <Input
                        type="select"
                        required
                        value={form.branchId}
                        disabled={loadingRefs}
                        onChange={(event) => {
                          setForm((current) => ({
                            ...current,
                            branchId: event.target.value,
                            packageIds: [],
                          }));
                          setServiceRows([]);
                          setPickerStaffId("");
                          setPickerOpen(false);
                        }}
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
                {customerSummary && (
                  <div className="cart-panel cust-meta">
                    {customerRows.map((row) => (
                      <div key={row.label} className="cart-row">
                        <span>
                          <Icon name={row.icon} />
                          {row.label}
                        </span>
                        <span
                          className={
                            row.danger
                              ? "text-danger fw-bold"
                              : row.muted
                              ? "text-soft"
                              : "fw-medium"
                          }
                        >
                          {row.value}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {lookingUp && (
                  <div className="small text-soft mb-3">
                    <Spinner size="sm" className="me-1" />
                    Checking customer phone
                  </div>
                )}
                {/* {serviceIds.length > 0 && (
                  <div className="border rounded p-3 mb-3">
                    <Label className="form-label">Available Staff Slots</Label>
                    <Select
                      className="react-select-container"
                      classNamePrefix="react-select"
                      isClearable
                      isLoading={loadingSlots}
                      isDisabled={!form.branchId || saving}
                      options={slotOptions}
                      value={selectedSlotOption}
                      placeholder={
                        loadingSlots
                          ? "Checking slots"
                          : slotOptions.length
                            ? "Choose a staff slot"
                            : "No staff slot for selected services"
                      }
                      noOptionsMessage={() => "No available staff slots"}
                      onChange={(option) => {
                        if (!option?.slot) {
                          setServiceRows((current) =>
                            current.map((row) => ({ ...row, staffId: "" }))
                          );
                          return;
                        }
                        const local = toLocalInput(option.slot.startTime);
                        setForm((current) => ({
                          ...current,
                          time: local.slice(11, 16),
                        }));
                        setServiceRows((current) =>
                          current.map((row) =>
                            row.serviceId
                              ? { ...row, staffId: option.slot.staffId }
                              : row
                          )
                        );
                      }}
                    />
                    <small className="text-soft">
                      Staff is optional. If assigned, the selected start time
                      must fit staff availability for the full cart duration.
                    </small>
                  </div>
                )} */}
                <FormGroup>
                  <div className="d-flex justify-content-between align-items-center mb-2 gap-5">
                    <Label className="mb-0">Add Services</Label>
                    <div className="d-flex gap-2">
                      <Button
                        color="primary"
                        type="button"
                        className="text-nowrap px-3 py-2"
                        style={{ minWidth: 112 }}
                        disabled={!form.branchId || loadingRefs || saving}
                        onClick={() => setPickerOpen(true)}
                      >
                        + Service
                      </Button>
                      <Button
                        color="primary"
                        outline
                        type="button"
                        className="text-nowrap px-3 py-2"
                        style={{ minWidth: 112 }}
                        disabled={!form.branchId || loadingRefs || saving}
                        onClick={() => setPackageModalOpen(true)}
                      >
                        + Package
                      </Button>
                    </div>
                  </div>
                  <div className="table-responsive">
                    <table className="table table-sm table-bordered mb-2">
                      <thead>
                        <tr>
                          {/* <th>Main Service</th> */}
                          <th style={{ width: 160 }}>Service</th>
                          <th style={{ width: 190 }}>Staff</th>
                          <th style={{ width: 70 }}>Qty</th>
                          <th style={{ width: 160 }}>Price</th>
                          <th style={{ width: 120 }}>Discount</th>
                          <th style={{ width: 50 }}>GST %</th>
                          <th style={{ width: 110 }}>Total</th>
                          <th style={{ width: 70 }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {serviceRows.map((row) => {
                          const selectedService = refs.services.find(
                            (service) => service.id === row.serviceId
                          );
                          const selectedIds = new Set(
                            serviceRows
                              .filter((item) => item.rowId !== row.rowId)
                              .map((item) => item.serviceId)
                              .filter(Boolean)
                          );
                          const rowServices = refs.services.filter((service) => {
                            const mainServiceId =
                              service.mainService?.id ||
                              service.mainServiceId ||
                              "";
                            return (
                              !selectedPackageServiceIds.has(service.id) &&
                              !selectedIds.has(service.id) &&
                              (!row.mainServiceId ||
                                mainServiceId === row.mainServiceId)
                            );
                          });
                          // Shown faded inside the price box, so the cashier
                          // sees what the row actually bills at.
                          const discountedPrice =
                            Number(row.discount) > 0
                              ? netPrice(
                                  row.price,
                                  row.discount,
                                  row.discountType
                                )
                              : null;
                          return (
                            <tr key={row.rowId}>
                              {/* <td>
                                <Input
                                  type="select"
                                  value={row.mainServiceId}
                                  disabled={!form.branchId || saving}
                                  onChange={(event) =>
                                    updateServiceRow(row.rowId, {
                                      mainServiceId: event.target.value,
                                    })
                                  }
                                >
                                  <option value="">Select main service</option>
                                  {mainServices.map((mainService) => (
                                    <option
                                      key={mainService.id}
                                      value={mainService.id}
                                    >
                                      {mainService.name}
                                    </option>
                                  ))}
                                </Input>
                              </td> */}
                              <td>
  <Select
    className="react-select-container"
    classNamePrefix="react-select"
    isClearable
    isDisabled={!form.branchId || saving}
    options={rowServices.map((service) => ({
      value: service.id,
      label: service.name,
    }))}
    value={
      selectedService
        ? { value: selectedService.id, label: selectedService.name }
        : null
    }
    placeholder="Search service"
    noOptionsMessage={() => "No services"}
    menuPortalTarget={document.body}
    menuPosition="fixed"
    styles={{
      menuPortal: (base) => ({ ...base, zIndex: 9999 }),
      menu: (base) => ({
        ...base,
        width: "max-content",
        minWidth: "100%",
        maxWidth: 420,
      }),
      option: (base) => ({
        ...base,
        whiteSpace: "normal",
        wordBreak: "break-word",
      }),
      singleValue: (base) => ({
        ...base,
        whiteSpace: "normal",
        overflow: "visible",
        textOverflow: "unset",
      }),
      control: (base) => ({
        ...base,
        minHeight: 38,
        height: "auto",
      }),
    }}
    onChange={(option) => {
      const service = refs.services.find(
        (item) => item.id === option?.value
      );
      updateServiceRow(row.rowId, {
        serviceId: option?.value || "",
        mainServiceId:
          service?.mainService?.id ||
          service?.mainServiceId ||
          row.mainServiceId,
        staffId: "",
        discount: "",
        discountType: "AMT",
        price: service === undefined ? "" : String(service.price ?? ""),
        total:
          service === undefined
            ? ""
            : priceToTotal(service.price ?? 0, row.qty, serviceGstPercent),
      });
    }}
  />
</td>
                              <td>
                                <Input
                                  type="select"
                                  value={row.staffId}
                                  disabled={
                                    !form.branchId ||
                                    !row.serviceId ||
                                    saving
                                  }
                                  onChange={(event) =>
                                    updateServiceRow(row.rowId, {
                                      staffId: event.target.value,
                                    })
                                  }
                                >
                                  <option value="">Select staff</option>
                                  {refs.staff.map((member) => (
                                    <option key={member.id} value={member.id}>
                                      {member.name} - {member.jobRole}
                                    </option>
                                  ))}
                                </Input>
                              </td>
                              <td>
                                <Input
                                  type="number"
                                  min="1"
                                  step="1"
                                  value={row.qty}
                                  disabled={!selectedService || saving}
                                  onChange={(event) =>
                                    updateServiceRow(row.rowId, {
                                      qty: event.target.value,
                                      total: priceToTotal(
                                        row.price,
                                        event.target.value,
                                        serviceGstPercent,
                                        row.discount,
                                        row.discountType
                                      ),
                                    })
                                  }
                                />
                              </td>
                              <td>
                                <div className="position-relative">
                                  <Input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={row.price}
                                    disabled={!selectedService || saving}
                                    style={
                                      discountedPrice === null
                                        ? undefined
                                        : { paddingRight: 96 }
                                    }
                                    onChange={(event) =>
                                      updateServiceRow(row.rowId, {
                                        price: event.target.value,
                                        total: priceToTotal(
                                          event.target.value,
                                          row.qty,
                                          serviceGstPercent,
                                          row.discount,
                                          row.discountType
                                        ),
                                      })
                                    }
                                  />
                                  {discountedPrice !== null && (
                                    <span
                                      className="position-absolute top-50 translate-middle-y"
                                      // Clears the number input spinners, and
                                      // stays click-through to the input.
                                      style={{
                                        right: 28,
                                        opacity: 0.55,
                                        pointerEvents: "none",
                                      }}
                                      title="Price after discount"
                                    >
                                      {formatMoney(discountedPrice)}
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td>
                                <InputGroup>
                                  <Input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    max={
                                      row.discountType === "PCT"
                                        ? "100"
                                        : undefined
                                    }
                                    value={row.discount}
                                    disabled={!selectedService || saving}
                                    onChange={(event) =>
                                      updateServiceRow(row.rowId, {
                                        discount: event.target.value,
                                        total: priceToTotal(
                                          row.price,
                                          row.qty,
                                          serviceGstPercent,
                                          event.target.value,
                                          row.discountType
                                        ),
                                      })
                                    }
                                  />
                                  <Input
                                    type="select"
                                    style={{ maxWidth: 62 }}
                                    value={row.discountType}
                                    disabled={!selectedService || saving}
                                    onChange={(event) =>
                                      updateServiceRow(row.rowId, {
                                        discountType: event.target.value,
                                        total: priceToTotal(
                                          row.price,
                                          row.qty,
                                          serviceGstPercent,
                                          row.discount,
                                          event.target.value
                                        ),
                                      })
                                    }
                                  >
                                    <option value="AMT">&#8377;</option>
                                    <option value="PCT">%</option>
                                  </Input>
                                </InputGroup>
                              </td>
                              <td>
                                <Input value={serviceGstPercent} disabled />
                              </td>
                              <td>
                                <Input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={row.total}
                                  disabled={!selectedService || saving}
                                  onChange={(event) =>
                                    updateServiceRow(row.rowId, {
                                      total: event.target.value,
                                      price: totalToPrice(
                                        event.target.value,
                                        row.qty,
                                        serviceGstPercent,
                                        row.discount,
                                        row.discountType
                                      ),
                                    })
                                  }
                                />
                              </td>
                              <td className="text-end">
                                <Button
                                  color="danger"
                                  outline
                                  size="sm"
                                  type="button"
                                  disabled={saving}
                                  onClick={() => removeServiceRow(row.rowId)}
                                >
                                  X
                                </Button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {/* <small className="text-soft">
                    Services covered by selected packages cannot be added as
                    standalone services.
                  </small> */}
                </FormGroup>
                {selectedPackages.length > 0 && (
                  <div className="border rounded p-3 mb-3">
                    <h6 className="mb-3">Selected Packages</h6>
                    {selectedPackages.map((servicePackage) => (
                      <div
                        key={servicePackage.id}
                        className="d-flex justify-content-between align-items-start border-bottom py-2"
                      >
                        <div>
                          <strong>{servicePackage.name}</strong>
                          <span className="d-block small text-soft">
                            {(servicePackage.items || [])
                              .map((item) => item.serviceNameSnapshot)
                              .join(", ")}
                          </span>
                        </div>
                        <div className="text-end">
                          <strong>{formatMoney(servicePackage.specialPrice)}</strong>
                          <Button
                            color="danger"
                            outline
                            size="sm"
                            type="button"
                            className="ms-2"
                            disabled={saving}
                            onClick={() => togglePackage(servicePackage.id)}
                          >
                            X
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {/* {selectedServices.length > 0 && (
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
                )} */}
              </div>
            </div>
          </Col>
          <Col lg="4">
            <div className="card card-bordered cart-summary">
              <div className="card-inner">
                <div className="d-flex align-items-center justify-content-between mb-3">
                  <h5 className="mb-0 d-flex align-items-center gap-2">
                    <Icon name="file-text" className="text-primary" />
                    <span>Cart Summary</span>
                  </h5>
                  <span className="cart-chip">
                    <span className="cart-chip-dot" />
                    Walk-in Visit
                  </span>
                </div>
                <div className="cart-scroll">
                {customerSummary && (
                  <>
                    <div className="cart-panel mb-3">
                      <div className="d-flex align-items-center gap-2 mt-2">
                        <span className="cart-avatar mb-2">
                          {customerSummary.customerName
                            ?.trim()?.[0]
                            ?.toUpperCase() || "?"}
                        </span>
                        <div className="flex-grow-1 " style={{ minWidth: 0 }}>
                          <div className="fw-bold text-truncate ">
                            {customerSummary.customerId ? (
                              <Link
                                to={`/customers/${customerSummary.customerId}`}
                              >
                                {customerSummary.customerName}
                              </Link>
                            ) : (
                              customerSummary.customerName
                            )}
                          </div>
                          <div className="small text-soft mb-2">
                            {customerSummary.phone}
                          </div>
                        </div>
                        <span className="cart-chip flex-shrink-0">
                          {customerSummary.totalVisits > 0
                            ? "Returning Customer"
                            : "New Customer"}
                        </span>
                      </div>
                      <div className="cart-stats">
                        {[
                          {
                            icon: "calendar-alt",
                            value: formatDate(customerSummary.lastVisitDate),
                            label: "Last Visit",
                          },
                          {
                            icon: "bar-chart",
                            value: customerSummary.totalVisits,
                            label: "Total Visits",
                          },
                          {
                            icon: "star",
                            value: customerSummary.loyaltyPoints,
                            label: "Loyalty Points",
                          },
                          {
                            icon: "wallet",
                            value: formatMoney(customerSummary.walletBalance),
                            label: "Wallet Balance",
                          },
                        ].map((stat) => (
                          <div key={stat.label}>
                            <Icon name={stat.icon} />
                            <div className="cart-stat-value">{stat.value}</div>
                            <div className="cart-stat-label">{stat.label}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
                {customerSummary?.activePackages?.length > 0 && (
                  <div className="cart-panel mb-3">
                    <h6 className="d-flex align-items-center gap-2 mb-2">
                      <Icon name="package" className="text-primary" />
                      <span>Available Packages</span>
                    </h6>
                    {customerSummary.activePackages.map((item) => (
                      <div key={item.customerPackageId} className="cart-row">
                        <span>
                          <span className="d-block fw-medium">
                            {item.packageName}
                          </span>
                          <span className="cart-stat-label">
                            Valid to {formatDate(item.validUntil)}
                            {item.soldByStaffName
                              ? ` - sold by ${item.soldByStaffName}`
                              : ""}
                          </span>
                        </span>
                        <span className="text-end">
                          {(item.serviceBalances || []).map((balance) => (
                            <span
                              key={balance.balanceId}
                              className="d-block cart-stat-label"
                            >
                              {balance.serviceName}: {balance.remainingQuantity}{" "}
                              of {balance.includedQuantity} left
                            </span>
                          ))}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="cart-panel mb-3">
                  <h6 className="d-flex align-items-center gap-2 mb-2">
                    <Icon name="scissor" className="text-primary" />
                    <span>Order Details</span>
                  </h6>
                  {[
                    {
                      icon: "scissor",
                      label: "Services",
                      value: selectedServices.length,
                    },
                    {
                      icon: "gift",
                      label: "Packages",
                      value: selectedPackages.length,
                    },
                    {
                      icon: "clock",
                      label: "Total Duration",
                      value: `${duration} min`,
                    },
                  ].map((row) => (
                    <div key={row.label} className="cart-row">
                      <span>
                        <Icon name={row.icon} />
                        {row.label}
                      </span>
                      <span className="fw-bold">{row.value}</span>
                    </div>
                  ))}
                  <div className="cart-row">
                    <span>Estimated Subtotal</span>
                    <span>{formatMoney(subtotal + packageSubtotal)}</span>
                  </div>
                  <div className="cart-row">
                    <span>Estimated Tax ({serviceGstPercent}%)</span>
                    <span>{formatMoney(estimatedTax)}</span>
                  </div>
                  <div className="cart-total">
                    <span>Estimated Total</span>
                    <span>
                      {formatMoney(subtotal + packageSubtotal + estimatedTax)}
                    </span>
                  </div>
                </div>
                </div>
                <p className="text-soft small">
                  Membership discount is calculated when the draft invoice is
                  created. Coupon and loyalty actions remain in the invoice
                  flow.
                </p>
                <Button
                  type="submit"
                  color="primary"
                  className="cart-cta"
                  disabled={saving || loadingRefs}
                >
                  {saving ? <Spinner size="sm" /> : <Icon name="file-text" />}
                  <span>Create Job Cart</span>
                  <Icon name="arrow-right" />
                </Button>
              </div>
            </div>
          </Col>
        </Row>
      </Form>
      <ServicePickerModal
        isOpen={pickerOpen}
        toggle={() => setPickerOpen(false)}
        services={pickerServiceOptions}
        staff={pickerStaffOptions}
        staffId={pickerStaffId}
        onStaffChange={setPickerStaffId}
        assignedById={assignedById}
        onToggleService={togglePickerService}
        disabled={saving}
        requireStaff
        staffPlaceholder="Select staff first"
      />
      <Modal
        isOpen={packageModalOpen}
        toggle={() => setPackageModalOpen(false)}
        centered
        size="lg"
      >
        <ModalHeader toggle={() => setPackageModalOpen(false)}>
          Add Package
        </ModalHeader>
        <ModalBody>
          {(refs.packages || []).length ? (
            (refs.packages || []).map((servicePackage) => {
              const selected = form.packageIds.includes(servicePackage.id);
              return (
                <div
                  key={servicePackage.id}
                  className="d-flex justify-content-between align-items-start border-bottom py-3"
                >
                  <div className="form-check">
                    <Input
                      type="checkbox"
                      id={`package-${servicePackage.id}`}
                      checked={selected}
                      disabled={!form.branchId || saving}
                      onChange={() => togglePackage(servicePackage.id)}
                    />
                    <Label
                      className="form-check-label"
                      htmlFor={`package-${servicePackage.id}`}
                    >
                      <strong>{servicePackage.name}</strong>
                      <span className="d-block small text-soft">
                        {(servicePackage.items || [])
                          .map((item) => item.serviceNameSnapshot)
                          .join(", ")}
                      </span>
                    </Label>
                  </div>
                  <strong>{formatMoney(servicePackage.specialPrice)}</strong>
                </div>
              );
            })
          ) : (
            <div className="text-soft small">No packages available.</div>
          )}
          <div className="d-flex justify-content-end mt-3">
            <Button
              color="primary"
              type="button"
              onClick={() => setPackageModalOpen(false)}
            >
              Done
            </Button>
          </div>
        </ModalBody>
      </Modal>
    </PageShell>
  );
};

export default JobCartCreate;
