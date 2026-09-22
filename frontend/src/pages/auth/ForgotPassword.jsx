import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Alert } from "reactstrap";
import Head from "@/layout/head/Head";
import AuthFooter from "./AuthFooter";
import { Block, BlockContent, BlockDes, BlockHead, BlockTitle, Button, PreviewCard } from "@/components/Component";
import { useForm } from "react-hook-form";
import { forgotPassword, resetPassword } from "@/services/auth";

const MirisoftLogo = "/mirisoftlogo.png";

// One page, two steps: without a token it asks for the email to send a reset
// link to; the emailed link comes back here with ?token= to set the new passcode.
const ForgotPassword = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors },
  } = useForm();

  const onFormSubmit = async (formData) => {
    setLoading(true);
    setError("");
    try {
      const body = token
        ? await resetPassword(token, formData.password)
        : await forgotPassword(formData.email);
      setDone(body.message);
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Head title="Forgot-Password" />
        <Block className="nk-block-middle nk-auth-body  wide-xs">
          <div className="brand-logo pb-4 text-center">
            <Link to={"/"} className="logo-link">
              <img className="logo-light logo-img logo-img-lg" src={MirisoftLogo} alt="MiriSoft" />
              <img className="logo-dark logo-img logo-img-lg" src={MirisoftLogo} alt="MiriSoft" />
            </Link>
          </div>
          <PreviewCard className="card-bordered" bodyClass="card-inner-lg">
            <BlockHead>
              <BlockContent>
                <BlockTitle tag="h5">{token ? "Set a new passcode" : "Reset passcode"}</BlockTitle>
                <BlockDes>
                  <p>
                    {token
                      ? "Choose a new passcode for your account."
                      : "Enter your account email and we'll send you a link to reset your passcode."}
                  </p>
                </BlockDes>
              </BlockContent>
            </BlockHead>
            {error && <Alert color="danger" role="alert">{error}</Alert>}
            {done ? (
              <Alert color="success" role="status">{done}</Alert>
            ) : (
              <form onSubmit={handleSubmit(onFormSubmit)} noValidate>
                {token ? (
                  <>
                    <div className="form-group">
                      <label className="form-label" htmlFor="new-password">New passcode</label>
                      <input
                        id="new-password"
                        type="password"
                        autoComplete="new-password"
                        className="form-control form-control-lg"
                        disabled={loading}
                        {...register("password", {
                          required: "Passcode is required",
                          minLength: { value: 6, message: "Use at least 6 characters" },
                        })}
                      />
                      {errors.password && <span className="invalid">{errors.password.message}</span>}
                    </div>
                    <div className="form-group">
                      <label className="form-label" htmlFor="confirm-password">Confirm passcode</label>
                      <input
                        id="confirm-password"
                        type="password"
                        autoComplete="new-password"
                        className="form-control form-control-lg"
                        disabled={loading}
                        {...register("confirmPassword", {
                          validate: (value) => value === getValues("password") || "Passcodes do not match",
                        })}
                      />
                      {errors.confirmPassword && <span className="invalid">{errors.confirmPassword.message}</span>}
                    </div>
                  </>
                ) : (
                  <div className="form-group">
                    <label className="form-label" htmlFor="default-01">Email</label>
                    <input
                      id="default-01"
                      type="email"
                      autoComplete="email"
                      className="form-control form-control-lg"
                      placeholder="Enter your email address"
                      disabled={loading}
                      {...register("email", {
                        required: "Email is required",
                        pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: "Enter a valid email address" },
                      })}
                    />
                    {errors.email && <span className="invalid">{errors.email.message}</span>}
                  </div>
                )}
                <div className="form-group">
                  <Button type="submit" color="primary" size="lg" className="btn-block" disabled={loading}>
                    {loading ? "Please wait..." : token ? "Update Passcode" : "Send Reset Link"}
                  </Button>
                </div>
              </form>
            )}
            <div className="form-note-s2 text-center pt-4">
              <Link to={`/auth-login`}>
                <strong>Return to login</strong>
              </Link>
            </div>
          </PreviewCard>
        </Block>
        <AuthFooter />
    </>
  );
};
export default ForgotPassword;
