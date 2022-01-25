import React from 'react'
import { useState, useEffect } from 'react'
import ReactDOM from 'react-dom'
import * as Sentry from "@sentry/react";
import { Integrations } from "@sentry/tracing";
import { Col } from 'react-bootstrap'

import Controls from "./Controls/Controls.jsx";
import Map from "./Map/Map.js";
import SelectionPanel from './Controls/SelectionPanel/SelectionPanel.jsx'
import SelectionDetails from './Controls/SelectionDetails/SelectionDetails.jsx'
import DataDownloadModal from './Controls/DataDownloadModal/DataDownloadModal.jsx';
import { defaultEovsSelected, defaultOrgsSelected, defaultStartDate, defaultEndDate, defaultStartDepth, defaultEndDepth } from './config.js';

import "bootstrap/dist/css/bootstrap.min.css";

import "./styles.css";

if (process.env.NODE_ENV === "production") {
  Sentry.init({
    dsn: "https://ccb1d8806b1c42cb83ef83040dc0d7c0@o56764.ingest.sentry.io/5863595",
    integrations: [new Integrations.BrowserTracing()],

    // Set tracesSampleRate to 1.0 to capture 100%
    // of transactions for performance monitoring.
    // We recommend adjusting this value in production
    tracesSampleRate: 1.0,
  });
}

export default function App() {

  const [pointsToDownload, setPointsToDownload] = useState()
  const [selectedPointPKs, setSelectedPointPKs] = useState()
  const [polygon, setPolygon] = useState()

  const [query, setQuery] = useState({
    startDate: defaultStartDate,
    endDate: defaultEndDate,
    startDepth: defaultStartDepth,
    endDepth: defaultEndDepth,
    eovsSelected: defaultEovsSelected,
    orgsSelected: defaultOrgsSelected
  })

  function DownloadButton() {
    return (
      <DataDownloadModal
        disabled={_.isEmpty(selectedPointPKs)}
      >
        <SelectionDetails
          pointPKs={pointsToDownload}
          setPointsToDownload={setPointsToDownload}
        >
          <button className='submitRequestButton' onClick={() => console.log('download')}>Submit Request</button>
        </SelectionDetails>
      </DataDownloadModal >
    )
  }

  return (
    <div>
      <Map
        setPolygon={setPolygon}
        setSelectedPointPKs={setSelectedPointPKs}
        query={query}
      />
      <Controls
        setQuery={setQuery}
      >
        {selectedPointPKs && (
          <Col xs='auto' className='selectionPanelColumn'>
            <SelectionPanel>
              <SelectionDetails
                pointPKs={selectedPointPKs}
                setPointsToDownload={setPointsToDownload}
              >
                {DownloadButton()}
              </SelectionDetails>
            </SelectionPanel>
          </Col>
        )}
        {DownloadButton()}
      </Controls>
      <a title='Return to CIOOS pacific homepage' className='logo' href='https://cioospacific.ca/' />
    </div>
  );
}


// This is where react reaches into the DOM, finds the <div id="chart"> element, and replaces it with the content of ReactD3Viz's render function JSX.
const domContainer = document.querySelector('#app')
ReactDOM.render(<App />, domContainer)
