import React from 'react';
import { StoreProvider, useStore } from './store.jsx';
import { NavProvider, UiProvider, useNav } from './ui.jsx';
import { SecurityProvider, useSecurity } from './security.jsx';
import { BottomNav } from './components/Common.jsx';
import { SheetHost, Toast } from './components/Sheets.jsx';
import Home from './screens/Home.jsx';
import Folders from './screens/Folders.jsx';
import Collection from './screens/Collection.jsx';
import Viewer from './screens/Viewer.jsx';
import VoicePlayer from './screens/VoicePlayer.jsx';
import ChatView from './screens/ChatView.jsx';
import NoteEditor from './screens/NoteEditor.jsx';
import Search from './screens/Search.jsx';
import Trash from './screens/Trash.jsx';
import Settings, { HiddenFolders, Backup } from './screens/Settings.jsx';
import { LockScreen, PinScreen } from './screens/Lock.jsx';

const WITH_NAV = new Set(['home', 'folders', 'favorites', 'settings', 'collection', 'trash']);

function Screen({ route }) {
  switch (route.name) {
    case 'home': return <Home />;
    case 'folders': return <Folders />;
    case 'favorites': return <Collection route={route} />;
    case 'settings': return <Settings />;
    case 'collection': return <Collection route={route} />;
    case 'viewer': return <Viewer route={route} />;
    case 'voice': return <VoicePlayer route={route} />;
    case 'chat': return <ChatView route={route} />;
    case 'note': return <NoteEditor route={route} />;
    case 'search': return <Search />;
    case 'trash': return <Trash />;
    case 'hidden': return <HiddenFolders />;
    case 'backup': return <Backup />;
    case 'pin': return <PinScreen route={route} />;
    default: return <Home />;
  }
}

function Shell() {
  const store = useStore();
  const nav = useNav();
  const sec = useSecurity();

  // Пока архив заблокирован, содержимое вообще не отрисовывается.
  if (sec.locked) return <LockScreen />;
  if (!store.ready) return <div className="app"><div className="boot" /></div>;

  const route = nav.top;
  const key = `${nav.stack.length}-${route.name}-${route.id || route.folderId || route.type || ''}`;
  return (
    <div className="app">
      <Screen key={key} route={route} />
      {WITH_NAV.has(route.name) && <BottomNav />}
      <SheetHost />
      <Toast />
    </div>
  );
}

export default function App() {
  return (
    <SecurityProvider>
      <StoreProvider>
        <NavProvider>
          <UiProvider>
            <Shell />
          </UiProvider>
        </NavProvider>
      </StoreProvider>
    </SecurityProvider>
  );
}
