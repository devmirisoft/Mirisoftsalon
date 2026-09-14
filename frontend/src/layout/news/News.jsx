import React from "react";
import Icon from "@/components/icon/Icon";

const News = () => {
  return (
    <div className="nk-news-list">
      <a className="nk-news-item" href="#news" onClick={(ev) => ev.preventDefault()}>
        <div className="nk-news-icon">
          {/* <Icon name="card-view" /> */}
        </div>
        <div className="nk-news-text">
          {/* <p>
            Salon operations are connected to the live API
            <span> Frontend 5173 · Backend 5000</span>
          </p> */}
          {/* <Icon name="check-circle" /> */}
        </div>
      </a>
    </div>
  );
};

export default News;
