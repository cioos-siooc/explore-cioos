import React from "react";
import PropTypes from 'prop-types'
import Slider from "rc-slider";
import 'rc-slider/assets/index.css';

import './styles.css'

export default class RangeSelector extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      dynamicKey: Date.now(),
    };
  }

  onSliderChange = value => {
    this.props.setStartDepth(value[0])
    this.props.setEndDepth(value[1])
  };

  onInputChange = (value, index) => {
    // When an input changes we set the dynamicKey
    this.setState({
      dynamicKey: Date.now()
    });

    if (value >= this.state.min && value <= this.state.max) {
      this.setState(state => {
        state.value[index] = Number(value);
        return {
          value: state.value.sort((x, y) => x - y)
        };
      });
    }
  };

  render() {
    return (
      <div className='rangeSelector'>
        <Slider
          range
          key={this.state.dynamicKey}
          min={0}
          max={12000}
          value={[this.props.startDepth, this.props.endDepth]}
          onChange={this.onSliderChange}
          railStyle={{
            height: 2
          }}
          handleStyle={{
            height: 15,
            width: 15
          }}
          trackStyle={{
            background: "none"
          }}
          marks={{
            0: '0m',
            2000: '2000m',
            4000: '4000m',
            6000: '6000m',
            8000: '8000m',
            10000: '10000m',
            12000: '12000m'
          }}
        />
      </div>
    );
  }
}

RangeSelector.propTypes = {
  startDepth: PropTypes.number.isRequired,
  endDepth: PropTypes.number.isRequired,
  setStartDepth: PropTypes.func.isRequired,
  setEndDepth: PropTypes.func.isRequired
}