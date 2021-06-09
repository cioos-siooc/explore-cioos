import React from "react";
import { Range } from "rc-slider";
import 'rc-slider/assets/index.css';

export default class RangeSelector extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      dynamicKey: Date.now(),
      value: [0, 100],
      min: 0,
      max: 1000
    };
  }
  onSliderChange = value => {
    // console.log(value);
    this.setState({
      value: value
    });
    this.props.setStartDepth(value[0])
    this.props.setEndDepth(value[1])
  };

  onInputChange = (value, index) => {
    // console.log(value);

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
    console.log("Value in State on render:", this.state.value);
    return (
      <div>
        <Range
          key={this.state.dynamicKey}
          min={this.state.min}
          max={this.state.max}
          value={this.state.value}
          onChange={this.onSliderChange}
          railStyle={{
            height: 2
          }}
          handleStyle={{
            height: 28,
            width: 28,
            marginLeft: -14,
            marginTop: -14,
            backgroundColor: "red",
            border: 0
          }}
          trackStyle={{
            background: "none"
          }}
        />
      </div>
    );
  }
}