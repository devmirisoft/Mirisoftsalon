import React, { useState } from "react";
import Icon from "@/components/icon/Icon";

const Favicon = "/favicon.png";

const Toggle = ({ className, click, icon, img, size = 56 }) => {
  const [spins, setSpins] = useState(0);
  return (
    <a
      href="#toggle"
      className={`${className || ""}${img ? " toggle-img" : ""}`}
      onClick={(ev) => {
        ev.preventDefault();
        setSpins((n) => n + 1);
        click(ev);
      }}
    >
      {img ? (
        <img
          src={Favicon}
          alt="Toggle sidebar"
          style={{
            width: `${size}px`,
            height: `${size}px`,
            maxWidth: "none",
            borderRadius: "12px",
            flexShrink: 0,
            objectFit: "contain",
            transform: `rotate(${spins * 360}deg)`,
            transition: "transform .5s ease",
          }}
        />
      ) : (
        <Icon name={icon} />
      )}
    </a>
  );
};
export default Toggle;
