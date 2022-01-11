import * as React from 'react'
import { useState, useEffect } from 'react'

import { server } from '../../../config'

import './styles.css'

export default function PointDetails({ pointPKs, setPointsToDownload }) {
  const [pointsData, setPointsData] = useState([])

  useEffect(() => {
    if (pointPKs && pointPKs.length !== 0) {
      console.log(pointPKs)
      fetch(`${server}/pointQuery/${pointPKs.join(',')}`).then(response => {
        if (response.ok) {
          response.json().then(data => {
            setPointsData(data)
          })
        }
      })
    }
  }, [pointPKs])

  return (
    <div>
      These are the PKs of points that have been selected.
      <span>
        {JSON.stringify(pointPKs)}
      </span>
      <span>
        {JSON.stringify(pointsData)}
      </span>
    </div>
  )
}