/* eslint-disable react/prop-types, react-hooks/set-state-in-effect */
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Col,
  Form,
  FormGroup,
  Input,
  Label,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Row,
  Spinner,
} from "reactstrap";
import { Select, CreatableSelect } from "@/components/select/PortalSelect";
import { Button, Icon } from "@/components/Component";

const normalizeInitial = (fields, initialValues) =>
  Object.fromEntries(
    fields.map((field) => {
      let value =
        initialValues?.[field.initialName || field.name] ??
        field.defaultValue ??
        "";
      if (field.fromInitial) value = field.fromInitial(value, initialValues);
      if (field.type === "checkbox") value = Boolean(value);
      if (field.type === "date" && value) value = String(value).slice(0, 10);
      if (field.type === "datetime-local" && value) {
        value = String(value).slice(0, 16);
      }
      return [field.name, value];
    })
  );

const flattenOptions = (options = []) =>
  options.flatMap((option) =>
    Array.isArray(option.options) ? option.options : [option]
  );

const SchemaModal = ({
  isOpen,
  toggle,
  title,
  fields,
  initialValues,
  onSubmit,
  submitLabel = "Save",
}) => {
  const initial = useMemo(
    () => normalizeInitial(fields, initialValues),
    [fields, initialValues]
  );
  const [values, setValues] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (isOpen) {
      setValues(initial);
      setError("");
    }
  }, [initial, isOpen]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    const missingField = fields.find(
      (field) =>
        field.required &&
        !field.hidden &&
        (values[field.name] === "" ||
          values[field.name] === null ||
          values[field.name] === undefined ||
          (Array.isArray(values[field.name]) &&
            values[field.name].length === 0))
    );
    if (missingField) {
      setError(`${missingField.label} is required.`);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const payload = Object.fromEntries(
        fields
          .filter((field) => !field.readOnly)
          .map((field) => {
            let value = values[field.name];
            if (field.type === "number" && value !== "") value = Number(value);
            if (field.type === "multiselect") {
              value = Array.from(value || []);
            }
            if (field.nullable && value === "") value = null;
            return [field.name, value];
          })
      );
      await onSubmit(payload);
      toggle();
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "Unable to save."
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} toggle={toggle} size="lg" centered>
      <Form onSubmit={handleSubmit}>
        <ModalHeader toggle={toggle}>{title}</ModalHeader>
        <ModalBody>
          {error && (
            <Alert color="danger">
              <Icon name="alert-circle" className="me-1" />
              {error}
            </Alert>
          )}
          <Row className="g-3">
            {fields
              .filter((field) => !field.hidden)
              .map((field) => (
                <Col md={field.fullWidth ? 12 : 6} key={field.name}>
                  <FormGroup className={field.type === "checkbox" ? "mt-4" : ""}>
                    {field.type !== "checkbox" && (
                      <div className="d-flex align-items-center justify-content-between gap-2">
                        <Label for={`field-${field.name}`}>
                          {field.label}
                          {field.required && <span className="text-danger"> *</span>}
                        </Label>
                        {field.actionLabel && (
                          <Button
                            type="button"
                            size="sm"
                            color="primary"
                            outline
                            disabled={saving}
                            onClick={() => field.onAction?.(values)}
                          >
                            {field.actionIcon && (
                              <Icon name={field.actionIcon} className="me-1" />
                            )}
                            {field.actionLabel}
                          </Button>
                        )}
                      </div>
                    )}
                    {field.type === "checkbox" ? (
                      <Input
                        id={`field-${field.name}`}
                        type="checkbox"
                        checked={Boolean(values[field.name])}
                        onChange={(event) =>
                          setValues((current) => ({
                            ...current,
                            [field.name]: event.target.checked,
                          }))
                        }
                      />
                    ) : field.type === "creatable-select" ? (
                      <CreatableSelect
                        className="react-select-container"
                        inputId={`field-${field.name}`}
                        classNamePrefix="react-select"
                        isClearable={field.nullable !== false}
                        isDisabled={field.disabled || saving}
                        options={field.options || []}
                        placeholder={field.placeholder || `Search ${field.label}`}
                        value={
                          field.options?.find(
                            (option) => option.value === values[field.name]
                          ) || null
                        }
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
                                option.label.trim().toLowerCase() === normalized
                            )
                          );
                        }}
                        onChange={(option) =>
                          setValues((current) => ({
                            ...current,
                            [field.name]: option?.value || "",
                          }))
                        }
                        onCreateOption={(inputValue) =>
                          field.onCreateOption?.(inputValue.trim(), values)
                        }
                      />
                    ) : field.type === "multiselect" ? (
                      <Select
                        inputId={`field-${field.name}`}
                        className="react-select-container"
                        classNamePrefix="react-select"
                        isMulti
                        isSearchable
                        closeMenuOnSelect={false}
                        hideSelectedOptions={false}
                        isDisabled={field.disabled || saving}
                        options={field.options || []}
                        formatOptionLabel={field.formatOptionLabel}
                        formatGroupLabel={field.formatGroupLabel}
                        placeholder={
                          field.placeholder || `Select ${field.label}`
                        }
                        value={flattenOptions(field.options).filter((option) =>
                          (values[field.name] || []).includes(option.value)
                        )}
                        noOptionsMessage={() => "No services found"}
                        onChange={(options) =>
                          setValues((current) => ({
                            ...current,
                            [field.name]: options.map(
                              (option) => option.value
                            ),
                          }))
                        }
                      />
                    ) : (
                      <Input
                        id={`field-${field.name}`}
                        type={field.type || "text"}
                        required={field.required}
                        disabled={field.disabled || saving}
                        value={
                          field.derive
                            ? field.derive(values)
                            : values[field.name]
                        }
                        min={field.min}
                        step={field.step}
                        placeholder={field.placeholder}
                        rows={field.rows}
                        onChange={(event) => {
                          const value = event.target.value;
                          setValues((current) => ({
                            ...current,
                            [field.name]: value,
                          }));
                        }}
                      >
                        {field.options && (
                          <>
                            <option value="">
                              {field.placeholder || `Select ${field.label}`}
                            </option>
                            {field.options.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </>
                        )}
                      </Input>
                    )}
                    {field.help && (
                      <small className="form-text text-soft">{field.help}</small>
                    )}
                  </FormGroup>
                </Col>
              ))}
          </Row>
        </ModalBody>
        <ModalFooter>
          <Button type="button" color="light" onClick={toggle} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" color="primary" disabled={saving}>
            {saving && <Spinner size="sm" className="me-1" />}
            {submitLabel}
          </Button>
        </ModalFooter>
      </Form>
    </Modal>
  );
};

export default SchemaModal;
