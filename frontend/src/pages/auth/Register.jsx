import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Head from "@/layout/head/Head";
import AuthFooter from "./AuthFooter";
import {
  Block,
  BlockContent,
  BlockDes,
  BlockHead,
  BlockTitle,
  Button,
  Icon,
  PreviewCard,
} from "@/components/Component";
import { Alert, Spinner } from "reactstrap";
import { useForm } from "react-hook-form";
import { Link } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { ApiError } from "@/services/auth";

const MirisoftLogo = "/mirisoftlogo.png";

const FIELD_LABELS = {
  salonName: "Salon Name",
  branchName: "Main Branch Name",
  adminName: "Admin Name",
  email: "Email",
  phone: "Phone Number",
  password: "Passcode",
  confirmPassword: "Confirm Passcode",
};

const SERVER_FIELD_ALIASES = {
  name: "adminName",
  phone_number: "phone",
};

const SERVER_FIELD_MESSAGES = {
  name: "Admin Name is required. Example: Jatin Sharma.",
  phone_number: "Phone Number is required. Example: 9876543210.",
};

const Register = () => {
  const [passState, setPassState] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorVal, setError] = useState("");
  const {
    register,
    handleSubmit,
    setError: setFieldError,
    clearErrors,
    watch,
    formState: { errors },
  } = useForm({
    mode: "onChange",
    reValidateMode: "onChange",
  });
  const navigate = useNavigate();
  const { register: createAccount } = useAuth();
  const watchedValues = watch();

  useEffect(() => {
    const invalidFields = Object.keys(errors)
      .map((field) => FIELD_LABELS[field] || field)
      .filter(Boolean);

    if (invalidFields.length > 0) {
      setError(`Please fix: ${invalidFields.join(", ")}.`);
      return;
    }

    if (errorVal) setError("");
  }, [watchedValues, errors, errorVal]);

  const handleFormSubmit = async (formData) => {
    setLoading(true);
    setError("");

    try {
      await createAccount({
        salonName: formData.salonName,
        branchName: formData.branchName,
        adminName: formData.adminName,
        email: formData.email,
        phone: formData.phone,
        password: formData.password,
        confirmPassword: formData.confirmPassword,
      });
      navigate("/", { replace: true });
    } catch (error) {
      if (error instanceof ApiError && error.errors) {
        const invalidFields = [];
        Object.entries(error.errors).forEach(([field, messages]) => {
          const formField = SERVER_FIELD_ALIASES[field] || field;
          if (Array.isArray(messages) && messages.length > 0) {
            const message = SERVER_FIELD_MESSAGES[field] || messages[0];
            setFieldError(formField, { type: "server", message });
            invalidFields.push(FIELD_LABELS[formField] || formField);
          }
        });
        if (invalidFields.length > 0) {
          setError(`Please fix: ${invalidFields.join(", ")}.`);
          return;
        }
      }
      setError(error instanceof Error ? error.message : "Unable to create the account.");
    } finally {
      setLoading(false);
    }
  };
  return <>
    <Head title="Create Salon Account" />
      <Block className="nk-block-middle nk-auth-body  wide-xs">
        <div className="brand-logo pb-4 text-center">
          <Link to={`/`} className="logo-link">
            <img className="logo-light logo-img logo-img-lg" src={MirisoftLogo} alt="MiriSoft" />
            <img className="logo-dark logo-img logo-img-lg" src={MirisoftLogo} alt="MiriSoft" />
          </Link>
        </div>
        <PreviewCard className="card-bordered" bodyClass="card-inner-lg">
          <BlockHead>
            <BlockContent>
              <BlockTitle tag="h4">Create Your Salon Account</BlockTitle>
              <BlockDes>
                <p>Set up your salon and administrator account.</p>
              </BlockDes>
            </BlockContent>
          </BlockHead>
          <form className="is-alter" onSubmit={handleSubmit(handleFormSubmit)}>
            <div className="form-group">
              <label className="form-label" htmlFor="salonName">
                Salon Name
              </label>
              <div className="form-control-wrap">
                <input
                  type="text"
                  id="salonName"
                  autoComplete="organization"
                  disabled={loading}
                  {...register("salonName", {
                    onChange: () => clearErrors("salonName"),
                    required: "Salon Name is required. Example: Glow Salon.",
                    minLength: {
                      value: 2,
                      message: "Salon Name is too short. Example: Glow Salon.",
                    },
                  })}
                  placeholder="Example: Glow Salon"
                  className="form-control-lg form-control" />
                {errors.salonName && <p className="invalid">{errors.salonName.message}</p>}
              </div>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="branchName">
                Main Branch Name
              </label>
              <div className="form-control-wrap">
                <input
                  type="text"
                  id="branchName"
                  autoComplete="off"
                  disabled={loading}
                  {...register("branchName", {
                    onChange: () => clearErrors("branchName"),
                    minLength: {
                      value: 2,
                      message: "Main Branch Name is too short. Example: Main Branch.",
                    },
                  })}
                  placeholder="Example: Main Branch"
                  className="form-control-lg form-control" />
                {errors.branchName && <p className="invalid">{errors.branchName.message}</p>}
              </div>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="adminName">
                Admin Name
              </label>
              <div className="form-control-wrap">
                <input
                  type="text"
                  id="adminName"
                  autoComplete="name"
                  disabled={loading}
                  {...register("adminName", {
                    onChange: () => clearErrors("adminName"),
                    required: "Admin Name is required. Example: Jatin Sharma.",
                    minLength: {
                      value: 3,
                      message: "Admin Name is too short. Example: Jatin Sharma.",
                    },
                  })}
                  placeholder="Example: Jatin Sharma"
                  className="form-control-lg form-control" />
                {errors.adminName && <p className="invalid">{errors.adminName.message}</p>}
              </div>
            </div>
            <div className="form-group">
              <div className="form-label-group">
                <label className="form-label" htmlFor="default-01">
                  Email
                </label>
              </div>
              <div className="form-control-wrap">
                <input
                  type="email"
                  id="default-01"
                  autoComplete="email"
                  disabled={loading}
                  {...register("email", {
                    onChange: () => clearErrors("email"),
                    required: "Email is required. Example: admin@glowsalon.com.",
                    pattern: {
                      value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                      message: "Email is invalid. Example: admin@glowsalon.com.",
                    },
                  })}
                  className="form-control-lg form-control"
                  placeholder="Example: admin@glowsalon.com" />
                {errors.email && <p className="invalid">{errors.email.message}</p>}
              </div>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="phone">
                Phone Number
              </label>
              <div className="form-control-wrap">
                <input
                  type="tel"
                  id="phone"
                  inputMode="numeric"
                  autoComplete="tel"
                  disabled={loading}
                  {...register("phone", {
                    onChange: () => clearErrors("phone"),
                    required: "Phone Number is required. Example: 9876543210.",
                    validate: (value) =>
                      value.replace(/\D/g, "").length === 10 ||
                      "Phone Number is invalid. Use 10 digits. Example: 9876543210.",
                  })}
                  className="form-control-lg form-control"
                  placeholder="Example: 9876543210"
                />
                {errors.phone && <p className="invalid">{errors.phone.message}</p>}
              </div>
            </div>
            <div className="form-group">
              <div className="form-label-group">
                <label className="form-label" htmlFor="password">
                  Passcode
                </label>
              </div>
              <div className="form-control-wrap">
                <a
                  href="#password"
                  onClick={(ev) => {
                    ev.preventDefault();
                    setPassState(!passState);
                  }}
                  className={`form-icon lg form-icon-right passcode-switch ${passState ? "is-hidden" : "is-shown"}`}
                >
                  <Icon name="eye" className="passcode-icon icon-show"></Icon>

                  <Icon name="eye-off" className="passcode-icon icon-hide"></Icon>
                </a>
                <input
                  type={passState ? "text" : "password"}
                  id="password"
                  autoComplete="new-password"
                  disabled={loading}
                  {...register("password", {
                    onChange: () => clearErrors(["password", "confirmPassword"]),
                    required: "Passcode is required. Example: StrongPass123.",
                    minLength: {
                      value: 6,
                      message: "Passcode is too short. Use at least 6 characters. Example: StrongPass123.",
                    },
                  })}
                  placeholder="Example: StrongPass123"
                  className={`form-control-lg form-control ${passState ? "is-hidden" : "is-shown"}`} />
                {errors.password && <span className="invalid">{errors.password.message}</span>}
              </div>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="confirmPassword">
                Confirm Passcode
              </label>
              <div className="form-control-wrap">
                <input
                  type={passState ? "text" : "password"}
                  id="confirmPassword"
                  autoComplete="new-password"
                  disabled={loading}
                  {...register("confirmPassword", {
                    onChange: () => clearErrors("confirmPassword"),
                    required: "Confirm Passcode is required. Re-enter the same passcode.",
                    validate: (value, values) =>
                      value === values.password || "Confirm Passcode does not match. Example: type the same value as Passcode.",
                  })}
                  placeholder="Example: StrongPass123"
                  className="form-control-lg form-control" />
                {errors.confirmPassword && <span className="invalid">{errors.confirmPassword.message}</span>}
              </div>
            </div>
            <div className="form-group">
              <div className="custom-control custom-control-xs custom-checkbox">
                <input
                  type="checkbox"
                  className="custom-control-input"
                  id="terms"
                  disabled={loading}
                  {...register("terms", {
                    onChange: () => clearErrors("terms"),
                    required: "Terms and Privacy Policy must be accepted to create the account.",
                  })}
                />
                <label className="custom-control-label" htmlFor="terms">
                  I agree to the <Link to="/pages/terms-policy">Terms and Privacy Policy</Link>.
                </label>
              </div>
              {errors.terms && <span className="invalid d-block">{errors.terms.message}</span>}
            </div>
            {errorVal && (
              <div className="mb-3">
                <Alert color="danger" className="alert-icon">
                  <Icon name="alert-circle" /> {errorVal}
                </Alert>
              </div>
            )}
            <div className="form-group">
              <Button type="submit" color="primary" size="lg" className="btn-block" disabled={loading}>
                {loading ? <Spinner size="sm" color="light" /> : "Create Account"}
              </Button>
            </div>
          </form>
          <div className="form-note-s2 text-center pt-4">
            {" "}
            Already have an account?{" "}
            <Link to={`/auth-login`}>
              <strong>Sign in instead</strong>
            </Link>
          </div>
          <div className="text-center pt-4 pb-3">
            <h6 className="overline-title overline-title-sap">
              <span>OR</span>
            </h6>
          </div>
          <ul className="nav justify-center gx-8">
            <li className="nav-item">
              <a
                className="nav-link"
                href="#socials"
                onClick={(ev) => {
                  ev.preventDefault();
                }}
              >
                Facebook
              </a>
            </li>
            <li className="nav-item">
              <a
                className="nav-link"
                href="#socials"
                onClick={(ev) => {
                  ev.preventDefault();
                }}
              >
                Google
              </a>
            </li>
          </ul>
        </PreviewCard>
      </Block>
      <AuthFooter />
  </>;
};
export default Register;
