/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
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
import { useAuth } from "@/auth/AuthContext";
import { salonApi } from "@/services/salonApi";
import {
  currentInputTime,
  formatDate,
  formatMoney,
  todayInputDate,
  toLocalInput,
} from "@/utils/salonFormat";

const nowParts = () => {
  return {
    date: todayInputDate(),
    time: currentInputTime(),
  };
};

const newServiceRow = () => ({
  rowId: `service-${Date.now()}-${Math.random()}`,
  mainServiceId: "",
  serviceId: "",
  staffId: "",
});

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
    packageIds: [],
  });
  const [serviceRows, setServiceRows] = useState([newServiceRow()]);
  // Staff chosen in the picker; services picked afterwards attach to them.
  const [pickerStaffId, setPickerStaffId] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerCategoryId, setPickerCategoryId] = useState("");
  const [pickerSearch, setPickerSearch] = useState("");
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
    if (phoneDigits.length < 7) {
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
        serviceIds.includes(service.id)
      ),
    [refs.services, serviceIds]
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
  const serviceGstPercent =
    refs.salon?.gstEnabled === false
      ? 0
      : Number(refs.salon?.serviceGstRate ?? 0);
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
  const selectedStartKey = `${form.date}T${form.time}`;
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
  const pickerStaffOptions = useMemo(
    () =>
      serviceIds.length ? availableStaffAtSelectedTime : refs.staff,
    [serviceIds.length, availableStaffAtSelectedTime, refs.staff]
  );

  const availableStaffIds = useMemo(
    () => new Set(availableStaffAtSelectedTime.map((member) => member.id)),
    [availableStaffAtSelectedTime]
  );
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

  const pickerStaffName = useMemo(
    () =>
      pickerStaffOptions.find((member) => member.id === pickerStaffId)?.name ||
      "",
    [pickerStaffOptions, pickerStaffId]
  );

  // Rows keyed by service, so the list can show what is already in the cart
  // and which staff each one went to.
  const rowsByServiceId = useMemo(() => {
    const map = new Map();
    serviceRows.forEach((row) => {
      if (row.serviceId) map.set(row.serviceId, row);
    });
    return map;
  }, [serviceRows]);

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

  // Main-service categories offered by the services still available to add.
  const pickerCategories = useMemo(() => {
    const seen = new Map();
    pickerServiceOptions.forEach((option) => {
      if (option.mainServiceId && !seen.has(option.mainServiceId)) {
        seen.set(option.mainServiceId, option.mainServiceName);
      }
    });
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [pickerServiceOptions]);

  // Narrow the checkbox list by the chosen category and the search box.
  const pickerVisibleServices = useMemo(() => {
    const term = pickerSearch.trim().toLowerCase();
    return pickerServiceOptions.filter((option) => {
      if (pickerCategoryId && option.mainServiceId !== pickerCategoryId) {
        return false;
      }
      return !term || option.name.toLowerCase().includes(term);
    });
  }, [pickerServiceOptions, pickerCategoryId, pickerSearch]);

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
      const startTime = new Date(`${form.date}T${form.time}:00`);
      if (Number.isNaN(startTime.getTime())) {
        throw new Error("Choose a valid date and start time");
      }
      if (startTime < new Date()) {
        throw new Error("Choose a start date and time from now onward.");
      }
      const selectedServiceIds = serviceRows
        .map((row) => row.serviceId)
        .filter(Boolean);
      if (new Set(selectedServiceIds).size !== selectedServiceIds.length) {
        throw new Error("Each service can be selected only once.");
      }
      const invalidStaff = serviceRows.find(
        (row) => row.staffId && !availableStaffIds.has(row.staffId)
      );
      if (invalidStaff) {
        throw new Error(
          "Selected staff is not available at this start time. Choose an available slot or leave staff unassigned."
        );
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
                        setPickerSearch("");
                        setPickerCategoryId("");
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
                        onChange={(event) => {
                          setForm((current) => ({
                            ...current,
                            branchId: event.target.value,
                            packageIds: [],
                          }));
                          setServiceRows([newServiceRow()]);
                          setPickerStaffId("");
                          setPickerOpen(false);
                          setPickerSearch("");
                          setPickerCategoryId("");
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
                {serviceIds.length > 0 && (
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
                )}
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
                                    loadingSlots ||
                                    saving
                                  }
                                  onChange={(event) =>
                                    updateServiceRow(row.rowId, {
                                      staffId: event.target.value,
                                    })
                                  }
                                >
                                  <option value="">Assign later</option>
                                  {/* Keep an assigned-but-unavailable staff
                                      visible so the cell never looks blank;
                                      submit still blocks on this. */}
                                  {row.staffId &&
                                    !availableStaffIds.has(row.staffId) && (
                                      <option value={row.staffId}>
                                        {refs.staff.find(
                                          (member) => member.id === row.staffId
                                        )?.name || "Assigned staff"}{" "}
                                        (unavailable)
                                      </option>
                                    )}
                                  {availableStaffAtSelectedTime.map((member) => (
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
                                  value={
                                    selectedService
                                      ? formatMoney(selectedService.price)
                                      : ""
                                  }
                                  disabled
                                />
                              </td>
                              <td>
                                <Input value={serviceGstPercent} disabled />
                              </td>
                              <td>
                                <Input
                                  value={
                                    selectedService
                                      ? formatMoney(selectedService.price * (1 - 1 / (1 + serviceGstPercent)))
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
      <Modal
        isOpen={pickerOpen}
        toggle={() => setPickerOpen(false)}
        centered
        size="xl"
        contentClassName="border-0"
      >
        <ModalHeader toggle={() => setPickerOpen(false)}>
          Add Services
        </ModalHeader>
        <ModalBody>
          {/* Choose the staff first; every service checked below is added
              to the cart assigned to them. */}
          <Row className="g-3 mb-3">
            <Col md="4">
              <Label className="mb-1">Category</Label>
              <Input
                type="select"
                value={pickerCategoryId}
                onChange={(event) => setPickerCategoryId(event.target.value)}
              >
                <option value="">All services</option>
                {pickerCategories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </Input>
            </Col>
            <Col md="4">
              <Label className="mb-1">Assign next to</Label>
              <Input
                type="select"
                value={pickerStaffId}
                disabled={saving}
                onChange={(event) => setPickerStaffId(event.target.value)}
              >
                <option value="">Assign later</option>
                {pickerStaffOptions.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                    {member.jobRole ? ` - ${member.jobRole}` : ""}
                  </option>
                ))}
              </Input>
            </Col>
            <Col md="4">
              <Label className="mb-1">Search</Label>
              <Input
                type="search"
                placeholder="Search services"
                value={pickerSearch}
                onChange={(event) => setPickerSearch(event.target.value)}
              />
            </Col>
          </Row>
          <div
            className="border rounded"
            style={{ maxHeight: 380, overflowY: "auto" }}
          >
            {pickerVisibleServices.length === 0 ? (
              <div className="text-soft text-center py-4">
                No services match this search
              </div>
            ) : (
              // Two columns so the wider modal is not mostly empty space.
              // CSS grid rather than a Bootstrap row: .row's negative margins
              // overflow this scroll container and collapse the cells.
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                }}
              >
                {pickerVisibleServices.map((option) => {
                  const addedRow = rowsByServiceId.get(option.id);
                  // Staff is decided solely by "Assign next to" above, at the
                  // moment a service is checked; the row just reflects it.
                  const assignedName = addedRow?.staffId
                    ? pickerStaffOptions.find(
                        (member) => member.id === addedRow.staffId
                      )?.name
                    : "";
                  return (
                    <div key={option.id} style={{ minWidth: 0 }}>
                      <label
                        className="d-flex align-items-center gap-2 px-3 py-2 border-bottom mb-0 h-100"
                        style={{ cursor: "pointer", minWidth: 0 }}
                      >
                        <input
                          type="checkbox"
                          className="form-check-input mt-0 flex-shrink-0"
                          checked={Boolean(addedRow)}
                          onChange={() => togglePickerService(option.id)}
                        />
                        <span className="text-truncate" style={{ minWidth: 0 }}>
                          <span className="d-block text-truncate">
                            {option.name}
                          </span>
                          <small className="text-soft">
                            {option.mainServiceName} -{" "}
                            {formatMoney(option.price)}
                            {addedRow ? ` - ${assignedName || "unassigned"}` : ""}
                          </small>
                        </span>
                      </label>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div className="d-flex justify-content-between align-items-center mt-3">
            <span className="text-soft">
              {rowsByServiceId.size} in cart
              {pickerStaffName ? ` - adding for ${pickerStaffName}` : ""}
            </span>
            <Button
              color="primary"
              type="button"
              onClick={() => setPickerOpen(false)}
            >
              Done
            </Button>
          </div>
        </ModalBody>
      </Modal>
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
