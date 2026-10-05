import { Component, type ReactNode } from 'react'

type Props = { onError: () => void; children: ReactNode }

/** Anything that goes wrong in the 3D scene (a chunk that fails to load, a
 * WebGL error) leaves the static placeholder in place instead of breaking the
 * landing page. */
export class SceneBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  componentDidCatch(): void {
    this.props.onError()
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children
  }
}
