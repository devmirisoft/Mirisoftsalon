import { useMemo, useState } from "react";
import { Col, Input, Label, Modal, ModalBody, ModalHeader, Row } from "reactstrap";
import { Button } from "@/components/Component";
import { formatMoney } from "@/utils/salonFormat";

// Services arrive either from the catalog list (service.mainService) or from
// the job-cart reference payload (flat mainServiceId/mainServiceName).
const normalize = (service) => ({
  id: service.id,
  name: service.name,
  price: service.price,
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

  const staffNameFor = (id) => staff.find((member) => member.id === id)?.name;
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
      contentClassName="border-0"
    >
      <ModalHeader toggle={close}>{title}</ModalHeader>
      <ModalBody>
        <Row className="g-3 mb-3">
          <Col md="4">
            <Label className="mb-1">Search</Label>
            <Input
              type="search"
              placeholder="Search services"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </Col>
          <Col md="4">
            <Label className="mb-1">Category</Label>
            <Input
              type="select"
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
            >
              <option value="">All services</option>
              {categories.map((category) => (
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
              value={staffId}
              disabled={disabled}
              onChange={(event) => onStaffChange?.(event.target.value)}
            >
              <option value="" disabled={requireStaff}>
                {staffPlaceholder}
              </option>
              {staff.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                  {member.jobRole ? ` - ${member.jobRole}` : ""}
                </option>
              ))}
            </Input>
          </Col>
          {/* <Col md="4">
            <Label className="mb-1">Search</Label>
            <Input
              type="search"
              placeholder="Search services"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </Col> */}
        </Row>
        <div
          className="border rounded"
          style={{ maxHeight: 380, overflowY: "auto" }}
        >
          {requireStaff && !staffId ? (
            <div className="text-soft text-center py-4">
              Select a staff member to start adding services
            </div>
          ) : visible.length === 0 ? (
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
              {visible.map((option) => {
                const added = assignedById.has(option.id);
                const assignedName = added
                  ? staffNameFor(assignedById.get(option.id))
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
                        checked={added}
                        disabled={servicesLocked}
                        onChange={() => onToggleService?.(option.id)}
                      />
                      <span className="text-truncate" style={{ minWidth: 0 }}>
                        <span className="d-block text-truncate">
                          {option.name}
                        </span>
                        <small className="text-soft">
                          {option.mainServiceName} - {formatMoney(option.price)}
                          {added ? ` - ${assignedName || "unassigned"}` : ""}
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
            {assignedById.size} in cart
            {staffId ? ` - adding for ${staffNameFor(staffId) || ""}` : ""}
          </span>
          <Button color="primary" type="button" onClick={close}>
            Done
          </Button>
        </div>
      </ModalBody>
    </Modal>
  );
};

export default ServicePickerModal;
