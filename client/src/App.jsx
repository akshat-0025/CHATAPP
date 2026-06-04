import { useState, useEffect } from 'react';
import { io } from 'socket.io-client';
import Auth from './components/Auth';
import Dashboard from './components/Dashboard';

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('duo_token') || '');
  const [user, setUser] = useState(() => {
    try {
      const storedUser = localStorage.getItem('duo_user');
      return storedUser ? JSON.parse(storedUser) : null;
    } catch {
      return null;
    }
  });
  const [socket, setSocket] = useState(null);

  // Initialize socket connection when user is authenticated
  useEffect(() => {
    if (token && user) {
      // Connect to Socket.IO. We use empty URL because Vite proxies socket.io calls.
      const newSocket = io(window.location.origin, {
        auth: { token },
        autoConnect: true,
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000
      });

      newSocket.on('connect', () => {
        console.log('Socket.IO successfully connected to server');
      });

      newSocket.on('connect_error', (err) => {
        console.error('Socket.IO connection error:', err.message);
      });

      setSocket(newSocket);

      return () => {
        newSocket.close();
      };
    } else {
      if (socket) {
        socket.close();
        setSocket(null);
      }
    }
  }, [token]);

  // Handle successful login or registration
  const handleAuthSuccess = (newToken, newUser) => {
    setUser(newUser);
    setToken(newToken);
  };

  // Handle logout
  const handleLogout = () => {
    localStorage.removeItem('duo_token');
    localStorage.removeItem('duo_user');
    setToken('');
    setUser(null);
  };

  return (
    <div className="w-full h-screen bg-[#030712]">
      {token && user ? (
        <Dashboard 
          socket={socket} 
          user={user} 
          token={token} 
          onLogout={handleLogout} 
        />
      ) : (
        <Auth onAuthSuccess={handleAuthSuccess} />
      )}
    </div>
  );
}
