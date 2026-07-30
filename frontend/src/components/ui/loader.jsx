import React from "react";

export const LoaderOne = ({ label = "Loading" }) => (
  <span className="salon-loader-one" role="status" aria-label={label}>
    <span />
    <span />
    <span />
    <style>{`
      .salon-loader-one {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
        min-width: 52px;
        min-height: 24px;
      }

      .salon-loader-one > span {
        width: 10px;
        height: 10px;
        border-radius: 999px;
        background: #6576ff;
        box-shadow: 0 0 0 0 rgba(101, 118, 255, 0.35);
        animation: salon-loader-one-pulse 0.9s ease-in-out infinite;
      }

      .salon-loader-one > span:nth-child(2) {
        animation-delay: 0.14s;
      }

      .salon-loader-one > span:nth-child(3) {
        animation-delay: 0.28s;
      }

      @keyframes salon-loader-one-pulse {
        0%, 80%, 100% {
          opacity: 0.45;
          transform: translateY(0) scale(0.82);
        }
        40% {
          opacity: 1;
          transform: translateY(-5px) scale(1);
          box-shadow: 0 8px 18px rgba(101, 118, 255, 0.26);
        }
      }
    `}</style>
  </span>
);

export default LoaderOne;
