import { useState } from "react";
import { useNavigate } from "react-router-dom";
import UserAvatar from "@/components/user/UserAvatar";
import { DropdownToggle, DropdownMenu, Dropdown } from "reactstrap";
import { Icon } from "@/components/Component";
import { LinkList, LinkItem } from "@/components/links/Links";
import { useTheme, useThemeUpdate } from "@/layout/provider/Theme";
import { useAuth } from "@/auth/AuthContext";

const User = () => {
  const theme = useTheme();
  const themeUpdate = useThemeUpdate();
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const toggle = () => setOpen((prevState) => !prevState);
  const displayName = user?.name || "Salon User";
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  const roleLabel = (user?.role || "USER").replaceAll("_", " ");

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await logout();
      navigate("/auth-login", { replace: true });
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <Dropdown isOpen={open} className="user-dropdown" toggle={toggle}>
      <DropdownToggle
        tag="a"
        href="#toggle"
        className="dropdown-toggle"
        onClick={(ev) => {
          ev.preventDefault();
        }}
      >
        <div className="user-toggle">
          <UserAvatar icon="user-alt" className="sm" />
          <div className="user-info d-none d-md-block">
            <div className="user-status">{roleLabel}</div>
            <div className="user-name dropdown-indicator">{displayName}</div>
          </div>
        </div>
      </DropdownToggle>
      <DropdownMenu end className="dropdown-menu-md dropdown-menu-s1">
        <div className="dropdown-inner user-card-wrap bg-lighter d-none d-md-block">
          <div className="user-card sm">
            <div className="user-avatar">
              <span>{initials || "SU"}</span>
            </div>
            <div className="user-info">
              <span className="lead-text">{displayName}</span>
              <span className="sub-text">{user?.email}</span>
            </div>
          </div>
        </div>
        <div className="dropdown-inner">
          <LinkList>
            <LinkItem link="/" icon="dashboard" onClick={toggle}>
              Dashboard
            </LinkItem>
            <LinkItem link="/profile" icon="user-alt" onClick={toggle}>
              Profile
            </LinkItem>
            <LinkItem link="/support" icon="help" onClick={toggle}>
              Support
            </LinkItem>
            <LinkItem link="/pages/terms-policy" icon="policy" onClick={toggle}>
              Terms &amp; Policy
            </LinkItem>
            <li>
              <a className={`dark-switch ${theme.skin === 'dark' ? 'active' : ''}`} href="#" 
              onClick={(ev) => {
                ev.preventDefault();
                themeUpdate.skin(theme.skin === 'dark' ? 'light' : 'dark');
              }}>
                {theme.skin === 'dark' ? 
                  <><em className="icon ni ni-sun"></em><span>Light Mode</span></> 
                  : 
                  <><em className="icon ni ni-moon"></em><span>Dark Mode</span></>
                }
              </a>
            </li>
            <li>
              <a
                className={theme.preference === "system" ? "active" : ""}
                href="#device-theme"
                onClick={(ev) => {
                  ev.preventDefault();
                  themeUpdate.useDeviceSkin();
                }}
              >
                <em className="icon ni ni-monitor"></em>
                <span>
                  Device Theme
                  {theme.preference === "system" ? " (Active)" : ""}
                </span>
              </a>
            </li>
          </LinkList>
        </div>
        <div className="dropdown-inner">
          <LinkList>
            <li>
              <button
                type="button"
                className="btn btn-link p-0 text-start w-100"
                onClick={handleLogout}
                disabled={loggingOut}
              >
                <Icon name="signout" /> <span>{loggingOut ? "Signing Out..." : "Sign Out"}</span>
              </button>
            </li>
          </LinkList>
        </div>
      </DropdownMenu>
    </Dropdown>
  );
};

export default User;
