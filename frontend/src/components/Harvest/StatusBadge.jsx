import React from 'react'

export default function StatusBadge({ status }) {
  if (!status) return null
  return <span className={`harvest-status harvest-status-${status}`}>{status}</span>
}
