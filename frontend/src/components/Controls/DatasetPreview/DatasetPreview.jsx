import React, { useState } from 'react'
import { Modal, Dropdown, DropdownButton, Table } from 'react-bootstrap'
import { ChevronCompactLeft } from 'react-bootstrap-icons'
import { useTranslation } from 'react-i18next'

import Loading from '../Loading/Loading.jsx'
import DatasetPreviewPlot from '../DatasetPreviewPlot/DatasetPreviewPlot.jsx'
import DatasetPreviewTable from '../DatasetPreviewTable/DatasetPreviewTable.jsx'
import './styles.css'

export default function DatasetPreview({ datasetPreview, inspectDataset, setInspectDataset, inspectRecordID, setInspectRecordID, showModal, setShowModal, setDatasetPreview, recordLoading }) {
  const { t, i18n } = useTranslation()
  const [plotXAxis, setPlotXAxis] = useState([])
  const [plotYAxis, setPlotYAxis] = useState([])
  const [selectedVis, setSelectedVis] = useState('table')

  return <Modal
    className='dataPreviewModal'
    show={showModal}
    // fullscreen
    size='xl'
    onHide={() => {
      setInspectRecordID()
      setShowModal(false)
    }}
  >
    {inspectDataset && inspectRecordID &&
      <>
        <Modal.Header closeButton>
          <div
            className='backButton'
            onClick={() => {
              // setInspectDataset()
              setInspectRecordID()
              setShowModal(false)
            }}
            title={t('datasetInspectorBackButtonTitle')} // 'Return to dataset list'
          >
            <ChevronCompactLeft />
            <>
              {t('datasetInspectorBackButtonText')}
            </>
            {/* Back */}
          </div>
          <h4>
            {inspectDataset.title}
            {/* {t('datasetInspectorModalTitle')} */}
            {/* Dataset Preview */}
          </h4>
        </Modal.Header>
        <Modal.Body>
          <div className="previewFlexContainer">
            {/* <div className="previewFlexItem metadataAndRecordIDTableGridContainer">
              <div className="metadataGridContainer">
                <div className="metadataGridItem organisation">
                  <h5>{t('datasetInspectorOrganizationText')}</h5>
                  {inspectDataset.organizations.join(', ')}
                </div>
                <div className="metadataGridItem variable">
                  <h5>{t('datasetInspectorOceanVariablesText')}</h5>
                  {inspectDataset.eovs.map((eov, index) => ' ' + t(eov)).join(',')}
                </div>
                <div className="metadataGridItem platform">
                  <h5>{t('datasetInspectorPlatformText')}</h5>
                  {t(inspectDataset.platform)}
                </div>
                <div className="metadataGridItem records">
                  <h5>{t('datasetInspectorRecordsText')}</h5>
                  ({inspectDataset && `${inspectDataset.profiles_count} / ${inspectDataset.n_profiles}`})
                  <button
                    onClick={() => alert('selected all records from dataset')}
                    disabled={inspectDataset.profiles_count === inspectDataset.n_profiles}
                    title={t('datasetInspectorRecordsSelectAllButtonText')}
                  >
                    Select All
                  </button>
                </div>
                <div className="metadataGridItem button ERDAP">
                  <a
                    href={inspectDataset.erddap_url}
                    target='_blank'
                    title={inspectDataset.erddap_url ? inspectDataset.erddap_url : 'unavailable'} rel="noreferrer">
                    {t('datasetInspectorERDDAPURL')} (ERDDAP)
                  </a>
                </div>
                <div className="metadataGridItem button CKAN">
                  <a
                    href={inspectDataset.ckan_url}
                    target='_blank'
                    title={inspectDataset.ckan_url ? inspectDataset.ckan_url : 'unavailable'} rel="noreferrer">
                    {t('datasetInspectorCKANURL')} (CKAN)
                  </a>
                </div>
              </div>
              <div className="recordIDTable">
                <Table striped bordered hover size="sm">
                  <thead>
                    <tr>
                      <th>{t('datasetInspectorRecordIDText')}</th>
                      <th>{t('datasetInspectorTimeframeText')}</th>
                      <th>{t('datasetInspectorDepthRangeText')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inspectDataset.profiles.map((profile, index) => {
                      return (
                        <tr
                          className={inspectRecordID === profile.profile_id ? 'selectedRecordID' : ''}
                          key={index}
                          onClick={() => setInspectRecordID(profile.profile_id)}
                        >
                          <td>{profile.profile_id}</td>
                          <td>{`${new Date(profile.time_min).toLocaleDateString()} - ${new Date(profile.time_max).toLocaleDateString()}`}</td>
                          <td>{`${profile.depth_min < Number.EPSILON ? 0 : profile.depth_min > 15000 ? t('datasetInspectorDepthTooLargeWarningText') : profile.depth_min.toFixed(1)} - ${profile.depth_max < Number.EPSILON ? 0 : profile.depth_max > 15000 ? t('datasetInspectorDepthTooLargeWarningText') : profile.depth_max.toFixed(1)}`}</td>
                        </tr>
                      )
                    })}
                    {inspectDataset.profiles_count > 1000 && (
                      <tr key={1001}>
                        <td>{`1000/${inspectDataset.profiles_count} ${t('datasetInspectorRecordsShownText')}`}</td>
                        <td />
                        <td />
                      </tr>
                    )}
                  </tbody>
                </Table>
              </div>
            </div> */}
            <div className="previewFlexItem dataTableAndDataPlot">
              <div className="tableAndPlotGridContainer">
                <div className="tableAndPlotGridItem">
                  <strong>Selected record ID:</strong>{` ${inspectRecordID}` || ' Please select a record ID'}
                  {/* {inspectRecordID &&
                    <button className='deselectRecordButton' onClick={() => {
                      setDatasetPreview()
                      setInspectRecordID()
                    }}>Unselect</button>} */}
                  <button
                    className={`toggleButton ${selectedVis === 'table' && 'selected'}`}
                    onClick={() => {
                      setSelectedVis('table')
                      // setRecordLoading(true)
                    }}>
                    Table
                  </button>
                  <button
                    className={`toggleButton ${selectedVis === 'plot' && 'selected'}`}
                    onClick={() => {
                      setSelectedVis('plot')
                      // setRecordLoading(true)
                    }}
                  >
                    Plot
                  </button>
                </div>
                <div className="tableAndPlotGridItem tableAndPlot">
                  {recordLoading && <Loading />}
                  {datasetPreview
                    ?
                    selectedVis === 'table'
                      ?
                      <DatasetPreviewTable
                        datasetPreview={datasetPreview}
                      // setRecordLoading={setRecordLoading}
                      />
                      :
                      <>
                        <DropdownButton title={(plotXAxis && `X axis: ` + plotXAxis.columnName) || 'Select X axis variable'}>
                          {datasetPreview && datasetPreview?.table?.columnNames.map((columnName, index) => {
                            return <Dropdown.Item key={index} onClick={() => setPlotXAxis({ index, columnName })}>{columnName}</Dropdown.Item>
                          })}
                        </DropdownButton>
                        <DropdownButton title={(plotYAxis && `Y Axis: ` + plotYAxis.columnName) || 'Select Y axis variable'}>
                          {datasetPreview && datasetPreview?.table?.columnNames.map((columnName, index) => {
                            return <Dropdown.Item key={index} onClick={() => setPlotYAxis({ index, columnName })}>{columnName}</Dropdown.Item>
                          })}
                        </DropdownButton>
                        {/* <DropdownButton title={(plotType && `PlotType: ` + plotYAxis.columnName) || 'Select plot type'}>
                        Add plot types that will work with the kind of data we are working with
                        {plotlyPlotTypes.map((plotType, index) => {
                          return <Dropdown.Item key={index} onClick={() => setPlotType({ index, plotType })}>{plotType}</Dropdown.Item>
                        })}
                      </DropdownButton> */}
                        <DatasetPreviewPlot
                          datasetPreview={datasetPreview}
                          plotXAxis={plotXAxis}
                          plotYAxis={plotYAxis}
                          title={inspectDataset.title}
                        // setRecordLoading={setRecordLoading}
                        />
                      </>
                    :
                    'Please select a record ID'
                  }
                </div>
              </div>
            </div>
          </div>
        </Modal.Body>
      </>
    }
  </Modal>
}
