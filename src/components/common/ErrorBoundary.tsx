import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** Shown in place of the crashed subtree. */
  label?: string
}
interface State { error: Error | null }

// Contains a render crash to this subtree instead of unmounting the whole app
// (a non-string DB value once white-screened the entire builder via the Audit tab).
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error('ErrorBoundary caught:', error)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex-1 overflow-y-auto p-8">
          <div className="max-w-lg mx-auto mt-12 rounded-sm border border-rose-200 bg-rose-50 p-6">
            <p className="text-[13px] tracking-[0.1em] uppercase text-rose-700">
              {this.props.label ?? 'Something went wrong'}
            </p>
            <p className="text-[12px] text-rose-600 mt-2 font-mono break-words">{this.state.error.message}</p>
            <button
              onClick={() => this.setState({ error: null })}
              className="mt-4 px-3 py-1.5 text-[11px] tracking-[0.1em] uppercase bg-[#1A1A1A] text-white rounded-sm hover:bg-[#333]"
            >
              Retry
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
