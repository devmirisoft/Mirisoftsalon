import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import Head from "@/layout/head/Head";
import { useAuth } from "@/auth/AuthContext";
import "./login.css";

const MirisoftLogo = "/mirisoftlogo.png";

const Login = () => {
  const [loading, setLoading] = useState(false);
  const [passState, setPassState] = useState(false);
  const [errorVal, setError] = useState("");
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm();

  const onFormSubmit = async (formData) => {
    setLoading(true);
    setError("");

    try {
      await login({ email: formData.email, password: formData.password });
      navigate(location.state?.from?.pathname || "/", { replace: true });
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to sign in.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Head title="Login" />
      <main className="miri-auth">
        <section className="form-side">
          <div className="form-inner">
            <Link className="brand" to="/" aria-label="MIRI home">
              <img src={MirisoftLogo} alt="MiriSoft" />
            </Link>

            <div className="auth-content">
              {errorVal && (
                <div className="top-error" role="alert" aria-live="polite">
                  <span className="top-error-icon" aria-hidden="true">
                    !
                  </span>
                  <span>{errorVal}</span>
                </div>
              )}

              <header className="heading">
                <h1>Welcome Back!</h1>
                <p>
                  Sign in to access your MIRI dashboard
                  <br className="desktop-only" /> and manage your workspace.
                </p>
              </header>

              <form onSubmit={handleSubmit(onFormSubmit)} noValidate>
                <div className="field">
                  <label htmlFor="email">Email</label>
                  <div className={`input-wrap${errors.email ? " has-error" : ""}`}>
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M3 6.5h18v11H3zM4 7l8 6 8-6" />
                    </svg>
                    <input
                      id="email"
                      type="email"
                      autoComplete="email"
                      disabled={loading}
                      placeholder="Enter your email address"
                      aria-invalid={!!errors.email}
                      aria-describedby={errors.email ? "email-error" : undefined}
                      {...register("email", {
                        required: "Email is required",
                        pattern: {
                          value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                          message: "Enter a valid email address",
                        },
                      })}
                    />
                  </div>
                  {errors.email && (
                    <span id="email-error" className="field-error" role="alert">
                      {errors.email.message}
                    </span>
                  )}
                </div>

                <div className="field">
                  <div className="label-row">
                    <label htmlFor="password">Passcode</label>
                    <Link to="/auth-reset">Forgot Code?</Link>
                  </div>
                  <div className={`input-wrap${errors.password ? " has-error" : ""}`}>
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M7 10V8a5 5 0 0110 0v2M5 10h14v10H5z" />
                    </svg>
                    <input
                      id="password"
                      type={passState ? "text" : "password"}
                      autoComplete="current-password"
                      disabled={loading}
                      placeholder="Enter your passcode"
                      aria-invalid={!!errors.password}
                      aria-describedby={errors.password ? "password-error" : undefined}
                      {...register("password", {
                        required: "Password is required",
                        minLength: {
                          value: 6,
                          message: "Password must be at least 6 characters",
                        },
                      })}
                    />
                    <button
                      type="button"
                      className={`eye${passState ? " is-active" : ""}`}
                      disabled={loading}
                      aria-label={passState ? "Hide passcode" : "Show passcode"}
                      aria-pressed={passState}
                      onClick={() => setPassState(!passState)}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z" />
                        <circle cx="12" cy="12" r="2.5" />
                        <path d="M4 20L20 4" className="eye-off-line" />
                      </svg>
                    </button>
                  </div>
                  {errors.password && (
                    <span id="password-error" className="field-error" role="alert">
                      {errors.password.message}
                    </span>
                  )}
                </div>

                <button type="submit" className="sign-in" disabled={loading}>
                  {loading ? "Signing in..." : "Sign in"}
                </button>
              </form>
              <p className="signup">
                New on our platform? <Link to="/auth-register">Create an account</Link>
              </p>
              <p className="signup">
                Unable to sign in? <Link to="/support/public">Contact support</Link>
              </p>
            </div>

            <footer className="auth-foot">
              <nav aria-label="Footer navigation">
                <Link to="/auths/terms" target="_blank">
                  Terms &amp; Condition
                </Link>
                <Link to="/auths/terms" target="_blank">
                  Privacy Policy
                </Link>
                <Link to="/auths/faq" target="_blank">
                  Help
                </Link>
                <button className="language" type="button">
                  English
                </button>
              </nav>
              <p className="copyright">&copy; {new Date().getFullYear()} MiriSoft. All Rights Reserved.</p>
            </footer>
          </div>
        </section>

        <aside className="visual-side" aria-label="MIRI secure workspace">
          <div className="dot-grid" aria-hidden="true">
            {Array.from({ length: 9 }, (_, i) => (
              <span key={i} />
            ))}
          </div>
          <div className="wave wave-top" aria-hidden="true" />
          <div className="wave wave-bottom" aria-hidden="true" />
          <div className="spark spark-one" aria-hidden="true" />
          <div className="spark spark-two" aria-hidden="true" />
          <div className="spark spark-three" aria-hidden="true" />

          <div className="glass-card">
            <img src={MirisoftLogo} alt="MiriSoft" />
            <div className="shield" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M12 3l7 3v5c0 4.7-2.8 8-7 10-4.2-2-7-5.3-7-10V6l7-3z" />
                <path d="M12 8v6m-2-2l2 2 2-2" />
              </svg>
            </div>
            <div className="hero-rule" aria-hidden="true" />
            <h2 className="hero-title">Secure. Smart. Seamless.</h2>
            <p>
              Your data. Your workspace.
              <br />
              Always protected with MIRI.
            </p>
            <div className="hero-features" aria-hidden="true">
              <div className="hero-feature">
                <span>
                  <svg viewBox="0 0 24 24">
                    <path d="M12 3l7 3v5c0 4.7-2.8 8-7 10-4.2-2-7-5.3-7-10V6l7-3z" />
                    <path d="M9.5 12.5l1.7 1.7 3.3-3.6" />
                  </svg>
                </span>
                <strong>Secure Access</strong>
              </div>
              <div className="hero-feature">
                <span>
                  <svg viewBox="0 0 24 24">
                    <path d="M6 18h11a4 4 0 0 0 .7-7.9A5.5 5.5 0 0 0 7.2 8.2 3.8 3.8 0 0 0 6 18z" />
                  </svg>
                </span>
                <strong>Cloud Sync</strong>
              </div>
              <div className="hero-feature">
                <span>
                  <svg viewBox="0 0 24 24">
                    <path d="M5 19V9" />
                    <path d="M10 19V5" />
                    <path d="M15 19v-7" />
                    <path d="M20 19v-4" />
                  </svg>
                </span>
                <strong>Smart Insights</strong>
              </div>
              <div className="hero-feature">
                <span>
                  <svg viewBox="0 0 24 24">
                    <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z" />
                    <path d="M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8L18 15z" />
                  </svg>
                </span>
                <strong>AI Powered</strong>
              </div>
            </div>
          </div>
        </aside>
      </main>
    </>
  );
};

export default Login;
