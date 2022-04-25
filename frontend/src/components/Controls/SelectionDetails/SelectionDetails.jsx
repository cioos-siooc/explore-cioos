import * as React from 'react'
import { useState, useEffect } from 'react'
import { ProgressBar } from 'react-bootstrap'
import { useTranslation } from 'react-i18next'

import DatasetsTable from '../DatasetsTable/DatasetsTable.jsx'
import DatasetInspector from '../DatasetInspector/DatasetInspector.jsx'
import QuestionIconTooltip from '../QuestionIconTooltip/QuestionIconTooltip.jsx'
import Loading from '../Loading/Loading.jsx'
import { server } from '../../../config'

import './styles.css'
import {
  bytesToMemorySizeString,
  createDataFilterQueryString,
  getPointsDataSize,
  createSelectionQueryString,
} from "../../../utilities.js";

// Note: datasets and points are exchangable terminology
export default function SelectionDetails({ setPointsToReview, query, polygon, organizations, datasets, children }) {
  const { t, i18n } = useTranslation()
  const [selectAll, setSelectAll] = useState(true)
  const [pointsData, setPointsData] = useState([])
  const [inspectDataset, setInspectDataset] = useState()
  const [dataTotal, setDataTotal] = useState(0)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setDataTotal(0)
    if (!_.isEmpty(pointsData)) {
      const total = getPointsDataSize(pointsData)
      setDataTotal(total / 1000000)
      setPointsToReview(pointsData.filter(point => point.selected))
    }
    setLoading(false)
  }, [pointsData])

  useEffect(() => {
    setDataTotal(0)
    if (polygon !== undefined && !loading) {
      const filtersQuery = createDataFilterQueryString(query, organizations, datasets);
      const shapeQuery = createSelectionQueryString(polygon)
      const combinedQueries = [filtersQuery, shapeQuery].filter(e => e).join("&");
      setInspectDataset()
      setLoading(true)
      let urlString = `${server}/pointQuery?${combinedQueries}`;
      fetch(urlString).then(response => {
        if (response.ok) {
          response.json().then(data => {
            setPointsData(data.map(point => {
              return {
                ...point,
                title: point.title_translated[i18n.language] || point.title,
                selected: true
              }
            }))
          })
        } else {
          setPointsData([])
        }
      })
    }
  }, [polygon, i18n.language])

  function handleSelectDataset(point) {
    let dataset = pointsData.filter((p) => p.pk === point.pk)[0]
    dataset.selected = !point.selected
    const result = pointsData.map((p) => {
      if (p.pk === point.pk) {
        return dataset
      } else {
        return p
      }
    })
    setPointsData(result)
  }

  function handleSelectAllDatasets() {
    setPointsData(pointsData.map(p => {
      return {
        ...p,
        selected: !selectAll
      }
    }))
    setSelectAll(!selectAll)
  }

  return (
    <div className='pointDetails'>
      <div className='pointDetailsInfoRow'>
        {loading ?
          (
            <Loading />
          ) :
          (inspectDataset ?
            <DatasetInspector
              dataset={inspectDataset}
              setInspectDataset={setInspectDataset}
            /> :
            (
              pointsData && pointsData.length > 0 &&
              <DatasetsTable
                handleSelectAllDatasets={handleSelectAllDatasets}
                handleSelectDataset={handleSelectDataset}
                setInspectDataset={setInspectDataset}
                selectAll={selectAll}
                setDatasets={setPointsData}
                datasets={pointsData}
              />
            ) || (
              pointsData && pointsData.length === 0 &&
              <div className="noDataNotice">
                {t('selectionDetailsNoDataWarning')}
                {/* No Data. Modify filters or change selection on map. */}
              </div>
            )
          )

        }
      </div>
      <div className='pointDetailsControls'>
        <div className='pointDetailsControlRow'>
          <div>
            <ProgressBar
              className='dataTotalBar'
              title={t('selectionDetailsProgressBarTitle')}
            >
              <ProgressBar
                striped
                className='upTo100'
                variant='success'
                now={dataTotal < 100 ? dataTotal : 100}
                label={dataTotal < 100 ? bytesToMemorySizeString(dataTotal * 1000000) : `100 MB`}
                key={1}
              />
              {dataTotal > 100 &&
                <ProgressBar
                  striped
                  className='past100'
                  variant='warning'
                  now={dataTotal > 100 ? (dataTotal - 100).toFixed(2) : 0}
                  label={dataTotal > 100 ? bytesToMemorySizeString((dataTotal - 100).toFixed(2) * 1000000) : 0}
                  key={2}
                />
              }
            </ProgressBar>
            <div className='dataTotalRatio'>
              {bytesToMemorySizeString(dataTotal * 1000000)} {t('selectionDetailsMaxRatio')}
              {/* of 100MB Max */}
              <QuestionIconTooltip
                tooltipText={t('selectionDetailsQuestionTooltipText')} //'Downloads are limited to 100MB.'}
                size={20}
                tooltipPlacement={'top'}
              />
            </div>
          </div>
          {children}
        </div>
      </div>
    </div >
  )
}