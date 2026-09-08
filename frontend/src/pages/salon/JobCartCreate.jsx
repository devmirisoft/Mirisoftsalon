/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Select from "react-select";
import CreatableSelect from "react-select/creatable";
import {
  Alert,
  Col,
  Form,
  FormGroup,
  Input,
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
  price: "",
});

// Arrow to the picked customer's profile. Renders nothing until a saved
// customer is matched, so a brand-new name never links to a dead page.
const CustomerProfileLink = ({ customerId }) =>
  customerId ? (
    <Link
      to={`/customers/${customerId}`}
      className="btn btn-outline-primary flex-shrink-0 d-flex align-items-center justify-content-center"
      style={{ width: 38, height: 38, padding: 0 }}
      title="Open customer profile"
    >
      <Icon name="arrow-right" />
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
    packageIds: [],
  });
  const [serviceRows, setServiceRows] = useState([newServiceRow()]);
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
  const [addingCustomer, setAddingCustomer] = useState(false);
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

  // Name and phone are filled as a pair when a customer is picked. Editing
  // one afterwards breaks that pair, so the other is cleared.
  const clearPairedField = (field) =>
    setForm((current) =>
      customerSummary || (current.customerName && current.phone)
        ? { ...current, [field]: "" }
        : current
    );

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
        label: `${customer.name}${customer.phone ? ` · ${customer.phone}` : ""}`,
        name: customer.name,
        phone: customer.phone || "",
      })),
    [refs.customers]
  );

  // Raw text in the customer box. The "+" uses this so a name never has to be
  // committed through the dropdown before it can be saved.
  const [customerInput, setCustomerInput] = useState("");

  // Name-only search; phone lookup lives in the phone box next door.
  const filterCustomerOption = useCallback((option, rawInput) => {
    const input = rawInput.trim().toLowerCase();
    // Empty box shows nothing; suggestions only appear once you type.
    if (!input) return false;
    return (option.data.name || "").toLowerCase().includes(input);
  }, []);

  // Phone box suggestions: 3+ digits, matched against digits-only stored phones.
  const [phoneFocused, setPhoneFocused] = useState(false);
  const phoneMatches = useMemo(() => {
    const digits = form.phone.replace(/\D/g, "");
    if (digits.length < 3) return [];
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
      .filter((option) => option.phone.replace(/\D/g, "").includes(digits))
      .slice(0, 8);
  }, [customerOptions, form.phone]);

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

  // What the "+" will save: the committed name, else the raw typed text.
  const pendingCustomerName = (form.customerName || customerInput).trim();

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
        serviceIds.includes(service.id)
      ),
    [refs.services, serviceIds]
  );
  // Rows carry an editable price, so the estimate follows the row not the catalog.
  const subtotal = serviceRows.reduce((sum, row) => {
    if (!row.serviceId) return sum;
    const service = refs.services.find((item) => item.id === row.serviceId);
    return (
      sum +
      Number(row.price === "" || row.price === undefined ? service?.price || 0 : row.price)
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
  // Job carts always start now, so availability is looked up for today at the
  // current clock rather than a chosen date/time.
  const today = todayInputDate();
  const selectedStartKey = `${today}T${currentInputTime()}`;
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
    if (!form.branchId || !today || !serviceIds.length) {
      setAvailableSlots([]);
      setLoadingSlots(false);
      return undefined;
    }
    setLoadingSlots(true);
    salonApi.staffAvailability
      .slots({
        branchId: form.branchId,
        date: today,
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
  }, [form.branchId, today, serviceIds]);

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
        .filter(
          (row, index, rows) => row.serviceId || rows.length === 1 || index === 0
        )
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
        const next = current.filter((row) => row.serviceId !== serviceId);
        return next.length ? next : [newServiceRow()];
      }
      const row = {
        ...newServiceRow(),
        rowId: `service-${Date.now()}-${Math.random()}`,
        serviceId,
        mainServiceId: service.mainService?.id || service.mainServiceId || "",
        staffId: pickerStaffId || "",
        price: String(service.price ?? ""),
      };
      // Drop the leading blank row so the first add does not leave a gap.
      const kept = current.filter((item) => item.serviceId);
      return [...kept, row];
    });
  };

  const removeServiceRow = (rowId) =>
    setServiceRows((current) => {
      const next = current.filter((row) => row.rowId !== rowId);
      return next.length ? next : [newServiceRow()];
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
      // Start time is stamped at submit, not chosen.
      const startTime = new Date();
      const selectedServiceIds = serviceRows
        .map((row) => row.serviceId)
        .filter(Boolean);
      if (new Set(selectedServiceIds).size !== selectedServiceIds.length) {
        throw new Error("Each service can be selected only once.");
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
          ...(row.price === "" ? {} : { price: Number(row.price) }),
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
                      onChange={(event) => {
                        setForm((current) => ({
                          ...current,
                          salonId: event.target.value,
                          branchId: "",
                          packageIds: [],
                        }));
                        setServiceRows([newServiceRow()]);
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
                <Row>
                  <Col md="6">
                    <FormGroup>
                      <Label>Phone Number</Label>
                      <div className="position-relative d-flex align-items-start gap-2">
                      <Input
                        required
                        autoComplete="off"
                        placeholder="Search or enter phone"
                        inputMode="numeric"
                        maxLength={10}
                        value={form.phone}
                        onFocus={() => setPhoneFocused(true)}
                        onBlur={() =>
                          window.setTimeout(() => setPhoneFocused(false), 150)
                        }
                        onChange={(event) => {
                          clearPairedField("customerName");
                          setCustomerSummary(null);
                          setForm((current) => ({
                            ...current,
                            phone: event.target.value
                              .replace(/\D/g, "")
                              .slice(0, 10),
                          }));
                        }}
                      />
                      {phoneFocused && phoneMatches.length > 0 && (
                        <ul
                          className="list-group position-absolute w-100 shadow-sm"
                          style={{ zIndex: 5, maxHeight: 240, overflowY: "auto" }}
                        >
                          {phoneMatches.map((option) => (
                            <li key={option.value} className="list-group-item p-0">
                              <button
                                type="button"
                                className="btn btn-link text-start text-decoration-none w-100 px-3 py-2"
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => {
                                  setPhoneFocused(false);
                                  setCustomerSummary(null);
                                  setForm((current) => ({
                                    ...current,
                                    customerName: option.name,
                                    phone: option.phone,
                                  }));
                                  loadCustomerSummary({ customerId: option.value });
                                }}
                              >
                                {option.name}
                                <span className="text-muted ms-2">
                                  {option.phone}
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                      <CustomerProfileLink customerId={customerSummary?.customerId} />
                      </div>
                    </FormGroup>
                  </Col>
                  <Col md="6">
                    <FormGroup>
                      <Label>Customer</Label>
                      <div className="d-flex align-items-start gap-2">
                        <div className="flex-grow-1" style={{ minWidth: 0 }}>
                          <CreatableSelect
                            className="react-select-container"
                            classNamePrefix="react-select"
                            isClearable
                            isDisabled={loadingRefs || saving}
                            options={customerOptions}
                            filterOption={filterCustomerOption}
                            placeholder="Search by name"
                            value={selectedCustomerOption}
                            onInputChange={(inputValue, meta) => {
                              if (meta.action !== "input-change") return;
                              setCustomerInput(inputValue);
                              // Typing over a *saved* customer breaks the pair.
                              // A phone typed by hand is kept: the "+" needs it.
                              if (inputValue && customerSummary) {
                                clearPairedField("phone");
                              }
                            }}
                            noOptionsMessage={({ inputValue }) =>
                              inputValue
                                ? `No customer matching "${inputValue}"`
                                : "Type a customer name"
                            }
                            formatCreateLabel={(inputValue) =>
                              `Add "${inputValue}" as a new customer`
                            }
                            isValidNewOption={(inputValue) => {
                              const normalized = inputValue.trim().toLowerCase();
                              if (!normalized) return false;
                              // A digits-only input is a phone lookup, not a new name.
                              if (!/[a-z]/i.test(normalized)) return false;
                              // A duplicate name is fine on a free number; the
                              // phone is what has to be unique.
                              return !existingPhoneCustomer;
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
                              // Keep the typed phone: the "+" needs name and
                              // phone together to create the customer.
                              setForm((current) => ({
                                ...current,
                                customerName: inputValue.trim(),
                              }));
                            }}
                          />
                        </div>
                        {!existingPhoneCustomer && (
                        <Button
                          type="button"
                          color="primary"
                          className="flex-shrink-0 d-flex align-items-center justify-content-center"
                          style={{ width: 38, height: 38, padding: 0 }}
                          title="Add as new customer"
                          disabled={
                            saving ||
                            addingCustomer ||
                            !pendingCustomerName ||
                            form.phone.replace(/\D/g, "").length !== 10
                          }
                          onClick={async () => {
                            setAddingCustomer(true);
                            setError("");
                            try {
                              const response = await salonApi.customers.create({
                                name: pendingCustomerName,
                                phone: form.phone.trim(),
                                // Super admins aren't scoped to a salon server-side.
                                ...(form.salonId ? { salonId: form.salonId } : {}),
                              });
                              const customer = response.data;
                              setRefs((current) => ({
                                ...current,
                                customers: [...current.customers, customer],
                              }));
                              setForm((current) => ({
                                ...current,
                                customerName: customer.name,
                                phone: customer.phone || current.phone,
                              }));
                              setCustomerInput("");
                            } catch (createError) {
                              setError(createError.message);
                            } finally {
                              setAddingCustomer(false);
                            }
                          }}
                        >
                          {addingCustomer ? (
                            <Spinner size="sm" />
                          ) : (
                            <Icon name="plus" />
                          )}
                        </Button>
                        )}
                        <CustomerProfileLink customerId={customerSummary?.customerId} />
                      </div>
                      <small className="text-soft">
                        {existingPhoneCustomer
                          ? `${existingPhoneCustomer.name} already uses this number.`
                          : "Adds a new customer using the 10-digit phone and name above."}
                      </small>
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
                          setServiceRows([newServiceRow()]);
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
                          <th>Service</th>
                          <th>Staff</th>
                          <th style={{ width: 90 }}>Qty</th>
                          <th style={{ width: 130 }}>Price</th>
                          <th style={{ width: 100 }}>GST %</th>
                          <th style={{ width: 130 }}>Total</th>
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
                          const rowPrice = Number(
                            row.price === "" || row.price === undefined
                              ? selectedService?.price || 0
                              : row.price
                          );
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
                                    label: `${service.name} - ${formatMoney(
                                      service.price
                                    )}`,
                                  }))}
                                  value={
                                    selectedService
                                      ? {
                                          value: selectedService.id,
                                          label: `${selectedService.name} - ${formatMoney(
                                            selectedService.price
                                          )}`,
                                        }
                                      : null
                                  }
                                  placeholder="Search service"
                                  noOptionsMessage={() => "No services"}
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
                                      price:
                                        service === undefined
                                          ? ""
                                          : String(service.price ?? ""),
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
                                  <option value="">Assign later</option>
                                  {refs.staff.map((member) => (
                                    <option key={member.id} value={member.id}>
                                      {member.name} - {member.jobRole}
                                    </option>
                                  ))}
                                </Input>
                              </td>
                              <td>
                                <Input value="1" disabled />
                              </td>
                              <td>
                                <Input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={row.price}
                                  disabled={!selectedService || saving}
                                  onChange={(event) =>
                                    updateServiceRow(row.rowId, {
                                      price: event.target.value,
                                    })
                                  }
                                />
                              </td>
                              <td>
                                <Input value={serviceGstPercent} disabled />
                              </td>
                              <td>
                                <Input
                                  value={
                                    selectedService
                                      ? formatMoney(rowPrice * (1 + serviceGstPercent / 100))
                                      : ""
                                  }
                                  disabled
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
                  <small className="text-soft">
                    Services covered by selected packages cannot be added as
                    standalone services.
                  </small>
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
            <div className="card card-bordered position-sticky" style={{ top: 90 }}>
              <div className="card-inner">
                <h5>Cart Summary</h5>
                {customerSummary && (
                  <div className="alert alert-light border mb-3">
                    <strong>
                      {customerSummary.customerId ? (
                        <Link to={`/customers/${customerSummary.customerId}`}>
                          {customerSummary.customerName}
                        </Link>
                      ) : (
                        customerSummary.customerName
                      )}
                    </strong>
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
                <div className="d-flex justify-content-between py-2 border-bottom">
                  <span>Estimated subtotal</span>
                  <strong>
                    {formatMoney(subtotal + packageSubtotal)}
                  </strong>
                </div>
                <div className="d-flex justify-content-between py-2 border-bottom">
                  <span>Estimated tax ({serviceGstPercent}%)</span>
                  <strong>{formatMoney(estimatedTax)}</strong>
                </div>
                <div className="d-flex justify-content-between py-3">
                  <span>Estimated total</span>
                  <strong>
                    {formatMoney(subtotal + packageSubtotal + estimatedTax)}
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
