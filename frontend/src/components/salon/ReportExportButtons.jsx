/* eslint-disable react/prop-types */
import { useState } from "react";
import { toast } from "react-toastify";
import { Button, Icon } from "@/components/Component";
import { salonApi } from "@/services/salonApi";

const ReportExportButtons = ({ reportType, filters = {} }) => {
  const [loading, setLoading] = useState("");

  const download = async (format) => {
    setLoading(format);
    try {
      const result = await salonApi.reports.exportFile(
        reportType,
        format,
        filters
      );
      const url = URL.createObjectURL(result.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error.message || "Unable to export report");
    } finally {
      setLoading("");
    }
  };

  return (
    <div className="d-flex gap-2">
      <Button
        color="light"
        outline
        className="btn-export btn-export-pdf"
        disabled={Boolean(loading)}
        onClick={() => download("pdf")}
      >
        <Icon name="file-pdf" />
        <span>{loading === "pdf" ? "Exporting…" : "Export PDF"}</span>
      </Button>
      <Button
        color="light"
        outline
        className="btn-export btn-export-xls"
        disabled={Boolean(loading)}
        onClick={() => download("xlsx")}
      >
        <Icon name="file-xls" />
        <span>{loading === "xlsx" ? "Exporting…" : "Export Excel"}</span>
      </Button>
    </div>
  );
};

export default ReportExportButtons;
