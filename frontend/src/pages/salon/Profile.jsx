/* eslint-disable react/prop-types */
import { useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  Col,
  Form,
  FormGroup,
  Input,
  Label,
  Nav,
  NavItem,
  NavLink,
  Row,
  Spinner,
} from "reactstrap";
import PageShell from "@/components/salon/PageShell";
import { salonApi } from "@/services/salonApi";

const tabs = [
  ["profile", "My Profile"],
  ["salon", "Salon Details"],
  ["branch", "Branch Details"],
  ["gst", "Tax & GST"],
];

const editableSalonRoles = new Set(["SUPER_ADMIN", "SALON_ADMIN"]);
const editableBranchRoles = new Set(["SUPER_ADMIN", "SALON_ADMIN", "BRANCH_MANAGER"]);

const emptyToNull = (value) => {
  const trimmed = typeof value === "string" ? value.trim() : value;
  return trimmed === "" ? null : trimmed;
};

const valueOf = (value) => value ?? "";

const Field = ({
  label,
  value,
  onChange,
  readOnly,
  type = "text",
  options,
  checked,
}) => (
  <FormGroup>
    <Label className="form-label">{label}</Label>
    {type === "checkbox" ? (
      <div className="custom-control custom-control-sm custom-checkbox">
        <Input
          type="checkbox"
          className="custom-control-input"
          checked={Boolean(checked)}
          disabled={readOnly}
          onChange={(event) => onChange(event.target.checked)}
        />
      </div>
    ) : options ? (
      <Input
        type="select"
        value={valueOf(value)}
        disabled={readOnly}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </Input>
    ) : (
      <Input
        type={type}
        value={valueOf(value)}
        disabled={readOnly}
        readOnly={readOnly}
        onChange={(event) => onChange(event.target.value)}
      />
    )}
    {readOnly && <small className="text-soft">Read-only</small>}
  </FormGroup>
);

const SaveButton = ({ disabled }) => (
  <Button color="primary" disabled={disabled}>
    {disabled ? <Spinner size="sm" /> : null}
    <span className="ms-1">Save</span>
  </Button>
);

const cleanError = (error) => error?.message || "Request failed";

const Profile = () => {
  const [activeTab, setActiveTab] = useState("profile");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState("");
  const [error, setError] = useState("");
  const [profile, setProfile] = useState(null);
  const [salon, setSalon] = useState(null);
  const [branch, setBranch] = useState(null);
  const [gst, setGst] = useState(null);

  const role = profile?.role;
  const canEditSalon = editableSalonRoles.has(role);
  const canEditBranch = editableBranchRoles.has(role);
  const canEditGst = editableSalonRoles.has(role);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    Promise.allSettled([
      salonApi.profile.get(),
      salonApi.profile.salon(),
      salonApi.profile.branch(),
      salonApi.profile.gst(),
    ])
      .then(([profileRes, salonRes, branchRes, gstRes]) => {
        if (!active) return;
        if (profileRes.status === "fulfilled") setProfile(profileRes.value.data);
        if (salonRes.status === "fulfilled") setSalon(salonRes.value.data);
        if (branchRes.status === "fulfilled") setBranch(branchRes.value.data);
        if (gstRes.status === "fulfilled") setGst(gstRes.value.data);
        if (profileRes.status === "rejected") throw profileRes.reason;
      })
      .catch((nextError) => {
        if (active) setError(cleanError(nextError));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const timezoneOptions = useMemo(
    () => ["Asia/Kolkata", "UTC", "Asia/Dubai", "Asia/Singapore"],
    []
  );

  const submit = async (key, fn, setter, body) => {
    setSubmitting(key);
    try {
      const response = await fn(body);
      setter(response.data);
      toast.success("Saved successfully");
    } catch (nextError) {
      toast.error(cleanError(nextError));
    } finally {
      setSubmitting("");
    }
  };

  if (loading) {
    return (
      <PageShell title="Profile" description="Manage your account, salon, branch, and tax settings">
        <div className="py-5 text-center text-primary">
          <Spinner size="sm" />
          <span className="ms-2">Loading profile...</span>
        </div>
      </PageShell>
    );
  }

  if (error) {
    return (
      <PageShell title="Profile" description="Manage your account, salon, branch, and tax settings">
        <Alert color="danger">{error}</Alert>
      </PageShell>
    );
  }

  if (!profile) {
    return (
      <PageShell title="Profile" description="Manage your account, salon, branch, and tax settings">
        <Card><CardBody className="text-center text-soft">No profile data found.</CardBody></Card>
      </PageShell>
    );
  }

  return (
    <PageShell title="Profile" description="Manage your account, salon, branch, and tax settings">
      <Nav tabs className="mb-4">
        {tabs.map(([key, label]) => (
          <NavItem key={key}>
            <NavLink
              href="#"
              active={activeTab === key}
              onClick={(event) => {
                event.preventDefault();
                setActiveTab(key);
              }}
            >
              {label}
            </NavLink>
          </NavItem>
        ))}
      </Nav>

      {activeTab === "profile" && (
        <Card>
          <CardBody>
            <Form
              onSubmit={(event) => {
                event.preventDefault();
                submit("profile", salonApi.profile.update, setProfile, {
                  fullName: profile.fullName,
                  phone: emptyToNull(profile.phone),
                });
              }}
            >
              <Row className="g-3">
                <Col md="6">
                  <Field label="Full name" value={profile.fullName} onChange={(fullName) => setProfile({ ...profile, fullName })} />
                </Col>
                <Col md="6">
                  <Field label="Phone" value={profile.phone} onChange={(phone) => setProfile({ ...profile, phone })} />
                </Col>
                <Col md="6"><Field label="Email" value={profile.email} readOnly /></Col>
                <Col md="6"><Field label="Role" value={profile.role} readOnly /></Col>
                <Col md="6"><Field label="Current salon" value={profile.currentSalon?.name || profile.salonId} readOnly /></Col>
                <Col md="6"><Field label="Current branch" value={profile.currentBranch?.name || profile.branchId} readOnly /></Col>
                <Col md="6"><Field label="salonId" value={profile.salonId} readOnly /></Col>
                <Col md="6"><Field label="branchId" value={profile.branchId} readOnly /></Col>
              </Row>
              <div className="mt-3"><SaveButton disabled={submitting === "profile"} /></div>
            </Form>
          </CardBody>
        </Card>
      )}

      {activeTab === "salon" && (
        <Card>
          <CardBody>
            {!salon ? (
              <div className="text-soft">No salon details found.</div>
            ) : (
              <Form onSubmit={(event) => {
                event.preventDefault();
                submit("salon", salonApi.profile.updateSalon, setSalon, salon);
              }}>
                <Row className="g-3">
                  <Col md="6"><Field label="Salon name" value={salon.name} readOnly={!canEditSalon} onChange={(name) => setSalon({ ...salon, name })} /></Col>
                  <Col md="6"><Field label="Legal/business name" value={salon.legalName} readOnly={!canEditSalon} onChange={(legalName) => setSalon({ ...salon, legalName })} /></Col>
                  <Col md="6"><Field label="Email" value={salon.email} readOnly={!canEditSalon} onChange={(email) => setSalon({ ...salon, email })} /></Col>
                  <Col md="6"><Field label="Phone" value={salon.phone} readOnly={!canEditSalon} onChange={(phone) => setSalon({ ...salon, phone })} /></Col>
                  <Col md="6"><Field label="Address" value={salon.addressLine1} readOnly={!canEditSalon} onChange={(addressLine1) => setSalon({ ...salon, addressLine1 })} /></Col>
                  <Col md="6"><Field label="City" value={salon.city} readOnly={!canEditSalon} onChange={(city) => setSalon({ ...salon, city })} /></Col>
                  <Col md="4"><Field label="State" value={salon.state} readOnly={!canEditSalon} onChange={(state) => setSalon({ ...salon, state })} /></Col>
                  <Col md="4"><Field label="Pincode" value={salon.postalCode} readOnly={!canEditSalon} onChange={(postalCode) => setSalon({ ...salon, postalCode })} /></Col>
                  <Col md="4"><Field label="Timezone" value={salon.timezone} readOnly={!canEditSalon} options={timezoneOptions} onChange={(timezone) => setSalon({ ...salon, timezone })} /></Col>
                  <Col md="6"><Field label="Status" value={salon.status ? "Active" : "Inactive"} readOnly /></Col>
                  <Col md="6"><Field label="Created date" value={salon.createdAt ? new Date(salon.createdAt).toLocaleDateString() : ""} readOnly /></Col>
                </Row>
                {canEditSalon && <div className="mt-3"><SaveButton disabled={submitting === "salon"} /></div>}
              </Form>
            )}
          </CardBody>
        </Card>
      )}

      {activeTab === "branch" && (
        <Card>
          <CardBody>
            {!branch ? (
              <div className="text-soft">No branch details found.</div>
            ) : (
              <Form onSubmit={(event) => {
                event.preventDefault();
                submit("branch", salonApi.profile.updateBranch, setBranch, branch);
              }}>
                <Row className="g-3">
                  <Col md="6"><Field label="Branch name" value={branch.name} readOnly={!canEditBranch} onChange={(name) => setBranch({ ...branch, name })} /></Col>
                  <Col md="6"><Field label="Branch code" value={branch.branchCode} readOnly={!canEditBranch} onChange={(branchCode) => setBranch({ ...branch, branchCode })} /></Col>
                  <Col md="6"><Field label="Phone" value={branch.phone} readOnly={!canEditBranch} onChange={(phone) => setBranch({ ...branch, phone })} /></Col>
                  <Col md="6"><Field label="Email" value={branch.email} readOnly={!canEditBranch} onChange={(email) => setBranch({ ...branch, email })} /></Col>
                  <Col md="6"><Field label="Address" value={branch.addressLine1} readOnly={!canEditBranch} onChange={(addressLine1) => setBranch({ ...branch, addressLine1 })} /></Col>
                  <Col md="6"><Field label="City" value={branch.city} readOnly={!canEditBranch} onChange={(city) => setBranch({ ...branch, city })} /></Col>
                  <Col md="4"><Field label="State" value={branch.state} readOnly={!canEditBranch} onChange={(state) => setBranch({ ...branch, state })} /></Col>
                  <Col md="4"><Field label="Pincode" value={branch.postalCode} readOnly={!canEditBranch} onChange={(postalCode) => setBranch({ ...branch, postalCode })} /></Col>
                  <Col md="2"><Field label="Opening time" type="time" value={branch.openingTime} readOnly={!canEditBranch} onChange={(openingTime) => setBranch({ ...branch, openingTime })} /></Col>
                  <Col md="2"><Field label="Closing time" type="time" value={branch.closingTime} readOnly={!canEditBranch} onChange={(closingTime) => setBranch({ ...branch, closingTime })} /></Col>
                  <Col md="6"><Field label="Status" value={branch.status ? "Active" : "Inactive"} readOnly /></Col>
                </Row>
                {canEditBranch && <div className="mt-3"><SaveButton disabled={submitting === "branch"} /></div>}
              </Form>
            )}
          </CardBody>
        </Card>
      )}

      {activeTab === "gst" && (
        <Card>
          <CardBody>
            <Alert color="warning">
              Changes apply only to future draft invoices. Issued invoices retain their original tax values.
            </Alert>
            {!gst ? (
              <div className="text-soft">No GST settings found.</div>
            ) : (
              <Form onSubmit={(event) => {
                event.preventDefault();
                submit("gst", salonApi.profile.updateGst, setGst, {
                  gstEnabled: gst.gstEnabled,
                  gstNumber: emptyToNull(gst.gstNumber),
                  gstLegalName: emptyToNull(gst.gstLegalName),
                  gstStateCode: emptyToNull(gst.gstStateCode),
                  serviceGstRate: gst.serviceGstRate,
                  productGstRate: gst.productGstRate,
                });
              }}>
                <Row className="g-3">
                  <Col md="4"><Field label="GST enabled" type="checkbox" checked={gst.gstEnabled} readOnly={!canEditGst} onChange={(gstEnabled) => setGst({ ...gst, gstEnabled })} /></Col>
                  <Col md="4"><Field label="GST verified status" value={gst.gstVerified ? "Verified" : "Not verified"} readOnly /></Col>
                  <Col md="4"><Field label="GST verified date" value={gst.gstVerifiedAt ? new Date(gst.gstVerifiedAt).toLocaleDateString() : ""} readOnly /></Col>
                  <Col md="6"><Field label="GST number" value={gst.gstNumber} readOnly={!canEditGst} onChange={(gstNumber) => setGst({ ...gst, gstNumber })} /></Col>
                  <Col md="6"><Field label="GST legal name" value={gst.gstLegalName} readOnly={!canEditGst} onChange={(gstLegalName) => setGst({ ...gst, gstLegalName })} /></Col>
                  <Col md="4"><Field label="GST state code" value={gst.gstStateCode} readOnly={!canEditGst} onChange={(gstStateCode) => setGst({ ...gst, gstStateCode })} /></Col>
                  <Col md="4"><Field label="Service GST rate" type="number" value={gst.serviceGstRate} readOnly={!canEditGst} onChange={(serviceGstRate) => setGst({ ...gst, serviceGstRate })} /></Col>
                  <Col md="4"><Field label="Product GST rate" type="number" value={gst.productGstRate} readOnly={!canEditGst} onChange={(productGstRate) => setGst({ ...gst, productGstRate })} /></Col>
                </Row>
                {!canEditGst && <Badge color="light" className="mt-3">Read-only</Badge>}
                {canEditGst && <div className="mt-3"><SaveButton disabled={submitting === "gst"} /></div>}
              </Form>
            )}
          </CardBody>
        </Card>
      )}
    </PageShell>
  );
};

export default Profile;
