import React from 'react'
import * as Sentry from '@sentry/react'
import './styles.css'

export default class ErrorBoundary extends React.Component {
  constructor (props) {
    super(props)
    this.state = {
      hasError: false,
      error: ''
    }
  }

  static getDerivedStateFromError (error) {
    return {
      hasError: true,
      error
    }
  }

  componentDidCatch (error, errorInfo) {
    Sentry.captureException(error, {
      extra: { componentStack: errorInfo.componentStack }
    })
  }

  render () {
    if (this.state.hasError) {
      return (
        <div className='errorBoundaryMessage'>
          <img
            className='errorLogo'
            src={this.props.logoSource}
            width='153px'
            height='60px'
          />
          <h1>{this.props.errorBoundaryMessage}</h1>
          {this.state.error.message}
        </div>
      )
    }

    return this.props.children
  }
}
