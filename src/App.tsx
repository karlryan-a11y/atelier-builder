import { Header } from '@/components/layout/Header'
import { ClosetPanel } from '@/components/layout/ClosetPanel'
import { Canvas } from '@/components/layout/Canvas'
import { ChatPanel } from '@/components/layout/ChatPanel'

function App() {
  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        <ClosetPanel />
        <Canvas />
        <ChatPanel />
      </div>
    </div>
  )
}

export default App
