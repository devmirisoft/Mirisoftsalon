import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { salonApi } from "@/services/salonApi";
import { LoaderOne } from "@/components/ui/loader";

const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
};

const formatTime = (value, timezone) =>
  new Intl.DateTimeFormat("en-IN", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));

const PublicBooking = () => {
  const { slug } = useParams();
  const [config, setConfig] = useState(null);
  const [branches, setBranches] = useState([]);
  const [branchId, setBranchId] = useState("");
  const [services, setServices] = useState([]);
  const [staff, setStaff] = useState([]);
  const [selectedServices, setSelectedServices] = useState([]);
  const [staffId, setStaffId] = useState("");
  const [date, setDate] = useState(today());
  const [slots, setSlots] = useState([]);
  const [slot, setSlot] = useState(null);
  const [details, setDetails] = useState({
    customerName: "",
    customerPhone: "",
    customerEmail: "",
    note: "",
  });
  const [loading, setLoading] = useState(true);
  const [slotLoading, setSlotLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(null);

  useEffect(() => {
    Promise.all([
      salonApi.publicBooking.config(slug),
      salonApi.publicBooking.branches(slug),
    ])
      .then(([configResult, branchResult]) => {
        setConfig(configResult.data);
        setBranches(branchResult.data);
        const initial =
          configResult.data.branch?.id ||
          (branchResult.data.length === 1 ? branchResult.data[0].id : "");
        setBranchId(initial);
      })
      .catch((nextError) => setError(nextError.message))
      .finally(() => setLoading(false));
  }, [slug]);

  useEffect(() => {
    if (!branchId) return;
    setSelectedServices([]);
    setStaffId("");
    setSlots([]);
    setSlot(null);
    salonApi.publicBooking
      .services(slug, branchId)
      .then((result) => {
        setServices(result.data);
        setStaff(result.staff || []);
      })
      .catch((nextError) => setError(nextError.message));
  }, [branchId, slug]);

  const total = useMemo(
    () =>
      services
        .filter((service) => selectedServices.includes(service.id))
        .reduce((sum, service) => sum + Number(service.price), 0),
    [selectedServices, services]
  );

  const toggleService = (id) => {
    setSelectedServices((current) =>
      current.includes(id)
        ? current.filter((serviceId) => serviceId !== id)
        : [...current, id]
    );
    setSlots([]);
    setSlot(null);
  };

  const loadSlots = async () => {
    setError("");
    setSlotLoading(true);
    setSlot(null);
    try {
      const result = await salonApi.publicBooking.slots(slug, {
        branchId,
        serviceIds: selectedServices.join(","),
        ...(staffId ? { staffId } : {}),
        date,
      });
      setSlots(result.data.slots);
    } catch (nextError) {
      setSlots([]);
      setError(nextError.message);
    } finally {
      setSlotLoading(false);
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!slot) return;
    setError("");
    setSubmitting(true);
    try {
      const result = await salonApi.publicBooking.book(slug, {
        branchId,
        customerName: details.customerName,
        customerPhone: details.customerPhone,
        ...(details.customerEmail
          ? { customerEmail: details.customerEmail }
          : {}),
        serviceIds: selectedServices,
        staffId: slot.staffId,
        startTime: slot.startTime,
        ...(details.note ? { note: details.note } : {}),
      });
      setSuccess(result.data);
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="container py-5 text-center">
        <LoaderOne label="Loading online booking" />
        <p className="text-soft mt-2 mb-0">Loading online booking...</p>
      </div>
    );
  }
  if (!config) {
    return (
      <div className="container py-5">
        <div className="alert alert-warning">{error || "Online booking is unavailable."}</div>
      </div>
    );
  }
  if (success) {
    return (
      <main className="container py-5" style={{ maxWidth: 720 }}>
        <div className="card border-0 shadow-sm text-center p-4 p-md-5">
          <div
            className="rounded-circle text-white mx-auto mb-4 d-flex align-items-center justify-content-center"
            style={{ width: 64, height: 64, background: config.themeColor || "#6576ff" }}
          >
            ✓
          </div>
          <h2>Booking received</h2>
          <p className="text-soft mb-1">
            {config.requireApproval
              ? "The salon will review your appointment."
              : "Your appointment is scheduled."}
          </p>
          <p className="mt-4 mb-1 text-uppercase small text-soft">Appointment code</p>
          <h3 style={{ color: config.themeColor || "#6576ff" }}>
            {success.appointmentCode}
          </h3>
          <p className="mt-3">
            {formatTime(success.startTime, config.salon.timezone)}
          </p>
        </div>
      </main>
    );
  }

  const accent = config.themeColor || "#6576ff";
  return (
    <main className="container py-4 py-md-5" style={{ maxWidth: 920 }}>
      <header className="text-center mb-4">
        <div className="text-uppercase small fw-bold mb-2" style={{ color: accent }}>
          Online booking
        </div>
        <h1 className="mb-2">{config.salon.name}</h1>
        <p className="text-soft">Choose what suits you. We’ll take care of the rest.</p>
      </header>

      {error && <div className="alert alert-danger">{error}</div>}
      <div className="card border-0 shadow-sm">
        <div className="card-body p-3 p-md-5">
          <section className="mb-5">
            <h5><span style={{ color: accent }}>01.</span> Select branch</h5>
            <select
              className="form-select mt-3"
              value={branchId}
              onChange={(event) => setBranchId(event.target.value)}
              disabled={Boolean(config.branch)}
            >
              <option value="">Choose a branch</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>{branch.name}</option>
              ))}
            </select>
          </section>

          <section className="mb-5">
            <h5><span style={{ color: accent }}>02.</span> Select services</h5>
            <div className="row g-3 mt-1">
              {services.map((service) => (
                <div className="col-md-6" key={service.id}>
                  <label className="border rounded p-3 d-flex gap-3 h-100 cursor-pointer">
                    <input
                      type="checkbox"
                      className="form-check-input"
                      checked={selectedServices.includes(service.id)}
                      onChange={() => toggleService(service.id)}
                    />
                    <span className="flex-grow-1">
                      <strong className="d-block">{service.name}</strong>
                      <small className="text-soft">
                        {service.durationValue || 0} {service.durationUnit.toLowerCase()}
                      </small>
                    </span>
                    <strong>₹{Number(service.price).toLocaleString("en-IN")}</strong>
                  </label>
                </div>
              ))}
            </div>
            {selectedServices.length > 0 && (
              <div className="text-end mt-3 fw-bold">
                Estimated total: ₹{total.toLocaleString("en-IN")}
              </div>
            )}
          </section>

          {config.allowStaffSelection && (
            <section className="mb-5">
              <h5><span style={{ color: accent }}>03.</span> Select professional</h5>
              <select
                className="form-select mt-3"
                value={staffId}
                onChange={(event) => {
                  setStaffId(event.target.value);
                  setSlots([]);
                  setSlot(null);
                }}
              >
                <option value="">Any available staff</option>
                {staff.map((member) => (
                  <option value={member.id} key={member.id}>
                    {member.name} — {member.jobRole}
                  </option>
                ))}
              </select>
            </section>
          )}

          <section className="mb-5">
            <h5>
              <span style={{ color: accent }}>
                {config.allowStaffSelection ? "04." : "03."}
              </span>{" "}
              Choose date and time
            </h5>
            <div className="row g-2 mt-2">
              <div className="col-md-8">
                <input
                  type="date"
                  className="form-control"
                  min={today()}
                  value={date}
                  onChange={(event) => {
                    setDate(event.target.value);
                    setSlots([]);
                    setSlot(null);
                  }}
                />
              </div>
              <div className="col-md-4 d-grid">
                <button
                  type="button"
                  className="btn text-white"
                  style={{ background: accent }}
                  disabled={!branchId || selectedServices.length === 0 || slotLoading}
                  onClick={loadSlots}
                >
                  {slotLoading ? "Checking…" : "Find times"}
                </button>
              </div>
            </div>
            <div className="d-flex flex-wrap gap-2 mt-3">
              {slots.map((item) => (
                <button
                  key={`${item.staffId}-${item.startTime}`}
                  type="button"
                  className={`btn ${slot === item ? "text-white" : "btn-outline-light text-dark"}`}
                  style={slot === item ? { background: accent } : {}}
                  onClick={() => setSlot(item)}
                  title={config.allowStaffSelection ? item.staffName : undefined}
                >
                  {formatTime(item.startTime, config.salon.timezone)}
                </button>
              ))}
              {!slotLoading && slots.length === 0 && selectedServices.length > 0 && (
                <span className="text-soft small">Find times to see availability.</span>
              )}
            </div>
          </section>

          <form onSubmit={submit}>
            <h5>
              <span style={{ color: accent }}>
                {config.allowStaffSelection ? "05." : "04."}
              </span>{" "}
              Your details
            </h5>
            <div className="row g-3 mt-1">
              <div className="col-md-6">
                <label className="form-label">Name</label>
                <input
                  className="form-control"
                  required
                  minLength={2}
                  value={details.customerName}
                  onChange={(event) =>
                    setDetails({ ...details, customerName: event.target.value })
                  }
                />
              </div>
              <div className="col-md-6">
                <label className="form-label">Phone</label>
                <input
                  className="form-control"
                  type="tel"
                  required
                  value={details.customerPhone}
                  onChange={(event) =>
                    setDetails({ ...details, customerPhone: event.target.value })
                  }
                />
              </div>
              <div className="col-md-6">
                <label className="form-label">Email <span className="text-soft">(optional)</span></label>
                <input
                  className="form-control"
                  type="email"
                  value={details.customerEmail}
                  onChange={(event) =>
                    setDetails({ ...details, customerEmail: event.target.value })
                  }
                />
              </div>
              <div className="col-md-6">
                <label className="form-label">Note <span className="text-soft">(optional)</span></label>
                <input
                  className="form-control"
                  value={details.note}
                  onChange={(event) =>
                    setDetails({ ...details, note: event.target.value })
                  }
                />
              </div>
            </div>
            {config.termsText && (
              <p className="small text-soft mt-3 mb-0">{config.termsText}</p>
            )}
            {config.cancellationPolicyText && (
              <p className="small text-soft mt-2 mb-0">
                Cancellation policy: {config.cancellationPolicyText}
              </p>
            )}
            <button
              className="btn text-white w-100 mt-4 py-3"
              style={{ background: accent }}
              disabled={!slot || submitting}
            >
              {submitting ? "Confirming…" : "Confirm booking"}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
};

export default PublicBooking;
