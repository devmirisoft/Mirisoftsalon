/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  FormGroup,
  Input,
  Label,
  Nav,
  NavItem,
  NavLink,
  TabContent,
  TabPane,
} from "reactstrap";
import { Button, Icon } from "@/components/Component";
import PageShell from "@/components/salon/PageShell";
import ResourcePanel from "@/components/salon/ResourcePanel";
import SchemaModal from "@/components/salon/SchemaModal";
import { useAuth } from "@/auth/AuthContext";
import { salonApi } from "@/services/salonApi";
import { formatDate, labelize, roleCanManage } from "@/utils/salonFormat";
import StatusBadge from "@/components/salon/StatusBadge";

const option = (item) => ({ value: item.id, label: item.name });

const Management = () => {
  const { user } = useAuth();
  const [tab, setTab] = useState(user?.role === "SUPER_ADMIN" ? "salons" : "branches");
  const [refs, setRefs] = useState({ salons: [], branches: [], staff: [] });
  const [userContext, setUserContext] = useState(null);
  const [accountModal, setAccountModal] = useState(null);
  const [accountError, setAccountError] = useState("");
  const [gstSalonId, setGstSalonId] = useState("");
  const [gstForm, setGstForm] = useState({
    gstEnabled: false,
    gstNumber: "",
    gstLegalName: "",
    gstStateCode: "",
    serviceGstRate: "5.00",
    productGstRate: "18.00",
  });
  const [gstError, setGstError] = useState("");
  const [gstMessage, setGstMessage] = useState("");
  const [gstSaving, setGstSaving] = useState(false);

  const loadRefs = useCallback(async () => {
    const calls = [
      user?.role === "SUPER_ADMIN"
        ? salonApi.salons.list()
        : Promise.resolve({ data: [] }),
      salonApi.branches.list(),
      salonApi.staff.list(),
      user?.role === "SUPER_ADMIN"
        ? salonApi.users.list()
        : Promise.resolve({ currentUser: null }),
    ];
    const [salons, branches, staff, users] = await Promise.allSettled(calls);
    setRefs({
      salons: salons.status === "fulfilled" ? salons.value.data || [] : [],
      branches: branches.status === "fulfilled" ? branches.value.data || [] : [],
      staff: staff.status === "fulfilled" ? staff.value.data || [] : [],
    });
    setUserContext(
      users.status === "fulfilled" ? users.value.currentUser || null : null
    );
  }, [user?.role]);

  useEffect(() => {
    loadRefs();
  }, [loadRefs]);

  const isManager = roleCanManage(user?.role);
  const isSuper = user?.role === "SUPER_ADMIN";
  const tabs = [
    ...(isSuper ? [{ id: "salons", label: "Salons" }] : []),
    { id: "branches", label: "Branches" },
    { id: "staff", label: "Staff" },
    ...(isManager ? [{ id: "gst", label: "GST" }] : []),
    ...(isManager ? [{ id: "accounts", label: "User accounts" }] : []),
  ];

  const loadGstSettings = useCallback(
    async (salonId = gstSalonId) => {
      if (isSuper && !salonId) return;
      setGstError("");
      const response = await salonApi.salons.gstSettings(
        isSuper ? salonId : undefined
      );
      const data = response.data || {};
      setGstForm({
        gstEnabled: Boolean(data.gstEnabled),
        gstNumber: data.gstNumber || "",
        gstLegalName: data.gstLegalName || "",
        gstStateCode: data.gstStateCode || "",
        serviceGstRate: String(data.serviceGstRate ?? "5.00"),
        productGstRate: String(data.productGstRate ?? "18.00"),
      });
    },
    [gstSalonId, isSuper]
  );

  useEffect(() => {
    if (!isManager) return;
    if (isSuper) {
      const firstSalonId = gstSalonId || refs.salons[0]?.id || "";
      if (firstSalonId && firstSalonId !== gstSalonId) {
        setGstSalonId(firstSalonId);
      } else if (firstSalonId) {
        loadGstSettings(firstSalonId).catch((error) => setGstError(error.message));
      }
    } else {
      loadGstSettings().catch((error) => setGstError(error.message));
    }
  }, [gstSalonId, isManager, isSuper, loadGstSettings, refs.salons]);

  const saveGstSettings = async (event) => {
    event.preventDefault();
    setGstSaving(true);
    setGstError("");
    setGstMessage("");
    try {
      await salonApi.salons.updateGstSettings(
        {
          ...gstForm,
          serviceGstRate: Number(gstForm.serviceGstRate),
          productGstRate: Number(gstForm.productGstRate),
        },
        isSuper ? gstSalonId : undefined
      );
      setGstMessage("GST settings saved.");
      await loadGstSettings(gstSalonId);
    } catch (error) {
      setGstError(error.message);
    } finally {
      setGstSaving(false);
    }
  };

  const branchFields = useMemo(
    () => [
      { name: "name", label: "Branch name", required: true },
      ...(isSuper
        ? [
            {
              name: "salonId",
              label: "Salon",
              type: "select",
              required: true,
              options: refs.salons.map(option),
            },
          ]
        : []),
      { name: "addressLine1", label: "Address", nullable: true, fullWidth: true },
      { name: "city", label: "City", nullable: true },
      { name: "state", label: "State", nullable: true },
      { name: "postalCode", label: "Postal code", nullable: true },
      { name: "phone", label: "Phone", type: "tel", nullable: true },
    ],
    [isSuper, refs.salons]
  );

  const staffFields = useMemo(
    () => [
      { name: "name", label: "Full name", required: true },
      { name: "email", label: "Email", type: "email", required: true },
      { name: "phone", label: "Phone", type: "tel", required: true },
      { name: "jobRole", label: "Job role", required: true },
      { name: "workingFrom", label: "Working from", type: "time", required: true },
      { name: "workingTo", label: "Working to", type: "time", required: true },
      {
        name: "weekOff",
        label: "Weekly off",
        type: "select",
        required: true,
        options: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map(
          (day) => ({ value: day, label: day })
        ),
      },
      { name: "joiningDate", label: "Joining date", type: "date" },
      ...(isSuper
        ? [
            {
              name: "salonId",
              label: "Salon",
              type: "select",
              required: true,
              options: refs.salons.map(option),
            },
          ]
        : []),
      {
        name: "branchId",
        label: "Branch",
        type: "select",
        nullable: true,
        options: refs.branches.map(option),
      },
      {
        name: "reportingManagerId",
        label: "Reporting manager",
        type: "select",
        nullable: true,
        options: refs.staff.map(option),
      },
    ],
    [isSuper, refs]
  );

  const accountFields = useMemo(
    () => [
      { name: "name", label: "Full name", required: true },
      { name: "email", label: "Email", type: "email", required: true },
      { name: "phone_number", label: "Phone number", type: "tel", required: true },
      { name: "password", label: "Temporary password", type: "password", required: true },
      ...(isSuper
        ? [
            {
              name: "salonId",
              label: "Salon",
              type: "select",
              required: true,
              options: refs.salons.map(option),
            },
          ]
        : []),
      ...(accountModal === "receptionist"
        ? [
            {
              name: "branchId",
              label: "Branch",
              type: "select",
              nullable: true,
              options: refs.branches.map(option),
            },
          ]
        : []),
    ],
    [accountModal, isSuper, refs]
  );

  const createAccount = async (values) => {
    setAccountError("");
    if (accountModal === "salon-admin") {
      await salonApi.users.createSalonAdmin(values);
    } else {
      await salonApi.users.createReceptionist(values);
    }
  };

  return (
    <PageShell
      title="Salon management"
      description="Branches, team profiles, schedules, and role-specific user accounts."
    >
      <Nav tabs className="mt-n2 mb-4">
        {tabs.map((item) => (
          <NavItem key={item.id}>
            <NavLink
              href="#tab"
              active={tab === item.id}
              onClick={(event) => {
                event.preventDefault();
                setTab(item.id);
              }}
            >
              {item.label}
            </NavLink>
          </NavItem>
        ))}
      </Nav>
      <TabContent activeTab={tab}>
        {isSuper && (
          <TabPane tabId="salons">
            <ResourcePanel
              title="Salons"
              description="Platform-level salon tenants."
              api={salonApi.salons}
              canEdit={false}
              canDelete={false}
              columns={[
                { key: "name", label: "Salon" },
                { key: "email", label: "Email" },
                { key: "phone", label: "Phone" },
                { key: "city", label: "City" },
                { key: "createdAt", label: "Created", render: (value) => formatDate(value) },
              ]}
              fields={[
                { name: "name", label: "Salon name", required: true },
                { name: "email", label: "Email", type: "email" },
                { name: "phone", label: "Phone", type: "tel" },
                { name: "addressLine1", label: "Address", fullWidth: true },
                { name: "city", label: "City" },
                { name: "state", label: "State" },
                { name: "postalCode", label: "Postal code" },
              ]}
              refreshKey={refs.salons.length}
            />
          </TabPane>
        )}
        <TabPane tabId="branches">
          <ResourcePanel
            title="Branches"
            description="Physical locations attached to each salon."
            api={salonApi.branches}
            canCreate={isManager}
            canEdit={isManager}
            canDelete={isManager}
            columns={[
              { key: "name", label: "Branch" },
              ...(isSuper
                ? [{ key: "salon", label: "Salon", render: (value) => value?.name || "—" }]
                : []),
              { key: "city", label: "City" },
              { key: "phone", label: "Phone" },
              { key: "createdAt", label: "Created", render: (value) => formatDate(value) },
            ]}
            fields={branchFields}
            refreshKey={refs.branches.length}
          />
        </TabPane>
        <TabPane tabId="staff">
          <ResourcePanel
            title="Staff"
            description="Operational staff, working hours, branch, and reporting structure."
            api={salonApi.staff}
            canCreate={isManager}
            canEdit={isManager}
            canDelete={isManager}
            columns={[
              { key: "staffCode", label: "Staff code" },
              { key: "name", label: "Name" },
              { key: "jobRole", label: "Role" },
              { key: "branch", label: "Branch", render: (value) => value?.name || "All" },
              { key: "weekOff", label: "Week off" },
              { key: "status", label: "Status", render: (value) => <StatusBadge value={value} /> },
            ]}
            fields={staffFields}
            transformUpdate={(values) => {
              const updateValues = { ...values };
              delete updateValues.salonId;
              delete updateValues.joiningDate;
              return updateValues;
            }}
            renderActions={
              isManager
                ? (row, reload, setError) => (
                    <Button
                      size="sm"
                      color={row.status ? "warning" : "success"}
                      outline
                      onClick={async () => {
                        try {
                          await salonApi.staff.setStatus(row.id, !row.status);
                          await reload();
                        } catch (error) {
                          setError(error.message);
                        }
                      }}
                    >
                      <Icon name={row.status ? "pause" : "play"} />
                      {row.status ? "Disable" : "Enable"}
                    </Button>
                  )
                : undefined
            }
          />
        </TabPane>
        <TabPane tabId="gst">
          <div className="card card-bordered">
            <div className="card-inner">
              <h5 className="title">GST configuration</h5>
              {gstError && <Alert color="danger">{gstError}</Alert>}
              {gstMessage && <Alert color="success">{gstMessage}</Alert>}
              <form onSubmit={saveGstSettings}>
                {isSuper && (
                  <FormGroup>
                    <Label>Salon</Label>
                    <Input
                      type="select"
                      value={gstSalonId}
                      required
                      onChange={(event) => setGstSalonId(event.target.value)}
                    >
                      {refs.salons.map((salon) => (
                        <option key={salon.id} value={salon.id}>
                          {salon.name}
                        </option>
                      ))}
                    </Input>
                  </FormGroup>
                )}
                <div className="custom-control custom-switch mb-3">
                  <input
                    type="checkbox"
                    className="custom-control-input"
                    id="gst-enabled"
                    checked={gstForm.gstEnabled}
                    onChange={(event) =>
                      setGstForm((current) => ({
                        ...current,
                        gstEnabled: event.target.checked,
                      }))
                    }
                  />
                  <label className="custom-control-label" htmlFor="gst-enabled">
                    Enable GST
                  </label>
                </div>
                <div className="row g-3">
                  <div className="col-md-6">
                    <FormGroup>
                      <Label>GST number</Label>
                      <Input
                        value={gstForm.gstNumber}
                        onChange={(event) =>
                          setGstForm((current) => ({
                            ...current,
                            gstNumber: event.target.value.toUpperCase(),
                          }))
                        }
                      />
                    </FormGroup>
                  </div>
                  <div className="col-md-6">
                    <FormGroup>
                      <Label>GST legal name</Label>
                      <Input
                        value={gstForm.gstLegalName}
                        onChange={(event) =>
                          setGstForm((current) => ({
                            ...current,
                            gstLegalName: event.target.value,
                          }))
                        }
                      />
                    </FormGroup>
                  </div>
                  <div className="col-md-4">
                    <FormGroup>
                      <Label>State code</Label>
                      <Input
                        value={gstForm.gstStateCode}
                        onChange={(event) =>
                          setGstForm((current) => ({
                            ...current,
                            gstStateCode: event.target.value,
                          }))
                        }
                      />
                    </FormGroup>
                  </div>
                  <div className="col-md-4">
                    <FormGroup>
                      <Label>Service GST rate</Label>
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        value={gstForm.serviceGstRate}
                        onChange={(event) =>
                          setGstForm((current) => ({
                            ...current,
                            serviceGstRate: event.target.value,
                          }))
                        }
                      />
                    </FormGroup>
                  </div>
                  <div className="col-md-4">
                    <FormGroup>
                      <Label>Product GST rate</Label>
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        value={gstForm.productGstRate}
                        onChange={(event) =>
                          setGstForm((current) => ({
                            ...current,
                            productGstRate: event.target.value,
                          }))
                        }
                      />
                    </FormGroup>
                  </div>
                </div>
                <Button color="primary" disabled={gstSaving || (isSuper && !gstSalonId)}>
                  <Icon name="save" /> {gstSaving ? "Saving" : "Save GST"}
                </Button>
              </form>
            </div>
          </div>
        </TabPane>
        <TabPane tabId="accounts">
          {accountError && <Alert color="danger">{accountError}</Alert>}
          <div className="card card-bordered">
            <div className="card-inner">
              <h5 className="title">Create role accounts</h5>
              <p className="text-soft">
                These actions use the backend’s salon-admin and receptionist account APIs.
              </p>
              <div className="d-flex flex-wrap gap-2">
                {isSuper && (
                  <Button color="primary" onClick={() => setAccountModal("salon-admin")}>
                    <Icon name="shield-star" /> Create salon admin
                  </Button>
                )}
                <Button color="info" onClick={() => setAccountModal("receptionist")}>
                  <Icon name="user-add" /> Create receptionist
                </Button>
              </div>
              <div className="alert alert-light mt-4 mb-0">
                <strong>Current role:</strong> {labelize(user?.role)}. The backend’s
                current <code>GET /api/users</code> endpoint exposes token-user context,
                not a full account directory.
                {userContext && (
                  <div className="mt-2 small">
                    API user: <code>{userContext.userId}</code>
                  </div>
                )}
              </div>
            </div>
          </div>
        </TabPane>
      </TabContent>
      <SchemaModal
        isOpen={Boolean(accountModal)}
        toggle={() => setAccountModal(null)}
        title={
          accountModal === "salon-admin"
            ? "Create salon administrator"
            : "Create receptionist"
        }
        fields={accountFields}
        onSubmit={createAccount}
        submitLabel="Create account"
      />
    </PageShell>
  );
};

export default Management;
