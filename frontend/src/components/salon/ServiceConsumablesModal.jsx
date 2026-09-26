/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Modal,
  ModalBody,
  ModalHeader,
} from "reactstrap";
import { Button, Icon } from "@/components/Component";
import DataGrid from "./DataGrid";
import SchemaModal from "./SchemaModal";
import { salonApi } from "@/services/salonApi";

const ServiceConsumablesModal = ({ service, canManage, toggle }) => {
  const [rows, setRows] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState(null);

  const load = useCallback(async () => {
    if (!service) return;
    setLoading(true);
    setError("");
    try {
      const [consumables, availableProducts] = await Promise.all([
        salonApi.serviceConsumables.list(service.id),
        salonApi.products.list({
          serviceConsumable: true,
          status: true,
          salonId: service.salonId,
        }),
      ]);
      setRows(consumables.data || []);
      setProducts(availableProducts.data || []);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, [service]);

  useEffect(() => {
    load();
  }, [load]);

  const fields = useMemo(
    () => [
      {
        name: "productId",
        label: "Consumable product",
        type: "select",
        required: true,
        disabled: Boolean(form?.id),
        options: products.map((product) => ({
          value: product.id,
          label: `${product.name} · ${product.currentStock} ${product.unit}`,
        })),
      },
      {
        name: "quantity",
        label: "Quantity per service",
        type: "number",
        min: 0.01,
        step: "0.01",
        required: true,
      },
    ],
    [form?.id, products]
  );

  const save = async (values) => {
    if (form?.id) {
      await salonApi.serviceConsumables.update(form.id, {
        quantity: values.quantity,
      });
    } else {
      await salonApi.serviceConsumables.create(service.id, values);
    }
    await load();
  };

  const remove = async (row) => {
    if (!window.confirm(`Remove ${row.product?.name} from this service?`)) {
      return;
    }
    try {
      await salonApi.serviceConsumables.remove(row.id);
      await load();
    } catch (removeError) {
      setError(removeError.message);
    }
  };

  return (
    <>
      <Modal isOpen={Boolean(service)} toggle={toggle} size="lg" centered>
        <ModalHeader toggle={toggle}>
          Consumables · {service?.name}
        </ModalHeader>
        <ModalBody>
          <div className="d-flex justify-content-between align-items-start mb-3">
            <p className="text-soft mb-0">
              Stock deducted each time this service is completed.
            </p>
            {canManage && (
              <Button color="primary" size="sm" onClick={() => setForm({})}>
                <Icon name="plus" />
                Add consumable
              </Button>
            )}
          </div>
          {error && <Alert color="danger">{error}</Alert>}
          <DataGrid
            loading={loading}
            rows={rows}
            emptyText="No consumables linked to this service."
            columns={[
              {
                key: "product",
                label: "Product",
                render: (value) => value?.name || "—",
              },
              {
                key: "quantity",
                label: "Quantity",
                // A product opened into containers is measured in its pack unit.
                render: (value, row) => `${value} ${row.product?.packUnit || row.product?.unit || ""}`,
              },
              {
                key: "currentStock",
                label: "Current stock",
                render: (_value, row) =>
                  row.product
                    ? `${row.product.currentStock} ${row.product.unit}`
                    : "—",
              },
            ]}
            renderActions={
              canManage
                ? (row) => (
                    <>
                      <Button
                        size="sm"
                        color="light"
                        onClick={() =>
                          setForm({
                            id: row.id,
                            productId: row.productId,
                            quantity: Number(row.quantity),
                          })
                        }
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        color="danger"
                        outline
                        className="ms-1"
                        onClick={() => remove(row)}
                      >
                        Remove
                      </Button>
                    </>
                  )
                : undefined
            }
          />
        </ModalBody>
      </Modal>
      <SchemaModal
        isOpen={Boolean(form)}
        toggle={() => setForm(null)}
        title={form?.id ? "Edit consumable" : "Add consumable"}
        fields={fields}
        initialValues={form}
        onSubmit={save}
      />
    </>
  );
};

export default ServiceConsumablesModal;
