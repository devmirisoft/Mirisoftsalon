import { useState } from "react";
import { Alert, Form, Input, Label, Spinner } from "reactstrap";
import { Link } from "react-router-dom";
import Head from "@/layout/head/Head";
import {
  Block,
  BlockContent,
  BlockDes,
  BlockHead,
  BlockTitle,
  Button,
  PreviewCard,
} from "@/components/Component";
import { salonApi } from "@/services/salonApi";
import { formatDate, labelize } from "@/utils/salonFormat";

const MirisoftLogo = "/mirisoftlogo.png";

const PublicSupport = () => {
  const [mode, setMode] = useState("create");
  const [values, setValues] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const update = (name) => (event) =>
    setValues((current) => ({ ...current, [name]: event.target.value }));

  const submit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const response =
        mode === "create"
          ? await salonApi.support.createPublic({
              title: values.title,
              description: values.description,
              reporterName: values.reporterName,
              reporterEmail: values.reporterEmail,
              reporterPhone: values.reporterPhone,
              category: values.category || "LOGIN_ISSUE",
              priority: values.priority || "MEDIUM",
              pageUrl: window.location.href,
              browserInfo: navigator.userAgent,
            })
          : await salonApi.support.getPublic(
              values.ticketCode,
              values.reporterEmail
            );
      setResult(response.data);
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Head title="Public support" />
      <Block className="nk-block-middle nk-auth-body wide-md">
        <div className="brand-logo pb-4 text-center">
          <Link to="/" className="logo-link">
            <img className="logo-light logo-img logo-img-lg" src={MirisoftLogo} alt="MiriSoft" />
            <img className="logo-dark logo-img logo-img-lg" src={MirisoftLogo} alt="MiriSoft" />
          </Link>
        </div>
        <PreviewCard className="card-bordered" bodyClass="card-inner-lg">
          <BlockHead>
            <BlockContent>
              <BlockTitle tag="h4">Need help signing in?</BlockTitle>
              <BlockDes>
                <p>Create a public support ticket or track one using its code and email.</p>
              </BlockDes>
            </BlockContent>
          </BlockHead>
          <div className="btn-group w-100 mb-4">
            <Button
              type="button"
              color={mode === "create" ? "primary" : "light"}
              className="w-50"
              onClick={() => setMode("create")}
            >
              Create ticket
            </Button>
            <Button
              type="button"
              color={mode === "track" ? "primary" : "light"}
              className="w-50"
              onClick={() => setMode("track")}
            >
              Track ticket
            </Button>
          </div>
          {error && <Alert color="danger">{error}</Alert>}
          {result && (
            <Alert color="success">
              <strong>{result.ticketCode}</strong> · {result.title}
              <div className="mt-1">
                {labelize(result.status)} · Updated {formatDate(result.updatedAt, true)}
              </div>
            </Alert>
          )}
          <Form onSubmit={submit}>
            {mode === "create" ? (
              <>
                <div className="form-group">
                  <Label>Title</Label>
                  <Input required value={values.title || ""} onChange={update("title")} />
                </div>
                <div className="form-group">
                  <Label>Description</Label>
                  <Input type="textarea" rows="5" required value={values.description || ""} onChange={update("description")} />
                </div>
                <div className="row g-3">
                  <div className="col-md-6">
                    <Label>Your name</Label>
                    <Input value={values.reporterName || ""} onChange={update("reporterName")} />
                  </div>
                  <div className="col-md-6">
                    <Label>Phone</Label>
                    <Input type="tel" value={values.reporterPhone || ""} onChange={update("reporterPhone")} />
                  </div>
                </div>
              </>
            ) : (
              <div className="form-group">
                <Label>Ticket code</Label>
                <Input required value={values.ticketCode || ""} onChange={update("ticketCode")} />
              </div>
            )}
            <div className="form-group mt-3">
              <Label>Email</Label>
              <Input type="email" required value={values.reporterEmail || ""} onChange={update("reporterEmail")} />
            </div>
            <Button type="submit" color="primary" className="w-100" disabled={loading}>
              {loading && <Spinner size="sm" className="me-1" />}
              {mode === "create" ? "Create support ticket" : "Track ticket"}
            </Button>
          </Form>
          <div className="text-center pt-4">
            <Link to="/auth-login">Back to sign in</Link>
          </div>
        </PreviewCard>
      </Block>
    </>
  );
};

export default PublicSupport;
