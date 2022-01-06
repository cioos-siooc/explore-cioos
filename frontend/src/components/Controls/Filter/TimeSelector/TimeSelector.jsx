import * as React from "react";
import PropTypes from "prop-types";

import './styles.css'

// Spacing elements out to the left and right using justify-content: space-between. https://medium.com/12-developer-labors/css-all-the-ways-to-align-elements-left-and-right-52ecce4a4af9
export default function TimeSelector(props) {
  return (
    <div className='timeSelector'>
      <div className='date'>
        <span>
          Start Date:
        </span>
        <input
          type="date"
          value={props.startDate}
          max={props.endDate}
          onChange={(e) => props.setStartDate(e.target.value)}
        />
      </div>
      <div className='date'>
        <span>
          End Date:
        </span>
        <input
          type="date"
          value={props.endDate}
          min={props.startDate}
          onChange={(e) => props.setEndDate(e.target.value)}
        />
      </div>

    </div>
  );
}

TimeSelector.propTypes = {
  startDate: PropTypes.string.isRequired,
  endDate: PropTypes.string.isRequired,
  setStartDate: PropTypes.func.isRequired,
  setEndDate: PropTypes.func.isRequired,
};
