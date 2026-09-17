import React from "react";
import {Link} from "react-router-dom";

const MirisoftLogo = "/Mirisoft text.png";

const Logo = () => {
  return (
    <Link to={`/`} className="logo-link">
      <img className="logo-light logo-img" src={MirisoftLogo} alt="MiriSoft" />
      <img className="logo-dark logo-img" src={MirisoftLogo} alt="MiriSoft" />
    </Link>
  );
};

export default Logo;
