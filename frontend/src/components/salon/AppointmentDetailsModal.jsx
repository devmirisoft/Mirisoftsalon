/* eslint-disable react/prop-types */
import {
  Col,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Row,
} from "reactstrap";
import { Button, Icon } from "@/components/Component";
import StatusBadge from "./StatusBadge";
import { formatDate, formatMoney, labelize } from "@/utils/salonFormat";

const InfoItem = ({ icon, label, children }) => (
  <div className="appointment-detail-info">
    <div className="appointment-detail-info-icon">
      <Icon name={icon} />
    </div>
    <div className="appointment-detail-info-content">
      <div className="overline-title text-soft mb-1">{label}</div>
      <div className="fw-medium appointment-detail-info-value">
        {children || "—"}
      </div>
    </div>
  </div>
);

const AppointmentDetailsModal = ({
  isOpen,
  toggle,
  appointment,
  onStatus,
  onReschedule,
  onNotes,
  onTracking,
  onMakeBill,
}) => {
  if (!appointment) return null;

  const services = appointment.services || [];
  const serviceTotal = services.reduce(
    (total, item) => total + Number(item.price || 0),
    0
  );
  // Products sold on the visit are billed as PRODUCT lines on the invoice.
  const products = appointment.invoice?.items || [];
  const productTotal = products.reduce(
    (total, item) => total + Number(item.lineTotal || 0),
    0
  );

  return (
    <Modal
      isOpen={isOpen}
      toggle={toggle}
      size="xl"
      centered
      scrollable
      className="appointment-detail-modal"
    >
      <ModalHeader toggle={toggle}>
        <div className="d-flex align-items-center gap-2 flex-wrap">
          <span>Appointment {appointment.appointmentCode}</span>
          <StatusBadge value={appointment.status} />
        </div>
      </ModalHeader>
      <ModalBody>
        <Row className="g-4">
          <Col lg="8">
            <div className="card card-bordered h-100">
              <div className="card-inner appointment-detail-main">
                <div className="appointment-detail-hero">
                  <div className="appointment-detail-customer">
                    <div className="overline-title text-soft">Customer</div>
                    <h4 className="title mb-1">
                      {appointment.customer?.name || "Unknown customer"}
                    </h4>
                    <div className="text-soft">
                      {appointment.customer?.customerCode || "No customer code"}
                      {appointment.customer?.phone
                        ? ` · ${appointment.customer.phone}`
                        : ""}
                    </div>
                  </div>
                  <div className="appointment-detail-total">
                    <div className="overline-title text-soft">
                      Estimated total
                    </div>
                    <div className="fs-3 fw-bold text-primary">
                      {formatMoney(
                        appointment.estimatedAmount ?? serviceTotal
                      )}
                    </div>
                  </div>
                </div>

                <div className="appointment-detail-meta">
                  <InfoItem icon="calender-date" label="Starts">
                    {formatDate(appointment.startTime, true)}
                  </InfoItem>
                  <InfoItem icon="clock" label="Ends">
                    {formatDate(appointment.endTime, true)}
                  </InfoItem>
                  <InfoItem icon="user-fill" label="Assigned staff">
                    {appointment.staff?.name || "Unassigned"}
                    {appointment.staff?.jobRole
                      ? ` · ${appointment.staff.jobRole}`
                      : ""}
                  </InfoItem>
                  <InfoItem icon="building" label="Location">
                    {appointment.branch?.name ||
                      appointment.salon?.name ||
                      "Main salon"}
                  </InfoItem>
                  <InfoItem icon="clock" label="Duration">
                    {appointment.totalDurationMinutes
                      ? `${appointment.totalDurationMinutes} minutes`
                      : "Not calculated"}
                  </InfoItem>
                  <InfoItem icon="user-check" label="Created by">
                    {appointment.createdBy?.name || "System"}
                    {appointment.createdBy?.role
                      ? ` · ${labelize(appointment.createdBy.role)}`
                      : ""}
                  </InfoItem>
                </div>

                <div className="appointment-detail-services">
                  <h5 className="title mb-3">Booked services</h5>
                  <div className="table-responsive">
                    <table className="table table-middle">
                      <thead>
                        <tr>
                          <th>Service</th>
                          <th>Staff</th>
                          <th>Duration</th>
                          <th className="text-end">Price</th>
                        </tr>
                      </thead>
                      <tbody>
                        {services.map((item) => (
                          <tr key={item.id || item.serviceId}>
                            <td>
                              <strong>
                                {item.serviceName ||
                                  item.service?.name ||
                                  "Service"}
                              </strong>
                            </td>
                            <td>
                              {item.staff?.name ||
                                appointment.staff?.name ||
                                "—"}
                            </td>
                            <td>
                              {item.durationValue
                                ? `${item.durationValue} ${labelize(
                                    item.durationUnit
                                  ).toLowerCase()}`
                                : "—"}
                            </td>
                            <td className="text-end">
                              {formatMoney(item.price)}
                            </td>
                          </tr>
                        ))}
                        {services.length === 0 && (
                          <tr>
                            <td
                              colSpan="4"
                              className="text-center text-soft py-4"
                            >
                              No services attached.
                            </td>
                          </tr>
                        )}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td colSpan="3" className="text-end fw-bold">
                            Total
                          </td>
                          <td className="text-end fw-bold">
                            {formatMoney(
                              appointment.estimatedAmount ?? serviceTotal
                            )}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>

                {products.length > 0 && (
                  <div className="appointment-detail-services mt-4">
                    <h5 className="title mb-3">
                      Products sold
                      {appointment.invoice?.invoiceCode
                        ? ` · ${appointment.invoice.invoiceCode}`
                        : ""}
                    </h5>
                    <div className="table-responsive">
                      <table className="table table-middle">
                        <thead>
                          <tr>
                            <th>Product</th>
                            <th>Sold by</th>
                            <th className="text-end">Qty</th>
                            <th className="text-end">Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {products.map((item) => (
                            <tr key={item.id}>
                              <td>
                                <strong>
                                  {item.serviceName || item.description}
                                </strong>
                                <div className="text-soft small">
                                  {formatMoney(item.unitPrice)} each
                                </div>
                              </td>
                              <td>{item.soldByStaff?.name || "—"}</td>
                              <td className="text-end">{item.quantity}</td>
                              <td className="text-end">
                                {formatMoney(item.lineTotal)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr>
                            <td colSpan="3" className="text-end fw-bold">
                              Total
                            </td>
                            <td className="text-end fw-bold">
                              {formatMoney(productTotal)}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </Col>

          <Col lg="4">
            <div className="card card-bordered mb-4">
              <div className="card-inner">
                <h5 className="title mb-3">Customer account</h5>
                <div className="d-flex justify-content-between gap-3 py-2 border-bottom">
                  <span className="text-soft">Wallet balance</span>
                  <strong className="text-success">
                    {formatMoney(appointment.customer?.walletBalance)}
                  </strong>
                </div>
                <div className="d-flex justify-content-between gap-3 py-2">
                  <span className="text-soft">Outstanding</span>
                  <strong className="text-danger">
                    {formatMoney(appointment.customer?.outstandingAmount)}
                  </strong>
                </div>
              </div>
            </div>

            <div className="card card-bordered">
              <div className="card-inner">
                <h5 className="title mb-3">Notes</h5>
                <div className="mb-4">
                  <div className="overline-title text-soft mb-1">
                    Booking note
                  </div>
                  <p className="mb-0">
                    {appointment.bookingNote || "No booking note."}
                  </p>
                </div>
                <div>
                  <div className="overline-title text-soft mb-1">
                    Internal note
                  </div>
                  <p className="mb-0">
                    {appointment.internalNote || "No internal note."}
                  </p>
                </div>
              </div>
            </div>
          </Col>
        </Row>
      </ModalBody>
      <ModalFooter className="appointment-detail-actions">
        <Button color="light" onClick={toggle}>
          Close
        </Button>
        <div className="d-flex gap-2 flex-wrap">
          <Button color="light" onClick={() => onTracking(appointment)}>
            <Icon name="history" /> History
          </Button>
          <Button color="light" onClick={() => onNotes(appointment)}>
            <Icon name="edit" /> Notes
          </Button>
          <Button color="info" outline onClick={() => onStatus(appointment)}>
            Update status
          </Button>
          <Button color="primary" onClick={() => onReschedule(appointment)}>
            <Icon name="calender-date" /> Reschedule
          </Button>
          {appointment.status === "COMPLETED" && onMakeBill && (
            <Button color="success" onClick={() => onMakeBill(appointment)}>
              <Icon name="file-plus" /> Make bill
            </Button>
          )}
        </div>
      </ModalFooter>
    </Modal>
  );
};

export default AppointmentDetailsModal;
