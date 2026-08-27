import { Route, Routes } from 'react-router-dom';
import Landing from './pages/Landing';
import JoinPage from './pages/JoinPage';
import TableScreen from './pages/TableScreen';
import PlayerScreen from './pages/PlayerScreen';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/join/:roomCode?" element={<JoinPage />} />
      <Route path="/table/:roomCode" element={<TableScreen />} />
      <Route path="/play/:roomCode" element={<PlayerScreen />} />
    </Routes>
  );
}
