import { Component } from 'preact'

class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError (error)      { return { error } }
  componentDidCatch (error, info)              { console.error('💥', error, info) }
  reset = ()                                   => this.setState({ error: null })

  render () {
    if (this.state.error) {
      return (
        <div style={{ padding: '2rem', color: 'var(--error)' }}>
          <h2>Something went wrong.</h2>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{String(this.state.error)}</pre>
          <button className="button" onClick={this.reset}>Dismiss</button>
        </div>
      )
    }
    return this.props.children
  }
}

export default ErrorBoundary