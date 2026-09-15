import { useEffect, useMemo, useState } from "react";
import PageShell from "@/components/salon/PageShell";
import { useAuth } from "@/auth/AuthContext";
import { salonApi } from "@/services/salonApi";

const defaults = {
  salonId: "",
  branchId: "",
  slug: "",
  isEnabled: false,
  allowStaffSelection: true,
  requireApproval: false,
  bookingWindowDays: 30,
  minNoticeMinutes: 120,
  slotIntervalMinutes: 15,
  cancellationPolicyText: "",
  termsText: "",
  themeColor: "#212e6b",
};

const toForm = (setting) => ({
  ...defaults,
  ...setting,
  branchId: setting.branchId || "",
  cancellationPolicyText: setting.cancellationPolicyText || "",
  termsText: setting.termsText || "",
  themeColor: setting.themeColor || "#212e6b",
});

const OnlineBookingSettings = () => {
  const { user } = useAuth();
  const canManage = ["SUPER_ADMIN", "SALON_ADMIN", "BRANCH_MANAGER"].includes(
    user?.role
  );
  const [settings, setSettings] = useState([]);
  const [branches, setBranches] = useState([]);
  const [salons, setSalons] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState(defaults);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const calls = [
        salonApi.publicBookingSettings.list(),
        salonApi.branches.list(),
      ];
      if (user?.role === "SUPER_ADMIN") calls.push(salonApi.salons.list());
      const [settingResult, branchResult, salonResult] = await Promise.all(calls);
      setSettings(settingResult.data);
      setBranches(branchResult.data);
      setSalons(salonResult?.data || []);
      if (settingResult.data.length > 0 && !selectedId) {
        setSelectedId(settingResult.data[0].id);
        setForm(toForm(settingResult.data[0]));
      } else if (
        settingResult.data.length === 0 &&
        user?.role !== "SUPER_ADMIN"
      ) {
        setForm((current) => ({
          ...current,
          salonId: user?.salonId || "",
          branchId:
            user?.role === "BRANCH_MANAGER" ? user?.branchId || "" : "",
        }));
      }
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // The settings screen reloads explicitly after every mutation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visibleBranches = useMemo(
    () =>
      form.salonId
        ? branches.filter((branch) => branch.salonId === form.salonId)
        : branches,
    [branches, form.salonId]
  );

  const bookingLink = form.slug
    ? `${window.location.origin}/book/${form.slug}`
    : "";
  const iframe = bookingLink
    ? `<iframe src="${bookingLink}" width="100%" height="700" style="border:0" loading="lazy"></iframe>`
    : "";

  const selectSetting = (id) => {
    setSelectedId(id);
    const selected = settings.find((setting) => setting.id === id);
    if (selected) setForm(toForm(selected));
    setMessage("");
    setError("");
  };

  const newSetting = () => {
    setSelectedId("");
    setForm({
      ...defaults,
      salonId: user?.salonId || "",
      branchId:
        user?.role === "BRANCH_MANAGER" ? user?.branchId || "" : "",
    });
    setMessage("");
    setError("");
  };

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    setError("");
    const payload = {
      ...(user?.role === "SUPER_ADMIN" ? { salonId: form.salonId } : {}),
      branchId: form.branchId || null,
      slug: form.slug,
      isEnabled: form.isEnabled,
      allowStaffSelection: form.allowStaffSelection,
      requireApproval: form.requireApproval,
      bookingWindowDays: Number(form.bookingWindowDays),
      minNoticeMinutes: Number(form.minNoticeMinutes),
      slotIntervalMinutes: Number(form.slotIntervalMinutes),
      cancellationPolicyText: form.cancellationPolicyText || null,
      termsText: form.termsText || null,
      themeColor: form.themeColor || null,
    };
    try {
      const result = selectedId
        ? await salonApi.publicBookingSettings.update(selectedId, payload)
        : await salonApi.publicBookingSettings.create(payload);
      setSelectedId(result.data.id);
      setForm(toForm(result.data));
      setMessage("Online booking settings saved.");
      const refreshed = await salonApi.publicBookingSettings.list();
      setSettings(refreshed.data);
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async () => {
    if (!selectedId) return;
    setError("");
    try {
      const result = await salonApi.publicBookingSettings.setStatus(
        selectedId,
        !form.isEnabled
      );
      setForm(toForm(result.data));
      setSettings((current) =>
        current.map((setting) =>
          setting.id === selectedId ? result.data : setting
        )
      );
      setMessage(`Online booking ${result.data.isEnabled ? "enabled" : "disabled"}.`);
    } catch (nextError) {
      setError(nextError.message);
    }
  };

  const copy = async (value, label) => {
    await navigator.clipboard.writeText(value);
    setMessage(`${label} copied.`);
  };

  return (
    <PageShell
      title="Online Booking"
      description="Publish a customer booking page or embed it in your salon website."
      actionLabel={canManage ? "New setting" : undefined}
      onAction={newSetting}
    >
      {error && <div className="alert alert-danger">{error}</div>}
      {message && <div className="alert alert-success">{message}</div>}
      <div className="row g-4">
        <div className="col-xl-3">
          <div className="card">
            <div className="card-inner">
              <h6 className="mb-3">Booking pages</h6>
              {loading && <p className="text-soft">Loading…</p>}
              {!loading && settings.length === 0 && (
                <p className="text-soft small">No booking page configured yet.</p>
              )}
              <div className="list-group list-group-flush">
                {settings.map((setting) => (
                  <button
                    type="button"
                    key={setting.id}
                    className={`list-group-item list-group-item-action px-0 ${
                      selectedId === setting.id ? "active" : ""
                    }`}
                    onClick={() => selectSetting(setting.id)}
                  >
                    <strong className="d-block">/{setting.slug}</strong>
                    <small>
                      {setting.branch?.name || "All branches"} ·{" "}
                      {setting.isEnabled ? "Enabled" : "Disabled"}
                    </small>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="col-xl-9">
          <form className="card" onSubmit={save}>
            <div className="card-inner">
              <div className="d-flex justify-content-between align-items-center mb-4">
                <div>
                  <h5 className="mb-1">Booking page settings</h5>
                  <p className="text-soft mb-0">Changes are audited transactionally.</p>
                </div>
                {selectedId && canManage && (
                  <button
                    type="button"
                    className={`btn btn-sm ${
                      form.isEnabled ? "btn-outline-danger" : "btn-outline-success"
                    }`}
                    onClick={toggleStatus}
                  >
                    {form.isEnabled ? "Disable" : "Enable"}
                  </button>
                )}
              </div>

              <fieldset disabled={!canManage}>
                <div className="row g-3">
                  {user?.role === "SUPER_ADMIN" && (
                    <div className="col-md-6">
                      <label className="form-label">Salon</label>
                      <select
                        className="form-select"
                        required
                        value={form.salonId}
                        onChange={(event) =>
                          setForm({
                            ...form,
                            salonId: event.target.value,
                            branchId: "",
                          })
                        }
                      >
                        <option value="">Choose salon</option>
                        {salons.map((salon) => (
                          <option value={salon.id} key={salon.id}>{salon.name}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div className="col-md-6">
                    <label className="form-label">Scope</label>
                    <select
                      className="form-select"
                      value={form.branchId}
                      disabled={user?.role === "BRANCH_MANAGER"}
                      onChange={(event) =>
                        setForm({ ...form, branchId: event.target.value })
                      }
                    >
                      <option value="">Salon-wide (all branches)</option>
                      {visibleBranches.map((branch) => (
                        <option value={branch.id} key={branch.id}>{branch.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="col-md-6">
                    <label className="form-label">Public slug</label>
                    <div className="input-group">
                      <span className="input-group-text">/book/</span>
                      <input
                        className="form-control"
                        required
                        pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                        value={form.slug}
                        onChange={(event) =>
                          setForm({
                            ...form,
                            slug: event.target.value
                              .toLowerCase()
                              .replace(/[^a-z0-9-]/g, ""),
                          })
                        }
                      />
                    </div>
                  </div>
                  <div className="col-md-3">
                    <label className="form-label">Booking window (days)</label>
                    <input
                      type="number"
                      min="1"
                      max="365"
                      className="form-control"
                      value={form.bookingWindowDays}
                      onChange={(event) =>
                        setForm({ ...form, bookingWindowDays: event.target.value })
                      }
                    />
                  </div>
                  <div className="col-md-3">
                    <label className="form-label">Minimum notice (minutes)</label>
                    <input
                      type="number"
                      min="0"
                      className="form-control"
                      value={form.minNoticeMinutes}
                      onChange={(event) =>
                        setForm({ ...form, minNoticeMinutes: event.target.value })
                      }
                    />
                  </div>
                  <div className="col-md-3">
                    <label className="form-label">Slot interval</label>
                    <select
                      className="form-select"
                      value={form.slotIntervalMinutes}
                      onChange={(event) =>
                        setForm({ ...form, slotIntervalMinutes: event.target.value })
                      }
                    >
                      {[5, 10, 15, 20, 30, 45, 60].map((value) => (
                        <option value={value} key={value}>{value} minutes</option>
                      ))}
                    </select>
                  </div>
                  <div className="col-md-3">
                    <label className="form-label">Theme color</label>
                    <input
                      type="color"
                      className="form-control form-control-color w-100"
                      value={form.themeColor}
                      onChange={(event) =>
                        setForm({ ...form, themeColor: event.target.value })
                      }
                    />
                  </div>
                  <div className="col-12 d-flex flex-wrap gap-4">
                    <label className="form-check">
                      <input
                        type="checkbox"
                        className="form-check-input"
                        checked={form.allowStaffSelection}
                        onChange={(event) =>
                          setForm({
                            ...form,
                            allowStaffSelection: event.target.checked,
                          })
                        }
                      />
                      <span className="form-check-label">Allow staff selection</span>
                    </label>
                    <label className="form-check">
                      <input
                        type="checkbox"
                        className="form-check-input"
                        checked={form.requireApproval}
                        onChange={(event) =>
                          setForm({ ...form, requireApproval: event.target.checked })
                        }
                      />
                      <span className="form-check-label">Require approval</span>
                    </label>
                  </div>
                  <div className="col-md-6">
                    <label className="form-label">Cancellation policy</label>
                    <textarea
                      className="form-control"
                      rows="4"
                      value={form.cancellationPolicyText}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          cancellationPolicyText: event.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label">Terms</label>
                    <textarea
                      className="form-control"
                      rows="4"
                      value={form.termsText}
                      onChange={(event) =>
                        setForm({ ...form, termsText: event.target.value })
                      }
                    />
                  </div>
                </div>
              </fieldset>
            </div>
            {canManage && (
              <div className="card-inner border-top text-end">
                <button className="btn btn-primary" disabled={saving}>
                  {saving ? "Saving…" : "Save settings"}
                </button>
              </div>
            )}
          </form>

          {bookingLink && (
            <div className="card mt-4">
              <div className="card-inner">
                <h5>Website link & widget</h5>
                <p className="text-soft">
                  Share the direct link or paste the iframe into your website.
                </p>
                <label className="form-label">Booking link</label>
                <div className="input-group mb-3">
                  <input className="form-control" readOnly value={bookingLink} />
                  <button
                    type="button"
                    className="btn btn-outline-primary"
                    onClick={() => copy(bookingLink, "Booking link")}
                  >
                    Copy
                  </button>
                </div>
                <label className="form-label">Iframe embed code</label>
                <div className="input-group">
                  <textarea className="form-control font-monospace" readOnly value={iframe} />
                  <button
                    type="button"
                    className="btn btn-outline-primary"
                    onClick={() => copy(iframe, "Iframe code")}
                  >
                    Copy
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </PageShell>
  );
};

export default OnlineBookingSettings;
