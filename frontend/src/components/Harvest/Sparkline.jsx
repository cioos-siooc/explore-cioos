import React from 'react'

const GLYPHS = { success: '✓', skipped: '·', error: '✗' }

export default function Sparkline({ statuses }) {
  if (!statuses || !statuses.length) return <span className="harvest-spark-empty">—</span>
  return (
    <span className="harvest-spark" title="newest → oldest">
      {statuses.map((s, i) => (
        <span key={i} className={`harvest-spark-dot harvest-spark-${s}`}>
          {GLYPHS[s] || '?'}
        </span>
      ))}
    </span>
  )
}
