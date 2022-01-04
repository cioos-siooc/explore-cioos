import * as React from 'react'

export default function Filter({ eovsSelected, setEovsSelected }) {
  const [filterOpen, setFilterOpen] = useState(false)
  // const { eovsSelected, setEovsSelected } = useContext(AppContext)
  const badgeTitle = 'Ocean Variables'
  return (
    <Badge className='filterChip' badge-color='white'>
      {badgeTitle}:{Object.keys(eovsSelected).map((key, index) => {
        if (eovsSelected[key]) {
          return capitalizeFirstLetter(key)
        }
      })}
      <button onClick={() => setFilterOpen(!filterOpen)}>
        {filterOpen ? <ChevronCompactUp /> : <ChevronCompactDown />}
      </button>
      {filterOpen &&
        <div className='filterOptions'>
          {Object.keys(eovsSelected).map(eov => (
            <InputGroup key={eov} className="mb-3">
              <InputGroup.Checkbox
                checked={eovsSelected[eov]}
                onChange={(e) => {
                  setEovsSelected({
                    ...eovsSelected,
                    [eov]: !eovsSelected[eov]
                  })
                }}
                aria-label="Checkbox for following text input"
              />
              <label className='ml-2'>{capitalizeFirstLetter(eov)}</label>
            </InputGroup>))
          }
        </div>
      }
    </Badge>
  )
}