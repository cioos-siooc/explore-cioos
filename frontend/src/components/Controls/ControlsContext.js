import React from "react";

const ControlsContext = React.createContext({
  eovsSelected: {
    carbon: false,
    currents: false,
    nutrients: false,
    salinity: false,
    temperature: false,
  },
  setEovsSelected: () => { },
  orgsSelected: {},
  setOrgsSelected: () => { }
})

export default ControlsContext;