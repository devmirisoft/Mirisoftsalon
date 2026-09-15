import { useMemo, useState } from "react";
import { Col, Input, Label, Modal, ModalBody, Row } from "reactstrap";
import { Button, Icon } from "@/components/Component";
import { serviceMinutes } from "@/utils/appointmentTotals";
import { formatMoney } from "@/utils/salonFormat";

// Services arrive either from the catalog list (service.mainService) or from
// the job-cart reference payload (flat mainServiceId/mainServiceName).
const normalize = (service) => ({
  id: service.id,
  name: service.name,
  price: service.price,
  minutes: serviceMinutes(service),
  mainServiceId: service.mainService?.id || service.mainServiceId || "",
  mainServiceName:
    service.mainService?.name || service.mainServiceName || "Other",
});

// Shared "Add Services" picker: choose who the next services go to, then check
// them off. Checking adds to the cart immediately, unchecking removes it.
// Rows added earlier keep the staff they were added with.
const ServicePickerModal = ({
  isOpen,
  toggle,
  title = "Add Services",
  services = [],
  staff = [],
  staffId = "",
  onStaffChange,
  assignedById = new Map(),
  onToggleService,
  disabled = false,
  staffPlaceholder = "Assign later",
  // When set, services stay locked until a staff member is chosen, so every
  // service added is attributed to someone.
  requireStaff = false,
}) => {
  const [categoryId, setCategoryId] = useState("");
  const [search, setSearch] = useState("");
  const [listView, setListView] = useState(false);

  const options = useMemo(() => services.map(normalize), [services]);

  const categories = useMemo(() => {
    const seen = new Map();
    options.forEach((option) => {
      if (option.mainServiceId && !seen.has(option.mainServiceId)) {
        seen.set(option.mainServiceId, option.mainServiceName);
      }
    });
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [options]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return options.filter((option) => {
      if (categoryId && option.mainServiceId !== categoryId) return false;
      return !term || option.name.toLowerCase().includes(term);
    });
  }, [options, categoryId, search]);

  const staffMemberFor = (id) => staff.find((member) => member.id === id);
  const staffNameFor = (id) => staffMemberFor(id)?.name;
  // A branch with nobody on it cannot satisfy requireStaff, so say that
  // outright: an empty service list otherwise reads as a missing catalogue.
  const noStaffAvailable = requireStaff && staff.length === 0;
  const servicesLocked = disabled || (requireStaff && !staffId);

  // Filters are scratch state, so they start clean on the next open.
  const close = () => {
    setCategoryId("");
    setSearch("");
    toggle();
  };

  return (
    <Modal
      isOpen={isOpen}
      toggle={close}
      centered
      size="xl"
      contentClassName="border-0 svc-picker"
    >
      <div className="svc-picker-head">
        <h5 className="mb-0 d-flex align-items-center gap-2">
          <Icon name="scissor" className="text-primary" />
          <span>{title}</span>
        </h5>
        <button
          type="button"
          className="btn-icon btn btn-sm btn-trigger"
          onClick={close}
          aria-label="Close"
        >
          <Icon name="cross" />
        </button>
      </div>
      <ModalBody>
        <Row className="g-2">
          <Col md="6">
            <Label className="svc-picker-label">
              <Icon name="user" />
              Assign next to{requireStaff ? " *" : ""}
            </Label>
            <Input
              type="select"
              value={staffId}
              disabled={disabled}
              onChange={(event) => onStaffChange?.(event.target.value)}
            >
              <option value="" disabled={requireStaff && !noStaffAvailable}>
                {noStaffAvailable ? "No staff at this branch" : staffPlaceholder}
              </option>
              {staff.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                  {member.jobRole ? ` - ${member.jobRole}` : ""}
                </option>
              ))}
            </Input>
          </Col>
          <Col md="6">
            <Label className="svc-picker-label">
              <Icon name="search" />
              Search
            </Label>
            <Input
              type="search"
              placeholder="Search services..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </Col>
        </Row>

        <div className="svc-tabs">
          <div className="svc-tabs-scroll">
            <button
              type="button"
              className={`svc-tab${categoryId ? "" : " is-active"}`}
              onClick={() => setCategoryId("")}
            >
              All Services
            </button>
            {categories.map((category) => (
              <button
                key={category.id}
                type="button"
                className={`svc-tab${
                  categoryId === category.id ? " is-active" : ""
                }`}
                onClick={() => setCategoryId(category.id)}
              >
                {category.name}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="svc-view"
            onClick={() => setListView((current) => !current)}
          >
            <Icon name={listView ? "list" : "grid-alt"} />
            {listView ? "List View" : "Grid View"}
          </button>
        </div>

        <div className="svc-scroll">
          {noStaffAvailable ? (
            <div className="text-center py-4">
              <span className="text-danger d-block">
                No staff assigned to this branch
              </span>
              <small className="text-soft">
                Services go to whoever performs them, so add staff to this
                branch before building a cart.
              </small>
            </div>
          ) : requireStaff && !staffId ? (
            <div className="text-soft text-center py-4">
              Select a staff member to start adding services
            </div>
          ) : visible.length === 0 ? (
            <div className="text-soft text-center py-4">
              No services match this search
            </div>
          ) : (
            <div className={`svc-grid${listView ? " is-list" : ""}`}>
              {visible.map((option) => {
                const added = assignedById.has(option.id);
                const assignedName = added
                  ? staffNameFor(assignedById.get(option.id))
                  : "";
                return (
                  <label
                    key={option.id}
                    className={`svc-card${added ? " is-added" : ""}${
                      servicesLocked ? " is-locked" : ""
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="form-check-input flex-shrink-0"
                      checked={added}
                      disabled={servicesLocked}
                      onChange={() => onToggleService?.(option.id)}
                    />
                    <span className="svc-card-body">
                      <span className="svc-card-name">{option.name}</span>
                      <span className="svc-muted d-flex align-items-center gap-1">
                        {option.minutes > 0 && (
                          <>
                            <Icon name="clock" />
                            {option.minutes} min
                          </>
                        )}
                        {added && (
                          <span className="text-truncate">
                            {option.minutes > 0 ? "- " : ""}
                            {assignedName || "unassigned"}
                          </span>
                        )}
                      </span>
                      <span className="svc-card-foot">
                        <span className="svc-card-price">
                          {formatMoney(option.price)}
                        </span>
                        <span className="svc-card-add">
                          <Icon name={added ? "check-thick" : "plus"} />
                          {added ? "Added" : "Add"}
                        </span>
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      </ModalBody>
      <div className="svc-picker-foot">
        <span className="d-flex align-items-center gap-2 text-soft">
          <Icon name="cart" />
          {assignedById.size} service{assignedById.size === 1 ? "" : "s"}{" "}
          selected
        </span>
        <Button color="primary" type="button" onClick={close}>
          Done
        </Button>
      </div>
    </Modal>
  );
};

export default ServicePickerModal;
