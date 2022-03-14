import * as React from 'react'
import { ChevronCompactLeft } from 'react-bootstrap-icons'
import { Container, Table } from 'react-bootstrap'

import './styles.css'

export default function DatasetInspector({ dataset, setInspectDataset, width }) {
  return (
    <div className='datasetInspector' style={{ width: `${width + 10}px` }}>
      <div className='backButton' onClick={() => setInspectDataset()} title='Return to dataset list'>
        <ChevronCompactLeft />
        Back
      </div>
      <div>
        <Container style={{ pointerEvents: 'auto', margin: '10px 0px 10px 0px' }}>
          <hr />
          <h6>
            Title
          </h6>
          <div>
            {dataset.title}
          </div>
          <hr />
          <h6>
            Dataset URL
          </h6>
          <div>
            <a href={dataset.erddap_url} target='_blank'>{dataset.erddap_url}</a>
          </div>
          <hr />
          <h6>
            Organizations
          </h6>
          <div>
            {dataset.organizations.join(', ')}
          </div>
          <hr />
          <h6>
            Ocean Variables
          </h6>
          <div>
            {dataset.eovs.map((eov, index) => ' ' + eov).join(',')}
          </div>
          <hr />
          <h6>
            Records ({dataset && dataset.profiles_count > 1000 ? `${dataset.profiles_count} records total, 1000 shown` : dataset.profiles_count})
          </h6>
        </Container>
        <Table className='inspectorTable' striped bordered size="sm">
          <thead>
            <tr>
              <th>Record ID</th>
              <th>Timeframe</th>
              <th>Depth Range</th>
            </tr>
          </thead>
          <tbody>
            {dataset.profiles.map((profile, index) => {
              return (
                <tr key={index}>
                  <td>{profile.profile_id}</td>
                  <td>{`${new Date(profile.time_min).toLocaleDateString()} - ${new Date(profile.time_max).toLocaleDateString()}`}</td>
                  <td>{`${profile.depth_min < Number.EPSILON ? 0 : profile.depth_min > 15000 ? 'too big' : profile.depth_min.toFixed(1)} - ${profile.depth_max < Number.EPSILON ? 0 : profile.depth_max > 15000 ? 'too big' : profile.depth_max.toFixed(1)}`}</td>
                </tr>
              )
            })}
            {dataset.profiles_count > 1000 && (
              <tr key={1001}>
                <td>{`1000/${dataset.profiles_count} records shown...`}</td>
                <td />
                <td />
              </tr>
            )}
          </tbody>
        </Table>
      </div >
    </div >
  )

}