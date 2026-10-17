import { render } from 'preact';

function App() {
  return <main style={{ fontFamily: 'system-ui', padding: '2rem' }}>TSUZUKU — scaffold OK</main>;
}

render(<App />, document.getElementById('app')!);
