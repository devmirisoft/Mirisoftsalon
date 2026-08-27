/* eslint-disable react/prop-types */
import { Modal, ModalBody, ModalHeader } from "reactstrap";
import { formatDisplayValue, labelize } from "@/utils/salonFormat";

const hasDisplayableFields = (value) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).length > 0;

const renderObjectFields = (value) => {
  const entries = Object.entries(value || {}).filter(
    ([, entryValue]) => entryValue !== null && entryValue !== undefined && entryValue !== ""
  );

  if (!entries.length) return <div>{formatDisplayValue(value)}</div>;

  return (
    <div className="d-flex flex-column gap-2">
      {entries.slice(0, 8).map(([key, entryValue]) => (
        <div key={key}>
          <div className="text-soft small">{labelize(key)}</div>
          <div>{formatDisplayValue(entryValue)}</div>
        </div>
      ))}
      {entries.length > 8 && (
        <div className="text-soft small">+{entries.length - 8} more fields</div>
      )}
    </div>
  );
};

const renderValue = (value) => {
  if (Array.isArray(value)) {
    if (!value.length) return <div>{formatDisplayValue(value)}</div>;
    if (value.every((item) => !hasDisplayableFields(item))) {
      return <div>{formatDisplayValue(value)}</div>;
    }
    return (
      <div className="d-flex flex-column gap-2">
        {value.slice(0, 6).map((item, index) => (
          <div className="border rounded p-2" key={`${formatDisplayValue(item, "item")}-${index}`}>
            {hasDisplayableFields(item) ? renderObjectFields(item) : formatDisplayValue(item)}
          </div>
        ))}
        {value.length > 6 && (
          <div className="text-soft small">+{value.length - 6} more items</div>
        )}
      </div>
    );
  }

  if (hasDisplayableFields(value)) return renderObjectFields(value);
  return <div>{formatDisplayValue(value)}</div>;
};

const DetailsModal = ({ isOpen, toggle, title, data }) => (
  <Modal isOpen={isOpen} toggle={toggle} size="lg" centered scrollable>
    <ModalHeader toggle={toggle}>{title}</ModalHeader>
    <ModalBody>
      <div className="row g-3">
        {Object.entries(data || {}).map(([key, value]) => (
          <div className="col-md-6" key={key}>
            <div className="border rounded p-3 h-100">
              <div className="overline-title text-soft mb-1">{labelize(key)}</div>
              {renderValue(value)}
            </div>
          </div>
        ))}
      </div>
    </ModalBody>
  </Modal>
);

export default DetailsModal;
