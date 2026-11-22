import React from 'react';

export class PlayerErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.error("Player Error:", error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 z-[9999] bg-black text-red-500 p-8 flex flex-col items-center justify-center">
          <h2 className="text-2xl font-bold mb-4">Player Error</h2>
          <p className="text-white font-mono bg-red-900/20 p-4 rounded">{String(this.state.error?.message || this.state.error)}</p>
          <pre className="mt-4 text-xs text-gray-400">{String(this.state.error?.stack)}</pre>
          <button className="mt-8 px-4 py-2 bg-white text-black rounded" onClick={() => this.props.onClose()}>Close Player</button>
        </div>
      );
    }
    return this.props.children;
  }
}
