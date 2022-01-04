import * as React from 'react'
import { useState } from 'react'
import PropTypes from 'prop-types'
import {Pagination} from 'react-bootstrap'
import './styles.css'

export default function PageControls(props) {
  // const [paginationItems, setPaginationItems] = useState()
  let tempPageItems = []
  if(props.numPages !== 0) {
    if(props.numPages > 7) {
      tempPageItems.push(
        <Pagination.Item key={1} active={props.activePage === 1}onClick={() => props.setActivePage(1)}>
          {1}
        </Pagination.Item>
      )
      if(props.activePage > 3 && props.activePage < props.numPages - 3) { // middle pages
        tempPageItems.push(
          <Pagination.Ellipsis key='startElipsis'/>
        )
        tempPageItems.push(
          <Pagination.Item key={props.activePage - 1} onClick={() => props.setActivePage(props.activePage - 1)}>
            {props.activePage - 1}
          </Pagination.Item>
        )
        tempPageItems.push(
          <Pagination.Item key={props.activePage} active={true} onClick={() => props.setActivePage(props.activePage)}>
            {props.activePage}
          </Pagination.Item>
        )
        tempPageItems.push(
          <Pagination.Item key={props.activePage + 1} onClick={() => props.setActivePage(props.activePage + 1)}>
            {props.activePage + 1}
          </Pagination.Item>
        )
        tempPageItems.push(
          <Pagination.Ellipsis key='endEllipsis'/>
        )
      } else if (props.activePage > props.numPages - 4) { // last couple pages
        tempPageItems.push(
          <Pagination.Ellipsis key='startEllipsis'/>
        )
        tempPageItems.push(
          <Pagination.Item key={props.numPages - 4} active={props.activePage === props.numPages - 4} onClick={() => props.setActivePage(props.numPages - 4)}>
            {props.numPages - 4}
          </Pagination.Item>
        )
        tempPageItems.push(
          <Pagination.Item key={props.numPages - 3} active={props.activePage === props.numPages - 3} onClick={() => props.setActivePage(props.numPages - 3)}>
            {props.numPages - 3}
          </Pagination.Item>
        )
        tempPageItems.push(
          <Pagination.Item key={props.numPages - 2} active={props.activePage === props.numPages - 2} onClick={() => props.setActivePage(props.numPages - 2)}>
            {props.numPages - 2}
          </Pagination.Item>
        )
        tempPageItems.push(
          <Pagination.Item key={props.numPages - 1} active={props.activePage === props.numPages - 1} onClick={() => props.setActivePage(props.numPages - 1)}>
            {props.numPages - 1}
          </Pagination.Item>
        )
      } else if (props.activePage < 4) { // first couple pages
        tempPageItems.push(
          <Pagination.Item key={2} active={props.activePage === 2} onClick={() => props.setActivePage(2)}>
            {2}
          </Pagination.Item>
        )
        tempPageItems.push(
          <Pagination.Item key={3} active={props.activePage === 3} onClick={() => props.setActivePage(3)}>
            {3}
          </Pagination.Item>
        )
        tempPageItems.push(
          <Pagination.Item key={4} active={props.activePage === 4} onClick={() => props.setActivePage(4)}>
            {4}
          </Pagination.Item>
        )
        tempPageItems.push(
          <Pagination.Item key={5} active={props.activePage === 5} onClick={() => props.setActivePage(5)}>
            {5}
          </Pagination.Item>
        )
        tempPageItems.push(
          <Pagination.Ellipsis key='endEllipsis'/>
        )
      }
      tempPageItems.push(
        <Pagination.Item key={props.numPages} active={props.activePage === props.numPages}onClick={() => props.setActivePage(props.numPages)}>
          {props.numPages}
        </Pagination.Item>
      )
    } else {
      for (let number = 1; number <= props.numPages; number++) {
        tempPageItems.push(
          <Pagination.Item key={number} active={number === props.activePage} onClick={() => props.setActivePage(number)}>
            {number}
          </Pagination.Item>,
        );
      }
    }
    // setPaginationItems(tempPageItems)
  }
  return (
    <Pagination size='sm' >
      <Pagination.First onClick={() => props.setActivePage(1)}/>
      <Pagination.Prev onClick={() => {props.activePage !== 1 && props.setActivePage(props.activePage - 1)}}/>
      {tempPageItems}
      <Pagination.Next onClick={() => {props.numPages && props.activePage !== props.numPages  && props.setActivePage(props.activePage + 1)}}/>
      <Pagination.Last onClick={() => {props.numPages && props.setActivePage(props.numPages)}}/>
    </Pagination>
  )
} 

PageControls.propTypes = {
  activePage: PropTypes.number.isRequired,
  setActivePage: PropTypes.func.isRequired
}